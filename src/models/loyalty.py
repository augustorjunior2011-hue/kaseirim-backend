from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
from src.models.user import db
import re

class Customer(db.Model):
    __tablename__ = 'customers'
    
    id = db.Column(db.Integer, primary_key=True)
    full_name = db.Column(db.String(150), nullable=False)
    cpf = db.Column(db.String(14), unique=True, nullable=False)  # CPF único como identificador
    phone = db.Column(db.String(20), nullable=False)
    email = db.Column(db.String(120), nullable=True)
    points = db.Column(db.Integer, default=0)
    total_spent = db.Column(db.Float, default=0.0)
    level = db.Column(db.String(20), default='Bronze')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_visit = db.Column(db.DateTime, default=datetime.utcnow)
    active = db.Column(db.Boolean, default=True)
    
    # Relacionamento com transações
    transactions = db.relationship('Transaction', backref='customer', lazy=True)
    
    def format_cpf(self):
        """Formata CPF para exibição (XXX.XXX.XXX-XX)"""
        cpf = re.sub(r'\D', '', self.cpf)
        if len(cpf) == 11:
            return f"{cpf[:3]}.{cpf[3:6]}.{cpf[6:9]}-{cpf[9:]}"
        return self.cpf
    
    def format_phone(self):
        """Formata telefone para exibição"""
        phone = re.sub(r'\D', '', self.phone)
        if len(phone) == 11:
            return f"({phone[:2]}) {phone[2:7]}-{phone[7:]}"
        elif len(phone) == 10:
            return f"({phone[:2]}) {phone[2:6]}-{phone[6:]}"
        return self.phone
    
    def get_level(self):
        """Calcula o nível baseado nos pontos usando configurações do sistema"""
        config = LoyaltyConfig.get_current_config()
        if self.points >= config.diamond_threshold:
            return 'Diamante'
        elif self.points >= config.gold_threshold:
            return 'Ouro'
        elif self.points >= config.silver_threshold:
            return 'Prata'
        else:
            return 'Bronze'
    
    def get_discount(self):
        """Retorna o desconto baseado no nível usando configurações do sistema"""
        config = LoyaltyConfig.get_current_config()
        level = self.get_level()
        discounts = {
            'Bronze': config.bronze_discount,
            'Prata': config.silver_discount,
            'Ouro': config.gold_discount,
            'Diamante': config.diamond_discount
        }
        return discounts.get(level, config.bronze_discount)
    
    def points_to_next_level(self):
        """Calcula quantos pontos faltam para o próximo nível"""
        config = LoyaltyConfig.get_current_config()
        if self.points < config.silver_threshold:
            return config.silver_threshold - self.points
        elif self.points < config.gold_threshold:
            return config.gold_threshold - self.points
        elif self.points < config.diamond_threshold:
            return config.diamond_threshold - self.points
        else:
            return 0
    
    def add_points(self, amount_spent):
        """Adiciona pontos baseado no valor gasto usando configurações do sistema"""
        config = LoyaltyConfig.get_current_config()
        
        if config.benefit_type == 'points':
            points_to_add = int(amount_spent // config.points_per_real)
            self.points += points_to_add
        elif config.benefit_type == 'cashback':
            # Para cashback, ainda mantemos pontos para níveis, mas calculamos o valor de volta
            points_to_add = int(amount_spent // config.points_per_real)
            self.points += points_to_add
        else:  # discount
            # Para desconto, pontos são apenas para níveis
            points_to_add = int(amount_spent // config.points_per_real)
            self.points += points_to_add
        
        self.total_spent += amount_spent
        self.level = self.get_level()
        self.last_visit = datetime.utcnow()
        return points_to_add
    
    def calculate_benefit_value(self, amount_spent):
        """Calcula o valor do benefício baseado no tipo configurado"""
        config = LoyaltyConfig.get_current_config()
        
        if config.benefit_type == 'discount':
            discount_percent = self.get_discount()
            return amount_spent * (discount_percent / 100)
        elif config.benefit_type == 'cashback':
            cashback_percent = self.get_discount()  # Usa a mesma lógica de níveis
            return amount_spent * (cashback_percent / 100)
        else:  # points
            return self.add_points(amount_spent)
    
    def to_dict(self):
        config = LoyaltyConfig.get_current_config()
        return {
            'id': self.id,
            'full_name': self.full_name,
            'cpf': self.format_cpf(),
            'cpf_raw': self.cpf,
            'phone': self.format_phone(),
            'phone_raw': self.phone,
            'email': self.email,
            'points': self.points,
            'total_spent': self.total_spent,
            'level': self.level,
            'discount': self.get_discount(),
            'points_to_next_level': self.points_to_next_level(),
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'last_visit': self.last_visit.isoformat() if self.last_visit else None,
            'active': self.active,
            'benefit_type': config.benefit_type
        }

class Transaction(db.Model):
    __tablename__ = 'transactions'
    
    id = db.Column(db.Integer, primary_key=True)
    customer_id = db.Column(db.Integer, db.ForeignKey('customers.id'), nullable=False)
    amount = db.Column(db.Float, nullable=False)
    points_earned = db.Column(db.Integer, nullable=False)
    benefit_value = db.Column(db.Float, default=0.0)  # Valor do desconto/cashback aplicado
    benefit_type = db.Column(db.String(20), default='points')  # Tipo de benefício aplicado
    description = db.Column(db.String(200), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'customer_id': self.customer_id,
            'amount': self.amount,
            'points_earned': self.points_earned,
            'benefit_value': self.benefit_value,
            'benefit_type': self.benefit_type,
            'description': self.description,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }

class LoyaltyConfig(db.Model):
    __tablename__ = 'loyalty_config'
    
    id = db.Column(db.Integer, primary_key=True)
    benefit_type = db.Column(db.String(20), default='points')  # 'points', 'discount', 'cashback'
    points_per_real = db.Column(db.Float, default=10.0)  # Quantos reais para ganhar 1 ponto
    
    # Thresholds para níveis
    silver_threshold = db.Column(db.Integer, default=500)
    gold_threshold = db.Column(db.Integer, default=1500)
    diamond_threshold = db.Column(db.Integer, default=3000)
    
    # Benefícios por nível (percentual)
    bronze_discount = db.Column(db.Float, default=5.0)
    silver_discount = db.Column(db.Float, default=10.0)
    gold_discount = db.Column(db.Float, default=15.0)
    diamond_discount = db.Column(db.Float, default=20.0)
    
    # Configurações de comunicação
    welcome_message = db.Column(db.Text, default="Bem-vindo ao programa de fidelidade Kaseirim!")
    promotion_message_template = db.Column(db.Text, default="Olá {name}! Você tem {points} pontos. Aproveite nossa promoção especial!")
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    active = db.Column(db.Boolean, default=True)
    
    @staticmethod
    def get_current_config():
        """Retorna a configuração ativa atual"""
        config = LoyaltyConfig.query.filter_by(active=True).first()
        if not config:
            # Cria configuração padrão se não existir
            config = LoyaltyConfig()
            db.session.add(config)
            db.session.commit()
        return config
    
    def to_dict(self):
        return {
            'id': self.id,
            'benefit_type': self.benefit_type,
            'points_per_real': self.points_per_real,
            'silver_threshold': self.silver_threshold,
            'gold_threshold': self.gold_threshold,
            'diamond_threshold': self.diamond_threshold,
            'bronze_discount': self.bronze_discount,
            'silver_discount': self.silver_discount,
            'gold_discount': self.gold_discount,
            'diamond_discount': self.diamond_discount,
            'welcome_message': self.welcome_message,
            'promotion_message_template': self.promotion_message_template,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'active': self.active
        }

class MenuItem(db.Model):
    __tablename__ = 'menu_items'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text, nullable=True)
    category = db.Column(db.String(50), nullable=False)
    price_half = db.Column(db.Float, nullable=True)
    price_full = db.Column(db.Float, nullable=False)
    image_url = db.Column(db.String(200), nullable=True)
    available = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'category': self.category,
            'price_half': self.price_half,
            'price_full': self.price_full,
            'image_url': self.image_url,
            'available': self.available,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }

class SiteContent(db.Model):
    __tablename__ = 'site_content'
    
    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(50), unique=True, nullable=False)
    value = db.Column(db.Text, nullable=False)
    description = db.Column(db.String(200), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'key': self.key,
            'value': self.value,
            'description': self.description,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }

