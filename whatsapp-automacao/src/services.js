// Catálogo de serviços: cada serviço com preço base, prazo, comissão e categoria.
// Vem do sistema antigo (52 serviços) e o administrador edita no painel. O orçamento e os atalhos
// do WhatsApp aceitam qualquer serviço ativo do catálogo, além dos pacotes da base.
import crypto from 'node:crypto';

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const clip = (v, n) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, n);
const err = (status, message) => Object.assign(new Error(message), { status });
export const CATEGORIES = { migratorio: 'Migratório', empresarial: 'Empresarial', documentos: 'Documentos', contabil: 'Contábil', adicional: 'Adicional', outro: 'Outro' };
const catOf = (v) => {
  const f = fold(v);
  if (CATEGORIES[f]) return f;
  if (/empres|eas|s\.?a\.?|unipessoal|unipersonal/.test(f)) return 'empresarial';
  if (/contab|ruc|tribut/.test(f)) return 'contabil';
  if (/document|certid|apostil|tradu/.test(f)) return 'documentos';
  if (/adicional/.test(f)) return 'adicional';
  if (/migra|cedula|residen|admiss/.test(f)) return 'migratorio';
  return 'outro';
};
const num = (v, { min = 0, max = 1e9 } = {}) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) return undefined;
  return Math.round(n * 100) / 100;
};

export class ServiceCatalog {
  constructor({ store, now = () => new Date() }) {
    this.store = store; this.now = now;
    store.data.serviceCatalog ||= [];
  }
  get all() { return this.store.data.serviceCatalog; }
  get(id) { return this.all.find((s) => s.id === id) || null; }

  list({ q = '', category = '', active = '' } = {}) {
    const f = fold(q);
    return this.all
      .filter((s) => (!f || fold(`${s.name} ${s.description} ${s.category}`).includes(f)) && (!category || s.category === category) && (active === '' || String(s.active) === String(active)))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }

  #clean(b, base) {
    const s = { ...base };
    if (b.name !== undefined) { s.name = clip(b.name, 120); if (!s.name) throw err(400, 'Dê um nome ao serviço'); }
    if (b.description !== undefined) s.description = clip(b.description, 600);
    if (b.category !== undefined) s.category = catOf(b.category);
    for (const [k, opt] of [['price', { max: 1e8 }], ['durationDays', { max: 3650 }], ['commissionPct', { max: 100 }]]) {
      if (b[k] === undefined) continue;
      const n = num(b[k], opt);
      if (n === undefined) throw err(400, k === 'price' ? 'Preço inválido' : k === 'commissionPct' ? 'A comissão vai de 0 a 100%' : 'Prazo inválido (em dias)');
      s[k] = n;
    }
    if (b.currency !== undefined) s.currency = ['BRL', 'USD', 'PYG'].includes(b.currency) ? b.currency : 'BRL';
    if (b.active !== undefined) s.active = Boolean(b.active);
    return s;
  }

  add(user, b) {
    if (user.role !== 'admin') throw err(403, 'Só o administrador cadastra serviços');
    const s = this.#clean(b, { id: crypto.randomBytes(6).toString('hex'), name: '', description: '', category: 'outro', price: null, durationDays: null, commissionPct: null, currency: 'BRL', active: true, source: 'painel', createdAt: this.now().toISOString(), createdBy: user.name });
    if (!s.name) throw err(400, 'Dê um nome ao serviço');
    if (this.all.some((x) => fold(x.name) === fold(s.name))) throw err(400, 'Já existe um serviço com esse nome');
    this.all.push(s); this.store.save(); return s;
  }

  update(user, id, b) {
    if (user.role !== 'admin') throw err(403, 'Só o administrador altera serviços');
    const cur = this.get(id); if (!cur) throw err(404, 'Serviço não encontrado');
    const next = this.#clean(b, cur);
    if (fold(next.name) !== fold(cur.name) && this.all.some((x) => x.id !== id && fold(x.name) === fold(next.name))) throw err(400, 'Já existe um serviço com esse nome');
    Object.assign(cur, next, { updatedAt: this.now().toISOString(), updatedBy: user.name });
    this.store.save(); return cur;
  }

  /** Serviço ativo com preço, pelo nome (sem acento/maiúscula); usado pelo orçamento. */
  match(name) {
    const f = fold(name);
    if (!f) return null;
    const s = this.all.find((x) => x.active && x.price > 0 && fold(x.name) === f);
    return s ? { name: s.name, price: s.price, serviceId: s.id } : null;
  }

  /** Categoria do serviço com esse nome (ex.: 'contabil'), ou '' se não achar. */
  categoryOf(name) {
    const f = fold(name);
    if (!f) return '';
    return this.all.find((x) => fold(x.name) === f)?.category || '';
  }

  activeNames() { return this.all.filter((s) => s.active && s.price > 0).map((s) => ({ name: s.name, price: s.price })); }

  /** Lista "/api/services" da cópia do sistema antigo → catálogo (atualiza pelo id antigo ou pelo nome; não apaga nada). */
  importCapture(captura) {
    const rows = [];
    for (const a of captura?.api || []) {
      let p; try { p = new URL(a.url, 'http://x').pathname.replace(/\/+$/, ''); } catch { continue; }
      if (p === '/api/services' && Array.isArray(a.json?.data)) rows.push(...a.json.data);
    }
    let added = 0; let updated = 0;
    for (const r of rows) {
      if (!r?.name) continue;
      const cur = this.all.find((x) => (r.id && x.legacyId === r.id) || fold(x.name) === fold(r.name));
      const data = { name: clip(r.name, 120), description: clip(r.description, 600), category: catOf(r.category || r.name), price: num(r.base_price) ?? null, durationDays: num(r.duration_days) ?? null, commissionPct: num(r.commission_rate) ?? null, active: r.is_active !== false };
      if (cur) {
        // O que o administrador já editou aqui vale mais: só completa o que está vazio.
        if (cur.source === 'sistema antigo' && !cur.updatedBy) Object.assign(cur, data);
        else for (const [k, v] of Object.entries(data)) if ((cur[k] === null || cur[k] === '' || cur[k] === undefined) && v !== null) cur[k] = v;
        cur.legacyId ||= r.id || null; updated += 1;
      } else {
        this.all.push({ id: crypto.randomBytes(6).toString('hex'), ...data, currency: 'BRL', source: 'sistema antigo', legacyId: r.id || null, createdAt: this.now().toISOString(), createdBy: 'Cópia do sistema antigo' });
        added += 1;
      }
    }
    if (added || updated) this.store.save();
    return { added, updated, total: rows.length };
  }
}
