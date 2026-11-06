// ── Estado global ──────────────────────────────────────────────
const state = {
  usuario: null,
  loaded: {},
};

const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

// Base web do SUAP (sem o sufixo /api), usada para montar links de projetos.
const SUAP_WEB = 'https://suap.ifpr.edu.br';

// Caminho do detalhe de um projeto no SUAP.
// No SUAP o módulo chama-se "projetos" (atende pesquisa E extensão), e o
// detalhe de um projeto fica em /projetos/projeto/{id}/.
// Atenção: essa página exige login no SUAP — se o aluno não estiver logado
// no suap.ifpr.edu.br, o SUAP redireciona para a tela de login (em vez de
// abrir o projeto). Se a sua instância usar outro caminho, ajuste só aqui.
const SUAP_PROJETO_PATH = 'projetos/projeto';

// Monta o link do projeto no SUAP. Prioriza um link já fornecido pela API
// (a API de projetos normalmente NÃO envia link); caso não exista, constrói
// a partir do id do projeto.
// (O `tipo` só é informado para projetos vindos do SUAP — projetos locais
//  da administração só geram link se o admin tiver preenchido link_suap.)
// Só aceita links http(s) — evita "javascript:" vindo de dados cadastrados.
const urlSegura = (u) => {
  if (!u) return null;
  try { return ['http:', 'https:'].includes(new URL(u, location.origin).protocol) ? u : null; }
  catch (e) { return null; }
};

const linkProjetoSuap = (p, tipo) => {
  const explicito = urlSegura(
    p.link_suap || p.url_publica || p.pagina || p.link_projeto || p.link || p.url);
  if (explicito) return explicito;

  // Só constrói link para projetos do SUAP (tipo informado + id numérico).
  if (tipo && p.id != null) {
    return `${SUAP_WEB}/${SUAP_PROJETO_PATH}/${p.id}/`;
  }
  return null;
};

// ── Aparência e acessibilidade ─────────────────────────────────
// Tudo fica salvo SÓ neste navegador (localStorage). Quem nunca mexeu
// sempre entra no tema escuro. (O head do index.html aplica estas mesmas
// preferências antes da página aparecer, para não "piscar" outro tema.)
const ACESS_KEY = 'ifplenus-acess';
const TEMAS = [
  { id: 'dark',      nome: 'Escuro',              desc: 'Padrão do IFPlenus', cores: ['#1b1b1f', '#26262b', '#44d883'] },
  { id: 'light',     nome: 'Claro',               desc: 'Fundo claro',        cores: ['#f3f8f4', '#fbfdfb', '#198754'] },
  { id: 'hc-escuro', nome: 'Alto contraste escuro', desc: 'Preto, branco e amarelo', cores: ['#000000', '#ffffff', '#ffe500'] },
  { id: 'hc-claro',  nome: 'Alto contraste claro',  desc: 'Branco, preto e azul',    cores: ['#ffffff', '#000000', '#0033a0'] },
  { id: 'daltonico', nome: 'Daltonismo',          desc: 'Azul e laranja no lugar de verde e vermelho', cores: ['#1b1b1f', '#56b4e9', '#e69f00'] },
];
const ACESS_PADRAO = { tema: 'dark', texto: 'normal', fonte: false, espaco: false, links: false, movimento: false };

const lerAcess = () => {
  try { return { ...ACESS_PADRAO, ...(JSON.parse(localStorage.getItem(ACESS_KEY) || '{}') || {}) }; }
  catch (e) { return { ...ACESS_PADRAO }; }
};

const aplicarAcess = (p) => {
  const d = document.documentElement;
  d.setAttribute('data-theme', TEMAS.some(t => t.id === p.tema) ? p.tema : 'dark');
  const attr = (nome, valor) => valor ? d.setAttribute(nome, valor) : d.removeAttribute(nome);
  attr('data-texto', p.texto !== 'normal' ? p.texto : null);
  attr('data-fonte', p.fonte ? 'legivel' : null);
  attr('data-espaco', p.espaco ? 'amplo' : null);
  attr('data-links', p.links ? 'destaque' : null);
  attr('data-movimento', p.movimento ? 'reduzido' : null);
  if (p.fonte && !document.getElementById('fonteLegivel')) {
    const l = document.createElement('link');
    l.id = 'fonteLegivel'; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap';
    document.head.appendChild(l);
  }
  // Atualiza os controles do painel, se estiver aberto
  document.querySelectorAll('[data-acess-tema]').forEach(b => {
    const ativo = b.dataset.acessTema === p.tema;
    b.classList.toggle('active', ativo); b.setAttribute('aria-checked', ativo);
  });
  document.querySelectorAll('[data-acess-texto]').forEach(b => {
    const ativo = b.dataset.acessTexto === p.texto;
    b.classList.toggle('active', ativo); b.setAttribute('aria-checked', ativo);
  });
  ['fonte', 'espaco', 'links', 'movimento'].forEach(k => {
    const el = document.getElementById(`acess-${k}`);
    if (el) el.checked = !!p[k];
  });
};

const definirAcess = (chave, valor) => {
  const p = { ...lerAcess(), [chave]: valor };
  try { localStorage.setItem(ACESS_KEY, JSON.stringify(p)); } catch (e) { /* modo privado */ }
  aplicarAcess(p);
};

const restaurarAcess = () => {
  try { localStorage.removeItem(ACESS_KEY); } catch (e) { /* ignore */ }
  aplicarAcess({ ...ACESS_PADRAO });
  aviso('Aparência restaurada para o padrão.', 'ok');
};

const painelAcessibilidade = () => {
  const p = lerAcess();
  const temas = TEMAS.map(t => `
    <button type="button" class="acess-tema ${p.tema === t.id ? 'active' : ''}" role="radio" aria-checked="${p.tema === t.id}"
            data-acess-tema="${t.id}" onclick="definirAcess('tema','${t.id}')">
      <span class="acess-amostra" aria-hidden="true">${t.cores.map(c => `<span style="background:${c}"></span>`).join('')}</span>
      <span class="acess-tema-nome">${t.nome}</span>
      <span class="acess-tema-desc">${t.desc}</span>
    </button>`).join('');
  const tamanhos = [['normal', 'A', 'Normal'], ['grande', 'A', 'Grande'], ['muito-grande', 'A', 'Muito grande']]
    .map(([id, letra, rotulo], i) => `
      <button type="button" class="seg-option ${p.texto === id ? 'active' : ''}" role="radio" aria-checked="${p.texto === id}"
              data-acess-texto="${id}" onclick="definirAcess('texto','${id}')" aria-label="Texto ${rotulo}">
        <span style="font-size:${0.85 + i * 0.18}rem;font-weight:700">${letra}</span> ${rotulo}
      </button>`).join('');
  const chave = (id, titulo, desc) => `
    <label class="acess-chave" for="acess-${id}">
      <span><strong>${titulo}</strong><small>${desc}</small></span>
      <input type="checkbox" id="acess-${id}" role="switch" ${p[id] ? 'checked' : ''} onchange="definirAcess('${id}', this.checked)" />
      <span class="acess-switch" aria-hidden="true"></span>
    </label>`;
  return `
    <div class="config-secao" id="config-tema">
      <div class="config-secao-titulo"><i data-lucide="palette"></i> Tema</div>
      <div class="acess-temas" role="radiogroup" aria-label="Tema">${temas}</div>
    </div>
    <div class="config-secao" id="config-acessibilidade">
      <div class="config-secao-titulo"><i data-lucide="accessibility"></i> Acessibilidade</div>
      <div class="config-bloco acess-bloco">
        <div class="acess-linha">
          <strong>Tamanho do texto</strong>
          <div class="seg-toggle" role="radiogroup" aria-label="Tamanho do texto">${tamanhos}</div>
        </div>
        ${chave('fonte', 'Fonte de leitura fácil', 'Atkinson Hyperlegible: criada pelo Braille Institute para baixa visão, com letras fáceis de distinguir.')}
        ${chave('espaco', 'Espaçamento de texto maior', 'Mais espaço entre linhas, letras e palavras.')}
        ${chave('links', 'Destacar links e botões', 'Sublinha os links e contorna tudo o que é clicável.')}
        ${chave('movimento', 'Reduzir animações', 'Desliga transições e efeitos de movimento.')}
        <button type="button" class="acess-restaurar" onclick="restaurarAcess()"><i data-lucide="rotate-ccw"></i> Restaurar padrão</button>
      </div>
    </div>`;
};

// ── Notificações por e-mail e privacidade no ranking (salvas na conta) ──
const painelNotificacoesPrivacidade = () => {
  const u = state.usuario || {};
  const priv = u.privacidadeRanking || 'nome';
  const opcao = (id, titulo, desc) => `
    <label class="acess-opcao">
      <input type="radio" name="privacidade" value="${id}" ${priv === id ? 'checked' : ''} onchange="salvarPreferencia('privacidadeRanking', this.value)" />
      <span><strong>${titulo}</strong><small>${desc}</small></span>
    </label>`;
  return `
    <div class="config-secao" id="config-notificacoes">
      <div class="config-secao-titulo"><i data-lucide="mail"></i> Notificações</div>
      <div class="config-bloco acess-bloco">
        <label class="acess-chave" for="pref-email">
          <span><strong>Receber atualizações por e-mail</strong>
            <small>${u.email
              ? `Conquista nova, subida de nível, resposta das suas solicitações de projeto e dos certificados de eventos. Enviado para <strong>${esc(u.email)}</strong>.`
              : 'Não encontramos seu e-mail no SUAP. Ele é atualizado no próximo login.'}</small></span>
          <input type="checkbox" id="pref-email" role="switch" ${u.notificarEmail !== false ? 'checked' : ''} ${u.email ? '' : 'disabled'}
                 onchange="salvarPreferencia('notificarEmail', this.checked)" />
          <span class="acess-switch" aria-hidden="true"></span>
        </label>
      </div>
    </div>
    <div class="config-secao" id="config-privacidade">
      <div class="config-secao-titulo"><i data-lucide="eye"></i> Privacidade no ranking</div>
      <div class="config-bloco acess-bloco" role="radiogroup" aria-label="Como você aparece no ranking">
        ${opcao('nome', 'Mostrar meu nome', 'Você aparece normalmente para os outros alunos.')}
        ${opcao('anonimo', 'Aparecer como anônimo', 'Sua posição continua no ranking, mas sem o seu nome.')}
        ${opcao('oculto', 'Não aparecer no ranking', 'Você some da lista. Seus pontos e níveis continuam valendo.')}
      </div>
    </div>`;
};

const salvarPreferencia = async (chave, valor) => {
  try {
    const res = await fetch('/api/preferencias', {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [chave]: valor }),
    });
    if (res.status === 401) { window.location.href = '/login'; return; }
    if (!res.ok) throw new Error();
    state.usuario = { ...(state.usuario || {}), [chave]: valor };
    aviso(chave === 'notificarEmail'
      ? (valor ? 'Você vai receber as atualizações por e-mail.' : 'E-mails desligados.')
      : 'Privacidade do ranking atualizada.', 'ok');
    if (chave === 'privacidadeRanking') { delete state.loaded.ranking; delete state.loaded.dashboard; }
  } catch (e) {
    aviso('Não foi possível salvar. Tente de novo.', 'erro');
    state.loaded['dados'] = false; carregarDados(); // volta os controles ao valor salvo
  }
};

// Aplica já ao carregar (garante os controles sincronizados com o head)
aplicarAcess(lerAcess());

