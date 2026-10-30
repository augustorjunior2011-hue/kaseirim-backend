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
  if (opcoes.token) config.headers.Authorization = 'Bearer ' + opcoes.token;
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

const MOTIVOS_DENUNCIA_VAGA = {
  golpe: 'Parece golpe',
  cobra_taxa: 'Pede dinheiro / taxa',
  vaga_inexistente: 'Vaga não existe',
  conteudo_ofensivo: 'Conteúdo ofensivo',
  outro: 'Outro motivo',
};

const AVISO_GOLPE = `
  <div class="aviso aviso-golpe"><strong>Cuidado com golpes:</strong> nenhuma empresa séria cobra
    para contratar. Não pague taxa, curso, uniforme ou exame para conseguir uma vaga.</div>`;

function cartaoVaga(v) {
  const whats = `https://wa.me/55${v.telefone_contato}`;
  return `
    <article class="cartao ${v.destaque ? 'destaque' : ''}" data-vaga="${v.id}">
      <span class="etiqueta">${v.tipo === 'oferta' ? 'Vaga' : 'Procuro trabalho'}</span>
      ${v.destaque ? '<span class="etiqueta">Destaque</span>' : ''}
      <h3>${esc(v.titulo)}</h3>
      <p class="suave">${esc([v.empresa, `${v.cidade}/${v.uf}`, v.salario].filter(Boolean).join(' · '))}</p>
      <p>${esc(v.descricao)}</p>
      <p><a href="tel:${esc(v.telefone_contato)}">${esc(telefoneFormatado(v.telefone_contato))}</a>
        · <a href="${esc(whats)}" target="_blank" rel="noopener noreferrer">WhatsApp</a></p>
      <button type="button" class="link-denunciar">Denunciar anúncio</button>
    </article>`;
}

