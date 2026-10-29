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

    def test_fluxo_completo(self):
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

        r = self.client.put(f'/api/analise/denuncias/{did}', json={'status': 'em_analise'}, headers=ANALISTA)
        self.assertEqual(r.status_code, 200)
        self.client.post(f'/api/analise/denuncias/{did}/mensagens', json={'texto': 'Que horas ele chega?'},
                         headers=ANALISTA)
        r = self.client.post('/api/denuncias/mensagens', json={**cred, 'texto': 'Por volta das 22h'})
        acomp = r.get_json()
        self.assertEqual(acomp['status'], 'em_analise')
        self.assertEqual([m['autor'] for m in acomp['mensagens']], ['equipe', 'cidadao'])
        self.assertNotIn('recompensa', acomp)


    def test_filtro_crimes_graves(self):
        self.criar(categoria='furto')
        self.criar(categoria='homicidio')
        graves = self.client.get('/api/analise/denuncias?grave=1', headers=ANALISTA).get_json()['denuncias']
        self.assertTrue(graves)
        self.assertTrue(all(d['grave'] for d in graves))

    def test_validacoes(self):
        r = self.client.post('/api/denuncias', json={'categoria': 'xx', 'descricao': 'a' * 30})
        self.assertEqual(r.status_code, 400)
        r = self.client.post('/api/denuncias', json={'categoria': 'furto', 'descricao': 'a' * 30})
        self.assertEqual(r.status_code, 400)  # sem localização


class EmpregoTest(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def publicar(self, telefone, tipo='oferta', **extra):
        dados = {
            'tipo': tipo, 'titulo': 'Auxiliar de cozinha', 'descricao': 'Turno da noite',
            'cidade': 'niterói', 'uf': 'rj', 'telefone_contato': telefone, **extra,
        }
        r = self.client.post('/api/empregos', json=dados)
        return r.status_code, r.get_json()

    def ids_no_ar(self, query=''):
        return [v['id'] for v in self.client.get('/api/empregos' + query).get_json()['vagas']]

    def test_oferta_precisa_de_aprovacao_e_procura_publica_na_hora(self):
        status, oferta = self.publicar('21900000001')
        self.assertEqual(status, 201)
        self.assertEqual(oferta['status'], 'pendente')
        self.assertEqual(oferta['vaga']['telefone_contato'], '21900000001')
        self.assertNotIn(oferta['vaga']['id'], self.ids_no_ar())

        _, procura = self.publicar('21900000002', tipo='procura', titulo='Procuro vaga de motorista')
        self.assertEqual(procura['status'], 'aprovada')
        self.assertIn(procura['vaga']['id'], self.ids_no_ar())

        self.assertEqual(self.client.get('/api/analise/empregos').status_code, 401)
        fila = self.client.get('/api/analise/empregos', headers=ANALISTA).get_json()
        self.assertIn(oferta['vaga']['id'], [v['id'] for v in fila])

        self.client.post(f"/api/analise/empregos/{oferta['vaga']['id']}/aprovar", headers=ANALISTA)
        self.assertIn(oferta['vaga']['id'], self.ids_no_ar())

    def test_palavras_suspeitas_vao_para_moderacao(self):
        _, r = self.publicar('21900000003', tipo='procura', descricao='Pague a taxa de cadastro via PIX')
        self.assertEqual(r['status'], 'pendente')
        fila = self.client.get('/api/analise/empregos', headers=ANALISTA).get_json()
        vaga = next(v for v in fila if v['id'] == r['vaga']['id'])
        self.assertIn('taxa', vaga['motivo_moderacao'])

    def test_limite_de_anuncios_por_telefone(self):
        for _ in range(3):
            self.assertEqual(self.publicar('21900000004')[0], 201)
        status, r = self.publicar('21900000004')
        self.assertEqual(status, 429)

    def test_filtro_por_cidade(self):
        _, a = self.publicar('31900000001', tipo='procura', cidade='  belo   HORIZONTE ', uf='MG')
        _, b = self.publicar('31900000002', tipo='procura', cidade='Contagem', uf='MG')
        self.assertEqual(a['vaga']['cidade'], 'Belo Horizonte')

        cidades = self.client.get('/api/empregos/cidades?uf=MG').get_json()
        self.assertEqual([c['cidade'] for c in cidades], ['Belo Horizonte', 'Contagem'])

        ids = self.ids_no_ar('?cidade=belo horizonte&uf=MG')
        self.assertIn(a['vaga']['id'], ids)
        self.assertNotIn(b['vaga']['id'], ids)

    def test_denuncias_de_usuarios_tiram_anuncio_do_ar(self):
        _, r = self.publicar('21900000005', tipo='procura')
        vid = r['vaga']['id']
        self.assertEqual(self.client.post(f'/api/empregos/{vid}/denunciar', json={'motivo': 'x'}).status_code, 400)
        for _ in range(3):
            resp = self.client.post(f'/api/empregos/{vid}/denunciar', json={'motivo': 'cobra_taxa'})
            self.assertEqual(resp.status_code, 201)
        self.assertNotIn(vid, self.ids_no_ar())

        self.client.post(f'/api/analise/empregos/{vid}/aprovar', headers=ANALISTA)
        self.assertIn(vid, self.ids_no_ar())
        # contador zera ao aprovar: uma nova denúncia não derruba de novo
        self.client.post(f'/api/empregos/{vid}/denunciar', json={'motivo': 'golpe'})
        self.assertIn(vid, self.ids_no_ar())

    def test_editar_remover_e_destaque(self):
        _, r = self.publicar('21900000006')
        vid, codigo = r['vaga']['id'], r['codigo_gestao']
        self.client.post(f'/api/analise/empregos/{vid}/aprovar', headers=ANALISTA)

        resp = self.client.put(f'/api/empregos/{vid}', json={'codigo_gestao': 'errado', 'salario': 'R$ 2.000'})
        self.assertEqual(resp.status_code, 403)
        resp = self.client.put(f'/api/empregos/{vid}', json={'codigo_gestao': codigo, 'salario': 'R$ 2.000'})
        self.assertEqual(resp.get_json()['salario'], 'R$ 2.000')
        self.assertEqual(resp.get_json()['status'], 'pendente')  # vaga editada volta para aprovação

        self.client.post(f'/api/analise/empregos/{vid}/aprovar', headers=ANALISTA)
        self.client.post(f'/api/analise/empregos/{vid}/destaque', json={'dias': 7}, headers=ANALISTA)
        vagas = self.client.get('/api/empregos').get_json()['vagas']
        self.assertEqual(vagas[0]['id'], vid)
        self.assertTrue(vagas[0]['destaque'])

        self.assertEqual(self.client.delete(f'/api/empregos/{vid}', json={'codigo_gestao': codigo}).status_code, 204)
        self.assertNotIn(vid, self.ids_no_ar())


class MapaTest(unittest.TestCase):
    def test_coordenadas_invalidas(self):
        client = app.test_client()
        self.assertEqual(client.get('/api/mapa/20/0/0.png').status_code, 404)
        self.assertEqual(client.get('/api/mapa/2/4/0.png').status_code, 404)


if __name__ == '__main__':
    unittest.main()
