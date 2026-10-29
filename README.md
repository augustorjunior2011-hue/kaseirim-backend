# kaseirim-backend

Site e API de vagas de emprego + canal de denúncias anônimas.

- Como funciona: [docs/DENUNCIAS.md](docs/DENUNCIAS.md)
- Como colocar no ar: [docs/PUBLICAR.md](docs/PUBLICAR.md)

Rodar localmente:

```
pip install -r requirements.txt
ANALISTA_TOKEN=uma-senha python src/main.py
```

Testes: `python -m unittest discover -s tests -t .`
