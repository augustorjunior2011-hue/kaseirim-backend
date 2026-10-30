import os
import urllib.request
from collections import OrderedDict
from threading import Lock

from flask import Blueprint, Response, abort

mapa_bp = Blueprint('mapa', __name__)

# As imagens do mapa passam pelo servidor: o visitante não se conecta ao servidor de mapas,
# que veria o IP dele junto com a região que está sendo denunciada.
TILE_URL = os.environ.get('MAPA_TILE_URL', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png')
USER_AGENT = os.environ.get('MAPA_USER_AGENT', 'Vagai/1.0 (contato@vagai.com.br)')
CACHE_MAX = 2000

_cache = OrderedDict()
_lock = Lock()


@mapa_bp.route('/mapa/<int:z>/<int:x>/<int:y>.png', methods=['GET'])
def tile(z, x, y):
    if not 0 <= z <= 19 or not 0 <= x < 2 ** z or not 0 <= y < 2 ** z:
        abort(404)

    chave = (z, x, y)
    with _lock:
        imagem = _cache.get(chave)
        if imagem is not None:
            _cache.move_to_end(chave)

    if imagem is None:
        pedido = urllib.request.Request(TILE_URL.format(z=z, x=x, y=y), headers={'User-Agent': USER_AGENT})
        try:
            with urllib.request.urlopen(pedido, timeout=10) as resp:
                imagem = resp.read()
        except Exception:
            abort(502)
        with _lock:
            _cache[chave] = imagem
            if len(_cache) > CACHE_MAX:
                _cache.popitem(last=False)

    return Response(imagem, mimetype='image/png', headers={'Cache-Control': 'public, max-age=604800'})
