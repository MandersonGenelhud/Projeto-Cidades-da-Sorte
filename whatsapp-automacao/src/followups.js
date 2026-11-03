// Retorno combinado: quando o cliente pede "mais pra frente", a atendente marca dia e hora
// com ele. No dia, o sistema retoma a conversa sozinho (uma mensagem curta, com o próximo passo).
const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const BR = (iso) => iso.split('-').reverse().join('/');
// Só 'perdido' fica de fora: quem já é cliente (ganho) também recebe o retorno combinado.
const OPEN_STAGES = new Set(['novo', 'em_contato', 'proposta', 'aguardando', 'ganho']);
const WD = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** Mensagens que só confirmam o combinado ("ok, até terça às 14h", "boa noite", "amém"): não mudam o assunto, então o retorno segue valendo. */
const ACK = /^(ok(ay)?|beleza|blz|combinado|certo|certinho|perfeito|obrigad[oa]|valeu|am[eé]m|show|fechado|sim|tudo bem|boa (noite|tarde|dia)|at[eé]|abra[cç]o|deus|tmj|👍|🙏|😊|❤)/i;
export const isAck = (text) => { const t = String(text || '').trim(); return t.length <= 90 && (ACK.test(t) || /^[\p{Emoji}\s!.,;:]+$/u.test(t) || /(ter[cç]a|quarta|quinta|sexta|segunda|s[aá]bado|amanh[aã]|\d{1,2}\s*(h|:|;)\d{0,2})/i.test(t) && t.length <= 60); };

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
    limit.setDate(limit.getDate() + 366);
    if (date > isoDay(limit)) return { erro: 'No máximo 12 meses. Proponha uma data mais próxima ao cliente.' };
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

  /**
   * Recupera retornos que a atendente combinou e que se perderam (ex.: o cliente respondeu "ok, até terça" e o retorno foi cancelado sem enviar).
   * Procura no histórico do prospecto o último "Retorno agendado" feito pela IA, sem o registro de que foi cumprido, e o recoloca na fila
   * (a retomada pede desculpas pelo atraso). Atrasados de até 21 dias e todos os futuros.
   */
  recoverMissed({ days = 21, max = 80 } = {}) {
    const today = isoDay(this.now());
    const min = new Date(this.now()); min.setDate(min.getDate() - days);
    const minIso = isoDay(min);
    let n = 0;
    for (const lead of this.crm.leads) {
      if (n >= max) break;
      if (lead.stage === 'perdido' || lead.followUpAt) continue;
      const tl = lead.timeline || [];
      let idx = -1;
      for (let i = tl.length - 1; i >= 0; i--) if (tl[i].type === 'retorno') { idx = i; break; }
      if (idx < 0) continue;
      const e = tl[idx];
      if (!['IA', 'Sistema'].includes(e.by)) continue; // retorno marcado por uma pessoa continua com a pessoa
      const m = /Retorno agendado para (\d{2})\/(\d{2})\/(\d{4})/.exec(e.text || '');
      if (!m) continue;
      const date = `${m[3]}-${m[2]}-${m[1]}`;
      if (date < minIso) continue;
      if (tl.slice(idx + 1).some((x) => /Retorno combinado feito|Retomada antecipada|Retorno recuperado/.test(x.text || ''))) continue;
      Object.assign(lead, { followUpAt: date, followUpAuto: true, followUpSentFor: null, followUpAutoFailed: null, followUpMissed: true, followUpTime: lead.followUpTime || '10:00' });
      if (lead.stage !== 'ganho') lead.stage = 'aguardando';
      this.crm.addNote({ name: 'Sistema', role: 'admin' }, lead.id, `🔁 Retorno recuperado: estava combinado para ${BR(date)} e não foi feito. A atendente chama o cliente, pede desculpas e continua o atendimento.`);
      n += 1;
    }
    if (n) this.store.save();
    return n;
  }

  /** Clientes com retorno marcado para o futuro (depois de hoje), que ainda não foram reconfirmados para essa data. */
  futureList({ minDays = 1, ids = null } = {}) {
    const from = new Date(this.now());
    from.setDate(from.getDate() + minDays);
    const start = isoDay(from);
    return this.crm.leads.filter((l) => l.followUpAt && l.followUpAt >= start && !['ganho', 'perdido'].includes(l.stage)
      && (!ids || ids.includes(l.id)) && l.reconfirmedFor !== l.followUpAt)
      .sort((a, b) => a.followUpAt.localeCompare(b.followUpAt));
  }

  /**
   * Retomada antecipada: a IA chama, um por um (com intervalo), quem marcou retorno para o futuro,
   * confirma a data combinada e oferece adiantar o início. Só das 8h às 20h, só WhatsApp
   * (o Instagram só deixa responder até 24h depois do cliente), e pula quem um humano assumiu.
   */
  async reconfirm({ minDays = 1, ids = null, max = 25, gapMs = 60_000, wait = (ms) => new Promise((r) => setTimeout(r, ms)), onProgress = () => {} } = {}) {
    const now = this.now();
    const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const out = { sent: [], skipped: [] };
    if (hhmm < '08:00' || hhmm > '20:00') return { ...out, erro: 'Fora do horário (8h às 20h). Tente de novo no horário comercial.' };
    const list = this.futureList({ minDays, ids }).slice(0, max);
    for (const [i, lead] of list.entries()) {
      const who = lead.name || lead.phone || lead.code;
      let key = lead.followUpKey || lead.conversationKey || lead.whatsappKey || null;
      if (key && String(key).startsWith('ig:')) key = lead.whatsappKey || null;
      let conv = key ? this.agent.conversation(key, { create: false }) : null;
      if (!conv && lead.phone) {
        key = lead.whatsappKey || lead.phone;
        conv = this.agent.conversation(key);
        conv.phone ||= lead.phone;
        conv.name ||= lead.name || '';
      }
      const skip = (reason) => { out.skipped.push({ id: lead.id, name: who, reason }); onProgress(out); };
      if (!conv) { skip('sem WhatsApp cadastrado'); continue; }
      if (conv.handoff) { skip('um atendente assumiu a conversa'); continue; }
      if (!this.canSend(key)) { skip('WhatsApp desconectado ou atendente de IA desligada'); continue; }
      try {
        const r = await this.agent.think(conv, {
          extraSystem: `# Retomada antecipada (o retorno combinado é só em ${BR(lead.followUpAt)})
Este cliente pediu para conversar mais para frente e ficou combinado ${BR(lead.followUpAt)}. Motivo da espera: ${lead.followUpReason || '-'}. O que falta: ${lead.followUpNext || '-'}.
Mande UMA mensagem curta, com a saudação do horário e o nome dele: diga que está passando para confirmar o que ficou combinado para ${BR(lead.followUpAt)} e mostre, com verdade, por que vale adiantar (o processo leva em média 90 a 120 dias úteis; começando agora, ele fica pronto antes da data que quer). Termine com uma escolha que leve ao próximo passo, por exemplo: "Você prefere já garantir a sua reserva esta semana ou eu deixo tudo encaminhado para começarmos em ${BR(lead.followUpAt)}?". Não peça desculpas, não se despeça e não invente condição especial.`,
        });
        await this.send(key, r.text);
        this.agent.remember(conv, 'assistant', r.text);
        Object.assign(lead, { reconfirmedFor: lead.followUpAt, reconfirmedAt: now.toISOString(), followUpMsgCount: conv.messages.length });
        this.crm.addNote({ name: 'IA', role: 'admin' }, lead.id, `🔁 Retomada antecipada pela IA (retorno marcado para ${BR(lead.followUpAt)}): "${r.text.slice(0, 200)}"`);
        this.store.save();
        out.sent.push({ id: lead.id, name: who });
        this.log({ type: 'system', message: `🔁 Retomada antecipada enviada para ${who} (retorno de ${BR(lead.followUpAt)})` });
      } catch (e) {
        skip(`erro: ${e.message}`);
        continue;
      }
      onProgress(out);
      if (i < list.length - 1) await wait(gapMs);
    }
    return out;
  }

  /** Conversa do WhatsApp deste prospecto (cria pela memória do telefone se ainda não existir). Instagram sozinho não dá: a Meta só deixa responder em 24h. */
  #convFor(lead) {
    let key = lead.followUpKey || lead.conversationKey || lead.whatsappKey || null;
    if (key && String(key).startsWith('ig:')) key = lead.whatsappKey || null;
    let conv = key ? this.agent.conversation(key, { create: false }) : null;
    if (!conv && lead.phone) {
      key = lead.whatsappKey || lead.phone;
      conv = this.agent.conversation(key);
      conv.phone ||= lead.phone;
      conv.name ||= lead.name || '';
    }
    return conv ? { key, conv } : null;
  }

  /** Retomadas do dia: só no horário combinado, das 8h às 20h, e se o cliente não voltou a falar antes. */
  async run({ max = 15, gapMs = 45_000, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    const now = this.now();
    const today = isoDay(now);
    const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    if (hhmm < '08:00' || hhmm > '20:00') return 0;
    const due = this.crm.leads.filter((l) => l.followUpAuto && OPEN_STAGES.has(l.stage) && l.followUpAt
      && (l.followUpAt < today || (l.followUpAt === today && (l.followUpTime || '10:00') <= hhmm))
      && l.followUpSentFor !== l.followUpAt);
    let sent = 0;
    // Terminou o retorno: sai da agenda e o prospecto volta para "em contato" (a conversa segue com a atendente).
    const finish = () => { lead0.followUpAt = null; lead0.followUpAuto = false; if (lead0.stage === 'aguardando') lead0.stage = 'em_contato'; this.store.save(); };
    let lead0 = null;
    for (const lead of due.slice(0, max)) {
      lead0 = lead;
      const dueAt = new Date(`${lead.followUpAt}T${lead.followUpTime || '10:00'}:00`);
      const lateMin = Math.max(0, Math.round((now - dueAt) / 60_000));
      const found = this.#convFor(lead);
      // Sem WhatsApp para responder ou um atendente já assumiu: a equipe é avisada (aviso normal do dia do retorno).
      const fail = () => { lead.followUpAutoFailed = lead.followUpAt; lead.followUpSentFor = lead.followUpAt; this.store.save(); };
      if (!found || found.conv.handoff) { fail(); continue; }
      const { key, conv } = found;
      // WhatsApp desligado agora: tenta de novo no próximo ciclo; só avisa a equipe se passar do dia.
      if (!this.canSend(key)) { if (lead.followUpAt < today) fail(); continue; }
      lead.followUpSentFor = lead.followUpAt; // uma tentativa por data (não insiste se der erro)
      this.store.save();
      // O cliente falou de OUTRO assunto depois de marcar o retorno: a conversa seguiu e a atendente já cuida. Só confirmar o combinado ("ok, até terça às 14h") não cancela nada.
      const after = conv.messages.slice(lead.followUpMsgCount ?? conv.messages.length).filter((m) => m.role === 'user');
      if (after.some((m) => !isAck(m.content))) { finish(); continue; }
      // Conversa ativa agora (mensagem nos últimos 8 minutos): espera o próximo ciclo para não atravessar o cliente. Depois de 90 minutos de atraso manda mesmo assim.
      const lastAt = conv.messages.at(-1)?.at ? new Date(conv.messages.at(-1).at) : null;
      const idle = lastAt ? now - lastAt : Infinity;
      if (idle >= 0 && idle < 8 * 60_000 && lateMin < 90) { lead.followUpSentFor = null; this.store.save(); continue; }
      try {
        const r = await this.agent.think(conv, {
          extraSystem: `# Retorno combinado (é hoje)
Você combinou com este cliente de retomar hoje. Motivo da espera: ${lead.followUpReason || '-'}. O que falta: ${lead.followUpNext || '-'}.
Mande UMA mensagem curta, com a saudação do horário: lembre o que foi combinado e proponha o próximo passo concreto (de preferência a ficha de dados para garantir a reserva).${lateMin > 30 ? ` Você combinou ${lead.followUpTime ? `para as ${String(lead.followUpTime).replace(':00', 'h')}` : 'para este horário'} e NÃO retornou na hora: peça desculpas com humildade, em UMA frase curta e sem drama (ex.: "Peço perdão por não ter te chamado no horário combinado"), e logo dê continuidade ao atendimento dele de onde pararam.` : ' Não peça desculpas.'} Não se despeça.`,
        });
        await this.send(key, r.text);
        this.agent.remember(conv, 'assistant', r.text);
        this.crm.addNote({ name: 'IA', role: 'admin' }, lead.id, `📅 Retorno combinado feito pela IA: "${r.text.slice(0, 200)}"`);
        sent++;
        finish();
        this.log({ type: 'system', message: `📅 Retorno combinado enviado para ${lead.name || lead.phone || key}` });
      } catch (e) {
        this.log({ type: 'error', message: `Retorno combinado (${lead.name || key}): ${e.message}` });
        fail();
      }
      if (sent < due.length) await wait(gapMs);
    }
    return sent;
  }
}
