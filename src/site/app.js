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

const ICONES = {
  busca: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  local: '<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  dinheiro: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
  telefone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  conversa: '<path d="M21 12a9 9 0 0 1-13.5 7.8L3 21l1.2-4.4A9 9 0 1 1 21 12z"/>',
  estrela: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  escudo: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
  alerta: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="M12 8v5M12 16.5v.01"/>',
  cadeado: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  foto: '<rect x="3" y="5" width="18" height="15" rx="2"/><circle cx="12" cy="12.5" r="3.5"/><path d="M8 5l1.5-2h5L16 5"/>',
  olho: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  mais: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
};

function icone(nome) {
  return `<svg class="icone" viewBox="0 0 24 24" aria-hidden="true">${ICONES[nome]}</svg>`;
}

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
  if (resp.status === 401 && opcoes.token) {
    // sessão da equipe expirou: limpa e mostra o login de novo
    tokenEquipe = '';
    setTimeout(renderizar, 1500);
  }
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
  <div class="aviso aviso-golpe">${icone('escudo')}<span><strong>Cuidado com golpes:</strong> nenhuma empresa séria
    cobra para contratar. Não pague taxa, curso, uniforme ou exame para conseguir uma vaga.</span></div>`;

function tempoAtras(iso) {
  if (!iso) return '';
  const minutos = Math.max(1, Math.round((Date.now() - new Date(iso + (iso.endsWith('Z') ? '' : 'Z'))) / 60000));
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.round(horas / 24);
  return dias === 1 ? 'ontem' : `há ${dias} dias`;
}

function cartaoVaga(v) {
  const whats = `https://wa.me/55${v.telefone_contato}`;
  const oferta = v.tipo === 'oferta';
  return `
    <article class="vaga ${v.destaque ? 'destaque' : ''}" data-vaga="${v.id}">
      ${v.destaque ? `<span class="selo-destaque">${icone('estrela')} Destaque</span>` : ''}
      <div class="vaga-topo">
        <span class="etiqueta ${oferta ? '' : 'procura'}">${oferta ? 'Vaga' : 'Procura trabalho'}</span>
        <span class="vaga-data">${tempoAtras(v.criada_em)}</span>
      </div>
      <h3>${esc(v.titulo)}</h3>
      ${v.empresa ? `<p class="vaga-empresa">${esc(v.empresa)}</p>` : ''}
      <ul class="vaga-info">
        <li>${icone('local')} ${esc(v.cidade)}/${esc(v.uf)}</li>
        ${v.salario ? `<li class="salario">${icone('dinheiro')} ${esc(v.salario)}</li>` : ''}
      </ul>
      <p class="vaga-desc">${esc(v.descricao)}</p>
      <div class="vaga-acoes">
        <a class="botao-whats" href="${esc(whats)}" target="_blank" rel="noopener noreferrer">${icone('conversa')} WhatsApp</a>
        <a class="botao-ligar" href="tel:${esc(v.telefone_contato)}">${icone('telefone')} Ligar</a>
      </div>
      <button type="button" class="link-denunciar">Reportar golpe ou problema</button>
    </article>`;
}