// ── Utilidades ─────────────────────────────────────────────────
const api = async (url) => {
  const res = await fetch(url, { credentials: 'include' });
  if (res.status === 401) { window.location.href = '/login'; return null; }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

const esc = (s) => String(s ?? '—')
  .replace(/&/g,'&amp;')
  .replace(/</g,'&lt;')
  .replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;');

const normalizarTexto = (s) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const formatarData = (d) => {
  if (!d) return '—';
  // Aceita "AAAA-MM-DD" e também datas ISO com horário (antes virava NaN/NaN/NaN)
  const ymd = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  const dt = ymd ? new Date(+ymd[1], +ymd[2] - 1, +ymd[3], 12) : new Date(d);
  if (isNaN(dt)) return '—';
  return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`;
};

// Lê "AAAA-MM-DD" como data LOCAL. `new Date('2026-08-17')` é meia-noite UTC,
// que no Brasil vira 21h do dia ANTERIOR — um evento de hoje aparecia como passado.
const dataLocal = (v) => {
  if (!v) return null;
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T00:00:00(?:\.0+)?Z?$)/);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(v);
  return isNaN(d) ? null : d;
};

// Aviso discreto no canto da tela (no lugar das janelas de alerta do navegador)
let _avisoTimer = null;
const aviso = (msg, tipo = '') => {
  let el = document.getElementById('avisoPortal');
  if (!el) {
    el = document.createElement('div');
    el.id = 'avisoPortal';
    el.className = 'aviso-portal';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `aviso-portal ${tipo} show`;
  clearTimeout(_avisoTimer);
  _avisoTimer = setTimeout(() => el.classList.remove('show'), 3500);
};

const dadoItem = (label, valor) =>
  (valor == null || valor === '') ? '' : `
  <div class="dado-item">
    <label>${label}</label>
    <p>${esc(valor)}</p>
  </div>`;

// ── Esqueletos de carregamento ─────────────────────────────────
// Blocos cinza animados com o FORMATO do conteúdo que vai chegar
// (em vez de um "Carregando…"). Uso: el.innerHTML = esqueleto('lista').
const _sk = (cls = '', estilo = '') => `<span class="skel ${cls}" style="${estilo}"></span>`;
const _skLinhas = (larguras) => larguras.map(w => _sk('sk-linha', `width:${w}`)).join('');
const _skCard = (conteudo, extra = '') => `<div class="sk-card ${extra}">${conteudo}</div>`;

const esqueleto = (tipo = 'lista', qtd) => {
  let html = '';
  switch (tipo) {
    case 'dashboard':
      html = `
        <div class="sk-card sk-hero">
          ${_sk('sk-circulo', 'width:96px;height:96px')}
          <div class="sk-col">${_sk('sk-titulo', 'width:40%')}${_skLinhas(['30%'])}${_sk('sk-barra', 'width:70%')}</div>
          <div class="sk-indicadores">${_sk('sk-bloco')}${_sk('sk-bloco')}</div>
        </div>
        <div class="sk-grid-2">
          <div>
            <div class="sk-grid-2">${_skCard(_sk('sk-icone') + _sk('sk-titulo', 'width:40%') + _skLinhas(['60%']))}${_skCard(_sk('sk-icone') + _sk('sk-titulo', 'width:40%') + _skLinhas(['60%']))}</div>
            ${_skCard(_sk('sk-titulo', 'width:35%') + [1, 2, 3].map(() => `<div class="sk-linha-item">${_sk('sk-quadrado')}${_sk('sk-linha', 'flex:1')}${_sk('sk-linha', 'width:48px')}</div>`).join(''))}
          </div>
          ${_skCard(_sk('sk-titulo', 'width:45%') + [1, 2, 3].map(() => `<div class="sk-linha-item">${_sk('sk-quadrado')}<div class="sk-col">${_skLinhas(['75%', '45%'])}</div></div>`).join(''))}
        </div>`;
      break;
    case 'grade': // conquistas
      html = _skCard(`<div class="sk-linha-item">${_sk('sk-icone')}<div class="sk-col">${_sk('sk-titulo', 'width:25%')}${_skLinhas(['40%'])}</div></div>`)
        + _sk('sk-titulo', 'width:160px;margin:1.4rem 0 0.8rem')
        + `<div class="sk-grade">${Array.from({ length: qtd || 6 }, () =>
            _skCard(`<div class="sk-linha-item">${_sk('sk-icone')}<div class="sk-col">${_skLinhas(['80%', '95%', '35%'])}</div></div>`)).join('')}</div>`;
      break;
    case 'ranking':
      html = `<div class="sk-pilulas">${_sk('sk-pilula')}${_sk('sk-pilula')}</div>`
        + _skCard(`<div class="sk-linha-item">${_sk('sk-titulo', 'width:48px;height:32px')}<div class="sk-col">${_skLinhas(['40%', '60%'])}</div>${_sk('sk-linha', 'width:56px')}</div>`)
        + Array.from({ length: qtd || 6 }, () =>
            _skCard(`<div class="sk-linha-item">${_sk('sk-quadrado')}<div class="sk-col">${_skLinhas(['45%', '25%'])}</div>${_sk('sk-linha', 'width:48px')}</div>`, 'sk-compacto')).join('');
      break;
    case 'timeline': // calendário / trajetória
      html = _skCard(Array.from({ length: qtd || 5 }, () =>
        `<div class="sk-linha-item sk-tl">${_sk('sk-data')}<div class="sk-col">${_skLinhas(['60%', '35%'])}</div></div>`).join(''));
      break;
    case 'config':
      html = _skCard(`<div class="sk-linha-item">${_sk('sk-circulo', 'width:64px;height:64px')}<div class="sk-col">${_sk('sk-titulo', 'width:50%')}${_skLinhas(['70%', '25%'])}</div></div>`)
        + [4, 6, 4].map(k => _sk('sk-linha', 'width:120px;margin:1.2rem 0 0.6rem') +
            _skCard(`<div class="sk-grade-2">${Array.from({ length: k }, () => `<div>${_skLinhas(['45%', '80%'])}</div>`).join('')}</div>`)).join('');
      break;
    default: // 'lista' — cards (projetos etc.)
      html = Array.from({ length: qtd || 3 }, () =>
        _skCard(_sk('sk-pilula', 'width:80px') + _sk('sk-titulo', 'width:70%') + _skLinhas(['90%', '55%']))).join('');
  }
  return `<div class="sk-wrap" role="status" aria-busy="true" aria-live="polite"><span class="sr-only">Carregando…</span>${html}</div>`;
};

// Preenche os marcadores estáticos do HTML (data-skel="tipo")
document.querySelectorAll('[data-skel]').forEach(el => { el.innerHTML = esqueleto(el.dataset.skel); });

// ── Inicialização ──────────────────────────────────────────────
(async () => {
  try {
    const me = await api('/api/auth/me');
    if (!me) return;
    state.usuario = me;

    document.getElementById('userAvatar').textContent = (me.nome || 'A')[0].toUpperCase();
    document.getElementById('userName').textContent   = me.nome;
    document.getElementById('userMat').textContent    = me.matricula;
    const topAv = document.getElementById('topbarAvatar');
    if (topAv) topAv.textContent = (me.nome || 'A')[0].toUpperCase();

    carregarSecao('dashboard');
    // Atalhos do app instalado (PWA): /?secao=ranking abre direto a seção
    const secaoInicial = new URLSearchParams(location.search).get('secao');
    if (secaoInicial === 'calendario' || (secaoInicial && document.querySelector(`.nav-item[data-section="${CSS.escape(secaoInicial)}"]`))) irParaSecao(secaoInicial);

    // Depois que o painel aparece, mostra conquistas novas / subida de nível
    setTimeout(verificarNovidades, 1200);
    // Pré-carrega as Configurações (dados do SUAP) para abrirem na hora
    // e para mostrar o campus na barra lateral.
    carregarDados();
  } catch(e) {
    console.error('Erro na inicialização:', e);
  }
})();

// ── Menu hambúrguer (mobile) ─────────────────────────────────────
const sidebarEl = document.getElementById('sidebar');
const menuToggleEl = document.getElementById('menuToggle');
const sidebarOverlayEl = document.getElementById('sidebarOverlay');

const abrirSidebar = () => {
  sidebarEl?.classList.add('open');
  sidebarOverlayEl?.classList.add('open');
};
const fecharSidebar = () => {
  sidebarEl?.classList.remove('open');
  sidebarOverlayEl?.classList.remove('open');
};

menuToggleEl?.addEventListener('click', () => {
  if (sidebarEl?.classList.contains('open')) fecharSidebar();
  else abrirSidebar();
});
sidebarOverlayEl?.addEventListener('click', fecharSidebar);


// ── Card "Como funciona" (um por aba) ──────────────────────────
// Texto curto para quem está usando pela primeira vez. "Entendi" recolhe
// o card (fica salvo neste navegador) e sobra só um botão "Como funciona?".
const INFO_ABAS = {
  dashboard: { ic: 'layout-dashboard', titulo: 'Seu resumo', texto: 'Aqui você vê de relance seus <strong>pontos</strong>, seu <strong>nível</strong>, sua posição no ranking e os eventos. Você ganha pontos com conquistas: participando de projetos, indo a eventos e tirando boas notas.' },
  projetos: { ic: 'folder-open', titulo: 'Como entrar num projeto', texto: 'Escolha <strong>Pesquisa</strong> ou <strong>Extensão</strong>, encontre um projeto e clique em <strong>“+ Fazer parte”</strong>. O professor responsável aceita ou recusa — você é avisado aqui e por e-mail. Ser aceito vale pontos.' },
  eventos: { ic: 'ticket', titulo: 'Como validar sua presença', texto: 'Foi a um evento? Clique em <strong>“Validar participação”</strong> e envie o <strong>certificado</strong> ou o <strong>QR Code do seu e-mail de inscrição</strong>. Presença validada vale pontos e entra na sua trajetória.' },
  conquistas: { ic: 'trophy', titulo: 'Como funcionam as conquistas', texto: 'Cada conquista vale pontos. Algumas chegam <strong>sozinhas</strong> (notas, projetos, eventos) e outras são dadas por um <strong>professor</strong>. As que você ainda não tem mostram como ganhar.' },
  ranking: { ic: 'trending-up', titulo: 'Como o ranking funciona', texto: 'Os alunos ficam em ordem de <strong>pontos</strong>. No empate, fica na frente quem chegou primeiro àquele total. Em <strong>Configurações</strong> você escolhe aparecer com nome, como anônimo ou ficar oculto.' },
  trajetoria: { ic: 'route', titulo: 'Sua história no campus', texto: 'Tudo o que você conquistou aqui fica registrado: <strong>conquistas</strong>, <strong>projetos</strong> e <strong>eventos</strong>, do mais recente ao mais antigo. Dá para imprimir e usar no currículo.' },
};
const _infoOcultos = () => { try { return JSON.parse(localStorage.getItem('ifplenus-info-ocultos') || '[]'); } catch (e) { return []; } };
const cardInfo = (aba) => {
  const i = INFO_ABAS[aba];
  if (!i) return '';
  const fechado = _infoOcultos().includes(aba);
  return `<div class="info-aba ${fechado ? 'fechado' : ''}" data-info="${aba}">
    <button type="button" class="info-reabrir" onclick="alternarInfo('${aba}', false)" aria-expanded="false"><i data-lucide="help-circle"></i> Como funciona esta página?</button>
    <div class="info-card" role="note">
      <span class="info-ic"><i data-lucide="${i.ic}"></i></span>
      <div class="info-txt"><strong class="info-titulo">${i.titulo}</strong><p>${i.texto}</p></div>
      <button type="button" class="info-ok" onclick="alternarInfo('${aba}', true)">Entendi</button>
    </div>
  </div>`;
};
const alternarInfo = (aba, fechar) => {
  try {
    const set = new Set(_infoOcultos());
    fechar ? set.add(aba) : set.delete(aba);
    localStorage.setItem('ifplenus-info-ocultos', JSON.stringify([...set]));
  } catch (e) { /* sem armazenamento: só recolhe nesta visita */ }
  document.querySelectorAll(`.info-aba[data-info="${aba}"]`).forEach(c => c.classList.toggle('fechado', fechar));
  if (!fechar) document.querySelector(`.info-aba[data-info="${aba}"] .info-ok`)?.focus();
};

// ── Navegação ──────────────────────────────────────────────────
// Menu acessível pelo teclado: os itens são <div>, então ganham papel de
// botão, Tab e Enter/Espaço (antes só funcionavam com o mouse/toque)
document.querySelectorAll('.nav-item[data-section]').forEach(item => {
  item.setAttribute('role', 'button');
  item.tabIndex = 0;
  if (item.classList.contains('active')) item.setAttribute('aria-current', 'page');
  item.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); item.click(); }
  });
});
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const sec = item.dataset.section;
    document.querySelectorAll('.nav-item').forEach(i => { i.classList.remove('active'); i.removeAttribute('aria-current'); });
    item.classList.add('active');
    item.setAttribute('aria-current', 'page');
    window.scrollTo(0, 0); // nova aba começa do topo (no celular ficava no meio da página)
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById(`section-${sec}`).classList.add('active');
    fecharSidebar(); // fecha o menu mobile ao trocar de aba

    const titles = {
      dashboard: 'Dashboard',
      projetos:  'Projetos',
      eventos:   'Eventos',
      conquistas:'Conquistas',
      trajetoria:'Minha Trajetória',
      ranking:'Ranking',
    };
    document.getElementById('topbarTitle').textContent = titles[sec] || '';
    document.title = `IFPlenus — ${titles[sec] || 'Portal do Aluno'}`;

    const actions = document.getElementById('topbarActions');
    actions.innerHTML = '';

    carregarSecao(sec);
  });
});

// Seções cujos dados mudam com o tempo (pontos, ranking, conquistas,
// trajetória) devem ser SEMPRE recarregadas ao entrar — senão exibem
// valores congelados da primeira visita. As demais (projetos,
// calendário) podem manter o cache de "já carregado".
const SECOES_DINAMICAS = new Set(['dashboard', 'conquistas', 'ranking', 'trajetoria']);

const carregarSecao = (sec) => {
  if (SECOES_DINAMICAS.has(sec)) delete state.loaded[sec];
  if (state.loaded[sec]) return;
  switch(sec) {
    case 'dashboard':  carregarDashboard();  break;
    case 'projetos':   carregarProjetos();   break;
    case 'eventos':    carregarEventos();    break;
    case 'conquistas': carregarConquistas(); break;
    case 'trajetoria': carregarTrajetoria(); break;
    case 'ranking':    carregarRanking();    break;
  }
};

// ── DADOS PESSOAIS ─────────────────────────────────────────────
// Monta o painel de Configurações. As opções (tema, acessibilidade,
// notificações, privacidade, sair) aparecem SEMPRE; só o bloco de dados do
// SUAP depende da API — se o SUAP falhar, o aluno ainda consegue configurar tudo.
const montarConfig = (d) => {
  const u = state.usuario || {};
  const vinculo = d?.vinculo || {};
  const nome = d ? (d.nome_usual || d.nome) : u.nome;
  const inicial = String(nome || 'A').trim().charAt(0).toUpperCase() || 'A';

  const perfil = `
    <div class="config-perfil">
      <div class="perfil-avatar">${esc(inicial)}</div>
      <div>
        <h3>${esc(nome || 'Aluno')}</h3>
        <p>${esc(vinculo.curso || d?.tipo_usuario || u.matricula || '')}</p>
        ${d ? `<span class="status-badge">${esc(vinculo.situacao || 'Ativo')}</span>` : ''}
      </div>
    </div>`;

  const dadosSuap = d ? `
    <div class="config-secao" id="config-dados">
      <div class="config-secao-titulo"><i data-lucide="graduation-cap"></i> Dados acadêmicos</div>
      <div class="config-bloco">
        <div class="dados-grid">
          ${dadoItem('Matrícula',          vinculo.matricula || u.matricula)}
          ${dadoItem('Curso',              vinculo.curso)}
          ${dadoItem('Campus',             vinculo.campus || d.campus)}
          ${dadoItem('Situação',           vinculo.situacao)}
          ${dadoItem('Tipo de Vínculo',    d.tipo_vinculo)}
          ${dadoItem('Período de Refer.',  vinculo.periodo_de_referencia != null ? vinculo.periodo_de_referencia + 'º' : null)}
          ${dadoItem('Cota SISTEC',        vinculo.cota_sistec)}
        </div>
      </div>
    </div>

    <div class="config-secao">
      <div class="config-secao-titulo"><i data-lucide="user"></i> Dados pessoais</div>
      <div class="config-bloco">
        <div class="dados-grid">
          ${dadoItem('Nome Completo',      d.nome)}
          ${dadoItem('CPF',                d.cpf)}
          ${dadoItem('E-mail',             d.email)}
          ${dadoItem('E-mail Acadêmico',   d.email_academico || d.email_google_classroom)}
          ${dadoItem('Data de Nascimento', d.data_nascimento ? formatarData(d.data_nascimento) : null)}
        </div>
        <p class="config-nota"><i data-lucide="info"></i> Esses dados vêm do SUAP e só podem ser alterados lá.</p>
      </div>
    </div>` : `
    <div class="config-secao">
      <div class="config-bloco config-aviso">
        <i data-lucide="cloud-off"></i>
        <div><strong>Não foi possível buscar seus dados no SUAP agora.</strong>
          <button type="button" class="link-acao" onclick="state.loaded.dados=false; carregarDados()">Tentar de novo</button></div>
      </div>
    </div>`;

  document.getElementById('dadosContent').innerHTML = `
    ${perfil}
    ${painelAcessibilidade()}
    ${painelNotificacoesPrivacidade()}
    ${dadosSuap}
    <div class="config-secao">
      <div class="config-secao-titulo"><i data-lucide="log-out"></i> Conta</div>
      <button type="button" class="btn-sair-config" onclick="logout()"><i data-lucide="log-out"></i> Sair do IFPlenus</button>
    </div>`;
};

const carregarDados = async () => {
  if (state.loaded['dados']) return;
  state.loaded['dados'] = true;
  try {
    const d = await api('/api/dados-pessoais');
    if (!d) return;

    // Mostra o campus do aluno logado ao lado da logo (barra lateral)
    const campusRaw = String(d.vinculo?.campus || d.campus || '').trim();
    const elCampus = document.getElementById('sidebarCampus');
    if (campusRaw && elCampus) {
      elCampus.textContent = /campus/i.test(campusRaw) ? campusRaw : `Campus ${campusRaw}`;
    }
    montarConfig(d);
  } catch (e) {
    montarConfig(null);
    state.loaded['dados'] = false; // tenta de novo na próxima abertura
  }
};

// ── CONFIGURAÇÕES (painel lateral) ─────────────────────────────
let _focoAntesConfig = null;

const abrirConfig = (secao) => {
  const drawer = document.getElementById('configDrawer');
  if (!drawer) return;
  _focoAntesConfig = document.activeElement;
  fecharSidebar();
  if (!state.loaded['dados']) carregarDados();
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  document.getElementById('configOverlay')?.classList.add('open');
  document.body.classList.add('config-aberta');
  setTimeout(() => {
    drawer.querySelector('.config-fechar')?.focus();
    if (typeof secao === 'string') document.getElementById(`config-${secao}`)?.scrollIntoView({ block: 'start' });
  }, 60);
};

const fecharConfig = () => {
  const drawer = document.getElementById('configDrawer');
  if (!drawer || !drawer.classList.contains('open')) return;
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  document.getElementById('configOverlay')?.classList.remove('open');
  document.body.classList.remove('config-aberta');
  _focoAntesConfig?.focus?.();
};

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { fecharValidacao(); fecharNiveis(); fecharConfig(); }
});

// ── PROJETOS (aba única: áreas Pesquisa/Extensão × fontes Sistema/Admin) ──
// state.projArea guarda a área (tópico) selecionada: 'pesquisa' | 'extensao'.

const _projMeta = {
  pesquisa: { class: 'tipo-pesquisa', label: 'Pesquisa' },
  extensao: { class: 'tipo-extensao', label: 'Extensão' },
};

const carregarProjetos = async () => {
  state.loaded['projetos'] = true;
  if (!state.projArea) state.projArea = 'pesquisa';
  renderProjetosShell();
  await renderAreaProjetos(state.projArea);
};

// Casca da aba: botões de área (Pesquisa | Extensão) + container do conteúdo.
const renderProjetosShell = () => {
  const el = document.getElementById('projetosContent');
  const aba = (area, label) =>
    `<button class="${state.projArea === area ? 'ativo' : ''}" onclick="trocarAreaProjetos('${area}')">${label}</button>`;
  el.innerHTML = `
    ${cardInfo('projetos')}
    <div class="proj-area-tabs">
      ${aba('pesquisa', 'Pesquisa')}
      ${aba('extensao', 'Extensão')}
    </div>
    <div id="projetosArea">${esqueleto('lista')}</div>`;
};

// Troca a área selecionada e re-renderiza.
const trocarAreaProjetos = async (area) => {
  if (area !== 'pesquisa' && area !== 'extensao') return;
  state.projArea = area;
  renderProjetosShell();
  await renderAreaProjetos(area);
};

// Recarrega a aba de projetos (após solicitar/cancelar), mantendo a área.
const recarregarProjetos = (area) => {
  state.projOcupado = false;
  state.projArea = (area === 'pesquisa' || area === 'extensao') ? area : (state.projArea || 'pesquisa');
  state.loaded['projetos'] = true;
  renderProjetosShell();
  renderAreaProjetos(state.projArea);
};

// Dentro da área, dois grupos: Projetos do Sistema (SUAP) e
// Projetos Adicionados pelo Admin (locais).
const renderAreaProjetos = async (area) => {
  const cont = document.getElementById('projetosArea');
  if (!cont) return;
  const meta = _projMeta[area];
  const pedido = (state.projPedido = (state.projPedido || 0) + 1);
  try {
    const [suap, internos] = await Promise.all([
      api(`/api/projetos/${area}`).catch(() => 'erro'),
      api(`/api/projetos-internos/${area}`).catch(() => []),
    ]);
    if (suap === null) return; // 401 já redirecionou
    // Se o usuário trocou de área enquanto carregava, descarta esta resposta
    if (pedido !== state.projPedido) return;

    const suapCards = suap === 'erro'
      ? `<div class="proj-vazio"><i data-lucide="cloud-off"></i> Não foi possível buscar os projetos do SUAP agora. Tente de novo em instantes.</div>`
      : (Array.isArray(suap) && suap.length)
        ? suap.map(p => renderProjetoSuap(p, area, meta)).join('')
        : `<div class="proj-vazio">Nenhum projeto de ${meta.label.toLowerCase()} encontrado no sistema (SUAP).</div>`;

    const adminCards = (Array.isArray(internos) && internos.length)
      ? internos.map(p => renderProjetoInterno(p, area, meta.class, meta.label)).join('')
      : `<div class="proj-vazio">Nenhum projeto cadastrado pelo campus ainda.</div>`;

    const f = state.projFiltro || {};
    const nSuap = Array.isArray(suap) ? suap.length : 0;
    const nAdmin = Array.isArray(internos) ? internos.length : 0;
    const abaFonte = (v, rot, ic, n) =>
      `<button type="button" role="tab" class="ev-filtro ${(f.fonte || '') === v ? 'ativo' : ''}" aria-selected="${(f.fonte || '') === v}" data-fonte-aba="${v}" onclick="trocarFonteProjetos('${v}')">${ic ? `<i data-lucide="${ic}"></i>` : ''}${rot}<span>${n}</span></button>`;

    cont.innerHTML = `
      <div class="proj-filtros" role="search">
        <label class="proj-busca">
          <i data-lucide="search"></i>
          <span class="sr-only">Buscar projetos</span>
          <input type="search" id="projBusca" placeholder="Buscar por título, coordenador ou assunto…" value="${esc(f.texto || '')}" oninput="filtrarProjetos()" />
        </label>
        <span class="proj-contagem" id="projContagem" aria-live="polite"></span>
      </div>
      <div class="ev-filtros proj-fontes" role="tablist" aria-label="De onde vêm os projetos">
        ${abaFonte('', 'Todos', '', nSuap + nAdmin)}
        ${abaFonte('suap', 'SUAP', 'server', nSuap)}
        ${abaFonte('admin', 'Do campus', 'user-cog', nAdmin)}
      </div>
      <div class="proj-fonte" data-fonte="suap">
        <div class="proj-fonte-titulo"><i data-lucide="server"></i> Projetos do SUAP</div>
        <div class="proj-lista">${suapCards}</div>
        <div class="proj-vazio proj-sem-resultado" hidden>Nenhum projeto do SUAP com essa busca.</div>
      </div>
      <div class="proj-fonte" data-fonte="admin">
        <div class="proj-fonte-titulo"><i data-lucide="user-cog"></i> Projetos do campus (cadastrados no painel)</div>
        <div class="proj-lista">${adminCards}</div>
        <div class="proj-vazio proj-sem-resultado" hidden>Nenhum projeto do campus com essa busca.</div>
      </div>`;
    filtrarProjetos();
  } catch (e) {
    cont.innerHTML =
      '<div class="empty-state"><div class="icon"><i data-lucide="alert-triangle"></i></div><p>Erro ao carregar projetos.</p></div>';
  }
};

// ── Busca e filtros dos projetos (no próprio navegador, sem nova consulta) ──
const atributosFiltro = (titulo, coord, resumo) =>
  `data-busca="${esc(normalizarTexto([titulo, coord, resumo].filter(Boolean).join(' ')))}"`;

// Abas "Todos / Do SUAP / Do campus" (antes era um menu de seleção escondido)
const trocarFonteProjetos = (fonte) => {
  state.projFiltro = { ...(state.projFiltro || {}), fonte };
  document.querySelectorAll('[data-fonte-aba]').forEach(b => {
    const ativo = b.dataset.fonteAba === fonte;
    b.classList.toggle('ativo', ativo);
    b.setAttribute('aria-selected', String(ativo));
  });
  filtrarProjetos();
};

const filtrarProjetos = () => {
  const texto = normalizarTexto(document.getElementById('projBusca')?.value || '').trim();
  const fonte = state.projFiltro?.fonte || '';
  state.projFiltro = { texto: document.getElementById('projBusca')?.value || '', fonte };

  let visiveis = 0, total = 0;
  document.querySelectorAll('#projetosArea .proj-fonte').forEach(grupo => {
    const mostrarGrupo = !fonte || grupo.dataset.fonte === fonte;
    grupo.hidden = !mostrarGrupo;
    const cards = grupo.querySelectorAll('.projeto-card');
    let noGrupo = 0;
    cards.forEach(card => {
      total++;
      const ok = mostrarGrupo &&
        (!texto || texto.split(/\s+/).every(t => card.dataset.busca.includes(t)));
      card.hidden = !ok;
      if (ok) { noGrupo++; visiveis++; }
    });
    const vazio = grupo.querySelector('.proj-sem-resultado');
    if (vazio) vazio.hidden = !(cards.length && !noGrupo);
  });
  const cont = document.getElementById('projContagem');
  if (cont) cont.textContent = texto ? `${visiveis} de ${total} projeto(s)` : '';
};

// Card de um projeto vindo do SUAP (sistema).
const renderProjetoSuap = (p, area, meta) => {
  const titulo = p.titulo || p.nome || 'Sem título';
  const link = linkProjetoSuap(p, area);
  const tituloHtml = link
    ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(titulo)}</a>`
    : esc(titulo);
  return `
    <div class="projeto-card" ${atributosFiltro(titulo, p.nome_coordenador, p.resumo)}>
      <span class="projeto-tipo ${meta.class}">${meta.label}</span>
      <div class="projeto-titulo">${tituloHtml}</div>
      <div class="projeto-detalhe">
        ${p.dt_inicio             ? `<span><i data-lucide="calendar"></i> ${formatarData(p.dt_inicio)} – ${p.dt_final ? formatarData(p.dt_final) : '?'}</span>` : ''}
        ${p.situacao              ? `<span><i data-lucide="circle-dot"></i> ${esc(p.situacao)}</span>`                              : ''}
        ${p.nome_coordenador      ? `<span><i data-lucide="user"></i> ${esc(p.nome_coordenador)}</span>`                       : ''}
        ${p.campus_nome_formatado ? `<span><i data-lucide="school"></i> ${esc(p.campus_nome_formatado)}</span>`                  : ''}
      </div>
      ${p.id != null ? `<div class="projeto-acoes">${botaoParticipar(p.meuStatus, `solicitarParticipacaoSuap('${p.id}','${area}')`, `resetarSolicitacaoSuap('${p.id}','${area}')`)}</div>` : ''}
    </div>`;
};

// Botão/estado de participação conforme o status do aluno.
//  - sem status → "Fazer parte"
//  - pendente   → aviso + "Cancelar solicitação"
//  - aceito     → "Você faz parte" (sem ação)
//  - recusado   → "tentar de novo" (apaga a recusada e libera novo pedido)
const botaoParticipar = (meuStatus, onclickSolicitar, onclickCancelar) => {
  switch (meuStatus) {
    case 'pendente': return `
      <span class="status-pendente"><i data-lucide="hourglass"></i> Solicitação enviada</span>
      <button class="btn-participar cancelar" onclick="${onclickCancelar}" title="Cancelar sua solicitação"><i data-lucide="x"></i> Cancelar solicitação</button>`;
    case 'aceito':   return `<button class="btn-participar aceito" disabled><i data-lucide="check"></i> Você faz parte</button>`;
    case 'recusado': return `<button class="btn-participar recusado" onclick="${onclickCancelar}" title="Solicitação recusada — clique para solicitar de novo"><i data-lucide="x"></i> Recusada · tentar de novo</button>`;
    default:         return `<button class="btn-participar" onclick="${onclickSolicitar}">+ Fazer parte</button>`;
  }
};

// Card de projeto criado pela administração (local).
const renderProjetoInterno = (p, area, tipoClass, tipoLabel) => {
  const botao = botaoParticipar(p.meuStatus, `solicitarParticipacao('${p._id}','${area}')`, `resetarSolicitacao('${p._id}','${area}')`);
  const link = linkProjetoSuap(p);
  const titulo = p.titulo || 'Sem título';
  const tituloHtml = link
    ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(titulo)}</a>`
    : esc(titulo);
  return `
    <div class="projeto-card projeto-admin" ${atributosFiltro(titulo, p.coordenador, p.resumo)}>
      <span class="projeto-tipo ${tipoClass}">${tipoLabel} · Administração</span>
      <div class="projeto-titulo">${tituloHtml}</div>
      ${p.resumo ? `<p class="projeto-resumo">${esc(p.resumo)}</p>` : ''}
      <div class="projeto-detalhe">
        ${p.dt_inicio   ? `<span><i data-lucide="calendar"></i> ${formatarData(p.dt_inicio)} – ${p.dt_final ? formatarData(p.dt_final) : '?'}</span>` : ''}
        ${p.situacao    ? `<span><i data-lucide="circle-dot"></i> ${esc(p.situacao)}</span>`                              : ''}
        ${p.coordenador ? `<span><i data-lucide="user"></i> ${esc(p.coordenador)}</span>`                           : ''}
        ${p.campus_nome ? `<span><i data-lucide="school"></i> ${esc(p.campus_nome)}</span>`                           : ''}
      </div>
      <div class="projeto-acoes">${botao}</div>
    </div>`;
};

// Desabilita os botões de participação enquanto um pedido está em andamento
const travarBotoes = (sim) => {
  state.projOcupado = sim;
  document.querySelectorAll('#projetosArea .projeto-acoes button').forEach(b => { b.disabled = sim; });
};

// Envia a solicitação de participação (projeto local) e recarrega a aba.
const solicitarParticipacao = async (projetoId, area) => {
  if (state.projOcupado) return; // evita clique duplo
  travarBotoes(true);
  try {
    const res = await fetch(`/api/projetos-internos/${projetoId}/solicitar`, {
      method: 'POST',
      credentials: 'include',
    });
    if (res.status === 401) { window.location.href = '/login'; return; }
    const data = await res.json();
    if (res.ok && data.sucesso) { aviso('Solicitação enviada! Aguarde a resposta do professor.', 'ok'); recarregarProjetos(area); }
    else { aviso(data.erro || 'Não foi possível enviar a solicitação.', 'erro'); travarBotoes(false); }
  } catch (e) {
    aviso('Erro de conexão ao enviar a solicitação.', 'erro');
    travarBotoes(false);
  }
};

// Envia a solicitação de participação (projeto do SUAP) e recarrega a aba.
const solicitarParticipacaoSuap = async (suapId, area) => {
  if (state.projOcupado) return; // evita clique duplo
  travarBotoes(true);
  try {
    const res = await fetch(`/api/projetos-suap/${suapId}/solicitar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ tipo: area }),
    });
    if (res.status === 401) { window.location.href = '/login'; return; }
    const data = await res.json();
    if (res.ok && data.sucesso) { aviso('Solicitação enviada! Aguarde a resposta do professor.', 'ok'); recarregarProjetos(area); }
    else { aviso(data.erro || 'Não foi possível enviar a solicitação.', 'erro'); travarBotoes(false); }
  } catch (e) {
    aviso('Erro de conexão ao enviar a solicitação.', 'erro');
    travarBotoes(false);
  }
};

