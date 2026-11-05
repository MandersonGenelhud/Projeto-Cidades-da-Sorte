// Migratech Soluções: clientes, contratos e serviços prestados, separados da Migra.
// O dinheiro vai para o "Caixa Migratech Soluções" (cash.js, book 'migratech'):
// cada serviço marcado como pago entra sozinho como entrada nesse caixa.
import crypto from 'node:crypto';

const err = (status, message) => Object.assign(new Error(message), { status });
const clean = (s, max = 200) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const round = (v) => Math.round(Number(v || 0) * 100) / 100;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const id = () => crypto.randomBytes(6).toString('hex');
const num = (v) => {
  if (v === '' || v === null || v === undefined) return NaN;
  if (typeof v === 'number') return v;
  const t = String(v).trim();
  return Number(/,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, ''));
};

export const CURRENCIES = ['BRL', 'USD', 'PYG'];
export const RECURRENCE = { unico: 'Único', mensal: 'Mensal', anual: 'Anual' };
export const CONTRACT_STATUS = { ativo: 'Ativo', pausado: 'Pausado', encerrado: 'Encerrado', cancelado: 'Cancelado' };
export const SERVICE_STATUS = { a_faturar: 'A faturar', faturado: 'Faturado (a receber)', pago: 'Pago' };

export class Migratech {
  constructor({ store, now = () => new Date() }) {
    Object.assign(this, { store, now });
    store.data.migratech ||= { clients: [], contracts: [], services: [] };
  }

  get data() { return this.store.data.migratech; }
  today() { return this.now().toISOString().slice(0, 10); }

