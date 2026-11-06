// Agenda e financeiro PESSOAL de cada pessoa (a assistente pessoal "Ana"). Fica separado da empresa: não entra no Caixa Migra,
// em relatório, painel nem na Maria. Cada pessoa só tem acesso à própria caixa (userId); não existe função que leia a de outra.
import crypto from 'node:crypto';
import { addDays, addMonths, isoOf, fold1 } from './ana-dates.js';

export const CATEGORIES = ['Alimentação', 'Restaurantes e lanches', 'Mercado', 'Transporte e combustível', 'Moradia e contas', 'Saúde', 'Educação', 'Família e filhos', 'Lazer', 'Compras', 'Assinaturas', 'Parcelas e dívidas', 'Dízimo e ofertas', 'Investimentos', 'Salário e rendas', 'Outros'];
const HINTS = [
  [/dizimo|oferta|igreja/, 'Dízimo e ofertas'],
  [/restaurante|lanche|pizza|hamburguer|cafe|padaria|lanchonete|sorvete|delivery|ifood|almoco|jantar/, 'Restaurantes e lanches'],
  [/supermercado|mercado|feira|acougue|hortifruti/, 'Mercado'],
  [/gasolina|etanol|diesel|combustivel|uber|taxi|passagem|pedagio|estacionamento|onibus|oficina|mecanico/, 'Transporte e combustivel'.replace('combustivel', 'combustível')],
  [/aluguel|condominio|luz|energia|agua|internet|telefone|gas\b|iptu|ipva/, 'Moradia e contas'],
  [/farmacia|remedio|medico|consulta|dentista|exame|plano de saude|hospital|psicolog/, 'Saúde'],
  [/escola|faculdade|curso|mensalidade|livro|aula/, 'Educação'],
  [/filho|filha|esposa|marido|mesada|brinquedo|fralda|crianca/, 'Família e filhos'],
  [/cinema|viagem|passeio|show|bar\b|balada|jogo|hotel|streaming|netflix|spotify|academia/, 'Lazer'],
  [/assinatura|mensalidade do app|licenca|plano mensal/, 'Assinaturas'],
  [/parcela|prestacao|financiamento|emprestimo|cartao de credito|fatura|consorcio/, 'Parcelas e dívidas'],
  [/roupa|sapato|tenis|eletronico|celular|presente|loja|shopping/, 'Compras'],
  [/salario|pro-?labore|retirada|rendimento|aluguel recebido|freela|comissao/, 'Salário e rendas'],
  [/invest|acoes|tesouro|cdb|poupanca|bitcoin|cripto/, 'Investimentos'],
];
const round = (v) => Math.round(Number(v) * 100) / 100;
const money = (v, c = 'BRL') => (c === 'BRL' ? `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `${{ USD: 'US$', PYG: 'Gs.' }[c] || c} ${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: c === 'PYG' ? 0 : 2 })}`);
const newId = () => crypto.randomBytes(5).toString('hex');
const err = (msg) => Object.assign(new Error(msg), { status: 400 });

/** Categoria pela descrição ("café" → Restaurantes e lanches). Sem pista, "Outros". */
export function categoryOf(description, kind = 'saida') {
  const n = fold1(description);
  const hit = HINTS.find(([re]) => re.test(n));
  if (hit && CATEGORIES.includes(hit[1])) return hit[1];
  return kind === 'entrada' ? 'Salário e rendas' : 'Outros';
}

/** Categoria dita pelo nome ("lazer", "saúde", "mercado", "restaurantes"...). Vazio se não houver. */
export function categoryFromName(text) {
  const n = fold1(text);
  for (const c of CATEGORIES) {
    for (const tok of fold1(c).split(/[^a-z]+/).filter((x) => x.length >= 4 && !['familia', 'outros'].includes(x) || x === 'familia')) {
      const stem = tok.length > 6 ? tok.slice(0, -1) : tok;
      if (new RegExp(`\\b${stem}`).test(n)) return c;
    }
  }
  return '';
}

export class Personal {
  constructor({ store, now = () => new Date() }) {
    this.store = store;
    this.now = now;
  }

  today() { return isoOf(this.now()); }

  /** A caixa de UMA pessoa. Sem id, ninguém: nunca devolve a de outra. */
  #box(userId) {
    if (!userId) throw err('Pessoa não identificada');
    const all = (this.store.data.personal ||= {});
    return (all[userId] ||= { items: [], entries: [], budgets: {}, settings: {}, last: null });
  }

  settings(userId) { return this.#box(userId).settings; }
  setSetting(userId, k, v) { this.#box(userId).settings[k] = v; this.store.save(); }

  // ---------- agenda ----------
  /** kind: compromisso (com hora, avisa antes), lembrete (avisa na hora) ou conta (vencimento de parcela/conta). */
  addItem(userId, { kind = 'lembrete', title, date, time = '', remindMin = null, amount = null, currency = 'BRL', seriesId = null, entryId = null } = {}) {
    const t = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!t) throw err('Diga o que é o compromisso ou lembrete');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw err('Data inválida');
    const box = this.#box(userId);
    const it = { id: newId(), kind, title: t, date, time: /^\d{2}:\d{2}$/.test(time) ? time : '', remindMin: remindMin ?? (kind === 'compromisso' ? 30 : 0), amount, currency, seriesId, entryId, notified: false, doneAt: null, cancelled: false, createdAt: this.now().toISOString() };
    box.items.push(it);
    return it;
  }

  /** Itens ativos entre duas datas (inclusive), em ordem. */
  agenda(userId, from, to = from) {
    return this.#box(userId).items
      .filter((i) => !i.cancelled && !i.doneAt && i.date >= from && i.date <= to)
      .sort((a, b) => (a.date + (a.time || '99:99')).localeCompare(b.date + (b.time || '99:99')));
  }

  /** Itens com horário que já devem avisar e ainda não avisaram (até 3h de atraso, p.ex. servidor reiniciando; depois disso o aviso perdeu o sentido). */
  dueReminders(userId, now = this.now()) {
    const ms = now.getTime();
    return this.#box(userId).items.filter((i) => {
      if (i.cancelled || i.doneAt || i.notified || !i.time) return false;
      const at = new Date(`${i.date}T${i.time}:00`).getTime() - i.remindMin * 60_000;
      return at <= ms && ms - at <= 3 * 3_600_000;
    });
  }

  markNotified(userId, id) {
    const it = this.#box(userId).items.find((i) => i.id === id);
    if (it) { it.notified = true; this.store.save(); }
  }

  #findItem(box, term, { onlyOpen = true } = {}) {
    const n = fold1(term);
    const list = box.items.filter((i) => !i.cancelled && (!onlyOpen || !i.doneAt));
    const hits = n ? list.filter((i) => fold1(i.title).includes(n) || n.split(/\s+/).filter((w) => w.length > 3).some((w) => fold1(i.title).includes(w))) : [];
    return hits.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  }

  /** Cancela (apaga da agenda) o compromisso mais próximo que combina com o texto. */
  cancelItem(userId, term) {
    const box = this.#box(userId);
    const hits = this.#findItem(box, term).filter((i) => i.date >= this.today()).slice(0, 5);
    if (!hits.length) return { item: null, others: 0 };
    hits[0].cancelled = true;
    this.store.save();
    return { item: hits[0], others: hits.length - 1 };
  }

  // ---------- finanças ----------
  addEntry(userId, { kind = 'saida', amount, currency = 'BRL', category = '', description = '', date = null, status = 'pago', dueDate = null, seriesId = null, installment = '' } = {}) {
    const v = round(amount);
    if (!(v > 0)) throw err('O valor precisa ser maior que zero');
    if (!['entrada', 'saida'].includes(kind)) throw err('Tipo inválido');
    if (!['BRL', 'USD', 'PYG'].includes(currency)) throw err('Moeda inválida');
    const desc = String(description || '').replace(/\s+/g, ' ').trim().slice(0, 160) || (kind === 'entrada' ? 'Entrada' : 'Gasto');
    const e = { id: newId(), kind, amount: v, currency, category: CATEGORIES.includes(category) ? category : categoryOf(desc, kind), description: desc, date: date || this.today(), status: status === 'a_pagar' ? 'a_pagar' : 'pago', dueDate: dueDate || null, seriesId, installment, createdAt: this.now().toISOString(), deleted: false };
    this.#box(userId).entries.push(e);
    return e;
  }

  /** Compra parcelada: cria as N parcelas "a pagar" (uma por mês) e um aviso de vencimento de cada uma na agenda. */
  installments(userId, { description, amount, count, firstDue, currency = 'BRL', category = '' } = {}) {
    const n = Math.floor(Number(count));
    if (!(n >= 2 && n <= 120)) throw err('Número de parcelas inválido (de 2 a 120)');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(firstDue))) throw err('Data da primeira parcela inválida');
    const seriesId = newId();
    const entries = []; const items = [];
    for (let i = 0; i < n; i++) {
      const due = addMonths(firstDue, i);
      const e = this.addEntry(userId, { kind: 'saida', amount, currency, category: category || 'Parcelas e dívidas', description: `${description} (parcela ${i + 1}/${n})`, date: due, status: 'a_pagar', dueDate: due, seriesId, installment: `${i + 1}/${n}` });
      entries.push(e);
      items.push(this.addItem(userId, { kind: 'conta', title: `Parcela ${i + 1}/${n} · ${description} · ${money(amount, currency)}`, date: due, time: '', amount: round(amount), currency, seriesId, entryId: e.id }));
    }
    this.store.save();
    return { seriesId, entries, items, total: round(Number(amount) * n), last: addMonths(firstDue, n - 1) };
  }

  /** "Paguei a parcela do carro": marca como paga a parcela em aberto mais próxima que combina. */
  pay(userId, term) {
    const box = this.#box(userId);
    const n = fold1(term);
    const open = box.entries.filter((e) => !e.deleted && e.status === 'a_pagar' && (!n || fold1(e.description).includes(n) || n.split(/\s+/).filter((w) => w.length > 3).some((w) => fold1(e.description).includes(w))));
    open.sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
    const e = open[0];
    if (!e) return null;
    box.last = { label: 'pagamento', reverts: [{ entryId: e.id, status: 'a_pagar', date: e.date }] };
    e.status = 'pago';
    e.date = this.today();
    const bill = box.items.find((i) => i.entryId === e.id);
    if (bill) { bill.doneAt = this.now().toISOString(); box.last.reverts.push({ itemId: bill.id }); }
    this.store.save();
    return { entry: e, others: open.length - 1 };
  }

  /** Registra o que acabou de ser criado, para "desfazer". */
  remember(userId, label, { items = [], entries = [] } = {}) {
    const box = this.#box(userId);
    box.last = { label, items: items.map((i) => i.id), entries: entries.map((e) => e.id) };
    this.store.save();
  }

  undo(userId) {
    const box = this.#box(userId);
    const last = box.last;
    if (!last) return null;
    for (const id of last.items || []) { const it = box.items.find((i) => i.id === id); if (it) it.cancelled = true; }
    for (const id of last.entries || []) { const e = box.entries.find((x) => x.id === id); if (e) e.deleted = true; }
    for (const r of last.reverts || []) {
      if (r.entryId) { const e = box.entries.find((x) => x.id === r.entryId); if (e) { e.status = r.status; e.date = r.date; } }
      if (r.itemId) { const it = box.items.find((x) => x.id === r.itemId); if (it) it.doneAt = null; }
    }
    box.last = null;
    this.store.save();
    return last;
  }

  entries(userId, { from = '', to = '', kind = '', term = '', status = '' } = {}) {
    const n = fold1(term);
    return this.#box(userId).entries
      .filter((e) => !e.deleted && (!from || e.date >= from) && (!to || e.date <= to) && (!kind || e.kind === kind) && (!status || e.status === status)
        && (!n || fold1(`${e.description} ${e.category}`).includes(n)))
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  /** Totais por moeda (nunca somam moedas diferentes), por categoria, e o que ainda vai vencer. */
  summary(userId, from, to) {
    const rows = this.entries(userId, { from, to });
    const byCur = {}; const cat = {};
    for (const e of rows) {
      if (e.status === 'a_pagar') continue;
      const c = (byCur[e.currency] ||= { entradas: 0, saidas: 0 });
      if (e.kind === 'entrada') c.entradas = round(c.entradas + e.amount);
      else { c.saidas = round(c.saidas + e.amount); const k = `${e.currency}|${e.category}`; cat[k] = round((cat[k] || 0) + e.amount); }
    }
    for (const c of Object.values(byCur)) c.saldo = round(c.entradas - c.saidas);
    const spending = Object.entries(cat).map(([k, total]) => { const [currency, category] = k.split('|'); return { currency, category, total }; }).sort((a, b) => b.total - a.total);
    return { byCurrency: byCur, spending, count: rows.length };
  }

  /** Contas a pagar (parcelas etc.) nos próximos dias. */
  upcoming(userId, days = 30) {
    const t = this.today();
    const limit = addDays(t, days);
    return this.#box(userId).entries.filter((e) => !e.deleted && e.status === 'a_pagar' && e.dueDate && e.dueDate <= limit).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }

  // ---------- orçamento ----------
  setBudget(userId, category, amount) {
    const v = round(amount);
    if (!(v > 0)) throw err('O orçamento precisa ser maior que zero');
    const key = category === 'total' ? 'total' : CATEGORIES.includes(category) ? category : null;
    if (!key) throw err('Categoria inválida');
    this.#box(userId).budgets[key] = v;
    this.store.save();
    return { category: key, amount: v };
  }

  /** Orçamento do mês (em reais): quanto já gastou de cada categoria que tem limite. */
  budgetStatus(userId, from, to) {
    const box = this.#box(userId);
    const spent = {}; let totalSpent = 0;
    for (const e of this.entries(userId, { from, to, kind: 'saida' })) {
      if (e.status === 'a_pagar' || e.currency !== 'BRL') continue;
      spent[e.category] = round((spent[e.category] || 0) + e.amount);
      totalSpent = round(totalSpent + e.amount);
    }
    const rows = Object.entries(box.budgets).filter(([k]) => k !== 'total').map(([category, limit]) => ({ category, limit, spent: spent[category] || 0, pct: Math.round(((spent[category] || 0) / limit) * 100) }));
    return { rows: rows.sort((a, b) => b.pct - a.pct), total: box.budgets.total ? { limit: box.budgets.total, spent: totalSpent, pct: Math.round((totalSpent / box.budgets.total) * 100) } : null, spentNoBudget: totalSpent };
  }

  // ---------- exportar ----------
  /** Planilha CSV (fórmulas neutralizadas) para guardar ou levar para outro app (ex.: Brisa). */
  csv(userId, { from = '', to = '' } = {}) {
    const safe = (v) => { const s = String(v ?? '').replace(/"/g, '""'); return /^[=+\-@\t\r]/.test(s) ? `"'${s}"` : `"${s}"`; };
    const lines = ['data;tipo;valor;moeda;categoria;descricao;situacao;vencimento;parcela'];
    for (const e of this.entries(userId, { from, to }).slice().reverse()) lines.push([e.date, e.kind, String(e.amount).replace('.', ','), e.currency, e.category, e.description, e.status, e.dueDate || '', e.installment].map(safe).join(';'));
    return `﻿${lines.join('\n')}`;
  }
}

export { money as personalMoney };
