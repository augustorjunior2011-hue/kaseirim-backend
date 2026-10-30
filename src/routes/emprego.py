import re
import os
from datetime import datetime, timedelta
from decimal import Decimal

from flask import Blueprint, request, jsonify

from src.models.db import db
from src.models.emprego import (
    Vaga, DenunciaVaga, PagamentoDestaque, TIPOS, STATUS, DENUNCIAS_PARA_OCULTAR,
    normalizar_cidade, palavras_suspeitas,
)
from src.utils import mercadopago
from src.utils.anonimato import gerar_codigo, hash_chave, conferir_chave, exige_analista
from src.utils.limite import limitar

emprego_bp = Blueprint('emprego', __name__)

CAMPOS_EDITAVEIS = ('titulo', 'descricao', 'empresa', 'cidade', 'uf', 'salario', 'telefone_contato')
MAX_ANUNCIOS_POR_TELEFONE = 3
MOTIVOS_DENUNCIA = ('golpe', 'cobra_taxa', 'conteudo_ofensivo', 'vaga_inexistente', 'outro')

# Planos de destaque (dias -> preço). Preços configuráveis por variável de ambiente.
PLANOS_DESTAQUE = {
    7: Decimal(os.environ.get('PRECO_DESTAQUE_7_DIAS', '9.90')),
    30: Decimal(os.environ.get('PRECO_DESTAQUE_30_DIAS', '29.90')),
}
MINUTOS_PARA_PAGAR = 30


def _validar(dados, parcial=False):
    erros = []
    if not parcial or 'tipo' in dados:
        if dados.get('tipo') not in TIPOS:
            erros.append("Tipo deve ser 'oferta' ou 'procura'")
    for campo in ('titulo', 'descricao', 'cidade', 'uf', 'telefone_contato'):
        if (not parcial or campo in dados) and not (dados.get(campo) or '').strip():
            erros.append(f'Campo {campo} é obrigatório')
    if dados.get('telefone_contato'):
        telefone = re.sub(r'\D', '', dados['telefone_contato'])
        if len(telefone) not in (10, 11):
            erros.append('Telefone deve ter DDD + número')
    return erros


def _vaga_autorizada(vaga_id, dados):
    vaga = db.get_or_404(Vaga, vaga_id)
    if not conferir_chave(dados.get('codigo_gestao'), vaga.codigo_gestao_hash):
        return None
    return vaga


def _visiveis():
    """Anúncios que aparecem no site: aprovados, ativos e dentro da validade."""
    return Vaga.query.filter(Vaga.ativa.is_(True), Vaga.status == 'aprovada', Vaga.expira_em > datetime.utcnow())


def _moderar(vaga):
    """Decide se o anúncio vai direto para o ar ou para a fila da equipe."""
    suspeitas = palavras_suspeitas(vaga.titulo, vaga.descricao, vaga.empresa, vaga.salario)
    if suspeitas:
        vaga.status = 'pendente'
        vaga.motivo_moderacao = 'Palavras suspeitas: ' + ', '.join(suspeitas)
    elif vaga.tipo == 'oferta':
        vaga.status = 'pendente'
        vaga.motivo_moderacao = 'Vaga de empresa aguardando aprovação'
    else:
        vaga.publicar()


@emprego_bp.route('/empregos', methods=['GET'])
def listar_vagas():
    agora = datetime.utcnow()
    query = _visiveis()

    if request.args.get('tipo') in TIPOS:
        query = query.filter_by(tipo=request.args['tipo'])
    if request.args.get('uf'):
        query = query.filter_by(uf=request.args['uf'].upper())
    if request.args.get('cidade'):
        query = query.filter_by(cidade=normalizar_cidade(request.args['cidade']))
    if request.args.get('busca'):
        termo = f"%{request.args['busca']}%"
        query = query.filter(db.or_(Vaga.titulo.ilike(termo), Vaga.descricao.ilike(termo)))

    destaque_valido = db.and_(Vaga.destaque.is_(True),
                              db.or_(Vaga.destaque_ate.is_(None), Vaga.destaque_ate > agora))
    query = query.order_by(db.case((destaque_valido, 0), else_=1), Vaga.criada_em.desc())

    page = request.args.get('page', 1, type=int)
    per_page = min(request.args.get('per_page', 20, type=int), 100)
    resultado = query.paginate(page=page, per_page=per_page, error_out=False)
    return jsonify({
        'vagas': [v.to_dict() for v in resultado.items],
        'total': resultado.total,
        'pages': resultado.pages,
        'current_page': page,
    })