function formDenunciaVaga() {
  return `
    <form class="form-denuncia-vaga">
      <label>O que há de errado com este anúncio?
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
    <section class="hero">
      <p class="hero-kicker">Vagas perto de você</p>
      <h1>Encontre trabalho ou quem contratar</h1>
      <form id="filtros" role="search">
        <div class="campo-busca">${icone('busca')}
          <input name="busca" type="search" placeholder="Cargo, função ou palavra" aria-label="Buscar vagas"></div>
        <div class="chips" role="radiogroup" aria-label="Tipo de anúncio">
          <label><input type="radio" name="tipo" value="" checked> Todos</label>
          <label><input type="radio" name="tipo" value="oferta"> Vagas</label>
          <label><input type="radio" name="tipo" value="procura"> Quem procura trabalho</label>
        </div>
        <div class="linha-filtros">
          <select name="uf" aria-label="Estado">${opcoesUF()}</select>
          <select name="cidade" aria-label="Cidade"><option value="">Todas as cidades</option></select>
        </div>
      </form>
    </section>
    ${AVISO_GOLPE}
    <p class="contagem" id="contagem"></p>
    <div id="lista"><div class="carregando"></div><div class="carregando"></div></div>
    <a class="botao" href="#/publicar">${icone('mais')} Anunciar grátis</a>`;

  const filtros = document.getElementById('filtros');
  const lista = document.getElementById('lista');
  const contagem = document.getElementById('contagem');
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
      const { vagas, total } = await api('/empregos?' + params);
      contagem.textContent = total === 1 ? '1 anúncio' : `${total} anúncios`;
      lista.innerHTML = vagas.length ? vagas.map(cartaoVaga).join('') : `
        <div class="vazio"><strong>Nenhum anúncio por aqui ainda</strong>
          Tente outra cidade ou palavra, ou seja o primeiro a anunciar.</div>`;
    } catch (e) {
      lista.innerHTML = `<p class="erro">${esc(e.message)}</p>`;
    }
  }

  let espera;
  const agendar = e => {
    if (e.target.name === 'uf') {
      selectCidade.value = '';
      carregarCidades();
    }
    clearTimeout(espera);
    espera = setTimeout(carregar, e.target.name === 'busca' ? 300 : 0);
  };
  filtros.addEventListener('input', agendar);
  filtros.addEventListener('change', e => { if (e.target.type === 'radio') agendar(e); });
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
    <h1>Anunciar grátis</h1>
    <p class="suave">Leva 1 minuto. Sem cadastro.</p>
    <form id="form-vaga">
      <div class="opcoes">
        <label><input type="radio" name="tipo" value="oferta" checked> Tenho uma vaga</label>
        <label><input type="radio" name="tipo" value="procura"> Procuro trabalho</label>
      </div>
      <p id="aviso-aprovacao" class="aviso" style="margin-top:12px">Vagas de empresas são conferidas pela nossa equipe antes de aparecer na lista.</p>
      <label>Título <input name="titulo" required maxlength="150" placeholder="Ex.: Auxiliar de cozinha"></label>
      <label>Descrição <textarea name="descricao" required maxlength="5000"
        placeholder="Horário, requisitos, benefícios ou sua experiência"></textarea></label>
      <label>Empresa <span class="suave">(opcional)</span> <input name="empresa" maxlength="150"></label>
      <label>Salário <span class="suave">(opcional)</span> <input name="salario" id="salario" maxlength="60" placeholder="Ex.: R$ 1.800"></label>
      <label class="check"><input type="checkbox" id="salario-combinar"> A combinar</label>
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

  const campoSalario = document.getElementById('salario');
  const aCombinar = document.getElementById('salario-combinar');
  aCombinar.addEventListener('change', () => {
    campoSalario.disabled = aCombinar.checked;
    if (aCombinar.checked) campoSalario.value = '';
  });

  // Sugere cidades já usadas, para todo mundo escrever o nome do mesmo jeito
  api('/empregos/cidades').then(cidades => {
    document.getElementById('cidades-conhecidas').innerHTML =
      [...new Set(cidades.map(c => c.cidade))].map(c => `<option value="${esc(c)}">`).join('');
  }).catch(() => {});

  form.addEventListener('submit', e => {
    e.preventDefault();
    enviando(form.querySelector('button'), async () => {
      try {
        const dados = formDados(form);
        if (aCombinar.checked) dados.salario = 'A combinar';
        const r = await api('/empregos', { method: 'POST', json: dados });
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
    <div class="cartao encerrar">
      <h3>${vaga.tipo === 'oferta' ? 'A vaga já foi preenchida?' : 'Já conseguiu trabalho?'}</h3>
      <p class="suave">Encerre o anúncio para ele sair da lista e as pessoas pararem de ligar.</p>
      <button type="button" id="encerrar">${icone('check')} ${vaga.tipo === 'oferta' ? 'Vaga preenchida' : 'Já consegui trabalho'}</button>
    </div>
    <div id="area-destaque"></div>
    <button type="button" class="secundario" id="remover">Remover anúncio</button>`;

  document.getElementById('encerrar').addEventListener('click', async e => {
    await enviando(e.target, async () => {
      try {
        const r = await api(`/empregos/${vaga.id}/encerrar`, { method: 'POST', json: { codigo_gestao: codigo } });
        tela.innerHTML = `
          <div class="vazio"><strong>${esc(r.message)}</strong>
            O anúncio saiu da lista. Se precisar de novo, é só anunciar outra vez.</div>
          <a class="botao" href="#/">Ver vagas</a>`;
      } catch (err) {
        alert(err.message);
      }
    });
  });

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
      <p class="suave">Anúncios em destaque aparecem no topo da lista, com selo amarelo.
        ${reais(planos.planos[0].valor)} por semana.</p>
      <form id="form-destaque">
        <div class="opcoes">
          ${planos.planos.map((p, i) => `<label><input type="radio" name="dias" value="${p.dias}" ${i ? '' : 'checked'}>
            ${p.dias / 7 === 1 ? '1 semana' : `${p.dias / 7} semanas`}<br><strong>${reais(p.valor)}</strong></label>`).join('')}
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
    <p>Destaque de <strong>${pix.dias / 7 === 1 ? '1 semana' : `${pix.dias / 7} semanas`}</strong> para o anúncio Nº ${vaga.id}: <strong>${reais(pix.valor)}</strong></p>
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

function explicacaoDenuncia() {
  return `
    <div class="cabeca-denuncia">
      <span class="bolha">${icone('alerta')}</span>
      <div>
        <h2 id="titulo-denuncia" tabindex="-1">Denúncia anônima</h2>
        <p class="suave" style="margin:0">Sem nome, sem CPF, sem cadastro</p>
      </div>
    </div>
    <p>Este é um canal para você informar <strong>crimes que acontecem no seu bairro</strong>, como tráfico de
      drogas ou de armas, violência, abuso ou paradeiro de foragido, <strong>sem se identificar</strong>.</p>

    <h3>Como funciona</h3>
    <ol class="passos">
      <li><span><strong>Conte o que aconteceu.</strong> Escolha o tipo de crime, marque o local no mapa e, se puder,
        envie fotos e os apelidos de quem está envolvido.</span></li>
      <li><span><strong>Anote o protocolo e a chave</strong> que aparecem no final. Eles são a única forma de
        acompanhar a denúncia.</span></li>
      <li><span><strong>Nossa equipe analisa</strong> se há indícios e encaminha as informações às autoridades,
        sem nenhum dado seu.</span></li>
      <li><span><strong>Acompanhe</strong> com o protocolo e a chave. A equipe pode te fazer perguntas por ali,
        sempre no anonimato.</span></li>
    </ol>

    <h3>Seu anonimato</h3>
    <ul class="garantias">
      <li>${icone('cadeado')}<span>Não pedimos nome, CPF, telefone nem e-mail.</span></li>
      <li>${icone('foto')}<span>As fotos perdem a localização e os dados do celular que ficam escondidos nelas.</span></li>
      <li>${icone('olho')}<span>Use a <strong>aba anônima</strong> do navegador e, se alguém se aproximar, toque em
        <strong>Sair rápido</strong>.</span></li>
    </ul>

    <div class="aviso aviso-legal">
      <strong>Importante</strong>
      <ul>
        <li>O Vagaí é uma <strong>iniciativa independente</strong>. Não tem ligação com governo, polícia, Ministério
          Público ou qualquer órgão público, nem com partido ou político.</li>
        <li>Não somos polícia: <strong>não investigamos, não prendemos e não damos retorno sobre operações</strong>.
          Apenas repassamos as informações recebidas às autoridades competentes, como qualquer cidadão pode fazer.</li>
        <li><strong>Não é um serviço de emergência.</strong> Se alguém corre perigo agora, ligue <strong>190</strong>
          (Polícia Militar) ou <strong>192</strong> (SAMU). Este canal não substitui o boletim de ocorrência.</li>
        <li>As informações são de <strong>responsabilidade de quem denuncia</strong>. Denúncia falsa é crime
          (art. 339 do Código Penal).</li>
      </ul>
    </div>

    <a class="botao perigo" href="#/denunciar">${icone('alerta')} Fazer uma denúncia</a>
    <a class="botao secundario" href="#/acompanhar">Acompanhar minha denúncia</a>`;
}

function telaCanal() {
  tela.innerHTML = `<div class="cartao">${explicacaoDenuncia()}</div>`;
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
    <p class="suave">Entre com seu nome, sua senha e o código de 6 dígitos do aplicativo autenticador.</p>
    <form id="form-entrar">
      <label>Nome <input name="nome" required autocomplete="username"></label>
      <label>Senha <input name="senha" type="password" required autocomplete="current-password"></label>
      <label>Código do aplicativo <input name="codigo" required inputmode="numeric" maxlength="6"
        autocomplete="one-time-code" placeholder="000000"></label>
      <button type="submit">Entrar</button>
    </form>
    <button type="button" class="secundario" id="ir-cadastro">Primeiro acesso ou tenho um convite</button>`;

  const form = document.getElementById('form-entrar');
  form.addEventListener('submit', e => {
    e.preventDefault();
    enviando(form.querySelector('button'), async () => {
      try {
        const r = await api('/equipe/entrar', { method: 'POST', json: formDados(form) });
        tokenEquipe = r.token;
        proximo();
      } catch (err) {
        mostrarErro(form, err.message);
      }
    });
  });
  document.getElementById('ir-cadastro').addEventListener('click', () => cadastroEquipe(proximo));

  // Sem nenhuma conta ainda: vai direto para o primeiro acesso
  api('/equipe/estado').then(r => { if (!r.tem_contas) cadastroEquipe(proximo); }).catch(() => {});
}

async function cadastroEquipe(proximo) {
  let primeira = false;
  try {
    primeira = !(await api('/equipe/estado')).tem_contas;
  } catch {
    // segue como convite
  }
  tela.innerHTML = `
    <h1>${primeira ? 'Primeiro acesso' : 'Criar minha conta'}</h1>
    <p class="suave">${primeira
      ? 'Use a <strong>chave de instalação</strong> (a variável ANALISTA_TOKEN configurada no servidor) para criar a primeira conta.'
      : 'Use o <strong>convite</strong> que outra pessoa da equipe gerou para você no painel.'}</p>
    <form id="form-cadastro">
      <label>${primeira ? 'Chave de instalação' : 'Convite'}
        <input name="convite" required autocomplete="off" ${primeira ? 'type="password"' : 'placeholder="CV-XXXX-XXXX-XXXX"'}></label>
      <label>Seu nome <span class="suave">(como vai aparecer no registro)</span>
        <input name="nome" required minlength="2" maxlength="40" autocomplete="username"></label>
      <label>Senha <span class="suave">(pelo menos 10 caracteres)</span>
        <input name="senha" type="password" required minlength="10" autocomplete="new-password"></label>
      <label>Repita a senha <input name="senha2" type="password" required autocomplete="new-password"></label>
      <button type="submit">Continuar</button>
    </form>
    <button type="button" class="secundario" id="voltar-login">Voltar para entrar</button>`;

  document.getElementById('voltar-login').addEventListener('click', () => entrarEquipe(proximo));
  const form = document.getElementById('form-cadastro');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const dados = formDados(form);
    if (dados.senha !== dados.senha2) return mostrarErro(form, 'As duas senhas não são iguais.');
    enviando(form.querySelector('button'), async () => {
      try {
        const cad = await api('/equipe/cadastro', { method: 'POST', json: dados });
        configurarCelular(cad, proximo);
      } catch (err) {
        mostrarErro(form, err.message);
      }
    });
  });
}

function configurarCelular(cad, proximo) {
  tela.innerHTML = `
    <h1>Configure o código no celular</h1>
    <ol class="passos">
      <li><span>Instale um aplicativo autenticador: <strong>Google Authenticator</strong>,
        <strong>Microsoft Authenticator</strong> ou <strong>Authy</strong>.</span></li>
      <li><span>No aplicativo, toque em <strong>+</strong> e escaneie este QR code.</span></li>
      <li><span>Digite abaixo o código de 6 dígitos que aparecer.</span></li>
    </ol>
    <img class="qr-pix" src="${esc(cad.qr_svg)}" alt="QR code para o aplicativo autenticador">
    <p class="suave">Não dá para escanear? Digite esta chave no aplicativo:</p>
    <div class="credenciais">${esc(cad.segredo.replace(/(.{4})/g, '$1 ').trim())}</div>
    <form id="form-confirmar">
      <label>Código do aplicativo <input name="codigo" required inputmode="numeric" maxlength="6"
        autocomplete="one-time-code" placeholder="000000"></label>
      <button type="submit">Confirmar e criar conta</button>
    </form>`;

  const form = document.getElementById('form-confirmar');
  form.addEventListener('submit', e => {
    e.preventDefault();
    enviando(form.querySelector('button'), async () => {
      try {
        await api('/equipe/cadastro/confirmar', { method: 'POST', json: { cadastro_id: cad.cadastro_id, ...formDados(form) } });
        entrarEquipe(proximo);
        const aviso = document.createElement('p');
        aviso.className = 'aviso sucesso';
        aviso.textContent = 'Conta criada! Entre com seu nome, sua senha e um código novo do aplicativo.';
        tela.querySelector('h1').after(aviso);
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
      <a href="#/equipe/contas" class="${ativa === 'contas' ? 'ativa' : ''}">Equipe</a>
    </nav>`;
}

const ACOES_REGISTRO = {
  entrou: 'Entrou no painel',
  saiu: 'Saiu do painel',
  conta_criada: 'Conta criada',
  convite_criado: 'Gerou um convite',
  conta_desativada: 'Desativou a conta de',
  lista_denuncias: 'Abriu a lista de denúncias',
  denuncia_vista: 'Abriu',
  foto_vista: 'Viu foto da',
  denuncia_atualizada: 'Atualizou',
  mensagem_enviada: 'Mandou mensagem na',
  vaga_aprovada: 'Aprovou o',
  vaga_rejeitada: 'Rejeitou o',
  vaga_destaque: 'Destacou o',
  vaga_removida: 'Removeu o',
};

function dataHoraBR(iso) {
  return iso ? new Date(iso + 'Z').toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
}

async function telaEquipeContas() {
  if (!tokenEquipe) return entrarEquipe(telaEquipeContas);

  tela.innerHTML = `
    ${navEquipe('contas')}
    <h1>Equipe</h1>
    <div id="contas"><p class="suave">Carregando...</p></div>
    <button type="button" id="gerar-convite">Convidar uma pessoa</button>
    <div id="convite-gerado"></div>
    <h2>Registro de acessos</h2>
    <p class="suave">Tudo o que a equipe faz no painel fica anotado aqui: quem, o quê e quando.</p>
    <div id="registro"><p class="suave">Carregando...</p></div>
    <button type="button" class="secundario" id="sair-painel">Sair do painel</button>`;

  async function carregar() {
    try {
      const [contas, registro] = await Promise.all([
        api('/equipe/contas', { token: tokenEquipe }),
        api('/equipe/registro', { token: tokenEquipe }),
      ]);
      document.getElementById('contas').innerHTML = contas.map(c => `
        <div class="cartao">
          <span class="etiqueta ${c.ativo ? '' : 'etiqueta-grave'}">${c.ativo ? 'Ativa' : 'Desativada'}</span>
          ${c.sou_eu ? '<span class="etiqueta">Você</span>' : ''}
          <h3>${esc(c.nome)}</h3>
          <p class="suave">Último acesso: ${c.ultimo_acesso ? dataHoraBR(c.ultimo_acesso) : 'nunca'}</p>
          ${c.ativo && !c.sou_eu ? `<button type="button" class="secundario" data-desativar="${c.id}" data-nome="${esc(c.nome)}">Desativar conta</button>` : ''}
        </div>`).join('');
      document.getElementById('registro').innerHTML = registro.length ? `<ul class="registro">${registro.map(r => `
        <li><span class="suave">${dataHoraBR(r.quando)}</span>
          <strong>${esc(r.analista || '—')}</strong> ${esc(ACOES_REGISTRO[r.acao] || r.acao)} ${esc(r.alvo || '')}</li>`).join('')}</ul>`
        : '<p class="suave">Nada registrado ainda.</p>';
    } catch (err) {
      document.getElementById('contas').innerHTML = `<p class="erro">${esc(err.message)}</p>`;
    }
  }

  document.getElementById('contas').addEventListener('click', async e => {
    const botao = e.target.closest('[data-desativar]');
    if (!botao) return;
    if (botao.dataset.confirmar !== '1') {
      botao.dataset.confirmar = '1';
      botao.textContent = `Toque de novo para desativar ${botao.dataset.nome}`;
      return;
    }
    await enviando(botao, async () => {
      try {
        await api(`/equipe/contas/${botao.dataset.desativar}/desativar`, { method: 'POST', token: tokenEquipe });
        carregar();
      } catch (err) {
        botao.textContent = err.message;
      }
    });
  });

  document.getElementById('gerar-convite').addEventListener('click', e => {
    enviando(e.target, async () => {
      try {
        const r = await api('/equipe/convites', { method: 'POST', token: tokenEquipe });
        document.getElementById('convite-gerado').innerHTML = `
          <div class="aviso" style="margin-top:12px">Passe este convite <strong>pessoalmente</strong> para a nova pessoa.
            Ele vale por ${r.validade_horas} horas e só pode ser usado uma vez. Ela abre o painel, toca em
            "Primeiro acesso ou tenho um convite" e cria a própria senha.</div>
          <div class="credenciais" style="margin-top:12px">${esc(r.convite)}</div>`;
        carregar();
      } catch (err) {
        document.getElementById('convite-gerado').innerHTML = `<p class="erro">${esc(err.message)}</p>`;
      }
    });
  });

  document.getElementById('sair-painel').addEventListener('click', async () => {
    try {
      await api('/equipe/sair', { method: 'POST', token: tokenEquipe });
    } catch {
      // a sessão já pode ter expirado
    }
    tokenEquipe = '';
    ir('/');
  });

  carregar();
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
  '/equipe/contas': telaEquipeContas,
};
const ROTAS_CANAL = ['/canal', '/denunciar', '/acompanhar'];

const barra = document.getElementById('barra');
const dialogoDenuncia = document.getElementById('dialogo-denuncia');

function renderizar() {
  const rota = location.hash.slice(1) || '/';
  const noCanal = ROTAS_CANAL.includes(rota);
  botaoSair.hidden = !noCanal;
  // No canal de denúncia a barra some e fica só o "Sair rápido"
  barra.hidden = noCanal;
  document.body.classList.toggle('sem-barra', noCanal);
  barra.querySelectorAll('a[data-rota]').forEach(a => a.classList.toggle('ativa', a.dataset.rota === rota));
  if (dialogoDenuncia.open) dialogoDenuncia.close();
  window.scrollTo(0, 0);
  (ROTAS[rota] || telaVagas)();
}

// Botão vermelho: primeiro explica o que é e como funciona a denúncia
document.getElementById('botao-denuncia').addEventListener('click', () => {
  dialogoDenuncia.innerHTML = explicacaoDenuncia() +
    '<button type="button" class="fechar-folha" id="fechar-denuncia">Agora não</button>';
  document.getElementById('fechar-denuncia').addEventListener('click', () => dialogoDenuncia.close());
  dialogoDenuncia.showModal();
  // abre no topo (o navegador rola até o primeiro botão ao abrir)
  document.getElementById('titulo-denuncia').focus();
  dialogoDenuncia.scrollTop = 0;
});
dialogoDenuncia.addEventListener('click', e => {
  // toque no fundo escuro (fora da folha) fecha
  const r = dialogoDenuncia.getBoundingClientRect();
  if (e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right) dialogoDenuncia.close();
});

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
