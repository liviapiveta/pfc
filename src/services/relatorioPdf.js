const path = require('path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

/**
 * Relatório de desempenho do aluno em PDF (A4), em português ou inglês.
 *
 * Recebe os dados já prontos (o controller consulta o banco) e devolve o PDF
 * como Buffer. Usa as fontes do site (DM Sans e Syne), embutidas no PDF.
 *
 * Seções: cabeçalho · aluno e período · resumo em números · nível ·
 * pontos por mês · conquistas · eventos (com horas) · projetos ·
 * verificação (QR) · rodapé (código e páginas).
 */

const FONTES = path.join(__dirname, '..', 'assets', 'fontes');
const LOGO = path.join(__dirname, '..', 'public', 'images', 'logo.png');

const COR = {
  texto: '#1b1f24',
  texto2: '#4b5563',
  cinza: '#6b7280',
  linha: '#e3e8e5',
  fundo: '#f4f7f5',
  verde: '#1f9d55',
  verdeEscuro: '#126b3a',
  verdeClaro: '#e3f5ea',
  topo: '#121214',
  ouro: '#b7791f',
};

const A4 = { largura: 595.28, altura: 841.89 };
const MARGEM = 46;
const UTIL = A4.largura - MARGEM * 2;
const RODAPE = 34; // espaço reservado embaixo de cada página

// ── Textos nos dois idiomas ──────────────────────────────────────
const T = {
  pt: {
    subtitulo: 'Relatório de desempenho do estudante',
    emitido: 'Emitido em',
    campus: 'IFPR · Campus Assis Chateaubriand',
    matricula: 'Matrícula',
    periodo: 'Período',
    cards: { pontos: 'Pontos', pontosPer: 'Pontos no período', nivel: 'Nível atual', ranking: 'Ranking do campus', conquistas: 'Conquistas', eventos: 'Eventos', horas: 'Horas em eventos', projetos: 'Projetos' },
    oculto: 'Oculto',
    posicao: (p, n) => `${p}º de ${n}`,
    progresso: 'Progresso de nível',
    faltam: (n, prox, nome) => `Faltam ${n} pontos para o nível ${prox} · ${nome}`,
    maximo: 'Nível máximo alcançado — parabéns!',
    porMes: 'Pontos por mês',
    porMesSub: (r) => `Pontos das conquistas recebidas · ${r}`,
    conquistas: 'Conquistas',
    conquistasSub: (n, p) => `${n} conquista(s) · ${p} pontos`,
    colConq: ['Conquista', 'Tipo', 'Motivo', 'Data', 'Pts'],
    semConq: 'Nenhuma conquista neste período.',
    eventos: 'Participação em eventos',
    eventosSub: (h) => (h ? `Presenças validadas no IFPlenus · ${h} de carga horária` : 'Presenças validadas no IFPlenus'),
    colEv: ['Evento', 'Data', 'Validação', 'Horas'],
    semEv: 'Nenhuma presença validada neste período.',
    projetos: 'Projetos',
    projetosSub: 'Participações aceitas em projetos de pesquisa e extensão',
    colProj: ['Projeto', 'Tipo', 'Aceito em'],
    semProj: 'Nenhuma participação em projeto neste período.',
    tipos: { pesquisa: 'Pesquisa', extensao: 'Extensão' },
    categorias: { academico: 'Acadêmica', projeto: 'Projeto', evento: 'Evento', especial: 'Especial' },
    metodos: { qrcode: 'QR Code', certificado: 'Certificado' },
    verifTitulo: 'Verificação de autenticidade',
    verifTexto: 'Para conferir se este relatório é verdadeiro, aponte a câmera para o QR Code ou acesse o endereço abaixo. A página mostra os números registrados na emissão.',
    codigo: 'Código',
    sobreTitulo: 'Sobre este relatório',
    sobre: 'Gerado pelo IFPlenus com os registros validados até a data de emissão. Organiza a participação do estudante, mas não substitui o histórico escolar nem os certificados oficiais emitidos pelo IFPR/SUAP.',
    pagina: (i, n) => `Página ${i} de ${n}`,
    meses: ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'],
    as: 'às',
    titulo: (nome) => `Relatório de desempenho — ${nome}`,
    assunto: 'Conquistas, trajetória e participação em eventos e projetos',
  },
  en: {
    subtitulo: 'Student performance report',
    emitido: 'Issued on',
    campus: 'IFPR · Assis Chateaubriand Campus',
    matricula: 'Student ID',
    periodo: 'Period',
    cards: { pontos: 'Points', pontosPer: 'Points in period', nivel: 'Current level', ranking: 'Campus ranking', conquistas: 'Achievements', eventos: 'Events', horas: 'Event hours', projetos: 'Projects' },
    oculto: 'Hidden',
    posicao: (p, n) => `#${p} of ${n}`,
    progresso: 'Level progress',
    faltam: (n, prox, nome) => `${n} points to level ${prox} · ${nome}`,
    maximo: 'Highest level reached — congratulations!',
    porMes: 'Points per month',
    porMesSub: (r) => `Points from achievements earned · ${r}`,
    conquistas: 'Achievements',
    conquistasSub: (n, p) => `${n} achievement(s) · ${p} points`,
    colConq: ['Achievement', 'Type', 'Reason', 'Date', 'Pts'],
    semConq: 'No achievements in this period.',
    eventos: 'Event participation',
    eventosSub: (h) => (h ? `Attendance validated on IFPlenus · ${h} in total` : 'Attendance validated on IFPlenus'),
    colEv: ['Event', 'Date', 'Validation', 'Hours'],
    semEv: 'No validated attendance in this period.',
    projetos: 'Projects',
    projetosSub: 'Accepted participation in research and extension projects',
    colProj: ['Project', 'Type', 'Accepted on'],
    semProj: 'No project participation in this period.',
    tipos: { pesquisa: 'Research', extensao: 'Extension' },
    categorias: { academico: 'Academic', projeto: 'Project', evento: 'Event', especial: 'Special' },
    metodos: { qrcode: 'QR Code', certificado: 'Certificate' },
    verifTitulo: 'Authenticity check',
    verifTexto: 'To confirm this report is genuine, scan the QR code or visit the address below. The page shows the figures recorded when it was issued.',
    codigo: 'Code',
    sobreTitulo: 'About this report',
    sobre: 'Generated by IFPlenus (gamification portal of IFPR, the Federal Institute of Paraná, Brazil) from records validated up to the issue date. It summarizes the student\'s participation and does not replace the official transcript or certificates issued by IFPR/SUAP. Names of achievements, events, projects and courses are kept in Portuguese, as registered.',
    pagina: (i, n) => `Page ${i} of ${n}`,
    meses: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    as: 'at',
    titulo: (nome) => `Performance report — ${nome}`,
    assunto: 'Achievements, timeline and participation in events and projects',
  },
};

// Nomes dos níveis em inglês (pelo número do nível)
const NIVEIS_EN = { 1: 'Beginner', 2: 'Amateur', 3: 'Intermediate', 4: 'Advanced', 5: 'Veteran', 6: 'Master', 7: 'Legend' };
const nomeNivel = (n, idioma, nomePt) => (idioma === 'en' ? NIVEIS_EN[n] || nomePt : nomePt);

// ── Datas no fuso do campus ──────────────────────────────────────
const partesSP = (d) => {
  const p = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(d));
  const o = {}; p.forEach((x) => { o[x.type] = x.value; });
  return o;
};
/** Data curta: 08/11/2026 (pt) ou 8 Nov 2026 (en — sem confundir dia e mês). */
const dataFmt = (d, idioma = 'pt') => {
  if (!d) return '—';
  let dia, mes, ano;
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})$/); // data de evento: sem mexer no fuso
  if (m) { [, ano, mes, dia] = m; } else {
    const t = new Date(d);
    if (Number.isNaN(t.getTime())) return '—';
    const o = partesSP(t); dia = o.day; mes = o.month; ano = o.year;
  }
  return idioma === 'en' ? `${Number(dia)} ${T.en.meses[Number(mes) - 1]} ${ano}` : `${dia}/${mes}/${ano}`;
};
const dataBR = (d) => dataFmt(d, 'pt');
const dataHora = (d, idioma) => { const o = partesSP(d); return `${dataFmt(d, idioma)} ${T[idioma].as} ${o.hour}:${o.minute}`; };
const num = (n, idioma = 'pt') => Number(n || 0).toLocaleString(idioma === 'en' ? 'en-US' : 'pt-BR');
const horasFmt = (h, idioma = 'pt') => {
  const v = Number(h || 0);
  if (!v) return '';
  const s = Number.isInteger(v) ? String(v) : v.toFixed(1);
  return `${idioma === 'en' ? s : s.replace('.', ',')}h`;
};

