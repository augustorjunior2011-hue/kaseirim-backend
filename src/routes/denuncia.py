import os
import re
import secrets

from flask import Blueprint, request, jsonify, send_file, abort

from src.models.user import db
from src.models.denuncia import (
    Denuncia, FotoDenuncia, MensagemDenuncia,
    CATEGORIAS, FACCIONADO, STATUS, METODOS_RESGATE,
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
        {'id': chave, 'nome': info['nome'], 'pode_gerar_recompensa': info['grave']}
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
                   'acompanhar a denúncia e resgatar uma eventual recompensa. Não conseguimos recuperá-los.',
        'protocolo': protocolo,
        'chave': chave,
        'pode_gerar_recompensa': denuncia.grave,
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


@denuncia_bp.route('/denuncias/recompensa/resgatar', methods=['POST'])
def resgatar_recompensa():
    """O cidadão escolhe como receber, sem se identificar.

    - vale_presente: a equipe compra um vale e o código aparece no acompanhamento (mais anônimo).
    - recarga_celular: crédito em um número pré-pago informado agora.
    - pix: chave PIX informada agora; apagada do sistema assim que o pagamento é feito.
    """
    dados = request.get_json(silent=True) or {}
    denuncia = _autenticar(dados)
    if not denuncia:
        return jsonify({'error': 'Protocolo ou chave inválidos'}), 404

    if denuncia.recompensa_status != 'elegivel':
        return jsonify({'error': 'Esta denúncia não possui recompensa disponível para resgate',
                        'recompensa_status': denuncia.recompensa_status}), 400

    metodo = dados.get('metodo')
    if metodo not in METODOS_RESGATE:
        return jsonify({'error': f"Método deve ser um de: {', '.join(METODOS_RESGATE)}"}), 400

    destino = _texto(dados, 'destino', 150)
    if metodo == 'recarga_celular':
        destino = re.sub(r'\D', '', destino or '')
        if len(destino) not in (10, 11):
            return jsonify({'error': 'Informe o celular com DDD'}), 400
    elif metodo == 'pix' and not destino:
        return jsonify({'error': 'Informe a chave PIX'}), 400
    elif metodo == 'vale_presente':
        destino = None

    denuncia.resgate_metodo = metodo
    denuncia.resgate_destino = destino
    denuncia.recompensa_status = 'resgate_solicitado'
    db.session.commit()
    return jsonify(denuncia.to_public_dict())


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


@denuncia_bp.route('/analise/denuncias/<int:denuncia_id>/recompensa', methods=['POST'])
@exige_analista
def analise_liberar_recompensa(denuncia_id):
    """Libera recompensa: só para crime grave com resultado confirmado."""
    denuncia = db.get_or_404(Denuncia, denuncia_id)
    if not denuncia.grave:
        return jsonify({'error': 'Recompensa disponível apenas para crimes graves'}), 400
    if denuncia.status != 'resultado_confirmado':
        return jsonify({'error': "A denúncia precisa estar com status 'resultado_confirmado'"}), 400
    if denuncia.recompensa_status in ('resgate_solicitado', 'paga'):
        return jsonify({'error': 'Recompensa já em resgate ou paga'}), 400

    valor = _float((request.get_json(silent=True) or {}).get('valor'), 0.01, 1_000_000)
    if valor is None:
        return jsonify({'error': 'Valor inválido'}), 400

    denuncia.recompensa_valor = valor
    denuncia.recompensa_status = 'elegivel'
    db.session.add(MensagemDenuncia(
        denuncia_id=denuncia.id, autor='equipe',
        texto='Sua denúncia ajudou a gerar um resultado. Há uma recompensa disponível para resgate.',
    ))
    db.session.commit()
    return jsonify(denuncia.to_dict())


@denuncia_bp.route('/analise/denuncias/<int:denuncia_id>/recompensa/pagar', methods=['POST'])
@exige_analista
def analise_registrar_pagamento(denuncia_id):
    """Registra o pagamento e apaga o destino (chave PIX / celular) do banco."""
    denuncia = db.get_or_404(Denuncia, denuncia_id)
    if denuncia.recompensa_status != 'resgate_solicitado':
        return jsonify({'error': 'Não há resgate pendente'}), 400

    codigo = _texto(request.get_json(silent=True) or {}, 'codigo', 200)
    if denuncia.resgate_metodo == 'vale_presente' and not codigo:
        return jsonify({'error': 'Informe o código do vale-presente para o cidadão'}), 400

    denuncia.resgate_codigo = codigo
    denuncia.resgate_destino = None
    denuncia.recompensa_status = 'paga'
    db.session.commit()
    return jsonify(denuncia.to_dict())
