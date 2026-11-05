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

// ── Tema (claro / escuro) ──────────────────────────────────────
const THEME_KEY = 'ifplenus-tema';

const getTema = () => document.documentElement.getAttribute('data-theme') || 'dark';

const aplicarTema = (tema, persistir = true) => {
  const t = tema === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);

  // Atualiza o controle segmentado, se estiver na tela
  document.querySelectorAll('.seg-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tema === t);
  });

  if (persistir) {
    try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* ignore */ }
    // Sincroniza com o servidor (melhor esforço; não bloqueia a UI)
    fetch('/api/preferencias', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ temaEscuro: t === 'dark' }),
    }).catch(() => {});
  }
};

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

const toFloat = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
};

// Formata nota: aceita letra (A,B,C,D) ou número
const fmtNota = (v) => {
  if (v === null || v === undefined || v === '') return '—';
  const s = String(v).trim();
  if (s === '0' || s === '0.0') return '0';
  if (!s || s === 'null') return '—';
  // Se for letra (conceito), retorna direto
  if (/^[A-Ea-e]$/.test(s)) return s.toUpperCase();
  // Se for número
  const n = parseFloat(s.replace(',', '.'));
  if (isNaN(n)) return s;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
};

const formatarData = (d) => {
  if (!d) return '—';
  // Aceita "AAAA-MM-DD" e também datas ISO com horário (antes virava NaN/NaN/NaN)
  const ymd = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  const dt = ymd ? new Date(+ymd[1], +ymd[2] - 1, +ymd[3], 12) : new Date(d);
  if (isNaN(dt)) return '—';
  return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`;
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

    // Tema: localStorage tem prioridade; se não houver, usa a preferência salva no servidor
    try {
      const salvoLocal = localStorage.getItem(THEME_KEY);
      if (!salvoLocal && me.preferencias && typeof me.preferencias.temaEscuro === 'boolean') {
        aplicarTema(me.preferencias.temaEscuro ? 'dark' : 'light', false);
      }
    } catch (e) { /* ignore */ }

    document.getElementById('userAvatar').textContent = (me.nome || 'A')[0].toUpperCase();
    document.getElementById('userName').textContent   = me.nome;
    document.getElementById('userMat').textContent    = me.matricula;
    const topAv = document.getElementById('topbarAvatar');
    if (topAv) topAv.textContent = (me.nome || 'A')[0].toUpperCase();

    carregarSecao('dashboard');
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

// ── Navegação ──────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const sec = item.dataset.section;
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById(`section-${sec}`).classList.add('active');
    fecharSidebar(); // fecha o menu mobile ao trocar de aba

    const titles = {
      dashboard: 'Dashboard',
      projetos:  'Projetos',
      calendario:'Calendário Acadêmico',
      conquistas:'Conquistas',
      trajetoria:'Minha Trajetória',
      ranking:'Ranking',
    };
    document.getElementById('topbarTitle').textContent = titles[sec] || '';

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
    case 'calendario': carregarCalendario(); break;
    case 'conquistas': carregarConquistas(); break;
    case 'trajetoria': carregarTrajetoria(); break;
    case 'ranking':    carregarRanking();    break;
  }
};

// ── DADOS PESSOAIS ─────────────────────────────────────────────
const carregarDados = async () => {
  if (state.loaded['dados']) return;
  state.loaded['dados'] = true;
  try {
    const d = await api('/api/dados-pessoais');
    if (!d) return;

    const vinculo = d.vinculo || {};
    const inicial = (d.nome_usual || d.nome || 'A')[0].toUpperCase();
    const primeiroNome = String(d.nome_usual || d.nome || 'Aluno').trim().split(/\s+/)[0];
    const temaAtual = getTema();

    // Mostra o campus do aluno logado ao lado da logo (barra lateral)
    const campusRaw = String(vinculo.campus || d.campus || '').trim();
    if (campusRaw) {
      const elCampus = document.getElementById('sidebarCampus');
      if (elCampus) {
        elCampus.textContent = /campus/i.test(campusRaw) ? campusRaw : `Campus ${campusRaw}`;
      }
    }

    document.getElementById('dadosContent').innerHTML = `
      <div class="config-perfil">
        <div class="perfil-avatar">${esc(inicial)}</div>
        <div>
          <h3>${esc(d.nome_usual || d.nome || primeiroNome)}</h3>
          <p>${esc(vinculo.curso || d.tipo_usuario || '')}</p>
          <span class="status-badge">${esc(vinculo.situacao || 'Ativo')}</span>
        </div>
      </div>

      <div class="config-secao">
        <div class="config-secao-titulo"><i data-lucide="palette"></i> Aparência</div>
        <div class="config-bloco">
          <div class="pref-row">
            <div class="pref-text">
              <h4>Tema</h4>
              <p>Escolha entre o tema claro e o escuro.</p>
            </div>
            <div class="seg-toggle" role="group" aria-label="Tema">
              <button type="button" class="seg-option ${temaAtual === 'light' ? 'active' : ''}"
                      data-tema="light" onclick="aplicarTema('light')"><i data-lucide="sun"></i> Claro</button>
              <button type="button" class="seg-option ${temaAtual === 'dark' ? 'active' : ''}"
                      data-tema="dark" onclick="aplicarTema('dark')"><i data-lucide="moon"></i> Escuro</button>
            </div>
          </div>
        </div>
      </div>

      <div class="config-secao">
        <div class="config-secao-titulo"><i data-lucide="graduation-cap"></i> Dados acadêmicos</div>
        <div class="config-bloco">
          <div class="dados-grid">
            ${dadoItem('Matrícula',          vinculo.matricula || state.usuario?.matricula)}
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
      </div>

      <div class="config-secao">
        <div class="config-secao-titulo"><i data-lucide="log-out"></i> Conta</div>
        <button type="button" class="btn-sair-config" onclick="logout()"><i data-lucide="log-out"></i> Sair do IFPlenus</button>
      </div>`;
  } catch(e) {
    document.getElementById('dadosContent').innerHTML =
      '<div class="empty-state"><div class="icon"><i data-lucide="alert-triangle"></i></div><p>Erro ao carregar seus dados.</p></div>';
    state.loaded['dados'] = false; // tenta de novo na próxima abertura
  }
};

// ── CONFIGURAÇÕES (painel lateral) ─────────────────────────────
let _focoAntesConfig = null;

const abrirConfig = () => {
  const drawer = document.getElementById('configDrawer');
  if (!drawer) return;
  _focoAntesConfig = document.activeElement;
  fecharSidebar();
  if (!state.loaded['dados']) carregarDados();
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  document.getElementById('configOverlay')?.classList.add('open');
  document.body.classList.add('config-aberta');
  setTimeout(() => drawer.querySelector('.config-fechar')?.focus(), 50);
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
  if (e.key === 'Escape') fecharConfig();
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
      : `<div class="proj-vazio">Nenhum projeto adicionado pela administração ainda.</div>`;

    cont.innerHTML = `
      <div class="proj-fonte">
        <div class="proj-fonte-titulo"><i data-lucide="server"></i> Projetos do Sistema</div>
        <div class="proj-lista">${suapCards}</div>
      </div>
      <div class="proj-fonte">
        <div class="proj-fonte-titulo"><i data-lucide="user-cog"></i> Projetos Adicionados pelo Admin</div>
        <div class="proj-lista">${adminCards}</div>
      </div>`;
  } catch (e) {
    cont.innerHTML =
      '<div class="empty-state"><div class="icon"><i data-lucide="alert-triangle"></i></div><p>Erro ao carregar projetos.</p></div>';
  }
};

// Card de um projeto vindo do SUAP (sistema).
const renderProjetoSuap = (p, area, meta) => {
  const titulo = p.titulo || p.nome || 'Sem título';
  const link = linkProjetoSuap(p, area);
  const tituloHtml = link
    ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(titulo)}</a>`
    : esc(titulo);
  return `
    <div class="projeto-card">
      <span class="projeto-tipo ${meta.class}">${meta.label}</span>
      <div class="projeto-titulo">${tituloHtml}</div>
      <div class="projeto-detalhe">
        ${p.dt_inicio             ? `<span><i data-lucide="calendar"></i> ${esc(p.dt_inicio)} – ${esc(p.dt_final ?? '?')}</span>` : ''}
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
    <div class="projeto-card projeto-admin">
      <span class="projeto-tipo ${tipoClass}">${tipoLabel} · Administração</span>
      <div class="projeto-titulo">${tituloHtml}</div>
      ${p.resumo ? `<p class="projeto-resumo">${esc(p.resumo)}</p>` : ''}
      <div class="projeto-detalhe">
        ${p.dt_inicio   ? `<span><i data-lucide="calendar"></i> ${esc(p.dt_inicio)} – ${esc(p.dt_final ?? '?')}</span>` : ''}
        ${p.situacao    ? `<span><i data-lucide="circle-dot"></i> ${esc(p.situacao)}</span>`                              : ''}
        ${p.coordenador ? `<span><i data-lucide="user"></i> ${esc(p.coordenador)}</span>`                           : ''}
        ${p.campus_nome ? `<span><i data-lucide="school"></i> ${esc(p.campus_nome)}</span>`                           : ''}
      </div>
      <div class="projeto-acoes">${botao}</div>
    </div>`;
};

