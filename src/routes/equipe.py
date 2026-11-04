import hashlib
import hmac
import os
from datetime import datetime, timedelta

import segno
from flask import Blueprint, request, jsonify, g
from werkzeug.security import generate_password_hash, check_password_hash

from src.models.db import db
from src.models.equipe import Analista, ConviteEquipe, SessaoEquipe, RegistroAcesso
from src.utils import totp
from src.utils.anonimato import gerar_codigo, normalizar
from src.utils.equipe import criar_sessao, exige_analista, registrar_acesso
from src.utils.limite import bloqueado, registrar

equipe_bp = Blueprint('equipe', __name__)

EMISSOR = os.environ.get('PAINEL_NOME', 'Vagai Equipe')  # nome que aparece no aplicativo autenticador
SENHA_MINIMA = 10
HORAS_CONVITE = 24
# Hash usado quando o nome não existe, para o login demorar o mesmo tempo e não revelar quais nomes existem
_HASH_FALSO = generate_password_hash('senha-que-nao-existe')


def _hash_convite(codigo):
    return hashlib.sha256(normalizar(codigo).encode()).hexdigest()


def _tem_conta_ativa():
    return Analista.query.filter(Analista.ativo.is_(True), Analista.confirmado_em.isnot(None)).count() > 0


@equipe_bp.route('/equipe/estado', methods=['GET'])
def estado():
    """Diz ao painel se já existe alguma conta (senão mostra o primeiro acesso)."""
    return jsonify({'tem_contas': _tem_conta_ativa()})


@equipe_bp.route('/equipe/cadastro', methods=['POST'])
def cadastro():
    """Passo 1: com um convite (ou a chave de instalação, só para a primeira conta), escolhe nome e senha
    e recebe o QR code para o aplicativo autenticador."""
    bloqueio = bloqueado('equipe_cadastro', 10, 900)
    if bloqueio:
        return bloqueio
    dados = request.get_json(silent=True) or {}
    convite_texto = (dados.get('convite') or '').strip()
    nome = ' '.join((dados.get('nome') or '').split())[:40]
    senha = dados.get('senha') or ''

    convite = None
    chave_instalacao = os.environ.get('ANALISTA_TOKEN')
    if not _tem_conta_ativa() and chave_instalacao and hmac.compare_digest(convite_texto, chave_instalacao):
        pass  # primeira conta, criada com a chave de instalação
    else:
        convite = ConviteEquipe.query.filter_by(codigo_hash=_hash_convite(convite_texto)).first()
        if not convite or convite.usado_em or convite.expira_em < datetime.utcnow():
            registrar('equipe_cadastro')
            return jsonify({'error': 'Convite inválido, expirado ou já usado'}), 403

    if len(nome) < 2:
        return jsonify({'error': 'Escolha um nome com pelo menos 2 letras'}), 400
    if len(senha) < SENHA_MINIMA:
        return jsonify({'error': f'A senha precisa ter pelo menos {SENHA_MINIMA} caracteres'}), 400

    existente = Analista.query.filter(db.func.lower(Analista.nome) == nome.lower()).first()
    if existente and existente.confirmado_em:
        return jsonify({'error': 'Já existe alguém da equipe com esse nome'}), 409
    if existente:
        db.session.delete(existente)  # cadastro anterior que não chegou a ser confirmado
        db.session.flush()

    segredo = totp.gerar_segredo()
    analista = Analista(nome=nome, senha_hash=generate_password_hash(senha), totp_segredo=segredo, ativo=False)
    db.session.add(analista)
    if convite:
        convite.usado_em = datetime.utcnow()
    db.session.commit()

    link = totp.link_app(segredo, nome, EMISSOR)
    return jsonify({
        'cadastro_id': analista.id,
        'segredo': segredo,
        'link': link,
        'qr_svg': segno.make(link, error='m').svg_data_uri(scale=5, border=2),
    }), 201


