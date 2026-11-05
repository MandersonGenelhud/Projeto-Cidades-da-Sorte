// Migra Sócios de Projeto: plano de carreira em que o consultor que chegou ao topo traz um projeto novo
// (com escala) e, se o projeto der certo, recebe um percentual do lucro dele, adquirido por etapas.
// Caminho: ideia → análise → piloto (com metas) → projeto oficial → (encerrado).
// O sistema organiza e registra; a participação de verdade depende de contrato próprio (advogado e contador).
import crypto from 'node:crypto';

const err = (status, message) => Object.assign(new Error(message), { status });
const clip = (v, n) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, n);
const cents = (v) => Math.round(Number(v || 0) * 100) / 100;
const money = (v) => { const raw = String(v ?? '').trim(); const n = typeof v === 'number' ? v : Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw); return Number.isFinite(n) ? cents(n) : NaN; };
const ym = (d) => new Date(d).toISOString().slice(0, 7);
const monthsBetween = (a, b) => { const x = new Date(a); const y = new Date(b); return (y.getUTCFullYear() - x.getUTCFullYear()) * 12 + (y.getUTCMonth() - x.getUTCMonth()); };

export const DEFAULTS = {
  enabled: false,
  minLevel: 'legado', // nível da Jornada que precisa ter sido alcançado em algum mês
  minSales: 2000000, // vendas confirmadas acumuladas (o que o cliente pagou), em R$
  minMonths: 12, // tempo mínimo de casa
  pilotSharePct: 5, // participação no lucro durante o piloto
  maxSharePct: 20, // teto da participação no projeto oficial
  vestingYears: 3, // a participação do projeto oficial é adquirida aos poucos neste prazo
};
export const STAGES = { ideia: 'Ideia enviada', analise: 'Em análise', ajustes: 'Ajustes pedidos', recusado: 'Recusado', piloto: 'Piloto', oficial: 'Projeto oficial', encerrado: 'Encerrado' };
const FLOW = {
  analisar: [['ideia', 'ajustes'], 'analise'],
  ajustes: [['ideia', 'analise'], 'ajustes'],
  recusar: [['ideia', 'analise', 'ajustes'], 'recusado'],
  piloto: [['ideia', 'analise', 'ajustes'], 'piloto'],
  oficial: [['piloto'], 'oficial'],
  encerrar: [['piloto', 'oficial'], 'encerrado'],
};

export class PartnerProjects {
  constructor({ store, auth, sales, levels, notify = async () => {}, now = () => new Date() }) {
    // levels: (userId, 'YYYY-MM') → { level: { id } } (Jornada do Consultor)
    Object.assign(this, { store, auth, sales, levels, notify, now });
    store.data.partnerProjects ||= [];
  }
  get all() { return this.store.data.partnerProjects; }
  get config() { return { ...DEFAULTS, ...(this.store.settings.partnerProjects || {}) }; }

  setConfig(user, b = {}) {
    if (user.role !== 'admin') throw err(403, 'Só o administrador define as regras');
    const c = { ...this.config };
    if (b.enabled !== undefined) c.enabled = Boolean(b.enabled);
    if (b.minLevel !== undefined) c.minLevel = clip(b.minLevel, 20);
    for (const [k, min, max] of [['minSales', 0, 1e10], ['minMonths', 0, 240], ['pilotSharePct', 0, 50], ['maxSharePct', 0, 50], ['vestingYears', 0, 10]]) {
      if (b[k] === undefined) continue;
      const n = money(b[k]);
      if (!(n >= min && n <= max)) throw err(400, `Valor inválido em ${k}`);
      c[k] = n;
    }
    this.store.settings.partnerProjects = c;
    this.store.save();
    return c;
  }

