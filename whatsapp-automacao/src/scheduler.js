// Mensagens agendadas (única vez, diária, semanal ou mensal).
import { renderTemplate, uid } from './utils.js';

const CHECK_INTERVAL_MS = 20_000;

export function nextRun(date, repeat) {
  const d = new Date(date);
  if (repeat === 'daily') d.setDate(d.getDate() + 1);
  else if (repeat === 'weekly') d.setDate(d.getDate() + 7);
  else if (repeat === 'monthly') d.setMonth(d.getMonth() + 1);
  else return null;
  return d;
}

export class Scheduler {
  constructor({ store, wa, campaigns, notify }) {
    this.store = store;
    this.wa = wa;
    this.campaigns = campaigns;
    this.notify = notify || (() => {});
    this.timer = null;
    this.busy = false;
  }

  start() {
    this.timer = setInterval(() => this.tick().catch(() => {}), CHECK_INTERVAL_MS);
  }

  stop() {
    clearInterval(this.timer);
  }

  list() {
    return [...this.store.data.schedules].sort((a, b) => new Date(a.runAt) - new Date(b.runAt));
  }

  save(input) {
    const runAt = new Date(input.runAt);
    if (Number.isNaN(runAt.getTime())) throw new Error('Data/hora inválida');
    const target = input.target || { type: 'manual', phones: [] };
    if (!this.campaigns.resolveRecipients(target).length) throw new Error('Nenhum destinatário encontrado');
    if (!String(input.message || '').trim() && !input.media) throw new Error('Informe a mensagem');
    const item = {
      id: input.id || uid(),
      name: input.name?.trim() || 'Agendamento',
      message: String(input.message || ''),
      media: input.media || null,
      target,
      runAt: runAt.toISOString(),
      repeat: input.repeat || 'none',
      enabled: input.enabled !== false,
      lastRunAt: null,
      createdAt: new Date().toISOString(),
    };
    const list = this.store.data.schedules;
    const idx = list.findIndex((s) => s.id === item.id);
    if (idx >= 0) list[idx] = { ...list[idx], ...item, media: input.media ?? list[idx].media };
    else list.push(item);
    this.store.save();
    return item;
  }

  remove(id) {
    this.store.data.schedules = this.store.data.schedules.filter((s) => s.id !== id);
    this.store.save();
  }

  async tick(now = new Date()) {
    if (this.busy || this.wa.status !== 'connected') return;
    this.busy = true;
    try {
      const due = this.store.data.schedules.filter((s) => s.enabled && new Date(s.runAt) <= now);
      for (const s of due) await this.#execute(s);
    } finally {
      this.busy = false;
    }
  }

  async #execute(s) {
    const recipients = this.campaigns.resolveRecipients(s.target);
    if (recipients.length > 1) {
      // Vários destinatários: vira uma campanha, com os intervalos de segurança.
      const campaign = this.campaigns.create({
        name: `${s.name} (agendado)`,
        messages: [s.message],
        media: s.media,
        target: s.target,
      });
      try {
        this.campaigns.start(campaign.id);
      } catch (err) {
        this.store.addLog({ type: 'error', message: `Agendamento "${s.name}": ${err.message}. Campanha criada como rascunho.` });
      }
    } else {
      for (const r of recipients) {
        if (this.store.isBlacklisted(r.phone)) continue;
        const text = renderTemplate(s.message, r);
        try {
          await this.wa.send(r.phone, { text, media: s.media });
          this.store.addLog({ type: 'sent', phone: r.phone, message: text, schedule: s.name });
        } catch (err) {
          this.store.addLog({ type: 'error', phone: r.phone, message: `Agendamento "${s.name}": ${err.message}` });
        }
      }
    }

    s.lastRunAt = new Date().toISOString();
    let next = nextRun(s.runAt, s.repeat);
    // Se o servidor ficou desligado, pula para a próxima data futura.
    while (next && next <= new Date()) next = nextRun(next, s.repeat);
    if (next) s.runAt = next.toISOString();
    else s.enabled = false;
    this.store.save();
    this.notify('schedules', null);
  }
}
