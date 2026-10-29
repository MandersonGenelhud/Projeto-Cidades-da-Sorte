// Migra Imóveis: imóveis avulsos (casas, terrenos, galpões…) e loteamentos com
// o mapa dos lotes. Cada lote é um polígono desenhado sobre a planta, com as
// coordenadas em % da imagem (funciona em qualquer tamanho de tela).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// loteadora: lote guardado pela própria loteadora (cinza no mapa, fora da venda).
export const LOT_STATUS = ['disponivel', 'reservado', 'vendido', 'loteadora'];
export const PROPERTY_STATUS = ['disponivel', 'reservado', 'vendido', 'alugado'];
export const PROPERTY_TYPES = { terreno: 'Terreno', lote: 'Lote', casa: 'Casa', departamento: 'Apartamento', galpao: 'Galpão', fazenda: 'Fazenda / chácara', local: 'Ponto comercial' };

const err = (status, message) => Object.assign(new Error(message), { status });
const newId = () => crypto.randomBytes(6).toString('hex');
export function slugify(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || newId();
}
/** Número digitado no padrão brasileiro ("1.080", "12.997,50") ou já numérico. */
const num = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  return Number(String(v).replace(/\./g, '').replace(',', '.')) || 0;
};
const clamp = (v) => Math.min(100, Math.max(0, Number(v) || 0));