@emprego_bp.route('/empregos/cidades', methods=['GET'])
def listar_cidades():
    """Cidades que têm anúncios no ar, para o filtro do site."""
    query = _visiveis()
    if request.args.get('uf'):
        query = query.filter_by(uf=request.args['uf'].upper())
    linhas = (query.with_entities(Vaga.cidade, Vaga.uf, db.func.count(Vaga.id))
              .group_by(Vaga.cidade, Vaga.uf).order_by(Vaga.uf, Vaga.cidade).all())
    return jsonify([{'cidade': cidade, 'uf': uf, 'total': total} for cidade, uf, total in linhas])


@emprego_bp.route('/empregos/<int:vaga_id>', methods=['GET'])
def detalhe_vaga(vaga_id):
    vaga = _visiveis().filter_by(id=vaga_id).first_or_404()
    return jsonify(vaga.to_dict())


@emprego_bp.route('/empregos', methods=['POST'])
@limitar('vaga_criar', 10, 3600)
def criar_vaga():
    dados = request.get_json(silent=True) or {}
    erros = _validar(dados)
    if erros:
        return jsonify({'error': '; '.join(erros)}), 400

    telefone = re.sub(r'\D', '', dados['telefone_contato'])
    ativos = Vaga.query.filter(
        Vaga.telefone_contato == telefone, Vaga.ativa.is_(True),
        Vaga.status.in_(('pendente', 'aprovada')), Vaga.expira_em > datetime.utcnow(),
    ).count()
    if ativos >= MAX_ANUNCIOS_POR_TELEFONE:
        return jsonify({'error': f'Limite de {MAX_ANUNCIOS_POR_TELEFONE} anúncios ativos por telefone. '
                                 'Remova um anúncio antigo para publicar outro.'}), 429

    codigo = gerar_codigo('VG')
    vaga = Vaga(
        tipo=dados['tipo'],
        titulo=dados['titulo'].strip()[:150],
        descricao=dados['descricao'].strip()[:5000],
        empresa=(dados.get('empresa') or '').strip()[:150] or None,
        cidade=normalizar_cidade(dados['cidade'])[:100],
        uf=dados['uf'].strip().upper()[:2],
        salario=(dados.get('salario') or '').strip()[:60] or None,
        telefone_contato=telefone,
        codigo_gestao_hash=hash_chave(codigo),
    )
    _moderar(vaga)
    db.session.add(vaga)
    db.session.commit()

    if vaga.status == 'aprovada':
        mensagem = 'Anúncio publicado. Guarde o código de gestão para remover o anúncio.'
    else:
        mensagem = ('Anúncio recebido. Ele vai para o ar depois que nossa equipe aprovar. '
                    'Guarde o código de gestão para remover o anúncio.')
    return jsonify({
        'message': mensagem,
        'status': vaga.status,
        'vaga': vaga.to_dict(),
        'codigo_gestao': codigo,
    }), 201


@emprego_bp.route('/empregos/<int:vaga_id>', methods=['PUT'])
@limitar('vaga_gestao', 30, 600)
def editar_vaga(vaga_id):
    dados = request.get_json(silent=True) or {}
    vaga = _vaga_autorizada(vaga_id, dados)
    if not vaga:
        return jsonify({'error': 'Código de gestão inválido'}), 403

    erros = _validar(dados, parcial=True)
    if erros:
        return jsonify({'error': '; '.join(erros)}), 400

    for campo in CAMPOS_EDITAVEIS:
        if campo in dados:
            valor = (dados[campo] or '').strip()
            if campo == 'telefone_contato':
                valor = re.sub(r'\D', '', valor)
            elif campo == 'uf':
                valor = valor.upper()
            elif campo == 'cidade':
                valor = normalizar_cidade(valor)
            setattr(vaga, campo, valor or None)

    # Anúncio editado passa pela moderação de novo (evita trocar o texto depois de aprovado)
    if vaga.status != 'rejeitada':
        _moderar(vaga)
    db.session.commit()
    return jsonify({**vaga.to_dict(), 'status': vaga.status})


@emprego_bp.route('/empregos/<int:vaga_id>', methods=['DELETE'])
@limitar('vaga_gestao', 30, 600)
def remover_vaga(vaga_id):
    vaga = _vaga_autorizada(vaga_id, request.get_json(silent=True) or {})
    if not vaga:
        return jsonify({'error': 'Código de gestão inválido'}), 403
    vaga.ativa = False
    db.session.commit()
    return '', 204


