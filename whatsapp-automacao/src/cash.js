// Controle de caixa: o que entra (recebimentos dos clientes, já conhecidos pelo sistema) e o que sai
// (despesas e pagamentos que a equipe registra, com a categoria da despesa).
// Só administradores liberados enxergam. Toda alteração fica no histórico do lançamento (quem, quando, o quê).
import crypto from 'node:crypto';

const err = (status, message) => Object.assign(new Error(message), { status });
const round = (v) => Math.round(Number(v || 0) * 100) / 100;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const clean = (s, max = 200) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const today = () => new Date().toISOString().slice(0, 10);

export const CURRENCIES = ['BRL', 'USD', 'PYG'];
export const METHODS = ['Pix', 'Cartão de crédito', 'Cartão de débito', 'Dinheiro', 'Transferência', 'Boleto', 'Outro'];
export const DEFAULT_CATEGORIES = [
  'Salários e comissões', 'Aluguel e contas do escritório', 'Marketing e anúncios', 'Impostos e taxas', 'Fornecedores e serviços',
  'Documentos, cartório e certidões', 'Viagens e hospedagem', 'Software e sistemas', 'Retirada de sócio', 'Outros',
];
const AUTO_IN = 'Recebimento de clientes';
const AUTO_COMMISSION = 'Comissões pagas';

export class Cash {
  /** payments/sales/affiliates são só para ler o que já entrou e as comissões já pagas. */
  constructor({ store, auth, payments = null, sales = null, affiliates = null }) {
    Object.assign(this, { store, auth, payments, sales, affiliates });
    store.data.cash ||= [];
  }

  get list() {
    return this.store.data.cash;
  }

  get config() {
    return this.store.settings.cash || {};
  }

  get categories() {
    const c = this.config.categories;
    return Array.isArray(c) && c.length ? c : DEFAULT_CATEGORIES;
  }

  /** Quem pode ver: administrador ativo e, se a lista de liberados existir, só quem está nela. */
  canAccess(user) {
    if (!user || user.role !== 'admin' || user.active === false) return false;
    const allowed = this.config.allowedUserIds;
    return !Array.isArray(allowed) || !allowed.length || allowed.includes(user.id);
  }

