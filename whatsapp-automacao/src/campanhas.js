// Controle de campanhas de marketing: quantas pessoas vieram falar da oferta/promoção, de qual arte ou legenda (variante A, B…) e quantas fecharam.
// O link da legenda leva um código discreto na frase pronta ("ref IDI-A"), e palavras como "oferta relâmpago" ou "curso de idiomas" também contam.
// Cada pessoa conta UMA vez por campanha. Tudo é só leitura/contagem: nada é enviado a ninguém. Serve para decidir o que continuar, pausar ou testar de novo.
import crypto from 'node:crypto';

const DEFAULT = {
  id: 'idiomas-nov2026', name: 'Oferta relâmpago: curso de idiomas (12 meses)', code: 'IDI', variants: ['A', 'B'], status: 'ativa',
  keywords: ['oferta relâmpago', 'oferta relampago', 'curso de idiomas', 'migra school', '12 meses', 'um ano de curso', '1 ano de curso', 'bônus', 'bonus', 'brinde', 'promoção', 'promocao'],
  startsAt: '2026-11-09', endsAt: '2026-11-12',
};
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const clip = (s, n = 160) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export class Campaigns {
  constructor({ store, now = () => Date.now() }) {
    Object.assign(this, { store, now });
    store.data.mkt ||= { campaigns: [], hits: [] };
    if (!store.data.mkt.campaigns.length) { store.data.mkt.campaigns.push({ ...DEFAULT, createdAt: new Date(now()).toISOString() }); store.save?.(); }
  }

  get list() { return this.store.data.mkt.campaigns; }

  get hits() { return this.store.data.mkt.hits; }

  get(id) { const c = this.list.find((x) => x.id === id); if (!c) throw Object.assign(new Error('Campanha não encontrada'), { status: 404 }); return c; }

  create({ name, code, variants = [], keywords = [], startsAt = '', endsAt = '' }) {
    const nm = clip(name, 80); if (!nm) throw Object.assign(new Error('Dê um nome à campanha'), { status: 400 });
    const cd = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || crypto.randomBytes(2).toString('hex').toUpperCase();
    if (this.list.some((c) => c.code === cd)) throw Object.assign(new Error('Já existe uma campanha com este código'), { status: 400 });
    const c = { id: `${fold(nm).replace(/[^a-z0-9]+/g, '-').slice(0, 30)}-${crypto.randomBytes(2).toString('hex')}`, name: nm, code: cd, variants: [...new Set((variants || []).map((v) => String(v).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)).filter(Boolean))], keywords: (keywords || []).map((k) => clip(k, 60)).filter(Boolean), status: 'ativa', startsAt: /^\d{4}-\d{2}-\d{2}$/.test(startsAt) ? startsAt : new Date(this.now()).toISOString().slice(0, 10), endsAt: /^\d{4}-\d{2}-\d{2}$/.test(endsAt) ? endsAt : '', createdAt: new Date(this.now()).toISOString() };
    this.list.push(c); this.store.save(); return c;
  }

  setStatus(id, status, note = '') {
    const c = this.get(id);
    if (!['ativa', 'pausada', 'encerrada'].includes(status)) throw Object.assign(new Error('Situação inválida'), { status: 400 });
    c.status = status; (c.log ||= []).push({ at: new Date(this.now()).toISOString(), status, note: clip(note, 200) }); this.store.save(); return c;
  }

  /** Texto do link: frase pronta com o código da variante. */
  refText(c, variant = '') { return `Oi! Vi a oferta relâmpago no grupo e quero garantir o meu brinde.${variant ? ` (ref ${c.code}-${String(variant).toUpperCase()})` : ` (ref ${c.code})`}`; }

  /** A mensagem é desta campanha? Devolve { via: 'link'|'palavra', variant } ou null. */
  match(c, text) {
    const t = fold(text);
    const m = new RegExp(`\\bref ${c.code.toLowerCase()}(?:-([a-z0-9]{1,4}))?\\b`).exec(t);
    if (m) return { via: 'link', variant: (m[1] || '').toUpperCase() };
    if ((c.keywords || []).some((k) => t.includes(fold(k)))) return { via: 'palavra', variant: '' };
    return null;
  }

  #active(c, at) {
    if (c.status !== 'ativa') return false;
    const day = new Date(at).toISOString().slice(0, 10);
    return (!c.startsAt || day >= c.startsAt) && (!c.endsAt || day <= c.endsAt);
  }

  /** Uma mensagem de cliente chegou. Registra a pessoa (uma vez por campanha). Devolve { hit, created } ou null. */
  observe({ convKey, text, name = '', phone = '', at = this.now(), force = false }) {
    if (!convKey || String(convKey).includes('@g.us') || String(convKey).startsWith('sim:')) return null;
    for (const c of this.list) {
      if (!force && !this.#active(c, at)) continue;
      const m = this.match(c, text);
      if (!m) continue;
      let hit = this.hits.find((h) => h.campaignId === c.id && h.convKey === convKey);
      if (hit) { if (m.via === 'link' && hit.via !== 'link') Object.assign(hit, { via: 'link', variant: m.variant || hit.variant }); return { hit, created: false }; }
      hit = { id: crypto.randomBytes(5).toString('hex'), campaignId: c.id, variant: m.variant, via: m.via, convKey, name: clip(name, 100), phone: String(phone || '').replace(/\D/g, ''), at: new Date(at).toISOString(), first: clip(text) };
      this.hits.push(hit); this.store.save();
      return { hit, created: true, campaign: c };
    }
    return null;
  }

  /** Procura nas conversas já guardadas quem falou da campanha (para pegar quem já chegou antes da contagem). */
  scan(c, conversations, { days = 7 } = {}) {
    const since = this.now() - days * 86_400_000; let found = 0;
    for (const conv of Object.values(conversations || {})) {
      if (!conv?.key || conv.simulation) continue;
      const msg = (conv.messages || []).find((m) => m.role === 'user' && (Date.parse(m.at) || 0) >= since && this.match(c, m.content));
      if (!msg) continue;
      const r = this.observe({ convKey: conv.key, text: msg.content, name: conv.name, phone: conv.phone, at: Date.parse(msg.at) || this.now(), force: true });
      if (r?.created && r.hit.campaignId === c.id) found += 1;
    }
    return found;
  }
}