@emprego_bp.route('/empregos/<int:vaga_id>/denunciar', methods=['POST'])
@limitar('vaga_denunciar', 20, 3600)
def denunciar_vaga(vaga_id):
    """Qualquer pessoa marca um anúncio como golpe/abusivo. Muitas denúncias tiram o anúncio do ar."""
    vaga = _visiveis().filter_by(id=vaga_id).first_or_404()
    dados = request.get_json(silent=True) or {}
    motivo = dados.get('motivo')
    if motivo not in MOTIVOS_DENUNCIA:
        return jsonify({'error': f"Motivo deve ser um de: {', '.join(MOTIVOS_DENUNCIA)}"}), 400

    db.session.add(DenunciaVaga(vaga_id=vaga.id, motivo=motivo,
                                detalhe=(dados.get('detalhe') or '').strip()[:500] or None))
    vaga.denuncias_pendentes = (vaga.denuncias_pendentes or 0) + 1
    if vaga.denuncias_pendentes >= DENUNCIAS_PARA_OCULTAR:
        vaga.status = 'pendente'
        vaga.motivo_moderacao = f'Recebeu {vaga.denuncias_pendentes} denúncias de usuários'
    db.session.commit()
    return jsonify({'message': 'Obrigado. Nossa equipe vai verificar este anúncio.'}), 201


@emprego_bp.route('/empregos/<int:vaga_id>/gestao', methods=['POST'])
@limitar('vaga_gestao', 30, 600)
def ver_meu_anuncio(vaga_id):
    """Quem tem o código de gestão vê o próprio anúncio, inclusive se ainda está em aprovação."""
    vaga = _vaga_autorizada(vaga_id, request.get_json(silent=True) or {})
    if not vaga or not vaga.ativa:
        return jsonify({'error': 'Número ou código de gestão inválido'}), 403
    no_ar = vaga.status == 'aprovada' and vaga.expira_em > datetime.utcnow()
    return jsonify({
        **vaga.to_dict(),
        'status': vaga.status,
        'no_ar': no_ar,
        'motivo_rejeicao': vaga.motivo_moderacao if vaga.status == 'rejeitada' else None,
    })


# ---------------------------------------------------------------------------
# Destaque pago por PIX (Mercado Pago)
# ---------------------------------------------------------------------------

@emprego_bp.route('/empregos/destaque/planos', methods=['GET'])
def planos_destaque():
    return jsonify({
        'disponivel': mercadopago.configurado(),
        'planos': [{'dias': d, 'valor': float(v)} for d, v in PLANOS_DESTAQUE.items()],
    })


@emprego_bp.route('/empregos/<int:vaga_id>/destaque', methods=['POST'])
@limitar('destaque_criar', 10, 3600)
def comprar_destaque(vaga_id):
    dados = request.get_json(silent=True) or {}
    vaga = _vaga_autorizada(vaga_id, dados)
    if not vaga or not vaga.ativa:
        return jsonify({'error': 'Número ou código de gestão inválido'}), 403
    if vaga.status != 'aprovada':
        return jsonify({'error': 'O anúncio precisa estar aprovado e no ar para ser destacado'}), 400
    if not mercadopago.configurado():
        return jsonify({'error': 'Pagamento por PIX ainda não está disponível'}), 503

    dias = dados.get('dias')
    if dias not in PLANOS_DESTAQUE:
        return jsonify({'error': 'Plano inválido'}), 400

    pagamento = PagamentoDestaque(
        vaga_id=vaga.id, dias=dias, valor=PLANOS_DESTAQUE[dias],
        expira_em=datetime.utcnow() + timedelta(minutes=MINUTOS_PARA_PAGAR),
    )
    db.session.add(pagamento)
    db.session.flush()

    url_aviso = os.environ.get('URL_PUBLICA')
    try:
        mp = mercadopago.criar_pix(
            valor=pagamento.valor,
            descricao=f'Destaque de {dias} dias - anúncio {vaga.id}',
            referencia=pagamento.referencia,
            expira_em=pagamento.expira_em,
            notification_url=f'{url_aviso.rstrip("/")}/api/pagamentos/mercadopago' if url_aviso else None,
        )
    except mercadopago.ErroPagamento:
        db.session.rollback()
        return jsonify({'error': 'Não foi possível gerar o PIX agora. Tente de novo em instantes.'}), 502

    dados_pix = (mp.get('point_of_interaction') or {}).get('transaction_data') or {}
    pagamento.mp_id = str(mp['id'])
    pagamento.qr_code = dados_pix.get('qr_code')
    pagamento.qr_code_base64 = dados_pix.get('qr_code_base64')
    db.session.commit()
    return jsonify(pagamento.to_dict(com_qr=True)), 201


