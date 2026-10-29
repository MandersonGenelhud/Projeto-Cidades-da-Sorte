// Pix "copia e cola" (BR Code, padrão EMV do Banco Central) e recibo em PDF,
// sem bibliotecas externas.

const field = (id, value) => `${id}${String(value.length).padStart(2, '0')}${value}`;

/** CRC16-CCITT (polinômio 0x1021, início 0xFFFF), exigido no final do BR Code. */
export function crc16(text) {
  let crc = 0xffff;
  for (const byte of Buffer.from(text, 'utf8')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Tira acentos e símbolos (o BR Code aceita só caracteres simples). */
const plain = (s, max) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 .,\-/@]/g, '').trim().slice(0, max);

/** Ajusta a chave Pix ao formato que os bancos aceitam. */
export function normalizePixKey(key) {
  const k = String(key || '').trim();
  if (!k) return '';
  if (k.includes('@')) return k.toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) return k.toLowerCase(); // chave aleatória
  const digits = k.replace(/\D/g, '');
  if (k.startsWith('+')) return `+${digits}`; // telefone com país
  if (digits.length === 11 && /^[1-9]{2}9/.test(digits) && !/^\d{3}\.\d{3}/.test(k)) return `+55${digits}`; // celular sem +55
  return digits; // CPF (11) ou CNPJ (14)
}

/**
 * Monta o Pix copia e cola. amount em reais (número). txid: até 25 letras/números.
 */
export function pixBrCode({ key, name, city, amount, txid = '***', description = '' }) {
  const pixKey = normalizePixKey(key);
  if (!pixKey) throw new Error('Cadastre a chave Pix em Configurações → Pagamentos');
  const account = field('00', 'br.gov.bcb.pix') + field('01', pixKey) + (description ? field('02', plain(description, 40)) : '');
  const tx = String(txid || '***').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';
  let payload = field('00', '01')
    + field('26', account)
    + field('52', '0000')
    + field('53', '986')
    + (amount ? field('54', Number(amount).toFixed(2)) : '')
    + field('58', 'BR')
    + field('59', plain(name, 25).toUpperCase() || 'RECEBEDOR')
    + field('60', plain(city, 15).toUpperCase() || 'CIDADE')
    + field('62', field('05', tx));
  payload += '6304';
  return payload + crc16(payload);
}

// ---------- Valor por extenso (recibo) ----------
const UNI = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZ = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CEN = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

function ate999(n) {
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100);
  const r = n % 100;
  const parts = [];
  if (c) parts.push(CEN[c]);
  if (r < 20) {
    if (r) parts.push(UNI[r]);
  } else {
    parts.push(DEZ[Math.floor(r / 10)] + (r % 10 ? ` e ${UNI[r % 10]}` : ''));
  }
  return parts.join(' e ');
}

/** 1800.5 → "mil e oitocentos reais e cinquenta centavos" */
export function valorPorExtenso(value) {
  const cents = Math.round(Number(value || 0) * 100);
  const reais = Math.floor(cents / 100);
  const cent = cents % 100;
  const blocks = [];
  const mi = Math.floor(reais / 1_000_000);
  const mil = Math.floor((reais % 1_000_000) / 1000);
  const resto = reais % 1000;
  if (mi) blocks.push(`${ate999(mi)} ${mi === 1 ? 'milhão' : 'milhões'}`);
  if (mil) blocks.push(mil === 1 ? 'mil' : `${ate999(mil)} mil`);
  if (resto) blocks.push(ate999(resto));
  let txt = '';
  blocks.forEach((b, i) => {
    if (i === 0) txt = b;
    else txt += (i === blocks.length - 1 && (resto < 100 || resto % 100 === 0) ? ' e ' : ', ') + b;
  });
  if (reais) txt += `${mi && !mil && !resto ? ' de' : ''} ${reais === 1 ? 'real' : 'reais'}`;
  if (cent) txt += `${reais ? ' e ' : ''}${ate999(cent)} ${cent === 1 ? 'centavo' : 'centavos'}`;
  return txt.trim() || 'zero reais';
}

// ---------- PDF simples (texto) ----------
const latin = (s) => String(s ?? '').replace(/[–—]/g, '-').replace(/[•·]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x20-\xFF\n]/g, '');
const pdfStr = (s) => latin(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** Quebra o texto em linhas de até `max` caracteres. */
function wrap(text, max) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      if ((line + ' ' + word).trim().length > max) {
        out.push(line);
        line = word;
      } else line = (line + ' ' + word).trim();
    }
    out.push(line);
  }
  return out;
}

/**
 * Gera um PDF A4 de uma página. items: [{ text, size, bold, gap, wrap }] de cima para baixo.
 * Devolve um Buffer.
 */
export function simplePdf(items) {
  const ops = ['BT'];
  let y = 790;
  for (const it of items) {
    const size = it.size || 11;
    y -= it.gap ?? size * 0.6;
    const lines = it.wrap ? wrap(it.text, Math.floor(it.wrap)) : String(it.text).split('\n');
    for (const line of lines) {
      ops.push(`/${it.bold ? 'F2' : 'F1'} ${size} Tf 1 0 0 1 ${it.x || 56} ${y.toFixed(1)} Tm (${pdfStr(line)}) Tj`);
      y -= size * 1.45;
    }
  }
  ops.push('ET');
  const stream = Buffer.from(ops.join('\n'), 'latin1');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    null, // conteúdo
  ];
  const parts = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  const offsets = [];
  let pos = parts[0].length;
  objects.forEach((obj, i) => {
    offsets.push(pos);
    const body = obj === null
      ? Buffer.concat([Buffer.from(`${i + 1} 0 obj\n<< /Length ${stream.length} >>\nstream\n`, 'latin1'), stream, Buffer.from('\nendstream\nendobj\n', 'latin1')])
      : Buffer.from(`${i + 1} 0 obj\n${obj}\nendobj\n`, 'latin1');
    parts.push(body);
    pos += body.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(parts);
}
