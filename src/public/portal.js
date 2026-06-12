// ── Estado global ──────────────────────────────────────────────
const state = {
  usuario: null,
  periodos: [],
  anoAtual: null,
  periodoAtual: null,
  anoCursoAtual: null,
  periodoCursoAtual: null,
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
const linkProjetoSuap = (p, tipo) => {
  const explicito =
    p.link_suap || p.url_publica || p.pagina || p.link_projeto || p.link || p.url;
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
  const dt = new Date(d + 'T12:00:00');
  return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`;
};

const dadoItem = (label, valor) =>
  (valor == null || valor === '') ? '' : `
  <div class="dado-item">
    <label>${label}</label>
    <p>${esc(valor)}</p>
  </div>`;

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

    const periodos = await api('/api/periodos');
    if (periodos && periodos.length > 0) {
      state.periodos     = [...periodos].sort((a, b) =>
        (a.ano_letivo - b.ano_letivo) || (a.periodo_letivo - b.periodo_letivo)
      );
      const ultimo       = state.periodos[state.periodos.length - 1];
      state.anoAtual     = ultimo.ano_letivo;
      state.periodoAtual = ultimo.periodo_letivo;
      state.anoCursoAtual = ultimo.ano_letivo;
      state.periodoCursoAtual = ultimo.periodo_letivo;
    }

    carregarSecao('dashboard');
  } catch(e) {
    console.error('Erro na inicialização:', e);
  }
})();

// ── Navegação ──────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const sec = item.dataset.section;
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById(`section-${sec}`).classList.add('active');

    const titles = {
      dashboard: 'Dashboard',
      dados:     'Dados Pessoais',
      pesquisa:  'Projetos de Pesquisa',
      extensao:  'Projetos de Extensão',
      calendario:'Calendário Acadêmico',
      conquistas:'Conquistas',
      ranking:'Ranking',
    };
    document.getElementById('topbarTitle').textContent = titles[sec] || '';

    const actions = document.getElementById('topbarActions');
    actions.innerHTML = '';

    carregarSecao(sec);
  });
});

const carregarSecao = (sec) => {
  if (state.loaded[sec]) return;
  switch(sec) {
    case 'dashboard':  carregarDashboard();  break;
    case 'dados':      carregarDados();      break;
    case 'pesquisa':   carregarPesquisa();   break;
    case 'extensao':   carregarExtensao();   break;
    case 'calendario': carregarCalendario(); break;
    case 'conquistas': carregarConquistas(); break;
    case 'ranking':    carregarRanking();    break;
  }
};

// ── Seletor de período ─────────────────────────────────────────
const renderPeriodoSelect = () => {
  const actions = document.getElementById('topbarActions');
  if (!state.periodos.length || document.getElementById('periodoSelectTop')) return;

  const sel     = document.createElement('select');
  sel.className = 'periodo-select';
  sel.id        = 'periodoSelectTop';

  [...state.periodos].reverse().forEach(p => {
    const opt       = document.createElement('option');
    opt.value       = `${p.ano_letivo}/${p.periodo_letivo}`;
    opt.textContent = `${p.ano_letivo}.${p.periodo_letivo}`;
    if (p.ano_letivo === state.anoAtual && p.periodo_letivo === state.periodoAtual) opt.selected = true;
    sel.appendChild(opt);
  });

  sel.addEventListener('change', () => {
    const [ano, periodo] = sel.value.split('/');
    state.anoAtual       = parseInt(ano);
    state.periodoAtual   = parseInt(periodo);
    delete state.loaded['boletim'];
    document.getElementById('boletimContent').innerHTML =
      '<div class="loading"><div class="spinner"></div> Carregando…</div>';
    document.getElementById('boletimStats').innerHTML = '';
    carregarBoletim();
  });

  actions.innerHTML = '';
  actions.appendChild(sel);
};

// ── DADOS PESSOAIS ─────────────────────────────────────────────
const carregarDados = async () => {
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
      <div class="card">
        <div class="perfil-hero">
          <div class="perfil-avatar">${inicial}</div>
          <div class="perfil-info">
            <h2>Olá, <span>${esc(primeiroNome)}</span>!</h2>
            <p>${esc(vinculo.curso || d.tipo_usuario || '')}</p>
            <span class="status-badge">${esc(vinculo.situacao || 'Ativo')}</span>
          </div>
        </div>
        <div class="dados-grid">
          ${dadoItem('Matrícula',          vinculo.matricula || state.usuario?.matricula)}
          ${dadoItem('Nome Completo',      d.nome)}
          ${dadoItem('CPF',                d.cpf)}
          ${dadoItem('E-mail',             d.email)}
          ${dadoItem('E-mail Acadêmico',   d.email_academico || d.email_google_classroom)}
          ${dadoItem('Campus',             vinculo.campus || d.campus)}
          ${dadoItem('Curso',              vinculo.curso)}
          ${dadoItem('Situação',           vinculo.situacao)}
          ${dadoItem('Tipo de Vínculo',    d.tipo_vinculo)}
          ${dadoItem('Período de Refer.',  vinculo.periodo_de_referencia != null ? vinculo.periodo_de_referencia + 'º' : null)}
          ${dadoItem('Data de Nascimento', formatarData(d.data_nascimento))}
          ${dadoItem('Cota SISTEC',        vinculo.cota_sistec)}
        </div>
      </div>

      <div class="card pref-card">
        <div class="card-header">
          <span class="card-title">⚙️ Configurações do perfil</span>
        </div>
        <div class="pref-row">
          <div class="pref-text">
            <h4>Aparência</h4>
            <p>Escolha entre o tema claro e o tema escuro do portal.</p>
          </div>
          <div class="seg-toggle" role="group" aria-label="Tema">
            <button type="button" class="seg-option ${temaAtual === 'light' ? 'active' : ''}"
                    data-tema="light" onclick="aplicarTema('light')">☀️ Claro</button>
            <button type="button" class="seg-option ${temaAtual === 'dark' ? 'active' : ''}"
                    data-tema="dark" onclick="aplicarTema('dark')">🌙 Escuro</button>
          </div>
        </div>
      </div>`;
  } catch(e) {
    document.getElementById('dadosContent').innerHTML =
      '<div class="empty-state"><div class="icon">⚠️</div><p>Erro ao carregar dados pessoais.</p></div>';
  }
};