/** Desenha o QR Code em vetor (fica nítido em qualquer zoom e na impressão). */
const desenharQr = (doc, texto, x, y, tamanho) => {
  const qr = QRCode.create(texto, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const borda = 2; // "zona quieta" em módulos
  const m = tamanho / (n + borda * 2);
  doc.rect(x, y, tamanho, tamanho).fill('#ffffff');
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.modules.get(r, c)) doc.rect(x + (c + borda) * m, y + (r + borda) * m, m + 0.05, m + 0.05);
    }
  }
  doc.fill('#000000');
};

/** Monta o PDF e devolve um Buffer. */
const gerarRelatorio = (dados) => new Promise((resolve, reject) => {
  const idioma = dados.idioma === 'en' ? 'en' : 'pt';
  const t = T[idioma];
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: MARGEM, bottom: MARGEM, left: MARGEM, right: MARGEM },
    bufferPages: true, // para numerar as páginas no fim
    font: path.join(FONTES, 'DMSans_400Regular.ttf'), // evita carregar a Helvetica (arquivo extra)
    lang: idioma === 'en' ? 'en-US' : 'pt-BR',
    info: { Title: t.titulo(dados.aluno.nome), Author: 'IFPlenus — IFPR Campus Assis Chateaubriand', Subject: t.assunto, Creator: 'IFPlenus' },
  });
  const partes = [];
  doc.on('data', (c) => partes.push(c));
  doc.on('end', () => resolve(Buffer.concat(partes)));
  doc.on('error', reject);

  try {
    doc.registerFont('reg', path.join(FONTES, 'DMSans_400Regular.ttf'));
    doc.registerFont('med', path.join(FONTES, 'DMSans_500Medium.ttf'));
    doc.registerFont('neg', path.join(FONTES, 'DMSans_700Bold.ttf'));
    doc.registerFont('titulo', path.join(FONTES, 'Syne_800ExtraBold.ttf'));

    const limiteY = () => A4.altura - MARGEM - RODAPE;
    const novaPagina = () => { doc.addPage(); doc.y = MARGEM; };
    const garantir = (altura) => { if (doc.y + altura > limiteY()) novaPagina(); };

    // ── Cabeçalho (só na 1ª página) ──────────────────────────────
    doc.rect(0, 0, A4.largura, 104).fill(COR.topo);
    doc.rect(0, 104, A4.largura, 4).fill(COR.verde);
    try { doc.image(LOGO, MARGEM, 30, { width: 42, height: 42 }); } catch { /* sem logo, segue */ }
    doc.font('titulo').fontSize(22).fillColor('#ffffff').text('IF', MARGEM + 54, 32, { continued: true })
      .fillColor('#5fe39a').text('Plenus');
    doc.font('reg').fontSize(10).fillColor('#c9cdd4').text(t.subtitulo, MARGEM + 54, 60);
    const larguraDir = 230, xDir = MARGEM + UTIL - larguraDir;
    doc.font('reg').fontSize(8.5).fillColor('#9da2ad').text(t.emitido, xDir, 34, { width: larguraDir, align: 'right' });
    doc.font('med').fontSize(10).fillColor('#ffffff').text(dataHora(dados.emitidoEm, idioma), xDir, 47, { width: larguraDir, align: 'right' });
    doc.font('reg').fontSize(8).fillColor('#9da2ad').text(t.campus, xDir, 63, { width: larguraDir, align: 'right' });

    // ── Aluno e período ──────────────────────────────────────────
    doc.y = 132;
    doc.font('titulo').fontSize(20).fillColor(COR.texto).text(dados.aluno.nome, MARGEM, doc.y, { width: UTIL });
    const linhaAluno = [dados.aluno.curso, dados.aluno.matricula ? `${t.matricula} ${dados.aluno.matricula}` : ''].filter(Boolean).join('  ·  ');
    if (linhaAluno) doc.moveDown(0.15).font('reg').fontSize(10.5).fillColor(COR.texto2).text(linhaAluno, { width: UTIL });
    doc.moveDown(0.25).font('med').fontSize(10).fillColor(COR.verdeEscuro).text(`${t.periodo}: ${dados.periodoRotulo}`, { width: UTIL });
    doc.moveDown(1);

    // ── Resumo em números (4 + 3 cartões) ────────────────────────
    const r = dados.resumo;
    const nv = r.nivel;
    const filtrado = dados.periodo && dados.periodo !== 'tudo';
    const linhas = [
      [
        [filtrado ? t.cards.pontosPer : t.cards.pontos, num(r.pontos, idioma), COR.ouro],
        [t.cards.nivel, `${nv.nivel} · ${nomeNivel(nv.nivel, idioma, nv.nome)}`, COR.verdeEscuro],
        [t.cards.ranking, r.posicao ? t.posicao(r.posicao, num(r.totalAlunos, idioma)) : t.oculto, COR.verdeEscuro],
        [t.cards.conquistas, num(r.conquistas, idioma), COR.verdeEscuro],
      ],
      [
        [t.cards.eventos, num(r.eventos, idioma), COR.verdeEscuro],
        [t.cards.horas, horasFmt(r.horas, idioma) || '0h', COR.verdeEscuro],
        [t.cards.projetos, num(r.projetos, idioma), COR.verdeEscuro],
      ],
    ];
    const gap = 10, ch = 54;
    const y0 = doc.y;
    linhas.forEach((cards, li) => {
      const cw = (UTIL - gap * (cards.length - 1)) / cards.length;
      const y = y0 + li * (ch + gap);
      cards.forEach(([rotulo, valor, cor], i) => {
        const x = MARGEM + i * (cw + gap);
        doc.roundedRect(x, y, cw, ch, 8).fill(COR.fundo);
        doc.font('reg').fontSize(8).fillColor(COR.cinza).text(rotulo.toUpperCase(), x + 11, y + 10, { width: cw - 22, characterSpacing: 0.3, lineBreak: false, ellipsis: true });
        const tam = String(valor).length > 13 ? 11.5 : 15;
        doc.font('neg').fontSize(tam).fillColor(cor).text(String(valor), x + 11, y + 26, { width: cw - 22, lineBreak: false, ellipsis: true });
      });
    });
    doc.y = y0 + ch * 2 + gap + 18;

    // ── Progresso de nível ───────────────────────────────────────
    const txtNivel = nv.proximoNome
      ? t.faltam(num(nv.faltamParaProximo, idioma), nv.nivel + 1, nomeNivel(nv.nivel + 1, idioma, nv.proximoNome))
      : t.maximo;
    const yn = doc.y;
    doc.font('med').fontSize(10).fillColor(COR.texto).text(t.progresso, MARGEM, yn);
    doc.font('reg').fontSize(9).fillColor(COR.texto2).text(txtNivel, MARGEM + 140, yn + 1, { width: UTIL - 140, align: 'right' });
    const yb = yn + 20;
    doc.roundedRect(MARGEM, yb, UTIL, 8, 4).fill(COR.linha);
    const pct = Math.max(0, Math.min(1, (nv.progresso ?? 100) / 100));
    if (pct > 0) doc.roundedRect(MARGEM, yb, Math.max(8, UTIL * pct), 8, 4).fill(COR.verde);
    doc.y = yb + 26;

    // ── Pontos por mês ───────────────────────────────────────────
    const titulo = (txt, sub, minimo = 70) => {
      garantir(minimo);
      doc.font('titulo').fontSize(13.5).fillColor(COR.texto).text(txt, MARGEM, doc.y, { width: UTIL });
      if (sub) doc.font('reg').fontSize(9).fillColor(COR.cinza).text(sub, { width: UTIL });
      doc.moveDown(0.6);
    };

    const meses = dados.pontosPorMes.map((m) => ({ ...m, rotulo: `${t.meses[m.mes]}/${String(m.ano).slice(2)}` }));
    titulo(t.porMes, t.porMesSub(dados.periodoRotulo), 150);
    const maxP = Math.max(1, ...meses.map((m) => m.pontos));
    const gh = 92, gy = doc.y, bw = UTIL / Math.max(1, meses.length);
    [0, 0.5, 1].forEach((f) => {
      const yy = gy + gh - gh * f;
      doc.moveTo(MARGEM, yy).lineTo(MARGEM + UTIL, yy).lineWidth(0.5).strokeColor(COR.linha).stroke();
    });
    const larguraBarra = Math.min(bw * 0.6, 26);
    meses.forEach((m, i) => {
      const h = m.pontos ? Math.max(3, (m.pontos / maxP) * (gh - 14)) : 0;
      const x = MARGEM + i * bw + (bw - larguraBarra) / 2;
      if (h) {
        doc.roundedRect(x, gy + gh - h, larguraBarra, h, 2.5).fill(m.atual ? COR.verde : '#8fd3ab');
        doc.font('med').fontSize(7.5).fillColor(COR.texto2).text(num(m.pontos, idioma), MARGEM + i * bw, gy + gh - h - 11, { width: bw, align: 'center' });
      }
      doc.font('reg').fontSize(7.5).fillColor(COR.cinza).text(m.rotulo, MARGEM + i * bw, gy + gh + 5, { width: bw, align: 'center' });
    });
    doc.y = gy + gh + 30;

    // ── Tabelas ──────────────────────────────────────────────────
    /** colunas: [{ titulo, largura (fração), alinhar? }]; linhas: arrays de texto. Quebra de página repete o cabeçalho. */
    const tabela = (colunas, linhasT, vazio) => {
      const ws = colunas.map((c) => c.largura * UTIL);
      const pad = 7;
      const cabecalho = () => {
        const y = doc.y;
        doc.rect(MARGEM, y, UTIL, 20).fill(COR.verdeClaro);
        let x = MARGEM;
        colunas.forEach((c, i) => {
          doc.font('neg').fontSize(8).fillColor(COR.verdeEscuro)
            .text(c.titulo.toUpperCase(), x + pad, y + 6.5, { width: ws[i] - pad * 2, align: c.alinhar || 'left', characterSpacing: 0.3, lineBreak: false });
          x += ws[i];
        });
        doc.y = y + 20;
      };
      if (!linhasT.length) {
        doc.font('reg').fontSize(9.5).fillColor(COR.cinza).text(vazio, MARGEM, doc.y, { width: UTIL });
        doc.moveDown(1.6);
        return;
      }
      cabecalho();
      linhasT.forEach((ln, li) => {
        const alturas = ln.map((tx, i) => doc.font(i === 0 ? 'med' : 'reg').fontSize(9).heightOfString(String(tx ?? ''), { width: ws[i] - pad * 2 }));
        const h = Math.max(...alturas) + pad * 2 - 2;
        if (doc.y + h > limiteY()) { novaPagina(); cabecalho(); }
        const y = doc.y;
        if (li % 2 === 1) doc.rect(MARGEM, y, UTIL, h).fill(COR.fundo);
        let x = MARGEM;
        ln.forEach((tx, i) => {
          doc.font(i === 0 ? 'med' : 'reg').fontSize(9).fillColor(i === 0 ? COR.texto : COR.texto2)
            .text(String(tx ?? ''), x + pad, y + pad - 1, { width: ws[i] - pad * 2, align: colunas[i].alinhar || 'left' });
          x += ws[i];
        });
        doc.moveTo(MARGEM, y + h).lineTo(MARGEM + UTIL, y + h).lineWidth(0.5).strokeColor(COR.linha).stroke();
        doc.y = y + h;
      });
      doc.moveDown(1.6);
    };

    const pontosConq = dados.conquistas.reduce((s, c) => s + (Number(c.pontos) || 0), 0);
    titulo(t.conquistas, t.conquistasSub(num(dados.conquistas.length, idioma), num(pontosConq, idioma)));
    const cc = t.colConq;
    tabela(
      [{ titulo: cc[0], largura: 0.3 }, { titulo: cc[1], largura: 0.13 }, { titulo: cc[2], largura: 0.33 }, { titulo: cc[3], largura: 0.14 }, { titulo: cc[4], largura: 0.1, alinhar: 'right' }],
      dados.conquistas.map((c) => [c.nome, t.categorias[c.categoria] || t.categorias.especial, c.motivo, dataFmt(c.data, idioma), num(c.pontos, idioma)]),
      t.semConq
    );

    titulo(t.eventos, t.eventosSub(horasFmt(r.horas, idioma)));
    const ce = t.colEv;
    tabela(
      [{ titulo: ce[0], largura: 0.5 }, { titulo: ce[1], largura: 0.17 }, { titulo: ce[2], largura: 0.19 }, { titulo: ce[3], largura: 0.14, alinhar: 'right' }],
      dados.eventos.map((e) => [e.nome, dataFmt(e.data, idioma), t.metodos[e.metodo] || t.metodos.certificado, horasFmt(e.horas, idioma) || '—']),
      t.semEv
    );

    titulo(t.projetos, t.projetosSub);
    const cp = t.colProj;
    tabela(
      [{ titulo: cp[0], largura: 0.6 }, { titulo: cp[1], largura: 0.2 }, { titulo: cp[2], largura: 0.2 }],
      dados.projetos.map((p) => [p.titulo, t.tipos[p.tipo] || '—', dataFmt(p.data, idioma)]),
      t.semProj
    );

    // ── Verificação (QR) ─────────────────────────────────────────
    if (dados.verificacao?.url) {
      const qrTam = 80;
      const xt = MARGEM + qrTam + 28, wt = UTIL - qrTam - 40;
      const hTexto = doc.font('reg').fontSize(8.5).heightOfString(t.verifTexto, { width: wt })
        + doc.font('med').fontSize(8.5).heightOfString(dados.verificacao.url, { width: wt }) + 44;
      const hBox = Math.max(qrTam + 24, hTexto);
      garantir(hBox + 70);
      const yv = doc.y;
      doc.roundedRect(MARGEM, yv, UTIL, hBox, 10).fill(COR.verdeClaro);
      desenharQr(doc, dados.verificacao.url, MARGEM + 12, yv + (hBox - qrTam) / 2, qrTam);
      doc.font('neg').fontSize(11).fillColor(COR.verdeEscuro).text(t.verifTitulo, xt, yv + 13, { width: wt });
      doc.font('reg').fontSize(8.5).fillColor(COR.texto2).text(t.verifTexto, xt, doc.y + 3, { width: wt });
      doc.font('med').fontSize(8.5).fillColor(COR.verdeEscuro).text(dados.verificacao.url, xt, doc.y + 5, { width: wt, link: dados.verificacao.url });
      doc.font('reg').fontSize(8.5).fillColor(COR.cinza).text(`${t.codigo}: `, xt, doc.y + 3, { continued: true })
        .font('neg').fillColor(COR.texto).text(dados.verificacao.codigo, { characterSpacing: 1 });
      doc.y = yv + hBox + 14;
    }

    // ── Aviso final ──────────────────────────────────────────────
    const hAviso = doc.font('reg').fontSize(8).heightOfString(t.sobre, { width: UTIL - 24 }) + 30;
    garantir(hAviso + 6);
    const ya = doc.y;
    doc.roundedRect(MARGEM, ya, UTIL, hAviso, 8).lineWidth(0.8).strokeColor(COR.linha).stroke();
    doc.font('med').fontSize(8.5).fillColor(COR.texto2).text(t.sobreTitulo, MARGEM + 12, ya + 9, { width: UTIL - 24 });
    doc.font('reg').fontSize(8).fillColor(COR.cinza).text(t.sobre, MARGEM + 12, doc.y, { width: UTIL - 24 });

    // ── Rodapé com código e páginas ──────────────────────────────
    const { start, count } = doc.bufferedPageRange();
    for (let i = start; i < start + count; i++) {
      doc.switchToPage(i);
      const yf = A4.altura - MARGEM + 6;
      doc.moveTo(MARGEM, yf - 8).lineTo(MARGEM + UTIL, yf - 8).lineWidth(0.5).strokeColor(COR.linha).stroke();
      const esquerda = `IFPlenus · ${dados.aluno.nome}${dados.verificacao?.codigo ? ` · ${t.codigo} ${dados.verificacao.codigo}` : ''}`;
      doc.font('reg').fontSize(7.5).fillColor(COR.cinza)
        .text(esquerda, MARGEM, yf, { width: UTIL * 0.75, lineBreak: false, height: 10, ellipsis: true });
      doc.text(t.pagina(i - start + 1, count), MARGEM + UTIL * 0.75, yf, { width: UTIL * 0.25, align: 'right', lineBreak: false, height: 10 });
    }
    doc.end();
  } catch (err) {
    reject(err);
  }
});

