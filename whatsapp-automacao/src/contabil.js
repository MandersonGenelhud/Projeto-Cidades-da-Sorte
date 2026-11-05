// Painel da Migra Contábil Paraguay: a carteira de empresas clientes do escritório contábil.
// - Empresas: dados, regime, responsável, honorário mensal e quais obrigações cada uma tem.
// - Obrigações do mês: geradas sozinhas a partir do catálogo (com vencimento pelo último número do RUC ou dia fixo).
// - Documentos pedidos aos clientes (extratos, notas…) e o que já chegou.
// - Honorários do mês: cobrança de cada empresa; o que é pago entra sozinho no Caixa Migra Contábil Paraguay.
import crypto from 'node:crypto';

const err = (status, message) => Object.assign(new Error(message), { status });
const clean = (s, max = 200) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const round = (v) => Math.round(Number(v || 0) * 100) / 100;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const isMonth = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || ''));
const newId = () => crypto.randomBytes(6).toString('hex');
const num = (v) => {
  if (v === '' || v === null || v === undefined) return NaN;
  if (typeof v === 'number') return v;
  const t = String(v).trim();
  return Number(/,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, ''));
};
const addMonths = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const lastDay = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const dayIn = (ym, day) => `${ym}-${String(Math.min(Math.max(1, day), lastDay(ym))).padStart(2, '0')}`;

export const CURRENCIES = ['PYG', 'BRL', 'USD'];
export const REGIMES = {
  ire_general: 'IRE Régimen General', ire_simple: 'IRE Simple', ire_resimple: 'IRE Resimple', irp: 'IRP (pessoa física)', sem_atividade: 'Sem atividade',
  simples: 'Simples Nacional (Brasil)', presumido: 'Lucro Presumido (Brasil)', real: 'Lucro Real (Brasil)', mei: 'MEI (Brasil)', outro: 'Outro',
};
export const COMPANY_STATUS = { ativo: 'Ativa', suspenso: 'Suspensa', encerrado: 'Encerrada' };
export const TASK_STATUS = { pendente: 'Pendente', em_andamento: 'Em andamento', aguardando_cliente: 'Esperando o cliente', entregue: 'Entregue', dispensado: 'Não se aplica' };
export const PERIODS = { mensal: 'Mensal', anual: 'Anual' };
// Dia do vencimento pelo último número do RUC (ponto de partida; o escritório confere e ajusta pelo calendário oficial da DNIT).
export const DEFAULT_RUC_DAYS = { 0: 7, 1: 9, 2: 11, 3: 13, 4: 15, 5: 17, 6: 19, 7: 21, 8: 23, 9: 25 };
// Catálogo inicial de obrigações (o escritório edita: nomes, prazos e a quem se aplicam).
export const DEFAULT_OBLIGATIONS = [
  { key: 'iva', name: 'IVA mensal', period: 'mensal', due: 'ruc', regimes: ['ire_general', 'ire_simple', 'irp'] },
  { key: 'comprobantes', name: 'Registro de comprovantes (compras e vendas)', period: 'mensal', due: 'ruc', regimes: ['ire_general', 'ire_simple', 'ire_resimple', 'irp'] },
  { key: 'ips', name: 'IPS dos funcionários (previdência)', period: 'mensal', due: 'dia', day: 15, regimes: [] },
  { key: 'ire_anual', name: 'IRE anual (declaração)', period: 'anual', due: 'ruc', month: 4, regimes: ['ire_general', 'ire_simple', 'ire_resimple'] },
  { key: 'irp_anual', name: 'IRP anual (declaração)', period: 'anual', due: 'ruc', month: 3, regimes: ['irp'] },
  { key: 'balanco', name: 'Balanço e estados contábeis', period: 'anual', due: 'dia', day: 30, month: 4, regimes: ['ire_general'] },
];

export class Contabil {
  constructor({ store, now = () => new Date() }) {
    Object.assign(this, { store, now });
    store.data.contabil ||= { companies: [], obligations: [], tasks: [], requests: [], fees: [] };
    const d = store.data.contabil;
    for (const k of ['companies', 'obligations', 'tasks', 'requests', 'fees']) d[k] ||= [];
    if (!d.obligations.length && !d.seeded) {
      d.obligations = DEFAULT_OBLIGATIONS.map((o) => ({ id: newId(), active: true, day: null, month: null, ...o }));
      d.seeded = true;
      store.save();
    }
  }

