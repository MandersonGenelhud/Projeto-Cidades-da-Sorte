// Migra Motors: estoque de veículos + simulador de financiamento por banco/financeira
// e consórcio. As taxas são do Marcos (cada banco cadastrado por ele): o sistema
// NÃO traz taxa inventada, só faz a conta com o que foi cadastrado.
import crypto from 'node:crypto';

export const VEHICLE_STATUS = ['disponivel', 'reservado', 'vendido'];
export const LENDER_TYPES = { banco: 'Banco', financeira: 'Financeira', consorcio: 'Consórcio', proprio: 'Financiamento próprio' };
const err = (status, message) => Object.assign(new Error(message), { status });
const id = () => crypto.randomBytes(6).toString('hex');
const cents = (v) => Math.round(Number(v) * 100) / 100;
const numOr = (v, d = 0) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? d : Number(v));
const text = (v, max = 200) => String(v ?? '').trim().slice(0, max);

export class Motors {
  constructor({ store }) {
    this.store = store;
    store.data.motors ||= { vehicles: [], lenders: [] };
  }

  get data() {
    return this.store.data.motors;
  }

  // ---------- Veículos ----------
  vehicles({ publicOnly = false } = {}) {
    return this.data.vehicles.filter((v) => !publicOnly || (v.published && v.status !== 'vendido'));
  }

  vehicle(vid) {
    return this.data.vehicles.find((v) => v.id === vid) || null;
  }

  saveVehicle(vid, input) {
    let v = vid ? this.vehicle(vid) : null;
    if (vid && !v) throw err(404, 'Veículo não encontrado');
    const isNew = !v;
    v ||= { id: id(), createdAt: new Date().toISOString(), images: [], published: false, status: 'disponivel', currency: 'USD' };
    for (const k of ['brand', 'model', 'version', 'fuel', 'transmission', 'color', 'city', 'plate']) if (input[k] !== undefined) v[k] = text(input[k], 80);
    if (input.description !== undefined) v.description = text(input.description, 2000);
    if (input.year !== undefined) v.year = Math.floor(numOr(input.year)) || null;
    if (input.km !== undefined) v.km = Math.max(0, Math.floor(numOr(input.km)));
    if (input.price !== undefined) v.price = Math.max(0, cents(numOr(input.price)));
    if (input.currency !== undefined) v.currency = ['USD', 'PYG', 'BRL'].includes(input.currency) ? input.currency : v.currency;
    if (input.status !== undefined) {
      if (!VEHICLE_STATUS.includes(input.status)) throw err(400, 'Situação do veículo inválida');
      v.status = input.status;
    }
    if (input.published !== undefined) v.published = Boolean(input.published);
    if (input.images !== undefined) v.images = (Array.isArray(input.images) ? input.images : String(input.images).split('\n')).map((x) => text(x, 400)).filter(Boolean).slice(0, 20);
    if (!v.brand || !v.model) throw err(400, 'Informe a marca e o modelo');
    v.title = [v.brand, v.model, v.version, v.year].filter(Boolean).join(' ');
    v.updatedAt = new Date().toISOString();
    if (isNew) this.data.vehicles.push(v);
    this.store.save();
    return v;
  }

  removeVehicle(vid) {
    this.data.vehicles = this.data.vehicles.filter((v) => v.id !== vid);
    this.store.save();
  }

  // ---------- Bancos, financeiras e consórcios ----------
  lenders() {
    return this.data.lenders;
  }