function formDenunciaVaga() {
  return `
    <form class="form-denuncia-vaga">
      <label>O que há de errado?
        <select name="motivo" required>
          <option value="">Selecione</option>
          ${Object.entries(MOTIVOS_DENUNCIA_VAGA).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
        </select></label>
      <label>Detalhes <span class="suave">(opcional)</span> <input name="detalhe" maxlength="500"></label>
      <button type="submit">Enviar denúncia</button>
    </form>`;
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
      <select name="cidade"><option value="">Todas as cidades</option></select>
    </form>
    ${AVISO_GOLPE}
    <div id="lista"><p class="suave">Carregando...</p></div>
    <a class="botao" href="#/publicar">Anunciar grátis</a>`;

  const filtros = document.getElementById('filtros');
  const lista = document.getElementById('lista');
  const selectCidade = filtros.cidade;

  // Só aparecem cidades que têm anúncios no ar
  async function carregarCidades() {
    const uf = filtros.uf.value;
    const atual = selectCidade.value;
    try {
      const cidades = await api('/empregos/cidades' + (uf ? `?uf=${uf}` : ''));
      selectCidade.innerHTML = '<option value="">Todas as cidades</option>' + cidades.map(c => {
        const rotulo = uf ? c.cidade : `${c.cidade}/${c.uf}`;
        const valor = `${c.cidade}|${c.uf}`;
        return `<option value="${esc(valor)}" ${valor === atual ? 'selected' : ''}>${esc(rotulo)} (${c.total})</option>`;
      }).join('');
    } catch {
      // filtro de cidade é opcional; a lista continua funcionando
    }
  }

  async function carregar() {
    const dados = formDados(filtros);
    if (dados.cidade) {
      const [cidade, uf] = dados.cidade.split('|');
      dados.cidade = cidade;
      dados.uf = uf;
    }
    const params = new URLSearchParams(Object.entries(dados).filter(([, v]) => v));
    try {
      const { vagas } = await api('/empregos?' + params);
      lista.innerHTML = vagas.length ? vagas.map(cartaoVaga).join('')
        : '<p class="suave">Nenhum anúncio encontrado.</p>';
    } catch (e) {
      lista.innerHTML = `<p class="erro">${esc(e.message)}</p>`;
    }
  }

  let espera;
  filtros.addEventListener('input', e => {
    if (e.target.name === 'uf') {
      selectCidade.value = '';
      carregarCidades();
    }
    clearTimeout(espera);
    espera = setTimeout(carregar, 300);
  });
  filtros.addEventListener('submit', e => { e.preventDefault(); carregar(); });

  // Denunciar anúncio: abre um formulário dentro do próprio cartão
  lista.addEventListener('click', e => {
    const botao = e.target.closest('.link-denunciar');
    if (!botao) return;
    const cartao = botao.closest('[data-vaga]');
    botao.remove();
    cartao.insertAdjacentHTML('beforeend', formDenunciaVaga());
    const form = cartao.querySelector('.form-denuncia-vaga');
    form.addEventListener('submit', ev => {
      ev.preventDefault();
      enviando(form.querySelector('button'), async () => {
        try {
          const r = await api(`/empregos/${cartao.dataset.vaga}/denunciar`, { method: 'POST', json: formDados(form) });
          form.outerHTML = `<p class="suave">${esc(r.message)}</p>`;
        } catch (err) {
          mostrarErro(form, err.message);
        }
      });
    });
  });

  carregarCidades();
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
      <p id="aviso-aprovacao" class="suave">Vagas de empresas são conferidas pela nossa equipe antes de ir para o ar.</p>
      <label>Título <input name="titulo" required maxlength="150" placeholder="Ex.: Auxiliar de cozinha"></label>
      <label>Descrição <textarea name="descricao" required maxlength="5000"
        placeholder="Horário, requisitos, benefícios ou sua experiência"></textarea></label>
      <label>Empresa <span class="suave">(opcional)</span> <input name="empresa" maxlength="150"></label>
      <label>Salário <span class="suave">(opcional)</span> <input name="salario" maxlength="60" placeholder="Ex.: R$ 1.800"></label>
      <label>Cidade <input name="cidade" required maxlength="100" list="cidades-conhecidas" autocomplete="off"></label>
      <datalist id="cidades-conhecidas"></datalist>
      <label>UF <select name="uf" required>${opcoesUF()}</select></label>
      <label>Telefone / WhatsApp para contato
        <input name="telefone_contato" required inputmode="tel" placeholder="(21) 99999-0000"></label>
      <button type="submit">Publicar anúncio</button>
    </form>`;

  const form = document.getElementById('form-vaga');
  form.querySelectorAll('input[name="tipo"]').forEach(r => r.addEventListener('change', () => {
    document.getElementById('aviso-aprovacao').hidden = form.tipo.value !== 'oferta';
  }));

  // Sugere cidades já usadas, para todo mundo escrever o nome do mesmo jeito
  api('/empregos/cidades').then(cidades => {
    document.getElementById('cidades-conhecidas').innerHTML =
      [...new Set(cidades.map(c => c.cidade))].map(c => `<option value="${esc(c)}">`).join('');
  }).catch(() => {});

  form.addEventListener('submit', e => {
    e.preventDefault();
    enviando(form.querySelector('button'), async () => {
      try {
        const r = await api('/empregos', { method: 'POST', json: formDados(form) });
        const noAr = r.status === 'aprovada';
        tela.innerHTML = `
          <h1>${noAr ? 'Anúncio publicado' : 'Anúncio enviado para aprovação'}</h1>
          ${noAr ? '' : `<div class="aviso">Nossa equipe vai conferir o anúncio. Quando for aprovado,
            ele aparece na lista de vagas.</div>`}
          <p style="margin-top:12px">Para remover o anúncio depois, você vai precisar destes dados. Anote:</p>
          <div class="credenciais">Nº ${r.vaga.id}<br>${esc(r.codigo_gestao)}
            <small>Número do anúncio e código de gestão</small></div>
          <p class="suave" style="margin-top:12px">O anúncio fica no ar por 30 dias${noAr ? '' : ' a partir da aprovação'}.
            Com esses dados você também pode <strong>destacar o anúncio</strong> em "Gerenciar meu anúncio".</p>
          <a class="botao" href="#/">Ver anúncios</a>`;
      } catch (err) {
        mostrarErro(form, err.message);
      }
    });
  });
}