  #log(e, user, text) {
    e.history.push({ at: new Date().toISOString(), by: user?.name || 'Sistema', text });
  }

  #clean(input, base = {}) {
    const kind = input.kind !== undefined ? input.kind : base.kind;
    if (!['entrada', 'saida'].includes(kind)) throw err(400, 'Escolha se é entrada ou saída');
    const amount = round(input.amount !== undefined ? input.amount : base.amount);
    if (!(amount > 0)) throw err(400, 'Informe um valor maior que zero');
    const date = input.date !== undefined ? input.date : base.date || today();
    if (!isDate(date)) throw err(400, 'Data inválida');
    const currency = String(input.currency ?? base.currency ?? 'BRL').toUpperCase();
    if (!CURRENCIES.includes(currency)) throw err(400, 'Moeda inválida');
    const status = (input.status ?? base.status ?? 'pago') === 'a_pagar' ? 'a_pagar' : 'pago';
    const dueDate = input.dueDate !== undefined ? clean(input.dueDate, 10) : base.dueDate || '';
    if (dueDate && !isDate(dueDate)) throw err(400, 'Vencimento inválido');
    const description = clean(input.description ?? base.description, 200);
    if (!description) throw err(400, 'Escreva o que foi (ex.: aluguel de novembro)');
    return {
      kind, amount, date, currency, status, dueDate: status === 'a_pagar' ? dueDate : '', description,
      category: clean(input.category ?? base.category, 80) || (kind === 'entrada' ? 'Outras entradas' : 'Outros'),
      method: clean(input.method ?? base.method, 40),
      account: clean(input.account ?? base.account, 80), // de que conta/quem pagou (ex.: Marcos, empresa)
      payee: clean(input.payee ?? base.payee, 120), // para quem foi (ou de quem veio)
      notes: clean(input.notes ?? base.notes, 400),
    };
  }

  add(user, input) {
    const e = { id: crypto.randomBytes(6).toString('hex'), ...this.#clean({ account: user?.name, ...input }), createdBy: user?.name || '', createdAt: new Date().toISOString(), history: [] };
    this.#log(e, user, `Lançamento criado: ${e.kind === 'saida' ? 'saída' : 'entrada'} de ${e.amount} ${e.currency} · ${e.category}`);
    this.list.push(e);
    this.store.save();
    return e;
  }

  get(id) {
    return this.list.find((e) => e.id === id && !e.deleted) || null;
  }

  update(user, id, patch) {
    const e = this.get(id);
    if (!e) throw err(404, 'Lançamento não encontrado');
    const next = this.#clean(patch, e);
    const changes = Object.keys(next).filter((k) => String(next[k]) !== String(e[k] ?? '')).map((k) => `${k}: ${e[k] ?? '—'} → ${next[k]}`);
    Object.assign(e, next);
    if (changes.length) this.#log(e, user, `Alterado (${changes.join('; ')})`);
    this.store.save();
    return e;
  }

  /** Não apaga de verdade: o lançamento sai das contas, mas fica guardado com o motivo (auditoria). */
  remove(user, id, reason) {
    const e = this.get(id);
    if (!e) throw err(404, 'Lançamento não encontrado');
    if (!clean(reason)) throw err(400, 'Informe o motivo de apagar o lançamento');
    e.deleted = { at: new Date().toISOString(), by: user?.name || '', reason: clean(reason, 200) };
    this.#log(e, user, `Apagado: ${clean(reason, 200)}`);
    this.store.save();
  }

  /** Entradas e comissões que o sistema já sabe (não se digita de novo e não se edita aqui). */
  automatic() {
    const out = [];
    for (const p of this.payments?.list || []) {
      if (p.status !== 'paid' || !p.paidAt) continue;
      out.push({ id: `pay:${p.id}`, source: 'sistema', kind: 'entrada', date: p.paidAt.slice(0, 10), amount: round(p.amount), currency: 'BRL', category: AUTO_IN,
        description: `${p.description || 'Pix'}${p.payerName ? ` · ${p.payerName}` : ''}`, method: 'Pix', account: '', payee: p.payerName || '', status: 'pago', notes: '' });
    }
    for (const s of this.sales?.list || []) {
      if (s.status === 'cancelada') continue;
      s.parcels.forEach((x, i) => {
        // A entrada confirmada por Pix já aparece como pagamento acima.
        if (x.status !== 'pago' || !x.paidAt || String(x.confirmedBy || '').startsWith('Sistema')) return;
        out.push({ id: `parc:${s.id}:${i}`, source: 'sistema', kind: 'entrada', date: x.paidAt, amount: round(x.value), currency: 'BRL', category: AUTO_IN,
          description: `${s.number} · ${x.label} · ${s.client?.nome || ''}`, method: x.method || '', account: '', payee: s.client?.nome || '', status: 'pago', notes: '' });
      });
      const c = s.commission;
      if (c?.status === 'paga' && c.paidAt && c.value > 0) {
        out.push({ id: `com:${s.id}`, source: 'sistema', kind: 'saida', date: c.paidAt, amount: round(c.value), currency: 'BRL', category: AUTO_COMMISSION,
          description: `Comissão de ${s.sellerName || 'vendedor'} · ${s.number}`, method: '', account: '', payee: s.sellerName || '', status: 'pago', notes: '' });
      }
    }
    for (const c of this.affiliates?.data?.commissions || []) {
      if (c.status !== 'paga' || !c.paidAt || !(c.amount > 0)) continue;
      out.push({ id: `aff:${c.id}`, source: 'sistema', kind: 'saida', date: c.paidAt.slice(0, 10), amount: round(c.amount), currency: c.currency || 'BRL', category: AUTO_COMMISSION,
        description: `Comissão de parceiro · ${c.clientName || ''}`, method: '', account: '', payee: this.affiliates?.get?.(c.affId)?.name || '', status: 'pago', notes: '' });
    }
    return out;
  }

  /** Lançamentos (manuais + automáticos) do período, do mais recente para o mais antigo. */
  entries({ from = '', to = '', kind = '', category = '', q = '', status = '' } = {}) {
    const term = clean(q, 80).toLowerCase();
    const manual = this.list.filter((e) => !e.deleted).map((e) => ({ ...e, source: 'manual' }));
    return [...manual, ...this.automatic()]
      .filter((e) => (!from || e.date >= from) && (!to || e.date <= to))
      .filter((e) => !kind || e.kind === kind)
      .filter((e) => !category || e.category === category)
      .filter((e) => !status || e.status === status)
      .filter((e) => !term || [e.description, e.payee, e.category, e.account, e.method].some((x) => String(x || '').toLowerCase().includes(term)))
      .sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }

  /** Totais por moeda (nunca soma moedas diferentes) e por categoria. "A pagar" fica separado do que já saiu. */
  summary(entries) {
    const byCur = {};
    const cat = {};
    for (const e of entries) {
      const c = (byCur[e.currency] ||= { entradas: 0, saidas: 0, aPagar: 0, aReceber: 0 });
      if (e.status === 'a_pagar') {
        if (e.kind === 'saida') c.aPagar = round(c.aPagar + e.amount);
        else c.aReceber = round(c.aReceber + e.amount);
        continue;
      }
      if (e.kind === 'entrada') c.entradas = round(c.entradas + e.amount);
      else {
        c.saidas = round(c.saidas + e.amount);
        const k = `${e.currency}|${e.category}`;
        cat[k] = round((cat[k] || 0) + e.amount);
      }
    }
    for (const c of Object.values(byCur)) c.saldo = round(c.entradas - c.saidas);
    const spending = Object.entries(cat).map(([k, total]) => { const [currency, category] = k.split('|'); return { currency, category, total }; })
      .sort((a, b) => b.total - a.total);
    return { byCurrency: byCur, spending };
  }
}
