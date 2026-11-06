// Agenda e financeiro PESSOAL de cada pessoa (a assistente pessoal "Ana"). Fica separado da empresa: não entra no Caixa Migra,
// em relatório, painel nem na Maria. Cada pessoa só tem acesso à própria caixa (userId); não existe função que leia a de outra.
import crypto from 'node:crypto';
import { addDays, addMonths, isoOf, fromIso, fold1 } from './ana-dates.js';
import { STORES, storeOf } from './shopping.js';

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
    const b = (all[userId] ||= { items: [], entries: [], budgets: {}, settings: {}, last: null });
    b.shopping ||= []; b.goals ||= []; b.series ||= {}; b.storeMap ||= {};
    return b;
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
  remember(userId, label, { items = [], entries = [], shopping = [] } = {}) {
    const box = this.#box(userId);
    box.last = { label, items: items.map((i) => i.id), entries: entries.map((e) => e.id), shopping: shopping.map((i) => i.id) };
    this.store.save();
  }

  undo(userId) {
    const box = this.#box(userId);
    const last = box.last;
    if (!last) return null;
    for (const id of last.items || []) { const it = box.items.find((i) => i.id === id); if (it) it.cancelled = true; }
    for (const id of last.entries || []) { const e = box.entries.find((x) => x.id === id); if (e) e.deleted = true; }
    for (const id of last.shoppingDone || []) { const i = box.shopping.find((x) => x.id === id); if (i) { i.done = false; i.doneAt = null; } }
    for (const id of last.shoppingCancelled || []) { const i = box.shopping.find((x) => x.id === id); if (i) i.cancelled = false; }
    for (const id of last.shopping || []) { const i = box.shopping.find((x) => x.id === id); if (i) i.cancelled = true; }
    if (last.goalContribution) { const g = box.goals.find((x) => x.id === last.goalContribution.id); if (g) { g.saved = round(g.saved - last.goalContribution.amount); g.contributions.pop(); } }
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

  // ---------- lista de compras (por tipo de loja) ----------
  /** Guarda a preferência da pessoa ("o martelo é da casa de ferramentas"), usada nas próximas vezes. */
  learnStore(userId, item, store) {
    const box = this.#box(userId);
    const k = fold1(item).replace(/[^a-z0-9 -]/g, ' ').replace(/\s+/g, ' ').trim();
    if (k && STORES.includes(store)) { box.storeMap[k] = store; this.store.save(); }
  }

  /** A pessoa já ensinou em que loja esse item se compra? */
  knowsStore(userId, item) {
    const k = fold1(item).replace(/[^a-z0-9 -]/g, ' ').replace(/\s+/g, ' ').trim();
    return Object.keys(this.#box(userId).storeMap).some((x) => k.includes(x));
  }

  /** Acrescenta um item. O tipo de loja vem do que a pessoa disse, do que ela já ensinou ou das palavras conhecidas. Repetido em aberto não duplica. */
  addShopping(userId, { text, qty = '', store = '', targetDate = null } = {}) {
    const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!t) throw err('Diga o que precisa comprar');
    const box = this.#box(userId);
    const where = STORES.includes(store) ? store : storeOf(t, box.storeMap);
    const dup = box.shopping.find((i) => !i.done && !i.cancelled && fold1(i.text) === fold1(t) && i.store === where);
    if (dup) return { item: dup, duplicate: true };
    const it = { id: newId(), text: t, qty: String(qty || '').slice(0, 30), store: where, targetDate, done: false, doneAt: null, cancelled: false, addedAt: this.now().toISOString() };
    box.shopping.push(it);
    return { item: it, duplicate: false };
  }

  /** Itens em aberto, agrupados por loja (ou só de uma). */
  shoppingList(userId, { store = '' } = {}) {
    const open = this.#box(userId).shopping.filter((i) => !i.done && !i.cancelled && (!store || i.store === store));
    const groups = {};
    for (const i of open) (groups[i.store] ||= []).push(i);
    return STORES.filter((st) => groups[st]).map((st) => ({ store: st, items: groups[st] }));
  }

  #matchShopping(box, term, store) {
    const n = fold1(term);
    return box.shopping.filter((i) => !i.done && !i.cancelled && (!store || i.store === store)
      && (!n || fold1(i.text).includes(n) || n.includes(fold1(i.text)) || n.split(/\s+/).filter((w) => w.length > 3).some((w) => fold1(i.text).includes(w.replace(/(es|s)$/, '')))));
  }

  /** "Comprei o martelo" / "comprei tudo do mercado": marca como comprado. */
  buy(userId, term, { store = '', all = false } = {}) {
    const box = this.#box(userId);
    const hits = all ? box.shopping.filter((i) => !i.done && !i.cancelled && (!store || i.store === store)) : this.#matchShopping(box, term, store);
    for (const i of hits) { i.done = true; i.doneAt = this.now().toISOString(); }
    if (hits.length) { box.last = { label: 'compras', shoppingDone: hits.map((i) => i.id) }; this.store.save(); }
    return hits;
  }

  /** Tira da lista (apaga só da lista da PRÓPRIA pessoa). */
  dropShopping(userId, term, { store = '' } = {}) {
    const box = this.#box(userId);
    const hits = this.#matchShopping(box, term, store);
    for (const i of hits) i.cancelled = true;
    if (hits.length) { box.last = { label: 'lista', shoppingCancelled: hits.map((i) => i.id) }; this.store.save(); }
    return hits;
  }

  /** Muda um item de loja e aprende para as próximas vezes. */
  moveShopping(userId, term, store) {
    const box = this.#box(userId);
    const hits = this.#matchShopping(box, term, '');
    for (const i of hits) i.store = store;
    for (const i of hits) this.learnStore(userId, i.text, store);
    if (hits.length) this.store.save();
    return hits;
  }

  // ---------- contas e lembretes que se repetem ----------
  /**
   * Repetição mensal, semanal, anual ou diária. As próximas ocorrências já ficam criadas (e a Ana renova sozinha): com valor, cada uma é uma
   * conta "a pagar" com aviso de vencimento; sem valor, é só um lembrete.
   */
  recurring(userId, { title, freq, firstDate, time = '', amount = null, currency = 'BRL', category = '', day = null } = {}) {
    if (!['mensal', 'semanal', 'anual', 'diaria'].includes(freq)) throw err('Repetição inválida');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(firstDate))) throw err('Data inválida');
    const box = this.#box(userId);
    const seriesId = newId();
    box.series[seriesId] = { title: String(title).slice(0, 160), freq, time, amount: amount ? round(amount) : null, currency, category, last: null, active: true, day: freq === 'mensal' && day >= 1 && day <= 31 ? Math.floor(day) : null };
    const made = this.#extend(userId, seriesId, firstDate);
    this.store.save();
    return { seriesId, ...made };
  }

  /** A k-ésima ocorrência. Mensal "todo dia 31": nos meses curtos cai no último dia, mas volta ao 31 depois (sem "escorregar"). */
  #occurrence(sr, k) {
    if (sr.freq === 'mensal' && sr.day) {
      const m = addMonths(`${sr.first.slice(0, 8)}01`, k);
      const last = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate();
      return `${m.slice(0, 8)}${String(Math.min(sr.day, last)).padStart(2, '0')}`;
    }
    return this.#step(sr.freq, sr.first, k);
  }

  #step(freq, date, n) {
    return freq === 'mensal' ? addMonths(date, n) : freq === 'anual' ? addMonths(date, n * 12) : freq === 'semanal' ? addDays(date, n * 7) : addDays(date, n);
  }

  #extend(userId, seriesId, startDate = null) {
    const box = this.#box(userId);
    const sr = box.series[seriesId];
    if (!sr?.active) return { items: [], entries: [] };
    if (startDate) { sr.first = startDate; sr.n = 0; }
    const horizon = { mensal: 370, semanal: 190, anual: 365 * 4 + 10, diaria: 60 }[sr.freq];
    const limit = addDays(this.today(), horizon);
    const items = []; const entries = [];
    let guard = 0;
    for (;;) {
      const date = this.#occurrence(sr, sr.n); // sempre a partir da primeira data: dia 31 não "escorrega" para 28
      if (date > limit || guard++ > 400) break;
      if (sr.amount) {
        const e = this.addEntry(userId, { kind: 'saida', amount: sr.amount, currency: sr.currency, category: sr.category || categoryOf(sr.title), description: sr.title, date, status: 'a_pagar', dueDate: date, seriesId, installment: '' });
        entries.push(e);
        items.push(this.addItem(userId, { kind: 'conta', title: `${sr.title} · ${money(sr.amount, sr.currency)}`, date, time: '', amount: sr.amount, currency: sr.currency, seriesId, entryId: e.id }));
      } else {
        items.push(this.addItem(userId, { kind: 'lembrete', title: sr.title, date, time: sr.time, remindMin: 0, seriesId }));
      }
      sr.last = date;
      sr.n += 1;
    }
    return { items, entries };
  }

  /** Mantém as repetições com ocorrências à frente (chamada uma vez por dia). */
  renewSeries(userId) {
    const box = this.#box(userId);
    let added = 0;
    for (const id of Object.keys(box.series)) { const r = this.#extend(userId, id); added += r.items.length; }
    if (added) this.store.save();
    return added;
  }

  /** Cancela uma repetição inteira (as próximas ocorrências e as contas em aberto dela). */
  cancelSeries(userId, seriesId) {
    const box = this.#box(userId);
    const sr = box.series[seriesId];
    if (!sr) return 0;
    sr.active = false;
    const t = this.today();
    let n = 0;
    for (const i of box.items) if (i.seriesId === seriesId && !i.cancelled && i.date >= t) { i.cancelled = true; n++; }
    for (const e of box.entries) if (e.seriesId === seriesId && e.status === 'a_pagar' && (e.dueDate || e.date) >= t) e.deleted = true;
    this.store.save();
    return n;
  }

  /** O item da série mais próximo que combina com o texto. */
  findSeriesItem(userId, term) {
    const box = this.#box(userId);
    const hit = this.#findItem(box, term).filter((i) => i.seriesId && box.series[i.seriesId]?.freq && box.series[i.seriesId].active)[0];
    return hit ? { item: hit, series: box.series[hit.seriesId] } : null;
  }

  // ---------- metas (juntar dinheiro para algo) ----------
  addGoal(userId, { name, target, deadline = null, currency = 'BRL' } = {}) {
    const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!n) throw err('Diga o nome da meta');
    if (!(round(target) > 0)) throw err('O valor da meta precisa ser maior que zero');
    const g = { id: newId(), name: n, target: round(target), currency, deadline, saved: 0, contributions: [], cancelled: false, createdAt: this.now().toISOString() };
    this.#box(userId).goals.push(g);
    this.store.save();
    return g;
  }

  goals(userId) { return this.#box(userId).goals.filter((g) => !g.cancelled); }

  /** Guarda dinheiro numa meta (a única, ou a que combina com o nome). */
  contribute(userId, term, amount) {
    const v = round(amount);
    if (!(v > 0)) throw err('O valor precisa ser maior que zero');
    const list = this.goals(userId);
    const n = fold1(term);
    const g = (n && list.find((x) => fold1(x.name).includes(n) || n.includes(fold1(x.name)))) || (list.length === 1 ? list[0] : null);
    if (!g) return { goal: null, options: list };
    g.saved = round(g.saved + v);
    g.contributions.push({ at: this.now().toISOString(), amount: v });
    this.#box(userId).last = { label: 'meta', goalContribution: { id: g.id, amount: v } };
    this.store.save();
    return { goal: g };
  }

  /** Andamento de cada meta: quanto falta e quanto guardar por mês até o prazo. */
  goalStatus(g) {
    const left = Math.max(0, round(g.target - g.saved));
    const pct = Math.min(100, Math.round((g.saved / g.target) * 100));
    let monthly = null; let months = null;
    if (g.deadline && left > 0) {
      const t = fromIso(this.today()); const d = fromIso(g.deadline);
      months = Math.max(1, (d.getFullYear() - t.getFullYear()) * 12 + (d.getMonth() - t.getMonth()) + (d.getDate() >= t.getDate() ? 1 : 0));
      monthly = round(left / months);
    }
    return { left, pct, monthly, months, late: Boolean(g.deadline && g.deadline < this.today() && left > 0) };
  }

  // ---------- comparação e projeção ----------
  /** Categorias que mais mudaram em relação ao período anterior (só diferenças que importam). */
  compare(userId, from, to, prevFrom, prevTo) {
    const a = this.summary(userId, from, to).spending.filter((x) => x.currency === 'BRL');
    const b = Object.fromEntries(this.summary(userId, prevFrom, prevTo).spending.filter((x) => x.currency === 'BRL').map((x) => [x.category, x.total]));
    return a.map((x) => ({ category: x.category, now: x.total, before: b[x.category] || 0, diff: round(x.total - (b[x.category] || 0)), pct: b[x.category] ? Math.round(((x.total - b[x.category]) / b[x.category]) * 100) : null }))
      .filter((x) => x.before > 0 && Math.abs(x.diff) >= 50 && Math.abs(x.pct) >= 20).sort((p, q) => Math.abs(q.diff) - Math.abs(p.diff)).slice(0, 3);
  }

  /** Como o mês deve fechar se o ritmo continuar: já gasto + contas que ainda vencem + média diária dos gastos variáveis. */
  forecast(userId, monthFrom, monthTo) {
    const today = this.today();
    const rows = this.entries(userId, { from: monthFrom, to: monthTo, kind: 'saida' }).filter((e) => e.currency === 'BRL');
    const paid = rows.filter((e) => e.status !== 'a_pagar');
    const spent = round(paid.reduce((x, e) => x + e.amount, 0));
    const bills = round(rows.filter((e) => e.status === 'a_pagar' && (e.dueDate || e.date) >= today).reduce((x, e) => x + e.amount, 0));
    const variable = paid.filter((e) => !e.seriesId).reduce((x, e) => x + e.amount, 0);
    const elapsed = Math.max(1, Math.round((fromIso(today) - fromIso(monthFrom)) / 86_400_000) + 1);
    const remaining = Math.max(0, Math.round((fromIso(monthTo) - fromIso(today)) / 86_400_000));
    const projectedVariable = round((variable / elapsed) * remaining);
    return { spent, bills, projectedVariable, projected: round(spent + bills + projectedVariable), elapsed, remaining };
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