const STATUS_ANUNCIO = {
  pendente: 'Aguardando aprovação da equipe',
  aprovada: 'No ar',
  rejeitada: 'Não aprovado',
};

function dataBR(iso) {
  return iso ? new Date(iso + (iso.endsWith('Z') ? '' : 'Z')).toLocaleDateString('pt-BR') : '';
}

function reais(valor) {
  return 'R$ ' + Number(valor).toFixed(2).replace('.', ',');
}

function telaGerenciar() {
  tela.innerHTML = `
    <h1>Gerenciar meu anúncio</h1>
    <form id="form-gerenciar">
      <label>Número do anúncio <input name="id" required inputmode="numeric"></label>
      <label>Código de gestão <input name="codigo_gestao" required autocapitalize="characters" autocomplete="off"
        placeholder="VG-XXXX-XXXX-XXXX"></label>
      <button type="submit">Entrar</button>
    </form>`;

  const form = document.getElementById('form-gerenciar');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const { id, codigo_gestao } = formDados(form);
    enviando(form.querySelector('button'), async () => {
      try {
        const vaga = await api(`/empregos/${encodeURIComponent(id)}/gestao`, { method: 'POST', json: { codigo_gestao } });
        meuAnuncio(vaga, codigo_gestao.trim());
      } catch (err) {
        mostrarErro(form, err.message);
      }
    });
  });
}

async function meuAnuncio(vaga, codigo) {
  tela.innerHTML = `
    <h1>Meu anúncio</h1>
    <div class="cartao ${vaga.destaque ? 'destaque' : ''}">
      <span class="etiqueta">Nº ${vaga.id}</span>
      <span class="etiqueta">${esc(STATUS_ANUNCIO[vaga.status] || vaga.status)}</span>
      ${vaga.destaque ? '<span class="etiqueta">Destaque</span>' : ''}
      <h3>${esc(vaga.titulo)}</h3>
      <p class="suave">${esc([vaga.empresa, `${vaga.cidade}/${vaga.uf}`, vaga.salario].filter(Boolean).join(' · '))}</p>
      ${vaga.no_ar ? `<p class="suave">No ar até ${dataBR(vaga.expira_em)}</p>` : ''}
      ${vaga.destaque ? `<p class="suave">Em destaque até ${dataBR(vaga.destaque_ate)}</p>` : ''}
      ${vaga.motivo_rejeicao ? `<p class="erro">Motivo: ${esc(vaga.motivo_rejeicao)}</p>` : ''}
    </div>
    <div id="area-destaque"></div>
    <button type="button" class="secundario" id="remover">Remover anúncio</button>`;

  document.getElementById('remover').addEventListener('click', async e => {
    if (!confirm('Remover este anúncio?')) return;
    await enviando(e.target, async () => {
      try {
        await api(`/empregos/${vaga.id}`, { method: 'DELETE', json: { codigo_gestao: codigo } });
        tela.innerHTML = '<h1>Anúncio removido</h1><a class="botao" href="#/">Voltar</a>';
      } catch (err) {
        alert(err.message);
      }
    });
  });

  if (!vaga.no_ar) return;
  let planos;
  try {
    planos = await api('/empregos/destaque/planos');
  } catch {
    return;
  }
  if (!planos.disponivel) return;

  const area = document.getElementById('area-destaque');
  area.innerHTML = `
    <div class="cartao">
      <h3>${vaga.destaque ? 'Aumentar o destaque' : 'Destacar anúncio'}</h3>
      <p class="suave">Anúncios em destaque aparecem no topo da lista, em amarelo.</p>
      <form id="form-destaque">
        <div class="opcoes">
          ${planos.planos.map((p, i) => `<label><input type="radio" name="dias" value="${p.dias}" ${i ? '' : 'checked'}>
            ${p.dias} dias<br><strong>${reais(p.valor)}</strong></label>`).join('')}
        </div>
        <button type="submit">Pagar com PIX</button>
      </form>
    </div>`;

  const formDestaque = document.getElementById('form-destaque');
  formDestaque.addEventListener('submit', e => {
    e.preventDefault();
    enviando(formDestaque.querySelector('button'), async () => {
      try {
        const pix = await api(`/empregos/${vaga.id}/destaque`, {
          method: 'POST', json: { codigo_gestao: codigo, dias: Number(formDestaque.dias.value) },
        });
        telaPix(pix, vaga, codigo);
      } catch (err) {
        mostrarErro(formDestaque, err.message);
      }
    });
  });
}