// Cancela a solicitação (pendente → desistência; recusada → tentar de novo)
// de um projeto local, e recarrega a aba.
const resetarSolicitacao = async (projetoId, area) => {
  if (state.projOcupado) return; // evita clique duplo
  travarBotoes(true);
  try {
    const res = await fetch(`/api/projetos-internos/${projetoId}/solicitacao`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (res.status === 401) { window.location.href = '/login'; return; }
    if (!res.ok) { aviso('Não foi possível cancelar a solicitação.', 'erro'); travarBotoes(false); return; }
    recarregarProjetos(area);
  } catch (e) {
    aviso('Erro de conexão.', 'erro');
    travarBotoes(false);
  }
};

// Cancela a solicitação (pendente/recusada) de um projeto do SUAP.
const resetarSolicitacaoSuap = async (suapId, area) => {
  if (state.projOcupado) return; // evita clique duplo
  travarBotoes(true);
  try {
    const res = await fetch(`/api/projetos-suap/${suapId}/solicitacao`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (res.status === 401) { window.location.href = '/login'; return; }
    if (!res.ok) { aviso('Não foi possível cancelar a solicitação.', 'erro'); travarBotoes(false); return; }
    recarregarProjetos(area);
  } catch (e) {
    aviso('Erro de conexão.', 'erro');
    travarBotoes(false);
  }
};
// ── EVENTOS + validação de presença ────────────────────────────
// Cada evento mostra UMA ação; as formas de validar (certificado ou QR Code
// do e-mail de inscrição) aparecem quando o aluno clica em "Validar".
state.evFiltro = 'todos';

const _dataEv = (ev) => dataLocal(ev.data_inicio || ev.data);
const _evAberto = (ev) => !!(ev.chave && (ev.validacao?.certificado || ev.validacao?.qrcode));

const _periodoEv = (ev) => {
  if (ev.periodo_formatado) return ev.periodo_formatado;
  const ini = formatarData(ev.data_inicio || ev.data);
  const fim = ev.data_fim && ev.data_fim !== ev.data_inicio ? ` a ${formatarData(ev.data_fim)}` : '';
  const hora = ev.hora_inicio ? ` · ${ev.hora_inicio}${ev.hora_fim ? `–${ev.hora_fim}` : ''}` : '';
  return `${ini}${fim}${hora}`;
};

const acaoEvento = (ev) => {
  const p = ev.minhaPresenca;
  const chave = esc(ev.chave || '');
  if (p?.status === 'aprovada') {
    return `<span class="ev-status ok"><i data-lucide="badge-check"></i> Presença validada</span>`;
  }
  if (p?.status === 'pendente') {
    return `<span class="ev-status espera"><i data-lucide="hourglass"></i> Em análise</span>
      <button type="button" class="btn-link-ev" onclick="abrirValidacao('${chave}')">Reenviar</button>`;
  }
  if (p?.status === 'recusada') {
    return `<span class="ev-status recusada" ${p.motivo ? `title="${esc(p.motivo)}"` : ''}><i data-lucide="x-circle"></i> Recusada</span>
      <button type="button" class="btn-validar secundario" onclick="abrirValidacao('${chave}')">Tentar de novo</button>
      ${p.motivo ? `<small class="ev-motivo">Motivo: ${esc(p.motivo)}</small>` : ''}`;
  }
  if (!_evAberto(ev)) return '';
  if (!ev.jaComecou) return '<span class="ev-status futuro"><i data-lucide="clock"></i> Validação abre no dia do evento</span>';
  if (ev.validacao.qrcode && !ev.validacao.certificado && !ev.qrNoPrazo) return '<span class="ev-status futuro">Prazo de validação encerrado</span>';
  return `<button type="button" class="btn-validar" onclick="abrirValidacao('${chave}')"><i data-lucide="badge-check"></i> Validar participação</button>`;
};

// Cartão limpo: data, nome, quando/onde e UMA ação. As formas de validar
// (certificado/QR) aparecem só quando o aluno clica em "Validar".
const cartaoEvento = (ev) => {
  const dt = _dataEv(ev);
  const nome = esc(ev.nome || ev.titulo || 'Evento');
  const link = urlSegura(ev.link_suap);
  const meta = [
    `<span><i data-lucide="calendar"></i> ${esc(_periodoEv(ev))}</span>`,
    (ev.local || ev.localizacao) ? `<span><i data-lucide="map-pin"></i> ${esc(ev.local || ev.localizacao)}</span>` : '',
  ].join('');
  const premio = ev.conquista
    ? `<span class="evc-premio" title="Ao validar: ${esc(ev.conquista.nome)}"><i data-lucide="star"></i> +${Number(ev.conquista.pontos) || 0} pts</span>` : '';
  const acao = acaoEvento(ev);
  return `<article class="evc ${ev.minhaPresenca?.status === 'aprovada' ? 'feito' : ''}">
    <div class="evc-data" aria-hidden="true"><span class="m">${dt ? MESES[dt.getMonth()] : ''}</span><span class="d">${dt ? dt.getDate() : '—'}</span></div>
    <div class="evc-corpo">
      <h4>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${nome}</a>` : nome}</h4>
      <p class="evc-meta">${meta}${ev.origem === 'suap' ? '<span class="evc-fonte">SUAP</span>' : ''}</p>
      ${acao || premio ? `<div class="evc-acao">${acao}${premio}</div>` : ''}
    </div>
  </article>`;
};

const renderEventos = () => {
  const el = document.getElementById('eventosContent');
  if (!el) return;
  const todos = state.eventos || [];
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const anoAtual = hoje.getFullYear();
  const fimEv = (ev) => dataLocal(ev.data_fim) || _dataEv(ev);

  // Ano atual + o que ainda vem (eventos de anos passados ficam de fora)
  const base = todos.filter(ev => {
    const ini = _dataEv(ev), fim = fimEv(ev);
    return (ini && ini.getFullYear() >= anoAtual) || (fim && fim.getFullYear() >= anoAtual);
  });
  const ehParaValidar = (ev) => _evAberto(ev) && ev.jaComecou &&
    (!ev.minhaPresenca || ev.minhaPresenca.status === 'recusada') &&
    (ev.validacao.certificado || ev.qrNoPrazo);
  const filtros = {
    todos: () => true,
    validar: ehParaValidar,
    validados: (ev) => ev.minhaPresenca?.status === 'aprovada',
  };
  if (!filtros[state.evFiltro]) state.evFiltro = 'todos';
  const conta = (k) => base.filter(filtros[k]).length;
  const aba = (k, rot, ic) => `<button type="button" role="tab" class="ev-filtro ${state.evFiltro === k ? 'ativo' : ''}" aria-selected="${state.evFiltro === k}" onclick="filtrarEventos('${k}')">${ic ? `<i data-lucide="${ic}"></i>` : ''}${rot}<span>${conta(k)}</span></button>`;

  const lista = base.filter(filtros[state.evFiltro]);
  const proximos = lista.filter(ev => (fimEv(ev) || 0) >= hoje).sort((a, b) => (_dataEv(a) || 0) - (_dataEv(b) || 0));
  const passados = lista.filter(ev => (fimEv(ev) || hoje) < hoje).sort((a, b) => (_dataEv(b) || 0) - (_dataEv(a) || 0));
  const grupo = (titulo, itens) => itens.length
    ? `<h3 class="evc-grupo">${titulo} <span>${itens.length}</span></h3><div class="evc-lista">${itens.map(cartaoEvento).join('')}</div>` : '';

  el.innerHTML = `
    ${cardInfo('eventos')}
    <div class="ev-filtros" role="tablist" aria-label="Filtrar eventos">
      ${aba('todos', 'Todos', '')}${aba('validar', 'Para validar', 'badge-check')}${aba('validados', 'Validados', 'check-check')}
    </div>
    ${lista.length
      ? grupo('Hoje e próximos', proximos) + grupo('Já aconteceram', passados)
      : `<div class="empty-state"><div class="icon"><i data-lucide="${state.evFiltro === 'validar' ? 'party-popper' : 'calendar'}"></i></div><p>${
          state.evFiltro === 'validar' ? 'Nada para validar agora. 🎉'
          : state.evFiltro === 'validados' ? 'Você ainda não validou presença em nenhum evento.'
          : `Nenhum evento encontrado para ${anoAtual}.`}</p></div>`}`;
};

const filtrarEventos = (k) => { state.evFiltro = k; renderEventos(); };

const carregarEventos = async () => {
  state.loaded['eventos'] = true;
  try {
    const eventos = await api('/api/eventos');
    if (!eventos) return;
    state.eventos = Array.isArray(eventos) ? eventos : [];
    renderEventos();
  } catch (e) {
    delete state.loaded['eventos'];
    document.getElementById('eventosContent').innerHTML =
      '<div class="empty-state"><div class="icon"><i data-lucide="alert-triangle"></i></div><p>Erro ao carregar os eventos.</p><button type="button" class="btn-validar secundario" onclick="carregarEventos()">Tentar de novo</button></div>';
  }
};

// ── Modal "Validar participação" ───────────────────────────────
let _focoAntesValidar = null;
let _camera = null;          // { stream, raf }
let _arquivoEscolhido = null; // Blob pronto para enviar

const eventoPorChave = (chave) => (state.eventos || []).find(e => e.chave === chave);

const abrirValidacao = (chave, aba) => {
  const ev = eventoPorChave(chave);
  if (!ev) { aviso('Evento não encontrado. Recarregue a página.', 'erro'); return; }
  _focoAntesValidar = document.activeElement;
  _arquivoEscolhido = null;

  let modal = document.getElementById('validarModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'validarModal';
    modal.className = 'niveis-overlay';
    modal.addEventListener('click', (e) => { if (e.target === modal) fecharValidacao(); });
    document.body.appendChild(modal);
  }
  const temCert = !!ev.validacao?.certificado;
  const temQr = !!ev.validacao?.qrcode;
  const inicial = aba || (temQr && ev.qrNoPrazo ? 'qr' : (temCert ? 'cert' : 'qr'));

  modal.innerHTML = `
    <div class="niveis-dialog validar-dialog" role="dialog" aria-modal="true" aria-labelledby="validarTitulo">
      <div class="niveis-head">
        <h2 id="validarTitulo"><i data-lucide="badge-check"></i> Validar participação</h2>
        <button type="button" class="config-fechar" onclick="fecharValidacao()" aria-label="Fechar"><i data-lucide="x"></i></button>
      </div>
      <div class="niveis-body">
        <p class="val-evento"><strong>${esc(ev.nome || ev.titulo || 'Evento')}</strong><br><small>${esc(_periodoEv(ev))}</small></p>
        ${ev.conquista ? `<p class="val-premio">${esc(ev.conquista.icone)} Ao validar você ganha <strong>${esc(ev.conquista.nome)}</strong> (+${Number(ev.conquista.pontos) || 0} pontos)</p>` : ''}
        ${temCert && temQr ? `
        <p class="val-pergunta">Como você quer validar?</p>
        <div class="val-abas" role="tablist" aria-label="Forma de validação">
          <button type="button" role="tab" id="abaCert" aria-controls="painelCert" class="val-aba" onclick="trocarAbaValidacao('cert')"><i data-lucide="file-text"></i><span><strong>Enviar certificado</strong><small>PDF ou foto · um professor confere</small></span></button>
          <button type="button" role="tab" id="abaQr" aria-controls="painelQr" class="val-aba" onclick="trocarAbaValidacao('qr')"><i data-lucide="qr-code"></i><span><strong>QR Code da inscrição</strong><small>O que chegou no seu e-mail</small></span></button>
        </div>` : ''}
        ${temCert ? `
        <div class="val-painel" id="painelCert" role="tabpanel" aria-labelledby="abaCert">
          <label class="val-drop" for="inputCert" id="dropCert">
            <i data-lucide="upload-cloud"></i>
            <strong>Escolher o certificado</strong>
            <small>PDF, JPG ou PNG · até 4 MB. Pode tirar uma foto com o celular.</small>
            <input type="file" id="inputCert" accept="application/pdf,image/jpeg,image/png,image/webp" onchange="escolherCertificado(this.files[0])" />
          </label>
          <div class="val-arquivo" id="arquivoCert" hidden></div>
          <div class="val-progresso" id="progCert" hidden><span></span></div>
          <button type="button" class="btn-validar largo" id="btnEnviarCert" onclick="enviarCertificado('${esc(ev.chave)}')" disabled><i data-lucide="send"></i> Enviar certificado</button>
          ${ev.minhaPresenca?.status === 'pendente' ? `<button type="button" class="btn-link-ev" onclick="cancelarPresenca('${esc(ev.chave)}')">Cancelar o envio atual</button>` : ''}
        </div>` : ''}
        ${temQr ? `
        <div class="val-painel" id="painelQr" role="tabpanel" aria-labelledby="abaQr">
          ${ev.qrNoPrazo ? `
          <p class="val-explica"><i data-lucide="mail"></i><span>Quando você se inscreveu, o evento mandou um <strong>QR Code no seu e-mail</strong>. Tire um print dele (ou uma foto) e envie aqui.</span></p>
          <div class="val-camera" id="cameraBox" hidden>
            <video id="cameraVideo" playsinline muted></video>
            <div class="val-mira" aria-hidden="true"></div>
          </div>
          <div class="val-qr-opcoes">
            <button type="button" class="btn-validar" onclick="document.getElementById('inputQrFoto').click()"><i data-lucide="image"></i> Enviar print do QR</button>
            <button type="button" class="btn-validar secundario" id="btnCamera" onclick="lerQrCamera('${esc(ev.chave)}')"><i data-lucide="camera"></i> Ler com a câmera</button>
            <input type="file" id="inputQrFoto" hidden tabindex="-1" accept="image/*" onchange="lerQrFoto(this.files[0], '${esc(ev.chave)}')" />
          </div>
          <p class="val-dica sutil">A câmera serve para ler o QR impresso ou aberto em outra tela.</p>
          <p class="val-dica" id="qrStatus" role="status" aria-live="polite"></p>`
          : `<p class="val-dica"><i data-lucide="clock"></i><span>${ev.jaComecou
              ? `O prazo para validar pelo QR Code acabou (30 dias depois do evento).${temCert ? ' Você ainda pode enviar o certificado.' : ''}`
              : 'A validação abre quando o evento começar.'}</span></p>`}
        </div>` : ''}
      </div>
    </div>`;

  modal.classList.add('open');
  document.body.classList.add('config-aberta');
  trocarAbaValidacao(inicial);
  setTimeout(() => modal.querySelector('.config-fechar')?.focus(), 50);
};

const trocarAbaValidacao = (aba) => {
  pararCamera();
  const cert = document.getElementById('painelCert');
  const qr = document.getElementById('painelQr');
  if (cert) cert.hidden = aba !== 'cert' && !!qr;
  if (qr) qr.hidden = aba !== 'qr' && !!cert;
  [['abaCert', 'cert'], ['abaQr', 'qr']].forEach(([id, a]) => {
    const b = document.getElementById(id);
    if (b) { b.setAttribute('aria-selected', String(a === aba)); b.classList.toggle('ativa', a === aba); }
  });
};

const fecharValidacao = () => {
  const modal = document.getElementById('validarModal');
  if (!modal || !modal.classList.contains('open')) return;
  pararCamera();
  modal.classList.remove('open');
  if (!document.getElementById('configDrawer')?.classList.contains('open')) document.body.classList.remove('config-aberta');
  _focoAntesValidar?.focus?.();
};

// Atualiza um evento na lista e redesenha (sem recarregar tudo do servidor)
const atualizarPresencaLocal = (chave, presenca) => {
  const ev = eventoPorChave(chave);
  if (ev) ev.minhaPresenca = presenca;
  if (state.eventos) renderEventos();
};

// ── Certificado ──
const TAM_MAX_CERT = 4 * 1024 * 1024;

// Foto grande do celular → reduz para no máx. 2000 px em JPEG (fica < 1 MB)
const reduzirImagem = (arquivo) => new Promise((resolve) => {
  const url = URL.createObjectURL(arquivo);
  const img = new Image();
  img.onload = () => {
    const escala = Math.min(1, 2000 / Math.max(img.width, img.height));
    if (escala === 1 && arquivo.size <= 1.5 * 1024 * 1024) { URL.revokeObjectURL(url); return resolve(arquivo); }
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * escala); c.height = Math.round(img.height * escala);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    c.toBlob((b) => resolve(b ? new File([b], (arquivo.name || 'certificado').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : arquivo), 'image/jpeg', 0.85);
  };
  img.onerror = () => { URL.revokeObjectURL(url); resolve(arquivo); };
  img.src = url;
});

const tamanhoLegivel = (n) => n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

const escolherCertificado = async (arquivo) => {
  const box = document.getElementById('arquivoCert');
  const btn = document.getElementById('btnEnviarCert');
  _arquivoEscolhido = null;
  if (btn) btn.disabled = true;
  if (!arquivo || !box) return;
  const tipos = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
  if (!tipos.includes(arquivo.type)) {
    box.hidden = false; box.className = 'val-arquivo erro';
    box.innerHTML = '<i data-lucide="alert-triangle"></i><span>Formato não aceito. Envie PDF, JPG ou PNG.</span>';
    return;
  }
  const pronto = arquivo.type.startsWith('image/') ? await reduzirImagem(arquivo) : arquivo;
  if (pronto.size > TAM_MAX_CERT) {
    box.hidden = false; box.className = 'val-arquivo erro';
    box.innerHTML = `<i data-lucide="alert-triangle"></i><span>O arquivo tem ${tamanhoLegivel(pronto.size)} — o máximo é 4 MB. Tente exportar o PDF em tamanho menor ou enviar uma foto.</span>`;
    return;
  }
  _arquivoEscolhido = pronto;
  box.hidden = false; box.className = 'val-arquivo';
  const ehImg = pronto.type.startsWith('image/');
  box.innerHTML = `${ehImg ? `<img alt="Prévia do certificado" src="${URL.createObjectURL(pronto)}" />` : '<i data-lucide="file-text"></i>'}
    <span><strong>${esc(pronto.name || 'certificado')}</strong><small>${tamanhoLegivel(pronto.size)}</small></span>`;
  if (btn) btn.disabled = false;
};

const enviarCertificado = (chave) => {
  if (!_arquivoEscolhido) return;
  const btn = document.getElementById('btnEnviarCert');
  const prog = document.getElementById('progCert');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader"></i> Enviando…'; }
  if (prog) { prog.hidden = false; prog.firstElementChild.style.width = '0%'; }

  // XMLHttpRequest (e não fetch) para mostrar a barra de progresso do envio
  const xhr = new XMLHttpRequest();
  xhr.open('POST', `/api/eventos/${encodeURIComponent(chave)}/certificado`);
  xhr.withCredentials = true;
  xhr.setRequestHeader('Content-Type', _arquivoEscolhido.type);
  xhr.setRequestHeader('X-Nome-Arquivo', encodeURIComponent(_arquivoEscolhido.name || 'certificado'));
  xhr.upload.onprogress = (e) => { if (prog && e.lengthComputable) prog.firstElementChild.style.width = `${Math.round(e.loaded / e.total * 100)}%`; };
  xhr.onload = () => {
    let data = {};
    try { data = JSON.parse(xhr.responseText || '{}'); } catch (e) { /* resposta não-JSON */ }
    if (xhr.status === 401) { window.location.href = '/login'; return; }
    if (xhr.status >= 200 && xhr.status < 300 && data.sucesso) {
      atualizarPresencaLocal(chave, data.presenca);
      fecharValidacao();
      aviso('Certificado enviado! Você recebe um aviso quando um professor conferir.', 'ok');
      return;
    }
    aviso(data.erro || 'Não foi possível enviar o certificado.', 'erro');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="send"></i> Enviar certificado'; }
    if (prog) prog.hidden = true;
  };
  xhr.onerror = () => {
    aviso('Erro de conexão ao enviar. Tente de novo.', 'erro');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="send"></i> Enviar certificado'; }
    if (prog) prog.hidden = true;
  };
  xhr.send(_arquivoEscolhido);
};

const cancelarPresenca = async (chave) => {
  try {
    const r = await fetch(`/api/eventos/${encodeURIComponent(chave)}/presenca`, { method: 'DELETE', credentials: 'include' });
    if (!r.ok) throw new Error();
    atualizarPresencaLocal(chave, null);
    fecharValidacao();
    aviso('Envio cancelado.');
  } catch (e) { aviso('Não foi possível cancelar agora.', 'erro'); }
};

// ── QR Code ──
let _jsQrCarregando = null;
const carregarJsQr = () => {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  if (!_jsQrCarregando) {
    _jsQrCarregando = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/vendor/jsQR.min.js';
      s.onload = () => resolve(window.jsQR);
      s.onerror = () => { _jsQrCarregando = null; reject(new Error('jsQR')); };
      document.head.appendChild(s);
    });
  }
  return _jsQrCarregando;
};

const statusQr = (msg, tipo = '') => {
  const el = document.getElementById('qrStatus');
  if (el) { el.textContent = msg; el.className = `val-dica ${tipo}`; }
};

const pararCamera = () => {
  if (!_camera) return;
  cancelAnimationFrame(_camera.raf);
  _camera.stream?.getTracks().forEach(t => t.stop());
  _camera = null;
  const box = document.getElementById('cameraBox');
  if (box) box.hidden = true;
  const btn = document.getElementById('btnCamera');
  if (btn) btn.innerHTML = '<i data-lucide="camera"></i> Ler com a câmera';
};

const lerQrCamera = async (chave) => {
  if (_camera) { pararCamera(); return; }
  if (!navigator.mediaDevices?.getUserMedia) { statusQr('Seu navegador não libera a câmera. Use "Enviar print do QR".', 'erro'); return; }
  try {
    const [jsQR, stream] = await Promise.all([
      carregarJsQr(),
      navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }),
    ]);
    const video = document.getElementById('cameraVideo');
    const box = document.getElementById('cameraBox');
    if (!video || !box) { stream.getTracks().forEach(t => t.stop()); return; }
    box.hidden = false;
    video.srcObject = stream;
    await video.play();
    _camera = { stream, raf: 0 };
    document.getElementById('btnCamera').innerHTML = '<i data-lucide="x"></i> Fechar câmera';
    statusQr('Aponte a câmera para o QR Code da sua inscrição…');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const quadro = () => {
      if (!_camera) return;
      if (video.readyState >= 2 && video.videoWidth) {
        const esc_ = Math.min(1, 640 / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * esc_); canvas.height = Math.round(video.videoHeight * esc_);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const achou = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' });
        if (achou?.data) { pararCamera(); enviarQr(chave, achou.data); return; }
      }
      _camera.raf = requestAnimationFrame(quadro);
    };
    _camera.raf = requestAnimationFrame(quadro);
  } catch (e) {
    pararCamera();
    statusQr(e?.name === 'NotAllowedError'
      ? 'Você não liberou a câmera. Libere nas permissões do navegador, ou envie uma foto do QR.'
      : 'Não foi possível abrir a câmera. Envie um print do QR.', 'erro');
  }
};

const lerQrFoto = async (arquivo, chave) => {
  if (!arquivo) return;
  statusQr('Lendo a foto…');
  try {
    const jsQR = await carregarJsQr();
    const url = URL.createObjectURL(arquivo);
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    URL.revokeObjectURL(url);
    // Tenta em vários tamanhos: num print do e-mail o QR é pequeno perto do texto
    for (const max of [1000, 2000, Math.max(img.width, img.height)]) {
      const esc_ = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * esc_); c.height = Math.round(img.height * esc_);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const achou = jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
      if (achou?.data) { enviarQr(chave, achou.data); return; }
    }
    statusQr('Não achamos um QR Code nessa imagem. Recorte o print deixando o QR maior, ou tire uma foto mais de perto e sem reflexo.', 'erro');
  } catch (e) {
    statusQr('Não foi possível ler a foto.', 'erro');
  } finally {
    const inp = document.getElementById('inputQrFoto'); if (inp) inp.value = '';
  }
};

const enviarQr = async (chave, conteudo) => {
  statusQr('QR Code lido! Validando…');
  try {
    const r = await fetch(`/api/eventos/${encodeURIComponent(chave)}/qrcode`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conteudo }),
    });
    if (r.status === 401) { window.location.href = '/login'; return; }
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.sucesso) {
      statusQr(data.erro || 'Não foi possível validar.', 'erro');
      return;
    }
    if (data.presenca) atualizarPresencaLocal(chave, data.presenca);
    fecharValidacao();
    if (data.jaValidada) { aviso('Sua presença neste evento já estava validada.'); return; }
    if (data.presenca?.status === 'pendente') {
      aviso('QR Code recebido! Um professor vai conferir e você recebe um aviso.', 'ok');
      return;
    }
    aviso('Presença validada! 🎉', 'ok');
    soltarConfetes(2400);
    setTimeout(verificarNovidades, 1500);
  } catch (e) {
    statusQr('Erro de conexão. Tente de novo.', 'erro');
  }
};

// ── Conquistas (gamificação) ───────────────────────────────────
const carregarConquistas = async () => {
  state.loaded['conquistas'] = true;
  const el = document.getElementById('conquistasContent');
  try {
    const dados = await api('/api/minhas-conquistas');
    if (!dados) return;

    const { pontos = 0, desbloqueadas = [], disponiveis = [] } = dados;

    const card = (c, desbloqueada) => `
      <div class="conq-card ${desbloqueada ? 'desbloqueada' : 'bloqueada'}">
        <div class="ic">${esc(c.icone || '🏆')}</div>
        <div>
          <div class="nome">${esc(c.nome)}</div>
          ${c.descricao ? `<div class="desc">${esc(c.descricao)}</div>` : ''}
          <span class="pts"><i data-lucide="star"></i> ${Number(c.pontos) || 0} pts${c.vezes > 1 ? ` · ×${c.vezes}` : ''}</span>
          ${(!desbloqueada && c.origem === 'automatica')
            ? `<span class="auto"><i data-lucide="settings"></i> Automática</span>` : ''}
          ${c.comoGanhar ? `<div class="como">${esc(c.comoGanhar)}</div>` : ''}
        </div>
      </div>`;

    const grupoDesbloqueadas = desbloqueadas.length
      ? `<div class="conq-grid">${desbloqueadas.map(c => card(c, true)).join('')}</div>`
      : `<div class="conq-vazio">Você ainda não desbloqueou nenhuma conquista. Veja abaixo o que dá para conquistar! <i data-lucide="arrow-down"></i></div>`;

    const grupoDisponiveis = disponiveis.length
      ? `<div class="conq-grid">${disponiveis.map(c => card(c, false)).join('')}</div>`
      : `<div class="conq-vazio">Você já desbloqueou todas as conquistas disponíveis. Parabéns! <i data-lucide="party-popper"></i></div>`;

    el.innerHTML = `
      ${cardInfo('conquistas')}
      <div class="conq-resumo">
        <span class="estrela"><i data-lucide="star"></i></span>
        <div>
          <div class="total">${pontos}</div>
          <div class="label">pontos acumulados · ${dados.totalRegistros ?? desbloqueadas.length} conquista(s)</div>
        </div>
      </div>

      <div class="conq-grupo-titulo"><i data-lucide="badge-check"></i> Desbloqueadas</div>
      ${grupoDesbloqueadas}

      <div class="conq-grupo-titulo"><i data-lucide="lock"></i> Disponíveis</div>
      ${grupoDisponiveis}
    `;
  } catch (e) {
    el.innerHTML =
      '<div class="empty-state"><div class="icon"><i data-lucide="alert-triangle"></i></div><p>Erro ao carregar conquistas.</p></div>';
  }
};

// ── Dashboard (painel inicial) ─────────────────────────────────
const irParaSecao = (sec) => {
  if (sec === 'calendario') sec = 'eventos'; // nome antigo da aba
  const item = document.querySelector(`.nav-item[data-section="${sec}"]`);
  if (item) item.click();
};

const carregarDashboard = async () => {
  state.loaded['dashboard'] = true;
  const el = document.getElementById('dashboardContent');
  try {
    // Resumo, ranking (para o pódio) e eventos — em paralelo.
    const [dash, rank, eventos] = await Promise.all([
      api('/api/dashboard'),
      api('/api/ranking?escopo=geral').catch(() => null),
      api('/api/eventos').catch(() => []),
    ]);
    if (!dash) return;

    const n = dash.nivel || {};
    state.dash = dash; // usado pela janela "Ver níveis"
    const primeiroNome = (dash.nome || 'Aluno').split(' ')[0];
    const inicial = primeiroNome.charAt(0).toUpperCase() || '?';

    const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    const fmtData = (s) => {
      const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return { dia: m[3], mes: MESES[Number(m[2]) - 1] || '' };
      const d = new Date(s);
      return isNaN(d) ? { dia: '–', mes: '' } : { dia: String(d.getDate()).padStart(2,'0'), mes: MESES[d.getMonth()] };
    };

    // ── Pódio do ranking (top 3) ──
    const top3 = (rank?.ranking || []).slice(0, 3);
    const podioHtml = top3.length
      ? top3.map(r => {
          const cls = r.posicao === 1 ? 'ouro' : r.posicao === 2 ? 'prata' : r.posicao === 3 ? 'bronze' : '';
          return `
            <div class="dash-rank-row ${r.isMe ? 'eu' : ''}">
              <div class="pos ${cls}">${r.posicao}º</div>
              <div class="av"><i data-lucide="user"></i></div>
              <div class="nm">${esc(r.nome)}${r.isMe ? ' (Você)' : ''}</div>
              <div class="xp">${r.pontos} pts</div>
            </div>`;
        }).join('')
      : `<div style="color:var(--cinza);font-size:0.88rem;padding:0.5rem 0">Ninguém pontuou ainda. <i data-lucide="rocket"></i></div>`;

    // ── Timeline de eventos (passados + futuros) ──
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const comData = (Array.isArray(eventos) ? eventos : [])
      .map(ev => ({ ...ev, _d: dataLocal(ev.data_inicio || ev.data) }))
      .filter(ev => ev._d);

    const futuros  = comData.filter(ev => ev._d >= hoje).sort((a,b) => a._d - b._d); // mais perto primeiro
    const passados = comData.filter(ev => ev._d <  hoje).sort((a,b) => b._d - a._d); // mais recente primeiro

    // Os eventos não têm mais "id" (agora é "chave"): antes null === null marcava
    // TODOS os futuros como "próximo"
    const idEv = (ev) => ev.chave ?? ev.id ?? ev._id ?? ev.nome;
    const idProximo = futuros.length ? idEv(futuros[0]) : undefined;

    // Ordem de exibição (topo→baixo): futuros (mais perto no topo) → [aviso se não houver futuros] → passados
    const linhaEvento = (ev, classe) => {
      const { dia, mes } = fmtData(ev.data_inicio || ev.data);
      const local = ev.local || ev.campus || '';
      const pres = ev.minhaPresenca?.status === 'aprovada' ? 'presença validada'
        : ev.minhaPresenca?.status === 'pendente' ? 'validação em análise'
        : (classe === 'passado' && ev.jaComecou && (ev.validacao?.certificado || ev.validacao?.qrcode)) ? 'participou? valide a presença' : '';
      const linha2 = [local, pres].filter(Boolean).join(' · ');
      return `
        <div class="dash-tl-item ${classe}">
          <div class="dash-tl-data"><div class="dia">${dia}</div><div class="mes">${mes}</div></div>
          <div class="dash-tl-corpo">
            <div class="n">${esc(ev.nome || 'Evento')}</div>
            ${linha2 ? `<div class="s">${esc(linha2)}</div>` : ''}
          </div>
        </div>`;
    };

    let timelineHtml = '';
    // Futuros no topo (o mais próximo recebe destaque "proximo")
    futuros.slice(0, 4).reverse().forEach(ev => {       // os 4 mais perto; reverse: mais distante em cima
      const ehProximo = idEv(ev) === idProximo;
      timelineHtml += linhaEvento(ev, ehProximo ? 'futuro proximo' : 'futuro');
    });
    // Aviso quando NÃO há eventos futuros — exatamente um nó com a mensagem
    if (!futuros.length) {
      timelineHtml += `
        <div class="dash-tl-item aviso proximo">
          <div class="dash-tl-data"><div class="dia">—</div><div class="mes"></div></div>
          <div class="dash-tl-corpo"><div class="n">Nenhum evento à frente por enquanto</div></div>
        </div>`;
    }
    // Passados embaixo
    passados.slice(0, 3).forEach(ev => { timelineHtml += linhaEvento(ev, 'passado'); });

    if (!comData.length) {
      timelineHtml = `<div style="color:var(--cinza);font-size:0.88rem;padding:0.5rem 0">Nenhum evento no calendário ainda. <i data-lucide="sprout"></i></div>`;
    }

    // ── Montagem ──
    el.innerHTML = `
      ${cardInfo('dashboard')}
      <div class="dash-hero">
        <div class="dash-avatar">${esc(inicial)}</div>
        <div class="ola">
          <h2>Olá, ${esc(primeiroNome)}!</h2>
          ${dash.curso ? `<div class="curso">${esc(dash.curso)}</div>` : ''}
          <button type="button" class="dash-nivel-btn" onclick="abrirNiveis()" aria-haspopup="dialog" title="Ver todos os níveis e como subir">
            <div class="dash-nivel-linha">
              <span class="badge-nivel"><i data-lucide="award"></i> Nível ${n.nivel} · ${esc(n.nome || '')}</span>
              <span>${n.faltamParaProximo ? `${n.faltamParaProximo} pts p/ ${esc(n.proximoNome)}` : 'nível máximo <i data-lucide="trophy"></i>'}</span>
              <span class="ver-niveis">Ver níveis <i data-lucide="chevron-right"></i></span>
            </div>
            <div class="dash-barra"><span style="width:${Math.min(100, Math.max(0, n.progresso || 0))}%"></span></div>
          </button>
        </div>
        <div class="indicadores">
          <div class="indicador"><div class="ic"><i data-lucide="star"></i></div><div class="v">${dash.pontos}</div><div class="l">Pontos</div></div>
          <div class="indicador"><div class="ic"><i data-lucide="${dash.rankingOculto ? 'eye-off' : 'trophy'}"></i></div><div class="v">${dash.posicaoGeral != null ? dash.posicaoGeral + "º" : "—"}</div><div class="l">${dash.rankingOculto ? 'Oculto no<br>ranking' : 'Lugar<br>Ranking Geral'}</div></div>
        </div>
      </div>

      <div class="dash-grid">
        <div>
          <div class="dash-mini-row">
            <button type="button" class="dash-mini" onclick="abrirNiveis()" aria-haspopup="dialog">
              <span class="seta"><i data-lucide="arrow-right"></i></span>
              <div class="ic"><i data-lucide="award"></i></div>
              <div class="v">Nível ${n.nivel ?? 1}</div>
              <div class="l">${esc(n.nome || '')}<br>Ver todos os níveis</div>
            </button>
            <button type="button" class="dash-mini" onclick="irParaSecao('conquistas')">
              <span class="seta"><i data-lucide="arrow-right"></i></span>
              <div class="ic"><i data-lucide="medal"></i></div>
              <div class="v">${dash.totalConquistas ?? 0}</div>
              <div class="l">Conquistas<br>Desbloqueadas</div>
            </button>
          </div>

          <div class="dash-painel">
            <div class="titulo">Ranking Geral</div>
            ${podioHtml}
            <button type="button" class="rodape-link" onclick="irParaSecao('ranking')">Ver Ranking Completo</button>
          </div>
        </div>

        <div class="dash-painel">
          <div class="titulo">Eventos</div>
          <div class="dash-timeline">${timelineHtml}</div>
          <button type="button" class="rodape-link" onclick="irParaSecao('eventos')">Ver todos os eventos</button>
        </div>
      </div>
    `;
  } catch (e) {
    el.innerHTML = '<div class="empty-state"><div class="icon"><i data-lucide="alert-triangle"></i></div><p>Erro ao carregar o painel.</p></div>';
  }
};

// ── Novidades: conquista nova / subiu de nível (com confetes) ──
const semAnimacao = () =>
  document.documentElement.hasAttribute('data-movimento') ||
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Confetes desenhados num <canvas> (sem biblioteca externa). Respeita
// "Reduzir animações" e o ajuste de movimento reduzido do sistema.
const soltarConfetes = (duracaoMs = 3200) => {
  if (semAnimacao()) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetes';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const ajustar = () => {
    canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  ajustar(); addEventListener('resize', ajustar);

  const css = getComputedStyle(document.documentElement);
  const cores = [css.getPropertyValue('--verde'), css.getPropertyValue('--pontos'), '#ff7eb6', '#7aa7ff', '#ffffff']
    .map(c => c.trim()).filter(Boolean);
  const N = Math.min(180, Math.round(innerWidth / 6));
  const pecas = Array.from({ length: N }, (_, i) => {
    const lado = i % 2 ? 1 : -1;  // dois "canhões", um de cada canto inferior
    return {
      x: lado > 0 ? innerWidth * 0.1 : innerWidth * 0.9, y: innerHeight + 10,
      vx: (Math.random() * 7 + 3) * lado, vy: -(Math.random() * 13 + 11),
      w: Math.random() * 7 + 5, h: Math.random() * 10 + 6,
      rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
      cor: cores[i % cores.length], forma: i % 3,
    };
  });

  const inicio = performance.now();
  const quadro = (t) => {
    const passou = t - inicio;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.globalAlpha = passou > duracaoMs - 600 ? Math.max(0, (duracaoMs - passou) / 600) : 1;
    pecas.forEach(p => {
      p.vy += 0.32; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.cor;
      if (p.forma === 0) ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      else if (p.forma === 1) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.fillRect(-p.w / 2, -1.5, p.w * 1.4, 3); }
      ctx.restore();
    });
    if (passou < duracaoMs) requestAnimationFrame(quadro);
    else { removeEventListener('resize', ajustar); canvas.remove(); }
  };
  requestAnimationFrame(quadro);
};

const verificarNovidades = async () => {
  try {
    const nov = await api('/api/novidades');
    if (!nov) return;
    const conquistas = Array.isArray(nov.conquistas) ? nov.conquistas : [];
    if (!conquistas.length && !nov.subiuNivel) return;

    const pts = conquistas.reduce((t, c) => t + (Number(c.pontos) || 0), 0);
    const titulo = nov.subiuNivel
      ? `Você subiu para o nível ${nov.subiuNivel.para}!`
      : conquistas.length === 1 ? 'Conquista desbloqueada!' : `${conquistas.length} conquistas novas!`;

    const modal = document.createElement('div');
    modal.className = 'niveis-overlay novidade-overlay open';
    modal.innerHTML = `
      <div class="niveis-dialog novidade-dialog" role="dialog" aria-modal="true" aria-labelledby="novTitulo">
        <div class="nov-emoji" aria-hidden="true">${nov.subiuNivel ? '⭐' : esc(conquistas[0]?.icone || '🏆')}</div>
        <h2 id="novTitulo">${esc(titulo)}</h2>
        ${nov.subiuNivel ? `<p class="nov-nivel">Agora você é <strong>${esc(nov.subiuNivel.nome)}</strong>.</p>` : ''}
        ${conquistas.length ? `
          <ul class="nov-lista">${conquistas.slice(0, 5).map(c => `
            <li><span class="nv-sug-ic">${esc(c.icone || '🏆')}</span><span>${esc(c.nome)}</span><strong>+${Number(c.pontos) || 0}</strong></li>`).join('')}
          </ul>
          ${conquistas.length > 5 ? `<p class="nov-mais">e mais ${conquistas.length - 5}…</p>` : ''}
          <p class="nov-total"><i data-lucide="star"></i> +${pts} pontos</p>` : ''}
        <div class="nov-acoes">
          <button type="button" class="nv-cta" data-acao="ver">${nov.subiuNivel ? 'Ver meus níveis' : 'Ver conquistas'}</button>
          <button type="button" class="acess-restaurar" data-acao="ok">Legal!</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    document.body.classList.add('config-aberta');
    const foco = document.activeElement;

    const fechar = (acao) => {
      modal.remove();
      if (!document.getElementById('configDrawer')?.classList.contains('open')) document.body.classList.remove('config-aberta');
      fetch('/api/novidades/vistas', { method: 'POST', credentials: 'include' }).catch(() => {});
      document.removeEventListener('keydown', esc_);
      if (acao === 'ver') { nov.subiuNivel ? abrirNiveis() : irParaSecao('conquistas'); }
      else foco?.focus?.();
    };
    const esc_ = (e) => { if (e.key === 'Escape') fechar('ok'); };
    document.addEventListener('keydown', esc_);
    modal.addEventListener('click', (e) => {
      const b = e.target.closest('[data-acao]');
      if (b) fechar(b.dataset.acao);
      else if (e.target === modal) fechar('ok');
    });
    setTimeout(() => modal.querySelector('[data-acao="ok"]')?.focus(), 50);
    soltarConfetes();
  } catch (e) { /* novidades são opcionais */ }
};

