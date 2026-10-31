// Voz da Nina: clientes HTTP para o serviço de voz local (deploy/voz): faster-whisper entende o áudio
// e kokoro-onnx fala a resposta. Os dois rodam na própria VPS (nada de áudio vai para serviços de terceiros).
// Sem o serviço ligado (STT_URL / TTS_URL vazios), a Nina atende só por texto.

const withTimeout = async (fetchImpl, url, init, ms) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetchImpl(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
};

/** Áudio → texto (faster-whisper). */
export class HttpStt {
  constructor({ url, fetchImpl = globalThis.fetch, timeoutMs = 90_000 }) {
    Object.assign(this, { url: String(url || '').replace(/\/+$/, ''), fetchImpl, timeoutMs });
  }

  get ready() {
    return Boolean(this.url);
  }

  async transcribe(buffer, mimetype = 'audio/ogg') {
    const res = await withTimeout(this.fetchImpl, `${this.url}/transcribe?language=pt`, { method: 'POST', headers: { 'content-type': mimetype.split(';')[0] }, body: buffer }, this.timeoutMs);
    if (!res.ok) throw new Error(`Transcrição falhou (HTTP ${res.status})`);
    const data = await res.json();
    return String(data.text || '').trim();
  }
}

/** Texto → fala (kokoro-onnx), já em OGG/Opus para o WhatsApp tocar como mensagem de voz. */
export class HttpTts {
  constructor({ url, voice = 'pf_dora', fetchImpl = globalThis.fetch, timeoutMs = 60_000 }) {
    Object.assign(this, { url: String(url || '').replace(/\/+$/, ''), voice, fetchImpl, timeoutMs });
  }

  get ready() {
    return Boolean(this.url);
  }

  async speak(text, voice = this.voice) {
    const res = await withTimeout(this.fetchImpl, `${this.url}/speak`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, voice }) }, this.timeoutMs);
    if (!res.ok) throw new Error(`Voz falhou (HTTP ${res.status})`);
    return { buffer: Buffer.from(await res.arrayBuffer()), mimetype: 'audio/ogg; codecs=opus' };
  }
}

// ---------- Texto para falar: números, dinheiro e datas por extenso (a voz fica natural, não "robótica") ----------
const UN = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZ = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CEN = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
const below1000 = (n) => {
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100);
  const r = n % 100;
  const rest = r < 20 ? (r ? UN[r] : '') : `${DEZ[Math.floor(r / 10)]}${r % 10 ? ` e ${UN[r % 10]}` : ''}`;
  return [CEN[c], rest].filter(Boolean).join(' e ');
};
/** 1500 → "mil e quinhentos". Vai até os bilhões. */
export function numberToWords(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (n < 1000) return n === 0 ? 'zero' : below1000(n);
  const scales = [[1e9, 'bilhão', 'bilhões'], [1e6, 'milhão', 'milhões'], [1e3, 'mil', 'mil']];
  const parts = [];
  let left = n;
  for (const [v, one, many] of scales) {
    const q = Math.floor(left / v);
    left %= v;
    if (!q) continue;
    parts.push(v === 1e3 && q === 1 ? 'mil' : `${below1000(q)} ${q === 1 ? one : many}`);
  }
  if (left) parts.push(below1000(left));
  // "mil e quinhentos", "dois mil e cem"; entre milhares e centenas redondas ou dezenas usa "e".
  return parts.reduce((acc, p, i) => (i === 0 ? p : `${acc}${left && i === parts.length - 1 && (left < 100 || left % 100 === 0) ? ' e ' : ' '}${p}`), '');
}
const CUR_WORDS = { 'R$': ['real', 'reais', 'centavo', 'centavos'], 'US$': ['dólar', 'dólares', 'centavo', 'centavos'], 'Gs.': ['guarani', 'guaranis', 'centavo', 'centavos'] };
const MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
/** Prepara a resposta escrita para ser falada: "R$ 1.500,50" vira "mil e quinhentos reais e cinquenta centavos". */
export function speakable(text) {
  return String(text || '')
    .replace(/(R\$|US\$|Gs\.)\s*(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?/g, (_m, cur, whole, cents) => {
      const n = Number(whole.replace(/\./g, ''));
      const [one, many, cOne, cMany] = CUR_WORDS[cur];
      const main = `${numberToWords(n)} ${n === 1 ? one : many}`;
      const c = cents ? Number(cents.padEnd(2, '0')) : 0;
      return c ? `${main} e ${numberToWords(c)} ${c === 1 ? cOne : cMany}` : main;
    })
    .replace(/\b(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\b/g, (m, d, mo) => (Number(mo) >= 1 && Number(mo) <= 12 && Number(d) >= 1 && Number(d) <= 31 ? `${numberToWords(Number(d))} de ${MONTH_NAMES[Number(mo) - 1]}` : m))
    .replace(/\b(\d+)%/g, (_m, n) => `${numberToWords(Number(n))} por cento`)
    .replace(/\b\d{1,9}\b/g, (n) => numberToWords(Number(n)))
    .replace(/[•·]/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}
