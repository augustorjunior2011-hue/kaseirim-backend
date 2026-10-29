import os
import secrets

from flask import Blueprint, request, jsonify, send_file, abort

from src.models.db import db
from src.models.denuncia import (
    Denuncia, FotoDenuncia, MensagemDenuncia,
    CATEGORIAS, FACCIONADO, STATUS,
)
from src.utils.anonimato import (
    gerar_codigo, gerar_chave_secreta, hash_chave, conferir_chave,
    normalizar, limpar_imagem, exige_analista,
)

denuncia_bp = Blueprint('denuncia', __name__)

MAX_FOTOS = 5
UPLOAD_DIR = os.environ.get(
    'UPLOAD_DIR',
    os.path.join(os.path.dirname(os.path.dirname(__file__)), 'database', 'uploads'),
)


def _dados():
    """Aceita JSON ou multipart/form-data (quando há fotos)."""
    if request.is_json:
        return request.get_json(silent=True) or {}
    return request.form.to_dict()


def _texto(dados, campo, limite):
    valor = (dados.get(campo) or '').strip()
    return valor[:limite] or None


def _float(valor, minimo, maximo):
    try:
        numero = float(valor)
    except (TypeError, ValueError):
        return None
    return numero if minimo <= numero <= maximo else None


def _autenticar(dados):
    """Localiza a denúncia pelo protocolo e confere a chave secreta."""
    denuncia = Denuncia.query.filter_by(protocolo=normalizar(dados.get('protocolo'))).first()
    if not denuncia or not conferir_chave(dados.get('chave'), denuncia.chave_hash):
        return None
    return denuncia


# ---------------------------------------------------------------------------
# Rotas públicas (cidadão, sem cadastro)
# ---------------------------------------------------------------------------

@denuncia_bp.route('/denuncias/categorias', methods=['GET'])
def listar_categorias():
    return jsonify([
        {'id': chave, 'nome': info['nome']}
        for chave, info in CATEGORIAS.items()
    ])


@denuncia_bp.route('/denuncias', methods=['POST'])
def criar_denuncia():
    dados = _dados()

    categoria = dados.get('categoria')
    if categoria not in CATEGORIAS:
        return jsonify({'error': 'Categoria inválida'}), 400

    descricao = _texto(dados, 'descricao', 5000)
    if not descricao or len(descricao) < 20:
        return jsonify({'error': 'Descreva o que aconteceu (mínimo 20 caracteres)'}), 400

    latitude = _float(dados.get('latitude'), -90, 90)
    longitude = _float(dados.get('longitude'), -180, 180)
    referencia = _texto(dados, 'referencia_local', 300)
    if (latitude is None or longitude is None) and not referencia:
        return jsonify({'error': 'Marque a localização no mapa ou descreva um ponto de referência'}), 400

    faccionado = dados.get('faccionado') or 'nao_sei'
    if faccionado not in FACCIONADO:
        return jsonify({'error': "Campo 'faccionado' deve ser sim, nao ou nao_sei"}), 400

    fotos = request.files.getlist('fotos') if not request.is_json else []
    if len(fotos) > MAX_FOTOS:
        return jsonify({'error': f'Envie no máximo {MAX_FOTOS} fotos'}), 400

    fotos_limpas = []
    for foto in fotos:
        conteudo = limpar_imagem(foto.stream)
        if conteudo is None:
            return jsonify({'error': 'Uma das fotos não é uma imagem válida'}), 400
        fotos_limpas.append(conteudo)

    chave = gerar_chave_secreta()
    protocolo = gerar_codigo('DN')
    while Denuncia.query.filter_by(protocolo=protocolo).first():
        protocolo = gerar_codigo('DN')

    uf = _texto(dados, 'uf', 2)
    denuncia = Denuncia(
        protocolo=protocolo,
        chave_hash=hash_chave(chave),
        categoria=categoria,
        descricao=descricao,
        data_ocorrencia=_texto(dados, 'data_ocorrencia', 40),
        latitude=latitude,
        longitude=longitude,
        referencia_local=referencia,
        cidade=_texto(dados, 'cidade', 100),
        uf=uf.upper() if uf else None,
        suspeito_nome=_texto(dados, 'suspeito_nome', 150),
        suspeito_apelidos=_texto(dados, 'suspeito_apelidos', 300),
        suspeito_caracteristicas=_texto(dados, 'suspeito_caracteristicas', 2000),
        faccionado=faccionado,
        faccao=_texto(dados, 'faccao', 100) if faccionado == 'sim' else None,
    )
    db.session.add(denuncia)
    db.session.flush()

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    for conteudo in fotos_limpas:
        nome = f"{secrets.token_hex(16)}.jpg"
        with open(os.path.join(UPLOAD_DIR, nome), 'wb') as destino:
            destino.write(conteudo)
        db.session.add(FotoDenuncia(denuncia_id=denuncia.id, arquivo=nome))

    db.session.commit()

    return jsonify({
        'message': 'Denúncia recebida. Guarde o protocolo e a chave: eles são a única forma de '
                   'acompanhar a denúncia e conversar com a equipe. Não conseguimos recuperá-los.',
        'protocolo': protocolo,
        'chave': chave,
    }), 201


