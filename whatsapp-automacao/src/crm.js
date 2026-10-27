// CRM de vendas: prospectos (leads), funil, histórico, retornos agendados e números.
// Modelo inspirado nos CRMs grandes (Salesforce, HubSpot, Odoo, Twenty): cada lead
// tem dono, etapa, próximo passo com data e uma linha do tempo com tudo que aconteceu.
import { normalizePhone, uid } from './utils.js';
import { toDateStr } from './agent/calendar.js';

export const STAGES = [
  { id: 'novo', label: 'Novo' },
  { id: 'em_contato', label: 'Em contato' },
  { id: 'proposta', label: 'Proposta enviada' },
  { id: 'aguardando', label: 'Retomar depois' },
  { id: 'ganho', label: 'Fechado' },
  { id: 'perdido', label: 'Perdido' },
];
const STAGE_IDS = STAGES.map((s) => s.id);
const OPEN = new Set(['novo', 'em_contato', 'proposta', 'aguardando']);
const stageLabel = (id) => STAGES.find((s) => s.id === id)?.label || id;

const err = (status, message) => Object.assign(new Error(message), { status });
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

export class Crm {
  constructor({ store, auth, notify, now = () => new Date() }) {
    this.store = store;
    this.auth = auth;
    this.notify = notify || (() => {});
    this.now = now;
    store.data.leads ||= [];
  }

  get leads() {
    return this.store.data.leads;
  }

  get config() {
    return this.store.settings.crm || {};
  }

  today() {
    return toDateStr(this.now());
  }

  // ---------- Permissões ----------
  canSee(user, lead) {
    return user.role === 'admin' || !lead.ownerId || lead.ownerId === user.id;
  }

