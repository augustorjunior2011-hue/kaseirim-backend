import base64
import hashlib
import logging
import os
import secrets

from cryptography.fernet import Fernet
from sqlalchemy.types import TypeDecorator, Text

# Criptografia dos dados sensíveis (denúncias, fotos, segredos da equipe).
# A chave vem de CHAVE_CRIPTOGRAFIA e fica fora do banco: uma cópia do banco sem a chave é ilegível.
# Qualquer texto aleatório longo serve (ex.: o botão "Generate" do Render); ele é transformado na chave.

_fernet = None


def _chave():
    segredo = os.environ.get('CHAVE_CRIPTOGRAFIA')
    if not segredo:
        logging.getLogger(__name__).warning(
            'CHAVE_CRIPTOGRAFIA não definida: usando uma chave temporária. '
            'Os dados criptografados ficam ilegíveis quando o servidor reiniciar.')
        segredo = secrets.token_urlsafe(32)
    return base64.urlsafe_b64encode(hashlib.sha256(segredo.encode()).digest())


def fernet():
    global _fernet
    if _fernet is None:
        _fernet = Fernet(_chave())
    return _fernet


def cifrar_bytes(dados):
    return fernet().encrypt(dados)


def decifrar_bytes(dados):
    return fernet().decrypt(dados)


class TextoCifrado(TypeDecorator):
    """Coluna de texto gravada criptografada e lida em claro."""
    impl = Text
    cache_ok = True

    def process_bind_param(self, valor, dialect):
        if valor is None:
            return None
        return fernet().encrypt(str(valor).encode()).decode()

    def process_result_value(self, valor, dialect):
        if valor is None:
            return None
        return fernet().decrypt(valor.encode()).decode()


class NumeroCifrado(TextoCifrado):
    """Número (ex.: latitude) gravado criptografado."""

    def process_result_value(self, valor, dialect):
        texto = super().process_result_value(valor, dialect)
        return None if texto is None else float(texto)