@equipe_bp.route('/equipe/cadastro/confirmar', methods=['POST'])
def confirmar_cadastro():
    """Passo 2: digita o código do aplicativo para provar que o celular está configurado."""
    bloqueio = bloqueado('equipe_cadastro', 10, 900)
    if bloqueio:
        return bloqueio
    dados = request.get_json(silent=True) or {}
    analista = db.session.get(Analista, dados.get('cadastro_id') or 0)
    if not analista or analista.confirmado_em:
        return jsonify({'error': 'Cadastro não encontrado. Comece de novo.'}), 404
    contador = totp.verificar(analista.totp_segredo, dados.get('codigo'))
    if contador is None:
        registrar('equipe_cadastro')
        return jsonify({'error': 'Código incorreto. Confira o aplicativo e tente de novo.'}), 400
    analista.totp_ultimo = contador
    analista.ativo = True
    analista.confirmado_em = datetime.utcnow()
    registrar_acesso('conta_criada', analista.nome, analista=analista)
    db.session.commit()
    return jsonify({'message': 'Conta criada. Agora é só entrar.', 'nome': analista.nome})


@equipe_bp.route('/equipe/entrar', methods=['POST'])
def entrar():
    bloqueio = bloqueado('equipe_login', 10, 900)
    if bloqueio:
        return bloqueio
    dados = request.get_json(silent=True) or {}
    nome = ' '.join((dados.get('nome') or '').split())
    analista = Analista.query.filter(db.func.lower(Analista.nome) == nome.lower()).first() if nome else None

    senha_ok = check_password_hash(analista.senha_hash if analista else _HASH_FALSO, dados.get('senha') or '')
    contador = None
    if analista and senha_ok and analista.ativo:
        contador = totp.verificar(analista.totp_segredo, dados.get('codigo'), analista.totp_ultimo)
    if contador is None:
        registrar('equipe_login')
        return jsonify({'error': 'Nome, senha ou código incorretos'}), 401

    analista.totp_ultimo = contador
    registrar_acesso('entrou', None, analista=analista)
    token = criar_sessao(analista)
    return jsonify({'token': token, 'nome': analista.nome})


@equipe_bp.route('/equipe/sair', methods=['POST'])
@exige_analista
def sair():
    registrar_acesso('saiu')
    db.session.delete(g.sessao)
    db.session.commit()
    return '', 204


@equipe_bp.route('/equipe/eu', methods=['GET'])
@exige_analista
def eu():
    return jsonify(g.analista.to_dict())


@equipe_bp.route('/equipe/contas', methods=['GET'])
@exige_analista
def contas():
    lista = Analista.query.filter(Analista.confirmado_em.isnot(None)).order_by(Analista.nome).all()
    return jsonify([{**a.to_dict(), 'sou_eu': a.id == g.analista.id} for a in lista])


@equipe_bp.route('/equipe/convites', methods=['POST'])
@exige_analista
def criar_convite():
    """Gera um código de uso único (vale 24 h) para mais uma pessoa entrar na equipe."""
    codigo = gerar_codigo('CV')
    db.session.add(ConviteEquipe(codigo_hash=_hash_convite(codigo), criado_por_id=g.analista.id,
                                 expira_em=datetime.utcnow() + timedelta(hours=HORAS_CONVITE)))
    registrar_acesso('convite_criado')
    db.session.commit()
    return jsonify({'convite': codigo, 'validade_horas': HORAS_CONVITE}), 201


@equipe_bp.route('/equipe/contas/<int:analista_id>/desativar', methods=['POST'])
@exige_analista
def desativar(analista_id):
    analista = db.get_or_404(Analista, analista_id)
    ativos = Analista.query.filter(Analista.ativo.is_(True), Analista.confirmado_em.isnot(None)).count()
    if analista.ativo and ativos <= 1:
        return jsonify({'error': 'Não dá para desativar a última conta ativa'}), 400
    analista.ativo = False
    SessaoEquipe.query.filter_by(analista_id=analista.id).delete()
    registrar_acesso('conta_desativada', analista.nome)
    db.session.commit()
    return jsonify(analista.to_dict())


@equipe_bp.route('/equipe/registro', methods=['GET'])
@exige_analista
def registro():
    """Últimas 200 ações da equipe."""
    itens = RegistroAcesso.query.order_by(RegistroAcesso.id.desc()).limit(200).all()
    return jsonify([r.to_dict() for r in itens])
