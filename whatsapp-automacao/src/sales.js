// Contratos e vendas: cada venda fechada (a partir do orçamento), as parcelas com o que já entrou,
// e a comissão do vendedor. O administrador vê e edita tudo; o vendedor vê só as vendas dele.
// Toda alteração fica no histórico da venda (quem, quando e o que mudou).
import crypto from 'node:crypto';

const err = (status, message) => Object.assign(new Error(message), { status });
const cents = (v) => Math.round(Number(v || 0) * 100) / 100;
const brl = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

export class Sales {
  constructor({ store, auth, notify = () => {} }) {
    Object.assign(this, { store, auth, notify });
    store.data.sales ||= [];
  }

  get list() {
    return this.store.data.sales;
  }

  get config() {
    return this.store.settings.sales || {};
  }

  get(id) {
    return this.list.find((s) => s.id === id) || null;
  }

  canSee(user, sale) {
    return user.role === 'admin' || sale.sellerId === user.id;
  }

  #mustSee(user, id) {
    const s = this.get(id);
    if (!s || !this.canSee(user, s)) throw err(404, 'Venda não encontrada');
    return s;
  }

  #admin(user) {
    if (user.role !== 'admin') throw err(403, 'Só o administrador altera pagamentos e comissões');
  }

  #log(sale, by, text) {
    sale.history.push({ at: new Date().toISOString(), by: by?.name || by || 'Sistema', text });
  }

  /** Percentual de comissão: o do vendedor (se definido) ou o padrão do painel. */
  commissionPct(sellerId) {
    const u = sellerId ? this.auth.get(sellerId) : null;
    const own = u?.commissionPct;
    return Number.isFinite(Number(own)) && own !== null && own !== '' ? Number(own) : Number(this.config.commissionPct) || 0;
  }

  #number() {
    this.store.data.saleSeq = (this.store.data.saleSeq || 0) + 1;
    return `VD-${new Date().getFullYear()}-${String(this.store.data.saleSeq).padStart(4, '0')}`;
  }

  /** Lança a venda a partir do orçamento (uma venda por orçamento). */
  fromQuote(quote, { by, sellerId = null, client = null, entryPaid = false } = {}) {
    if (!quote) throw err(400, 'Orçamento não encontrado');
    const existing = this.list.find((s) => s.quoteId === quote.id && s.status !== 'cancelada');
    if (existing) return existing;
    const seller = (sellerId && this.auth.get(sellerId)) || (quote.createdBy?.id && this.auth.get(quote.createdBy.id)) || null;
    const p = quote.plan;
    const parcels = [
      { label: 'Entrada', value: p.entry, due: p.start, status: 'pendente' },
      ...p.parcels.map((x) => ({ label: x.label, value: x.value, due: x.date, status: 'pendente' })),
    ];
    const pct = this.commissionPct(seller?.id);
    const sale = {
      id: crypto.randomBytes(6).toString('hex'),
      number: this.#number(),
      quoteId: quote.id,
      quoteNumber: quote.number,
      leadId: quote.leadId || null,
      client: { nome: client?.nome || quote.contract?.client?.nome || quote.client, phone: quote.phone || '' },
      sellerId: seller?.id || null,
      sellerName: seller?.name || quote.consultant || '',
      items: quote.items.map((r) => ({ name: r.name, qty: r.qty, price: r.price, total: r.total })),
      total: p.total,
      parcels,
      commission: { pct, value: cents((p.total * pct) / 100), manual: false, status: 'a_pagar', paidAt: null, note: '' },
      status: 'ativa',
      createdAt: new Date().toISOString(),
      createdBy: by?.name || by || 'Sistema',
      history: [],
    };
    this.#log(sale, by, `Venda lançada a partir do orçamento ${quote.number} · ${brl(p.total)} · comissão ${pct}%`);
    if (entryPaid) {
      Object.assign(sale.parcels[0], { status: 'pago', paidAt: today(), method: 'Pix', confirmedBy: 'Sistema (Pix confirmado)' });
      this.#log(sale, 'Sistema', `Entrada recebida (Pix confirmado): ${brl(sale.parcels[0].value)}`);
    }
    this.list.push(sale);
    this.store.save();
    this.notify('sales', { id: sale.id });
    return sale;
  }

  /** Confirma (ou desfaz) o recebimento de uma parcela. */
  setParcel(user, id, index, { paid = true, date = today(), method = 'Pix', note = '' } = {}) {
    this.#admin(user);
    const sale = this.#mustSee(user, id);
    const p = sale.parcels[Number(index)];
    if (!p) throw err(400, 'Parcela não encontrada');
    if (paid) {
      if (!isDate(date)) throw err(400, 'Data inválida');
      Object.assign(p, { status: 'pago', paidAt: date, method: String(method || 'Pix').slice(0, 40), note: String(note || '').slice(0, 200), confirmedBy: user.name });
      this.#log(sale, user, `${p.label} recebida em ${date.split('-').reverse().join('/')} (${p.method}): ${brl(p.value)}`);
    } else {
      Object.assign(p, { status: 'pendente', paidAt: null, method: null, confirmedBy: null });
      this.#log(sale, user, `${p.label}: recebimento desfeito`);
    }
    if (sale.status !== 'cancelada') sale.status = sale.parcels.every((x) => x.status === 'pago') ? 'concluida' : 'ativa';
    this.store.save();
    this.notify('sales', { id });
    return sale;
  }

  /** Comissão: percentual ou valor fixo, e se já foi paga. */
  setCommission(user, id, { pct, value, status, paidAt, note } = {}) {
    this.#admin(user);
    const sale = this.#mustSee(user, id);
    const c = sale.commission;
    const before = `${c.pct}% · ${brl(c.value)} · ${c.status === 'paga' ? 'paga' : 'a pagar'}`;
    if (value !== undefined && value !== '' && value !== null) {
      c.value = cents(value);
      c.manual = true;
      c.pct = sale.total ? cents((c.value / sale.total) * 100) : 0;
    } else if (pct !== undefined && pct !== '' && pct !== null) {
      if (!(Number(pct) >= 0 && Number(pct) <= 100)) throw err(400, 'Percentual inválido');
      c.pct = Number(pct);
      c.value = cents((sale.total * c.pct) / 100);
      c.manual = false;
    }
    if (status) {
      c.status = status === 'paga' ? 'paga' : 'a_pagar';
      c.paidAt = c.status === 'paga' ? (isDate(paidAt) ? paidAt : today()) : null;
    }
    if (note !== undefined) c.note = String(note || '').slice(0, 200);
    this.#log(sale, user, `Comissão: ${before} → ${c.pct}% · ${brl(c.value)} · ${c.status === 'paga' ? `paga em ${c.paidAt.split('-').reverse().join('/')}` : 'a pagar'}`);
    this.store.save();
    this.notify('sales', { id });
    return sale;
  }

  /** Muda o vendedor da venda (e recalcula a comissão se ela não foi definida à mão). */
  setSeller(user, id, sellerId) {
    this.#admin(user);
    const sale = this.#mustSee(user, id);
    const seller = this.auth.get(sellerId);
    if (!seller) throw err(400, 'Vendedor não encontrado');
    const from = sale.sellerName;
    Object.assign(sale, { sellerId: seller.id, sellerName: seller.name });
    if (!sale.commission.manual && sale.commission.status !== 'paga') {
      sale.commission.pct = this.commissionPct(seller.id);
      sale.commission.value = cents((sale.total * sale.commission.pct) / 100);
    }
    this.#log(sale, user, `Vendedor: ${from || '-'} → ${seller.name}`);
    this.store.save();
    return sale;
  }

  cancel(user, id, reason) {
    this.#admin(user);
    const sale = this.#mustSee(user, id);
    if (!String(reason || '').trim()) throw err(400, 'Informe o motivo do cancelamento');
    sale.status = 'cancelada';
    this.#log(sale, user, `Venda cancelada: ${String(reason).slice(0, 200)}`);
    this.store.save();
    this.notify('sales', { id });
    return sale;
  }

  view(sale) {
    const t = today();
    const received = cents(sale.parcels.filter((p) => p.status === 'pago').reduce((s, p) => s + p.value, 0));
    const pending = sale.parcels.filter((p) => p.status !== 'pago');
    const next = pending[0] || null;
    return {
      ...sale,
      received,
      open: cents(sale.total - received),
      overdue: sale.status === 'cancelada' ? 0 : cents(pending.filter((p) => p.due && p.due < t).reduce((s, p) => s + p.value, 0)),
      next: next ? { label: next.label, value: next.value, due: next.due, late: Boolean(next.due && next.due < t) } : null,
    };
  }

  /** Lista visível para o usuário (vendedor: só as dele), com filtros de período e vendedor. */
  listFor(user, { from = '', to = '', seller = '', q = '', status = '' } = {}) {
    const inRange = (iso) => (!from || iso.slice(0, 10) >= from) && (!to || iso.slice(0, 10) <= to);
    const term = String(q).toLowerCase().trim();
    return this.list
      .filter((s) => this.canSee(user, s))
      .filter((s) => !seller || s.sellerId === seller)
      .filter((s) => !status || s.status === status || (status === 'atrasada' && this.view(s).overdue > 0))
      .filter((s) => inRange(s.createdAt))
      .filter((s) => !term || [s.number, s.quoteNumber, s.client.nome, s.client.phone, s.sellerName].some((x) => String(x || '').toLowerCase().includes(term)))
      .slice()
      .reverse()
      .map((s) => this.view(s));
  }

  /** Números do painel: vendas do período e recebimentos do período. */
  summary(user, { from = '', to = '', seller = '' } = {}) {
    const inRange = (iso) => Boolean(iso) && (!from || iso.slice(0, 10) >= from) && (!to || iso.slice(0, 10) <= to);
    const all = this.list.filter((s) => this.canSee(user, s) && s.status !== 'cancelada' && (!seller || s.sellerId === seller));
    const sold = all.filter((s) => inRange(s.createdAt));
    const t = today();
    const sum = (arr, fn) => cents(arr.reduce((x, y) => x + fn(y), 0));
    const paidIn = (s) => s.parcels.filter((p) => p.status === 'pago' && inRange(p.paidAt));
    const bySeller = {};
    for (const s of all) {
      const k = s.sellerId || 'sem';
      bySeller[k] ||= { sellerId: s.sellerId, name: s.sellerName || 'Sem vendedor', sales: 0, sold: 0, received: 0, commissionOpen: 0, commissionPaid: 0 };
      const b = bySeller[k];
      if (inRange(s.createdAt)) { b.sales++; b.sold += s.total; }
      b.received += sum(paidIn(s), (p) => p.value);
      if (s.commission.status === 'paga') { if (inRange(s.commission.paidAt)) b.commissionPaid += s.commission.value; } else b.commissionOpen += s.commission.value;
    }
    return {
      sales: sold.length,
      sold: sum(sold, (s) => s.total),
      received: sum(all, (s) => sum(paidIn(s), (p) => p.value)),
      toReceive: sum(all, (s) => sum(s.parcels.filter((p) => p.status !== 'pago'), (p) => p.value)),
      overdue: sum(all, (s) => sum(s.parcels.filter((p) => p.status !== 'pago' && p.due && p.due < t), (p) => p.value)),
      commissionOpen: sum(all.filter((s) => s.commission.status !== 'paga'), (s) => s.commission.value),
      commissionPaid: sum(all.filter((s) => s.commission.status === 'paga' && inRange(s.commission.paidAt)), (s) => s.commission.value),
      bySeller: Object.values(bySeller).map((b) => ({ ...b, sold: cents(b.sold), received: cents(b.received), commissionOpen: cents(b.commissionOpen), commissionPaid: cents(b.commissionPaid) })).sort((a, b) => b.sold - a.sold),
    };
  }
}