// ── Janela "Níveis" (aberta pelo nível do dashboard) ───────────

let _focoAntesNiveis = null;

const abrirNiveis = async () => {

  const dash = state.dash;

  if (!dash) return;

  _focoAntesNiveis = document.activeElement;

  let modal = document.getElementById('niveisModal');

  if (!modal) {

    modal = document.createElement('div');

    modal.id = 'niveisModal';

    modal.className = 'niveis-overlay';

    modal.innerHTML = `

      <div class="niveis-dialog" role="dialog" aria-modal="true" aria-labelledby="niveisTitulo">

        <div class="niveis-head">

          <h2 id="niveisTitulo"><i data-lucide="award"></i> Níveis do IFPlenus</h2>

          <button type="button" class="config-fechar" onclick="fecharNiveis()" aria-label="Fechar"><i data-lucide="x"></i></button>

        </div>

        <div class="niveis-body" id="niveisBody"></div>

      </div>`;

    modal.addEventListener('click', (e) => { if (e.target === modal) fecharNiveis(); });

    document.body.appendChild(modal);

  }

  const pontos = Number(dash.pontos) || 0;

  const atual = dash.nivel?.nivel || 1;

  const niveis = Array.isArray(dash.niveis) && dash.niveis.length

    ? dash.niveis

    : [{ nivel: atual, nome: dash.nivel?.nome || '', min: dash.nivel?.inicioFaixa || 0 }];

  const escada = niveis.map((nv, i) => {

    const prox = niveis[i + 1];

    const estado = nv.nivel < atual ? 'feito' : nv.nivel === atual ? 'atual' : 'futuro';

    const faixa = prox ? `${nv.min} a ${prox.min - 1} pts` : `${nv.min} pts ou mais`;

    let detalhe = '';

    if (estado === 'feito') detalhe = '<span class="nv-tag ok"><i data-lucide="check"></i> Alcançado</span>';

    if (estado === 'atual') {

      detalhe = prox

        ? `<div class="nv-progresso"><div class="dash-barra"><span style="width:${Math.min(100, Math.max(0, dash.nivel?.progresso || 0))}%"></span></div>

             <small>Faltam <strong>${prox.min - pontos} pts</strong> para ${esc(prox.nome)}</small></div>`

        : '<span class="nv-tag ok"><i data-lucide="trophy"></i> Nível máximo!</span>';

    }

    if (estado === 'futuro') detalhe = `<span class="nv-tag"><i data-lucide="lock"></i> Faltam ${nv.min - pontos} pts</span>`;

    return `

      <li class="nv-item ${estado}">

        <div class="nv-num">${estado === 'feito' ? '<i data-lucide="check"></i>' : nv.nivel}</div>

        <div class="nv-info">

          <div class="nv-nome">${esc(nv.nome)} ${estado === 'atual' ? '<span class="nv-voce">VOCÊ</span>' : ''}</div>

          <div class="nv-faixa">${faixa}</div>

          ${estado === 'atual' ? detalhe : ''}

        </div>

        ${estado !== 'atual' ? detalhe : ''}

      </li>`;

  }).join('');

  document.getElementById('niveisBody').innerHTML = `

    <div class="nv-resumo">

      <div><div class="nv-pts"><i data-lucide="star"></i> ${pontos}</div><div class="nv-pts-l">seus pontos</div></div>

      <div><div class="nv-pts">${esc(dash.nivel?.nome || '')}</div><div class="nv-pts-l">nível atual</div></div>

    </div>

    <ol class="nv-escada">${escada}</ol>

    <h3 class="nv-subtitulo"><i data-lucide="sparkles"></i> Como ganhar pontos</h3>

    <ul class="nv-dicas">

      <li><span class="ic"><i data-lucide="medal"></i></span><div><strong>Desbloqueie conquistas</strong><p>Cada conquista vale pontos. Algumas são automáticas, outras são concedidas pelos professores.</p></div></li>

      <li><span class="ic"><i data-lucide="folder"></i></span><div><strong>Participe de projetos</strong><p>Peça para entrar em projetos de pesquisa ou extensão na aba Projetos. Quando o professor aceitar, você pode ganhar conquistas.</p></div></li>

      <li><span class="ic"><i data-lucide="graduation-cap"></i></span><div><strong>Capriche nas notas</strong><p>Conquistas de desempenho são liberadas sozinhas quando suas notas no SUAP atingem a meta.</p></div></li>

    </ul>

    <h3 class="nv-subtitulo"><i data-lucide="target"></i> Próximas conquistas para você</h3>

    <div id="nvProximas">${esqueleto('lista', 2)}</div>

    <button type="button" class="nv-cta" onclick="fecharNiveis(); irParaSecao('conquistas')">Ver todas as conquistas <i data-lucide="arrow-right"></i></button>`;

  modal.classList.add('open');

  document.body.classList.add('config-aberta');

  setTimeout(() => modal.querySelector('.config-fechar')?.focus(), 50);

  // Sugestões: as conquistas disponíveis que valem menos pontos (mais fáceis primeiro)

  try {

    const dados = await api('/api/minhas-conquistas');

    const box = document.getElementById('nvProximas');

    if (!dados || !box) return;

    const disp = (dados.disponiveis || []).slice().sort((a, b) => (a.pontos || 0) - (b.pontos || 0)).slice(0, 3);

    box.innerHTML = disp.length

      ? `<div class="nv-sugestoes">${disp.map(c => `

          <div class="nv-sug">

            <span class="nv-sug-ic">${esc(c.icone || '🏆')}</span>

            <div><strong>${esc(c.nome)}</strong>${c.descricao ? `<p>${esc(c.descricao)}</p>` : ''}</div>

            <span class="nv-sug-pts">+${Number(c.pontos) || 0}</span>

          </div>`).join('')}</div>`

      : '<p class="nv-vazio">Você já desbloqueou todas as conquistas disponíveis. <i data-lucide="party-popper"></i></p>';

  } catch (e) {

    const box = document.getElementById('nvProximas');

    if (box) box.innerHTML = '<p class="nv-vazio">Não foi possível carregar as conquistas agora.</p>';

  }

};