  #mustSee(user, id) {
    const lead = this.leads.find((l) => l.id === id);
    if (!lead) throw err(404, 'Prospecto não encontrado');
    if (!this.canSee(user, lead)) throw err(403, 'Este prospecto é de outro vendedor');
    return lead;
  }

  ownerName(id) {
    return this.auth.get(id)?.name || '';
  }

  view(lead) {
    const today = this.today();
    let due = null;
    if (lead.followUpAt && OPEN.has(lead.stage)) {
      due = lead.followUpAt < today ? 'atrasado' : lead.followUpAt === today ? 'hoje' : 'agendado';
    }
    return { ...lead, ownerName: this.ownerName(lead.ownerId), stageLabel: stageLabel(lead.stage), due };
  }

  // ---------- Linha do tempo ----------
  #log(lead, by, type, text, extra = {}) {
    lead.timeline ||= [];
    lead.timeline.push({ at: new Date().toISOString(), by: by?.name || by || 'Sistema', type, text, ...extra });
    lead.updatedAt = new Date().toISOString();
  }

  // ---------- Consultas ----------
  list(user, { q = '', stage = '', owner = '', due = '' } = {}) {
    const query = String(q).toLowerCase().trim();
    const today = this.today();
    return this.leads
      .filter((l) => this.canSee(user, l))
      .filter((l) => !stage || l.stage === stage)
      .filter((l) => !owner || (owner === 'none' ? !l.ownerId : l.ownerId === owner))
      .filter((l) => {
        if (!due) return true;
        if (!l.followUpAt || !OPEN.has(l.stage)) return false;
        if (due === 'hoje') return l.followUpAt <= today;
        if (due === 'semana') return l.followUpAt <= addDays(today, 7);
        return true;
      })
      .filter((l) => !query || [l.name, l.phone, l.instagram, l.interest, l.city].some((v) => String(v || '').toLowerCase().includes(query)))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map((l) => this.view(l));
  }

  get(user, id) {
    return this.view(this.#mustSee(user, id));
  }

  /** Retornos para o vendedor: atrasados, hoje e próximos 30 dias. */
  agenda(user) {
    const today = this.today();
    const mine = this.leads.filter((l) => l.followUpAt && OPEN.has(l.stage) && (user.role === 'admin' ? true : l.ownerId === user.id));
    const pick = (fn) => mine.filter(fn).sort((a, b) => a.followUpAt.localeCompare(b.followUpAt)).map((l) => this.view(l));
    return {
      atrasados: pick((l) => l.followUpAt < today),
      hoje: pick((l) => l.followUpAt === today),
      proximos: pick((l) => l.followUpAt > today && l.followUpAt <= addDays(today, 30)),
      futuros: pick((l) => l.followUpAt > addDays(today, 30)),
    };
  }

  // ---------- Escrita ----------
  packagePrice(name) {
    return (this.config.packages || []).find((p) => p.name === name)?.price || 0;
  }

  create(user, input) {
    const name = String(input.name || '').trim();
    const phone = input.phone ? normalizePhone(input.phone) : null;
    if (!name && !phone && !input.instagram) throw err(400, 'Informe pelo menos o nome, o telefone ou o Instagram');
    if (input.phone && !phone) throw err(400, 'Telefone inválido');
    const lead = {
      id: uid(),
      name: name || '',
      phone,
      instagram: String(input.instagram || '').replace(/^@/, '').trim(),
      email: String(input.email || '').trim(),
      city: String(input.city || '').trim(),
      source: input.source || 'manual',
      interest: String(input.interest || ''),
      people: Math.max(1, Number(input.people || 1)),
      value: Number(input.value || 0),
      stage: STAGE_IDS.includes(input.stage) ? input.stage : 'novo',
      ownerId: input.ownerId !== undefined ? input.ownerId || null : user.role === 'seller' ? user.id : null,
      followUpAt: null,
      followUpReason: '',
      lostReason: '',
      conversationKey: input.conversationKey || null,
      aiSummary: '',
      timeline: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (!lead.value && lead.interest) lead.value = this.packagePrice(lead.interest) * lead.people;
    this.#log(lead, user, 'criado', `Prospecto criado (${lead.source})`);
    this.leads.push(lead);
    this.store.save();
    this.notify('crm', { id: lead.id });
    return this.view(lead);
  }

  update(user, id, patch) {
    const lead = this.#mustSee(user, id);
    const fields = ['name', 'email', 'city', 'interest'];
    for (const f of fields) if (patch[f] !== undefined) lead[f] = String(patch[f]).trim();
    if (patch.instagram !== undefined) lead.instagram = String(patch.instagram).replace(/^@/, '').trim();
    if (patch.phone !== undefined) {
      const phone = patch.phone ? normalizePhone(patch.phone) : null;
      if (patch.phone && !phone) throw err(400, 'Telefone inválido');
      lead.phone = phone;
    }
    if (patch.people !== undefined) lead.people = Math.max(1, Number(patch.people) || 1);
    if (patch.value !== undefined) lead.value = Math.max(0, Number(patch.value) || 0);
    else if ((patch.interest !== undefined || patch.people !== undefined) && lead.interest) {
      lead.value = this.packagePrice(lead.interest) * lead.people || lead.value;
    }
    if (patch.stage !== undefined && patch.stage !== lead.stage) this.setStage(user, lead, patch);
    if (patch.ownerId !== undefined && user.role === 'admin') this.#assign(user, lead, patch.ownerId);
    lead.updatedAt = new Date().toISOString();
    this.store.save();
    this.notify('crm', { id: lead.id });
    return this.view(lead);
  }

  setStage(user, lead, { stage, lostReason, closedValue, followUpAt, followUpReason }) {
    if (!STAGE_IDS.includes(stage)) throw err(400, 'Etapa inválida');
    if (stage === 'aguardando') {
      if (!isDate(followUpAt)) throw err(400, 'Para "Retomar depois", informe a data do retorno');
      return this.#followUp(user, lead, followUpAt, followUpReason);
    }
    if (stage === 'perdido') {
      if (!String(lostReason || '').trim()) throw err(400, 'Conte por que o cliente não fechou');
      lead.lostReason = String(lostReason).trim();
    }
    if (stage === 'ganho') {
      lead.closedValue = Number(closedValue ?? lead.value) || 0;
      lead.closedAt = new Date().toISOString();
      lead.closedBy = user.id || null;
    }
    const from = lead.stage;
    lead.stage = stage;
    if (!OPEN.has(stage)) lead.followUpAt = null;
    const extra = stage === 'perdido' ? ` · motivo: ${lead.lostReason}` : stage === 'ganho' ? ` · valor: R$ ${fmtMoney(lead.closedValue)}` : '';
    this.#log(lead, user, 'etapa', `${stageLabel(from)} → ${stageLabel(stage)}${extra}`);
  }

  #followUp(user, lead, date, reason) {
    if (!isDate(date)) throw err(400, 'Data inválida');
    lead.stage = 'aguardando';
    lead.followUpAt = date;
    lead.followUpReason = String(reason || '').trim();
    lead.followUpNotified = null;
    this.#log(lead, user, 'retorno', `Retorno agendado para ${fmtDate(date)}${lead.followUpReason ? ` · motivo: ${lead.followUpReason}` : ''}`);
  }

  followUp(user, id, { date, reason }) {
    const lead = this.#mustSee(user, id);
    this.#followUp(user, lead, date, reason);
    this.store.save();
    this.notify('crm', { id: lead.id });
    return this.view(lead);
  }

  addNote(user, id, text) {
    const lead = this.#mustSee(user, id);
    const t = String(text || '').trim();
    if (!t) throw err(400, 'Escreva a anotação');
    this.#log(lead, user, 'nota', t);
    this.store.save();
    this.notify('crm', { id: lead.id });
    return this.view(lead);
  }

  #assign(user, lead, ownerId) {
    const owner = ownerId ? this.auth.get(ownerId) : null;
    if (ownerId && !owner) throw err(400, 'Vendedor não encontrado');
    if ((lead.ownerId || null) === (ownerId || null)) return;
    lead.ownerId = ownerId || null;
    this.#log(lead, user, 'dono', owner ? `Responsável: ${owner.name}` : 'Sem responsável (disponível para a equipe)');
  }

  /** Vendedor assume um prospecto sem dono; admin pode passar para qualquer um. */
  assign(user, id, ownerId) {
    const lead = this.#mustSee(user, id);
    if (user.role !== 'admin') {
      if (lead.ownerId && lead.ownerId !== user.id) throw err(403, 'Só o administrador pode transferir prospectos de outro vendedor');
      ownerId = ownerId ? user.id : null;
    }
    this.#assign(user, lead, ownerId);
    this.store.save();
    this.notify('crm', { id: lead.id });
    return this.view(lead);
  }

  /** Vendedor saiu: passa todos os prospectos em aberto para outro (ou para a equipe). */
  transfer(user, fromId, toId) {
    if (user.role !== 'admin') throw err(403, 'Só o administrador pode transferir carteiras');
    let n = 0;
    for (const lead of this.leads) {
      if (lead.ownerId === fromId && OPEN.has(lead.stage)) {
        this.#assign(user, lead, toId || null);
        n++;
      }
    }
    this.store.save();
    this.notify('crm', {});
    return { transferred: n };
  }

  remove(user, id) {
    if (user.role !== 'admin') throw err(403, 'Só o administrador pode excluir prospectos');
    this.store.data.leads = this.leads.filter((l) => l.id !== id);
    this.store.save();
    this.notify('crm', {});
  }

  // ---------- Integração com as conversas ----------
  findForConversation({ key, phone, username }) {
    return (
      this.leads.find((l) => l.conversationKey === key) ||
      (phone && this.leads.find((l) => l.phone === phone && OPEN.has(l.stage))) ||
      (username && this.leads.find((l) => l.instagram && l.instagram.toLowerCase() === username.toLowerCase() && OPEN.has(l.stage))) ||
      null
    );
  }

  /** Cliente mandou mensagem: garante que existe um prospecto para ele. */
  ensureFromConversation({ key, phone, name, username, channel }) {
    if (this.config.autoCreate === false || String(key).startsWith('sim:')) return null;
    const existing = this.findForConversation({ key, phone, username });
    if (existing) {
      if (!existing.conversationKey) existing.conversationKey = key;
      if (existing.stage === 'aguardando' && existing.followUpAt) {
        this.#log(existing, 'Sistema', 'mensagem', 'O cliente voltou a mandar mensagem');
        this.store.save();
      }
      return existing;
    }
    const lead = this.create({ name: 'Sistema', role: 'admin' }, {
      name: name || (username ? `@${username}` : ''),
      phone,
      instagram: username || '',
      source: channel || 'whatsapp',
      conversationKey: key,
      ownerId: this.#nextOwner(),
    });
    return this.leads.find((l) => l.id === lead.id);
  }

  /** Distribuição automática (rodízio) entre vendedores ativos, se ligada. */
  #nextOwner() {
    if (this.config.autoAssign !== 'roundrobin') return null;
    const sellers = this.auth.activeSellers().filter((u) => u.role === 'seller');
    if (!sellers.length) return null;
    const i = (this.config.rrIndex || 0) % sellers.length;
    this.store.updateSettings({ crm: { rrIndex: i + 1 } });
    return sellers[i].id;
  }

  /** Aplica o que a IA entendeu da conversa, sem atropelar o que um humano já preencheu. */
  applyAi(lead, info) {
    if (!lead || !info) return;
    const changes = [];
    if (info.nome && !lead.name) { lead.name = info.nome; changes.push(`nome: ${info.nome}`); }
    if (info.cidade && !lead.city) { lead.city = info.cidade; changes.push(`cidade: ${info.cidade}`); }
    if (info.pacote && !lead.interest && (this.config.packages || []).some((p) => p.name === info.pacote)) {
      lead.interest = info.pacote;
      changes.push(`interesse: ${info.pacote}`);
    }
    if (info.pessoas && lead.people === 1 && Number(info.pessoas) > 1) { lead.people = Number(info.pessoas); changes.push(`pessoas: ${lead.people}`); }
    if (lead.interest && !lead.value) lead.value = this.packagePrice(lead.interest) * lead.people;
    else if (changes.some((c) => c.startsWith('pessoas') || c.startsWith('interesse'))) lead.value = this.packagePrice(lead.interest) * lead.people || lead.value;
    if (info.objetivo && !lead.objective) lead.objective = info.objetivo;
    if (info.resumo) lead.aiSummary = info.resumo;
    // Etapa: a IA só avança prospectos que ainda estão no começo do funil.
    if (lead.stage === 'novo' && ['em_contato', 'proposta'].includes(info.etapa)) {
      this.#log(lead, 'IA', 'etapa', `${stageLabel(lead.stage)} → ${stageLabel(info.etapa)}`);
      lead.stage = info.etapa;
    }
    if (isDate(info.retorno_data) && info.retorno_data > this.today() && !lead.followUpAt && OPEN.has(lead.stage)) {
      this.#followUp('IA', lead, info.retorno_data, info.motivo_espera || 'Cliente pediu para retomar depois');
    }
    if (changes.length) this.#log(lead, 'IA', 'ia', `Preenchido pela IA: ${changes.join(', ')}`);
    lead.updatedAt = new Date().toISOString();
    this.store.save();
    this.notify('crm', { id: lead.id });
  }

  // ---------- Avisos de retorno ----------
  /** Retornos que chegaram na data e ainda não foram avisados. */
  dueToNotify() {
    const today = this.today();
    return this.leads.filter((l) => l.followUpAt && OPEN.has(l.stage) && l.followUpAt <= today && l.followUpNotified !== l.followUpAt);
  }

  markNotified(lead) {
    lead.followUpNotified = lead.followUpAt;
    this.#log(lead, 'Sistema', 'aviso', 'Dia do retorno: responsável avisado');
    this.store.save();
  }

  // ---------- Números para o painel do dono ----------
  stats({ from, to, ownerId } = {}) {
    const inRange = (iso) => (!from || iso.slice(0, 10) >= from) && (!to || iso.slice(0, 10) <= to);
    const all = this.leads.filter((l) => !ownerId || l.ownerId === ownerId);
    const created = all.filter((l) => inRange(l.createdAt));
    const won = all.filter((l) => l.stage === 'ganho' && l.closedAt && inRange(l.closedAt));
    const lostInRange = all.filter((l) => l.stage === 'perdido' && inRange(l.updatedAt));
    const open = all.filter((l) => OPEN.has(l.stage));
    const today = this.today();
    const sum = (list, f) => list.reduce((s, l) => s + (Number(l[f]) || 0), 0);

    const byStage = STAGES.map((s) => ({ id: s.id, label: s.label, count: all.filter((l) => l.stage === s.id).length, value: sum(all.filter((l) => l.stage === s.id), 'value') }));
    const users = this.auth.list();
    const bySeller = [...users.map((u) => ({ id: u.id, name: u.name, active: u.active })), { id: null, name: 'Sem responsável', active: true }]
      .map((u) => {
        const mine = all.filter((l) => (l.ownerId || null) === u.id);
        const w = mine.filter((l) => l.stage === 'ganho' && l.closedAt && inRange(l.closedAt));
        const lo = mine.filter((l) => l.stage === 'perdido' && inRange(l.updatedAt));
        return {
          ...u,
          leads: mine.filter((l) => inRange(l.createdAt)).length,
          open: mine.filter((l) => OPEN.has(l.stage)).length,
          won: w.length,
          lost: lo.length,
          wonValue: sum(w, 'closedValue'),
          conversion: w.length + lo.length ? Math.round((w.length / (w.length + lo.length)) * 100) : null,
          overdue: mine.filter((l) => l.followUpAt && OPEN.has(l.stage) && l.followUpAt < today).length,
        };
      })
      .filter((r) => r.leads || r.open || r.won || r.lost);

    const countBy = (list, fn) => {
      const m = new Map();
      for (const l of list) {
        const k = fn(l);
        if (k) m.set(k, (m.get(k) || 0) + 1);
      }
      return [...m].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
    };
    const norm = (t) => String(t || '').trim().replace(/\s+/g, ' ').toLowerCase();

    const months = [];
    const d = this.now();
    for (let i = 5; i >= 0; i--) {
      const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
      const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
      const w = this.leads.filter((l) => l.stage === 'ganho' && l.closedAt?.startsWith(key) && (!ownerId || l.ownerId === ownerId));
      months.push({ key, label: m.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''), won: w.length, value: sum(w, 'closedValue') });
    }

    return {
      period: { from: from || null, to: to || null },
      newLeads: created.length,
      openLeads: open.length,
      openValue: sum(open, 'value'),
      won: won.length,
      wonValue: sum(won, 'closedValue'),
      lost: lostInRange.length,
      conversion: won.length + lostInRange.length ? Math.round((won.length / (won.length + lostInRange.length)) * 100) : null,
      avgTicket: won.length ? Math.round(sum(won, 'closedValue') / won.length) : 0,
      followUps: {
        overdue: open.filter((l) => l.followUpAt && l.followUpAt < today).length,
        today: open.filter((l) => l.followUpAt === today).length,
        next30: open.filter((l) => l.followUpAt && l.followUpAt > today && l.followUpAt <= addDays(today, 30)).length,
        later: open.filter((l) => l.followUpAt && l.followUpAt > addDays(today, 30)).length,
      },
      byStage,
      bySeller,
      byInterest: countBy(all, (l) => l.interest),
      bySource: countBy(created, (l) => sourceLabel(l.source)),
      lostReasons: countBy(all.filter((l) => l.stage === 'perdido'), (l) => norm(l.lostReason)).slice(0, 8),
      waitReasons: countBy(open.filter((l) => l.stage === 'aguardando'), (l) => norm(l.followUpReason)).slice(0, 8),
      months,
    };
  }
}

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return toDateStr(new Date(y, m - 1, d + days));
}

export const sourceLabel = (s) => ({ whatsapp: 'WhatsApp', instagram: 'Instagram', manual: 'Cadastro manual', indicacao: 'Indicação', site: 'Site', evento: 'Evento' }[s] || s || 'Outro');
const fmtDate = (s) => s.split('-').reverse().join('/');
const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