  saveLender(lid, input) {
    let l = lid ? this.data.lenders.find((x) => x.id === lid) : null;
    if (lid && !l) throw err(404, 'Instituição não encontrada');
    const isNew = !l;
    l ||= { id: id(), active: true, type: 'banco' };
    if (input.name !== undefined) l.name = text(input.name, 80);
    if (!l.name) throw err(400, 'Informe o nome do banco ou da administradora');
    if (input.type !== undefined) {
      if (!LENDER_TYPES[input.type]) throw err(400, 'Tipo inválido');
      l.type = input.type;
    }
    if (input.active !== undefined) l.active = Boolean(input.active);
    if (input.ratePctMonth !== undefined) l.ratePctMonth = Math.min(30, Math.max(0, numOr(input.ratePctMonth)));       // juros ao mês (financiamento)
    if (input.adminFeePct !== undefined) l.adminFeePct = Math.min(60, Math.max(0, numOr(input.adminFeePct)));          // taxa de administração total (consórcio)
    if (input.minEntryPct !== undefined) l.minEntryPct = Math.min(100, Math.max(0, numOr(input.minEntryPct)));
    if (input.maxMonths !== undefined) l.maxMonths = Math.min(240, Math.max(1, Math.floor(numOr(input.maxMonths, 60))));
    if (input.maxVehicleAgeYears !== undefined) l.maxVehicleAgeYears = Math.min(40, Math.max(0, Math.floor(numOr(input.maxVehicleAgeYears, 0))));
    if (input.notes !== undefined) l.notes = text(input.notes, 600);
    if (input.requirements !== undefined) l.requirements = text(input.requirements, 800);
    l.updatedAt = new Date().toISOString();
    if (isNew) this.data.lenders.push(l);
    this.store.save();
    return l;
  }

  removeLender(lid) {
    this.data.lenders = this.data.lenders.filter((l) => l.id !== lid);
    this.store.save();
  }

  /** Simula uma instituição. Financiamento: tabela Price. Consórcio: crédito + taxa de administração dividido no prazo. */
  simulate(lender, { price, entry, months }) {
    price = cents(price);
    if (!(price > 0)) throw err(400, 'Informe o valor do veículo');
    const n = Math.floor(Number(months));
    const max = lender.maxMonths || 60;
    if (!(n >= 1) || n > max) throw err(400, `${lender.name}: prazo de 1 a ${max} meses`);
    entry = entry === undefined || entry === '' ? cents((price * (lender.minEntryPct || 0)) / 100) : cents(entry);
    if (entry < cents((price * (lender.minEntryPct || 0)) / 100)) throw err(400, `${lender.name}: entrada mínima de ${lender.minEntryPct}%`);
    if (entry > price) throw err(400, 'A entrada não pode ser maior que o valor do veículo');
    const financed = cents(price - entry);
    let installment; let total;
    if (lender.type === 'consorcio') {
      total = cents(price * (1 + (lender.adminFeePct || 0) / 100));
      installment = cents(total / n);
      return { lender: lender.name, type: lender.type, price, entry: 0, financed: price, months: n, installment, total, cost: cents(total - price), note: 'Consórcio: sem entrada obrigatória; a contemplação depende de sorteio ou lance.' };
    }
    const i = (lender.ratePctMonth || 0) / 100;
    installment = i === 0 ? cents(financed / n) : cents((financed * i) / (1 - (1 + i) ** -n));
    total = cents(entry + installment * n);
    return { lender: lender.name, type: lender.type, price, entry, financed, months: n, installment, total, cost: cents(installment * n - financed), note: '' };
  }

  /** Compara todas as instituições ativas; as que não atendem (prazo/entrada/idade do carro) saem com o motivo. */
  compare({ price, entry, months, vehicleYear }) {
    const results = []; const skipped = [];
    const year = new Date().getFullYear();
    for (const l of this.data.lenders.filter((x) => x.active)) {
      try {
        if (l.maxVehicleAgeYears && vehicleYear && year - Number(vehicleYear) > l.maxVehicleAgeYears) throw err(400, `${l.name}: aceita veículos de até ${l.maxVehicleAgeYears} anos`);
        results.push(this.simulate(l, { price, entry, months }));
      } catch (e) {
        skipped.push({ lender: l.name, reason: e.message });
      }
    }
    results.sort((a, b) => a.total - b.total);
    return { results, skipped, configured: this.data.lenders.some((l) => l.active && (l.ratePctMonth > 0 || l.adminFeePct > 0)) };
  }
}
