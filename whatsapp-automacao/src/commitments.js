// Compromissos marcados com clientes (horários do calendário e videochamadas): a atendente chama o cliente NA HORA marcada
// (ou o quanto antes, pedindo desculpas, se o sistema estava fora do ar) e lembra de antemão. Nada fica esquecido.
const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const BR = (iso) => String(iso).split('-').reverse().join('/');
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';

export class Commitments {
  constructor({ store, agent, videocalls = null, send, canSend = () => true, now = () => new Date(), log = () => {} }) {
    Object.assign(this, { store, agent, videocalls, send, canSend, now, log });
  }
  #inWindow() { const h = this.now().getHours(); return h >= 8 && h < 20; }

  /** Conversa do cliente pelo telefone (WhatsApp). Cria pela memória do telefone se ainda não existir. */
  #convFor(phone, name = '') {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return null;
    const all = Object.values(this.store.data.conversations || {});
    const hit = all.find((c) => !String(c.key).startsWith('ig:') && String(c.phone || '').replace(/\D/g, '') === digits) || all.find((c) => String(c.key).replace(/\D/g, '').startsWith(digits));
    if (hit) return { key: hit.key, conv: hit };
    const conv = this.agent.conversation(digits);
    conv.phone ||= digits; conv.name ||= name;
    return { key: digits, conv };
  }

  /** Horários do calendário (agendar_horario): lembrete antes e contato na hora. */
  async tickAppointments({ max = 6 } = {}) {
    if (!this.canSend() || !this.#inWindow()) return 0;
    const now = this.now(); let sent = 0;
    const list = (this.store.data.appointments || []).filter((a) => a.status === 'confirmed' && a.phone && !a.contactedAt)
      .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
    for (const a of list) {
      if (sent >= max) break;
      const start = new Date(`${a.date}T${a.time}:00`);
      const ahead = start - now; // positivo: ainda vai acontecer
      const found = this.#convFor(a.phone, a.name);
      if (!found || found.conv.handoff || !this.canSend(found.key)) { if (ahead < -14 * 86_400_000) { a.contactedAt = 'ignorado'; } continue; }
      // Passou de duas semanas: não chama mais (já é outro assunto).
      if (ahead < -14 * 86_400_000) { a.contactedAt = 'ignorado'; continue; }
      // Lembrete de véspera: de 2h a 26h antes, uma vez só.
      if (ahead > 2 * 3_600_000 && ahead <= 26 * 3_600_000 && !a.remindedAt) {
        const when = a.date === isoDay(now) ? 'hoje' : 'amanhã';
        await this.send(found.key, `Olá, ${firstName(a.name)}! Passando para lembrar do nosso horário ${when}, às ${a.time.replace(':00', 'h')}${a.service ? ` (${a.service})` : ''}. Está tudo certo para você? Se precisar mudar, é só me avisar por aqui.`);
        a.remindedAt = now.toISOString(); this.store.save(); sent += 1;
        continue;
      }
      if (ahead > 0) continue;
      // Chegou a hora: a atendente chama o cliente e continua o atendimento (com desculpas se atrasou).
      const late = Math.round(-ahead / 60_000);
      try {
        const r = await this.agent.think(found.conv, { extraSystem: `# Horário marcado com o cliente (é agora)
Você marcou com ${a.name || 'este cliente'} ${BR(a.date)} às ${a.time}${a.service ? ` (${a.service})` : ''}. Chegou a hora. Mande UMA mensagem curta, com a saudação do horário: lembre o horário combinado e dê continuidade ao atendimento dele de onde pararam (pergunte se pode falar agora).${late > 30 ? ' Você NÃO chamou na hora combinada: peça desculpas com humildade, em UMA frase curta e sem drama.' : ''} Não se despeça.` });
        await this.send(found.key, r.text);
        this.agent.remember(found.conv, 'assistant', r.text);
        a.contactedAt = now.toISOString(); this.store.save(); sent += 1;
        this.log({ type: 'system', message: `📅 Horário marcado: ${a.name || a.phone} chamado (${BR(a.date)} ${a.time}${late > 30 ? `, ${late} min depois` : ''})` });
      } catch (e) { this.log({ type: 'error', message: `Horário marcado (${a.name}): ${e.message}` }); a.contactedAt = `erro: ${String(e.message).slice(0, 60)}`; this.store.save(); }
    }
    return sent;
  }

  /** Videochamadas confirmadas: lembrete com o link, de 20 a 90 minutos antes (uma vez). */
  async tickVideocalls() {
    if (!this.videocalls || !this.canSend()) return 0;
    const now = this.now(); let sent = 0;
    for (const b of this.videocalls.upcoming()) {
      if (b.remindedAt || !b.phone) continue;
      const ahead = new Date(`${b.date}T${b.time}:00`) - now;
      if (ahead < 20 * 60_000 || ahead > 90 * 60_000) continue;
      const found = this.#convFor(b.phone, b.name);
      if (!found || !this.canSend(found.key)) continue;
      await this.send(found.key, `Olá, ${firstName(b.name)}! Daqui a pouco, às ${b.time.replace(':00', 'h')}, é a nossa videochamada com o consultor.${b.meetLink ? ` Link da sala: ${b.meetLink}` : ' O consultor envia o link da sala em instantes.'} Se estiver com o marido/a esposa, já deixe tudo pronto para entrarem juntos.`);
      b.remindedAt = now.toISOString(); this.store.save(); sent += 1;
    }
    return sent;
  }
}