const fecharNiveis = () => {

  const modal = document.getElementById('niveisModal');

  if (!modal || !modal.classList.contains('open')) return;

  modal.classList.remove('open');

  if (!document.getElementById('configDrawer')?.classList.contains('open')) {

    document.body.classList.remove('config-aberta');

  }

  _focoAntesNiveis?.focus?.();

};

// ── Ranking (gamificação) ──────────────────────────────────────
let _rankEscopo = 'geral';

const carregarRanking = async () => {
  state.loaded['ranking'] = true;
  await renderRanking();
};

const trocarEscopoRanking = (escopo) => {
  _rankEscopo = escopo;
  renderRanking();
};

const renderRanking = async () => {
  const el = document.getElementById('rankingContent');
  el.innerHTML = esqueleto('ranking');
  const pedido = (state.rankPedido = (state.rankPedido || 0) + 1);
  try {
    const dados = await api(`/api/ranking?escopo=${_rankEscopo}`);
    if (!dados || pedido !== state.rankPedido) return;

    const toggle = `
      <div class="rank-toggle">
        <button class="${_rankEscopo === 'geral' ? 'ativo' : ''}" onclick="trocarEscopoRanking('geral')"><i data-lucide="globe"></i> Geral</button>
        <button class="${_rankEscopo === 'curso' ? 'ativo' : ''}" onclick="trocarEscopoRanking('curso')"><i data-lucide="graduation-cap"></i> Meu curso</button>
      </div>`;

    // Card explicando o critério de classificação (e o desempate).
    const rankInfo = cardInfo('ranking');

    // Caso o aluno não tenha curso registrado ainda
    if (dados.semCurso) {
      el.innerHTML = rankInfo + toggle + `
        <div class="rank-vazio">
          Seu curso ainda não está registrado. Saia e entre de novo no portal
          para registrá-lo e habilitar o ranking do seu curso.
        </div>`;
      return;
    }

    const medalha = (pos) =>
      pos === 1 ? 'ouro' : pos === 2 ? 'prata' : pos === 3 ? 'bronze' : '';
    const simbolo = (pos) =>
      pos === 1 ? '<i data-lucide="medal"></i>' : pos === 2 ? '<i data-lucide="medal"></i>' : pos === 3 ? '<i data-lucide="medal"></i>' : pos;

    const eu = dados.eu || {};
    const nivelEu = eu.nivel ? `<span class="col-nivel">Nível ${eu.nivel.nivel} · ${esc(eu.nivel.nome)}</span>` : '';
    const vizinhos = Array.isArray(dados.vizinhos) ? dados.vizinhos : [];
    const cabecalhoEu = `
      <div class="rank-eu">
        <div class="pos">${eu.posicao ? `${eu.posicao}º` : '—'}</div>
        <div class="meta">
          <div class="n">${esc(eu.nome || 'Você')}${nivelEu}</div>
          <div class="s">${eu.oculto
            ? 'Você está <strong>oculto</strong> no ranking — os outros alunos não te veem.'
            : `Sua posição ${dados.escopo === 'curso' ? 'no curso' : 'geral'} · entre ${dados.total} aluno(s)${eu.anonimo ? ' · aparece como anônimo' : ''}`}</div>
        </div>
        <div class="pts"><i data-lucide="star"></i> ${eu.pontos || 0}</div>
        ${eu.oculto
          ? `<button type="button" class="rank-onde" onclick="abrirConfig('privacidade')"><i data-lucide="eye"></i> Privacidade</button>`
          : eu.posicao ? `<button type="button" class="rank-onde" onclick="irParaMinhaPosicao()"><i data-lucide="locate-fixed"></i> Ver onde estou</button>` : ''}
      </div>`;

    let lista;
    if (!dados.ranking.length) {
      lista = `<div class="rank-vazio">Ninguém pontuou ainda. Seja o primeiro! <i data-lucide="rocket"></i></div>`;
    } else {
      lista = `<div class="rank-lista">` + dados.ranking.map(r => `
        <div class="rank-row ${r.isMe ? 'eu' : ''}">
          <div class="col-pos ${medalha(r.posicao)}">${simbolo(r.posicao)}</div>
          <div class="col-nome">
            <span class="col-nome-linha">${esc(r.nome)}${r.isMe ? '<span class="vc">VOCÊ</span>' : ''}</span>
            ${r.nivel ? `<span class="col-nivel">Nível ${r.nivel.nivel} · ${esc(r.nivel.nome)}</span>` : ''}
          </div>
          <div class="col-pts"><i data-lucide="star"></i> ${r.pontos}</div>
        </div>`).join('') + `</div>`;
    }

    // Fora do top 50: mostra a "vizinhança" do aluno logo abaixo da lista
    if (vizinhos.length) {
      lista += `
        <div class="rank-separador" aria-hidden="true"><span></span><span></span><span></span></div>
        <div class="rank-lista" id="rankVizinhos" aria-label="Alunos perto da sua posição">` + vizinhos.map(r => `
          <div class="rank-row ${r.isMe ? 'eu' : ''}">
            <div class="col-pos">${r.posicao}</div>
            <div class="col-nome">
              <span class="col-nome-linha">${esc(r.nome)}${r.isMe ? '<span class="vc">VOCÊ</span>' : ''}</span>
              ${r.nivel ? `<span class="col-nivel">Nível ${r.nivel.nivel} · ${esc(r.nivel.nome)}</span>` : ''}
            </div>
            <div class="col-pts"><i data-lucide="star"></i> ${r.pontos}</div>
          </div>`).join('') + `</div>`;
    }

    el.innerHTML = rankInfo + toggle + cabecalhoEu + lista;
  } catch (e) {
    el.innerHTML = '<div class="empty-state"><div class="icon"><i data-lucide="alert-triangle"></i></div><p>Erro ao carregar o ranking.</p></div>';
  }
};

