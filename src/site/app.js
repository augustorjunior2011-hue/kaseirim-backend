'use strict';

// Site sem cookies, sem rastreadores e sem nada salvo no aparelho.
// A navegação usa location.replace: o site ocupa uma única entrada no histórico do navegador.

const SAIDA_RAPIDA = 'https://www.google.com/search?q=previs%C3%A3o+do+tempo';
const MAX_FOTOS = 5;
const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR',
  'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

const STATUS = {
  recebida: 'Recebida — aguardando análise',
  em_analise: 'Em análise',
  com_indicios: 'Analisada — há indícios',
  sem_indicios: 'Analisada — sem indícios suficientes',
  encaminhada: 'Encaminhada às autoridades',
  resultado_confirmado: 'Resultado confirmado',
  arquivada: 'Arquivada',
};

const tela = document.getElementById('tela');
const botaoSair = document.getElementById('sair-rapido');

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function esc(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

async function api(caminho, opcoes = {}) {
  const config = { method: opcoes.method || 'GET', headers: {}, credentials: 'omit', cache: 'no-store' };
  if (opcoes.form) {
    config.body = opcoes.form;
  } else if (opcoes.json) {
    config.headers['Content-Type'] = 'application/json';
    config.body = JSON.stringify(opcoes.json);
  }
  const resp = await fetch('/api' + caminho, config);
  const dados = resp.status === 204 ? {} : await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(dados.error || 'Não foi possível concluir. Tente de novo.');
  return dados;
}

function ir(rota) {
  location.replace('#' + rota);
}

function formDados(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function opcoesUF(selecionada = '') {
  return '<option value="">UF</option>' + UFS.map(uf =>
    `<option ${uf === selecionada ? 'selected' : ''}>${uf}</option>`).join('');
}

function telefoneFormatado(numero) {
  const n = String(numero || '');
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  return n;
}

function mostrarErro(form, mensagem) {
  let el = form.querySelector('.erro');
  if (!el) {
    el = document.createElement('p');
    el.className = 'erro';
    form.appendChild(el);
  }
  el.textContent = mensagem;
}

async function enviando(botao, acao) {
  const texto = botao.textContent;
  botao.disabled = true;
  botao.textContent = 'Enviando...';
  try {
    await acao();
  } finally {
    botao.disabled = false;
    botao.textContent = texto;
  }
}

// Reduz a foto no próprio celular. O canvas descarta os metadados (GPS, modelo do aparelho),
// então eles nem chegam a sair do telefone. O servidor limpa de novo por garantia.
async function prepararFoto(arquivo) {
  try {
    const bitmap = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
    const escala = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * escala);
    canvas.height = Math.round(bitmap.height * escala);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise(ok => canvas.toBlob(ok, 'image/jpeg', 0.85));
  } catch {
    return arquivo;
  }
}

// ---------------------------------------------------------------------------
// Empregos (página inicial)
// ---------------------------------------------------------------------------

function cartaoVaga(v) {
  const whats = `https://wa.me/55${v.telefone_contato}`;
  return `
    <article class="cartao ${v.destaque ? 'destaque' : ''}">
      <span class="etiqueta">${v.tipo === 'oferta' ? 'Vaga' : 'Procuro trabalho'}</span>
      ${v.destaque ? '<span class="etiqueta">Destaque</span>' : ''}
      <h3>${esc(v.titulo)}</h3>
      <p class="suave">${esc([v.empresa, `${v.cidade}/${v.uf}`, v.salario].filter(Boolean).join(' · '))}</p>
      <p>${esc(v.descricao)}</p>
      <p><a href="tel:${esc(v.telefone_contato)}">${esc(telefoneFormatado(v.telefone_contato))}</a>
        · <a href="${esc(whats)}" target="_blank" rel="noopener noreferrer">WhatsApp</a></p>
    </article>`;
}

async function telaVagas() {
  tela.innerHTML = `
    <h1>Vagas de emprego</h1>
    <form id="filtros" class="filtros">
      <input name="busca" placeholder="Buscar: cozinha, motorista...">
      <select name="tipo">
        <option value="">Tudo</option>
        <option value="oferta">Vagas</option>
        <option value="procura">Quem procura</option>
      </select>
      <select name="uf">${opcoesUF()}</select>
    </form>
    <div id="lista"><p class="suave">Carregando...</p></div>
    <a class="botao" href="#/publicar">Anunciar grátis</a>`;

  const filtros = document.getElementById('filtros');
  const lista = document.getElementById('lista');

  async function carregar() {
    const params = new URLSearchParams(Object.entries(formDados(filtros)).filter(([, v]) => v));
    try {
      const { vagas } = await api('/empregos?' + params);
      lista.innerHTML = vagas.length ? vagas.map(cartaoVaga).join('')
        : '<p class="suave">Nenhum anúncio encontrado.</p>';
    } catch (e) {
      lista.innerHTML = `<p class="erro">${esc(e.message)}</p>`;
    }
  }

  let espera;
  filtros.addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(carregar, 300); });
  filtros.addEventListener('submit', e => { e.preventDefault(); carregar(); });
  carregar();
}

