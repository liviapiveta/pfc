const path = require('path');
const PDFDocument = require('pdfkit');

/**
 * Relatório de desempenho do aluno em PDF (A4).
 *
 * Recebe os dados já prontos (o controller consulta o banco) e devolve o PDF
 * como Buffer. Usa as fontes do site (DM Sans e Syne), embutidas no PDF.
 *
 * Seções: cabeçalho · aluno · resumo em números · nível · pontos por mês ·
 * conquistas · eventos · projetos · rodapé (data de emissão e páginas).
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

const CATEGORIAS = { academico: 'Acadêmica', projeto: 'Projeto', evento: 'Evento', especial: 'Especial' };
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

// ── Datas no fuso do campus ──────────────────────────────────────
const partesSP = (d) => {
  const p = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(d));
  const o = {}; p.forEach((x) => { o[x.type] = x.value; });
  return o;
};
const dataBR = (d) => {
  if (!d) return '—';
  // "AAAA-MM-DD" (data de evento) vira dd/mm/aaaa sem mexer no fuso
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return '—';
  const o = partesSP(t);
  return `${o.day}/${o.month}/${o.year}`;
};
const dataHoraBR = (d) => { const o = partesSP(d); return `${o.day}/${o.month}/${o.year} às ${o.hour}:${o.minute}`; };
const num = (n) => Number(n || 0).toLocaleString('pt-BR');

/** Monta o PDF e devolve um Buffer. */
const gerarRelatorio = (dados) => new Promise((resolve, reject) => {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: MARGEM, bottom: MARGEM, left: MARGEM, right: MARGEM },
    bufferPages: true, // para numerar as páginas no fim
    font: path.join(FONTES, 'DMSans_400Regular.ttf'), // evita carregar a Helvetica (arquivo extra)
    info: {
      Title: `Relatório de desempenho — ${dados.aluno.nome}`,
      Author: 'IFPlenus — IFPR Campus Assis Chateaubriand',
      Subject: 'Conquistas, trajetória e participação em eventos e projetos',
      Creator: 'IFPlenus',
    },
  });
  const partes = [];
  doc.on('data', (c) => partes.push(c));
  doc.on('end', () => resolve(Buffer.concat(partes)));
  doc.on('error', reject);

  doc.registerFont('reg', path.join(FONTES, 'DMSans_400Regular.ttf'));
  doc.registerFont('med', path.join(FONTES, 'DMSans_500Medium.ttf'));
  doc.registerFont('neg', path.join(FONTES, 'DMSans_700Bold.ttf'));
  doc.registerFont('titulo', path.join(FONTES, 'Syne_800ExtraBold.ttf'));

  const limiteY = () => A4.altura - MARGEM - RODAPE;
  const novaPagina = () => { doc.addPage(); doc.y = MARGEM; };
  const garantir = (altura) => { if (doc.y + altura > limiteY()) novaPagina(); };

  // ── Cabeçalho (só na 1ª página) ────────────────────────────────
  doc.rect(0, 0, A4.largura, 104).fill(COR.topo);
  doc.rect(0, 104, A4.largura, 4).fill(COR.verde);
  try { doc.image(LOGO, MARGEM, 30, { width: 42, height: 42 }); } catch { /* sem logo, segue */ }
  doc.font('titulo').fontSize(22).fillColor('#ffffff').text('IF', MARGEM + 54, 32, { continued: true })
    .fillColor('#5fe39a').text('Plenus');
  doc.font('reg').fontSize(10).fillColor('#c9cdd4').text('Relatório de desempenho do estudante', MARGEM + 54, 60);
  doc.font('reg').fontSize(8.5).fillColor('#9da2ad')
    .text('Emitido em', MARGEM, 34, { width: UTIL, align: 'right' })
    .font('med').fontSize(10).fillColor('#ffffff')
    .text(dataHoraBR(dados.emitidoEm), MARGEM, 47, { width: UTIL, align: 'right' })
    .font('reg').fontSize(8.5).fillColor('#9da2ad')
    .text('IFPR · Campus Assis Chateaubriand', MARGEM, 63, { width: UTIL, align: 'right' });

  // ── Aluno ──────────────────────────────────────────────────────
  doc.y = 132;
  doc.font('titulo').fontSize(20).fillColor(COR.texto).text(dados.aluno.nome, MARGEM, doc.y, { width: UTIL });
  const linhaAluno = [dados.aluno.curso, dados.aluno.matricula ? `Matrícula ${dados.aluno.matricula}` : ''].filter(Boolean).join('  ·  ');
  if (linhaAluno) doc.moveDown(0.15).font('reg').fontSize(10.5).fillColor(COR.texto2).text(linhaAluno, { width: UTIL });
  doc.moveDown(1.1);

  // ── Resumo em números (2 linhas × 3) ───────────────────────────
  const r = dados.resumo;
  const cards = [
    ['Pontos', num(r.pontos), COR.ouro],
    ['Nível', `${r.nivel.nivel} · ${r.nivel.nome}`, COR.verdeEscuro],
    ['Ranking do campus', r.posicao ? `${r.posicao}º de ${num(r.totalAlunos)}` : 'Oculto', COR.verdeEscuro],
    ['Conquistas', num(r.conquistas), COR.verdeEscuro],
    ['Eventos', num(r.eventos), COR.verdeEscuro],
    ['Projetos', num(r.projetos), COR.verdeEscuro],
  ];
  const gap = 10, cw = (UTIL - gap * 2) / 3, ch = 54;
  let y0 = doc.y;
  cards.forEach(([rotulo, valor, cor], i) => {
    const x = MARGEM + (i % 3) * (cw + gap);
    const y = y0 + Math.floor(i / 3) * (ch + gap);
    doc.roundedRect(x, y, cw, ch, 8).fill(COR.fundo);
    doc.font('reg').fontSize(8.5).fillColor(COR.cinza).text(rotulo.toUpperCase(), x + 12, y + 10, { width: cw - 24, characterSpacing: 0.4 });
    const tam = String(valor).length > 16 ? 12 : 16;
    doc.font('neg').fontSize(tam).fillColor(cor).text(valor, x + 12, y + 25, { width: cw - 24, lineBreak: false, ellipsis: true });
  });
  doc.y = y0 + ch * 2 + gap + 18;

  // ── Progresso de nível ─────────────────────────────────────────
  const nv = r.nivel;
  const txtNivel = nv.proximoNome
    ? `Faltam ${num(nv.faltamParaProximo)} pontos para o nível ${nv.nivel + 1} · ${nv.proximoNome}`
    : 'Nível máximo alcançado — parabéns!';
  doc.font('med').fontSize(10).fillColor(COR.texto).text('Progresso de nível', MARGEM, doc.y);
  doc.font('reg').fontSize(9).fillColor(COR.texto2).text(txtNivel, MARGEM, doc.y - 12, { width: UTIL, align: 'right' });
  const yb = doc.y + 6;
  doc.roundedRect(MARGEM, yb, UTIL, 8, 4).fill(COR.linha);
  const pct = Math.max(0, Math.min(1, (nv.progresso ?? 100) / 100));
  if (pct > 0) doc.roundedRect(MARGEM, yb, Math.max(8, UTIL * pct), 8, 4).fill(COR.verde);
  doc.y = yb + 26;

  // ── Pontos por mês (últimos 12 meses) ──────────────────────────
  const titulo = (txt, sub) => {
    garantir(70);
    doc.font('titulo').fontSize(13.5).fillColor(COR.texto).text(txt, MARGEM, doc.y, { width: UTIL });
    if (sub) doc.font('reg').fontSize(9).fillColor(COR.cinza).text(sub, { width: UTIL });
    doc.moveDown(0.6);
  };

  titulo('Pontos por mês', 'Pontos das conquistas recebidas nos últimos 12 meses');
  const meses = dados.pontosPorMes; // [{ rotulo, pontos }] × 12
  const maxP = Math.max(1, ...meses.map((m) => m.pontos));
  const gh = 92, gy = doc.y, bw = UTIL / meses.length;
  [0, 0.5, 1].forEach((f) => {
    const yy = gy + gh - gh * f;
    doc.moveTo(MARGEM, yy).lineTo(MARGEM + UTIL, yy).lineWidth(0.5).strokeColor(COR.linha).stroke();
  });
  meses.forEach((m, i) => {
    const h = m.pontos ? Math.max(3, (m.pontos / maxP) * (gh - 14)) : 0;
    const x = MARGEM + i * bw + bw * 0.2;
    if (h) {
      doc.roundedRect(x, gy + gh - h, bw * 0.6, h, 2.5).fill(i === meses.length - 1 ? COR.verde : '#8fd3ab');
      doc.font('med').fontSize(7.5).fillColor(COR.texto2).text(num(m.pontos), MARGEM + i * bw, gy + gh - h - 11, { width: bw, align: 'center' });
    }
    doc.font('reg').fontSize(7.5).fillColor(COR.cinza).text(m.rotulo, MARGEM + i * bw, gy + gh + 5, { width: bw, align: 'center' });
  });
  doc.y = gy + gh + 30;

  // ── Tabelas ────────────────────────────────────────────────────
  /**
   * colunas: [{ titulo, largura (fração), alinhar? }]; linhas: arrays de texto.
   * Quebra de página repete o cabeçalho.
   */
  const tabela = (colunas, linhas, vazio) => {
    const ws = colunas.map((c) => c.largura * UTIL);
    const pad = 7;
    const cabecalho = () => {
      const y = doc.y;
      doc.rect(MARGEM, y, UTIL, 20).fill(COR.verdeClaro);
      let x = MARGEM;
      colunas.forEach((c, i) => {
        doc.font('neg').fontSize(8).fillColor(COR.verdeEscuro)
          .text(c.titulo.toUpperCase(), x + pad, y + 6.5, { width: ws[i] - pad * 2, align: c.alinhar || 'left', characterSpacing: 0.3 });
        x += ws[i];
      });
      doc.y = y + 20;
    };
    if (!linhas.length) {
      doc.font('reg').fontSize(9.5).fillColor(COR.cinza).text(vazio, MARGEM, doc.y, { width: UTIL });
      doc.moveDown(1.6);
      return;
    }
    cabecalho();
    linhas.forEach((ln, li) => {
      doc.font('reg').fontSize(9);
      const alturas = ln.map((t, i) => doc.font(i === 0 ? 'med' : 'reg').heightOfString(String(t ?? ''), { width: ws[i] - pad * 2 }));
      const h = Math.max(...alturas) + pad * 2 - 2;
      if (doc.y + h > limiteY()) { novaPagina(); cabecalho(); }
      const y = doc.y;
      if (li % 2 === 1) doc.rect(MARGEM, y, UTIL, h).fill(COR.fundo);
      let x = MARGEM;
      ln.forEach((t, i) => {
        doc.font(i === 0 ? 'med' : 'reg').fontSize(9).fillColor(i === 0 ? COR.texto : COR.texto2)
          .text(String(t ?? ''), x + pad, y + pad - 1, { width: ws[i] - pad * 2, align: colunas[i].alinhar || 'left' });
        x += ws[i];
      });
      doc.moveTo(MARGEM, y + h).lineTo(MARGEM + UTIL, y + h).lineWidth(0.5).strokeColor(COR.linha).stroke();
      doc.y = y + h;
    });
    doc.moveDown(1.6);
  };

  titulo('Conquistas', `${num(dados.conquistas.length)} conquista(s) · ${num(r.pontos)} pontos no total`);
  tabela(
    [{ titulo: 'Conquista', largura: 0.3 }, { titulo: 'Tipo', largura: 0.13 }, { titulo: 'Motivo', largura: 0.33 }, { titulo: 'Data', largura: 0.13 }, { titulo: 'Pts', largura: 0.11, alinhar: 'right' }],
    dados.conquistas.map((c) => [c.nome, CATEGORIAS[c.categoria] || 'Especial', c.motivo, dataBR(c.data), num(c.pontos)]),
    'Ainda não há conquistas. Participe de eventos e projetos para começar!'
  );

  titulo('Participação em eventos', 'Presenças validadas no IFPlenus');
  tabela(
    [{ titulo: 'Evento', largura: 0.46 }, { titulo: 'Data do evento', largura: 0.17 }, { titulo: 'Validação', largura: 0.2 }, { titulo: 'Validada em', largura: 0.17 }],
    dados.eventos.map((e) => [e.nome, dataBR(e.data), e.metodo === 'qrcode' ? 'QR Code' : 'Certificado', dataBR(e.validadaEm)]),
    'Nenhuma presença validada ainda.'
  );

  titulo('Projetos', 'Participações aceitas em projetos de pesquisa e extensão');
  tabela(
    [{ titulo: 'Projeto', largura: 0.63 }, { titulo: 'Tipo', largura: 0.2 }, { titulo: 'Aceito em', largura: 0.17 }],
    dados.projetos.map((p) => [p.titulo, p.tipo === 'pesquisa' ? 'Pesquisa' : p.tipo === 'extensao' ? 'Extensão' : '—', dataBR(p.data)]),
    'Nenhuma participação em projeto aceita ainda.'
  );

  // ── Aviso final ────────────────────────────────────────────────
  garantir(56);
  const ya = doc.y;
  doc.roundedRect(MARGEM, ya, UTIL, 46, 8).lineWidth(0.8).strokeColor(COR.linha).stroke();
  doc.font('med').fontSize(8.5).fillColor(COR.texto2)
    .text('Sobre este relatório', MARGEM + 12, ya + 9, { width: UTIL - 24 })
    .font('reg').fontSize(8).fillColor(COR.cinza)
    .text('Gerado pelo IFPlenus com os registros validados até a data de emissão. Organiza a participação do estudante, mas não substitui o histórico escolar nem os certificados oficiais emitidos pelo IFPR/SUAP.', { width: UTIL - 24 });

  // ── Rodapé com páginas ─────────────────────────────────────────
  const { start, count } = doc.bufferedPageRange();
  for (let i = start; i < start + count; i++) {
    doc.switchToPage(i);
    const yf = A4.altura - MARGEM + 6;
    doc.moveTo(MARGEM, yf - 8).lineTo(MARGEM + UTIL, yf - 8).lineWidth(0.5).strokeColor(COR.linha).stroke();
    doc.font('reg').fontSize(7.5).fillColor(COR.cinza)
      .text(`IFPlenus · ${dados.aluno.nome}`, MARGEM, yf, { width: UTIL / 2, lineBreak: false, height: 10 })
      .text(`Página ${i - start + 1} de ${count}`, MARGEM + UTIL / 2, yf, { width: UTIL / 2, align: 'right', lineBreak: false, height: 10 });
  }
  doc.end();
});

/** Pontos por mês dos últimos 12 meses (o mês atual é o último). */
const pontosPorMes = (conquistas, agora = new Date()) => {
  const o = partesSP(agora);
  let ano = Number(o.year), mes = Number(o.month) - 1;
  const lista = [];
  for (let i = 0; i < 12; i++) {
    lista.unshift({ chave: `${ano}-${mes}`, rotulo: `${MESES[mes]}/${String(ano).slice(2)}`, pontos: 0 });
    mes -= 1; if (mes < 0) { mes = 11; ano -= 1; }
  }
  const idx = Object.fromEntries(lista.map((m, i) => [m.chave, i]));
  conquistas.forEach((c) => {
    if (!c.data) return;
    const p = partesSP(c.data);
    const i = idx[`${Number(p.year)}-${Number(p.month) - 1}`];
    if (i != null) lista[i].pontos += Number(c.pontos) || 0;
  });
  return lista.map(({ rotulo, pontos }) => ({ rotulo, pontos }));
};

module.exports = { gerarRelatorio, pontosPorMes, dataBR };