// Rola até a linha do aluno no ranking e dá um destaque rápido
const irParaMinhaPosicao = () => {
  const linha = document.querySelector('#rankingContent .rank-row.eu');
  if (!linha) return;
  linha.scrollIntoView({ behavior: document.documentElement.hasAttribute('data-movimento') ? 'auto' : 'smooth', block: 'center' });
  linha.classList.remove('piscar'); void linha.offsetWidth; linha.classList.add('piscar');
  linha.setAttribute('tabindex', '-1'); linha.focus({ preventScroll: true });
};

// ── Minha Trajetória (histórico do aluno) ──────────────────────
const TRAJ_TIPOS = {
  conquista: { rot: 'Conquista', ic: 'trophy', cls: 't-conq' },
  projeto:   { rot: 'Projeto',   ic: 'folder-check', cls: 't-proj' },
  evento:    { rot: 'Evento',    ic: 'ticket', cls: 't-ev' },
};
state.trajFiltro = '';

const carregarTrajetoria = async () => {
  state.loaded['trajetoria'] = true;
  const el = document.getElementById('trajetoriaContent');
  try {
    const dados = await api('/api/trajetoria');
    if (!dados) return;
    state.trajetoria = dados;
    renderTrajetoria();
  } catch (e) {
    delete state.loaded['trajetoria'];
    el.innerHTML = '<div class="empty-state"><div class="icon"><i data-lucide="alert-triangle"></i></div><p>Erro ao carregar a trajetória.</p></div>';
  }
};