// ── BOLETIM ────────────────────────────────────────────────────

const buscarBoletimPeriodo = async (ano, periodo) => {
  const res = await fetch(`/api/boletim/${ano}/${periodo}`, { credentials: 'include' });
  if (res.status === 401) { window.location.href = '/login'; return null; }
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
};

const carregarBoletim = async () => {
  state.loaded['boletim'] = true;

  if (document.querySelector('.nav-item.active')?.dataset.section === 'boletim') {
    renderPeriodoSelect();
  }

  if (!state.anoAtual) {
    document.getElementById('boletimContent').innerHTML =
      '<div class="empty-state"><div class="icon">📭</div><p>Nenhum período letivo encontrado.</p></div>';
    return;
  }

  document.getElementById('boletimContent').innerHTML =
    '<div class="loading"><div class="spinner"></div> Carregando boletim…</div>';
  document.getElementById('boletimStats').innerHTML = '';

  try {
    const disciplinas = await buscarBoletimPeriodo(state.anoAtual, state.periodoAtual) || [];

    // _fonte: 'boletim' = histórico fechado | 'disciplinas' = em andamento
    const fonte       = disciplinas.length > 0 ? (disciplinas[0]._fonte ?? 'boletim') : 'boletim';
    const periodoSelecionadoEhAtual =
      Number(state.anoAtual) === Number(state.anoCursoAtual) &&
      Number(state.periodoAtual) === Number(state.periodoCursoAtual);
    const temSituacaoEmAndamento = disciplinas.some(d => {
      const sit = typeof d.situacao === 'object' ? d.situacao?.rotulo : d.situacao;
      const low = normalizarTexto(sit);
      return low.includes('cursando') || low.includes('andamento') || low.includes('execucao');
    });
    const emAndamento = periodoSelecionadoEhAtual && (fonte === 'disciplinas' || temSituacaoEmAndamento);

    // ── Stats ──────────────────────────────────────────────────
    // Stats: conta aprovadas e calcula média
    // Conceito pode ser número (0-100) ou letra (A/B/C/D) dependendo do curso
    const aprovadas = disciplinas.filter(d => {
      const situacao = normalizarTexto(d.situacao);
      if (situacao.includes('aprov')) return true;
      if (situacao.includes('reprov')) return false;

      const mf = String(d.media_final_disciplina ?? '').trim().toUpperCase();
      if (!mf || mf === '—' || mf === 'NULL') return false;
      const num = parseFloat(mf.replace(',', '.'));
      if (!isNaN(num)) return num >= (num > 10 ? 60 : 6);
      return ['A','B','C'].includes(mf);
    }).length;

    const mediasNum = disciplinas
      .map(d => {
        const v = String(d.media_final_disciplina ?? '').trim();
        return parseFloat(v.replace(',', '.'));
      })
      .filter(v => !isNaN(v) && v > 0);

    const mediaGeral = mediasNum.length
      ? (mediasNum.reduce((s,v) => s+v, 0) / mediasNum.length).toFixed(1)
      : '—';

    const badgePeriodo = emAndamento
      ? `<span class="badge-andamento">EM ANDAMENTO</span>`
      : `<span class="badge-concluido">CONCLUÍDO</span>`;

    document.getElementById('boletimStats').innerHTML = `
      <div class="stat-card">
        <div class="stat-label">Período</div>
        <div class="stat-value" style="font-size:1.3rem">
          ${state.anoAtual}.${state.periodoAtual}${badgePeriodo}
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Disciplinas</div>
        <div class="stat-value">${disciplinas.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Média Geral</div>
        <div class="stat-value">${mediaGeral}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Aprovadas</div>
        <div class="stat-value">${aprovadas}</div>
        <div class="stat-sub">de ${disciplinas.length}</div>
      </div>`;

    if (!disciplinas.length) {
      document.getElementById('boletimContent').innerHTML =
        '<div class="empty-state"><div class="icon">📭</div><p>Nenhuma disciplina encontrada.</p></div>';
      return;
    }

    // ── Helpers visuais ────────────────────────────────────────

    // Situação com badge colorido
    const situacaoHtml = (sit) => {
      const textoOriginal = typeof sit === 'object' ? (sit?.rotulo ?? '—') : (sit || '—');
      const lowOriginal = normalizarTexto(textoOriginal);
      const texto = !periodoSelecionadoEhAtual &&
        (lowOriginal.includes('cursando') || lowOriginal.includes('andamento') || lowOriginal.includes('execucao'))
          ? 'Concluído'
          : textoOriginal;
      const low   = normalizarTexto(texto);
      const cls   = low.includes('aprovado')  ? 'sit-aprovado'
                  : low.includes('reprovado') ? 'sit-reprovado'
                  : low.includes('concluido') ? 'sit-concluido'
                  : (low.includes('cursando') || low.includes('andamento') || low.includes('execucao')) ? 'sit-cursando'
                  : 'sit-default';
      return `<span class="situacao-badge ${cls}">${esc(texto)}</span>`;
    };

    // Exibe valor exatamente como vem da API — sem conversão de número para letra
    // Se for null/undefined/'' retorna '—', caso contrário mostra o valor bruto
    const notaCelula = (valor, colorir = false) => {
      if (valor === null || valor === undefined || valor === '') {
        return '<span class="nc neutro">—</span>';
      }
      const s = String(valor).trim();
      if (!s || s === 'null' || s === 'None') return '<span class="nc neutro">—</span>';

      if (!colorir) return `<span class="nc neutro">${esc(s)}</span>`;

      // Cor apenas para o conceito final
      const num = parseFloat(s.replace(',', '.'));
      let cls = 'neutro';
      if (!isNaN(num)) {
        // Escala numérica: >= 60 aprovado (conceito mínimo C no IFPR integrado)
        cls = num >= 60 ? 'aprovado' : 'reprovado';
      } else {
        // Escala de letras A/B/C/D
        const up = s.toUpperCase();
        cls = ['A','B','C'].includes(up) ? 'aprovado'
            : up === 'D' || up === 'E'   ? 'reprovado'
            : 'neutro';
      }
      return `<span class="nc ${cls}">${esc(s)}</span>`;
    };

    const notaFaltasCelula = (etapa, colorir = false) => {
      const nota = etapa?.nota;
      const faltas = etapa?.faltas;
      const semNota = nota === null || nota === undefined || nota === '';
      const semFaltas = faltas === null || faltas === undefined || faltas === '';

      if (semNota && semFaltas) return '<span class="nc neutro">—</span>';

      return `
        <div class="nota-faltas">
          <div class="nota-principal">${notaCelula(nota, colorir)}</div>
          <div class="faltas-label">Faltas: ${semFaltas ? '—' : esc(faltas)}</div>
        </div>`;
    };

    const conceitoDeNota = (valor) => {
      if (valor === null || valor === undefined || valor === '') return '—';
      const s = String(valor).trim();
      if (!s || s === 'null' || s === 'None') return '—';
      if (/^[A-Ea-e]$/.test(s)) return s.toUpperCase();

      const n = parseFloat(s.replace(',', '.'));
      if (isNaN(n)) return s;

      if (usarCodigoConceito && Number.isInteger(n)) {
        return ({ 1: 'A', 2: 'B', 3: 'C', 4: 'D' })[n] ?? '—';
      }

      const nota100 = n <= 10 ? n * 10 : n;
      if (nota100 >= 90) return 'A';
      if (nota100 >= 75) return 'B';
      if (nota100 >= 60) return 'C';
      return 'D';
    };

    const conceitoCelula = (valor, colorir = false) => {
      const conceito = conceitoDeNota(valor);
      if (conceito === '—') return '<span class="nc neutro">—</span>';

      let cls = 'neutro';
      if (colorir) {
        cls = ['A','B','C'].includes(conceito) ? 'aprovado'
            : conceito === 'D' || conceito === 'E' ? 'reprovado'
            : 'neutro';
      }
      return `<span class="nc ${cls}">${esc(conceito)}</span>`;
    };

    const faltasCelula = (valor) => {
      if (valor === null || valor === undefined || valor === '') return '—';
      return esc(valor);
    };

    // Lê uma etapa do boletim aceitando tanto o formato objeto {nota, faltas}
    // quanto valores soltos (algumas respostas do SUAP trazem só o número),
    // evitando que notas/faltas "sumam" quando o formato varia.
    const primeiroValor = (...valores) =>
      valores.find(v => v !== null && v !== undefined && v !== '') ?? null;

    const faltasEtapa = (disciplina, etapa) => primeiroValor(
      disciplina?.[`faltas_etapa_${etapa}`],
      disciplina?.[`faltas_etapa${etapa}`],
      disciplina?.[`faltas_${etapa}`],
      disciplina?.[`faltas${etapa}`],
      disciplina?.[`numero_faltas_etapa_${etapa}`],
      disciplina?.[`numero_faltas_etapa${etapa}`],
      disciplina?.[`numero_faltas_${etapa}`],
      disciplina?.[`qtd_faltas_etapa_${etapa}`],
      disciplina?.[`qtd_faltas_etapa${etapa}`],
      disciplina?.[`qtd_faltas_${etapa}`]
    );

    const lerEtapa = (raw, disciplina = {}, etapa = null) => {
      const faltasFallback = etapa ? faltasEtapa(disciplina, etapa) : null;
      if (raw === null || raw === undefined) return { nota: null, faltas: faltasFallback };
      if (typeof raw === 'object') {
        return {
          nota:   raw.nota ?? raw.valor ?? raw.media ?? null,
          faltas: primeiroValor(raw.faltas, raw.numero_faltas, raw.qtd_faltas, faltasFallback),
        };
      }
      return { nota: raw, faltas: faltasFallback };
    };

    const formatarFrequencia = (valor) => {
      const n = parseFloat(String(valor ?? '').replace(',', '.'));
      if (isNaN(n)) return '—';
      return Number.isInteger(n) ? `${n}%` : `${n.toFixed(2).replace('.', ',')}%`;
    };

    // Frequência com barra
    const freqHtml = (valor) => {
      const freq = parseFloat(valor) || 0;
      const cor  = freq >= 75 ? 'var(--verde)' : freq >= 60 ? 'var(--amarelo)' : 'var(--vermelho)';
      return `
        <div class="freq-bar-wrap">
          <div class="freq-bar">
            <div class="freq-bar-fill" style="width:${Math.min(freq,100).toFixed(1)}%;background:${cor}"></div>
          </div>
          <span style="font-size:0.78rem;color:${cor};font-weight:600;white-space:nowrap">${freq.toFixed(1)}%</span>
        </div>`;
    };

    // ── Tabela ─────────────────────────────────────────────────
    let aviso = '';
    let thead = '';
    let rows  = '';

    const etapas = [1, 2, 3, 4];
    const valoresConceito = disciplinas.flatMap(d => [
      ...etapas.map(n => lerEtapa(d[`nota_etapa_${n}`], d, n).nota),
      d.media_final_disciplina,
      d.media_disciplina,
    ]).filter(v => v !== null && v !== undefined && v !== '');
    const numerosConceito = valoresConceito
      .map(v => parseFloat(String(v).replace(',', '.')))
      .filter(v => !isNaN(v));
    const usarCodigoConceito = numerosConceito.length > 0
      && numerosConceito.every(v => Number.isInteger(v) && v >= 1 && v <= 4);

    const totalFaltasDisciplina = (d) => {
      const total = primeiroValor(
        d.numero_faltas,
        d.qtd_faltas,
        d.faltas,
        d.total_faltas,
        d.numero_total_faltas,
        d.qtd_total_faltas
      );
      if (total !== null) return total;

      const porEtapa = etapas
        .map(n => lerEtapa(d[`nota_etapa_${n}`], d, n).faltas)
        .filter(v => v !== null && v !== undefined && v !== '')
        .map(v => Number(v));

      if (porEtapa.length && porEtapa.every(v => !Number.isNaN(v))) {
        return porEtapa.reduce((s, v) => s + v, 0);
      }

      return null;
    };

    thead = `
      <tr class="boletim-head-top">
        <th class="th-diario" rowspan="2">Diário</th>
        <th class="th-disciplina" rowspan="2">Disciplina</th>
        <th rowspan="2">C. H.</th>
        <th rowspan="2">Total de<br>Aulas</th>
        <th rowspan="2">Total de<br>Faltas</th>
        <th rowspan="2">% Freq.</th>
        <th rowspan="2">Situação</th>
        ${etapas.map(n => `<th class="th-etapa" colspan="2">E${n}</th>`).join('')}
        <th class="th-num" rowspan="2">Conceito</th>
      </tr>
      <tr class="boletim-head-sub">
        ${etapas.map(() => '<th class="th-num">C</th><th class="th-num">F</th>').join('')}
      </tr>`;

    const totalCh = disciplinas.reduce((s,d) => s + (d.carga_horaria ?? 0), 0);
    const totalAulas = disciplinas.reduce((s,d) => s + (d.carga_horaria_cumprida ?? d.carga_horaria ?? 0), 0);
    const totalFaltas = disciplinas.reduce((s,d) => s + (Number(totalFaltasDisciplina(d)) || 0), 0);
    const freqTotal = totalAulas > 0
      ? (((totalAulas - totalFaltas) / totalAulas) * 100)
      : null;

    rows = disciplinas.map(d => {
      const conceitoFinal = d.media_final_disciplina ?? d.media_disciplina;
      const totalAulasDisciplina = d.carga_horaria_cumprida ?? d.carga_horaria ?? '—';
      const faltasDisciplina = totalFaltasDisciplina(d);

      return `<tr>
        <td class="td-diario">${esc(d.codigo_diario ?? '—')}</td>
        <td class="td-disciplina">${esc(d.disciplina)}</td>
        <td class="td-num">${d.carga_horaria > 0 ? d.carga_horaria + ' aulas' : '—'}</td>
        <td class="td-num">${esc(totalAulasDisciplina)}</td>
        <td class="td-num">${esc(faltasDisciplina ?? '—')}</td>
        <td class="td-num">${formatarFrequencia(d.percentual_carga_horaria_frequentada)}</td>
        <td>${situacaoHtml(d.situacao)}</td>
        ${etapas.map(n => {
          const etapa = lerEtapa(d[`nota_etapa_${n}`], d, n);
          return `<td class="td-num">${conceitoCelula(etapa.nota)}</td><td class="td-num">${faltasCelula(etapa.faltas)}</td>`;
        }).join('')}
        <td class="td-num">${conceitoCelula(conceitoFinal, true)}</td>
      </tr>`;
    }).join('');

    rows += `<tr class="tr-total">
      <td colspan="2"><strong>Total:</strong></td>
      <td class="td-num"><strong>${totalCh} aulas</strong></td>
      <td class="td-num"><strong>${totalAulas}</strong></td>
      <td class="td-num"><strong>${totalFaltas}</strong></td>
      <td class="td-num"><strong>${freqTotal == null ? '—' : freqTotal.toFixed(2).replace('.', ',') + '%'}</strong></td>
      <td colspan="${etapas.length * 2 + 2}"></td>
    </tr>`;

    document.getElementById('boletimContent').innerHTML = `
      ${aviso}
      <div style="overflow-x:auto">
        <table class="boletim-table">
          <thead>${thead}</thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;

  } catch(e) {
    console.error('Erro boletim:', e);
    document.getElementById('boletimContent').innerHTML =
      '<div class="empty-state"><div class="icon">⚠️</div><p>Erro ao carregar boletim.</p></div>';
  }
};

// ── PROJETOS ───────────────────────────────────────────────────
const carregarPesquisa = async () => {
  state.loaded['pesquisa'] = true;
  await carregarProjetos('pesquisa', '/api/projetos/pesquisa', 'tipo-pesquisa', 'Pesquisa');
};

const carregarExtensao = async () => {
  state.loaded['extensao'] = true;
  await carregarProjetos('extensao', '/api/projetos/extensao', 'tipo-extensao', 'Extensão');
};

const carregarProjetos = async (id, endpoint, tipoClass, tipoLabel) => {
  const el = document.getElementById(`${id}Content`);
  try {
    // 1) Projetos vindos do SUAP
    const projetos = await api(endpoint);
    if (projetos === null) return; // 401 já redirecionou

    let suapHtml;
    if (!projetos.length) {
      suapHtml = `<div class="empty-state"><div class="icon">📭</div>
        <p>Nenhum projeto de ${tipoLabel.toLowerCase()} encontrado no SUAP.</p></div>`;
    } else {
      suapHtml = projetos.map(p => {
        const titulo = p.titulo || p.nome || 'Sem título';
        const link = linkProjetoSuap(p, id);
        const tituloHtml = link
          ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(titulo)}</a>`
          : esc(titulo);
        return `
        <div class="projeto-card">
          <span class="projeto-tipo ${tipoClass}">${tipoLabel}</span>
          <div class="projeto-titulo">${tituloHtml}</div>
          <div class="projeto-detalhe">
            ${p.dt_inicio             ? `<span>📅 ${esc(p.dt_inicio)} – ${esc(p.dt_final ?? '?')}</span>`  : ''}
            ${p.situacao              ? `<span>🔹 ${esc(p.situacao)}</span>`                                : ''}
            ${p.nome_coordenador      ? `<span>👤 ${esc(p.nome_coordenador)}</span>`                        : ''}
            ${p.campus_nome_formatado ? `<span>🏫 ${esc(p.campus_nome_formatado)}</span>`                   : ''}
          </div>
          ${p.id != null ? `<div class="projeto-acoes">${botaoParticipar(p.meuStatus, `solicitarParticipacaoSuap('${p.id}','${id}')`, `resetarSolicitacaoSuap('${p.id}','${id}')`)}</div>` : ''}
        </div>`;
      }).join('');
    }

    // 2) Projetos criados pela administração (locais), com botão "Fazer parte"
    let internosHtml = '';
    try {
      const internos = await api(`/api/projetos-internos/${id}`);
      if (internos && internos.length) {
        internosHtml = `
          <div class="projetos-admin-sep">Projetos criados pela administração</div>
          ${internos.map(p => renderProjetoInterno(p, id, tipoClass, tipoLabel)).join('')}`;
      }
    } catch (e) { /* se falhar, mostra apenas os do SUAP */ }

    el.innerHTML = suapHtml + internosHtml;
  } catch(e) {
    el.innerHTML =
      '<div class="empty-state"><div class="icon">⚠️</div><p>Erro ao carregar projetos.</p></div>';
  }
};

