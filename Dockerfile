FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000 \
    DATABASE_URL=sqlite:////data/app.db \
    UPLOAD_DIR=/data/uploads

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src ./src

# Usuário sem privilégios; /data guarda o banco e as fotos (monte um volume aqui)
RUN useradd --create-home app && mkdir -p /data && chown app:app /data
USER app
VOLUME ["/data"]

EXPOSE 8000
# 1 worker com threads: o limite de tentativas fica em memória e precisa ser compartilhado.
# Sem log de acesso do gunicorn (ele gravaria o IP de quem acessa).
CMD ["sh", "-c", "exec gunicorn --bind 0.0.0.0:${PORT} --workers 1 --threads 8 --timeout 60 src.main:app"]