// Envia a solicitação de participação (projeto local) e recarrega a aba.
const solicitarParticipacao = async (projetoId, area) => {
  try {
    const res = await fetch(`/api/projetos-internos/${projetoId}/solicitar`, {
      method: 'POST',
      credentials: 'include',
    });
    if (res.status === 401) { window.location.href = '/login'; return; }
    const data = await res.json();
    if (res.ok && data.sucesso) recarregarProjetos(area);
    else alert(data.erro || 'Não foi possível enviar a solicitação.');
  } catch (e) {
    alert('Erro de conexão ao enviar a solicitação.');
  }
};

// Envia a solicitação de participação (projeto do SUAP) e recarrega a aba.
const solicitarParticipacaoSuap = async (suapId, area) => {
  try {
    const res = await fetch(`/api/projetos-suap/${suapId}/solicitar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ tipo: area }),
    });
    if (res.status === 401) { window.location.href = '/login'; return; }
    const data = await res.json();
    if (res.ok && data.sucesso) recarregarProjetos(area);
    else alert(data.erro || 'Não foi possível enviar a solicitação.');
  } catch (e) {
    alert('Erro de conexão ao enviar a solicitação.');
  }
};

// Cancela a solicitação (pendente → desistência; recusada → tentar de novo)
// de um projeto local, e recarrega a aba.
const resetarSolicitacao = async (projetoId, area) => {
  try {
    const res = await fetch(`/api/projetos-internos/${projetoId}/solicitacao`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (res.status === 401) { window.location.href = '/login'; return; }
    recarregarProjetos(area);
  } catch (e) {
    alert('Erro de conexão.');
  }
};

// Cancela a solicitação (pendente/recusada) de um projeto do SUAP.
const resetarSolicitacaoSuap = async (suapId, area) => {
  try {
    const res = await fetch(`/api/projetos-suap/${suapId}/solicitacao`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (res.status === 401) { window.location.href = '/login'; return; }
    recarregarProjetos(area);
  } catch (e) {
    alert('Erro de conexão.');
  }
};
const carregarCalendario = async () => {
  state.loaded['calendario'] = true;
  try {
    const anoAtual = new Date().getFullYear();
    const eventos  = await api(`/api/calendario?ano=${anoAtual}`);
    if (!eventos) return;

    const el = document.getElementById('calendarioContent');

    // Mantém só os eventos do ano presente (início OU fim no ano atual,
    // para incluir eventos que atravessam a virada de ano).
    const doAno = eventos.filter(ev => {
      const ini = parseInt(String(ev.data_inicio || ev.data || '').slice(0, 4), 10);
      const fim = parseInt(String(ev.data_fim || '').slice(0, 4), 10);
      return ini === anoAtual || fim === anoAtual;
    });

    if (!doAno.length) {
      el.innerHTML = `<div class="empty-state"><div class="icon"><i data-lucide="calendar"></i></div><p>Nenhum evento encontrado para ${anoAtual}.</p></div>`;
      return;
    }

    // Ordem decrescente: eventos mais próximos/recentes em cima, mais antigos embaixo.
    const sorted = [...doAno].sort((a,b) =>
      new Date(b.data_inicio || b.data || '') - new Date(a.data_inicio || a.data || '')
    );

    el.innerHTML = `<div class="eventos-lista">${sorted.map(ev => {
      const dataStr = ev.data_inicio || ev.data || '';
      const dt = dataStr ? new Date(dataStr + 'T12:00:00') : null;
      return `<div class="evento-item">
        <div class="evento-data">
          <div class="mes">${dt ? MESES[dt.getMonth()] : ''}</div>
          <div class="dia">${dt ? dt.getDate() : '—'}</div>
        </div>
        <div class="evento-info">
          <h4>${urlSegura(ev.link_suap)
            ? `<a href="${esc(urlSegura(ev.link_suap))}" target="_blank" rel="noopener">${esc(ev.nome || ev.titulo || 'Evento')}</a>`
            : esc(ev.nome || ev.titulo || 'Evento')}</h4>
          <p>${esc(
            [ev.periodo_formatado, ev.local || ev.localizacao, ev.campus]
              .filter(Boolean).join(' · ') || ev.tipo || ''
          )}</p>
        </div>
      </div>`;
    }).join('')}</div>`;
  } catch(e) {
    document.getElementById('calendarioContent').innerHTML =
      '<div class="empty-state"><div class="icon"><i data-lucide="alert-triangle"></i></div><p>Erro ao carregar calendário.</p></div>';
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
          <span class="pts"><i data-lucide="star"></i> ${Number(c.pontos) || 0} pts</span>
          ${(!desbloqueada && c.origem === 'automatica')
            ? `<span class="auto"><i data-lucide="settings"></i> Automática</span>` : ''}
        </div>
      </div>`;

    const grupoDesbloqueadas = desbloqueadas.length
      ? `<div class="conq-grid">${desbloqueadas.map(c => card(c, true)).join('')}</div>`
      : `<div class="conq-vazio">Você ainda não desbloqueou nenhuma conquista. Veja abaixo o que dá para conquistar! <i data-lucide="arrow-down"></i></div>`;

    const grupoDisponiveis = disponiveis.length
      ? `<div class="conq-grid">${disponiveis.map(c => card(c, false)).join('')}</div>`
      : `<div class="conq-vazio">Você já desbloqueou todas as conquistas disponíveis. Parabéns! <i data-lucide="party-popper"></i></div>`;

    el.innerHTML = `
      <div class="conq-resumo">
        <span class="estrela"><i data-lucide="star"></i></span>
        <div>
          <div class="total">${pontos}</div>
          <div class="label">pontos acumulados · ${desbloqueadas.length} conquista(s)</div>
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
      api('/api/calendario').catch(() => []),
    ]);
    if (!dash) return;

    const n = dash.nivel || {};
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
              <div class="xp">${r.pontos} xp</div>
            </div>`;
        }).join('')
      : `<div style="color:var(--cinza);font-size:0.88rem;padding:0.5rem 0">Ninguém pontuou ainda. <i data-lucide="rocket"></i></div>`;

    // ── Timeline de eventos (passados + futuros) ──
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const comData = (Array.isArray(eventos) ? eventos : [])
      .map(ev => ({ ...ev, _d: new Date(ev.data_inicio || ev.data) }))
      .filter(ev => !isNaN(ev._d));

    const futuros  = comData.filter(ev => ev._d >= hoje).sort((a,b) => a._d - b._d); // mais perto primeiro
    const passados = comData.filter(ev => ev._d <  hoje).sort((a,b) => b._d - a._d); // mais recente primeiro

    const idProximo = futuros.length ? (futuros[0].id ?? futuros[0]._id ?? null) : null;

    // Ordem de exibição (topo→baixo): futuros (mais perto no topo) → [aviso se não houver futuros] → passados
    const linhaEvento = (ev, classe) => {
      const { dia, mes } = fmtData(ev.data_inicio || ev.data);
      const local = ev.local || ev.campus || '';
      return `
        <div class="dash-tl-item ${classe}">
          <div class="dash-tl-data"><div class="dia">${dia}</div><div class="mes">${mes}</div></div>
          <div class="dash-tl-corpo">
            <div class="n">${esc(ev.nome || 'Evento')}</div>
            ${local ? `<div class="s">${esc(local)}</div>` : ''}
          </div>
        </div>`;
    };

    let timelineHtml = '';
    // Futuros no topo (o mais próximo recebe destaque "proximo")
    futuros.slice().reverse().forEach(ev => {       // reverse: mais distante em cima, mais próximo embaixo do grupo
      const ehProximo = (ev.id ?? ev._id ?? null) === idProximo;
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
    passados.slice(0, 5).forEach(ev => { timelineHtml += linhaEvento(ev, 'passado'); });

    if (!comData.length) {
      timelineHtml = `<div style="color:var(--cinza);font-size:0.88rem;padding:0.5rem 0">Nenhum evento no calendário ainda. <i data-lucide="sprout"></i></div>`;
    }

    // ── Montagem ──
    el.innerHTML = `
      <div class="dash-hero">
        <div class="dash-avatar">${esc(inicial)}</div>
        <div class="ola">
          <h2>Olá, ${esc(primeiroNome)}!</h2>
          ${dash.curso ? `<div class="curso">${esc(dash.curso)}</div>` : ''}
          <div class="dash-nivel-linha">
            <span class="badge-nivel"><i data-lucide="award"></i> Nível ${n.nivel} · ${esc(n.nome || '')}</span>
            <span>${n.faltamParaProximo ? `${n.faltamParaProximo} pts p/ ${esc(n.proximoNome)}` : 'nível máximo <i data-lucide="trophy"></i>'}</span>
          </div>
          <div class="dash-barra"><span style="width:${Math.min(100, Math.max(0, n.progresso || 0))}%"></span></div>
        </div>
        <div class="indicadores">
          <div class="indicador"><div class="ic"><i data-lucide="star"></i></div><div class="v">${dash.pontos}</div><div class="l">Pontos</div></div>
          <div class="indicador"><div class="ic"><i data-lucide="trophy"></i></div><div class="v">${dash.posicaoGeral != null ? dash.posicaoGeral + "º" : "—"}</div><div class="l">Lugar<br>Ranking Geral</div></div>
        </div>
      </div>

      <div class="dash-grid">
        <div>
          <div class="dash-mini-row">
            <div class="dash-mini" onclick="irParaSecao('ranking')">
              <span class="seta"><i data-lucide="arrow-right"></i></span>
              <div class="ic"><i data-lucide="trophy"></i></div>
              <div class="v">${dash.posicaoGeral != null ? dash.posicaoGeral + "º" : "—"}</div>
              <div class="l">Lugar<br>Ranking Geral</div>
            </div>
            <div class="dash-mini" onclick="irParaSecao('conquistas')">
              <span class="seta"><i data-lucide="arrow-right"></i></span>
              <div class="ic"><i data-lucide="medal"></i></div>
              <div class="v">${dash.totalConquistas ?? 0}</div>
              <div class="l">Conquistas<br>Desbloqueadas</div>
            </div>
          </div>

          <div class="dash-painel">
            <div class="titulo">Ranking Geral</div>
            ${podioHtml}
            <span class="rodape-link" onclick="irParaSecao('ranking')">Ver Ranking Completo</span>
          </div>
        </div>

        <div class="dash-painel">
          <div class="titulo">Próximos Eventos</div>
          <div class="dash-timeline">${timelineHtml}</div>
          <span class="rodape-link" onclick="irParaSecao('calendario')">Ver Calendário</span>
        </div>
      </div>
    `;
  } catch (e) {
    el.innerHTML = '<div class="empty-state"><div class="icon"><i data-lucide="alert-triangle"></i></div><p>Erro ao carregar o painel.</p></div>';
  }
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
  try {
    const dados = await api(`/api/ranking?escopo=${_rankEscopo}`);
    if (!dados) return;

    const toggle = `
      <div class="rank-toggle">
        <button class="${_rankEscopo === 'geral' ? 'ativo' : ''}" onclick="trocarEscopoRanking('geral')"><i data-lucide="globe"></i> Geral</button>
        <button class="${_rankEscopo === 'curso' ? 'ativo' : ''}" onclick="trocarEscopoRanking('curso')"><i data-lucide="graduation-cap"></i> Meu curso</button>
      </div>`;

    // Aviso explicando o critério de classificação (e o desempate).
    const rankInfo = `
      <div class="rank-info">
        <span class="ic"><i data-lucide="info"></i></span>
        <p>O ranking ordena os alunos pelo total de <strong>estrelas (pontos)</strong>,
           da maior para a menor. Em caso de <strong>empate de pontos</strong>, fica à
           frente quem <strong>alcançou aquele total primeiro</strong> — ou seja, quem
           teve a conquista mais recente concedida mais cedo. Permanecendo o empate
           (alunos ainda sem pontos), a ordem é alfabética.</p>
      </div>`;

    // Caso o aluno não tenha curso registrado ainda
    if (dados.semCurso) {
      el.innerHTML = toggle + `
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
    const cabecalhoEu = `
      <div class="rank-eu">
        <div class="pos">${eu.posicao ? `${eu.posicao}º` : '—'}</div>
        <div class="meta">
          <div class="n">${esc(eu.nome || 'Você')}${nivelEu}</div>
          <div class="s">Sua posição ${dados.escopo === 'curso' ? 'no curso' : 'geral'} · entre ${dados.total} aluno(s)</div>
        </div>
        <div class="pts"><i data-lucide="star"></i> ${eu.pontos || 0}</div>
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

    el.innerHTML = toggle + rankInfo + cabecalhoEu + lista;
  } catch (e) {
    el.innerHTML = '<div class="empty-state"><div class="icon"><i data-lucide="alert-triangle"></i></div><p>Erro ao carregar o ranking.</p></div>';
  }
};

// ── Minha Trajetória (histórico do aluno) ──────────────────────
const carregarTrajetoria = async () => {
  state.loaded['trajetoria'] = true;
  const el = document.getElementById('trajetoriaContent');
  try {
    const dados = await api('/api/trajetoria');
    if (!dados) return;

    const itens = Array.isArray(dados.trajetoria) ? dados.trajetoria : [];

    // Estado vazio
    if (!itens.length) {
      el.innerHTML = `
        <div class="traj-resumo">
          <span class="ic"><i data-lucide="compass"></i></span>
          <div>
            <div class="total">0</div>
            <div class="label">Sua trajetória ainda está começando</div>
          </div>
        </div>
        <div class="traj-painel">
          <div class="traj-vazio">
            Assim que você desbloquear conquistas ou tiver uma participação em
            projeto aceita, os marcos vão aparecer aqui — do mais recente para
            o mais antigo. <i data-lucide="rocket"></i>
          </div>
        </div>`;
      return;
    }

    const fmt = (iso) => {
      const d = new Date(iso);
      if (isNaN(d)) return { dia: '–', mes: '', hora: '' };
      return {
        dia: String(d.getDate()).padStart(2, '0'),
        mes: MESES[d.getMonth()] || '',
        hora: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      };
    };

    // Monta a timeline (mais recente no topo — já vem ordenado do backend)
    const linhas = itens.map((it) => {
      const { dia, mes, hora } = fmt(it.data);
      const ehConquista = it.tipo === 'conquista';
      const classeTipo = ehConquista ? 'traj-conquista' : 'traj-projeto';

      // Selo à direita do título
      let selo = '';
      if (ehConquista) {
        selo = it.pontos ? `<span class="traj-pts">+${it.pontos} xp</span>` : '';
      } else if (it.projetoTipo === 'pesquisa' || it.projetoTipo === 'extensao') {
        const rotulo = it.projetoTipo === 'pesquisa' ? 'Pesquisa' : 'Extensão';
        selo = `<span class="traj-tag ${it.projetoTipo}">${rotulo}</span>`;
      }

      const icone = it.icone || (ehConquista ? '🏆' : '📌');

      return `
        <div class="dash-tl-item traj ${classeTipo}">
          <div class="dash-tl-data">
            <div class="dia">${dia}</div>
            <div class="mes">${mes}</div>
            ${hora ? `<div class="traj-hora">${hora}</div>` : ''}
          </div>
          <div class="dash-tl-corpo">
            <div class="n"><span class="traj-icone">${esc(icone)}</span>${esc(it.titulo)} ${selo}</div>
            <div class="s">${esc(it.descricao || '')}</div>
          </div>
        </div>`;
    }).join('');

    el.innerHTML = `
      <div class="traj-resumo">
        <span class="ic"><i data-lucide="compass"></i></span>
        <div>
          <div class="total">${itens.length}</div>
          <div class="label">marco(s) na sua trajetória até agora</div>
        </div>
      </div>
      <div class="traj-painel">
        <div class="dash-timeline">${linhas}</div>
      </div>`;
  } catch (e) {
    el.innerHTML = '<div class="empty-state"><div class="icon"><i data-lucide="alert-triangle"></i></div><p>Erro ao carregar a sua trajetória.</p></div>';
  }
};

// ── Logout ─────────────────────────────────────────────────────
const logout = async () => {
  try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); }
  catch (e) { /* sai mesmo sem resposta */ }
  window.location.href = '/login';
};