  #log(item, user, text) {
    (item.history ||= []).push({ at: this.now().toISOString(), by: user?.name || 'Sistema', text });
  }

  #find(list, key, label) {
    const x = this.data[list].find((i) => i.id === key && !i.deleted);
    if (!x) throw err(404, `${label} não encontrado`);
    return x;
  }

  // ---------------- Clientes ----------------
  #client(b, base = {}) {
    const name = clean(b.name ?? base.name, 120);
    if (!name) throw err(400, 'Informe o nome do cliente');
    const email = clean(b.email ?? base.email, 120);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw err(400, 'E-mail inválido');
    return { name, company: clean(b.company ?? base.company, 120), doc: clean(b.doc ?? base.doc, 40), phone: clean(b.phone ?? base.phone, 30), email, notes: clean(b.notes ?? base.notes, 600) };
  }

  addClient(user, b = {}) {
    const c = { id: id(), ...this.#client(b), createdAt: this.now().toISOString(), createdBy: user?.name || '' };
    this.#log(c, user, 'Cliente cadastrado');
    this.data.clients.push(c);
    this.store.save();
    return c;
  }

  updateClient(user, key, b = {}) {
    const c = this.#find('clients', key, 'Cliente');
    Object.assign(c, this.#client(b, c));
    this.#log(c, user, 'Dados alterados');
    this.store.save();
    return c;
  }

  // ---------------- Contratos ----------------
  #contract(b, base = {}) {
    const clientId = String(b.clientId ?? base.clientId ?? '');
    this.#find('clients', clientId, 'Cliente');
    const title = clean(b.title ?? base.title, 160);
    if (!title) throw err(400, 'Escreva o que o contrato cobre (ex.: sistema de atendimento)');
    const value = round(num(b.value ?? base.value));
    if (!(value > 0)) throw err(400, 'Informe o valor do contrato');
    const currency = String(b.currency ?? base.currency ?? 'BRL').toUpperCase();
    if (!CURRENCIES.includes(currency)) throw err(400, 'Moeda inválida');
    const recurrence = String(b.recurrence ?? base.recurrence ?? 'mensal');
    if (!RECURRENCE[recurrence]) throw err(400, 'Escolha: único, mensal ou anual');
    const status = String(b.status ?? base.status ?? 'ativo');
    if (!CONTRACT_STATUS[status]) throw err(400, 'Situação inválida');
    const startDate = String(b.startDate ?? base.startDate ?? this.today());
    const endDate = String(b.endDate ?? base.endDate ?? '');
    if (!isDate(startDate)) throw err(400, 'Data de início inválida');
    if (endDate && (!isDate(endDate) || endDate < startDate)) throw err(400, 'Data de fim inválida');
    return { clientId, title, value, currency, recurrence, status, startDate, endDate, notes: clean(b.notes ?? base.notes, 600) };
  }

  addContract(user, b = {}) {
    const c = { id: id(), number: `MT-${String(this.data.contracts.length + 1).padStart(4, '0')}`, ...this.#contract(b), createdAt: this.now().toISOString(), createdBy: user?.name || '' };
    this.#log(c, user, `Contrato criado: ${c.title} · ${c.value} ${c.currency} (${RECURRENCE[c.recurrence]})`);
    this.data.contracts.push(c);
    this.store.save();
    return c;
  }

  updateContract(user, key, b = {}) {
    const c = this.#find('contracts', key, 'Contrato');
    const next = this.#contract(b, c);
    const changes = Object.keys(next).filter((k) => String(next[k]) !== String(c[k] ?? '')).map((k) => `${k}: ${c[k] || '—'} → ${next[k] || '—'}`);
    Object.assign(c, next);
    if (changes.length) this.#log(c, user, `Alterado (${changes.join('; ')})`);
    this.store.save();
    return c;
  }

  // ---------------- Serviços prestados ----------------
  #service(b, base = {}) {
    const clientId = String(b.clientId ?? base.clientId ?? '');
    this.#find('clients', clientId, 'Cliente');
    const contractId = String(b.contractId ?? base.contractId ?? '');
    if (contractId) {
      const ct = this.#find('contracts', contractId, 'Contrato');
      if (ct.clientId !== clientId) throw err(400, 'O contrato escolhido é de outro cliente');
    }
    const description = clean(b.description ?? base.description, 200);
    if (!description) throw err(400, 'Descreva o serviço prestado');
    const value = round(num(b.value ?? base.value));
    if (!(value > 0)) throw err(400, 'Informe o valor do serviço');
    const currency = String(b.currency ?? base.currency ?? 'BRL').toUpperCase();
    if (!CURRENCIES.includes(currency)) throw err(400, 'Moeda inválida');
    const date = String(b.date ?? base.date ?? this.today());
    if (!isDate(date)) throw err(400, 'Data inválida');
    const status = String(b.status ?? base.status ?? 'a_faturar');
    if (!SERVICE_STATUS[status]) throw err(400, 'Situação inválida');
    const hours = b.hours ?? base.hours;
    const h = hours === '' || hours === undefined || hours === null ? null : round(num(hours));
    if (h !== null && !(h >= 0)) throw err(400, 'Horas inválidas');
    return { clientId, contractId, description, value, currency, date, status, hours: h, method: clean(b.method ?? base.method, 40), notes: clean(b.notes ?? base.notes, 400) };
  }

  addService(user, b = {}) {
    const s = { id: id(), ...this.#service(b), createdAt: this.now().toISOString(), createdBy: user?.name || '' };
    if (s.status === 'pago') s.paidAt = String(b.paidAt && isDate(b.paidAt) ? b.paidAt : s.date);
    this.#log(s, user, `Serviço registrado: ${s.description} · ${s.value} ${s.currency} · ${SERVICE_STATUS[s.status]}`);
    this.data.services.push(s);
    this.store.save();
    return s;
  }

  updateService(user, key, b = {}) {
    const s = this.#find('services', key, 'Serviço');
    const before = s.status;
    Object.assign(s, this.#service(b, s));
    if (s.status === 'pago' && before !== 'pago') s.paidAt = String(b.paidAt && isDate(b.paidAt) ? b.paidAt : this.today());
    if (s.status !== 'pago') delete s.paidAt;
    this.#log(s, user, before !== s.status ? `Situação: ${SERVICE_STATUS[before]} → ${SERVICE_STATUS[s.status]}` : 'Dados alterados');
    this.store.save();
    return s;
  }

  /** Não apaga de verdade: sai das contas e da lista, mas fica guardado com o motivo. */
  remove(user, list, key, reason) {
    const labels = { clients: 'Cliente', contracts: 'Contrato', services: 'Serviço' };
    if (!labels[list]) throw err(400, 'Tipo inválido');
    const x = this.#find(list, key, labels[list]);
    if (!clean(reason)) throw err(400, 'Informe o motivo');
    if (list === 'clients' && [...this.data.contracts, ...this.data.services].some((i) => i.clientId === key && !i.deleted)) throw err(400, 'O cliente tem contratos ou serviços: apague ou mude esses primeiro');
    x.deleted = { at: this.now().toISOString(), by: user?.name || '', reason: clean(reason, 200) };
    this.#log(x, user, `Apagado: ${clean(reason, 200)}`);
    this.store.save();
  }

  // ---------------- Leitura ----------------
  overview() {
    const live = (l) => this.data[l].filter((i) => !i.deleted);
    const clients = live('clients');
    const names = Object.fromEntries(clients.map((c) => [c.id, c.name]));
    const contracts = live('contracts').map((c) => ({ ...c, clientName: names[c.clientId] || '' }));
    const services = live('services').map((s) => ({ ...s, clientName: names[s.clientId] || '', contractNumber: contracts.find((c) => c.id === s.contractId)?.number || '' }))
      .sort((a, b) => b.date.localeCompare(a.date));
    // Receita recorrente por mês (contratos ativos): mensal conta inteiro, anual conta 1/12. Por moeda, nunca somadas.
    const mrr = {}; const toBill = {}; const toReceive = {}; const paidMonth = {};
    const month = this.today().slice(0, 7);
    for (const c of contracts) if (c.status === 'ativo' && c.recurrence !== 'unico') mrr[c.currency] = round((mrr[c.currency] || 0) + (c.recurrence === 'anual' ? c.value / 12 : c.value));
    for (const s of services) {
      if (s.status === 'a_faturar') toBill[s.currency] = round((toBill[s.currency] || 0) + s.value);
      if (s.status === 'faturado') toReceive[s.currency] = round((toReceive[s.currency] || 0) + s.value);
      if (s.status === 'pago' && String(s.paidAt || '').startsWith(month)) paidMonth[s.currency] = round((paidMonth[s.currency] || 0) + s.value);
    }
    const perClient = clients.map((c) => ({ id: c.id, contracts: contracts.filter((x) => x.clientId === c.id && x.status === 'ativo').length, services: services.filter((x) => x.clientId === c.id).length }));
    return {
      clients: clients.map((c) => ({ ...c, ...perClient.find((p) => p.id === c.id) })).sort((a, b) => a.name.localeCompare(b.name, 'pt')),
      contracts, services,
      totals: { clients: clients.length, activeContracts: contracts.filter((c) => c.status === 'ativo').length, mrr, toBill, toReceive, paidMonth },
    };
  }

  /** Serviços pagos viram entradas no Caixa Migratech (sem digitar de novo). */
  cashEntries() {
    const names = Object.fromEntries(this.data.clients.map((c) => [c.id, c.name]));
    return this.data.services.filter((s) => !s.deleted && s.status === 'pago' && s.paidAt).map((s) => ({
      id: `mt:${s.id}`, source: 'sistema', kind: 'entrada', date: s.paidAt, amount: s.value, currency: s.currency, category: 'Serviços prestados',
      description: `${names[s.clientId] || 'Cliente'} · ${s.description}`, method: s.method || '', account: '', payee: names[s.clientId] || '', status: 'pago', notes: '', scope: 'empresa', book: 'migratech',
    }));
  }
}
