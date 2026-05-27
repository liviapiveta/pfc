// ── Estado global ──────────────────────────────────────────────
const state = {
  usuario: null,
  periodos: [],
  anoAtual: null,
  periodoAtual: null,
  loaded: {},
};

const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

// ── Utilidades ─────────────────────────────────────────────────
const api = async (url) => {
  const res = await fetch(url, { credentials: 'include' });
  if (res.status === 401) { window.location.href = '/login'; return null; }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

const esc = (s) => String(s ?? '—').replace(/&/g,'&amp;').replace(/</g,'&lt;');

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
    }

    carregarSecao('dados');
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
      dados:     'Dados Pessoais',
      boletim:   'Boletim Acadêmico',
      pesquisa:  'Projetos de Pesquisa',
      extensao:  'Projetos de Extensão',
      calendario:'Calendário Acadêmico',
    };
    document.getElementById('topbarTitle').textContent = titles[sec] || '';

    const actions = document.getElementById('topbarActions');
    if (sec === 'boletim') renderPeriodoSelect();
    else actions.innerHTML = '';

    carregarSecao(sec);
  });
});

const carregarSecao = (sec) => {
  if (state.loaded[sec]) return;
  switch(sec) {
    case 'dados':      carregarDados();      break;
    case 'boletim':    carregarBoletim();    break;
    case 'pesquisa':   carregarPesquisa();   break;
    case 'extensao':   carregarExtensao();   break;
    case 'calendario': carregarCalendario(); break;
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

    document.getElementById('dadosContent').innerHTML = `
      <div class="card">
        <div class="perfil-hero">
          <div class="perfil-avatar">${inicial}</div>
          <div class="perfil-info">
            <h2>${esc(d.nome_usual || d.nome)}</h2>
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
    const emAndamento = fonte === 'disciplinas';

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

    const badgeAndamento = emAndamento
      ? `<span class="badge-andamento">EM ANDAMENTO</span>`
      : '';

    document.getElementById('boletimStats').innerHTML = `
      <div class="stat-card">
        <div class="stat-label">Período</div>
        <div class="stat-value" style="font-size:1.3rem">
          ${state.anoAtual}.${state.periodoAtual}${badgeAndamento}
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
      const texto = typeof sit === 'object' ? (sit?.rotulo ?? '—') : (sit || '—');
      const low   = normalizarTexto(texto);
      const cls   = low.includes('aprovado')  ? 'sit-aprovado'
                  : low.includes('reprovado') ? 'sit-reprovado'
                  : (low.includes('cursando') || low.includes('andamento')) ? 'sit-cursando'
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
      ...etapas.map(n => d[`nota_etapa_${n}`]?.nota),
      d.media_final_disciplina,
      d.media_disciplina,
    ]).filter(v => v !== null && v !== undefined && v !== '');
    const numerosConceito = valoresConceito
      .map(v => parseFloat(String(v).replace(',', '.')))
      .filter(v => !isNaN(v));
    const usarCodigoConceito = numerosConceito.length > 0
      && numerosConceito.every(v => Number.isInteger(v) && v >= 1 && v <= 4);

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
    const totalFaltas = disciplinas.reduce((s,d) => s + (d.numero_faltas ?? 0), 0);
    const freqTotal = totalAulas > 0
      ? (((totalAulas - totalFaltas) / totalAulas) * 100)
      : null;

    rows = disciplinas.map(d => {
      const conceitoFinal = d.media_final_disciplina ?? d.media_disciplina;
      const totalAulasDisciplina = d.carga_horaria_cumprida ?? d.carga_horaria ?? '—';

      return `<tr>
        <td class="td-diario">${esc(d.codigo_diario ?? '—')}</td>
        <td class="td-disciplina">${esc(d.disciplina)}</td>
        <td class="td-num">${d.carga_horaria > 0 ? d.carga_horaria + ' aulas' : '—'}</td>
        <td class="td-num">${esc(totalAulasDisciplina)}</td>
        <td class="td-num">${esc(d.numero_faltas ?? '—')}</td>
        <td class="td-num">${formatarFrequencia(d.percentual_carga_horaria_frequentada)}</td>
        <td>${situacaoHtml(d.situacao)}</td>
        ${etapas.map(n => {
          const etapa = d[`nota_etapa_${n}`] ?? {};
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
  try {
    const projetos = await api(endpoint);
    if (!projetos) return;
    const el = document.getElementById(`${id}Content`);

    if (!projetos.length) {
      el.innerHTML = `<div class="empty-state"><div class="icon">📭</div>
        <p>Nenhum projeto de ${tipoLabel.toLowerCase()} encontrado.</p></div>`;
      return;
    }

    el.innerHTML = projetos.map(p => `
      <div class="projeto-card">
        <span class="projeto-tipo ${tipoClass}">${tipoLabel}</span>
        <div class="projeto-titulo">${esc(p.titulo || p.nome || 'Sem título')}</div>
        <div class="projeto-detalhe">
          ${p.dt_inicio             ? `<span>📅 ${esc(p.dt_inicio)} – ${esc(p.dt_final ?? '?')}</span>`  : ''}
          ${p.situacao              ? `<span>🔹 ${esc(p.situacao)}</span>`                                : ''}
          ${p.nome_coordenador      ? `<span>👤 ${esc(p.nome_coordenador)}</span>`                        : ''}
          ${p.campus_nome_formatado ? `<span>🏫 ${esc(p.campus_nome_formatado)}</span>`                   : ''}
        </div>
      </div>`).join('');
  } catch(e) {
    document.getElementById(`${id}Content`).innerHTML =
      '<div class="empty-state"><div class="icon">⚠️</div><p>Erro ao carregar projetos.</p></div>';
  }
};

// ── CALENDÁRIO ─────────────────────────────────────────────────
const carregarCalendario = async () => {
  state.loaded['calendario'] = true;
  try {
    const anoAtual = new Date().getFullYear();
    const eventos  = await api(`/api/calendario?ano=${anoAtual}`);
    if (!eventos) return;

    const el = document.getElementById('calendarioContent');

    if (!eventos.length) {
      el.innerHTML = '<div class="empty-state"><div class="icon">📅</div><p>Nenhum evento encontrado.</p></div>';
      return;
    }

    const sorted = [...eventos].sort((a,b) =>
      new Date(a.data_inicio || a.data || '') - new Date(b.data_inicio || b.data || '')
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
          <h4>${esc(ev.nome || ev.titulo || 'Evento')}</h4>
          <p>${esc(ev.tipo || ev.local || '')}</p>
        </div>
      </div>`;
    }).join('')}</div>`;
  } catch(e) {
    document.getElementById('calendarioContent').innerHTML =
      '<div class="empty-state"><div class="icon">⚠️</div><p>Erro ao carregar calendário.</p></div>';
  }
};

// ── Logout ─────────────────────────────────────────────────────
const logout = async () => {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  window.location.href = '/login';
};