def _aplicar_se_pago(pagamento):
    """Consulta o Mercado Pago e, se o PIX foi pago, soma os dias de destaque (uma única vez)."""
    if pagamento.aplicado or not pagamento.mp_id:
        return
    mp = mercadopago.consultar(pagamento.mp_id)
    status = mp.get('status')
    if status in ('cancelled', 'rejected', 'refunded', 'charged_back'):
        pagamento.status = 'cancelado'
        db.session.commit()
        return
    pago = (status == 'approved'
            and mp.get('external_reference') == pagamento.referencia
            and Decimal(str(mp.get('transaction_amount', 0))) >= pagamento.valor)
    if not pago:
        return

    # UPDATE condicional: se o aviso do Mercado Pago e a consulta do site chegarem juntos,
    # só um deles aplica o destaque
    marcado = PagamentoDestaque.query.filter_by(id=pagamento.id, aplicado=False) \
        .update({'aplicado': True, 'status': 'aprovado'})
    if marcado:
        pagamento.vaga.estender_destaque(pagamento.dias)
    db.session.commit()
    db.session.refresh(pagamento)


@emprego_bp.route('/empregos/destaque/<int:pagamento_id>/status', methods=['POST'])
@limitar('destaque_status', 120, 600)
def status_destaque(pagamento_id):
    """O site pergunta de tempos em tempos se o PIX já foi pago."""
    pagamento = db.get_or_404(PagamentoDestaque, pagamento_id)
    dados = request.get_json(silent=True) or {}
    if not conferir_chave(dados.get('codigo_gestao'), pagamento.vaga.codigo_gestao_hash):
        return jsonify({'error': 'Código de gestão inválido'}), 403
    if pagamento.status == 'pendente':
        try:
            _aplicar_se_pago(pagamento)
        except mercadopago.ErroPagamento:
            pass  # tenta de novo na próxima consulta
    return jsonify(pagamento.to_dict())


@emprego_bp.route('/pagamentos/mercadopago', methods=['POST'])
@limitar('webhook_mp', 300, 60)
def aviso_mercadopago():
    """Aviso (webhook) do Mercado Pago. Não confiamos no conteúdo: consultamos o pagamento na API."""
    corpo = request.get_json(silent=True) or {}
    mp_id = str((corpo.get('data') or {}).get('id') or request.args.get('data.id') or request.args.get('id') or '')
    pagamento = PagamentoDestaque.query.filter_by(mp_id=mp_id).first() if mp_id else None
    if pagamento and pagamento.status == 'pendente':
        try:
            _aplicar_se_pago(pagamento)
        except mercadopago.ErroPagamento:
            return '', 500  # o Mercado Pago tenta avisar de novo
    return '', 200


# ---------------------------------------------------------------------------
# Moderação (equipe, protegida por ANALISTA_TOKEN)
# ---------------------------------------------------------------------------

@emprego_bp.route('/analise/empregos', methods=['GET'])
@exige_analista
def moderacao_listar():
    status = request.args.get('status', 'pendente')
    if status not in STATUS:
        return jsonify({'error': f"Status deve ser um de: {', '.join(STATUS)}"}), 400
    query = Vaga.query.filter(Vaga.ativa.is_(True), Vaga.status == status)
    if request.args.get('com_denuncias'):
        query = query.filter(Vaga.denuncias_pendentes > 0)
    vagas = query.order_by(Vaga.criada_em.asc()).limit(100).all()
    return jsonify([v.to_moderacao_dict() for v in vagas])


@emprego_bp.route('/analise/empregos/<int:vaga_id>/aprovar', methods=['POST'])
@exige_analista
def moderacao_aprovar(vaga_id):
    vaga = db.get_or_404(Vaga, vaga_id)
    vaga.publicar()
    db.session.commit()
    return jsonify(vaga.to_moderacao_dict())


@emprego_bp.route('/analise/empregos/<int:vaga_id>/rejeitar', methods=['POST'])
@exige_analista
def moderacao_rejeitar(vaga_id):
    vaga = db.get_or_404(Vaga, vaga_id)
    vaga.status = 'rejeitada'
    vaga.motivo_moderacao = ((request.get_json(silent=True) or {}).get('motivo') or '').strip()[:300] or None
    db.session.commit()
    return jsonify(vaga.to_moderacao_dict())


@emprego_bp.route('/analise/empregos/<int:vaga_id>/destaque', methods=['POST'])
@exige_analista
def ativar_destaque(vaga_id):
    """Ativa o destaque pago de um anúncio (chamar após confirmar o pagamento)."""
    vaga = db.get_or_404(Vaga, vaga_id)
    dias = (request.get_json(silent=True) or {}).get('dias', 7)
    if not isinstance(dias, int) or not 1 <= dias <= 90:
        return jsonify({'error': 'Dias deve ser um inteiro entre 1 e 90'}), 400
    vaga.estender_destaque(dias)
    db.session.commit()
    return jsonify(vaga.to_moderacao_dict())


@emprego_bp.route('/analise/empregos/<int:vaga_id>', methods=['DELETE'])
@exige_analista
def moderar_vaga(vaga_id):
    """Remove anúncio abusivo / golpe."""
    vaga = db.get_or_404(Vaga, vaga_id)
    vaga.ativa = False
    db.session.commit()
    return '', 204