@denuncia_bp.route('/denuncias/acompanhar', methods=['POST'])
def acompanhar_denuncia():
    denuncia = _autenticar(request.get_json(silent=True) or {})
    if not denuncia:
        return jsonify({'error': 'Protocolo ou chave inválidos'}), 404
    return jsonify(denuncia.to_public_dict())


@denuncia_bp.route('/denuncias/mensagens', methods=['POST'])
def enviar_mensagem_cidadao():
    dados = request.get_json(silent=True) or {}
    denuncia = _autenticar(dados)
    if not denuncia:
        return jsonify({'error': 'Protocolo ou chave inválidos'}), 404

    texto = _texto(dados, 'texto', 3000)
    if not texto:
        return jsonify({'error': 'Mensagem vazia'}), 400

    db.session.add(MensagemDenuncia(denuncia_id=denuncia.id, autor='cidadao', texto=texto))
    db.session.commit()
    return jsonify(denuncia.to_public_dict()), 201


# ---------------------------------------------------------------------------
# Rotas da equipe de análise (protegidas por ANALISTA_TOKEN)
# ---------------------------------------------------------------------------

@denuncia_bp.route('/analise/denuncias', methods=['GET'])
@exige_analista
def analise_listar():
    query = Denuncia.query
    if request.args.get('status'):
        query = query.filter_by(status=request.args['status'])
    if request.args.get('categoria'):
        query = query.filter_by(categoria=request.args['categoria'])
    if request.args.get('uf'):
        query = query.filter_by(uf=request.args['uf'].upper())

    page = request.args.get('page', 1, type=int)
    per_page = min(request.args.get('per_page', 20, type=int), 100)
    resultado = query.order_by(Denuncia.id.desc()).paginate(page=page, per_page=per_page, error_out=False)
    return jsonify({
        'denuncias': [d.to_dict() for d in resultado.items],
        'total': resultado.total,
        'pages': resultado.pages,
        'current_page': page,
    })


@denuncia_bp.route('/analise/denuncias/<int:denuncia_id>', methods=['GET'])
@exige_analista
def analise_detalhe(denuncia_id):
    return jsonify(db.get_or_404(Denuncia, denuncia_id).to_dict())


@denuncia_bp.route('/analise/fotos/<int:foto_id>', methods=['GET'])
@exige_analista
def analise_foto(foto_id):
    foto = db.get_or_404(FotoDenuncia, foto_id)
    caminho = os.path.join(UPLOAD_DIR, foto.arquivo)
    if not os.path.exists(caminho):
        abort(404)
    return send_file(caminho, mimetype='image/jpeg')


@denuncia_bp.route('/analise/denuncias/<int:denuncia_id>', methods=['PUT'])
@exige_analista
def analise_atualizar(denuncia_id):
    denuncia = db.get_or_404(Denuncia, denuncia_id)
    dados = request.get_json(silent=True) or {}

    if 'status' in dados:
        if dados['status'] not in STATUS:
            return jsonify({'error': f"Status deve ser um de: {', '.join(STATUS)}"}), 400
        denuncia.status = dados['status']
    if 'parecer_analise' in dados:
        denuncia.parecer_analise = dados['parecer_analise']

    db.session.commit()
    return jsonify(denuncia.to_dict())


@denuncia_bp.route('/analise/denuncias/<int:denuncia_id>/mensagens', methods=['POST'])
@exige_analista
def analise_mensagem(denuncia_id):
    denuncia = db.get_or_404(Denuncia, denuncia_id)
    texto = _texto(request.get_json(silent=True) or {}, 'texto', 3000)
    if not texto:
        return jsonify({'error': 'Mensagem vazia'}), 400
    db.session.add(MensagemDenuncia(denuncia_id=denuncia.id, autor='equipe', texto=texto))
    db.session.commit()
    return jsonify(denuncia.to_dict()), 201

