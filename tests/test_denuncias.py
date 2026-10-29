import io
import os
import tempfile
import unittest

_tmp = tempfile.mkdtemp()
os.environ['DATABASE_URL'] = f"sqlite:///{os.path.join(_tmp, 'test.db')}"
os.environ['UPLOAD_DIR'] = os.path.join(_tmp, 'uploads')
os.environ['ANALISTA_TOKEN'] = 'token-teste'

from PIL import Image  # noqa: E402
from src.main import app  # noqa: E402

ANALISTA = {'Authorization': 'Bearer token-teste'}


def foto_com_gps():
    img = Image.new('RGB', (40, 40), 'red')
    exif = Image.Exif()
    exif[0x010F] = 'MarcaDoCelular'
    exif[0x8825] = {2: (22.0, 54.0, 0.0)}  # GPSInfo
    buf = io.BytesIO()
    img.save(buf, format='JPEG', exif=exif)
    buf.seek(0)
    return buf


class DenunciaTest(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def criar(self, categoria='trafico_drogas', **extra):
        dados = {
            'categoria': categoria,
            'descricao': 'Venda de drogas toda noite na esquina da rua principal.',
            'latitude': '-22.9', 'longitude': '-43.2',
            'suspeito_apelidos': 'Baixinho, Nego D',
            'faccionado': 'sim', 'faccao': 'XYZ',
            'fotos': [(foto_com_gps(), 'f.jpg')],
            **extra,
        }
        resp = self.client.post('/api/denuncias', data=dados, content_type='multipart/form-data')
        self.assertEqual(resp.status_code, 201, resp.get_json())
        return resp.get_json()

    def test_fluxo_completo_com_recompensa(self):
        criada = self.criar()
        cred = {'protocolo': criada['protocolo'], 'chave': criada['chave']}

        acomp = self.client.post('/api/denuncias/acompanhar', json=cred).get_json()
        self.assertEqual(acomp['status'], 'recebida')
        self.assertNotIn('suspeito', acomp)

        errado = self.client.post('/api/denuncias/acompanhar', json={**cred, 'chave': 'CH-XXXX'})
        self.assertEqual(errado.status_code, 404)

        self.assertEqual(self.client.get('/api/analise/denuncias').status_code, 401)
        lista = self.client.get('/api/analise/denuncias', headers=ANALISTA).get_json()
        denuncia = next(d for d in lista['denuncias'] if d['protocolo'] == criada['protocolo'])
        did = denuncia['id']

        foto = self.client.get(f"/api/analise/fotos/{denuncia['fotos'][0]}", headers=ANALISTA)
        self.assertEqual(Image.open(io.BytesIO(foto.data)).getexif(), {})

        # Não pode liberar recompensa antes da confirmação
        r = self.client.post(f'/api/analise/denuncias/{did}/recompensa', json={'valor': 500}, headers=ANALISTA)
        self.assertEqual(r.status_code, 400)

        self.client.put(f'/api/analise/denuncias/{did}', json={'status': 'resultado_confirmado'}, headers=ANALISTA)
        r = self.client.post(f'/api/analise/denuncias/{did}/recompensa', json={'valor': 500}, headers=ANALISTA)
        self.assertEqual(r.status_code, 200)

        r = self.client.post('/api/denuncias/recompensa/resgatar', json={**cred, 'metodo': 'pix', 'destino': 'chave@pix'})
        self.assertEqual(r.get_json()['recompensa']['status'], 'resgate_solicitado')

        r = self.client.post(f'/api/analise/denuncias/{did}/recompensa/pagar', json={}, headers=ANALISTA)
        self.assertEqual(r.get_json()['recompensa']['status'], 'paga')
        self.assertIsNone(r.get_json()['recompensa']['destino'])

    def test_crime_nao_grave_nao_gera_recompensa(self):
        criada = self.criar(categoria='furto')
        self.assertFalse(criada['pode_gerar_recompensa'])
        lista = self.client.get('/api/analise/denuncias?categoria=furto', headers=ANALISTA).get_json()
        did = lista['denuncias'][0]['id']
        self.client.put(f'/api/analise/denuncias/{did}', json={'status': 'resultado_confirmado'}, headers=ANALISTA)
        r = self.client.post(f'/api/analise/denuncias/{did}/recompensa', json={'valor': 100}, headers=ANALISTA)
        self.assertEqual(r.status_code, 400)

    def test_validacoes(self):
        r = self.client.post('/api/denuncias', json={'categoria': 'xx', 'descricao': 'a' * 30})
        self.assertEqual(r.status_code, 400)
        r = self.client.post('/api/denuncias', json={'categoria': 'furto', 'descricao': 'a' * 30})
        self.assertEqual(r.status_code, 400)  # sem localização


class EmpregoTest(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_publicar_editar_destacar_remover(self):
        r = self.client.post('/api/empregos', json={
            'tipo': 'oferta', 'titulo': 'Auxiliar de cozinha', 'descricao': 'Turno da noite',
            'cidade': 'Niterói', 'uf': 'rj', 'telefone_contato': '(21) 99999-0000',
        })
        self.assertEqual(r.status_code, 201)
        vaga, codigo = r.get_json()['vaga'], r.get_json()['codigo_gestao']
        self.assertEqual(vaga['telefone_contato'], '21999990000')

        self.client.post('/api/empregos', json={
            'tipo': 'procura', 'titulo': 'Procuro vaga de motorista', 'descricao': 'CNH D',
            'cidade': 'Niterói', 'uf': 'RJ', 'telefone_contato': '21988880000',
        })

        r = self.client.put(f"/api/empregos/{vaga['id']}", json={'codigo_gestao': 'errado', 'salario': 'R$ 2.000'})
        self.assertEqual(r.status_code, 403)
        r = self.client.put(f"/api/empregos/{vaga['id']}", json={'codigo_gestao': codigo, 'salario': 'R$ 2.000'})
        self.assertEqual(r.get_json()['salario'], 'R$ 2.000')

        self.client.post(f"/api/analise/empregos/{vaga['id']}/destaque", json={'dias': 7}, headers=ANALISTA)
        lista = self.client.get('/api/empregos?uf=RJ').get_json()['vagas']
        self.assertEqual(lista[0]['id'], vaga['id'])
        self.assertTrue(lista[0]['destaque'])

        r = self.client.delete(f"/api/empregos/{vaga['id']}", json={'codigo_gestao': codigo})
        self.assertEqual(r.status_code, 204)
        ids = [v['id'] for v in self.client.get('/api/empregos').get_json()['vagas']]
        self.assertNotIn(vaga['id'], ids)


if __name__ == '__main__':
    unittest.main()
