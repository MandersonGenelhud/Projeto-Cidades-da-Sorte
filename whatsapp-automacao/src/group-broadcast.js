// Envio da MESMA postagem (texto + imagem ou vídeo) para vários grupos do WhatsApp, UM DE CADA VEZ, com pausa aleatória entre eles.
// Regras de proteção do número (WhatsApp não oficial): intervalo mínimo entre grupos, só em horário comercial, limite por dia, nunca ao mesmo tempo
// que a IA está respondendo um cliente nesse número (espera a IA ficar livre) e, durante o envio de cada grupo, a IA espera alguns segundos.
// Cada grupo recebe uma vez só por envio. Falha em um grupo não derruba os outros. Nada é enviado sem o administrador clicar em Iniciar.
import crypto from 'node:crypto';

const MIN_GAP = 45; // segundos: nunca menos que isso entre um grupo e outro
const DAY = 86_400_000;

export class GroupBroadcasts {
  /** deps: store, wa (send), resolveMedia(mediaId), isBusy() → a IA está atendendo agora?, setHold(bool) avisa a IA que um envio está acontecendo, now, wait(ms) interrompível. */
  constructor({ store, wa, resolveMedia = () => null, isBusy = () => false, setHold = () => {}, now = () => Date.now(), wait = null, log = () => {} }) {
    Object.assign(this, { store, wa, resolveMedia, isBusy, setHold, now, log });
    store.data.groupBroadcasts ||= [];
    this.wakeUp = null;
    this.wait = wait || ((ms) => new Promise((resolve) => { const t = setTimeout(resolve, ms); t.unref?.(); this.wakeUp = () => { clearTimeout(t); resolve(); }; }));
    // Depois de reiniciar o sistema, nada continua sozinho: quem estava enviando fica pausado até o administrador clicar em Continuar.
    for (const b of this.list) if (b.status === 'running') b.status = 'paused';
  }

  get list() { return this.store.data.groupBroadcasts; }

  get cfg() { return { from: 8, to: 21, maxPerDay: 60, ...(this.store.settings.groupBroadcast || {}) }; }

  get(id) { const b = this.list.find((x) => x.id === id); if (!b) throw Object.assign(new Error('Envio não encontrado'), { status: 404 }); return b; }

  summary(b) {
    const c = { pending: 0, sent: 0, failed: 0, skipped: 0 };
    for (const i of b.items) c[i.status] += 1;
    return { id: b.id, name: b.name, status: b.status, text: b.text, media: b.media ? { fileName: b.media.fileName, mimetype: b.media.mimetype } : null, counts: c, total: b.items.length, delayMin: b.delayMin, delayMax: b.delayMax, createdAt: b.createdAt, startedAt: b.startedAt || null, finishedAt: b.finishedAt || null, items: b.items.map((i) => ({ groupId: i.groupId, name: i.name, status: i.status, at: i.at || null, error: i.error || '' })), waiting: b.waiting || '' };
  }

