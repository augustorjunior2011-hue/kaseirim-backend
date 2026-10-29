import os
import sys
# DON'T CHANGE THIS !!!
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from flask import Flask, send_from_directory, jsonify, request
from flask_cors import CORS
from src.models.user import db
from src.routes.user import user_bp
from src.routes.loyalty import loyalty_bp
from src.routes.denuncia import denuncia_bp
from src.routes.emprego import emprego_bp
from src.routes.mapa import mapa_bp

# FRONTEND=site serve o site de vagas/denúncias (src/site); padrão é o frontend do Kaseirim (src/static)
FRONTEND = os.environ.get('FRONTEND', 'static')
app = Flask(__name__, static_folder=os.path.join(os.path.dirname(__file__), 'site' if FRONTEND == 'site' else 'static'))
app.config['SECRET_KEY'] = 'asdf#FGSgvasgf$5$WGT'

# Habilita CORS para todas as rotas com configurações específicas
CORS(app, origins=["*"], methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"], allow_headers=["Content-Type", "Authorization"])

# Registra os blueprints das APIs
app.register_blueprint(user_bp, url_prefix='/api')
app.register_blueprint(loyalty_bp, url_prefix='/api')
app.register_blueprint(denuncia_bp, url_prefix='/api')
app.register_blueprint(emprego_bp, url_prefix='/api')
app.register_blueprint(mapa_bp, url_prefix='/api')

# Limite de upload (fotos das denúncias)
app.config['MAX_CONTENT_LENGTH'] = 25 * 1024 * 1024

# Configuração do banco de dados
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get(
    'DATABASE_URL', f"sqlite:///{os.path.join(os.path.dirname(__file__), 'database', 'app.db')}"
)
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db.init_app(app)
with app.app_context():
    db.create_all()

# Cabeçalhos de privacidade do site: nada de recursos de terceiros, sem referer, sem cache das respostas da API
@app.after_request
def cabecalhos_privacidade(resp):
    if FRONTEND == 'site':
        resp.headers['Content-Security-Policy'] = (
            "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
            "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
        )
        resp.headers['Referrer-Policy'] = 'no-referrer'
        resp.headers['X-Content-Type-Options'] = 'nosniff'
        resp.headers['Permissions-Policy'] = 'camera=(self), geolocation=(self), microphone=()'
        if request.path.startswith('/api/') and not request.path.startswith('/api/mapa/'):
            resp.headers['Cache-Control'] = 'no-store'
    return resp

# Rota para servir o frontend React
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_frontend(path):
    if path != "" and os.path.exists(os.path.join(app.static_folder, path)):
        return send_from_directory(app.static_folder, path)
    else:
        return send_from_directory(app.static_folder, 'index.html')

# Handler de erro para rotas não encontradas (APIs)
@app.errorhandler(404)
def not_found(e):
    if request.path.startswith('/api'):
        return jsonify(error="Not Found", message=f"The requested URL {request.path} was not found on the server."), 404
    return send_from_directory(app.static_folder, 'index.html')

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