  /** Vendas confirmadas (o que os clientes do consultor já pagaram), tempo de casa e se já chegou ao nível exigido. */
  eligibility(user) {
    const c = this.config;
    const u = this.auth.get(user.id) || user;
    const mine = this.sales.list.filter((s) => s.sellerId === user.id && s.status !== 'cancelada');
    const confirmed = cents(mine.reduce((a, s) => a + (s.parcels || []).filter((p) => p.status === 'pago').reduce((x, p) => x + Number(p.value || 0), 0), 0));
    const since = u.createdAt || mine.map((s) => s.createdAt).sort()[0] || this.now().toISOString();
    const months = Math.max(0, monthsBetween(since, this.now()));
    const monthsSold = [...new Set(mine.map((s) => String(s.createdAt || '').slice(0, 7)).filter(Boolean))];
    const reachedLevel = !c.minLevel || monthsSold.some((m) => this.levels?.(user.id, m)?.level?.id === c.minLevel);
    const invited = Boolean(u.projectsInvite);
    const ok = c.enabled && (invited || (confirmed >= c.minSales && months >= c.minMonths && reachedLevel));
    return { enabled: c.enabled, ok, invited, confirmed, minSales: c.minSales, missingSales: cents(Math.max(0, c.minSales - confirmed)), months, minMonths: c.minMonths, reachedLevel, minLevel: c.minLevel };
  }

  setInvite(user, userId, invited) {
    if (user.role !== 'admin') throw err(403, 'Só o administrador convida');
    const u = this.auth.get(userId);
    if (!u) throw err(404, 'Pessoa não encontrada');
    u.projectsInvite = Boolean(invited);
    this.store.save();
    return { id: u.id, name: u.name, invited: u.projectsInvite };
  }

  #canSee(user, p) { return user.role === 'admin' || p.ownerId === user.id; }
  #get(user, id) { const p = this.all.find((x) => x.id === id); if (!p || !this.#canSee(user, p)) throw err(404, 'Projeto não encontrado'); return p; }
  #log(p, by, text) { p.history.push({ at: this.now().toISOString(), by: by?.name || by || 'Sistema', text }); }

  /** Participação já adquirida no projeto oficial, no mês indicado (aumenta mês a mês até o prazo). */
  vestedPct(p, when = this.now()) {
    if (p.stage !== 'oficial' && p.stage !== 'encerrado') return 0;
    const share = Number(p.sharePct || 0);
    const years = Number(p.vestingYears ?? this.config.vestingYears);
    if (!p.officialAt || !(years > 0)) return share;
    const end = p.endedAt && new Date(p.endedAt) < new Date(when) ? p.endedAt : when;
    const m = Math.max(0, monthsBetween(p.officialAt, end) + 1);
    return cents(share * Math.min(1, m / (years * 12)));
  }