// ── Períodos ────────────────────────────────────────────────────
/**
 * Lê o período pedido: 'tudo' | 'ano-AAAA' | 'AAAA-1' (jan–jun) | 'AAAA-2' (jul–dez).
 * Devolve { chave, inicio, fim (exclusivo), rotulo: { pt, en } } ou null se inválido.
 */
const lerPeriodo = (valor, agora = new Date()) => {
  const v = String(valor || 'tudo').trim();
  const anoAtual = Number(partesSP(agora).year);
  const data = (a, m) => new Date(`${a}-${String(m).padStart(2, '0')}-01T00:00:00-03:00`);
  if (v === 'tudo') return { chave: 'tudo', inicio: null, fim: null, rotulo: { pt: 'Todo o período', en: 'All time' } };
  let m = v.match(/^ano-(\d{4})$/);
  if (m) {
    const a = Number(m[1]);
    if (a < 2015 || a > anoAtual) return null;
    return { chave: v, inicio: data(a, 1), fim: data(a + 1, 1), rotulo: { pt: `Ano de ${a}`, en: `Year ${a}` } };
  }
  m = v.match(/^(\d{4})-([12])$/);
  if (m) {
    const a = Number(m[1]), s = Number(m[2]);
    if (a < 2015 || a > anoAtual) return null;
    return {
      chave: v,
      inicio: data(a, s === 1 ? 1 : 7),
      fim: s === 1 ? data(a, 7) : data(a + 1, 1),
      rotulo: { pt: `${s}º semestre de ${a}`, en: `${s === 1 ? '1st' : '2nd'} semester of ${a}` },
    };
  }
  return null;
};

