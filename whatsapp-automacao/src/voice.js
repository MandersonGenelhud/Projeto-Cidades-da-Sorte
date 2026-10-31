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
