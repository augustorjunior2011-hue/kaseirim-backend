# Como colocar o site no ar

Há dois caminhos. O **A (Railway)** é o mais fácil e não exige saber mexer em servidor.
O **B (VPS)** é um pouco mais barato e dá mais controle.

Antes de qualquer um, gere a **senha do painel da equipe** (`ANALISTA_TOKEN`):

```
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

Guarde num gerenciador de senhas. É com ela que a equipe entra em `seusite.com.br/#/equipe`.

---

## Caminho A: Railway (mais fácil, ~US$ 5/mês)

1. Crie uma conta em https://railway.com e conecte sua conta do GitHub.
2. **New Project → Deploy from GitHub repo** e escolha `kaseirim-backend`.
   A Railway encontra o `Dockerfile` sozinha.
3. No serviço criado, vá em **Settings → Volumes → Add Volume** e monte em **`/data`**.
   É ali que ficam o banco de dados e as fotos. Sem o volume, tudo some a cada atualização.
4. Em **Variables**, adicione:
   - `ANALISTA_TOKEN` = a senha gerada acima
   - `CONFIAR_PROXY` = `1`
   - `RAILWAY_RUN_UID` = `0` (os volumes da Railway pertencem ao root; sem isso o site não consegue gravar em `/data`)
   - `MAPA_USER_AGENT` = `NomeDoSite/1.0 (seu-email@dominio.com.br)`
   - (depois, para o PIX) as variáveis do Mercado Pago, abaixo
5. Em **Settings → Networking → Generate Domain**, a Railway dá um endereço
   `algo.up.railway.app`. Já dá para abrir no celular.
6. (Opcional) Domínio próprio: em **Networking → Custom Domain**, digite o domínio e crie no
   registro.br o registro CNAME que a Railway mostrar.
7. Coloque o endereço final em `URL_PUBLICA` (ex.: `https://vagasperto.com.br`).

Cada vez que algo for juntado na versão principal do GitHub, a Railway publica sozinha.

---

## Caminho B: VPS com Docker (~R$ 25–35/mês)

Serve para Hetzner, Contabo, DigitalOcean, Hostinger VPS etc. Escolha Ubuntu 24.04.

1. **Domínio:** registre em https://registro.br e aponte um registro **A** para o IP da VPS.
2. **Entre na VPS** (`ssh root@IP`) e instale o Docker:
   ```
   curl -fsSL https://get.docker.com | sh
   ```
3. **Baixe o projeto e configure:**
   ```
   git clone https://github.com/augustorjunior2011-hue/kaseirim-backend.git
   cd kaseirim-backend
   cp .env.example .env
   nano .env        # preencha DOMINIO, URL_PUBLICA, ANALISTA_TOKEN...
   ```
4. **Suba:**
   ```
   docker compose up -d --build
   ```
   O Caddy pede o certificado HTTPS sozinho. Em 1 ou 2 minutos o site abre em `https://seu-dominio`.
5. **Atualizar depois** de juntar mudanças no GitHub:
   ```
   git pull && docker compose up -d --build
   ```

### Cloudflare (recomendado no caminho B)

Esconde o IP do servidor e protege contra ataques. Crie conta grátis em https://cloudflare.com,
adicione o domínio, troque os DNS no registro.br pelos que o Cloudflare indicar e deixe o
registro A com a **nuvem laranja ligada**. Depois:
- no `.env`, troque para `CONFIAR_PROXY=cloudflare` e rode `docker compose up -d`;
- no Cloudflare, em **SSL/TLS**, escolha **Full (strict)**.

### Backup (importante)

O banco e as fotos ficam no volume `dados`. Copie para fora de tempos em tempos:
```
docker compose exec site tar czf - /data > backup-$(date +%F).tar.gz
```
Guarde em lugar seguro e **criptografado**: o backup tem as denúncias.

---

## PIX do destaque (Mercado Pago)

Sem isso o site funciona normalmente, só não aparece a opção de destacar anúncios.

1. Crie uma conta em https://www.mercadopago.com.br (de preferência como pessoa jurídica).
2. Acesse https://www.mercadopago.com.br/developers → **Suas integrações → Criar aplicação**
   (tipo "Pagamentos online", produto "Checkout Transparente / API").
3. Em **Credenciais de teste**, copie o **Access Token** (começa com `TEST-`) e teste primeiro.
   Depois troque pelas **Credenciais de produção** (`APP_USR-...`).
4. Configure as variáveis:
   - `MERCADOPAGO_ACCESS_TOKEN` = o Access Token
   - `PIX_EMAIL_PAGADOR` = um e-mail qualquer que **não** seja o da sua conta Mercado Pago
   - `URL_PUBLICA` = endereço do site (o Mercado Pago avisa em `URL_PUBLICA/api/pagamentos/mercadopago`)
   - `PRECO_DESTAQUE_7_DIAS` e `PRECO_DESTAQUE_30_DIAS` (padrão R$ 9,90 e R$ 29,90)
5. A conta precisa ter uma **chave PIX cadastrada** no Mercado Pago.

O site confere cada pagamento direto na API do Mercado Pago (valor, referência e status) antes
de liberar o destaque. Mesmo sem o aviso automático, a tela de pagamento consulta a cada 5
segundos e libera assim que o PIX cai.

> O pagamento foi testado com o Mercado Pago **simulado**. Faça um teste real com as
> credenciais de teste antes de divulgar.

---

## Depois de publicar: checklist

- [ ] Abrir o site no celular, publicar um anúncio de teste e remover.
- [ ] Fazer uma denúncia de teste, entrar no painel `/#/equipe` e responder pela conversa.
- [ ] Conferir se o mapa carrega (ruas aparecendo).
- [ ] Testar um PIX com credenciais de teste.
- [ ] Trocar o nome "Vagas Perto" em `src/site/index.html` pelo nome escolhido.
- [ ] Configurar backup.
