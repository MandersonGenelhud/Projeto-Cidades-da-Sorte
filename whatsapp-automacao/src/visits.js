// Visitas ao escritório da Migra no Paraguai (atendimento pessoal com o Marcos).
// A atendente registra o pedido e avisa o Marcos; quem confirma dia e horário é ele,
// pelo painel, e o cliente recebe a confirmação no WhatsApp.
import crypto from 'node:crypto';

const err = (status, message) => Object.assign(new Error(message), { status });
const clean = (s, max = 300) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const fmtDate = (d) => (d ? d.split('-').reverse().join('/') : '');

export const DEFAULT_BRING = 'documentos para iniciar o processo (RG frente e verso ou passaporte e uma foto de meio corpo, bem reconhecível) e o valor da entrada para já começar';

export class Visits {
  /** notifyOwner(text) avisa o Marcos; sendTo(convKey, payload) fala com o cliente; remember(convKey, text) guarda na memória da atendente. */
  constructor({ store, crm, notifyOwner = async () => {}, sendTo = async () => {}, remember = () => {}, notify = () => {} }) {
    Object.assign(this, { store, crm, notifyOwner, sendTo, remember, notify });
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

  /** Pedido feito pela atendente (ou pelo painel). */
  async request({ convKey = null, lead = null, phone = '', nome, data_preferida, periodo, pessoas, assunto, preparado, observacoes }) {
    const v = {
      id: crypto.randomBytes(5).toString('hex'),
      status: 'pendente',
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
    await this.notifyOwner([
      '🏢 *Pedido de visita ao escritório*',
      `👤 ${v.name || 'Cliente'}${v.phone ? ` · +${v.phone}` : ''}`,
      `📅 Prefere: ${v.preferred || 'não disse'}${v.period ? ` · ${v.period}` : ''}`,
      `👥 ${v.people} pessoa(s)`,
      v.subject ? `🎯 ${v.subject}` : '',
      v.prepared ? `💼 Vem preparado: ${v.prepared}` : '',
      lead?.code ? `🔖 ${lead.code}${lead.interest ? ` · ${lead.interest}` : ''}` : '',
      '',
      'Confirme o dia e o horário no painel, aba *Visitas*: o cliente recebe a confirmação no WhatsApp.',
    ].filter(Boolean).join('\n')).catch(() => {});
    return v;
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
      `\nLembre de vir preparado(a) para já iniciar: ${c.bring || DEFAULT_BRING}. Assim você aproveita a viagem e não precisa voltar depois.`,
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
    return this.list.filter((v) => v.convKey === convKey && ['pendente', 'confirmada', 'remarcar'].includes(v.status));
  }
}