export class Realty {
  constructor({ store, dataDir }) {
    this.store = store;
    this.dir = path.join(dataDir, 'realty');
    fs.mkdirSync(this.dir, { recursive: true });
    store.data.realty ||= { properties: [], developments: [] };
    // Primeira vez: traz os anúncios públicos do site antigo da imobiliária.
    if (!store.data.realty.seeded) {
      const seedFile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'realty-seed.json');
      if (fs.existsSync(seedFile)) {
        for (const p of JSON.parse(fs.readFileSync(seedFile, 'utf8'))) this.#addProperty(p);
      }
      store.data.realty.seeded = true;
      store.save();
    }
  }

  get data() {
    return this.store.data.realty;
  }

  #uniqueSlug(list, base, id) {
    let slug = slugify(base);
    let i = 2;
    while (list.some((x) => x.slug === slug && x.id !== id)) slug = `${slugify(base)}-${i++}`;
    return slug;
  }

  // ---------- Imóveis avulsos ----------
  #addProperty(input) {
    const p = { id: newId(), createdAt: new Date().toISOString(), images: [], ...input };
    p.slug = this.#uniqueSlug(this.data.properties, input.slug || input.title, p.id);
    this.data.properties.push(p);
    return p;
  }

  listProperties({ publicOnly = false } = {}) {
    const list = [...this.data.properties].sort((a, b) => Number(b.featured || 0) - Number(a.featured || 0) || String(b.createdAt).localeCompare(String(a.createdAt)));
    return publicOnly ? list.filter((p) => !p.hidden) : list;
  }

  property(idOrSlug) {
    return this.data.properties.find((p) => p.id === idOrSlug || p.slug === idOrSlug) || null;
  }

  saveProperty(id, input) {
    const fields = ['title', 'type', 'deal', 'status', 'city', 'neighborhood', 'address', 'areaText', 'currency', 'description', 'agentName', 'agentWhatsapp', 'mapsUrl'];
    const clean = {};
    for (const f of fields) if (input[f] !== undefined) clean[f] = String(input[f]).trim();
    if (clean.status && !PROPERTY_STATUS.includes(clean.status)) throw err(400, 'Situação inválida');
    if (input.price !== undefined) clean.price = num(input.price);
    for (const f of ['bedrooms', 'bathrooms']) if (input[f] !== undefined) clean[f] = num(input[f]) || 0;
    for (const f of ['perMonth', 'featured', 'hidden']) if (input[f] !== undefined) clean[f] = Boolean(input[f]);
    if (input.images !== undefined) clean.images = (Array.isArray(input.images) ? input.images : String(input.images).split('\n')).map((s) => String(s).trim()).filter(Boolean);
    if (clean.agentWhatsapp) clean.agentWhatsapp = clean.agentWhatsapp.replace(/\D/g, '');
    let p;
    if (!id) {
      if (!clean.title) throw err(400, 'Informe o título do imóvel');
      p = this.#addProperty({ type: 'terreno', deal: 'venda', status: 'disponivel', currency: 'USD', ...clean });
    } else {
      p = this.property(id);
      if (!p) throw err(404, 'Imóvel não encontrado');
      Object.assign(p, clean);
      if (clean.title) p.slug = this.#uniqueSlug(this.data.properties, clean.title, p.id);
      p.updatedAt = new Date().toISOString();
    }
    this.store.save();
    return p;
  }

  removeProperty(id) {
    this.data.properties = this.data.properties.filter((p) => p.id !== id);
    this.store.save();
  }

  /** Foto enviada pelo painel (fica em data/realty). Devolve o endereço público. */
  saveImage(buffer, ext) {
    const name = `${newId()}${ext}`;
    fs.writeFileSync(path.join(this.dir, name), buffer);
    return `/imoveis/fotos/${name}`;
  }

  imagePath(name) {
    const file = path.join(this.dir, path.basename(name));
    return fs.existsSync(file) ? file : null;
  }

  // ---------- Loteamentos ----------
  listDevelopments() {
    return this.data.developments.map((d) => ({ ...d, summary: this.summary(d) }));
  }

  development(idOrSlug) {
    return this.data.developments.find((d) => d.id === idOrSlug || d.slug === idOrSlug) || null;
  }

  summary(d) {
    const s = { total: d.lots.length, disponivel: 0, reservado: 0, vendido: 0, loteadora: 0, minPrice: null };
    for (const l of d.lots) {
      s[l.status] = (s[l.status] || 0) + 1;
      if (l.status === 'disponivel' && l.price && (s.minPrice === null || l.price < s.minPrice)) s.minPrice = l.price;
    }
    return s;
  }

  saveDevelopment(id, input) {
    const fields = ['name', 'city', 'description', 'address', 'currency', 'mapsUrl', 'agentName', 'agentWhatsapp'];
    const clean = {};
    for (const f of fields) if (input[f] !== undefined) clean[f] = String(input[f]).trim();
    if (clean.agentWhatsapp) clean.agentWhatsapp = clean.agentWhatsapp.replace(/\D/g, '');
    if (input.hidden !== undefined) clean.hidden = Boolean(input.hidden);
    let d;
    if (!id) {
      if (!clean.name) throw err(400, 'Informe o nome do loteamento');
      d = { id: newId(), currency: 'USD', lots: [], createdAt: new Date().toISOString(), ...clean };
      d.slug = this.#uniqueSlug(this.data.developments, clean.name, d.id);
      this.data.developments.push(d);
    } else {
      d = this.development(id);
      if (!d) throw err(404, 'Loteamento não encontrado');
      Object.assign(d, clean);
      if (clean.name) d.slug = this.#uniqueSlug(this.data.developments, clean.name, d.id);
    }
    this.store.save();
    return d;
  }

  removeDevelopment(id) {
    const d = this.development(id);
    if (d?.plan) fs.rmSync(path.join(this.dir, path.basename(d.plan)), { force: true });
    this.data.developments = this.data.developments.filter((x) => x.id !== id);
    this.store.save();
  }

  /** Planta do loteamento (imagem). */
  setPlan(id, buffer, ext, { width, height } = {}) {
    const d = this.development(id);
    if (!d) throw err(404, 'Loteamento não encontrado');
    if (d.plan) fs.rmSync(path.join(this.dir, path.basename(d.plan)), { force: true });
    d.plan = this.saveImage(buffer, ext);
    if (width && height) d.planRatio = Number(width) / Number(height);
    this.store.save();
    return d;
  }

  #lot(d, input, existing = {}) {
    const lot = { ...existing };
    if (input.block !== undefined) lot.block = String(input.block).trim();
    if (input.number !== undefined) lot.number = String(input.number).trim();
    if (input.code !== undefined) lot.code = String(input.code).trim();
    if (!lot.code) lot.code = [lot.block && `Q${lot.block}`, lot.number && `L${lot.number}`].filter(Boolean).join('-') || `Lote ${d.lots.length + 1}`;
    if (input.area !== undefined) lot.area = num(input.area);
    if (input.price !== undefined) lot.price = num(input.price);
    if (input.status !== undefined) {
      if (!LOT_STATUS.includes(input.status)) throw err(400, 'Situação do lote inválida');
      lot.status = input.status;
    }
    lot.status ||= 'disponivel';
    if (input.note !== undefined) lot.note = String(input.note).trim();
    if (input.shape !== undefined) {
      if (!Array.isArray(input.shape) || input.shape.length < 3) throw err(400, 'O lote precisa de pelo menos 3 pontos');
      lot.shape = input.shape.map(([x, y]) => [Math.round(clamp(x) * 100) / 100, Math.round(clamp(y) * 100) / 100]);
    }
    return lot;
  }

  addLot(devId, input) {
    const d = this.development(devId);
    if (!d) throw err(404, 'Loteamento não encontrado');
    const lot = this.#lot(d, input, { id: newId() });
    if (!lot.shape) throw err(400, 'Desenhe o lote na planta');
    d.lots.push(lot);
    this.store.save();
    return lot;
  }

  /** Vários lotes de uma vez (quadra desenhada pelos lados, inclusive curvas). */
  addLots(devId, list) {
    const d = this.development(devId);
    if (!d) throw err(404, 'Loteamento não encontrado');
    if (!Array.isArray(list) || !list.length) throw err(400, 'Nenhum lote para criar');
    if (list.length > 400) throw err(400, 'No máximo 400 lotes por vez');
    const created = list.map((input) => {
      const lot = this.#lot(d, input, { id: newId() });
      if (!lot.shape) throw err(400, 'Lote sem desenho');
      return lot;
    });
    d.lots.push(...created);
    this.store.save();
    return created;
  }

  updateLot(devId, lotId, input) {
    const d = this.development(devId);
    const i = d?.lots.findIndex((l) => l.id === lotId) ?? -1;
    if (i < 0) throw err(404, 'Lote não encontrado');
    d.lots[i] = this.#lot(d, input, d.lots[i]);
    d.lots[i].updatedAt = new Date().toISOString();
    this.store.save();
    return d.lots[i];
  }

  removeLot(devId, lotId) {
    const d = this.development(devId);
    if (!d) throw err(404, 'Loteamento não encontrado');
    d.lots = d.lots.filter((l) => l.id !== lotId);
    this.store.save();
  }

  /**
   * Gera uma quadra inteira em grade dentro de um retângulo da planta
   * (x, y, w, h em %). Útil para loteamentos com lotes iguais.
   */
  generateBlock(devId, { block, rows, cols, x, y, w, h, start = 1, area, price, gap = 0.3 }) {
    const d = this.development(devId);
    if (!d) throw err(404, 'Loteamento não encontrado');
    const R = Math.max(1, Math.min(40, Number(rows) || 1));
    const C = Math.max(1, Math.min(40, Number(cols) || 1));
    const cw = Number(w) / C;
    const ch = Number(h) / R;
    const created = [];
    let n = Number(start) || 1;
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const x0 = Number(x) + c * cw + gap / 2;
        const y0 = Number(y) + r * ch + gap / 2;
        const x1 = Number(x) + (c + 1) * cw - gap / 2;
        const y1 = Number(y) + (r + 1) * ch - gap / 2;
        const lot = this.#lot(d, { block, number: String(n++), area, price, shape: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] }, { id: newId() });
        d.lots.push(lot);
        created.push(lot);
      }
    }
    this.store.save();
    return created;
  }

  publicDevelopment(d) {
    return {
      id: d.id, slug: d.slug, name: d.name, city: d.city, address: d.address, description: d.description, currency: d.currency,
      plan: d.plan, planRatio: d.planRatio, mapsUrl: d.mapsUrl, agentName: d.agentName, agentWhatsapp: d.agentWhatsapp,
      summary: this.summary(d),
      lots: d.lots.map(({ id, code, block, number, area, price, status, shape }) => ({ id, code, block, number, area, price: status === 'vendido' || status === 'loteadora' ? null : price, status, shape })),
    };
  }
}
