// Suporte interno: qualquer pessoa da equipe abre um chamado (problema no sistema, dúvida, pedido),
// com urgência e prazos de primeira resposta e de solução. O administrador responde e resolve.
// Quem abriu vê só os próprios chamados; o administrador vê todos.
import crypto from 'node:crypto';

const err = (status, message) => Object.assign(new Error(message), { status });
const clip = (v, n) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, n);
const MIN = 60_000;

// Prazos (minutos) por urgência: primeira resposta e solução.
export const SLA = {
  baixa: { label: 'Baixa', first: 8 * 60, solve: 48 * 60 },
  media: { label: 'Média', first: 2 * 60, solve: 24 * 60 },
  alta: { label: 'Alta', first: 45, solve: 4 * 60 },
  critica: { label: 'Crítica (parou o trabalho)', first: 30, solve: 60 },
};
export const STATUS = { aberto: 'Aberto', em_andamento: 'Em andamento', resolvido: 'Resolvido' };

export class Support {
  constructor({ store, notify = async () => {}, now = () => new Date() }) {
    Object.assign(this, { store, notify, now });
    store.data.supportTickets ||= [];
  }
  get all() { return this.store.data.supportTickets; }
  #canSee(user, t) { return user.role === 'admin' || t.createdById === user.id; }
  #get(user, id) { const t = this.all.find((x) => x.id === id); if (!t || !this.#canSee(user, t)) throw err(404, 'Chamado não encontrado'); return t; }
  #number() {
    const y = this.now().getFullYear();
    this.store.data.supportSeq ||= {};
    this.store.data.supportSeq[y] = (this.store.data.supportSeq[y] || 0) + 1;
    return `SUP-${y}-${String(this.store.data.supportSeq[y]).padStart(4, '0')}`;
  }

  /** Situação dos prazos: no prazo, vence em breve ou atrasado (primeira resposta e solução). */
  sla(t, nowMs = this.now().getTime()) {
    const late = (due, doneAt) => (doneAt ? Date.parse(doneAt) > Date.parse(due) : nowMs > Date.parse(due));
    return {
      firstLate: late(t.firstResponseDue, t.firstRespondedAt),
      solveLate: late(t.resolutionDue, t.resolvedAt),
      open: t.status !== 'resolvido',
    };
  }

  #view(t) { return { ...t, sla: this.sla(t), urgencyLabel: SLA[t.urgency]?.label || t.urgency, statusLabel: STATUS[t.status] || t.status }; }

  list(user, { status = 'abertos', q = '' } = {}) {
    const f = clip(q, 80).toLowerCase();
    const items = this.all.filter((t) => this.#canSee(user, t)
      && (status === 'todos' || (status === 'abertos' ? t.status !== 'resolvido' : t.status === status))
      && (!f || `${t.number} ${t.title} ${t.description} ${t.createdBy}`.toLowerCase().includes(f)))
      .sort((a, b) => (a.status === 'resolvido') - (b.status === 'resolvido') || Date.parse(a.resolutionDue) - Date.parse(b.resolutionDue));
    const mine = this.all.filter((t) => this.#canSee(user, t) && t.status !== 'resolvido');
    return {
      counts: { abertos: mine.length, atrasados: mine.filter((t) => { const s = this.sla(t); return s.firstLate || s.solveLate; }).length },
      items: items.slice(0, 300).map((t) => ({ ...this.#view(t), messages: undefined, lastMessage: t.messages.at(-1) || null })),
    };
  }

  get(user, id) { return this.#view(this.#get(user, id)); }

  async open(user, { title, description, urgency = 'media' } = {}) {
    const ti = clip(title, 140); const de = clip(description, 4000);
    if (!ti) throw err(400, 'Escreva um título curto para o chamado');
    if (!de) throw err(400, 'Descreva o que aconteceu (o que você fez, o que apareceu e onde)');
    const u = SLA[urgency] ? urgency : 'media';
    const at = this.now();
    const t = {
      id: crypto.randomBytes(6).toString('hex'), number: this.#number(), title: ti, description: de, urgency: u, status: 'aberto',
      createdById: user.id, createdBy: user.name, createdAt: at.toISOString(),
      firstResponseDue: new Date(at.getTime() + SLA[u].first * MIN).toISOString(), resolutionDue: new Date(at.getTime() + SLA[u].solve * MIN).toISOString(),
      firstRespondedAt: null, resolvedAt: null, solution: '', messages: [],
    };
    this.all.push(t);
    this.store.save();
    await this.notify('admins', `🛟 *Chamado ${t.number}* (${SLA[u].label})\n👤 ${user.name}\n📝 ${ti}\nResponder no painel: Suporte.`).catch(() => {});
    return this.#view(t);
  }

  async reply(user, id, { text } = {}) {
    const t = this.#get(user, id);
    const body = clip(text, 4000);
    if (!body) throw err(400, 'Escreva a mensagem');
    const admin = user.role === 'admin';
    const at = this.now().toISOString();
    t.messages.push({ at, byId: user.id, by: user.name, admin, text: body });
    if (admin && t.createdById !== user.id) {
      if (!t.firstRespondedAt) t.firstRespondedAt = at;
      if (t.status === 'aberto') t.status = 'em_andamento';
      await this.notify('user', { userId: t.createdById, text: `🛟 Resposta no seu chamado ${t.number} (${t.title}):\n${body.slice(0, 600)}` }).catch(() => {});
    } else if (t.status === 'resolvido') {
      // Quem abriu respondeu depois de resolvido: o chamado volta a ficar aberto.
      t.status = 'aberto'; t.resolvedAt = null;
      await this.notify('admins', `🛟 Chamado ${t.number} reaberto por ${user.name}: ${body.slice(0, 300)}`).catch(() => {});
    }
    this.store.save();
    return this.#view(t);
  }

  async resolve(user, id, { solution } = {}) {
    if (user.role !== 'admin') throw err(403, 'Só o administrador resolve chamados');
    const t = this.#get(user, id);
    const s = clip(solution, 2000);
    if (!s) throw err(400, 'Explique a solução (fica registrada para quem abriu)');
    const at = this.now().toISOString();
    Object.assign(t, { status: 'resolvido', resolvedAt: at, solution: s, resolvedBy: user.name });
    if (!t.firstRespondedAt) t.firstRespondedAt = at;
    this.store.save();
    await this.notify('user', { userId: t.createdById, text: `✅ Chamado ${t.number} resolvido: ${s.slice(0, 600)}` }).catch(() => {});
    return this.#view(t);
  }

  /** Chamados do sistema antigo (histórico). */
  importCapture(captura) {
    let added = 0;
    for (const a of captura?.api || []) {
      let p; try { p = new URL(a.url, 'http://x').pathname.replace(/\/+$/, ''); } catch { continue; }
      if (p !== '/api/support/tickets' || !Array.isArray(a.json?.tickets)) continue;
      for (const r of a.json.tickets) {
        if (!r?.ticket_number || this.all.some((t) => t.legacyNumber === r.ticket_number)) continue;
        const resolved = /resol|fech|clos|done/i.test(r.status || '') || Boolean(r.resolved_at);
        this.all.push({
          id: crypto.randomBytes(6).toString('hex'), number: r.ticket_number, legacyNumber: r.ticket_number, title: clip(r.title, 140) || 'Chamado do sistema antigo', description: clip(r.description, 4000),
          urgency: { low: 'baixa', medium: 'media', high: 'alta', critical: 'critica', urgent: 'critica' }[r.urgency] || (SLA[r.urgency] ? r.urgency : 'media'), status: resolved ? 'resolvido' : 'aberto',
          createdById: null, createdBy: clip(r.creator?.full_name || 'Sistema antigo', 80), createdAt: r.created_at || this.now().toISOString(),
          firstResponseDue: r.first_response_due_at || r.created_at, resolutionDue: r.resolution_due_at || r.created_at, firstRespondedAt: r.first_responded_at || null, resolvedAt: r.resolved_at || null,
          solution: clip(r.solution, 2000), messages: [], source: 'sistema antigo',
        });
        added += 1;
      }
    }
    if (added) this.store.save();
    return { added };
  }
}