// Botão de participação conforme o status do aluno
const botaoParticipar = (meuStatus, onclickSolicitar, onclickResetar) => {
  switch (meuStatus) {
    case 'pendente': return `<button class="btn-participar pendente" disabled>⏳ Solicitação enviada</button>`;
    case 'aceito':   return `<button class="btn-participar aceito" disabled>✓ Você faz parte</button>`;
    case 'recusado': return `<button class="btn-participar recusado" onclick="${onclickResetar}" title="Solicitação recusada — clique para solicitar de novo">✕ Recusada · tentar de novo</button>`;
    default:         return `<button class="btn-participar" onclick="${onclickSolicitar}">+ Fazer parte</button>`;
  }
};

// Card de projeto criado pela administração, com botão de participação
const renderProjetoInterno = (p, tipo, tipoClass, tipoLabel) => {
  const botao = botaoParticipar(p.meuStatus, `solicitarParticipacao('${p._id}','${tipo}')`, `resetarSolicitacao('${p._id}','${tipo}')`);
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
        ${p.dt_inicio   ? `<span>📅 ${esc(p.dt_inicio)} – ${esc(p.dt_final ?? '?')}</span>` : ''}
        ${p.situacao    ? `<span>🔹 ${esc(p.situacao)}</span>`                              : ''}
        ${p.coordenador ? `<span>👤 ${esc(p.coordenador)}</span>`                           : ''}
        ${p.campus_nome ? `<span>🏫 ${esc(p.campus_nome)}</span>`                           : ''}
      </div>
      <div class="projeto-acoes">${botao}</div>
    </div>`;
};

// Envia a solicitação de participação e recarrega a seção
const solicitarParticipacao = async (projetoId, tipo) => {
  try {
    const res = await fetch(`/api/projetos-internos/${projetoId}/solicitar`, {
      method: 'POST',
      credentials: 'include',
    });
    if (res.status === 401) { window.location.href = '/login'; return; }
    const data = await res.json();

    if (res.ok && data.sucesso) {
      delete state.loaded[tipo];
      document.getElementById(`${tipo}Content`).innerHTML =
        '<div class="loading"><div class="spinner"></div> Atualizando…</div>';
      if (tipo === 'pesquisa') carregarPesquisa();
      else carregarExtensao();
    } else {
      alert(data.erro || 'Não foi possível enviar a solicitação.');
    }
  } catch (e) {
    alert('Erro de conexão ao enviar a solicitação.');
  }
};

// Envia a solicitação de participação em um projeto do SUAP
const solicitarParticipacaoSuap = async (suapId, tipo) => {
  try {
    const res = await fetch(`/api/projetos-suap/${suapId}/solicitar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ tipo }),
    });
    if (res.status === 401) { window.location.href = '/login'; return; }
    const data = await res.json();

    if (res.ok && data.sucesso) {
      delete state.loaded[tipo];
      document.getElementById(`${tipo}Content`).innerHTML =
        '<div class="loading"><div class="spinner"></div> Atualizando…</div>';
      if (tipo === 'pesquisa') carregarPesquisa();
      else carregarExtensao();
    } else {
      alert(data.erro || 'Não foi possível enviar a solicitação.');
    }
  } catch (e) {
    alert('Erro de conexão ao enviar a solicitação.');
  }
};

