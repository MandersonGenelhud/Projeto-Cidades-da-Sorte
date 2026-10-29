// PDF de várias páginas, sem dependências: títulos, parágrafos com quebra de linha
// automática e imagens JPEG (a assinatura desenhada pelo cliente).

const latin = (s) => String(s ?? '').replace(/[–—]/g, '-').replace(/[•]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x20-\xFF\n]/g, '');
const pdfStr = (s) => latin(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 56;

/** Largura aproximada do texto em Helvetica (em pontos). */
function textWidth(s, size, bold) {
  let w = 0;
  for (const ch of latin(s)) {
    if ('il.,;:!|\'ítìî'.includes(ch)) w += 0.28;
    else if ('fjrI()[] '.includes(ch)) w += 0.33;
    else if ('mwMW'.includes(ch)) w += 0.85;
    else if (ch >= 'A' && ch <= 'Z') w += 0.68;
    else w += 0.54;
  }
  return w * size * (bold ? 1.06 : 1);
}

function wrapLine(text, size, bold, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && textWidth(next, size, bold) > maxW) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** Largura e altura de um JPEG (lê o marcador SOF). */
export function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

/**
 * blocks: [{ text, size, bold, gap, align: 'center' }] ou [{ image: Buffer(JPEG), width, gap }]
 * ou [{ rule: true }] (linha) ou [{ pageBreak: true }]. keep: altura que precisa caber junto na página. footer: texto no rodapé de cada página.
 */
export function documentPdf(blocks, { footer = '' } = {}) {
  const pages = [];
  const images = [];
  let ops = [];
  let y = PAGE_H - MARGIN;
  const maxW = PAGE_W - MARGIN * 2;
  const newPage = () => {
    if (ops.length) pages.push(ops);
    ops = [];
    y = PAGE_H - MARGIN;
  };
  const ensure = (h) => {
    if (y - h < MARGIN + 20) newPage();
  };
  for (const b of blocks) {
    if (b.pageBreak) { newPage(); continue; }
    if (b.rule) {
      y -= b.gap ?? 8;
      ensure(4);
      ops.push(`0.8 w ${MARGIN} ${y.toFixed(1)} m ${PAGE_W - MARGIN} ${y.toFixed(1)} l S`);
      y -= 6;
      continue;
    }
    if (b.image) {
      const dim = jpegSize(b.image);
      if (!dim) continue;
      const w = Math.min(b.width || 200, maxW);
      const h = (dim.height / dim.width) * w;
      y -= b.gap ?? 6;
      ensure(h);
      const n = images.push({ data: b.image, ...dim });
      ops.push(`q ${w.toFixed(1)} 0 0 ${h.toFixed(1)} ${MARGIN} ${(y - h).toFixed(1)} cm /Im${n} Do Q`);
      y -= h;
      continue;
    }
    const size = b.size || 10.5;
    const lead = size * 1.45;
    y -= b.gap ?? size * 0.5;
    if (b.keep) ensure(b.keep); // mantém junto com o que vem depois (ex.: título + assinatura)
    for (const line of wrapLine(b.text || '', size, b.bold, maxW)) {
      ensure(lead);
      const x = b.align === 'center' ? (PAGE_W - textWidth(line, size, b.bold)) / 2 : MARGIN;
      ops.push(`BT /${b.bold ? 'F2' : 'F1'} ${size} Tf 1 0 0 1 ${x.toFixed(1)} ${(y - size).toFixed(1)} Tm (${pdfStr(line)}) Tj ET`);
      y -= lead;
    }
  }
  pages.push(ops);

  // Objetos: 1 catálogo, 2 páginas, 3 e 4 fontes, imagens, e para cada página (página + conteúdo).
  const objs = [];
  const add = (body) => objs.push(body) && objs.length;
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(null); // páginas, preenchido depois
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const imgIds = images.map((im) => add({ head: `<< /Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.data.length} >>`, data: im.data }));
  const xobj = imgIds.length ? `/XObject << ${imgIds.map((id, i) => `/Im${i + 1} ${id} 0 R`).join(' ')} >>` : '';
  const pageIds = pages.map((pageOps, i) => {
    const foot = footer ? [`BT /F1 8 Tf 1 0 0 1 ${MARGIN} 30 Tm (${pdfStr(`${footer} - página ${i + 1} de ${pages.length}`)}) Tj ET`] : [];
    const stream = Buffer.from(['0 0 0 RG 0 0 0 rg', ...pageOps, ...foot].join('\n'), 'latin1');
    const content = add({ head: `<< /Length ${stream.length} >>`, data: stream });
    return add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> ${xobj} >> /Contents ${content} 0 R >>`);
  });
  objs[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  const parts = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  const offsets = [];
  let pos = parts[0].length;
  objs.forEach((obj, i) => {
    offsets.push(pos);
    const body = typeof obj === 'string'
      ? Buffer.from(`${i + 1} 0 obj\n${obj}\nendobj\n`, 'latin1')
      : Buffer.concat([Buffer.from(`${i + 1} 0 obj\n${obj.head}\nstream\n`, 'latin1'), obj.data, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
    parts.push(body);
    pos += body.length;
  });
  const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(parts);
}
