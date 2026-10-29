import hashlib
import os
import secrets
import time
from collections import defaultdict, deque
from functools import wraps
from threading import Lock

from flask import request, jsonify

# Limite de requisições por visitante, em memória.
# O IP nunca é guardado: vira um hash com um sal aleatório que muda a cada reinício do servidor.
# Com vários processos (workers), cada um conta separado; por isso o Procfile usa 1 worker com threads.

_SAL = secrets.token_bytes(16)
_registros = defaultdict(deque)
_lock = Lock()
_ultima_limpeza = time.monotonic()


def _ip_do_visitante():
    # Atrás do Cloudflare / proxy, o IP real vem nos cabeçalhos (só se CONFIAR_PROXY=1)
    if os.environ.get('CONFIAR_PROXY') == '1':
        ip = request.headers.get('CF-Connecting-IP') or \
            (request.headers.get('X-Forwarded-For') or '').split(',')[0].strip()
        if ip:
            return ip
    return request.remote_addr or 'desconhecido'


def _chave(nome):
    ip_hash = hashlib.blake2b(_ip_do_visitante().encode(), key=_SAL, digest_size=12).hexdigest()
    return f'{nome}:{ip_hash}'


def _limpar(agora):
    """Remove contadores antigos para a memória não crescer sem limite."""
    global _ultima_limpeza
    if agora - _ultima_limpeza < 300:
        return
    _ultima_limpeza = agora
    for chave in list(_registros):
        fila = _registros[chave]
        if not fila or agora - fila[-1] > 86400:
            del _registros[chave]


def _resposta_429(espera):
    resp = jsonify({'error': 'Muitas tentativas em pouco tempo. Tente de novo mais tarde.'})
    resp.status_code = 429
    resp.headers['Retry-After'] = str(espera)
    return resp


def bloqueado(nome, maximo, janela_segundos):
    """Se o visitante já atingiu o limite, devolve a resposta 429; senão None (sem contar)."""
    if os.environ.get('DESATIVAR_LIMITES') == '1':
        return None
    agora = time.monotonic()
    with _lock:
        fila = _registros[_chave(nome)]
        while fila and agora - fila[0] > janela_segundos:
            fila.popleft()
        if len(fila) >= maximo:
            return _resposta_429(int(janela_segundos - (agora - fila[0])) + 1)
    return None


def registrar(nome):
    with _lock:
        _registros[_chave(nome)].append(time.monotonic())


def limitar(nome, maximo, janela_segundos):
    """Permite no máximo `maximo` chamadas por visitante a cada `janela_segundos`."""
    def decorador(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            if os.environ.get('DESATIVAR_LIMITES') == '1':
                return f(*args, **kwargs)
            agora = time.monotonic()
            chave = _chave(nome)
            with _lock:
                _limpar(agora)
                fila = _registros[chave]
                while fila and agora - fila[0] > janela_segundos:
                    fila.popleft()
                if len(fila) >= maximo:
                    return _resposta_429(int(janela_segundos - (agora - fila[0])) + 1)
                fila.append(agora)
            return f(*args, **kwargs)
        return wrapper
    return decorador


def zerar_limites():
    """Usado nos testes."""
    with _lock:
        _registros.clear()
