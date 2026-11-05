// Níveis de comissão (por meta de vendas do mês) e saques de comissão.
// Regra da Migra: a comissão só fica disponível na proporção do que o cliente já pagou (recebimento confirmado
// pelo administrador). O vendedor pede o saque do que está disponível; o administrador aprova e marca como pago.
import crypto from 'node:crypto';

const err = (status, message) => Object.assign(new Error(message), { status });
const cents = (v) => Math.round(Number(v || 0) * 100) / 100;
const clip = (v, n) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, n);
const month = (d = new Date()) => d.toISOString().slice(0, 7);

// Jornada do Consultor Migra: cada nível conta a história de quem ajuda famílias a recomeçar no Paraguai.
// Raiz (começa a criar raízes), Ponte (liga as pessoas ao novo país, como a Ponte da Amizade),
// Horizonte (abre caminhos e cresce), Legado (deixa marca na Migra; porta de entrada para o plano de projetos).
// Os percentuais e as metas do mês vieram do sistema antigo e o administrador ajusta no painel.
export const DEFAULT_LEVELS = [
  { id: 'raiz', label: 'Raiz', pct: 2, goal: 0, color: '#7a8f3a', tagline: 'Criando raízes na Migra' },
  { id: 'ponte', label: 'Ponte', pct: 3, goal: 50000, color: '#2f7d8c', tagline: 'Ligando famílias ao Paraguai' },
  { id: 'horizonte', label: 'Horizonte', pct: 3.5, goal: 200000, color: '#c08a1e', tagline: 'Abrindo novos caminhos' },
  { id: 'legado', label: 'Legado', pct: 5, goal: 500000, color: '#8a6d1f', tagline: 'Construindo o futuro da Migra' },
];
// Nomes do sistema antigo (pedras) → jornada Migra, mantendo percentual e meta.
const RENAME = { bronze: 'raiz', esmeralda: 'ponte', safira: 'horizonte', diamond: 'legado', diamante: 'legado' };
const migraLevel = (p) => {
  const to = RENAME[String(p.id || '').toLowerCase()] || RENAME[String(p.label || '').toLowerCase()];
  const d = to && DEFAULT_LEVELS.find((x) => x.id === to);
  return d ? { ...p, id: d.id, label: d.label, color: d.color, tagline: d.tagline } : p;
};

export class Commissions {
  constructor({ store, sales, auth, notify = async () => {}, now = () => new Date() }) {
    Object.assign(this, { store, sales, auth, notify, now });
    store.data.withdrawals ||= [];
  }

  get config() { const c = this.store.settings.commissionLevels || {}; return { enabled: Boolean(c.enabled), plans: (c.plans?.length ? c.plans : DEFAULT_LEVELS).map((p) => migraLevel({ ...p })) }; }
  get withdrawals() { return this.store.data.withdrawals; }

  setLevels(user, { enabled, plans } = {}) {
    if (user.role !== 'admin') throw err(403, 'Só o administrador muda os níveis');
    const next = this.config;
    if (enabled !== undefined) next.enabled = Boolean(enabled);
    if (plans !== undefined) {
      if (!Array.isArray(plans) || !plans.length || plans.length > 10) throw err(400, 'Informe de 1 a 10 níveis');
      next.plans = plans.map((p, i) => {
        const pct = Number(p.pct); const goal = Number(p.goal || 0);
        if (!clip(p.label, 30)) throw err(400, 'Dê um nome a cada nível');
        if (!(pct >= 0 && pct <= 100)) throw err(400, `Comissão inválida no nível ${p.label}`);
        if (!(goal >= 0)) throw err(400, `Meta inválida no nível ${p.label}`);
        return { id: clip(p.id, 20) || `n${i + 1}`, label: clip(p.label, 30), pct, goal, color: /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : '#64748b', tagline: clip(p.tagline, 60) || DEFAULT_LEVELS.find((d) => d.id === p.id)?.tagline || '' };
      }).sort((a, b) => a.goal - b.goal);
    }
    this.store.settings.commissionLevels = next;
    this.store.save();
    return next;
  }

  /** Vendas do vendedor no mês (valor total das vendas lançadas no mês, sem as canceladas). */
  soldInMonth(sellerId, ym = month(this.now())) {
    return cents(this.sales.list.filter((s) => s.sellerId === sellerId && s.status !== 'cancelada' && String(s.createdAt || '').slice(0, 7) === ym).reduce((a, s) => a + Number(s.total || 0), 0));
  }

