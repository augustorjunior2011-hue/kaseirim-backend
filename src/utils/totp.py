import base64
import hashlib
import hmac
import secrets
import time
from urllib.parse import quote

# Código de 6 dígitos que muda a cada 30 segundos (padrão TOTP, RFC 6238),
# o mesmo usado pelo Google Authenticator, Microsoft Authenticator, Authy etc.

PASSO = 30


def gerar_segredo():
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip('=')


def _codigo(segredo, contador):
    chave = base64.b32decode(segredo + '=' * (-len(segredo) % 8))
    resumo = hmac.new(chave, contador.to_bytes(8, 'big'), hashlib.sha1).digest()
    inicio = resumo[-1] & 0x0F
    numero = (int.from_bytes(resumo[inicio:inicio + 4], 'big') & 0x7FFFFFFF) % 1_000_000
    return f'{numero:06d}'


def codigo_atual(segredo, instante=None):
    return _codigo(segredo, int((instante or time.time()) // PASSO))


def verificar(segredo, codigo, ultimo_contador=None):
    """Confere o código (aceita 30 s de diferença no relógio do celular).
    Devolve o contador usado, ou None. Um código já usado não vale de novo."""
    codigo = (codigo or '').strip().replace(' ', '')
    if len(codigo) != 6 or not codigo.isdigit():
        return None
    agora = int(time.time() // PASSO)
    for contador in (agora - 1, agora, agora + 1):
        if ultimo_contador is not None and contador <= ultimo_contador:
            continue
        if hmac.compare_digest(_codigo(segredo, contador), codigo):
            return contador
    return None


def link_app(segredo, nome, emissor):
    """Endereço otpauth:// que o aplicativo autenticador lê pelo QR code."""
    rotulo = quote(f'{emissor}:{nome}')
    return f'otpauth://totp/{rotulo}?secret={segredo}&issuer={quote(emissor)}&digits=6&period={PASSO}'
