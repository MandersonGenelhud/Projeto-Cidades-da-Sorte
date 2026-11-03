// Tarefas da equipe: o que cada pessoa precisa fazer, com prazo e lembrete no WhatsApp (uma vez, no dia do prazo ou quando atrasar).
// Separadas dos "retornos" do prospecto: servem para qualquer coisa (conferir pagamento, ligar para cliente, renovar documento).
import crypto from 'node:crypto';

const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !Number.isNaN(Date.parse(d));
const br = (d) => String(d).split('-').reverse().join('/');

export class Tasks {
  constructor({ store, auth, now = () => new Date() }) {
    this.store = store; this.auth = auth; this.now = now;
    store.data.tasks ||= [];
  }
  get all() { return this.store.data.tasks; }
  today() { return this.now().toISOString().slice(0, 10); }
  #canSee(user, t) { return user.role === 'admin' || t.assigneeId === user.id || t.createdById === user.id; }
  list(user, { status = 'open', q = '', who = '' } = {}) {
    const n = String(q).toLowerCase(); const today = this.today();
    return this.all.filter((t) => this.#canSee(user, t) && (status === 'all' || (status === 'done' ? t.status === 'done' : t.status === 'open'))
      && (!who || t.assigneeId === who) && (!n || `${t.title} ${t.notes} ${t.clientName}`.toLowerCase().includes(n)))
      .map((t) => ({ ...t, late: t.status === 'open' && Boolean(t.due) && t.due < today, assigneeName: this.auth.get(t.assigneeId)?.name || '' }))
      .sort((a, b) => (a.status === b.status ? (a.due || '9999').localeCompare(b.due || '9999') : a.status === 'open' ? -1 : 1));
  }
  counts(user) { const l = this.list(user); return { open: l.length, late: l.filter((t) => t.late).length, today: l.filter((t) => t.due === this.today()).length }; }
  add(user, b) {
    const title = clip(b.title, 140); if (!title) throw new Error('Escreva o que precisa ser feito');
    const due = String(b.due || '').trim(); if (due && !isDay(due)) throw new Error('Data inválida');
    let assigneeId = String(b.assigneeId || user.id);
    // Vendedor só cria tarefa para si; o administrador escolhe a pessoa.
    if (user.role !== 'admin') assigneeId = user.id;
    const who = this.auth.get(assigneeId); if (!who || who.active === false) throw new Error('Pessoa não encontrada');
    const t = { id: crypto.randomBytes(6).toString('hex'), title, notes: clip(b.notes, 500), due, assigneeId, createdById: user.id, createdBy: user.name, clientName: clip(b.clientName, 120), clientPhone: clip(b.clientPhone, 30), status: 'open', createdAt: this.now().toISOString(), remindedAt: null, doneAt: null };
    this.all.push(t); this.all.splice(0, Math.max(0, this.all.length - 5000)); this.store.save(); return t;
  }
  #mustOwn(user, id) { const t = this.all.find((x) => x.id === id); if (!t || !this.#canSee(user, t)) throw new Error('Tarefa não encontrada'); return t; }
  update(user, id, b) {
    const t = this.#mustOwn(user, id);
    if (b.title !== undefined) { const v = clip(b.title, 140); if (!v) throw new Error('Escreva o que precisa ser feito'); t.title = v; }
    if (b.notes !== undefined) t.notes = clip(b.notes, 500);
    if (b.due !== undefined) { const d = String(b.due || '').trim(); if (d && !isDay(d)) throw new Error('Data inválida'); t.due = d; t.remindedAt = null; }
    if (b.assigneeId !== undefined && user.role === 'admin') { const w = this.auth.get(String(b.assigneeId)); if (!w) throw new Error('Pessoa não encontrada'); t.assigneeId = w.id; t.remindedAt = null; }
    if (b.done !== undefined) { t.status = b.done ? 'done' : 'open'; t.doneAt = b.done ? this.now().toISOString() : null; }
    this.store.save(); return t;
  }
  remove(user, id) { const t = this.#mustOwn(user, id); if (user.role !== 'admin' && t.createdById !== user.id) throw new Error('Só quem criou ou o administrador exclui'); this.store.data.tasks = this.all.filter((x) => x.id !== id); this.store.save(); return t; }

  /** Quem precisa de lembrete: tarefa aberta que venceu hoje ou antes e ainda não foi lembrada. */
  due() { const today = this.today(); return this.all.filter((t) => t.status === 'open' && t.due && t.due <= today && !t.remindedAt); }
  reminderText(t) {
    const when = t.due === this.today() ? 'vence hoje' : `venceu em ${br(t.due)}`;
    return `⏰ *Tarefa: ${t.title}*\n${when}${t.clientName ? `\nCliente: ${t.clientName}` : ''}${t.notes ? `\n${t.notes}` : ''}\n\nQuando terminar, marque como feita no painel (Tarefas).`;
  }
  /** Manda os lembretes (um por tarefa). `send(phone, text)` é o envio do WhatsApp. */
  async remind(send) {
    let n = 0;
    for (const t of this.due()) {
      const w = this.auth.get(t.assigneeId);
      if (!w?.whatsapp) { t.remindedAt = this.now().toISOString(); continue; }
      try { await send(w.whatsapp, this.reminderText(t)); t.remindedAt = this.now().toISOString(); n += 1; } catch { /* tenta na próxima rodada */ }
    }
    this.store.save();
    return n;
  }
}