// Recarrega a seção de projetos (pesquisa/extensão) após uma ação
const recarregarSecaoProjetos = (tipo) => {
  delete state.loaded[tipo];
  document.getElementById(`${tipo}Content`).innerHTML =
    '<div class="loading"><div class="spinner"></div> Atualizando…</div>';
  if (tipo === 'pesquisa') carregarPesquisa();
  else carregarExtensao();
};

// Cancela uma solicitação RECUSADA (projeto da administração) → volta para "Fazer parte"
const resetarSolicitacao = async (projetoId, tipo) => {
  try {
    const res = await fetch(`/api/projetos-internos/${projetoId}/solicitacao`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (res.status === 401) { window.location.href = '/login'; return; }
    recarregarSecaoProjetos(tipo);
  } catch (e) {
    alert('Erro de conexão.');
  }
};

// Cancela uma solicitação RECUSADA (projeto do SUAP) → volta para "Fazer parte"
const resetarSolicitacaoSuap = async (suapId, tipo) => {
  try {
    const res = await fetch(`/api/projetos-suap/${suapId}/solicitacao`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (res.status === 401) { window.location.href = '/login'; return; }
    recarregarSecaoProjetos(tipo);
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
      el.innerHTML = `<div class="empty-state"><div class="icon">📅</div><p>Nenhum evento encontrado para ${anoAtual}.</p></div>`;
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
          <h4>${ev.link_suap
            ? `<a href="${esc(ev.link_suap)}" target="_blank" rel="noopener">${esc(ev.nome || ev.titulo || 'Evento')}</a>`
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
      '<div class="empty-state"><div class="icon">⚠️</div><p>Erro ao carregar calendário.</p></div>';
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
          <span class="pts">⭐ ${Number(c.pontos) || 0} pts</span>
          ${(!desbloqueada && c.origem === 'automatica')
            ? `<span class="auto">⚙ Automática</span>` : ''}
        </div>
      </div>`;

    const grupoDesbloqueadas = desbloqueadas.length
      ? `<div class="conq-grid">${desbloqueadas.map(c => card(c, true)).join('')}</div>`
      : `<div class="conq-vazio">Você ainda não desbloqueou nenhuma conquista. Veja abaixo o que dá para conquistar! 👇</div>`;

    const grupoDisponiveis = disponiveis.length
      ? `<div class="conq-grid">${disponiveis.map(c => card(c, false)).join('')}</div>`
      : `<div class="conq-vazio">Você já desbloqueou todas as conquistas disponíveis. Parabéns! 🎉</div>`;

    el.innerHTML = `
      <div class="conq-resumo">
        <span class="estrela">⭐</span>
        <div>
          <div class="total">${pontos}</div>
          <div class="label">pontos acumulados · ${desbloqueadas.length} conquista(s)</div>
        </div>
      </div>

      <div class="conq-grupo-titulo">✅ Desbloqueadas</div>
      ${grupoDesbloqueadas}

      <div class="conq-grupo-titulo">🔒 Disponíveis</div>
      ${grupoDisponiveis}
    `;
  } catch (e) {
    el.innerHTML =
      '<div class="empty-state"><div class="icon">⚠️</div><p>Erro ao carregar conquistas.</p></div>';
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
              <div class="av">👤</div>
              <div class="nm">${esc(r.nome)}${r.isMe ? ' (Você)' : ''}</div>
              <div class="xp">${r.pontos} xp</div>
            </div>`;
        }).join('')
      : `<div style="color:var(--cinza);font-size:0.88rem;padding:0.5rem 0">Ninguém pontuou ainda. 🚀</div>`;

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
      timelineHtml = `<div style="color:var(--cinza);font-size:0.88rem;padding:0.5rem 0">Nenhum evento no calendário ainda. 🌱</div>`;
    }

    // ── Montagem ──
    el.innerHTML = `
      <div class="dash-hero">
        <div class="dash-avatar">${esc(inicial)}</div>
        <div class="ola">
          <h2>Olá, ${esc(primeiroNome)}!</h2>
          ${dash.curso ? `<div class="curso">${esc(dash.curso)}</div>` : ''}
          <div class="dash-nivel-linha">
            <span class="badge-nivel">♟ Nível ${n.nivel} · ${esc(n.nome || '')}</span>
            <span>${n.faltamParaProximo ? `${n.faltamParaProximo} pts p/ ${esc(n.proximoNome)}` : 'nível máximo 🏆'}</span>
          </div>
          <div class="dash-barra"><span style="width:${Math.min(100, Math.max(0, n.progresso || 0))}%"></span></div>
        </div>
        <div class="indicadores">
          <div class="indicador"><div class="ic">⭐</div><div class="v">${dash.pontos}</div><div class="l">Pontos</div></div>
          <div class="indicador"><div class="ic">🏆</div><div class="v">${dash.posicaoGeral}º</div><div class="l">Lugar<br>Ranking Geral</div></div>
        </div>
      </div>

      <div class="dash-grid">
        <div>
          <div class="dash-mini-row">
            <div class="dash-mini" onclick="irParaSecao('ranking')">
              <span class="seta">→</span>
              <div class="ic">🏆</div>
              <div class="v">${dash.posicaoGeral}º</div>
              <div class="l">Lugar<br>Ranking Geral</div>
            </div>
            <div class="dash-mini" onclick="irParaSecao('conquistas')">
              <span class="seta">→</span>
              <div class="ic">🎖️</div>
              <div class="v">${dash.totalConquistas}</div>
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
    el.innerHTML = '<div class="empty-state"><div class="icon">⚠️</div><p>Erro ao carregar o painel.</p></div>';
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
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Carregando ranking…</div>';
  try {
    const dados = await api(`/api/ranking?escopo=${_rankEscopo}`);
    if (!dados) return;

    const toggle = `
      <div class="rank-toggle">
        <button class="${_rankEscopo === 'geral' ? 'ativo' : ''}" onclick="trocarEscopoRanking('geral')">🌎 Geral</button>
        <button class="${_rankEscopo === 'curso' ? 'ativo' : ''}" onclick="trocarEscopoRanking('curso')">🎓 Meu curso</button>
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
      pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : pos;

    const eu = dados.eu || {};
    const cabecalhoEu = `
      <div class="rank-eu">
        <div class="pos">${eu.posicao ? `${eu.posicao}º` : '—'}</div>
        <div class="meta">
          <div class="n">${esc(eu.nome || 'Você')}</div>
          <div class="s">Sua posição ${dados.escopo === 'curso' ? 'no curso' : 'geral'} · entre ${dados.total} aluno(s)</div>
        </div>
        <div class="pts">⭐ ${eu.pontos || 0}</div>
      </div>`;

    let lista;
    if (!dados.ranking.length) {
      lista = `<div class="rank-vazio">Ninguém pontuou ainda. Seja o primeiro! 🚀</div>`;
    } else {
      lista = `<div class="rank-lista">` + dados.ranking.map(r => `
        <div class="rank-row ${r.isMe ? 'eu' : ''}">
          <div class="col-pos ${medalha(r.posicao)}">${simbolo(r.posicao)}</div>
          <div class="col-nome">${esc(r.nome)}${r.isMe ? '<span class="vc">VOCÊ</span>' : ''}</div>
          <div class="col-pts">⭐ ${r.pontos}</div>
        </div>`).join('') + `</div>`;
    }

    el.innerHTML = toggle + cabecalhoEu + lista;
  } catch (e) {
    el.innerHTML = '<div class="empty-state"><div class="icon">⚠️</div><p>Erro ao carregar o ranking.</p></div>';
  }
};

// ── Logout ─────────────────────────────────────────────────────
const logout = async () => {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  window.location.href = '/login';
};