function telaPublicar() {
  tela.innerHTML = `
    <h1>Anunciar</h1>
    <form id="form-vaga">
      <div class="opcoes">
        <label><input type="radio" name="tipo" value="oferta" checked> Tenho uma vaga</label>
        <label><input type="radio" name="tipo" value="procura"> Procuro trabalho</label>
      </div>
      <label>Título <input name="titulo" required maxlength="150" placeholder="Ex.: Auxiliar de cozinha"></label>
      <label>Descrição <textarea name="descricao" required maxlength="5000"
        placeholder="Horário, requisitos, benefícios ou sua experiência"></textarea></label>
      <label>Empresa <span class="suave">(opcional)</span> <input name="empresa" maxlength="150"></label>
      <label>Salário <span class="suave">(opcional)</span> <input name="salario" maxlength="60" placeholder="Ex.: R$ 1.800"></label>
      <label>Cidade <input name="cidade" required maxlength="100"></label>
      <label>UF <select name="uf" required>${opcoesUF()}</select></label>
      <label>Telefone / WhatsApp para contato
        <input name="telefone_contato" required inputmode="tel" placeholder="(21) 99999-0000"></label>
      <button type="submit">Publicar anúncio</button>
    </form>`;

  const form = document.getElementById('form-vaga');
  form.addEventListener('submit', e => {
    e.preventDefault();
    enviando(form.querySelector('button'), async () => {
      try {
        const r = await api('/empregos', { method: 'POST', json: formDados(form) });
        tela.innerHTML = `
          <h1>Anúncio publicado</h1>
          <p>Para remover o anúncio depois, você vai precisar destes dados. Anote:</p>
          <div class="credenciais">Nº ${r.vaga.id}<br>${esc(r.codigo_gestao)}
            <small>Número do anúncio e código de gestão</small></div>
          <p class="suave" style="margin-top:12px">O anúncio fica no ar por 30 dias.</p>
          <a class="botao" href="#/">Ver anúncios</a>`;
      } catch (err) {
        mostrarErro(form, err.message);
      }
    });
  });
}

