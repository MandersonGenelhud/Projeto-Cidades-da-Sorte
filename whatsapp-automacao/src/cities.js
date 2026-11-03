// Guia de Cidades: números e endereços úteis de cada cidade do Paraguai para o cliente que está chegando.
// Nada aqui é inventado: o sistema traz as cidades e uma lista de emergência nacional marcada "a conferir"; o resto o administrador cadastra
// (um por um ou colando uma planilha). O vendedor envia o guia da cidade ao cliente com um clique, depois de ver o texto.
import crypto from 'node:crypto';

export const CATEGORIES = ['Emergência', 'Saúde', 'Escolas', 'Mercados', 'Delivery e restaurantes', 'Transporte', 'Bancos e câmbio', 'Governo e documentos', 'Outros'];

// Principais cidades por departamento (só os nomes).
const SEED_CITIES = [
  ['Asunción', 'Capital'], ['San Lorenzo', 'Central'], ['Luque', 'Central'], ['Lambaré', 'Central'], ['Fernando de la Mora', 'Central'], ['Capiatá', 'Central'], ['Ñemby', 'Central'],
  ['Mariano Roque Alonso', 'Central'], ['Limpio', 'Central'], ['Areguá', 'Central'], ['Itauguá', 'Central'], ['San Antonio', 'Central'],
  ['Ciudad del Este', 'Alto Paraná'], ['Presidente Franco', 'Alto Paraná'], ['Hernandarias', 'Alto Paraná'], ['Minga Guazú', 'Alto Paraná'], ['Santa Rita', 'Alto Paraná'], ['Naranjal', 'Alto Paraná'], ['San Alberto', 'Alto Paraná'], ['Los Cedrales', 'Alto Paraná'], ['Juan León Mallorquín', 'Alto Paraná'],
  ['Encarnación', 'Itapúa'], ['Cambyretá', 'Itapúa'], ['Hohenau', 'Itapúa'], ['Obligado', 'Itapúa'], ['Bella Vista', 'Itapúa'], ['Natalio', 'Itapúa'],
  ['Pedro Juan Caballero', 'Amambay'], ['Salto del Guairá', 'Canindeyú'], ['Curuguaty', 'Canindeyú'], ['Villarrica', 'Guairá'], ['Coronel Oviedo', 'Caaguazú'], ['Caaguazú', 'Caaguazú'],
  ['Caacupé', 'Cordillera'], ['San Bernardino', 'Cordillera'], ['Concepción', 'Concepción'], ['Pilar', 'Ñeembucú'], ['San Pedro del Ykuamandyyú', 'San Pedro'], ['Villa Hayes', 'Presidente Hayes'],
  ['Filadelfia', 'Boquerón'], ['Loma Plata', 'Boquerón'], ['Caazapá', 'Caazapá'], ['San Juan Bautista', 'Misiones'], ['Paraguarí', 'Paraguarí'], ['Mariscal Estigarribia', 'Boquerón'],
];
const NATIONAL = { name: 'Paraguai (nacional)', department: 'Nacional', national: true };
const NATIONAL_ITEMS = [
  ['Emergência', 'Polícia Nacional (emergências)', '911'],
  ['Emergência', 'Bombeiros Voluntários', '132'],
  ['Emergência', 'SAME (ambulância)', '141'],
];

const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

