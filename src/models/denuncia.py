from datetime import datetime
from src.models.user import db

# Crimes graves: apenas estes podem gerar recompensa
CATEGORIAS = {
    'homicidio': {'nome': 'Homicídio', 'grave': True},
    'latrocinio': {'nome': 'Latrocínio', 'grave': True},
    'trafico_drogas': {'nome': 'Tráfico de drogas', 'grave': True},
    'trafico_armas': {'nome': 'Tráfico de armas', 'grave': True},
    'sequestro': {'nome': 'Sequestro / cárcere privado', 'grave': True},
    'estupro': {'nome': 'Estupro / abuso sexual', 'grave': True},
    'abuso_infantil': {'nome': 'Abuso / exploração infantil', 'grave': True},
    'roubo_armado': {'nome': 'Roubo à mão armada', 'grave': True},
    'organizacao_criminosa': {'nome': 'Organização criminosa / facção', 'grave': True},
    'foragido': {'nome': 'Paradeiro de foragido', 'grave': True},
    'violencia_domestica': {'nome': 'Violência doméstica', 'grave': False},
    'furto': {'nome': 'Furto', 'grave': False},
    'receptacao': {'nome': 'Receptação', 'grave': False},
    'outros': {'nome': 'Outros', 'grave': False},
}

FACCIONADO = ('sim', 'nao', 'nao_sei')

# Fluxo de análise
STATUS = (
    'recebida',       # acabou de chegar
    'em_analise',     # equipe verificando
    'com_indicios',   # há elementos que justificam encaminhar
    'sem_indicios',   # descartada (sem elementos mínimos / possível falsa)
    'encaminhada',    # repassada às autoridades
    'resultado_confirmado',  # prisão/operação confirmada por fonte pública
    'arquivada',
)

STATUS_RECOMPENSA = (
    'nao_elegivel',
    'elegivel',          # equipe aprovou um valor; cidadão pode resgatar
    'resgate_solicitado',
    'paga',
)

METODOS_RESGATE = ('pix', 'vale_presente', 'recarga_celular')


class Denuncia(db.Model):
    __tablename__ = 'denuncias'

    id = db.Column(db.Integer, primary_key=True)
    protocolo = db.Column(db.String(24), unique=True, nullable=False, index=True)
    chave_hash = db.Column(db.String(200), nullable=False)

    categoria = db.Column(db.String(40), nullable=False)
    descricao = db.Column(db.Text, nullable=False)
    data_ocorrencia = db.Column(db.String(40))  # texto livre: "ontem à noite", "toda sexta"...

    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    referencia_local = db.Column(db.String(300))  # "perto da praça", "casa azul"...
    cidade = db.Column(db.String(100))
    uf = db.Column(db.String(2))

    suspeito_nome = db.Column(db.String(150))
    suspeito_apelidos = db.Column(db.String(300))
    suspeito_caracteristicas = db.Column(db.Text)
    faccionado = db.Column(db.String(10), default='nao_sei')
    faccao = db.Column(db.String(100))

    status = db.Column(db.String(30), default='recebida', nullable=False)
    parecer_analise = db.Column(db.Text)  # uso interno da equipe

    recompensa_status = db.Column(db.String(30), default='nao_elegivel', nullable=False)
    recompensa_valor = db.Column(db.Float)
    resgate_metodo = db.Column(db.String(30))
    # Destino do pagamento (chave PIX ou celular). Apagado assim que o pagamento é feito.
    resgate_destino = db.Column(db.String(150))
    # Código que o cidadão recebe ao pedir resgate (ex.: vale-presente)
    resgate_codigo = db.Column(db.String(200))

    # Sem horário exato para dificultar cruzamento com registros de operadora/rede
    criada_em = db.Column(db.Date, default=lambda: datetime.utcnow().date())

    fotos = db.relationship('FotoDenuncia', backref='denuncia', lazy=True, cascade='all, delete-orphan')
    mensagens = db.relationship('MensagemDenuncia', backref='denuncia', lazy=True,
                                cascade='all, delete-orphan', order_by='MensagemDenuncia.id')

    @property
    def grave(self):
        return CATEGORIAS.get(self.categoria, {}).get('grave', False)

    def to_public_dict(self):
        """O que o próprio denunciante vê ao acompanhar com protocolo + chave."""
        return {
            'protocolo': self.protocolo,
            'categoria': CATEGORIAS.get(self.categoria, {}).get('nome', self.categoria),
            'status': self.status,
            'criada_em': self.criada_em.isoformat() if self.criada_em else None,
            'recompensa': {
                'status': self.recompensa_status,
                'valor': self.recompensa_valor if self.recompensa_status != 'nao_elegivel' else None,
                'metodo': self.resgate_metodo,
                'codigo': self.resgate_codigo if self.recompensa_status == 'paga' else None,
            },
            'mensagens': [m.to_dict() for m in self.mensagens],
        }

    def to_dict(self):
        """Visão completa para a equipe de análise."""
        return {
            'id': self.id,
            'protocolo': self.protocolo,
            'categoria': self.categoria,
            'grave': self.grave,
            'descricao': self.descricao,
            'data_ocorrencia': self.data_ocorrencia,
            'localizacao': {
                'latitude': self.latitude,
                'longitude': self.longitude,
                'referencia': self.referencia_local,
                'cidade': self.cidade,
                'uf': self.uf,
            },
            'suspeito': {
                'nome': self.suspeito_nome,
                'apelidos': self.suspeito_apelidos,
                'caracteristicas': self.suspeito_caracteristicas,
                'faccionado': self.faccionado,
                'faccao': self.faccao,
            },
            'fotos': [f.id for f in self.fotos],
            'status': self.status,
            'parecer_analise': self.parecer_analise,
            'recompensa': {
                'status': self.recompensa_status,
                'valor': self.recompensa_valor,
                'metodo': self.resgate_metodo,
                'destino': self.resgate_destino,
            },
            'mensagens': [m.to_dict() for m in self.mensagens],
            'criada_em': self.criada_em.isoformat() if self.criada_em else None,
        }


class FotoDenuncia(db.Model):
    __tablename__ = 'fotos_denuncia'

    id = db.Column(db.Integer, primary_key=True)
    denuncia_id = db.Column(db.Integer, db.ForeignKey('denuncias.id'), nullable=False)
    arquivo = db.Column(db.String(100), nullable=False)  # nome aleatório no disco


class MensagemDenuncia(db.Model):
    """Conversa anônima entre equipe e denunciante (pedir mais detalhes, avisar andamento)."""
    __tablename__ = 'mensagens_denuncia'

    id = db.Column(db.Integer, primary_key=True)
    denuncia_id = db.Column(db.Integer, db.ForeignKey('denuncias.id'), nullable=False)
    autor = db.Column(db.String(12), nullable=False)  # 'cidadao' ou 'equipe'
    texto = db.Column(db.Text, nullable=False)
    criada_em = db.Column(db.Date, default=lambda: datetime.utcnow().date())

    def to_dict(self):
        return {
            'autor': self.autor,
            'texto': self.texto,
            'data': self.criada_em.isoformat() if self.criada_em else None,
        }