/** Está dentro do período? (aceita Date ou "AAAA-MM-DD" de evento) */
const noPeriodo = (d, per) => {
  if (!per || per.chave === 'tudo') return true;
  if (!d) return false;
  const s = String(d);
  const t = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00-03:00`) : new Date(d);
  if (Number.isNaN(t.getTime())) return false;
  return t >= per.inicio && t < per.fim;
};

/**
 * Pontos por mês. Período "tudo": últimos 12 meses (o atual por último).
 * Ano: os 12 meses daquele ano. Semestre: os 6 meses.
 * Devolve [{ ano, mes (0–11), pontos }].
 */
const pontosPorMes = (conquistas, per = null, agora = new Date()) => {
  const lista = [];
  if (per && per.inicio) {
    const o = partesSP(per.inicio);
    let ano = Number(o.year), mes = Number(o.month) - 1;
    const total = per.chave.startsWith('ano-') ? 12 : 6;
    for (let i = 0; i < total; i++) {
      lista.push({ ano, mes, pontos: 0 });
      mes += 1; if (mes > 11) { mes = 0; ano += 1; }
    }
  } else {
    const o = partesSP(agora);
    let ano = Number(o.year), mes = Number(o.month) - 1;
    for (let i = 0; i < 12; i++) {
      lista.unshift({ ano, mes, pontos: 0 });
      mes -= 1; if (mes < 0) { mes = 11; ano -= 1; }
    }
  }
  // Destaca o mês atual (ou o último do período, se o período já acabou)
  const hoje = partesSP(agora);
  const iAtual = lista.findIndex((m) => m.ano === Number(hoje.year) && m.mes === Number(hoje.month) - 1);
  lista.forEach((m, i) => { m.atual = iAtual >= 0 ? i === iAtual : i === lista.length - 1; });
  const idx = Object.fromEntries(lista.map((m, i) => [`${m.ano}-${m.mes}`, i]));
  conquistas.forEach((c) => {
    if (!c.data) return;
    const p = partesSP(c.data);
    const i = idx[`${Number(p.year)}-${Number(p.month) - 1}`];
    if (i != null) lista[i].pontos += Number(c.pontos) || 0;
  });
  return lista;
};

module.exports = { gerarRelatorio, pontosPorMes, lerPeriodo, noPeriodo, dataBR, dataFmt, horasFmt, nomeNivel, partesSP, T };