const filtrarTrajetoria = (t) => { state.trajFiltro = t; renderTrajetoria(); };

const renderTrajetoria = () => {
  const el = document.getElementById('trajetoriaContent');
  const dados = state.trajetoria || {};
  const itens = Array.isArray(dados.trajetoria) ? dados.trajetoria : [];
  const r = dados.resumo || {
    conquistas: itens.filter(i => i.tipo === 'conquista').length,
    projetos: itens.filter(i => i.tipo === 'projeto').length,
    eventos: itens.filter(i => i.tipo === 'evento').length,
    pontos: itens.reduce((t, i) => t + (Number(i.pontos) || 0), 0),
  };

  const numeros = `
    <div class="traj-numeros">
      <div class="tn destaque"><i data-lucide="star"></i><strong>${r.pontos}</strong><span>pontos ganhos</span></div>
      <div class="tn"><i data-lucide="trophy"></i><strong>${r.conquistas}</strong><span>conquista${r.conquistas === 1 ? '' : 's'}</span></div>
      <div class="tn"><i data-lucide="folder-check"></i><strong>${r.projetos}</strong><span>projeto${r.projetos === 1 ? '' : 's'}</span></div>
      <div class="tn"><i data-lucide="ticket"></i><strong>${r.eventos}</strong><span>evento${r.eventos === 1 ? '' : 's'}</span></div>
    </div>`;

  if (!itens.length) {
    el.innerHTML = cardInfo('trajetoria') + numeros + `
      <div class="empty-state traj-vazio-novo"><div class="icon"><i data-lucide="rocket"></i></div>
        <p>Sua trajetória começa aqui. Assim que você ganhar uma conquista, entrar num projeto ou validar a presença num evento, ela aparece nesta linha do tempo.</p>
        <button type="button" class="btn-validar secundario" onclick="irParaSecao('eventos')"><i data-lucide="ticket"></i> Ver eventos</button>
      </div>`;
    return;
  }

  const f = state.trajFiltro;
  const aba = (k, rot, n) => `<button type="button" role="tab" class="ev-filtro ${f === k ? 'ativo' : ''}" aria-selected="${f === k}" onclick="filtrarTrajetoria('${k}')">${rot}<span>${n}</span></button>`;
  const lista = itens.filter(i => !f || i.tipo === f);

  // Agrupa por mês ("Novembro de 2026")
  const NOMES_MES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const grupos = [];
  lista.forEach(it => {
    const d = new Date(it.data);
    const chave = isNaN(d) ? 'sem-data' : `${d.getFullYear()}-${d.getMonth()}`;
    let g = grupos.find(x => x.chave === chave);
    if (!g) grupos.push(g = { chave, titulo: isNaN(d) ? 'Sem data' : `${NOMES_MES[d.getMonth()]} de ${d.getFullYear()}`, itens: [] });
    g.itens.push(it);
  });

  const item = (it) => {
    const t = TRAJ_TIPOS[it.tipo] || TRAJ_TIPOS.conquista;
    const d = new Date(it.data);
    const quando = isNaN(d) ? '' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    const extra = it.tipo === 'conquista' && it.pontos
      ? `<span class="traj-pts">+${it.pontos} pts</span>`
      : it.projetoTipo ? `<span class="traj-tag ${esc(it.projetoTipo)}">${it.projetoTipo === 'pesquisa' ? 'Pesquisa' : 'Extensão'}</span>` : '';
    return `<li class="ti ${t.cls}">
      <span class="ti-ic" aria-hidden="true">${it.tipo === 'conquista' && it.icone ? esc(it.icone) : `<i data-lucide="${t.ic}"></i>`}</span>
      <div class="ti-corpo">
        <div class="ti-topo"><strong>${esc(it.titulo)}</strong>${extra}</div>
        <p>${esc(it.descricao || t.rot)}</p>
      </div>
      <time class="ti-data" datetime="${esc(it.data || '')}">${quando}</time>
    </li>`;
  };

  el.innerHTML = `
    ${cardInfo('trajetoria')}
    ${numeros}
    <div class="traj-barra">
      <div class="ev-filtros" role="tablist" aria-label="Filtrar trajetória">
        ${aba('', 'Tudo', itens.length)}${aba('conquista', 'Conquistas', r.conquistas)}${aba('projeto', 'Projetos', r.projetos)}${aba('evento', 'Eventos', r.eventos)}
      </div>
      <button type="button" class="btn-link-ev traj-imprimir" onclick="window.print()"><i data-lucide="printer"></i> Imprimir</button>
    </div>
    ${lista.length ? grupos.map(g => `
      <section class="traj-mes">
        <h3>${g.titulo}</h3>
        <ol class="traj-linha">${g.itens.map(item).join('')}</ol>
      </section>`).join('') : '<div class="empty-state"><p>Nada desse tipo ainda.</p></div>'}`;
};

