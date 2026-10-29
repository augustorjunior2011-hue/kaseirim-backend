import re
from datetime import datetime, timedelta

from flask import Blueprint, request, jsonify

from src.models.user import db
from src.models.emprego import Vaga, TIPOS
from src.utils.anonimato import gerar_codigo, hash_chave, conferir_chave, exige_analista

emprego_bp = Blueprint('emprego', __name__)

CAMPOS_EDITAVEIS = ('titulo', 'descricao', 'empresa', 'cidade', 'uf', 'salario', 'telefone_contato')


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


@emprego_bp.route('/empregos', methods=['GET'])
def listar_vagas():
    agora = datetime.utcnow()
    query = Vaga.query.filter(Vaga.ativa.is_(True), Vaga.expira_em > agora)

    if request.args.get('tipo') in TIPOS:
        query = query.filter_by(tipo=request.args['tipo'])
    if request.args.get('uf'):
        query = query.filter_by(uf=request.args['uf'].upper())
    if request.args.get('cidade'):
        query = query.filter(Vaga.cidade.ilike(f"%{request.args['cidade']}%"))
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


@emprego_bp.route('/empregos/<int:vaga_id>', methods=['GET'])
def detalhe_vaga(vaga_id):
    return jsonify(db.get_or_404(Vaga, vaga_id).to_dict())


@emprego_bp.route('/empregos', methods=['POST'])
def criar_vaga():
    dados = request.get_json(silent=True) or {}
    erros = _validar(dados)
    if erros:
        return jsonify({'error': '; '.join(erros)}), 400

    codigo = gerar_codigo('VG')
    vaga = Vaga(
        tipo=dados['tipo'],
        titulo=dados['titulo'].strip()[:150],
        descricao=dados['descricao'].strip()[:5000],
        empresa=(dados.get('empresa') or '').strip()[:150] or None,
        cidade=dados['cidade'].strip()[:100],
        uf=dados['uf'].strip().upper()[:2],
        salario=(dados.get('salario') or '').strip()[:60] or None,
        telefone_contato=re.sub(r'\D', '', dados['telefone_contato']),
        codigo_gestao_hash=hash_chave(codigo),
    )
    db.session.add(vaga)
    db.session.commit()
    return jsonify({
        'message': 'Anúncio publicado. Guarde o código de gestão para editar ou remover o anúncio.',
        'vaga': vaga.to_dict(),
        'codigo_gestao': codigo,
    }), 201


@emprego_bp.route('/empregos/<int:vaga_id>', methods=['PUT'])
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
            setattr(vaga, campo, valor or None)
    db.session.commit()
    return jsonify(vaga.to_dict())


@emprego_bp.route('/empregos/<int:vaga_id>', methods=['DELETE'])
def remover_vaga(vaga_id):
    vaga = _vaga_autorizada(vaga_id, request.get_json(silent=True) or {})
    if not vaga:
        return jsonify({'error': 'Código de gestão inválido'}), 403
    vaga.ativa = False
    db.session.commit()
    return '', 204


@emprego_bp.route('/analise/empregos/<int:vaga_id>/destaque', methods=['POST'])
@exige_analista
def ativar_destaque(vaga_id):
    """Ativa o destaque pago de um anúncio (chamar após confirmar o pagamento)."""
    vaga = db.get_or_404(Vaga, vaga_id)
    dias = (request.get_json(silent=True) or {}).get('dias', 7)
    if not isinstance(dias, int) or not 1 <= dias <= 90:
        return jsonify({'error': 'Dias deve ser um inteiro entre 1 e 90'}), 400
    inicio = max(vaga.destaque_ate or datetime.utcnow(), datetime.utcnow())
    vaga.destaque = True
    vaga.destaque_ate = inicio + timedelta(days=dias)
    db.session.commit()
    return jsonify(vaga.to_dict())


@emprego_bp.route('/analise/empregos/<int:vaga_id>', methods=['DELETE'])
@exige_analista
def moderar_vaga(vaga_id):
    """Remove anúncio abusivo / golpe."""
    vaga = db.get_or_404(Vaga, vaga_id)
    vaga.ativa = False
    db.session.commit()
    return '', 204
