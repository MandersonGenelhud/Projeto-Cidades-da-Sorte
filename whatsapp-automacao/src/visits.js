// Visitas ao escritório da Migra no Paraguai (consultoria presencial com a equipe).
// A atendente registra o pedido e avisa quem cuida das visitas (Silvani); quem confirma dia e
// horário é essa pessoa, pelo painel, e o cliente recebe a confirmação no WhatsApp.
import crypto from 'node:crypto';

const err = (status, message) => Object.assign(new Error(message), { status });
const clean = (s, max = 300) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const fmtDate = (d) => (d ? d.split('-').reverse().join('/') : '');

// Lista do Marcos para quem vem ao escritório (áudio de 30/10/2026).
export const DEFAULT_BRING = 'o seu RG; a certidão de nascimento, de casamento ou de divórcio apostilada; a certidão negativa da Polícia Federal apostilada; e o valor da entrada para já começar. E não se esqueça de tirar o permiso (a entrada na Migração) quando entrar no Paraguai.';

const brl = (v) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
const OPEN = ['pendente', 'confirmada', 'remarcar', 'aguardando_taxa'];

export class Visits {
  /** notifyOwner(text) avisa o Marcos; sendTo(convKey, payload) fala com o cliente; remember(convKey, text) guarda na memória da atendente. */
  constructor({ store, crm, notifyOwner = async () => {}, sendTo = async () => {}, remember = () => {}, notify = () => {}, isClient = () => false }) {
    // isClient(prospecto): já é cliente (reserva paga)? Então a visita não tem taxa.
    Object.assign(this, { store, crm, notifyOwner, sendTo, remember, notify, isClient });
    store.data.visits ||= [];
  }

  get list() {
    return this.store.data.visits;
  }

  get config() {
    return this.store.settings.visits || {};
  }

  get enabled() {
    return this.config.enabled !== false;
  }

  get(id) {
    return this.list.find((v) => v.id === id) || null;
  }

  /** Taxa de assessoria presencial, paga antes de reservar o horário e estornada se o cliente fechar. 0 = sem taxa. */
  get fee() {
    return Number(this.config.consultFee ?? 125) || 0;
  }