// ── Logout ─────────────────────────────────────────────────────
const logout = async () => {
  try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); }
  catch (e) { /* sai mesmo sem resposta */ }
  window.location.href = '/login';
};

// ── BUSCA RÁPIDA (Ctrl+K / ⌘K / "/") ───────────────────────────
// Uma caixa que leva a qualquer lugar do portal: seções, configurações e ações.
const _itensBusca = () => [
  ...[...document.querySelectorAll('.sidebar .nav-item')].map(n => ({
    titulo: n.textContent.trim(), grupo: 'Ir para', icone: n.querySelector('[data-lucide]')?.getAttribute('data-lucide') || 'arrow-right',
    acao: () => irParaSecao(n.dataset.section),
  })),
  { titulo: 'Validar presença em um evento', grupo: 'Ações', icone: 'badge-check', termos: 'certificado qr code check-in', acao: () => { state.evFiltro = 'validar'; irParaSecao('eventos'); if (state.eventos) renderEventos(); } },
  { titulo: 'Ver níveis e como subir', grupo: 'Ações', icone: 'award', termos: 'pontos nivel', acao: () => state.dash ? abrirNiveis() : irParaSecao('dashboard') },
  { titulo: 'Minha posição no ranking', grupo: 'Ações', icone: 'trending-up', termos: 'onde estou', acao: () => irParaSecao('ranking') },
  { titulo: 'Configurações', grupo: 'Configurações', icone: 'settings', acao: () => abrirConfig() },
  { titulo: 'Tema (escuro, claro, alto contraste…)', grupo: 'Configurações', icone: 'palette', termos: 'cores modo escuro claro daltonismo', acao: () => abrirConfig('tema') },
  { titulo: 'Acessibilidade', grupo: 'Configurações', icone: 'accessibility', termos: 'fonte texto tamanho animacoes', acao: () => abrirConfig('acessibilidade') },
  { titulo: 'Notificações por e-mail', grupo: 'Configurações', icone: 'mail', termos: 'email avisos', acao: () => abrirConfig('notificacoes') },
  { titulo: 'Privacidade no ranking', grupo: 'Configurações', icone: 'eye', termos: 'anonimo oculto', acao: () => abrirConfig('privacidade') },
  { titulo: 'Meus dados do SUAP', grupo: 'Configurações', icone: 'user', termos: 'perfil curso matricula', acao: () => abrirConfig('dados') },
  { titulo: 'Sair do IFPlenus', grupo: 'Conta', icone: 'log-out', termos: 'logout sair', acao: () => logout() },
];

let _buscaFoco = null;
let _buscaSel = 0;
let _buscaLista = [];

const abrirBusca = () => {
  let box = document.getElementById('buscaRapida');
  if (!box) {
    box = document.createElement('div');
    box.id = 'buscaRapida';
    box.className = 'busca-overlay';
    box.innerHTML = `
      <div class="busca-dialog" role="dialog" aria-modal="true" aria-label="Busca rápida">
        <div class="busca-campo">
          <i data-lucide="search"></i>
          <input type="text" id="buscaInput" role="combobox" aria-expanded="true" aria-controls="buscaResultados" aria-autocomplete="list"
                 placeholder="Para onde você quer ir?" autocomplete="off" spellcheck="false" />
          <kbd>Esc</kbd>
        </div>
        <ul class="busca-resultados" id="buscaResultados" role="listbox" aria-label="Resultados"></ul>
        <div class="busca-rodape"><span><kbd>↑</kbd><kbd>↓</kbd> navegar</span><span><kbd>Enter</kbd> abrir</span><span><kbd>Ctrl</kbd>+<kbd>K</kbd> abre de qualquer lugar</span></div>
      </div>`;
    box.addEventListener('click', (e) => { if (e.target === box) fecharBusca(); });
    document.body.appendChild(box);
    const inp = box.querySelector('#buscaInput');
    inp.addEventListener('input', () => { _buscaSel = 0; desenharBusca(inp.value); });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); _buscaSel = Math.min(_buscaLista.length - 1, _buscaSel + 1); desenharBusca(inp.value, true); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); _buscaSel = Math.max(0, _buscaSel - 1); desenharBusca(inp.value, true); }
      else if (e.key === 'Enter') { e.preventDefault(); executarBusca(_buscaSel); }
      else if (e.key === 'Escape') { e.preventDefault(); fecharBusca(); }
      else if (e.key === 'Tab') { e.preventDefault(); } // mantém o foco dentro da caixa
    });
  }
  _buscaFoco = document.activeElement;
  _buscaSel = 0;
  const inp = box.querySelector('#buscaInput');
  inp.value = '';
  desenharBusca('');
  box.classList.add('open');
  inp.focus(); // na hora: quem digita rápido logo após Ctrl+K não perde letras
};

const desenharBusca = (termo, soSelecao) => {
  const ul = document.getElementById('buscaResultados');
  if (!ul) return;
  if (!soSelecao) {
    const t = normalizarTexto(termo).trim();
    const palavras = t.split(/\s+/).filter(Boolean);
    _buscaLista = _itensBusca().filter(i => {
      const alvo = normalizarTexto(`${i.titulo} ${i.grupo} ${i.termos || ''}`);
      return palavras.every(p => alvo.includes(p));
    });
    ul.innerHTML = _buscaLista.length
      ? _buscaLista.map((i, n) => `<li role="option" id="busca-op-${n}" class="busca-item" data-n="${n}">
          <i data-lucide="${esc(i.icone)}"></i><span>${esc(i.titulo)}</span><small>${esc(i.grupo)}</small></li>`).join('')
      : '<li class="busca-vazio">Nada encontrado. Tente "eventos", "tema" ou "ranking".</li>';
    ul.querySelectorAll('.busca-item').forEach(li => {
      li.addEventListener('click', () => executarBusca(Number(li.dataset.n)));
      li.addEventListener('mousemove', () => { if (_buscaSel !== Number(li.dataset.n)) { _buscaSel = Number(li.dataset.n); desenharBusca('', true); } });
    });
  }
  ul.querySelectorAll('.busca-item').forEach(li => li.setAttribute('aria-selected', String(Number(li.dataset.n) === _buscaSel)));
  const inp = document.getElementById('buscaInput');
  if (inp) inp.setAttribute('aria-activedescendant', _buscaLista.length ? `busca-op-${_buscaSel}` : '');
  document.getElementById(`busca-op-${_buscaSel}`)?.scrollIntoView({ block: 'nearest' });
};

const executarBusca = (n) => {
  const item = _buscaLista[n];
  if (!item) return;
  // Devolve o foco ANTES da ação: assim, o painel que abrir lembra do
  // elemento certo (e não da caixa de busca, que some) para devolver depois
  fecharBusca(true);
  fecharConfig(); fecharNiveis(); fecharValidacao();
  item.acao();
};

const fecharBusca = (devolverFoco = true) => {
  const box = document.getElementById('buscaRapida');
  if (!box || !box.classList.contains('open')) return;
  box.classList.remove('open');
  if (box.contains(document.activeElement)) document.activeElement.blur();
  if (devolverFoco) _buscaFoco?.focus?.();
};

document.addEventListener('keydown', (e) => {
  const digitando = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); abrirBusca(); }
  else if (e.key === '/' && !digitando && !e.ctrlKey && !e.metaKey) { e.preventDefault(); abrirBusca(); }
});