  create({ name = '', text = '', mediaId = '', groups = [], delayMin = 90, delayMax = 240 }) {
    const items = [...new Map((groups || []).filter((g) => g?.id && String(g.id).endsWith('@g.us')).map((g) => [g.id, g])).values()].map((g) => ({ groupId: g.id, name: String(g.name || '').slice(0, 120), status: 'pending' }));
    if (!items.length) throw Object.assign(new Error('Escolha pelo menos um grupo'), { status: 400 });
    const t = String(text || '').trim();
    const media = mediaId ? this.resolveMedia(mediaId) : null;
    if (!t && !media) throw Object.assign(new Error('Escreva o texto ou escolha uma imagem ou vídeo'), { status: 400 });
    if (media && !/^(image|video)\//.test(String(media.mimetype || ''))) throw Object.assign(new Error('Só imagem ou vídeo (a legenda é o texto)'), { status: 400 });
    const dMin = Math.max(MIN_GAP, Math.round(Number(delayMin)) || 90);
    const dMax = Math.max(dMin, Math.round(Number(delayMax)) || dMin + 60);
    const b = { id: crypto.randomBytes(5).toString('hex'), name: String(name || `Envio ${this.list.length + 1}`).slice(0, 80), text: t.slice(0, 3500), media, items, delayMin: dMin, delayMax: dMax, status: 'draft', createdAt: new Date(this.now()).toISOString() };
    this.list.push(b);
    this.store.save();
    return b;
  }

  start(id) {
    const b = this.get(id);
    if (!['draft', 'paused'].includes(b.status)) throw Object.assign(new Error('Este envio já terminou ou foi cancelado'), { status: 400 });
    if (this.list.some((x) => x.status === 'running' && x.id !== id)) throw Object.assign(new Error('Já existe um envio em andamento. Pause ou espere terminar.'), { status: 400 });
    b.status = 'running'; b.startedAt ||= new Date(this.now()).toISOString();
    this.store.save();
    this.#run(b).catch((e) => this.log({ type: 'error', message: `Envio aos grupos: ${e.message}` }));
    return b;
  }

  pause(id) { const b = this.get(id); if (b.status === 'running') { b.status = 'paused'; this.store.save(); this.wakeUp?.(); } return b; }

  cancel(id) { const b = this.get(id); if (!['done', 'canceled'].includes(b.status)) { b.status = 'canceled'; b.finishedAt = new Date(this.now()).toISOString(); for (const i of b.items) if (i.status === 'pending') i.status = 'skipped'; this.store.save(); this.wakeUp?.(); } return b; }

  remove(id) { const b = this.get(id); if (b.status === 'running') throw Object.assign(new Error('Pause antes de apagar'), { status: 400 }); this.store.data.groupBroadcasts = this.list.filter((x) => x.id !== id); this.store.save(); }

  #sentToday() { const t = this.now(); let n = 0; for (const b of this.list) for (const i of b.items) if (i.status === 'sent' && t - Date.parse(i.at) < DAY) n += 1; return n; }

  #inHours() { const h = new Date(this.now()).getHours(); const { from, to } = this.cfg; return h >= from && h < to; }

  async #run(b) {
    try {
      while (b.status === 'running') {
        const item = b.items.find((i) => i.status === 'pending');
        if (!item) break;
        // Condições para enviar agora; se alguma falhar, espera e confere de novo (pausar/cancelar acorda na hora).
        const hold = this.#why(b);
        if (hold) { b.waiting = hold.text; this.store.save(); await this.wait(hold.ms); continue; }
        b.waiting = '';
        this.setHold(true);
        try {
          await this.wa.send(item.groupId, { text: b.text, media: b.media ? { path: b.media.path, mimetype: b.media.mimetype, fileName: b.media.fileName } : null, typing: false });
          Object.assign(item, { status: 'sent', at: new Date(this.now()).toISOString() });
          this.log({ type: 'sent', message: `Envio aos grupos: "${b.name}" enviado para ${item.name || item.groupId}` });
        } catch (e) {
          Object.assign(item, { status: 'failed', at: new Date(this.now()).toISOString(), error: String(e.message || e).slice(0, 200) });
          this.log({ type: 'error', message: `Envio aos grupos: falhou em ${item.name || item.groupId}: ${e.message}` });
        } finally { this.setHold(false); }
        this.store.save();
        if (!b.items.some((i) => i.status === 'pending')) break;
        if (b.status !== 'running') break;
        const gap = b.delayMin + Math.random() * (b.delayMax - b.delayMin);
        b.waiting = `intervalo de segurança antes do próximo grupo (${Math.round(gap)} s)`;
        this.store.save();
        await this.wait(process.env.NODE_TEST_CONTEXT ? 0 : gap * 1000);
      }
      if (b.status === 'running') { b.status = 'done'; b.finishedAt = new Date(this.now()).toISOString(); }
    } finally { b.waiting = ''; this.setHold(false); this.store.save(); }
  }

  /** Por que NÃO enviar agora (ou null). */
  #why() {
    if (this.wa.status && this.wa.status !== 'connected') return { text: 'WhatsApp desconectado: reconecte para continuar', ms: process.env.NODE_TEST_CONTEXT ? 0 : 30_000 };
    if (!this.#inHours()) return { text: `fora do horário (envia das ${this.cfg.from}h às ${this.cfg.to}h)`, ms: process.env.NODE_TEST_CONTEXT ? 0 : 60_000 };
    if (this.#sentToday() >= this.cfg.maxPerDay) return { text: `limite de ${this.cfg.maxPerDay} grupos por dia atingido; continua amanhã`, ms: process.env.NODE_TEST_CONTEXT ? 0 : 5 * 60_000 };
    if (this.isBusy()) return { text: 'a IA está atendendo um cliente neste número; envia assim que ela ficar livre', ms: process.env.NODE_TEST_CONTEXT ? 0 : 5_000 };
    return null;
  }
}