  #clientOf(v) {
    return this.isClient(v.leadId ? this.crm.byId(v.leadId) : null);
  }

  /** Pedido feito pela atendente (ou pelo painel). */
  async request({ convKey = null, lead = null, phone = '', nome, data_preferida, periodo, pessoas, assunto, preparado, observacoes, feePending = false }) {
    const v = {
      id: crypto.randomBytes(5).toString('hex'),
      status: feePending ? 'aguardando_taxa' : 'pendente',
      convKey,
      leadId: lead?.id || null,
      phone: phone || lead?.phone || '',
      name: clean(nome, 80) || lead?.name || '',
      preferred: clean(data_preferida, 80),
      period: clean(periodo, 40),
      people: Math.max(1, Number(pessoas) || 1),
      subject: clean(assunto, 200),
      prepared: clean(preparado, 200),
      notes: clean(observacoes, 400),
      createdAt: new Date().toISOString(),
    };
    this.list.push(v);
    this.store.save();
    if (lead) this.crm.addNote({ name: 'IA', role: 'admin' }, lead.id, `🏢 Pediu visita ao escritório: ${v.preferred || 'sem data'}${v.period ? ` (${v.period})` : ''} · ${v.people} pessoa(s) · ${v.subject || '-'}`);
    this.notify('visits', { id: v.id, new: true });
    // Com taxa a pagar antes: quem confirma só é avisado depois que o Pix da taxa cair (feePaid).
    if (!feePending) await this.#alertDesk(v, lead);
    return v;
  }

  async #alertDesk(v, lead) {
    await this.notifyOwner([
      v.feePaidAt ? `🏢 *Pedido de visita ao escritório* ✅ TAXA DE ${brl(this.fee)} JÁ PAGA (atendimento com um consultor da equipe, não com o Marcos)` : '🏢 *Pedido de visita ao escritório* (atendimento com um consultor da equipe, não com o Marcos)',
      `👤 ${v.name || 'Cliente'}${v.phone ? ` · +${v.phone}` : ''}`,
      `📅 Prefere: ${v.preferred || 'não disse'}${v.period ? ` · ${v.period}` : ''}`,
      `👥 ${v.people} pessoa(s)`,
      v.subject ? `🎯 ${v.subject}` : '',
      v.prepared ? `💼 Vem preparado: ${v.prepared}` : '',
      lead?.code ? `🔖 ${lead.code}${lead.interest ? ` · ${lead.interest}` : ''}` : '',
      '',
      'Confirme o dia e o horário no painel, aba *Visitas*: o cliente recebe a confirmação no WhatsApp.',
    ].filter(Boolean).join('\n')).catch(() => {});
  }

  /** O Pix da taxa foi pago: agora sim a equipe é avisada para confirmar o dia e o horário. */
  async feePaid(id, payment = null) {
    const v = this.get(id);
    if (!v || v.feePaidAt) return v;
    Object.assign(v, { feePaidAt: new Date().toISOString(), feePaymentId: payment?.id || v.feePaymentId || null, feeAmount: payment?.amount ?? this.fee });
    if (v.status === 'aguardando_taxa') v.status = 'pendente';
    this.store.save();
    const lead = v.leadId ? this.crm.byId(v.leadId) : null;
    if (lead) this.crm.addNote({ name: 'Sistema', role: 'admin' }, lead.id, `💳 Taxa de assessoria presencial paga (${brl(v.feeAmount)}). Estornar se fechar com a Migra.`);
    this.notify('visits', { id: v.id });
    await this.#alertDesk(v, lead);
    return v;
  }

  /** Taxa paga por quem depois fechou com a Migra e ainda não foi estornada. */
  refundsDue() {
    return this.list.filter((v) => v.feePaidAt && !v.refundedAt && this.#clientOf(v));
  }

  markRefunded(id, { by = 'Equipe', note = '' } = {}) {
    const v = this.get(id);
    if (!v?.feePaidAt) throw err(400, 'Esta visita não tem taxa paga');
    Object.assign(v, { refundedAt: new Date().toISOString(), refundedBy: by, refundNote: clean(note, 200) });
    if (v.leadId) this.crm.addNote({ name: by, role: 'admin' }, v.leadId, `💸 Taxa de assessoria estornada (${brl(v.feeAmount || this.fee)})`);
    this.store.save();
    this.notify('visits', { id });
    return v;
  }

  // ---------- Aviso da nova regra para quem já pediu visita ----------
  /** Quem ainda não pagou a taxa nem recebeu o aviso, e não é cliente da Migra. Uma pessoa recebe uma única vez. */
  noticeTargets() {
    if (!(this.fee > 0)) return [];
    // Quem já foi avisado (por qualquer pedido do mesmo telefone ou conversa) não entra de novo.
    const seen = new Set(this.list.filter((v) => v.feeNoticeAt).map((v) => v.phone || v.convKey));
    return this.list.filter((v) => OPEN.includes(v.status) && v.convKey && !v.feePaidAt && !v.feeNoticeAt && !this.#clientOf(v)).filter((v) => {
      const k = v.phone || v.convKey;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  noticeText(v) {
    const first = (v.name || '').split(' ')[0];
    const fee = brl(this.fee);
    return [
      `Olá${first ? `, ${first}` : ''}! Aqui é a equipe da Migra Paraguai. 😊`,
      `Passando para avisar que mudamos o nosso agendamento presencial. Com a alta demanda e o tempo limitado da nossa agenda, o atendimento presencial com a equipe de assessoria agora tem uma taxa de reserva de horário de ${fee}.`,
      `Se você fechar com a Migra, esse valor é estornado: você não paga nada a mais. Se não fechar, você terá tido uma reunião presencial com a nossa assessoria, para orientar desde como chegar à fronteira até os primeiros passos do seu processo.`,
      'Fizemos isso para não perder tempo, nem o nosso nem o seu: assim reservamos a agenda para pessoas sérias e comprometidas com os seus resultados, e evitamos horários vazios de quem agenda e não vem.',
      `Se você faz parte desse time, é só me responder aqui que eu já emito o Pix de ${fee} para você reservar o seu horário. 🙌`,
    ].join('\n\n');
  }

  /** Envia o aviso, uma pessoa por vez e com intervalo (parece conversa e protege o número). Só quem o administrador escolheu. */
  async sendNotices(ids, { delayMs = () => 7000 + Math.random() * 6000, by = 'Administrador' } = {}) {
    if (this.noticeRun?.running) throw err(409, 'Já existe um envio em andamento');
    const targets = this.noticeTargets().filter((v) => !ids || ids.includes(v.id)).slice(0, 80);
    const run = (this.noticeRun = { running: true, total: targets.length, sent: 0, failed: 0, by, startedAt: new Date().toISOString() });
    for (const v of targets) {
      try {
        await this.sendTo(v.convKey, { text: this.noticeText(v) });
        this.remember(v.convKey, this.noticeText(v));
        v.feeNoticeAt = new Date().toISOString();
        if (v.leadId) this.crm.addNote({ name: by, role: 'admin' }, v.leadId, `📣 Avisado da taxa de assessoria presencial (${brl(this.fee)}), a ser paga antes de agendar`);
        run.sent += 1;
      } catch (e) {
        run.failed += 1;
        this.store.addLog({ type: 'error', message: `Aviso da taxa não enviado a ${v.name || v.phone}: ${e.message}` });
      }
      this.store.save();
      if (v !== targets.at(-1)) await new Promise((r) => setTimeout(r, delayMs()));
    }
    run.running = false;
    return run;
  }

  async #tell(v, text) {
    if (!v.convKey) return;
    try {
      await this.sendTo(v.convKey, { text });
      this.remember(v.convKey, text);
    } catch (e) {
      this.store.addLog({ type: 'error', message: `Visita: mensagem não enviada ao cliente (${e.message})` });
    }
  }

  /** O Marcos confirmou: dia, horário e (opcional) recado. */
  async confirm(id, { date, time, note = '', by = 'Marcos' }) {
    const v = this.get(id);
    if (!v) throw err(404, 'Visita não encontrada');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) || !/^\d{2}:\d{2}$/.test(String(time || ''))) throw err(400, 'Informe o dia e o horário');
    Object.assign(v, { status: 'confirmada', date, time, ownerNote: clean(note, 300), confirmedAt: new Date().toISOString(), confirmedBy: by });
    this.store.save();
    const c = this.config;
    const first = (v.name || '').split(' ')[0];
    await this.#tell(v, [
      `✅ Visita confirmada${first ? `, ${first}` : ''}!`,
      `📅 ${fmtDate(date)} às ${time}`,
      c.address ? `📍 ${c.address}` : '',
      v.ownerNote ? `\n${v.ownerNote}` : '',
      `\n📋 Lembre de vir preparado(a) para já iniciar: ${String(c.bring || DEFAULT_BRING).replace(/\.$/, '')}.\nAssim você aproveita a viagem e não precisa voltar depois.`,
      this.fee > 0 && !this.#clientOf(v) ? (v.feePaidAt ? `\n💡 Sua taxa de assessoria (${brl(v.feeAmount || this.fee)}) já está paga. Se você fechar com a Migra, ela é estornada.` : `\n💡 O atendimento presencial tem a taxa de reserva de ${brl(this.fee)}, paga antes pelo Pix. Fechando com a Migra, ela é estornada.`) : '',
    ].filter(Boolean).join('\n'));
    if (v.leadId) this.crm.addNote({ name: by, role: 'admin' }, v.leadId, `🏢 Visita confirmada para ${fmtDate(date)} às ${time}`);
    this.notify('visits', { id });
    return v;
  }

  /** Propor outro dia/horário (mensagem livre do Marcos). */
  async reschedule(id, { message }) {
    const v = this.get(id);
    if (!v) throw err(404, 'Visita não encontrada');
    const text = clean(message, 600);
    if (!text) throw err(400, 'Escreva a mensagem para o cliente');
    v.status = 'remarcar';
    this.store.save();
    await this.#tell(v, text);
    this.notify('visits', { id });
    return v;
  }

  async cancel(id, { message = '' } = {}) {
    const v = this.get(id);
    if (!v) throw err(404, 'Visita não encontrada');
    v.status = 'cancelada';
    this.store.save();
    if (message) await this.#tell(v, clean(message, 600));
    this.notify('visits', { id });
    return v;
  }

  done(id) {
    const v = this.get(id);
    if (!v) throw err(404, 'Visita não encontrada');
    v.status = 'realizada';
    this.store.save();
    return v;
  }

  /** Visitas do cliente desta conversa (para a atendente saber o que já foi pedido). */
  forConversation(convKey) {
    return this.list.filter((v) => v.convKey === convKey && OPEN.includes(v.status));
  }
}
