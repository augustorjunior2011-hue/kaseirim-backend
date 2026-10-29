# Denúncias anônimas + Empregos

Site e API de denúncias anônimas (sem cadastro) com aba de empregos, que é a fonte de receita
do projeto.

## Site para celular (`src/site`)

Site simples (HTML/CSS/JS, sem build) servido pelo próprio Flask na raiz do domínio.

- **Página inicial = vagas de emprego.** A denúncia fica no link discreto "Canal seguro", no rodapé.
  O nome "Vagas Perto" é provisório: troque em `src/site/index.html`.
- **Botão "Sair rápido"** nas telas do canal: troca a página por uma busca da previsão do tempo.
- **Uma única entrada no histórico:** a navegação usa `location.replace`, então o botão "voltar"
  não mostra as telas da denúncia.
- **Nada salvo no aparelho:** sem cookies, sem localStorage, sem analytics.
- **Fotos reduzidas e limpas no próprio celular** antes do envio (e limpas de novo no servidor).
- **Mapa via servidor (`/api/mapa/...`):** o visitante não se conecta ao OpenStreetMap, que veria o
  IP junto com a região denunciada. Configure `MAPA_USER_AGENT` com um contato real (exigência do
  OpenStreetMap). Com muito tráfego, contrate um provedor de mapas (`MAPA_TILE_URL`).
- **Cabeçalhos de segurança:** CSP bloqueando qualquer recurso de terceiros, `no-referrer`,
  respostas da API com `no-store`.

## Como funciona o anonimato

- **Sem cadastro.** Ao enviar a denúncia, o app recebe um **protocolo** (`DN-XXXX-XXXX-XXXX`)
  e uma **chave secreta** (`CH-XXXX-XXXX-XXXX-XXXX`). O servidor guarda só o *hash* da chave.
  Quem tem protocolo + chave acompanha a denúncia e conversa com a equipe.
  Se perder, não há como recuperar (é proposital).
- **Fotos sem metadados.** Toda foto é regravada pixel a pixel; o EXIF (GPS, modelo do celular,
  data/hora) é descartado. As fotos ficam fora da pasta pública (`UPLOAD_DIR`).
- **Datas sem horário.** Denúncias e mensagens registram apenas o dia.
- **Localização** é o ponto que o cidadão marca no mapa, não o GPS do aparelho.

## Recompensas (suspenso)

A parte de recompensas foi retirada por enquanto. Ela existiu no commit `e275b1f` e pode ser
recuperada do histórico do Git se o projeto voltar a ela. A ideia era: o protocolo + chave
funcionam como um "bilhete ao portador", e o cidadão escolhe receber por vale-presente,
recarga de celular ou PIX, só para crimes graves com resultado confirmado.

Antes de voltar com ela, validar com advogado:
- **Recompensa paga por particular:** a Lei 13.608/2018 trata de recompensas oferecidas pelo poder
  público; uma entidade privada se apoia na *promessa de recompensa* (Código Civil, arts. 854–860).
  O Disque Denúncia do RJ (mantido por uma ONG) é um modelo privado parecido.
- **Confirmar a prisão sem vínculo com a polícia:** sem parceria, só há fontes públicas
  (notícias, consulta processual).
- **Lavagem de dinheiro / tributação:** pagamentos a pessoas não identificadas precisam de política
  de limites e contabilidade do fundo.

## Fluxo da denúncia

`recebida → em_analise → com_indicios | sem_indicios → encaminhada → resultado_confirmado | arquivada`

A equipe pode pedir detalhes ao denunciante pelo chat anônimo (`/mensagens`).

## Endpoints

Públicos (cidadão):

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/denuncias/categorias` | Lista as categorias de crime |
| POST | `/api/denuncias` | Cria denúncia (JSON ou multipart com até 5 `fotos`) → protocolo + chave |
| POST | `/api/denuncias/acompanhar` | `{protocolo, chave}` → status e mensagens |
| POST | `/api/denuncias/mensagens` | `{protocolo, chave, texto}` → complementa a denúncia |
| GET | `/api/empregos` | Lista vagas (`tipo`, `uf`, `cidade`, `busca`); destaques primeiro |
| POST | `/api/empregos` | Publica oferta/procura → `codigo_gestao` |
| PUT/DELETE | `/api/empregos/<id>` | Edita/remove com `codigo_gestao` |

Equipe de análise (header `Authorization: Bearer $ANALISTA_TOKEN`):

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/analise/denuncias` | Lista (`status`, `categoria`, `uf`) |
| GET/PUT | `/api/analise/denuncias/<id>` | Detalhe / muda status e parecer |
| GET | `/api/analise/fotos/<id>` | Foto (já sem metadados) |
| POST | `/api/analise/denuncias/<id>/mensagens` | Mensagem para o denunciante |
| POST | `/api/analise/empregos/<id>/destaque` | `{dias}` ativa destaque pago |
| DELETE | `/api/analise/empregos/<id>` | Remove anúncio abusivo/golpe |

## Variáveis de ambiente

- `ANALISTA_TOKEN` — obrigatório para as rotas `/api/analise/*` (sem ele, todas retornam 401).
- `UPLOAD_DIR` — pasta das fotos (padrão `src/database/uploads`, fora da pasta pública).
- `DATABASE_URL` — banco (padrão SQLite em `src/database/app.db`).
- `MAPA_USER_AGENT` / `MAPA_TILE_URL` — identificação e origem das imagens do mapa.

## Pontos jurídicos para validar com advogado (antes de lançar)

- **Marco Civil da Internet, art. 15:** aplicativo de empresa com fins econômicos (a aba de empregos
  gera receita) é obrigado a guardar registros de acesso (IP, data/hora) por 6 meses. Isso conflita
  com "anonimato total" e precisa ser desenhado com cuidado (ex.: orientar uso de VPN/Tor, separar
  infraestrutura).
- **Denúncia falsa:** denunciação caluniosa (CP art. 339) e calúnia (art. 138). Deixar isso claro
  no app e nunca publicar nomes de suspeitos.
- **LGPD:** o sistema guarda dados de terceiros (nome/apelido de suspeitos). Definir base legal,
  prazo de retenção e segurança (criptografia em repouso, acesso restrito).

## Pendências técnicas

- Limite de requisições (anti-spam e anti-força-bruta em `/acompanhar`).
- Criptografia dos campos sensíveis no banco.
- Pagamento do destaque de vagas (gateway) — hoje o destaque é ativado manualmente pela equipe.
- Registros de acesso (IP): guardar só o que o art. 15 exigir, separados do banco de denúncias,
  com acesso restrito e apagados após o prazo — nunca gravar o protocolo junto do IP.
