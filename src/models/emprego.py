from datetime import datetime, timedelta
from src.models.db import db

TIPOS = ('oferta', 'procura')
DIAS_VALIDADE = 30


class Vaga(db.Model):
    __tablename__ = 'vagas'

    id = db.Column(db.Integer, primary_key=True)
    tipo = db.Column(db.String(10), nullable=False)  # oferta (empresa) / procura (candidato)
    titulo = db.Column(db.String(150), nullable=False)
    descricao = db.Column(db.Text, nullable=False)
    empresa = db.Column(db.String(150))
    cidade = db.Column(db.String(100), nullable=False)
    uf = db.Column(db.String(2), nullable=False)
    salario = db.Column(db.String(60))
    telefone_contato = db.Column(db.String(20), nullable=False)

    # Monetização: anúncios em destaque aparecem primeiro (ativado após pagamento)
    destaque = db.Column(db.Boolean, default=False)
    destaque_ate = db.Column(db.DateTime)

    # Quem publicou edita/remove com este código (não há cadastro)
    codigo_gestao_hash = db.Column(db.String(200), nullable=False)

    ativa = db.Column(db.Boolean, default=True)
    criada_em = db.Column(db.DateTime, default=datetime.utcnow)
    expira_em = db.Column(db.DateTime, default=lambda: datetime.utcnow() + timedelta(days=DIAS_VALIDADE))

    @property
    def em_destaque(self):
        return bool(self.destaque and (self.destaque_ate is None or self.destaque_ate > datetime.utcnow()))

    def to_dict(self):
        return {
            'id': self.id,
            'tipo': self.tipo,
            'titulo': self.titulo,
            'descricao': self.descricao,
            'empresa': self.empresa,
            'cidade': self.cidade,
            'uf': self.uf,
            'salario': self.salario,
            'telefone_contato': self.telefone_contato,
            'destaque': self.em_destaque,
            'criada_em': self.criada_em.isoformat() if self.criada_em else None,
            'expira_em': self.expira_em.isoformat() if self.expira_em else None,
        }
