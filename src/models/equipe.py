from datetime import datetime
from src.models.db import db
from src.utils.cripto import TextoCifrado


class Analista(db.Model):
    """Pessoa da equipe. Entra com nome + senha + código do celular."""
    __tablename__ = 'analistas'

    id = db.Column(db.Integer, primary_key=True)
    nome = db.Column(db.String(60), unique=True, nullable=False)
    senha_hash = db.Column(db.String(200), nullable=False)
    totp_segredo = db.Column(TextoCifrado, nullable=False)
    totp_ultimo = db.Column(db.Integer)  # último código usado (impede reutilizar o mesmo código)
    ativo = db.Column(db.Boolean, default=False, nullable=False)  # só fica ativo depois de confirmar o celular
    confirmado_em = db.Column(db.DateTime)  # quando confirmou o código do celular pela primeira vez
    criado_em = db.Column(db.DateTime, default=datetime.utcnow)
    ultimo_acesso = db.Column(db.DateTime)

    def to_dict(self):
        return {
            'id': self.id,
            'nome': self.nome,
            'ativo': self.ativo,
            'criado_em': self.criado_em.isoformat() if self.criado_em else None,
            'ultimo_acesso': self.ultimo_acesso.isoformat() if self.ultimo_acesso else None,
        }


class ConviteEquipe(db.Model):
    """Código de uso único para uma nova pessoa criar a própria conta."""
    __tablename__ = 'convites_equipe'

    id = db.Column(db.Integer, primary_key=True)
    codigo_hash = db.Column(db.String(64), unique=True, nullable=False)
    criado_por_id = db.Column(db.Integer, db.ForeignKey('analistas.id'))
    criado_em = db.Column(db.DateTime, default=datetime.utcnow)
    expira_em = db.Column(db.DateTime, nullable=False)
    usado_em = db.Column(db.DateTime)


class SessaoEquipe(db.Model):
    __tablename__ = 'sessoes_equipe'

    id = db.Column(db.Integer, primary_key=True)
    token_hash = db.Column(db.String(64), unique=True, nullable=False, index=True)
    analista_id = db.Column(db.Integer, db.ForeignKey('analistas.id'), nullable=False)
    criada_em = db.Column(db.DateTime, default=datetime.utcnow)
    expira_em = db.Column(db.DateTime, nullable=False)

    analista = db.relationship('Analista')


class RegistroAcesso(db.Model):
    """Quem da equipe fez o quê e quando (abrir denúncia, ver foto, aprovar anúncio...)."""
    __tablename__ = 'registro_acessos'

    id = db.Column(db.Integer, primary_key=True)
    analista_id = db.Column(db.Integer, db.ForeignKey('analistas.id'))
    analista_nome = db.Column(db.String(60))
    acao = db.Column(db.String(40), nullable=False)
    alvo = db.Column(db.String(120))
    criado_em = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    def to_dict(self):
        return {
            'analista': self.analista_nome,
            'acao': self.acao,
            'alvo': self.alvo,
            'quando': self.criado_em.isoformat() if self.criado_em else None,
        }
