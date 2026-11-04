import hashlib
import secrets
from datetime import datetime, timedelta
from functools import wraps

from flask import request, jsonify, g

from src.models.db import db
from src.models.equipe import SessaoEquipe, RegistroAcesso
from src.utils.limite import bloqueado, registrar

HORAS_SESSAO = 8


def hash_token(token):
    return hashlib.sha256(token.encode()).hexdigest()


def criar_sessao(analista):
    """Abre uma sessão de 8 horas. O token só existe no navegador; o banco guarda o hash."""
    token = secrets.token_urlsafe(32)
    db.session.add(SessaoEquipe(token_hash=hash_token(token), analista_id=analista.id,
                                expira_em=datetime.utcnow() + timedelta(hours=HORAS_SESSAO)))
    analista.ultimo_acesso = datetime.utcnow()
    db.session.commit()
    return token


def registrar_acesso(acao, alvo=None, analista=None):
    """Grava no registro de acessos quem da equipe fez o quê (não faz commit)."""
    analista = analista or g.get('analista')
    db.session.add(RegistroAcesso(
        analista_id=analista.id if analista else None,
        analista_nome=analista.nome if analista else None,
        acao=acao, alvo=str(alvo)[:120] if alvo is not None else None,
    ))


def exige_analista(f):
    """Protege as rotas da equipe: exige uma sessão válida de uma conta ativa."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        # Depois de 10 tentativas inválidas em 15 minutos, o visitante fica bloqueado por um tempo
        bloqueio = bloqueado('analista_falha', 10, 900)
        if bloqueio:
            return bloqueio
        token = request.headers.get('Authorization', '').removeprefix('Bearer ').strip()
        sessao = SessaoEquipe.query.filter_by(token_hash=hash_token(token)).first() if token else None
        if not sessao or sessao.expira_em < datetime.utcnow() or not sessao.analista.ativo:
            registrar('analista_falha')
            return jsonify({'error': 'Sua sessão expirou ou não é válida. Entre de novo.'}), 401
        g.analista = sessao.analista
        g.sessao = sessao
        return f(*args, **kwargs)
    return wrapper
