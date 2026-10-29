import os
import sys
# DON'T CHANGE THIS !!!
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from flask import Flask, send_from_directory, jsonify, request, abort
from src.models.db import db
from src.routes.denuncia import denuncia_bp
from src.routes.emprego import emprego_bp
from src.routes.mapa import mapa_bp

BASE_DIR = os.path.dirname(__file__)

# Site para celular (vagas + canal seguro de denúncias)
app = Flask(__name__, static_folder=os.path.join(BASE_DIR, 'site'))

# Registra os blueprints das APIs
app.register_blueprint(denuncia_bp, url_prefix='/api')
app.register_blueprint(emprego_bp, url_prefix='/api')
app.register_blueprint(mapa_bp, url_prefix='/api')

# Limite de upload (fotos das denúncias)
app.config['MAX_CONTENT_LENGTH'] = 25 * 1024 * 1024

# Configuração do banco de dados
if os.environ.get('DATABASE_URL'):
    app.config['SQLALCHEMY_DATABASE_URI'] = os.environ['DATABASE_URL']
else:
    os.makedirs(os.path.join(BASE_DIR, 'database'), exist_ok=True)
    app.config['SQLALCHEMY_DATABASE_URI'] = f"sqlite:///{os.path.join(BASE_DIR, 'database', 'app.db')}"

app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db.init_app(app)
with app.app_context():
    db.create_all()

if not os.environ.get('ANALISTA_TOKEN'):
    app.logger.warning('ANALISTA_TOKEN não definido: o painel da equipe fica bloqueado.')


@app.route('/api/saude')
def saude():
    """Usado pela hospedagem para saber se o site está no ar."""
    return jsonify(ok=True)


# Cabeçalhos de privacidade: nada de recursos de terceiros, sem referer, sem cache das respostas da API
@app.after_request
def cabecalhos_privacidade(resp):
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

# Rota para servir o site
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_frontend(path):
    if path.startswith('api/'):
        abort(404)
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
