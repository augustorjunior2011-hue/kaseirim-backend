import re
import unicodedata
from datetime import datetime, timedelta
from src.models.db import db

TIPOS = ('oferta', 'procura')
DIAS_VALIDADE = 30

# Moderação: vagas de empresas (oferta) passam por aprovação; quem procura trabalho publica na hora
STATUS = ('pendente', 'aprovada', 'rejeitada')

# Anúncio que recebe este número de denúncias sai do ar e volta para a fila de moderação
DENUNCIAS_PARA_OCULTAR = 3

# Expressões típicas de golpe de vaga falsa. Anúncio com alguma delas vai para moderação.
PALAVRAS_SUSPEITAS = (
    'taxa', 'pix antecipado', 'pagamento antecipado', 'investimento', 'investir',
    'curso obrigatorio', 'kit', 'uniforme pago', 'exame pago', 'renda extra garantida',
    'ganhe dinheiro', 'trabalhe em casa e ganhe', 'piramide', 'cadastro pago',
)

PREPOSICOES = {'de', 'da', 'do', 'das', 'dos', 'e'}


def sem_acentos(texto):
    return ''.join(c for c in unicodedata.normalize('NFD', texto) if unicodedata.category(c) != 'Mn')


def normalizar_cidade(nome):
    """'  rio DE janeiro ' -> 'Rio de Janeiro' (mesma cidade sempre escrita do mesmo jeito)."""
    palavras = re.sub(r'\s+', ' ', nome or '').strip().lower().split(' ')
    return ' '.join(p if i and p in PREPOSICOES else p.capitalize() for i, p in enumerate(palavras))


def palavras_suspeitas(*textos):
    conteudo = sem_acentos(' '.join(t or '' for t in textos).lower())
    return [p for p in PALAVRAS_SUSPEITAS if re.search(rf'\b{re.escape(p)}\b', conteudo)]


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
    telefone_contato = db.Column(db.String(20), nullable=False, index=True)

    status = db.Column(db.String(12), default='pendente', nullable=False)
    motivo_moderacao = db.Column(db.String(300))  # por que foi para a fila / por que foi rejeitada
    denuncias_pendentes = db.Column(db.Integer, default=0)  # zera quando a equipe aprova de novo

    # Monetização: anúncios em destaque aparecem primeiro (ativado após pagamento)
    destaque = db.Column(db.Boolean, default=False)
    destaque_ate = db.Column(db.DateTime)

    # Quem publicou edita/remove com este código (não há cadastro)
    codigo_gestao_hash = db.Column(db.String(200), nullable=False)

    ativa = db.Column(db.Boolean, default=True)
    criada_em = db.Column(db.DateTime, default=datetime.utcnow)
    expira_em = db.Column(db.DateTime, default=lambda: datetime.utcnow() + timedelta(days=DIAS_VALIDADE))

    denuncias = db.relationship('DenunciaVaga', backref='vaga', lazy=True, cascade='all, delete-orphan',
                                order_by='DenunciaVaga.id')

    @property
    def em_destaque(self):
        return bool(self.destaque and (self.destaque_ate is None or self.destaque_ate > datetime.utcnow()))

    def publicar(self):
        self.status = 'aprovada'
        self.motivo_moderacao = None
        self.denuncias_pendentes = 0
        self.expira_em = datetime.utcnow() + timedelta(days=DIAS_VALIDADE)

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

    def to_moderacao_dict(self):
        return {
            **self.to_dict(),
            'status': self.status,
            'ativa': self.ativa,
            'motivo_moderacao': self.motivo_moderacao,
            'denuncias': [d.to_dict() for d in self.denuncias],
        }


class DenunciaVaga(db.Model):
    """Usuário marcou o anúncio como golpe / abusivo."""
    __tablename__ = 'denuncias_vaga'

    id = db.Column(db.Integer, primary_key=True)
    vaga_id = db.Column(db.Integer, db.ForeignKey('vagas.id'), nullable=False)
    motivo = db.Column(db.String(30), nullable=False)
    detalhe = db.Column(db.String(500))
    criada_em = db.Column(db.Date, default=lambda: datetime.utcnow().date())

    def to_dict(self):
        return {
            'motivo': self.motivo,
            'detalhe': self.detalhe,
            'data': self.criada_em.isoformat() if self.criada_em else None,
        }