export class Cities {
  constructor({ store, now = () => new Date() }) {
    this.store = store; this.now = now;
    store.data.cityGuide ||= { cities: [], sent: [], seeded: false };
    this.#seed();
  }
  get data() { return this.store.data.cityGuide; }
  get cities() { return this.data.cities; }
  #seed() {
    if (this.data.seeded) return;
    const mk = (c) => ({ id: crypto.randomBytes(5).toString('hex'), name: c.name, department: c.department, national: Boolean(c.national), items: [], createdAt: this.now().toISOString() });
    const nat = mk(NATIONAL);
    for (const [category, name, phone] of NATIONAL_ITEMS) nat.items.push({ id: crypto.randomBytes(4).toString('hex'), category, name, phone, address: '', notes: '', verified: false });
    this.cities.push(nat);
    for (const [name, department] of SEED_CITIES) this.cities.push(mk({ name, department }));
    this.data.seeded = true; this.store.save();
  }
  nationalCity() { return this.cities.find((c) => c.national) || null; }
  list(q = '') {
    const n = norm(q);
    return this.cities.filter((c) => !n || norm(`${c.name} ${c.department}`).includes(n)).sort((a, b) => (b.national ? 1 : 0) - (a.national ? 1 : 0) || a.name.localeCompare(b.name, 'pt'))
      .map((c) => ({ id: c.id, name: c.name, department: c.department, national: c.national, items: c.items.length }));
  }
  get(id) { return this.cities.find((c) => c.id === id) || null; }
  #item(b, base = {}) {
    const it = { ...base };
    if (b.category !== undefined) { const c = String(b.category || '').trim(); it.category = CATEGORIES.includes(c) ? c : 'Outros'; }
    if (b.name !== undefined) it.name = clip(b.name, 120);
    if (b.phone !== undefined) it.phone = clip(b.phone, 40);
    if (b.address !== undefined) it.address = clip(b.address, 200);
    if (b.notes !== undefined) it.notes = clip(b.notes, 200);
    if (b.verified !== undefined) it.verified = Boolean(b.verified);
    if (!it.name) throw new Error('Dê um nome (ex.: Hospital Regional)');
    if (!it.phone && !it.address) throw new Error('Informe pelo menos o telefone ou o endereço');
    return it;
  }
  addItem(cityId, b) {
    const c = this.get(cityId); if (!c) throw new Error('Cidade não encontrada');
    if (c.items.length >= 500) throw new Error('Limite de itens desta cidade');
    const it = this.#item(b, { id: crypto.randomBytes(4).toString('hex'), category: 'Outros', phone: '', address: '', notes: '', verified: false });
    c.items.push(it); this.store.save(); return it;
  }
  updateItem(cityId, itemId, b) {
    const c = this.get(cityId); const i = c?.items.findIndex((x) => x.id === itemId); if (!c || i < 0) throw new Error('Item não encontrado');
    c.items[i] = this.#item(b, c.items[i]); this.store.save(); return c.items[i];
  }
  removeItem(cityId, itemId) {
    const c = this.get(cityId); const it = c?.items.find((x) => x.id === itemId); if (!c || !it) throw new Error('Item não encontrado');
    c.items = c.items.filter((x) => x.id !== itemId); this.store.save(); return it;
  }
  addCity({ name, department }) {
    const n = clip(name, 80); if (!n) throw new Error('Dê o nome da cidade');
    if (this.cities.some((c) => norm(c.name) === norm(n))) throw new Error('Essa cidade já existe');
    const c = { id: crypto.randomBytes(5).toString('hex'), name: n, department: clip(department, 60), national: false, items: [], createdAt: this.now().toISOString() };
    this.cities.push(c); this.store.save(); return c;
  }
  /** Planilha colada: uma linha por local, separada por ";" ou tabulação: Categoria;Nome;Telefone;Endereço;Observação. */
  importText(cityId, text) {
    const c = this.get(cityId); if (!c) throw new Error('Cidade não encontrada');
    let added = 0; const bad = [];
    const have = new Set(c.items.map((i) => norm(`${i.category}|${i.name}|${i.phone}`)));
    String(text || '').split(/\r?\n/).slice(0, 500).forEach((line, idx) => {
      if (!line.trim() || /^categoria\s*[;\t]/i.test(line.trim())) return;
      const [category, name, phone, address, notes] = line.split(/[;\t]/).map((x) => x?.trim() || '');
      try {
        const it = this.#item({ category, name, phone, address, notes }, { id: crypto.randomBytes(4).toString('hex'), verified: false });
        const k = norm(`${it.category}|${it.name}|${it.phone}`); if (have.has(k)) return;
        have.add(k); c.items.push(it); added += 1;
      } catch (e) { bad.push(`linha ${idx + 1}: ${e.message}`); }
    });
    if (added) this.store.save();
    return { added, bad: bad.slice(0, 10) };
  }
  /** Texto do guia (cidade + emergência nacional) para mandar ao cliente. */
  message(cityId, clientName = '') {
    const c = this.get(cityId); if (!c) throw new Error('Cidade não encontrada');
    const nat = this.nationalCity();
    const sections = new Map();
    for (const city of [c, nat && nat.id !== c.id ? nat : null].filter(Boolean)) for (const it of city.items) {
      if (!sections.has(it.category)) sections.set(it.category, []);
      sections.get(it.category).push(`• ${it.name}${it.phone ? ` · ${it.phone}` : ''}${it.address ? ` · ${it.address}` : ''}${it.notes ? ` (${it.notes})` : ''}`);
    }
    const first = String(clientName || '').trim().split(/\s+/)[0];
    const body = CATEGORIES.filter((k) => sections.has(k)).map((k) => `*${k}*\n${sections.get(k).join('\n')}`).join('\n\n');
    return `${first ? `Olá, ${first}! ` : 'Olá! '}Aqui está o guia da cidade de ${c.name} (${c.department}), com os contatos úteis para o seu começo por lá:\n\n${body || 'Em breve a equipe envia os contatos desta cidade.'}\n\nQualquer dúvida, fale com a gente por aqui. Bem-vindo!`;
  }
  recordSent({ cityId, phone, by }) {
    this.data.sent.push({ at: this.now().toISOString(), cityId, phone, by });
    this.data.sent = this.data.sent.slice(-2000); this.store.save();
  }
}
