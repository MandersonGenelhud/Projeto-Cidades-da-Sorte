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
    // Prospectos antigos ganham um código de atendimento.
    let changed = false;
    for (const l of store.data.leads) if (!l.code) { l.code = this.#newCode(); changed = true; }
    if (changed) store.save();
  }

  /** Código curto que o cliente leva para o WhatsApp do vendedor (ex.: MIG-4K7P). */
  #newCode() {
    const prefix = String(this.config.codePrefix || 'MIG').toUpperCase();
    const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
    let code;
    do {
      code = `${prefix}-${Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')}`;
    } while (this.leads?.some((l) => l.code === code));
    return code;
  }

  /** Acha o pacote da tabela pelo nome que a IA ou o cliente usou ("ouro" → "Pacote Ouro"). */
  matchPackage(name) {
    const n = String(name || '').toLowerCase().replace(/pacote|\(|\)/g, '').trim();
    if (!n) return null;
    const list = this.config.packages || [];
    return list.find((p) => p.name.toLowerCase() === String(name).toLowerCase())
      || list.find((p) => p.name.toLowerCase().replace(/pacote|\(|\)/g, '').trim() === n)
      || list.find((p) => p.name.toLowerCase().includes(n))
      || null;
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
    lead.timeline.push({ at: new Date().toISOString(), by: by?.name || by || 'Sistema', byId: by?.id || null, type, text, ...extra });
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
      .filter((l) => !query || [l.name, l.phone, l.instagram, l.interest, l.city, l.code].some((v) => String(v || '').toLowerCase().includes(query)))
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
      code: this.#newCode(),
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
      // Venda lançada pelo administrador já vale; a do vendedor espera a confirmação.
      lead.closedConfirmed = user.role === 'admin';
    } else {
      lead.closedConfirmed = false;
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

  #assign(user, lead, ownerId, how = '') {
    const owner = ownerId ? this.auth.get(ownerId) : null;
    if (ownerId && !owner) throw err(400, 'Vendedor não encontrado');
    if ((lead.ownerId || null) === (ownerId || null)) return;
    lead.ownerId = ownerId || null;
    lead.assignedAt = new Date().toISOString();
    this.#log(lead, user, 'dono', owner ? `Responsável: ${owner.name}${how ? ` (${how})` : ''}` : 'Sem responsável (disponível para a equipe)', { toId: ownerId || null });
  }

  /** Administrador confirma a venda: só então ela conta no ranking (evita venda "inventada"). */
  confirmSale(user, id) {
    if (user.role !== 'admin') throw err(403, 'Só o administrador confirma vendas');
    const lead = this.#mustSee(user, id);
    if (lead.stage !== 'ganho') throw err(400, 'Este prospecto não está como "Fechado"');
    lead.closedConfirmed = true;
    this.#log(lead, user, 'etapa', `Venda confirmada pelo administrador (R$ ${fmtMoney(lead.closedValue)})`);
    this.store.save();
    this.notify('crm', { id: lead.id });
    return this.view(lead);
  }

  // ---------- Rodízio de vendedores ----------
  /** Quem está no rodízio: ativo, com WhatsApp e com "recebe clientes" ligado. */
  rotation() {
    return this.auth.users.filter((u) => u.active !== false && u.whatsapp && (u.receivesLeads ?? u.role === 'seller'));
  }

  /** Próximo da vez: quem recebeu cliente há mais tempo (ou nunca recebeu). */
  nextSeller() {
    const list = this.rotation();
    if (!list.length) return null;
    return [...list].sort((a, b) => (a.rotationSeq || 0) - (b.rotationSeq || 0) || a.name.localeCompare(b.name))[0];
  }

  /** Entrega o prospecto para o próximo vendedor do rodízio (ou mantém o atual, se ainda puder atender). */
  routeLead(lead, { reason = 'rodízio' } = {}) {
    const current = lead.ownerId ? this.auth.get(lead.ownerId) : null;
    if (current && current.active !== false && current.whatsapp) return current;
    const seller = this.nextSeller();
    if (!seller) return null;
    this.#assign('Sistema', lead, seller.id, reason);
    seller.lastLeadAt = new Date().toISOString();
    this.store.data.rotationSeq = (this.store.data.rotationSeq || 0) + 1;
    seller.rotationSeq = this.store.data.rotationSeq; // ordem do rodízio (não depende do relógio)
    seller.leadsReceived = (seller.leadsReceived || 0) + 1;
    this.store.save();
    this.notify('crmAssigned', { id: lead.id, ownerId: seller.id });
    return seller;
  }

  /** Registra o que a IA apurou na conversa (peneira), com as frases do cliente como prova. */
  qualify(lead, q) {
    const temp = ['quente', 'morno', 'frio'].includes(q.temperatura) ? q.temperatura : null;
    lead.qualification = {
      temperature: temp,
      money: q.tem_recursos || null,
      moneyEvidence: String(q.evidencia_recursos || '').trim(),
      start: String(q.quando_quer_iniciar || '').trim(),
      objections: String(q.objecoes || '').trim(),
      at: new Date().toISOString(),
    };
    if (q.nome && placeholderName(lead)) lead.name = String(q.nome).trim();
    const pkg = this.matchPackage(q.pacote);
    if (pkg && !lead.interest) lead.interest = pkg.name;
    if (Number(q.pessoas) > 1 && lead.people === 1) lead.people = Number(q.pessoas);
    if (lead.interest) lead.value = this.packagePrice(lead.interest) * lead.people || lead.value;
    if (q.telefone && !lead.phone) lead.phone = normalizePhone(q.telefone) || null;
    if (q.resumo) lead.aiSummary = String(q.resumo).trim();
    if (q.dados_formalizacao) {
      lead.contractData = String(q.dados_formalizacao).trim();
      this.#log(lead, 'IA', 'nota', `Dados para formalizar a negociação: ${lead.contractData}`);
    }
    if (lead.stage === 'novo') lead.stage = 'em_contato';
    const label = { quente: '🔥 quente', morno: '🌤️ morno', frio: '❄️ frio' }[temp] || 'sem classificação';
    this.#log(lead, 'IA', 'ia', `Peneira da IA: cliente ${label}${lead.qualification.start ? ` · quer iniciar: ${lead.qualification.start}` : ''}${lead.qualification.moneyEvidence ? ` · sobre o dinheiro, disse: "${lead.qualification.moneyEvidence}"` : ''}`);
    lead.updatedAt = new Date().toISOString();
    this.store.save();
    this.notify('crm', { id: lead.id });
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
      this.leads.find((l) => l.conversationKey === key || l.whatsappKey === key) ||
      (phone && this.leads.find((l) => l.phone === phone && OPEN.has(l.stage))) ||
      (username && this.leads.find((l) => l.instagram && l.instagram.toLowerCase() === username.toLowerCase() && OPEN.has(l.stage))) ||
      null
    );
  }

  /**
   * O cliente chegou no WhatsApp do vendedor com o código do Instagram (ex.: MIG-4K7P):
   * liga essa conversa ao prospecto que já existe, com todo o histórico.
   */
  linkByCode({ text, key, phone }) {
    const codes = String(text || '').toUpperCase().match(/\b[A-Z]{2,6}-[A-Z0-9]{4}\b/g) || [];
    const lead = codes.map((c) => this.leads.find((l) => l.code === c)).find(Boolean);
    if (!lead || lead.whatsappKey === key) return lead || null;
    lead.whatsappKey = key;
    if (phone && !lead.phone) lead.phone = phone;
    this.#log(lead, 'Sistema', 'mensagem', `O cliente chamou no WhatsApp com o código ${lead.code}`);
    this.store.save();
    this.notify('crm', { id: lead.id });
    return lead;
  }

  /** Cliente mandou mensagem: garante que existe um prospecto para ele. */
  ensureFromConversation({ key, phone, name, username, channel, referral, ownerId = null }) {
    if (this.config.autoCreate === false || String(key).startsWith('sim:')) return null;
    const existing = this.findForConversation({ key, phone, username });
    if (existing) {
      if (!existing.conversationKey) existing.conversationKey = key;
      if (referral && !existing.adTitle) {
        existing.adTitle = referral.title || referral.adId || 'anúncio';
        this.#log(existing, 'Sistema', 'mensagem', `Voltou pelo anúncio: ${existing.adTitle}`);
        this.store.save();
      }
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
      source: referral ? `${channel || 'whatsapp'}_ads` : channel || 'whatsapp',
      conversationKey: key,
      ownerId: ownerId && this.auth.get(ownerId) ? ownerId : null,
    });
    const created = this.leads.find((l) => l.id === lead.id);
    if (referral) {
      created.adTitle = referral.title || referral.adId || 'anúncio';
      this.#log(created, 'Sistema', 'mensagem', `Veio do anúncio: ${created.adTitle}`);
    }
    // Rodízio já na primeira mensagem (o padrão é só depois da peneira da IA).
    if (!created.ownerId && this.config.autoAssign === 'roundrobin') this.routeLead(created);
    this.store.save();
    return created;
  }

  /** Aplica o que a IA entendeu da conversa, sem atropelar o que um humano já preencheu. */
  applyAi(lead, info) {
    if (!lead || !info) return;
    const changes = [];
    if (info.nome && placeholderName(lead)) { lead.name = info.nome; changes.push(`nome: ${info.nome}`); }
    if (info.cidade && !lead.city) { lead.city = info.cidade; changes.push(`cidade: ${info.cidade}`); }
    const pkg = this.matchPackage(info.pacote);
    if (pkg && !lead.interest) {
      lead.interest = pkg.name;
      changes.push(`interesse: ${pkg.name}`);
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

/** Nome ainda é o provisório (vazio ou o @ do Instagram)? Então a IA pode trocar pelo nome real. */
const placeholderName = (lead) => !lead.name || lead.name.startsWith('@');

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return toDateStr(new Date(y, m - 1, d + days));
}

export const sourceLabel = (s) => ({ whatsapp: 'WhatsApp', instagram: 'Instagram', instagram_ads: 'Anúncio no Instagram', whatsapp_ads: 'Anúncio (WhatsApp)', manual: 'Cadastro manual', indicacao: 'Indicação', site: 'Site', evento: 'Evento' }[s] || s || 'Outro');
const fmtDate = (s) => s.split('-').reverse().join('/');
const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