function telaGerenciar() {
  tela.innerHTML = `
    <h1>Remover meu anúncio</h1>
    <form id="form-gerenciar">
      <label>Número do anúncio <input name="id" required inputmode="numeric"></label>
      <label>Código de gestão <input name="codigo_gestao" required autocapitalize="characters" placeholder="VG-XXXX-XXXX-XXXX"></label>
      <button type="submit">Remover anúncio</button>
    </form>`;

  const form = document.getElementById('form-gerenciar');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const { id, codigo_gestao } = formDados(form);
    enviando(form.querySelector('button'), async () => {
      try {
        await api(`/empregos/${encodeURIComponent(id)}`, { method: 'DELETE', json: { codigo_gestao } });
        tela.innerHTML = '<h1>Anúncio removido</h1><a class="botao" href="#/">Voltar</a>';
      } catch (err) {
        mostrarErro(form, err.message);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Canal seguro (denúncias)
// ---------------------------------------------------------------------------

function telaCanal() {
  tela.innerHTML = `
    <h1>Canal seguro</h1>
    <p>Informe crimes de forma <strong>totalmente anônima</strong>. Não pedimos nome, CPF, telefone nem cadastro.</p>
    <div class="aviso">
      <strong>Para sua segurança:</strong>
      <ul>
        <li>Use a <strong>aba anônima</strong> do navegador.</li>
        <li>Não conte a ninguém que você fez a denúncia.</li>
        <li>Se alguém se aproximar, toque em <strong>Sair rápido</strong>, no canto da tela.</li>
      </ul>
    </div>
    <a class="botao" href="#/denunciar">Fazer uma denúncia</a>
    <a class="botao secundario" href="#/acompanhar">Acompanhar denúncia</a>
    <p class="suave" style="margin-top:16px">Denúncias de crimes graves que levarem a um resultado confirmado
      podem receber recompensa, também sem identificação. Denúncia falsa é crime (art. 339 do Código Penal).</p>`;
}

async function telaDenunciar() {
  tela.innerHTML = `
    <h1>Fazer denúncia</h1>
    <form id="form-denuncia">
      <label>Tipo de crime <select name="categoria" required><option value="">Carregando...</option></select></label>
      <p id="aviso-recompensa" class="suave"></p>

      <label>O que aconteceu? <textarea name="descricao" required minlength="20" maxlength="5000"
        placeholder="Descreva com o máximo de detalhes: o que, como, quem mais estava envolvido..."></textarea></label>
      <label>Quando? <span class="suave">(opcional)</span>
        <input name="data_ocorrencia" maxlength="40" placeholder="Ex.: ontem à noite, toda sexta"></label>

      <h2>Onde?</h2>
      <p class="suave">Toque no mapa para marcar o local.</p>
      <div id="mapa"></div>
      <button type="button" id="minha-localizacao" class="secundario">Estou no local agora</button>
      <label>Ponto de referência <input name="referencia_local" maxlength="300"
        placeholder="Ex.: casa azul ao lado da padaria"></label>
      <label>Cidade <input name="cidade" maxlength="100"></label>
      <label>UF <select name="uf">${opcoesUF()}</select></label>

      <h2>Quem?</h2>
      <label>Nome <span class="suave">(se souber)</span> <input name="suspeito_nome" maxlength="150"></label>
      <label>Apelidos <input name="suspeito_apelidos" maxlength="300" placeholder="Ex.: Baixinho, Nego D"></label>
      <label>Características <span class="suave">(aparência, carro, onde costuma ficar)</span>
        <textarea name="suspeito_caracteristicas" maxlength="2000"></textarea></label>

      <label>Faz parte de facção?</label>
      <div class="opcoes">
        <label><input type="radio" name="faccionado" value="sim"> Sim</label>
        <label><input type="radio" name="faccionado" value="nao"> Não</label>
        <label><input type="radio" name="faccionado" value="nao_sei" checked> Não sei</label>
      </div>
      <label id="campo-faccao" hidden>Qual facção? <input name="faccao" maxlength="100"></label>

      <h2>Fotos <span class="suave">(até ${MAX_FOTOS})</span></h2>
      <input type="file" id="fotos" accept="image/*" multiple>
      <p class="suave">Removemos automaticamente a localização e os dados do celular que ficam escondidos nas fotos.</p>

      <button type="submit">Enviar denúncia anônima</button>
    </form>`;

  const form = document.getElementById('form-denuncia');
  const select = form.categoria;
  let categorias = [];
  try {
    categorias = await api('/denuncias/categorias');
    select.innerHTML = '<option value="">Selecione</option>' +
      categorias.map(c => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join('');
  } catch (err) {
    mostrarErro(form, err.message);
  }
  select.addEventListener('change', () => {
    const c = categorias.find(x => x.id === select.value);
    document.getElementById('aviso-recompensa').textContent =
      c && c.pode_gerar_recompensa ? 'Este tipo de crime pode gerar recompensa.' : '';
  });

  form.querySelectorAll('input[name="faccionado"]').forEach(r => r.addEventListener('change', () => {
    document.getElementById('campo-faccao').hidden = form.faccionado.value !== 'sim';
  }));

  // Mapa: as imagens passam pelo nosso servidor, então o visitante não se conecta a terceiros
  const mapa = L.map('mapa').setView([-14.2, -51.9], 4);
  L.tileLayer('/api/mapa/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(mapa);
  let marcador = null;
  let ponto = null;
  function marcar(lat, lng) {
    ponto = { lat, lng };
    if (marcador) marcador.setLatLng(ponto);
    else marcador = L.marker(ponto).addTo(mapa);
  }
  mapa.on('click', e => marcar(e.latlng.lat, e.latlng.lng));

  document.getElementById('minha-localizacao').addEventListener('click', () => {
    if (!navigator.geolocation) return mostrarErro(form, 'Seu celular não permite pegar a localização.');
    navigator.geolocation.getCurrentPosition(
      pos => { marcar(pos.coords.latitude, pos.coords.longitude); mapa.setView(ponto, 17); },
      () => mostrarErro(form, 'Não foi possível pegar a localização. Marque no mapa.'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const arquivos = Array.from(document.getElementById('fotos').files);
    if (arquivos.length > MAX_FOTOS) return mostrarErro(form, `Envie no máximo ${MAX_FOTOS} fotos.`);
    if (!ponto && !form.referencia_local.value.trim()) {
      return mostrarErro(form, 'Marque o local no mapa ou escreva um ponto de referência.');
    }

    enviando(form.querySelector('button[type="submit"]'), async () => {
      try {
        const dados = new FormData(form);
        if (ponto) {
          dados.set('latitude', ponto.lat.toFixed(6));
          dados.set('longitude', ponto.lng.toFixed(6));
        }
        for (const arquivo of arquivos) {
          dados.append('fotos', await prepararFoto(arquivo), 'foto.jpg');
        }
        const r = await api('/denuncias', { method: 'POST', form: dados });
        telaProtocolo(r);
      } catch (err) {
        mostrarErro(form, err.message);
      }
    });
  });
}

function telaProtocolo(r) {
  tela.innerHTML = `
    <h1>Denúncia enviada</h1>
    <div class="aviso"><strong>Anote agora, num papel.</strong> Sem estes dois códigos não é possível acompanhar
      a denúncia nem receber recompensa. Não guardamos uma cópia e não conseguimos recuperar.</div>
    <h2>Protocolo</h2>
    <div class="credenciais">${esc(r.protocolo)}</div>
    <h2>Chave secreta</h2>
    <div class="credenciais">${esc(r.chave)}
      <small>Não tire print: a imagem fica salva na galeria do celular.</small></div>
    <a class="botao" href="#/canal">Já anotei</a>`;
}

function telaAcompanhar() {
  tela.innerHTML = `
    <h1>Acompanhar denúncia</h1>
    <form id="form-acesso">
      <label>Protocolo <input name="protocolo" required autocapitalize="characters" autocomplete="off"
        placeholder="DN-XXXX-XXXX-XXXX"></label>
      <label>Chave secreta <input name="chave" required autocapitalize="characters" autocomplete="off"
        placeholder="CH-XXXX-XXXX-XXXX-XXXX"></label>
      <button type="submit">Ver andamento</button>
    </form>
    <div id="andamento"></div>`;

  const form = document.getElementById('form-acesso');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const credenciais = formDados(form);
    enviando(form.querySelector('button'), async () => {
      try {
        const d = await api('/denuncias/acompanhar', { method: 'POST', json: credenciais });
        form.hidden = true;
        mostrarAndamento(d, credenciais);
      } catch (err) {
        mostrarErro(form, err.message);
      }
    });
  });
}

function blocoRecompensa(rec) {
  switch (rec.status) {
    case 'elegivel':
      return `
        <div class="cartao destaque">
          <h3>Recompensa disponível: R$ ${Number(rec.valor).toFixed(2).replace('.', ',')}</h3>
          <form id="form-resgate">
            <label>Como quer receber?</label>
            <div class="opcoes">
              <label><input type="radio" name="metodo" value="vale_presente" checked> Vale-presente</label>
              <label><input type="radio" name="metodo" value="recarga_celular"> Recarga</label>
              <label><input type="radio" name="metodo" value="pix"> PIX</label>
            </div>
            <p id="explica-metodo" class="suave"></p>
            <label id="campo-destino" hidden><span></span> <input name="destino" autocomplete="off"></label>
            <button type="submit">Resgatar</button>
          </form>
        </div>`;
    case 'resgate_solicitado':
      return `<div class="cartao"><h3>Resgate solicitado</h3>
        <p class="suave">Estamos processando o pagamento. Volte em alguns dias.</p></div>`;
    case 'paga':
      return `<div class="cartao"><h3>Recompensa paga</h3>
        ${rec.codigo ? `<p>Código do vale:</p><div class="credenciais">${esc(rec.codigo)}</div>` : ''}</div>`;
    default:
      return '';
  }
}

const EXPLICA_METODO = {
  vale_presente: ['Mais anônimo: o código do vale aparece aqui nesta tela. Você não informa nada.', null],
  recarga_celular: ['O crédito vai para um número de celular. Prefira um chip pré-pago.', 'Celular com DDD'],
  pix: ['Atenção: no PIX o banco mostra o seu nome para quem paga. Apagamos a chave depois do pagamento.', 'Chave PIX'],
};

function mostrarAndamento(d, credenciais) {
  const area = document.getElementById('andamento');
  area.innerHTML = `
    <div class="cartao">
      <span class="etiqueta">${esc(d.categoria)}</span>
      <h3>${esc(STATUS[d.status] || d.status)}</h3>
      <p class="suave">Protocolo ${esc(d.protocolo)} · enviada em ${esc(d.criada_em)}</p>
    </div>
    ${blocoRecompensa(d.recompensa)}
    <h2>Conversa com a equipe</h2>
    ${d.mensagens.length ? d.mensagens.map(m => `
      <div class="mensagem ${m.autor === 'equipe' ? 'equipe' : 'cidadao'}">
        <strong>${m.autor === 'equipe' ? 'Equipe' : 'Você'}:</strong> ${esc(m.texto)}
      </div>`).join('') : '<p class="suave">Nenhuma mensagem ainda.</p>'}
    <form id="form-mensagem">
      <label>Complementar a denúncia <textarea name="texto" required maxlength="3000"
        placeholder="Algo novo? Escreva aqui."></textarea></label>
      <button type="submit">Enviar</button>
    </form>`;

  const formMsg = document.getElementById('form-mensagem');
  formMsg.addEventListener('submit', e => {
    e.preventDefault();
    enviando(formMsg.querySelector('button'), async () => {
      try {
        const novo = await api('/denuncias/mensagens', { method: 'POST', json: { ...credenciais, ...formDados(formMsg) } });
        mostrarAndamento(novo, credenciais);
      } catch (err) {
        mostrarErro(formMsg, err.message);
      }
    });
  });

  const formResgate = document.getElementById('form-resgate');
  if (!formResgate) return;
  const atualizarMetodo = () => {
    const [explicacao, rotulo] = EXPLICA_METODO[formResgate.metodo.value];
    document.getElementById('explica-metodo').textContent = explicacao;
    const campo = document.getElementById('campo-destino');
    campo.hidden = !rotulo;
    campo.querySelector('span').textContent = rotulo || '';
    campo.querySelector('input').required = Boolean(rotulo);
  };
  formResgate.querySelectorAll('input[name="metodo"]').forEach(r => r.addEventListener('change', atualizarMetodo));
  atualizarMetodo();

  formResgate.addEventListener('submit', e => {
    e.preventDefault();
    enviando(formResgate.querySelector('button'), async () => {
      try {
        const novo = await api('/denuncias/recompensa/resgatar', {
          method: 'POST', json: { ...credenciais, ...formDados(formResgate) },
        });
        mostrarAndamento(novo, credenciais);
      } catch (err) {
        mostrarErro(formResgate, err.message);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------

const ROTAS = {
  '/': telaVagas,
  '/publicar': telaPublicar,
  '/gerenciar': telaGerenciar,
  '/canal': telaCanal,
  '/denunciar': telaDenunciar,
  '/acompanhar': telaAcompanhar,
};
const ROTAS_CANAL = ['/canal', '/denunciar', '/acompanhar'];

function renderizar() {
  const rota = location.hash.slice(1) || '/';
  botaoSair.hidden = !ROTAS_CANAL.includes(rota);
  window.scrollTo(0, 0);
  (ROTAS[rota] || telaVagas)();
}

// Links internos substituem a entrada do histórico em vez de criar uma nova
document.addEventListener('click', e => {
  const link = e.target.closest('a[href^="#/"]');
  if (!link) return;
  e.preventDefault();
  ir(link.getAttribute('href').slice(1));
});

botaoSair.addEventListener('click', () => {
  tela.innerHTML = '';
  location.replace(SAIDA_RAPIDA);
});

window.addEventListener('hashchange', renderizar);
renderizar();