  get data() { return this.store.data.contabil; }
  get rucDays() { return { ...DEFAULT_RUC_DAYS, ...(this.store.settings.contabil?.rucDays || {}) }; }
  today() { return this.now().toISOString().slice(0, 10); }
  month() { return this.today().slice(0, 7); }

  #log(x, user, text) { (x.history ||= []).push({ at: this.now().toISOString(), by: user?.name || 'Sistema', text }); }
  #find(list, key, label) {
    const x = this.data[list].find((i) => i.id === key && !i.deleted);
    if (!x) throw err(404, `${label} não encontrado`);
    return x;
  }

  // ---------------- Empresas ----------------
  #company(b, base = {}) {
    const name = clean(b.name ?? base.name, 160);
    if (!name) throw err(400, 'Informe a razão social ou o nome da empresa');
    const ruc = clean(b.ruc ?? base.ruc, 20).toUpperCase();
    if (ruc && !/^\d{3,10}(-\d)?$/.test(ruc)) throw err(400, 'RUC inválido (ex.: 80012345-6)');
    const regime = String(b.regime ?? base.regime ?? 'ire_simple');
    if (!REGIMES[regime]) throw err(400, 'Regime inválido');
    const status = String(b.status ?? base.status ?? 'ativo');
    if (!COMPANY_STATUS[status]) throw err(400, 'Situação inválida');
    const feeRaw = b.monthlyFee ?? base.monthlyFee;
    const monthlyFee = feeRaw === '' || feeRaw === null || feeRaw === undefined ? 0 : round(num(feeRaw));
    if (!(monthlyFee >= 0)) throw err(400, 'Honorário inválido');
    const currency = String(b.currency ?? base.currency ?? 'PYG').toUpperCase();
    if (!CURRENCIES.includes(currency)) throw err(400, 'Moeda inválida');
    const feeDay = Number(b.feeDay ?? base.feeDay ?? 10);
    if (!(feeDay >= 1 && feeDay <= 28)) throw err(400, 'Dia do honorário entre 1 e 28');
    const email = clean(b.email ?? base.email, 120);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw err(400, 'E-mail inválido');
    const ids = new Set(this.data.obligations.map((o) => o.id));
    const raw = b.obligationIds ?? base.obligationIds;
    // Sem escolha: usa as obrigações do catálogo que valem para o regime.
    const obligationIds = Array.isArray(raw) ? raw.filter((x) => ids.has(x)) : this.data.obligations.filter((o) => o.active && o.regimes?.includes(regime)).map((o) => o.id);
    return {
      name, tradeName: clean(b.tradeName ?? base.tradeName, 120), ruc, cnpj: clean(b.cnpj ?? base.cnpj, 20), regime, status,
      activity: clean(b.activity ?? base.activity, 120), responsible: clean(b.responsible ?? base.responsible, 80),
      contactName: clean(b.contactName ?? base.contactName, 120), phone: clean(b.phone ?? base.phone, 30), email,
      monthlyFee, currency, feeDay, startDate: isDate(b.startDate ?? base.startDate) ? String(b.startDate ?? base.startDate) : this.today(),
      obligationIds, notes: clean(b.notes ?? base.notes, 800),
    };
  }

  addCompany(user, b = {}) {
    const c = { id: newId(), ...this.#company(b), createdAt: this.now().toISOString(), createdBy: user?.name || '' };
    if (c.ruc && this.data.companies.some((x) => !x.deleted && x.ruc === c.ruc)) throw err(400, 'Já existe uma empresa com esse RUC');
    this.#log(c, user, 'Empresa cadastrada');
    this.data.companies.push(c);
    this.store.save();
    return c;
  }

  updateCompany(user, key, b = {}) {
    const c = this.#find('companies', key, 'Empresa');
    const next = this.#company(b, c);
    if (next.ruc && this.data.companies.some((x) => !x.deleted && x.id !== c.id && x.ruc === next.ruc)) throw err(400, 'Já existe uma empresa com esse RUC');
    const changes = Object.keys(next).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(c[k] ?? '')).map((k) => k);
    Object.assign(c, next);
    if (changes.length) this.#log(c, user, `Alterado: ${changes.join(', ')}`);
    this.store.save();
    return c;
  }

  // ---------------- Catálogo de obrigações ----------------
  #obligation(b, base = {}) {
    const name = clean(b.name ?? base.name, 120);
    if (!name) throw err(400, 'Dê um nome para a obrigação');
    const period = String(b.period ?? base.period ?? 'mensal');
    if (!PERIODS[period]) throw err(400, 'Escolha mensal ou anual');
    const due = String(b.due ?? base.due ?? 'ruc');
    if (!['ruc', 'dia'].includes(due)) throw err(400, 'Vencimento: pelo RUC ou dia fixo');
    const day = due === 'dia' ? Number(b.day ?? base.day) : null;
    if (due === 'dia' && !(day >= 1 && day <= 31)) throw err(400, 'Dia do vencimento entre 1 e 31');
    const month = period === 'anual' ? Number(b.month ?? base.month) : null;
    if (period === 'anual' && !(month >= 1 && month <= 12)) throw err(400, 'Mês do vencimento entre 1 e 12');
    const regimes = (Array.isArray(b.regimes ?? base.regimes) ? (b.regimes ?? base.regimes) : []).filter((r) => REGIMES[r]);
    return { name, period, due, day, month, regimes, active: (b.active ?? base.active ?? true) !== false && b.active !== 'false' };
  }
  addObligation(user, b = {}) {
    const o = { id: newId(), ...this.#obligation(b) };
    this.#log(o, user, 'Obrigação criada');
    this.data.obligations.push(o);
    this.store.save();
    return o;
  }
  updateObligation(user, key, b = {}) {
    const o = this.#find('obligations', key, 'Obrigação');
    Object.assign(o, this.#obligation(b, o));
    this.#log(o, user, 'Alterada');
    this.store.save();
    return o;
  }
  setRucDays(days = {}) {
    const out = {};
    for (let i = 0; i <= 9; i++) {
      const v = Number(days[i] ?? days[String(i)]);
      if (!(v >= 1 && v <= 31)) throw err(400, `Dia inválido para o RUC terminado em ${i}`);
      out[i] = v;
    }
    this.store.updateSettings({ contabil: { rucDays: out } });
    return out;
  }

  /** Último número do RUC (antes do dígito verificador): 80012345-6 → 5. */
  rucDigit(ruc) {
    const base = String(ruc || '').split('-')[0].replace(/\D/g, '');
    return base ? Number(base.at(-1)) : null;
  }

  dueDate(company, o, dueMonth) {
    if (o.due === 'dia') return dayIn(dueMonth, o.day);
    const dg = this.rucDigit(company.ruc);
    return dayIn(dueMonth, dg === null ? this.rucDays[9] : this.rucDays[dg]);
  }

  /**
   * Cria (sem duplicar) as obrigações que vencem no mês "dueMonth" para cada empresa ativa.
   * Mensal: vence no mês seguinte ao de referência (ex.: IVA de outubro vence em novembro). Anual: só no mês configurado.
   */
  generate(dueMonth = this.month()) {
    if (!isMonth(dueMonth)) throw err(400, 'Mês inválido');
    const have = new Set(this.data.tasks.map((t) => t.key));
    let added = 0;
    for (const c of this.data.companies.filter((x) => !x.deleted && x.status === 'ativo')) {
      for (const o of this.data.obligations.filter((x) => !x.deleted && x.active && c.obligationIds.includes(x.id))) {
        if (o.period === 'anual' && Number(dueMonth.slice(5)) !== o.month) continue;
        const key = `${c.id}|${o.id}|${dueMonth}`;
        if (have.has(key)) continue;
        const ref = o.period === 'anual' ? String(Number(dueMonth.slice(0, 4)) - 1) : addMonths(dueMonth, -1);
        this.data.tasks.push({ id: newId(), key, companyId: c.id, obligationId: o.id, name: o.name, reference: ref, dueMonth, dueDate: this.dueDate(c, o, dueMonth), status: 'pendente', responsible: c.responsible || '', createdAt: this.now().toISOString(), history: [] });
        have.add(key); added += 1;
      }
    }
    // Honorários do mês (um por empresa ativa com valor).
    const feeKeys = new Set(this.data.fees.map((f) => f.key));
    let fees = 0;
    for (const c of this.data.companies.filter((x) => !x.deleted && x.status === 'ativo' && x.monthlyFee > 0)) {
      const key = `${c.id}|${dueMonth}`;
      if (feeKeys.has(key)) continue;
      this.data.fees.push({ id: newId(), key, companyId: c.id, month: dueMonth, amount: c.monthlyFee, currency: c.currency, dueDate: dayIn(dueMonth, c.feeDay), status: 'aberto', createdAt: this.now().toISOString(), history: [] });
      feeKeys.add(key); fees += 1;
    }
    if (added || fees) this.store.save();
    return { added, fees };
  }

  updateTask(user, key, b = {}) {
    const t = this.#find('tasks', key, 'Obrigação');
    const before = t.status;
    if (b.status !== undefined) {
      if (!TASK_STATUS[b.status]) throw err(400, 'Situação inválida');
      t.status = b.status;
      if (t.status === 'entregue' && before !== 'entregue') { t.deliveredAt = this.today(); t.deliveredBy = user?.name || ''; }
      if (t.status !== 'entregue') { delete t.deliveredAt; delete t.deliveredBy; }
    }
    if (b.responsible !== undefined) t.responsible = clean(b.responsible, 80);
    if (b.protocol !== undefined) t.protocol = clean(b.protocol, 80);
    if (b.note !== undefined) t.note = clean(b.note, 400);
    this.#log(t, user, before !== t.status ? `${TASK_STATUS[before]} → ${TASK_STATUS[t.status]}${t.protocol ? ` · protocolo ${t.protocol}` : ''}` : 'Dados alterados');
    this.store.save();
    return t;
  }

  // ---------------- Documentos pedidos ao cliente ----------------
  addRequest(user, b = {}) {
    const c = this.#find('companies', String(b.companyId || ''), 'Empresa');
    const title = clean(b.title, 160);
    if (!title) throw err(400, 'Diga qual documento foi pedido (ex.: extrato bancário de outubro)');
    const r = { id: newId(), companyId: c.id, title, month: isMonth(b.month) ? b.month : addMonths(this.month(), -1), status: 'pedido', requestedAt: this.today(), dueDate: isDate(b.dueDate) ? b.dueDate : '', createdBy: user?.name || '', history: [] };
    this.#log(r, user, 'Pedido ao cliente');
    this.data.requests.push(r);
    this.store.save();
    return r;
  }
  updateRequest(user, key, b = {}) {
    const r = this.#find('requests', key, 'Pedido');
    if (b.status !== undefined) {
      if (!['pedido', 'recebido'].includes(b.status)) throw err(400, 'Situação inválida');
      r.status = b.status;
      r.receivedAt = r.status === 'recebido' ? this.today() : '';
    }
    if (b.note !== undefined) r.note = clean(b.note, 300);
    this.#log(r, user, r.status === 'recebido' ? 'Recebido' : 'Alterado');
    this.store.save();
    return r;
  }

  // ---------------- Honorários ----------------
  updateFee(user, key, b = {}) {
    const f = this.#find('fees', key, 'Honorário');
    if (b.status !== undefined) {
      if (!['aberto', 'pago', 'cancelado'].includes(b.status)) throw err(400, 'Situação inválida');
      f.status = b.status;
      f.paidAt = f.status === 'pago' ? (isDate(b.paidAt) ? b.paidAt : this.today()) : '';
      if (b.method !== undefined) f.method = clean(b.method, 40);
    }
    if (b.amount !== undefined) {
      const v = round(num(b.amount));
      if (!(v > 0)) throw err(400, 'Valor inválido');
      f.amount = v;
    }
    this.#log(f, user, f.status === 'pago' ? `Pago (${f.amount} ${f.currency})` : f.status === 'cancelado' ? 'Cancelado' : 'Alterado');
    this.store.save();
    return f;
  }

  /** Honorários pagos viram entradas no Caixa Migra Contábil Paraguay. */
  cashEntries() {
    const names = Object.fromEntries(this.data.companies.map((c) => [c.id, c.name]));
    return this.data.fees.filter((f) => !f.deleted && f.status === 'pago' && f.paidAt).map((f) => ({
      id: `cf:${f.id}`, source: 'sistema', kind: 'entrada', date: f.paidAt, amount: f.amount, currency: f.currency, category: 'Honorários contábeis',
      description: `Honorário ${f.month.split('-').reverse().join('/')} · ${names[f.companyId] || 'Empresa'}`, method: f.method || '', account: '', payee: names[f.companyId] || '', status: 'pago', notes: '', scope: 'empresa', book: 'contabil',
    }));
  }

  remove(user, list, key, reason) {
    const labels = { companies: 'Empresa', obligations: 'Obrigação', requests: 'Pedido' };
    if (!labels[list]) throw err(400, 'Tipo inválido');
    const x = this.#find(list, key, labels[list]);
    if (!clean(reason)) throw err(400, 'Informe o motivo');
    x.deleted = { at: this.now().toISOString(), by: user?.name || '', reason: clean(reason, 200) };
    this.#log(x, user, `Apagado: ${clean(reason, 200)}`);
    this.store.save();
  }

  // ---------------- Visão geral ----------------
  overview(month = this.month()) {
    this.generate(month);
    const today = this.today();
    const companies = this.data.companies.filter((c) => !c.deleted);
    const name = Object.fromEntries(companies.map((c) => [c.id, c.name]));
    const live = (t) => !t.deleted && name[t.companyId];
    const tasks = this.data.tasks.filter((t) => live(t) && t.dueMonth === month).map((t) => ({ ...t, companyName: name[t.companyId], late: !['entregue', 'dispensado'].includes(t.status) && t.dueDate < today }))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.companyName.localeCompare(b.companyName, 'pt'));
    const open = this.data.tasks.filter((t) => live(t) && !['entregue', 'dispensado'].includes(t.status));
    const lateAll = open.filter((t) => t.dueDate < today).map((t) => ({ ...t, companyName: name[t.companyId] })).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const in7 = new Date(new Date(`${today}T12:00:00Z`).getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
    const soon = open.filter((t) => t.dueDate >= today && t.dueDate <= in7).map((t) => ({ ...t, companyName: name[t.companyId] })).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const fees = this.data.fees.filter((f) => live(f) && f.month === month).map((f) => ({ ...f, companyName: name[f.companyId], late: f.status === 'aberto' && f.dueDate < today }));
    const sumBy = (list) => list.reduce((o, f) => ({ ...o, [f.currency]: round((o[f.currency] || 0) + f.amount) }), {});
    const requests = this.data.requests.filter((r) => live(r)).map((r) => ({ ...r, companyName: name[r.companyId] })).sort((a, b) => (a.status === b.status ? b.requestedAt.localeCompare(a.requestedAt) : a.status === 'pedido' ? -1 : 1));
    const active = companies.filter((c) => c.status === 'ativo');
    const byRegime = {}; const byResponsible = {};
    for (const c of active) { byRegime[REGIMES[c.regime]] = (byRegime[REGIMES[c.regime]] || 0) + 1; byResponsible[c.responsible || 'Sem responsável'] = (byResponsible[c.responsible || 'Sem responsável'] || 0) + 1; }
    const perCompany = (id) => ({ open: open.filter((t) => t.companyId === id).length, late: lateAll.filter((t) => t.companyId === id).length, docs: requests.filter((r) => r.companyId === id && r.status === 'pedido').length });
    return {
      month, today,
      companies: companies.map((c) => ({ ...c, regimeLabel: REGIMES[c.regime], ...perCompany(c.id) })).sort((a, b) => a.name.localeCompare(b.name, 'pt')),
      obligations: this.data.obligations.filter((o) => !o.deleted),
      tasks, late: lateAll.slice(0, 50), soon: soon.slice(0, 50), fees, requests,
      totals: {
        companies: active.length, inactive: companies.length - active.length,
        tasks: tasks.length, delivered: tasks.filter((t) => t.status === 'entregue').length, pending: tasks.filter((t) => !['entregue', 'dispensado'].includes(t.status)).length,
        lateTasks: lateAll.length, docsPending: requests.filter((r) => r.status === 'pedido').length,
        feesOpen: sumBy(fees.filter((f) => f.status === 'aberto')), feesPaid: sumBy(fees.filter((f) => f.status === 'pago')), feesLate: sumBy(fees.filter((f) => f.late)),
        monthlyRevenue: sumBy(active.filter((c) => c.monthlyFee > 0).map((c) => ({ currency: c.currency, amount: c.monthlyFee }))),
      },
      byRegime, byResponsible, rucDays: this.rucDays,
      labels: { regimes: REGIMES, companyStatus: COMPANY_STATUS, taskStatus: TASK_STATUS, periods: PERIODS },
    };
  }
}
