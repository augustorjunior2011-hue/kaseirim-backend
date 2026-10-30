import io
import os
import secrets
import hashlib
import hmac
from functools import wraps

from flask import request, jsonify
from PIL import Image, ImageOps

from src.utils.limite import bloqueado, registrar

# Alfabeto sem caracteres ambíguos (0/O, 1/I/L) para códigos digitados à mão
ALFABETO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'


def gerar_codigo(prefixo, blocos=3, tamanho=4):
    """Gera um código legível, ex.: DN-7K2P-QX9M-4HTR"""
    partes = [''.join(secrets.choice(ALFABETO) for _ in range(tamanho)) for _ in range(blocos)]
    return f"{prefixo}-{'-'.join(partes)}"


def gerar_chave_secreta():
    """Chave que só o cidadão conhece. Mostrada uma única vez, nunca armazenada em texto puro."""
    return gerar_codigo('CH', blocos=4)


def hash_chave(chave):
    """Hash da chave secreta (PBKDF2). O servidor guarda apenas isso."""
    sal = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac('sha256', normalizar(chave).encode(), sal, 200_000)
    return f"{sal.hex()}${dk.hex()}"


def conferir_chave(chave, armazenado):
    if not chave or not armazenado:
        return False
    sal_hex, dk_hex = armazenado.split('$', 1)
    dk = hashlib.pbkdf2_hmac('sha256', normalizar(chave).encode(), bytes.fromhex(sal_hex), 200_000)
    return hmac.compare_digest(dk.hex(), dk_hex)


def normalizar(codigo):
    return (codigo or '').strip().upper()


def limpar_imagem(arquivo):
    """Reabre e regrava a imagem sem metadados (EXIF traz GPS, modelo do celular, data...).
    Retorna os bytes JPEG limpos ou None se o arquivo não for uma imagem válida."""
    try:
        img = Image.open(arquivo)
        img.verify()
        arquivo.seek(0)
        img = ImageOps.exif_transpose(Image.open(arquivo)).convert('RGB')
        # Copia apenas os pixels: nenhum metadado sobrevive
        limpa = Image.frombytes('RGB', img.size, img.tobytes())
        saida = io.BytesIO()
        limpa.save(saida, format='JPEG', quality=85)
        return saida.getvalue()
    except Exception:
        return None


def exige_analista(f):
    """Protege rotas internas da equipe de análise com um token (variável ANALISTA_TOKEN)."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        # Depois de 10 tokens errados em 15 minutos, o visitante fica bloqueado por um tempo
        bloqueio = bloqueado('analista_falha', 10, 900)
        if bloqueio:
            return bloqueio
        token = os.environ.get('ANALISTA_TOKEN')
        enviado = request.headers.get('Authorization', '').removeprefix('Bearer ').strip()
        if not token or not hmac.compare_digest(enviado, token):
            registrar('analista_falha')
            return jsonify({'error': 'Não autorizado'}), 401
        return f(*args, **kwargs)
    return wrapper
