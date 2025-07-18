from flask import Blueprint, request, jsonify
from src.models.user import db
from src.models.loyalty import Customer, Transaction, LoyaltyConfig, MenuItem, SiteContent
import re
from datetime import datetime

loyalty_bp = Blueprint('loyalty', __name__)

def validate_cpf(cpf):
    """Valida CPF brasileiro"""
    cpf = re.sub(r'\D', '', cpf)
    if len(cpf) != 11:
        return False
    
    # Verifica se todos os dígitos são iguais
    if cpf == cpf[0] * 11:
        return False
    
    # Calcula primeiro dígito verificador
    sum1 = sum(int(cpf[i]) * (10 - i) for i in range(9))
    digit1 = 11 - (sum1 % 11)
    if digit1 >= 10:
        digit1 = 0
    
    # Calcula segundo dígito verificador
    sum2 = sum(int(cpf[i]) * (11 - i) for i in range(10))
    digit2 = 11 - (sum2 % 11)
    if digit2 >= 10:
        digit2 = 0
    
    return cpf[-2:] == f"{digit1}{digit2}"

@loyalty_bp.route('/customers', methods=['GET'])
def get_customers():
    """Lista todos os clientes"""
    try:
        search = request.args.get('search', '')
        page = int(request.args.get('page', 1))
        per_page = int(request.args.get('per_page', 10))
        
        query = Customer.query.filter(Customer.active == True)
        
        if search:
            search_filter = f"%{search}%"
            query = query.filter(
                db.or_(
                    Customer.full_name.ilike(search_filter),
                    Customer.cpf.like(search_filter),
                    Customer.phone.like(search_filter)
                )
            )
        
        customers = query.paginate(
            page=page, 
            per_page=per_page, 
            error_out=False
        )
        
        return jsonify({
            'customers': [customer.to_dict() for customer in customers.items],
            'total': customers.total,
            'pages': customers.pages,
            'current_page': page
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@loyalty_bp.route('/customers', methods=['POST'])
def create_customer():
    """Cria um novo cliente"""
    try:
        data = request.get_json()
        
        # Validações
        if not data.get('full_name'):
            return jsonify({'error': 'Nome completo é obrigatório'}), 400
        
        if not data.get('cpf'):
            return jsonify({'error': 'CPF é obrigatório'}), 400
        
        if not data.get('phone'):
            return jsonify({'error': 'Telefone é obrigatório'}), 400
        
        # Limpa e valida CPF
        cpf = re.sub(r'\D', '', data['cpf'])
        if not validate_cpf(cpf):
            return jsonify({'error': 'CPF inválido'}), 400
        
        # Verifica se CPF já existe
        existing_customer = Customer.query.filter_by(cpf=cpf).first()
        if existing_customer:
            return jsonify({'error': 'CPF já cadastrado'}), 400
        
        # Limpa telefone
        phone = re.sub(r'\D', '', data['phone'])
        
        customer = Customer(
            full_name=data['full_name'],
            cpf=cpf,
            phone=phone,
            email=data.get('email', ''),
            points=data.get('points', 0)
        )
        
        db.session.add(customer)
        db.session.commit()
        
        return jsonify(customer.to_dict()), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@loyalty_bp.route('/customers/<int:customer_id>', methods=['GET'])
def get_customer(customer_id):
    """Busca um cliente específico"""
    try:
        customer = Customer.query.get_or_404(customer_id)
        return jsonify(customer.to_dict())
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@loyalty_bp.route('/customers/<int:customer_id>', methods=['PUT'])
def update_customer(customer_id):
    """Atualiza um cliente"""
    try:
        customer = Customer.query.get_or_404(customer_id)
        data = request.get_json()
        
        if 'full_name' in data:
            customer.full_name = data['full_name']
        
        if 'phone' in data:
            customer.phone = re.sub(r'\D', '', data['phone'])
        
        if 'email' in data:
            customer.email = data['email']
        
        if 'points' in data:
            customer.points = data['points']
            customer.level = customer.get_level()
        
        db.session.commit()
        return jsonify(customer.to_dict())
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@loyalty_bp.route('/customers/cpf/<cpf>', methods=['GET'])
def get_customer_by_cpf(cpf):
    """Busca cliente por CPF"""
    try:
        cpf_clean = re.sub(r'\D', '', cpf)
        customer = Customer.query.filter_by(cpf=cpf_clean).first()
        
        if not customer:
            return jsonify({'error': 'Cliente não encontrado'}), 404
        
        return jsonify(customer.to_dict())
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@loyalty_bp.route('/customers/<int:customer_id>/transactions', methods=['POST'])
def add_transaction(customer_id):
    """Adiciona uma transação para um cliente"""
    try:
        customer = Customer.query.get_or_404(customer_id)
        data = request.get_json()
        
        amount = float(data.get('amount', 0))
        if amount <= 0:
            return jsonify({'error': 'Valor deve ser maior que zero'}), 400
        
        # Calcula pontos ganhos
        points_earned = customer.add_points(amount)
        
        # Calcula valor do benefício
        config = LoyaltyConfig.get_current_config()
        benefit_value = customer.calculate_benefit_value(amount)
        
        # Cria transação
        transaction = Transaction(
            customer_id=customer_id,
            amount=amount,
            points_earned=points_earned,
            benefit_value=benefit_value,
            benefit_type=config.benefit_type,
            description=data.get('description', '')
        )
        
        db.session.add(transaction)
        db.session.commit()
        
        return jsonify({
            'transaction': transaction.to_dict(),
            'customer': customer.to_dict()
        }), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@loyalty_bp.route('/customers/<int:customer_id>/transactions', methods=['GET'])
def get_customer_transactions(customer_id):
    """Lista transações de um cliente"""
    try:
        customer = Customer.query.get_or_404(customer_id)
        transactions = Transaction.query.filter_by(customer_id=customer_id).order_by(Transaction.created_at.desc()).all()
        
        return jsonify({
            'customer': customer.to_dict(),
            'transactions': [t.to_dict() for t in transactions]
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@loyalty_bp.route('/config', methods=['GET'])
def get_loyalty_config():
    """Retorna configuração do programa de fidelidade"""
    try:
        config = LoyaltyConfig.get_current_config()
        return jsonify(config.to_dict())
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@loyalty_bp.route('/config', methods=['PUT'])
def update_loyalty_config():
    """Atualiza configuração do programa de fidelidade"""
    try:
        config = LoyaltyConfig.get_current_config()
        data = request.get_json()
        
        # Atualiza campos permitidos
        allowed_fields = [
            'benefit_type', 'points_per_real', 'silver_threshold', 'gold_threshold', 
            'diamond_threshold', 'bronze_discount', 'silver_discount', 'gold_discount', 
            'diamond_discount', 'welcome_message', 'promotion_message_template'
        ]
        
        for field in allowed_fields:
            if field in data:
                setattr(config, field, data[field])
        
        config.updated_at = datetime.utcnow()
        db.session.commit()
        
        return jsonify(config.to_dict())
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@loyalty_bp.route('/menu', methods=['GET'])
def get_menu():
    """Lista itens do cardápio"""
    try:
        category = request.args.get('category')
        query = MenuItem.query.filter(MenuItem.available == True)
        
        if category:
            query = query.filter(MenuItem.category == category)
        
        items = query.order_by(MenuItem.category, MenuItem.name).all()
        return jsonify([item.to_dict() for item in items])
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@loyalty_bp.route('/menu', methods=['POST'])
def create_menu_item():
    """Cria um novo item do cardápio"""
    try:
        data = request.get_json()
        
        item = MenuItem(
            name=data['name'],
            description=data.get('description', ''),
            category=data['category'],
            price_half=data.get('price_half'),
            price_full=data['price_full'],
            image_url=data.get('image_url', ''),
            available=data.get('available', True)
        )
        
        db.session.add(item)
        db.session.commit()
        
        return jsonify(item.to_dict()), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@loyalty_bp.route('/content', methods=['GET'])
def get_site_content():
    """Lista conteúdo do site"""
    try:
        content = SiteContent.query.all()
        return jsonify({item.key: item.value for item in content})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@loyalty_bp.route('/content', methods=['PUT'])
def update_site_content():
    """Atualiza conteúdo do site"""
    try:
        data = request.get_json()
        
        for key, value in data.items():
            content = SiteContent.query.filter_by(key=key).first()
            if content:
                content.value = value
                content.updated_at = datetime.utcnow()
            else:
                content = SiteContent(key=key, value=value)
                db.session.add(content)
        
        db.session.commit()
        return jsonify({'message': 'Conteúdo atualizado com sucesso'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@loyalty_bp.route('/stats', methods=['GET'])
def get_stats():
    """Retorna estatísticas do programa de fidelidade"""
    try:
        total_customers = Customer.query.filter(Customer.active == True).count()
        total_transactions = Transaction.query.count()
        total_revenue = db.session.query(db.func.sum(Transaction.amount)).scalar() or 0
        total_points = db.session.query(db.func.sum(Customer.points)).scalar() or 0
        
        # Clientes por nível
        bronze = Customer.query.filter(Customer.level == 'Bronze', Customer.active == True).count()
        silver = Customer.query.filter(Customer.level == 'Prata', Customer.active == True).count()
        gold = Customer.query.filter(Customer.level == 'Ouro', Customer.active == True).count()
        diamond = Customer.query.filter(Customer.level == 'Diamante', Customer.active == True).count()
        
        return jsonify({
            'total_customers': total_customers,
            'total_transactions': total_transactions,
            'total_revenue': total_revenue,
            'total_points': total_points,
            'customers_by_level': {
                'Bronze': bronze,
                'Prata': silver,
                'Ouro': gold,
                'Diamante': diamond
            }
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