function telaPix(pix, vaga, codigo) {
  tela.innerHTML = `
    <h1>Pague com PIX</h1>
    <p>Destaque de <strong>${pix.dias} dias</strong> para o anúncio Nº ${vaga.id}: <strong>${reais(pix.valor)}</strong></p>
    ${pix.qr_code_base64 ? `<img class="qr-pix" src="data:image/png;base64,${esc(pix.qr_code_base64)}" alt="QR code do PIX">` : ''}
    <label>PIX copia e cola <textarea id="pix-copia" readonly>${esc(pix.qr_code || '')}</textarea></label>
    <button type="button" id="copiar">Copiar código PIX</button>
    <p id="status-pix" class="aviso" style="margin-top:16px">Aguardando pagamento... Esta tela atualiza sozinha.</p>
    <p class="suave">O código vale por 30 minutos.</p>`;

  document.getElementById('copiar').addEventListener('click', async e => {
    const campo = document.getElementById('pix-copia');
    try {
      await navigator.clipboard.writeText(campo.value);
    } catch {
      campo.select();
      document.execCommand('copy');
    }
    e.target.textContent = 'Copiado!';
  });

  const fim = new Date(pix.expira_em + 'Z').getTime();
  const rotaAtual = location.hash;
  const verificar = async () => {
    if (location.hash !== rotaAtual || !document.getElementById('status-pix')) return;  // saiu da tela
    try {
      const st = await api(`/empregos/destaque/${pix.id}/status`, { method: 'POST', json: { codigo_gestao: codigo } });
      const aviso = document.getElementById('status-pix');
      if (st.status === 'aprovado') {
        aviso.innerHTML = `<strong>Pagamento confirmado!</strong> Seu anúncio está em destaque até ${dataBR(st.destaque_ate)}.`;
        aviso.classList.add('sucesso');
        return;
      }
      if (st.status === 'cancelado') {
        aviso.textContent = 'O pagamento não foi concluído. Volte e gere um novo PIX.';
        return;
      }
    } catch {
      // tenta de novo no próximo ciclo
    }
    if (Date.now() < fim) setTimeout(verificar, 5000);
    else document.getElementById('status-pix').textContent = 'O código PIX expirou. Volte e gere um novo.';
  };
  setTimeout(verificar, 5000);
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
    <p class="suave" style="margin-top:16px">Denúncia falsa é crime (art. 339 do Código Penal).</p>`;
}

async function telaDenunciar() {
  tela.innerHTML = `
    <h1>Fazer denúncia</h1>
    <form id="form-denuncia">
      <label>Tipo de crime <select name="categoria" required><option value="">Carregando...</option></select></label>

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
  try {
    const categorias = await api('/denuncias/categorias');
    select.innerHTML = '<option value="">Selecione</option>' +
      categorias.map(c => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join('');
  } catch (err) {
    mostrarErro(form, err.message);
  }

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
      a denúncia nem conversar com a equipe. Não guardamos uma cópia e não conseguimos recuperar.</div>
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

function mostrarAndamento(d, credenciais) {
  const area = document.getElementById('andamento');
  area.innerHTML = `
    <div class="cartao">
      <span class="etiqueta">${esc(d.categoria)}</span>
      <h3>${esc(STATUS[d.status] || d.status)}</h3>
      <p class="suave">Protocolo ${esc(d.protocolo)} · enviada em ${esc(d.criada_em)}</p>
    </div>
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

}

// ---------------------------------------------------------------------------
// Painel da equipe (moderação de anúncios). Não há link para ele no site: acesse /#/equipe.
// O token fica só na memória da página; recarregar pede de novo.
// ---------------------------------------------------------------------------

let tokenEquipe = '';

const ABAS_EQUIPE = {
  pendente: 'Aguardando aprovação',
  aprovada: 'No ar',
  rejeitada: 'Rejeitados',
};

function entrarEquipe(proximo) {
  tela.innerHTML = `
    <h1>Painel da equipe</h1>
    <form id="form-token">
      <label>Token de acesso <input name="token" type="password" required autocomplete="off"></label>
      <button type="submit">Entrar</button>
    </form>`;
  const form = document.getElementById('form-token');
  form.addEventListener('submit', e => {
    e.preventDefault();
    enviando(form.querySelector('button'), async () => {
      try {
        await api('/analise/empregos', { token: form.token.value });
        tokenEquipe = form.token.value;
        proximo();
      } catch (err) {
        mostrarErro(form, err.message);
      }
    });
  });
}

function navEquipe(ativa) {
  return `
    <nav class="nav-equipe">
      <a href="#/equipe" class="${ativa === 'anuncios' ? 'ativa' : ''}">Anúncios</a>
      <a href="#/equipe/denuncias" class="${ativa === 'denuncias' ? 'ativa' : ''}">Denúncias</a>
    </nav>`;
}

function telaEquipe() {
  if (!tokenEquipe) return entrarEquipe(telaEquipe);

  tela.innerHTML = `
    ${navEquipe('anuncios')}
    <h1>Moderação de anúncios</h1>
    <div class="opcoes" id="abas">
      ${Object.entries(ABAS_EQUIPE).map(([k, v], i) =>
        `<label><input type="radio" name="aba" value="${k}" ${i ? '' : 'checked'}> ${v}</label>`).join('')}
    </div>
    <div id="fila" style="margin-top:12px"></div>`;

  const fila = document.getElementById('fila');

  async function carregar() {
    const status = document.querySelector('input[name="aba"]:checked').value;
    fila.innerHTML = '<p class="suave">Carregando...</p>';
    try {
      const vagas = await api(`/analise/empregos?status=${status}`, { token: tokenEquipe });
      fila.innerHTML = vagas.length ? vagas.map(cartaoModeracao).join('')
        : '<p class="suave">Nenhum anúncio aqui.</p>';
    } catch (err) {
      fila.innerHTML = `<p class="erro">${esc(err.message)}</p>`;
    }
  }

  document.getElementById('abas').addEventListener('change', carregar);

  fila.addEventListener('click', async e => {
    const botao = e.target.closest('button[data-acao]');
    if (!botao) return;
    const id = botao.closest('[data-vaga]').dataset.vaga;
    const acao = botao.dataset.acao;
    let motivo = '';
    if (acao === 'rejeitar') {
      motivo = prompt('Motivo (opcional):', '');
      if (motivo === null) return;
    }
    if (acao === 'remover' && !confirm('Remover este anúncio definitivamente?')) return;
    const pedidos = {
      aprovar: [`/analise/empregos/${id}/aprovar`, 'POST', {}],
      rejeitar: [`/analise/empregos/${id}/rejeitar`, 'POST', { motivo }],
      destaque: [`/analise/empregos/${id}/destaque`, 'POST', { dias: 7 }],
      remover: [`/analise/empregos/${id}`, 'DELETE', {}],
    };
    const [caminho, method, json] = pedidos[acao];
    await enviando(botao, async () => {
      try {
        await api(caminho, { method, json, token: tokenEquipe });
        carregar();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  carregar();
}

function cartaoModeracao(v) {
  const denuncias = v.denuncias.map(d =>
    `<li>${esc(MOTIVOS_DENUNCIA_VAGA[d.motivo] || d.motivo)}${d.detalhe ? `: ${esc(d.detalhe)}` : ''} <span class="suave">(${esc(d.data)})</span></li>`).join('');
  const botoes = {
    pendente: [['aprovar', 'Aprovar'], ['rejeitar', 'Rejeitar']],
    aprovada: [['destaque', 'Destaque 7 dias'], ['rejeitar', 'Tirar do ar']],
    rejeitada: [['aprovar', 'Aprovar mesmo assim']],
  }[v.status];
  return `
    <article class="cartao" data-vaga="${v.id}">
      <span class="etiqueta">Nº ${v.id}</span>
      <span class="etiqueta">${v.tipo === 'oferta' ? 'Vaga' : 'Procuro trabalho'}</span>
      ${v.destaque ? '<span class="etiqueta">Destaque</span>' : ''}
      ${v.motivo_moderacao ? `<p class="erro" style="margin-top:8px">${esc(v.motivo_moderacao)}</p>` : ''}
      <h3>${esc(v.titulo)}</h3>
      <p class="suave">${esc([v.empresa, `${v.cidade}/${v.uf}`, v.salario, telefoneFormatado(v.telefone_contato)].filter(Boolean).join(' · '))}</p>
      <p>${esc(v.descricao)}</p>
      ${denuncias ? `<p><strong>Denúncias de usuários:</strong></p><ul>${denuncias}</ul>` : ''}
      <div class="acoes">
        ${botoes.map(([acao, rotulo]) => `<button type="button" data-acao="${acao}">${rotulo}</button>`).join('')}
        <button type="button" class="secundario" data-acao="remover">Remover</button>
      </div>
    </article>`;
}

// ---------------------------------------------------------------------------
// Painel da equipe: análise das denúncias
// ---------------------------------------------------------------------------

const FACCIONADO = { sim: 'Sim', nao: 'Não', nao_sei: 'Não sabe' };
let nomesCategorias = null;

async function carregarNomesCategorias() {
  if (!nomesCategorias) {
    const categorias = await api('/denuncias/categorias');
    nomesCategorias = Object.fromEntries(categorias.map(c => [c.id, c.nome]));
  }
  return nomesCategorias;
}

async function telaEquipeDenuncias() {
  if (!tokenEquipe) return entrarEquipe(telaEquipeDenuncias);

  tela.innerHTML = `
    ${navEquipe('denuncias')}
    <h1>Denúncias</h1>
    <form id="filtros-denuncias" class="filtros">
      <select name="status">
        <option value="">Todos os status</option>
        ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === 'recebida' ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
      <select name="categoria"><option value="">Todos os crimes</option></select>
      <label class="check"><input type="checkbox" name="grave" value="1"> Só crimes graves</label>
    </form>
    <div id="lista-denuncias"><p class="suave">Carregando...</p></div>`;

  const filtros = document.getElementById('filtros-denuncias');
  const lista = document.getElementById('lista-denuncias');
  const nomes = await carregarNomesCategorias();
  filtros.categoria.insertAdjacentHTML('beforeend',
    Object.entries(nomes).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join(''));

  async function carregar() {
    const params = new URLSearchParams(Object.entries(formDados(filtros)).filter(([, v]) => v));
    lista.innerHTML = '<p class="suave">Carregando...</p>';
    try {
      const { denuncias, total } = await api('/analise/denuncias?' + params, { token: tokenEquipe });
      lista.innerHTML = `<p class="suave">${total} denúncia(s)</p>` + (denuncias.length
        ? denuncias.map(d => `
          <article class="cartao clicavel" data-denuncia="${d.id}">
            <span class="etiqueta">${esc(nomes[d.categoria] || d.categoria)}</span>
            ${d.grave ? '<span class="etiqueta etiqueta-grave">Grave</span>' : ''}
            ${d.fotos.length ? `<span class="etiqueta">${d.fotos.length} foto(s)</span>` : ''}
            <h3>${esc(STATUS[d.status] || d.status)}</h3>
            <p class="suave">${esc([d.localizacao.cidade && `${d.localizacao.cidade}/${d.localizacao.uf || ''}`, d.criada_em].filter(Boolean).join(' · '))}</p>
            <p>${esc(d.descricao.length > 160 ? d.descricao.slice(0, 160) + '…' : d.descricao)}</p>
          </article>`).join('')
        : '<p class="suave">Nenhuma denúncia aqui.</p>');
    } catch (err) {
      lista.innerHTML = `<p class="erro">${esc(err.message)}</p>`;
    }
  }

  filtros.addEventListener('change', carregar);
  lista.addEventListener('click', e => {
    const cartao = e.target.closest('[data-denuncia]');
    if (cartao) detalheDenuncia(cartao.dataset.denuncia, nomes);
  });
  carregar();
}

async function fotoComToken(fotoId) {
  const resp = await fetch(`/api/analise/fotos/${fotoId}`, {
    headers: { Authorization: 'Bearer ' + tokenEquipe }, credentials: 'omit', cache: 'no-store',
  });
  if (!resp.ok) throw new Error('Não foi possível carregar a foto');
  return URL.createObjectURL(await resp.blob());
}

async function detalheDenuncia(id, nomes) {
  tela.innerHTML = '<p class="suave">Carregando...</p>';
  let d;
  try {
    d = await api(`/analise/denuncias/${id}`, { token: tokenEquipe });
  } catch (err) {
    tela.innerHTML = `<p class="erro">${esc(err.message)}</p>`;
    return;
  }
  const loc = d.localizacao;
  const sus = d.suspeito;
  const temPonto = loc.latitude != null && loc.longitude != null;

  const linha = (rotulo, valor) => valor ? `<p><strong>${rotulo}:</strong> ${esc(valor)}</p>` : '';

  window.scrollTo(0, 0);
  tela.innerHTML = `
    ${navEquipe('denuncias')}
    <button type="button" class="secundario" id="voltar-lista">← Voltar para a lista</button>
    <h1 style="margin-top:16px">${esc(nomes[d.categoria] || d.categoria)}</h1>
    <p class="suave">Protocolo ${esc(d.protocolo)} · recebida em ${esc(d.criada_em)}
      ${d.grave ? ' · <strong class="texto-grave">crime grave</strong>' : ''}</p>

    <div class="cartao">
      <h3>O que aconteceu</h3>
      <p class="texto-livre">${esc(d.descricao)}</p>
      ${linha('Quando', d.data_ocorrencia)}
    </div>

    <div class="cartao">
      <h3>Onde</h3>
      ${linha('Referência', loc.referencia)}
      ${linha('Cidade', [loc.cidade, loc.uf].filter(Boolean).join('/'))}
      ${temPonto ? `<p class="suave">${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}</p><div id="mapa"></div>`
        : '<p class="suave">Sem ponto marcado no mapa.</p>'}
    </div>

    <div class="cartao">
      <h3>Suspeito</h3>
      ${linha('Nome', sus.nome)}
      ${linha('Apelidos', sus.apelidos)}
      ${linha('Características', sus.caracteristicas)}
      ${linha('Faccionado', FACCIONADO[sus.faccionado] || sus.faccionado)}
      ${linha('Facção', sus.faccao)}
      ${!sus.nome && !sus.apelidos && !sus.caracteristicas ? '<p class="suave">Sem dados do suspeito.</p>' : ''}
    </div>

    ${d.fotos.length ? `<div class="cartao"><h3>Fotos</h3><div class="fotos" id="fotos"></div></div>` : ''}

    <div class="cartao">
      <h3>Análise</h3>
      <form id="form-analise">
        <label>Status
          <select name="status">${Object.entries(STATUS).map(([k, v]) =>
            `<option value="${k}" ${k === d.status ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Parecer interno <span class="suave">(o denunciante não vê)</span>
          <textarea name="parecer_analise">${esc(d.parecer_analise || '')}</textarea></label>
        <button type="submit">Salvar análise</button>
      </form>
    </div>

    <div class="cartao">
      <h3>Conversa com o denunciante</h3>
      <div id="mensagens-equipe">${mensagensHTML(d.mensagens)}</div>
      <form id="form-msg-equipe">
        <label>Nova mensagem <span class="suave">(o denunciante vê ao acompanhar)</span>
          <textarea name="texto" required maxlength="3000" placeholder="Ex.: Você sabe o horário em que ele costuma estar no local?"></textarea></label>
        <button type="submit">Enviar mensagem</button>
      </form>
    </div>`;

  document.getElementById('voltar-lista').addEventListener('click', telaEquipeDenuncias);

  if (temPonto) {
    const mapa = L.map('mapa').setView([loc.latitude, loc.longitude], 16);
    L.tileLayer('/api/mapa/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(mapa);
    L.marker([loc.latitude, loc.longitude]).addTo(mapa);
  }

  if (d.fotos.length) {
    const area = document.getElementById('fotos');
    for (const fotoId of d.fotos) {
      try {
        const url = await fotoComToken(fotoId);
        area.insertAdjacentHTML('beforeend', `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="Foto da denúncia"></a>`);
      } catch (err) {
        area.insertAdjacentHTML('beforeend', `<p class="erro">${esc(err.message)}</p>`);
      }
    }
  }

  const formAnalise = document.getElementById('form-analise');
  formAnalise.addEventListener('submit', e => {
    e.preventDefault();
    enviando(formAnalise.querySelector('button'), async () => {
      try {
        await api(`/analise/denuncias/${id}`, { method: 'PUT', json: formDados(formAnalise), token: tokenEquipe });
        mostrarErro(formAnalise, 'Análise salva.');
        formAnalise.querySelector('.erro').classList.add('sucesso');
      } catch (err) {
        mostrarErro(formAnalise, err.message);
      }
    });
  });

  const formMsg = document.getElementById('form-msg-equipe');
  formMsg.addEventListener('submit', e => {
    e.preventDefault();
    enviando(formMsg.querySelector('button'), async () => {
      try {
        const atual = await api(`/analise/denuncias/${id}/mensagens`, {
          method: 'POST', json: formDados(formMsg), token: tokenEquipe,
        });
        document.getElementById('mensagens-equipe').innerHTML = mensagensHTML(atual.mensagens);
        formMsg.reset();
      } catch (err) {
        mostrarErro(formMsg, err.message);
      }
    });
  });
}

function mensagensHTML(mensagens) {
  return mensagens.length ? mensagens.map(m => `
    <div class="mensagem ${m.autor === 'equipe' ? 'equipe' : 'cidadao'}">
      <strong>${m.autor === 'equipe' ? 'Equipe' : 'Denunciante'}:</strong> ${esc(m.texto)}
      <span class="suave">(${esc(m.data)})</span>
    </div>`).join('') : '<p class="suave">Nenhuma mensagem ainda.</p>';
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
  '/equipe': telaEquipe,
  '/equipe/denuncias': telaEquipeDenuncias,
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