  /** Nível do vendedor no mês e quanto falta para o próximo. */
  levelOf(sellerId, ym = month(this.now())) {
    const plans = this.config.plans;
    const sold = this.soldInMonth(sellerId, ym);
    let level = plans[0];
    for (const p of plans) if (sold >= p.goal) level = p;
    const next = plans.find((p) => p.goal > sold) || null;
    return { month: ym, sold, level, next: next ? { ...next, missing: cents(next.goal - sold) } : null };
  }

  /** Percentual pelo nível (ou null quando os níveis estão desligados). */
  levelPct(sellerId) { return this.config.enabled && sellerId ? this.levelOf(sellerId).level.pct : null; }

  /** Ao fechar o mês (ou quando o administrador pedir): aplica o nível final às vendas do mês ainda não pagas e sem comissão manual. */
  recalcMonth(user, ym = month(this.now())) {
    if (user.role !== 'admin') throw err(403, 'Só o administrador recalcula comissões');
    if (!this.config.enabled) throw err(400, 'Ligue os níveis de comissão primeiro');
    let changed = 0;
    for (const s of this.sales.list) {
      if (s.status === 'cancelada' || !s.sellerId || String(s.createdAt || '').slice(0, 7) !== ym || s.commission?.manual || s.commission?.status === 'paga' || s.affiliate) continue;
      const own = this.auth.get(s.sellerId)?.commissionPct;
      if (own !== null && own !== undefined && own !== '') continue; // comissão definida para a pessoa vale mais
      const pct = this.levelOf(s.sellerId, ym).level.pct;
      if (s.commission.pct === pct) continue;
      s.history.push({ at: this.now().toISOString(), by: user.name, text: `Comissão pelo nível do mês: ${s.commission.pct}% → ${pct}%` });
      s.commission.pct = pct; s.commission.value = cents((Number(s.total) * pct) / 100);
      changed += 1;
    }
    if (changed) this.store.save();
    return { changed, month: ym };
  }

  /** Comissão já liberada de uma venda: proporcional ao que o cliente pagou (parcelas confirmadas). */
  static released(sale) {
    if (!sale || sale.status === 'cancelada' || !sale.commission || !(Number(sale.total) > 0)) return 0;
    const paid = (sale.parcels || []).filter((p) => p.status === 'pago').reduce((a, p) => a + Number(p.value || 0), 0);
    return cents(Number(sale.commission.value || 0) * Math.min(1, paid / Number(sale.total)));
  }

  /** Saldo do vendedor: comissão total, liberada, já sacada/pedida e disponível para saque. */
  balance(sellerId) {
    const mine = this.sales.list.filter((s) => s.sellerId === sellerId && s.status !== 'cancelada' && s.commission?.status !== 'paga');
    const total = cents(mine.reduce((a, s) => a + Number(s.commission?.value || 0), 0));
    const released = cents(mine.reduce((a, s) => a + Commissions.released(s), 0));
    const ws = this.withdrawals.filter((w) => w.sellerId === sellerId);
    const sum = (st) => cents(ws.filter((w) => st.includes(w.status)).reduce((a, w) => a + w.amount, 0));
    const pending = sum(['pedido', 'aprovado']); const paid = sum(['pago']);
    return { total, released, pending, paid, available: cents(Math.max(0, released - pending - paid)), waiting: cents(Math.max(0, total - released)) };
  }

  mine(user) {
    return { ...this.levelOf(user.id), levelsOn: this.config.enabled, plans: this.config.plans, balance: this.balance(user.id), withdrawals: this.withdrawals.filter((w) => w.sellerId === user.id).slice(-50).reverse() };
  }

  overview(user) {
    if (user.role !== 'admin') throw err(403, 'Só o administrador');
    const sellers = this.auth.users.filter((u) => u.active !== false && !u.pending && (u.role !== 'admin' || this.sales.list.some((s) => s.sellerId === u.id)));
    return {
      config: this.config,
      rows: sellers.map((u) => ({ id: u.id, name: u.name, ...this.levelOf(u.id), balance: this.balance(u.id) })).sort((a, b) => b.sold - a.sold),
      requests: this.withdrawals.slice(-200).reverse(),
      legacy: this.store.data.legacyWithdrawals || null,
    };
  }

