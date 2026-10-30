// Retorno combinado: quando o cliente pede "mais pra frente", a atendente marca dia e hora
// com ele. No dia, o sistema retoma a conversa sozinho (uma mensagem curta, com o próximo passo).
const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const BR = (iso) => iso.split('-').reverse().join('/');
const WD = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export class AutoFollowUps {
  /** send(key, text) manda ao cliente; canSend(key) diz se o WhatsApp/Instagram daquela conversa está ligado. */
  constructor({ store, crm, agent, send, canSend = () => true, now = () => new Date(), log = () => {} }) {
    Object.assign(this, { store, crm, agent, send, canSend, now, log });
  }

  /** Ferramenta da IA: registra o retorno combinado. */
  async schedule(conv, args, { dryRun = false } = {}) {
    const today = isoDay(this.now());
    const date = String(args.data || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today) return { erro: 'Data inválida: use AAAA-MM-DD, de hoje em diante.' };
    const limit = new Date(this.now());
    limit.setDate(limit.getDate() + 90);
    if (date > isoDay(limit)) return { erro: 'No máximo 90 dias. Proponha uma data mais próxima ao cliente.' };
    let time = /^\d{1,2}:\d{2}$/.test(String(args.hora || '')) ? String(args.hora).padStart(5, '0') : '10:00';
    if (time < '08:00') time = '08:00';
    if (time > '20:00') time = '20:00';
    const wd = WD[new Date(`${date}T12:00:00`).getDay()];
    const say = `Confirme ao cliente em uma frase: "Combinado! ${wd === 'domingo' || wd === 'sábado' ? wd : `${wd}-feira`}, dia ${BR(date)}, às ${time.replace(':00', 'h')} eu te chamo aqui." Se fizer sentido, deixe uma tarefa simples até lá (ex.: separar o RG). Não se despeça.`;
    if (dryRun || String(conv.key).startsWith('sim:')) return { ok: true, simulacao: true, instrucao: say };
    const lead = this.crm.findForConversation({ key: conv.key, phone: conv.phone, username: conv.username })
      || this.crm.ensureFromConversation({ key: conv.key, phone: conv.phone, name: conv.name, username: conv.username, channel: String(conv.key).startsWith('ig:') ? 'instagram' : 'whatsapp' });
    if (!lead) return { erro: 'Não consegui registrar o cliente no CRM.' };
    this.crm.followUp({ name: 'IA', role: 'admin' }, lead.id, { date, reason: String(args.motivo || '').slice(0, 300) });
    Object.assign(lead, { followUpTime: time, followUpAuto: true, followUpNext: String(args.o_que_falta || '').slice(0, 300), followUpKey: conv.key, followUpSentFor: null, followUpMsgCount: conv.messages.length });
    this.store.save();
    return { ok: true, data: date, hora: time, instrucao: say };
  }

  /** Retomadas do dia: só no horário combinado, das 8h às 20h, e se o cliente não voltou a falar antes. */
  async run({ max = 15, gapMs = 45_000, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    const now = this.now();
    const today = isoDay(now);
    const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    if (hhmm < '08:00' || hhmm > '20:00') return 0;
    const due = this.crm.leads.filter((l) => l.followUpAuto && l.stage === 'aguardando' && l.followUpAt
      && (l.followUpAt < today || (l.followUpAt === today && (l.followUpTime || '10:00') <= hhmm))
      && l.followUpSentFor !== l.followUpAt);
    let sent = 0;
    for (const lead of due.slice(0, max)) {
      const key = lead.followUpKey || lead.conversationKey || lead.whatsappKey;
      const conv = key ? this.agent.conversation(key, { create: false }) : null;
      lead.followUpSentFor = lead.followUpAt; // uma tentativa por data (não insiste se der erro)
      this.store.save();
      if (!conv || conv.handoff || !this.canSend(key)) continue;
      // O cliente já voltou a falar depois de marcar o retorno: a conversa seguiu, não precisa retomar.
      if (conv.messages.slice(lead.followUpMsgCount ?? conv.messages.length).some((m) => m.role === 'user')) continue;
      try {
        const r = await this.agent.think(conv, {
          extraSystem: `# Retorno combinado (é hoje)
Você combinou com este cliente de retomar hoje. Motivo da espera: ${lead.followUpReason || '-'}. O que falta: ${lead.followUpNext || '-'}.
Mande UMA mensagem curta, com a saudação do horário: lembre o que foi combinado e proponha o próximo passo concreto (de preferência a ficha de dados para garantir a reserva). Não peça desculpas e não se despeça.`,
        });
        await this.send(key, r.text);
        this.agent.remember(conv, 'assistant', r.text);
        this.crm.addNote({ name: 'IA', role: 'admin' }, lead.id, `📅 Retorno combinado feito pela IA: "${r.text.slice(0, 200)}"`);
        sent++;
        this.log({ type: 'system', message: `📅 Retorno combinado enviado para ${lead.name || lead.phone || key}` });
      } catch (e) {
        this.log({ type: 'error', message: `Retorno combinado (${lead.name || key}): ${e.message}` });
      }
      if (sent < due.length) await wait(gapMs);
    }
    return sent;
  }
}
