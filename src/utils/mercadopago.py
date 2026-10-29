import json
import os
import urllib.error
import urllib.request
import uuid

API = 'https://api.mercadopago.com/v1/payments'


class ErroPagamento(Exception):
    pass


def configurado():
    return bool(os.environ.get('MERCADOPAGO_ACCESS_TOKEN'))


def _requisicao(metodo, url, corpo=None, idempotencia=None):
    headers = {
        'Authorization': f"Bearer {os.environ['MERCADOPAGO_ACCESS_TOKEN']}",
        'Content-Type': 'application/json',
    }
    if idempotencia:
        headers['X-Idempotency-Key'] = idempotencia
    dados = json.dumps(corpo).encode() if corpo is not None else None
    pedido = urllib.request.Request(url, data=dados, headers=headers, method=metodo)
    try:
        with urllib.request.urlopen(pedido, timeout=15) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raise ErroPagamento(f'Mercado Pago respondeu {e.code}') from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise ErroPagamento('Não foi possível falar com o Mercado Pago') from e


def criar_pix(valor, descricao, referencia, expira_em, notification_url=None):
    """Cria uma cobrança PIX. Retorna o pagamento do Mercado Pago (id, status, QR code)."""
    corpo = {
        'transaction_amount': float(valor),
        'description': descricao,
        'payment_method_id': 'pix',
        'external_reference': referencia,
        # O Mercado Pago exige um e-mail de pagador; não pedimos o do anunciante
        'payer': {'email': os.environ.get('PIX_EMAIL_PAGADOR', 'pagador@example.com')},
        'date_of_expiration': expira_em.strftime('%Y-%m-%dT%H:%M:%S.000-00:00'),
    }
    if notification_url:
        corpo['notification_url'] = notification_url
    return _requisicao('POST', API, corpo, idempotencia=str(uuid.uuid4()))


def consultar(mp_id):
    return _requisicao('GET', f'{API}/{mp_id}')