  async request(user, { amount, pixKey, notes } = {}) {
    const raw = String(amount ?? '').trim();
    const v = cents(typeof amount === 'number' ? amount : raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw);
    if (!(v > 0)) throw err(400, 'Informe o valor do saque');
    const b = this.balance(user.id);
    if (v > b.available) throw err(400, `Valor maior que o disponível para saque (R$ ${b.available.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`);
    const key = clip(pixKey, 120);
    if (!key) throw err(400, 'Informe a chave Pix para receber');
    const w = { id: crypto.randomBytes(6).toString('hex'), sellerId: user.id, sellerName: user.name, amount: v, method: 'PIX', pixKey: key, notes: clip(notes, 300), status: 'pedido', createdAt: this.now().toISOString(), history: [{ at: this.now().toISOString(), by: user.name, text: 'Pedido de saque' }] };
    this.withdrawals.push(w);
    this.store.save();
    await this.notify('admins', `💸 *Pedido de saque de comissão*\n👤 ${user.name}\nValor: R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\nAprove ou recuse no painel (Comissões e saques).`).catch(() => {});
    return w;
  }

  async decide(user, id, action, { reason = '', paidAt = '' } = {}) {
    if (user.role !== 'admin') throw err(403, 'Só o administrador aprova saques');
    const w = this.withdrawals.find((x) => x.id === id);
    if (!w) throw err(404, 'Pedido não encontrado');
    const flow = { approve: ['pedido', 'aprovado'], pay: [['pedido', 'aprovado'], 'pago'], reject: [['pedido', 'aprovado'], 'recusado'] }[action];
    if (!flow) throw err(400, 'Ação inválida');
    const [from, to] = flow;
    if (!(Array.isArray(from) ? from : [from]).includes(w.status)) throw err(400, `Este pedido já está ${w.status}`);
    if (action === 'reject' && !clip(reason, 200)) throw err(400, 'Diga o motivo da recusa');
    w.status = to;
    if (to === 'pago') w.paidAt = /^\d{4}-\d{2}-\d{2}$/.test(paidAt) ? paidAt : this.now().toISOString().slice(0, 10);
    if (to === 'recusado') w.reason = clip(reason, 200);
    w.history.push({ at: this.now().toISOString(), by: user.name, text: { aprovado: 'Aprovado', pago: `Pago em ${w.paidAt?.split('-').reverse().join('/')}`, recusado: `Recusado: ${w.reason}` }[to] });
    this.store.save();
    const seller = this.auth.get(w.sellerId);
    const brl = `R$ ${w.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    await this.notify('seller', { seller, text: to === 'pago' ? `✅ Seu saque de ${brl} foi pago. Confira no seu banco.` : to === 'aprovado' ? `👍 Seu pedido de saque de ${brl} foi aprovado e será pago em breve.` : `Seu pedido de saque de ${brl} não foi aprovado: ${w.reason}` }).catch(() => {});
    return w;
  }

  /** Cópia do sistema antigo: níveis e o resumo de saques de cada vendedor (só para consulta; não mistura com o saldo daqui). */
  importCapture(captura) {
    const of = (ep) => (captura?.api || []).filter((a) => { try { return new URL(a.url, 'http://x').pathname.replace(/\/+$/, '') === ep; } catch { return false; } }).map((a) => a.json);
    let levels = 0; let legacy = 0;
    const lp = of('/api/seller-level-plans')[0]?.data?.plans;
    if (Array.isArray(lp) && lp.length && !this.store.settings.commissionLevels?.plans?.length) {
      this.store.settings.commissionLevels = { enabled: false, plans: lp.filter((p) => p.is_active !== false).map((p) => migraLevel({ id: clip(p.id, 20), label: clip(p.label, 30), pct: Number(p.commission_rate) || 0, goal: Number(p.goal_amount) || 0, color: /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : '#64748b' })).sort((a, b) => a.goal - b.goal) };
      levels = lp.length;
    }
    const wd = of('/api/withdrawals')[0];
    if (wd?.sellers) {
      this.store.data.legacyWithdrawals = {
        at: this.now().toISOString(),
        sellers: wd.sellers.map((s) => ({ name: clip(s.seller_name, 80), total: cents(s.total_commission), released: cents(s.released ?? s.released_for_withdrawal), pending: cents(s.pending), available: cents(s.available), withdrawn: cents(s.withdrawn) })),
        requests: (wd.requests || []).map((r) => ({ name: clip(r.seller_name, 80), amount: cents(r.amount), status: clip(r.status, 20), createdAt: r.created_at, processedAt: r.processed_at || null })),
      };
      legacy = wd.sellers.length;
    }
    if (levels || legacy) this.store.save();
    return { levels, legacySellers: legacy };
  }
}