  /** Quanto cabe ao idealizador em cada mês: lucro × participação daquele momento (piloto ou adquirida). */
  #statement(p) {
    const rows = (p.results || []).slice().sort((a, b) => a.month.localeCompare(b.month)).map((r) => {
      const profit = cents(r.revenue - r.costs);
      const pct = r.stage === 'piloto' ? Number(p.pilotSharePct || 0) : this.vestedPct(p, `${r.month}-15T12:00:00Z`);
      return { ...r, profit, pct, share: cents(Math.max(0, profit) * pct / 100) };
    });
    const earned = cents(rows.reduce((a, r) => a + r.share, 0));
    const paid = cents((p.payments || []).reduce((a, x) => a + x.amount, 0));
    return { rows, earned, paid, due: cents(Math.max(0, earned - paid)), revenue: cents(rows.reduce((a, r) => a + r.revenue, 0)), profit: cents(rows.reduce((a, r) => a + r.profit, 0)) };
  }

  #view(p) { return { ...p, stageLabel: STAGES[p.stage], vestedPct: this.vestedPct(p), statement: this.#statement(p) }; }

  list(user) {
    return {
      config: this.config, stages: STAGES, eligibility: this.eligibility(user),
      items: this.all.filter((p) => this.#canSee(user, p)).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).map((p) => this.#view(p)),
    };
  }
  get(user, id) { return this.#view(this.#get(user, id)); }

  #fields(b, base = {}) {
    const p = { ...base };
    for (const [k, n] of [['title', 120], ['problem', 3000], ['audience', 1500], ['plan', 4000]]) if (b[k] !== undefined) p[k] = clip(b[k], n);
    for (const k of ['startCost', 'revenuePotential']) {
      if (b[k] === undefined || b[k] === '') continue;
      const n = money(b[k]); if (!(n >= 0)) throw err(400, k === 'startCost' ? 'Custo para começar inválido' : 'Faturamento esperado inválido');
      p[k] = n;
    }
    return p;
  }

  async submit(user, b = {}) {
    const e = this.eligibility(user);
    if (!e.enabled) throw err(400, 'O plano de projetos ainda não foi aberto pela diretoria');
    if (!e.ok) throw err(403, `Ainda não liberado para você: faltam ${e.missingSales > 0 ? `R$ ${e.missingSales.toLocaleString('pt-BR')} em vendas confirmadas` : ''}${e.months < e.minMonths ? ` ${e.minMonths - e.months} mês(es) de casa` : ''}${!e.reachedLevel ? ` chegar ao nível ${e.minLevel}` : ''}.`.replace(/: \./, '.'));
    const p = this.#fields(b, { id: crypto.randomBytes(6).toString('hex'), stage: 'ideia', ownerId: user.id, ownerName: user.name, createdAt: this.now().toISOString(), updatedAt: this.now().toISOString(), history: [], results: [], payments: [], goals: [] });
    if (!p.title || !p.problem || !p.plan) throw err(400, 'Preencha o nome do projeto, o problema que ele resolve e o plano');
    this.#log(p, user, 'Ideia enviada');
    this.all.push(p); this.store.save();
    await this.notify('admins', `💡 *Nova ideia de projeto*\n👤 ${user.name}\n📌 ${p.title}\nAnalise no painel: Projetos e Sócios.`).catch(() => {});
    return this.#view(p);
  }

  edit(user, id, b = {}) {
    const p = this.#get(user, id);
    if (user.role !== 'admin' && !['ideia', 'ajustes'].includes(p.stage)) throw err(400, 'Depois da análise, só a diretoria altera o projeto');
    Object.assign(p, this.#fields(b), { updatedAt: this.now().toISOString() });
    if (p.stage === 'ajustes' && user.id === p.ownerId) { p.stage = 'ideia'; this.#log(p, user, 'Ajustes feitos e reenviados'); }
    this.store.save();
    return this.#view(p);
  }

  async decide(user, id, action, b = {}) {
    if (user.role !== 'admin') throw err(403, 'Só a diretoria decide sobre os projetos');
    const p = this.#get(user, id);
    const flow = FLOW[action]; if (!flow) throw err(400, 'Ação inválida');
    if (!flow[0].includes(p.stage)) throw err(400, `O projeto está em "${STAGES[p.stage]}": essa ação não vale agora`);
    const note = clip(b.note, 1000);
    if (['ajustes', 'recusar', 'encerrar'].includes(action) && !note) throw err(400, 'Explique o motivo (o consultor recebe)');
    const c = this.config;
    if (action === 'piloto') {
      const months = Math.round(Number(b.pilotMonths || 3));
      if (!(months >= 1 && months <= 24)) throw err(400, 'Piloto de 1 a 24 meses');
      const pct = b.pilotSharePct === undefined || b.pilotSharePct === '' ? c.pilotSharePct : Number(b.pilotSharePct);
      if (!(pct >= 0 && pct <= c.maxSharePct)) throw err(400, `Participação no piloto vai de 0 a ${c.maxSharePct}%`);
      Object.assign(p, { pilotSharePct: pct, pilotStart: this.now().toISOString(), pilotEnd: new Date(this.now().getTime() + months * 30 * 86400000).toISOString() });
      if (Array.isArray(b.goals)) p.goals = b.goals.slice(0, 10).map((g) => ({ label: clip(g.label, 120), target: clip(g.target, 60), actual: '' })).filter((g) => g.label);
    }
    if (action === 'oficial') {
      const pct = Number(b.sharePct);
      if (!(pct > 0 && pct <= c.maxSharePct)) throw err(400, `Defina a participação do idealizador (até ${c.maxSharePct}%)`);
      const years = b.vestingYears === undefined || b.vestingYears === '' ? c.vestingYears : Number(b.vestingYears);
      if (!(years >= 0 && years <= 10)) throw err(400, 'Prazo de aquisição de 0 a 10 anos');
      Object.assign(p, { sharePct: pct, vestingYears: years, officialAt: this.now().toISOString() });
    }
    if (action === 'encerrar') p.endedAt = this.now().toISOString();
    p.stage = flow[1];
    p.updatedAt = this.now().toISOString();
    const txt = { analisar: 'Em análise', ajustes: `Ajustes pedidos: ${note}`, recusar: `Recusado: ${note}`, piloto: `Aprovado para piloto (${p.pilotSharePct}% do lucro durante o piloto)`, oficial: `Projeto oficial: ${p.sharePct}% do lucro, adquiridos em ${p.vestingYears} ano(s)`, encerrar: `Encerrado: ${note}` }[action];
    this.#log(p, user, txt + (note && !['ajustes', 'recusar', 'encerrar'].includes(action) ? ` · ${note}` : ''));
    this.store.save();
    await this.notify('owner', { userId: p.ownerId, text: `💡 Projeto "${p.title}": ${txt}` }).catch(() => {});
    return this.#view(p);
  }

  setGoals(user, id, goals = []) {
    if (user.role !== 'admin') throw err(403, 'Só a diretoria acompanha as metas');
    const p = this.#get(user, id);
    p.goals = goals.slice(0, 10).map((g) => ({ label: clip(g.label, 120), target: clip(g.target, 60), actual: clip(g.actual, 60) })).filter((g) => g.label);
    p.updatedAt = this.now().toISOString(); this.store.save();
    return this.#view(p);
  }

  /** Resultado do mês do projeto (receita e custos). Substitui o mês se já existir. */
  addResult(user, id, { month, revenue, costs, note } = {}) {
    if (user.role !== 'admin') throw err(403, 'Só a diretoria lança resultados');
    const p = this.#get(user, id);
    if (!['piloto', 'oficial'].includes(p.stage)) throw err(400, 'Resultados só no piloto ou no projeto oficial');
    if (!/^\d{4}-\d{2}$/.test(String(month || ''))) throw err(400, 'Mês no formato AAAA-MM');
    const r = money(revenue); const k = money(costs);
    if (!(r >= 0) || !(k >= 0)) throw err(400, 'Receita e custos precisam ser números');
    p.results = (p.results || []).filter((x) => x.month !== month);
    p.results.push({ month, revenue: r, costs: k, note: clip(note, 300), stage: p.stage, by: user.name, at: this.now().toISOString() });
    this.#log(p, user, `Resultado de ${month}: receita R$ ${r.toLocaleString('pt-BR')} · custos R$ ${k.toLocaleString('pt-BR')}`);
    p.updatedAt = this.now().toISOString(); this.store.save();
    return this.#view(p);
  }

  async addPayment(user, id, { date, amount, note } = {}) {
    if (user.role !== 'admin') throw err(403, 'Só a diretoria registra pagamentos');
    const p = this.#get(user, id);
    const v = money(amount);
    if (!(v > 0)) throw err(400, 'Valor inválido');
    const st = this.#statement(p);
    if (v > st.due + 0.009) throw err(400, `Maior que o valor a pagar (R$ ${st.due.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`);
    const d = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : this.now().toISOString().slice(0, 10);
    (p.payments ||= []).push({ date: d, amount: v, note: clip(note, 200), by: user.name, at: this.now().toISOString() });
    this.#log(p, user, `Pagamento da participação: R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} em ${d.split('-').reverse().join('/')}`);
    p.updatedAt = this.now().toISOString(); this.store.save();
    await this.notify('owner', { userId: p.ownerId, text: `💰 Participação do projeto "${p.title}" paga: R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` }).catch(() => {});
    return this.#view(p);
  }
}

export { ym };
