// Cadastros de aplicativos da Migra (hoje: Migra Devocional) chegando no Migra Hub para acompanhar quantos usuários há.
// O aplicativo manda cada cadastro para /api/integrations/devocional/users com uma chave própria
// (gerada no painel, mostrada uma vez só; aqui fica guardado só o resumo criptográfico dela).
// Guardamos o mínimo: nome, e-mail, telefone, plano e data. O painel mostra o e-mail e o telefone mascarados.
import crypto from 'node:crypto';

const err = (status, message) => Object.assign(new Error(message), { status });
const clean = (s, max = 120) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const DAY = 86_400_000;

export const APPS = { devocional: 'Migra Devocional' };

export const maskEmail = (e) => {
  const [u, d] = String(e || '').split('@');
  if (!d) return '';
  return `${u.slice(0, 2)}${'•'.repeat(Math.max(1, Math.min(6, u.length - 2)))}@${d}`;
};
export const maskPhone = (p) => {
  const x = String(p || '').replace(/\D/g, '');
  return x.length < 6 ? '' : `+${x.slice(0, 4)}•••${x.slice(-2)}`;
};

export class AppSignups {
  constructor({ store, now = () => new Date() }) {
    Object.assign(this, { store, now });
    store.data.appSignups ||= {};
  }

  #app(app) {
    if (!APPS[app]) throw err(404, 'Aplicativo não encontrado');
    return (this.store.data.appSignups[app] ||= { keyHash: '', keyHint: '', keyAt: '', users: [] });
  }

  /** Gera uma chave nova (a antiga deixa de valer). Devolve a chave só desta vez. */
  newKey(app, user) {
    const a = this.#app(app);
    const key = `mhub_${app}_${crypto.randomBytes(24).toString('base64url')}`;
    Object.assign(a, { keyHash: sha(key), keyHint: key.slice(-4), keyAt: this.now().toISOString(), keyBy: user?.name || '' });
    this.store.save();
    return key;
  }

  revokeKey(app) {
    const a = this.#app(app);
    Object.assign(a, { keyHash: '', keyHint: '', keyAt: '' });
    this.store.save();
  }

  /** Confere a chave enviada pelo aplicativo (comparação em tempo constante). */
  checkKey(app, key) {
    const a = this.store.data.appSignups[app];
    if (!APPS[app] || !a?.keyHash || !key) return false;
    const x = Buffer.from(sha(key)); const y = Buffer.from(a.keyHash);
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  }

  /**
   * Recebe um cadastro ({ id, name, email, phone, plan, createdAt }) ou vários ({ users: [...] }, até 500).
   * Mesmo id (ou e-mail, ou telefone) atualiza em vez de duplicar. { deleted: true } marca como saiu do app.
   */
  ingest(app, body = {}) {
    const a = this.#app(app);
    const list = Array.isArray(body.users) ? body.users : [body];
    if (list.length > 500) throw err(400, 'Mande no máximo 500 cadastros por vez');
    let added = 0; let updated = 0; let skipped = 0;
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') { skipped += 1; continue; }
      const extId = clean(raw.id ?? raw.userId ?? raw.uid, 80);
      const email = clean(raw.email, 120).toLowerCase();
      const phone = clean(raw.phone ?? raw.whatsapp, 30).replace(/[^\d+]/g, '');
      if (!extId && !email && !phone) { skipped += 1; continue; }
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { skipped += 1; continue; }
      const created = Date.parse(raw.createdAt ?? raw.created_at ?? '');
      const createdAt = Number.isFinite(created) && created <= this.now().getTime() + DAY ? new Date(created).toISOString() : this.now().toISOString();
      const hit = a.users.find((u) => (extId && u.extId === extId) || (email && u.email === email) || (phone && u.phone === phone));
      const data = { extId: extId || hit?.extId || '', name: clean(raw.name, 120) || hit?.name || '', email: email || hit?.email || '', phone: phone || hit?.phone || '', plan: clean(raw.plan, 40) || hit?.plan || '', active: raw.deleted !== true };
      if (hit) { Object.assign(hit, data, { updatedAt: this.now().toISOString() }); updated += 1; } else { a.users.push({ ...data, createdAt, receivedAt: this.now().toISOString() }); added += 1; }
    }
    a.lastAt = this.now().toISOString();
    this.store.save();
    return { added, updated, skipped, total: a.users.filter((u) => u.active).length };
  }

  /** Números para o painel: total, novos hoje/7/30 dias, por dia (30 dias), por plano e os últimos cadastros mascarados. */
  stats(app) {
    const a = this.#app(app);
    const now = this.now().getTime();
    const active = a.users.filter((u) => u.active);
    const since = (days) => active.filter((u) => now - Date.parse(u.createdAt) < days * DAY).length;
    const today = this.now().toISOString().slice(0, 10);
    const byDay = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now - i * DAY).toISOString().slice(0, 10);
      byDay.push({ day: d, count: active.filter((u) => u.createdAt.slice(0, 10) === d).length });
    }
    const byPlan = {};
    for (const u of active) byPlan[u.plan || 'sem plano'] = (byPlan[u.plan || 'sem plano'] || 0) + 1;
    return {
      app, name: APPS[app],
      connected: Boolean(a.keyHash), keyHint: a.keyHint, keyAt: a.keyAt, lastAt: a.lastAt || '',
      total: active.length, left: a.users.length - active.length,
      today: active.filter((u) => u.createdAt.slice(0, 10) === today).length, last7: since(7), last30: since(30),
      byDay, byPlan,
      recent: [...active].sort((x, y) => y.createdAt.localeCompare(x.createdAt)).slice(0, 25).map((u) => ({ name: u.name, email: maskEmail(u.email), phone: maskPhone(u.phone), plan: u.plan, createdAt: u.createdAt })),
    };
  }
}
