// Agenda usada pelo agente: agenda interna (padrão) ou Cal.com.
// Datas e horas ficam no fuso do negócio (variável TZ, padrão America/Sao_Paulo).
import { uid } from '../utils.js';

export const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

const pad = (n) => String(n).padStart(2, '0');
export const toDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toTimeStr = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function parseLocal(date, time = '00:00') {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  const tm = /^(\d{1,2}):(\d{2})$/.exec(String(time || ''));
  if (!dm || !tm) return null;
  const d = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]));
  return toDateStr(d) === date ? d : null; // rejeita 2026-02-31 etc.
}

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** "08:00-12:00, 13:00-18:00" -> [[480, 720], [780, 1080]] */
export function parseRanges(text) {
  return String(text || '')
    .split(',')
    .map((r) => r.trim().match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/))
    .filter(Boolean)
    .map((m) => [toMinutes(m[1]), toMinutes(m[2])])
    .filter(([a, b]) => b > a);
}

class BaseCalendar {
  constructor({ store, getConfig, now = () => new Date() }) {
    this.store = store;
    this.getConfig = getConfig;
    this.now = now;
  }

  /** Valida a data pedida: formato, passado e limite de dias. */
  checkDate(date) {
    const day = parseLocal(date);
    if (!day) return 'Data inválida. Use o formato AAAA-MM-DD.';
    const today = parseLocal(toDateStr(this.now()));
    if (day < today) return 'Essa data já passou.';
    const maxDays = Number(this.getConfig().maxDaysAhead || 30);
    if ((day - today) / 86_400_000 > maxDays) return `Só é possível agendar com até ${maxDays} dias de antecedência.`;
    return null;
  }

  listByPhone(phone) {
    const today = toDateStr(this.now());
    return this.store.data.appointments
      .filter((a) => a.phone === phone && a.status === 'confirmed' && a.date >= today)
      .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  }

  saveAppointment(data) {
    const appt = {
      id: uid(),
      status: 'confirmed',
      createdAt: new Date().toISOString(),
      ...data,
    };
    this.store.data.appointments.push(appt);
    this.store.save();
    return appt;
  }

  findOwn(id, phone) {
    return this.store.data.appointments.find((a) => a.id === id && (!phone || a.phone === phone) && a.status === 'confirmed');
  }
}

export class LocalCalendar extends BaseCalendar {
  async getSlots(date) {
    const error = this.checkDate(date);
    if (error) return { date, error, slots: [] };
    const cfg = this.getConfig();
    const day = parseLocal(date);
    const weekday = WEEKDAYS[day.getDay()];
    const ranges = parseRanges(cfg.hours?.[day.getDay()]);
    if (!ranges.length) return { date, weekday, closed: true, slots: [] };

    const step = Math.max(5, Number(cfg.slotMinutes || 30));
    const earliest = new Date(this.now().getTime() + Number(cfg.minAdvanceMinutes || 0) * 60_000);
    const taken = new Set(
      this.store.data.appointments.filter((a) => a.date === date && a.status === 'confirmed').map((a) => a.time),
    );
    const slots = [];
    for (const [start, end] of ranges) {
      for (let m = start; m + step <= end; m += step) {
        const time = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
        if (taken.has(time)) continue;
        if (parseLocal(date, time) < earliest) continue;
        slots.push(time);
      }
    }
    return { date, weekday, slots };
  }

  async book({ date, time, name, phone, service, notes }, { dryRun = false } = {}) {
    const { slots, error, closed } = await this.getSlots(date);
    if (error) throw new Error(error);
    if (closed) throw new Error('Não atendemos nesse dia.');
    if (!slots.includes(time)) throw new Error(`O horário ${time} não está disponível. Livres: ${slots.join(', ') || 'nenhum'}`);
    const data = { date, time, name, phone, service: service || '', notes: notes || '', provider: 'local' };
    if (dryRun) return { ...data, id: 'teste', status: 'confirmed', dryRun: true };
    return this.saveAppointment(data);
  }

  async cancel(id, phone, { dryRun = false } = {}) {
    const appt = this.findOwn(id, phone);
    if (!appt) throw new Error('Agendamento não encontrado');
    if (dryRun) return { ...appt, status: 'canceled', dryRun: true };
    appt.status = 'canceled';
    appt.canceledAt = new Date().toISOString();
    this.store.save();
    return appt;
  }
}

export class CalComCalendar extends BaseCalendar {
  constructor(opts) {
    super(opts);
    this.fetch = opts.fetchImpl || globalThis.fetch;
  }

  async #request(path, { method = 'GET', body, version }) {
    const cfg = this.getConfig().calcom || {};
    if (!cfg.apiKey || !cfg.eventTypeId) throw new Error('Configure a chave e o ID do tipo de evento do Cal.com');
    const res = await this.fetch(`https://api.cal.com/v2${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'cal-api-version': version,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.status === 'error') {
      throw new Error(`Cal.com: ${data.error?.message || data.message || `HTTP ${res.status}`}`);
    }
    return data.data;
  }

  async #rawSlots(date) {
    const cfg = this.getConfig().calcom;
    const qs = new URLSearchParams({
      eventTypeId: String(cfg.eventTypeId),
      start: date,
      end: date,
      timeZone: cfg.timeZone || process.env.TZ || 'America/Sao_Paulo',
    });
    const data = await this.#request(`/slots?${qs}`, { version: '2024-09-04' });
    return data?.[date] || [];
  }

  async getSlots(date) {
    const error = this.checkDate(date);
    if (error) return { date, error, slots: [] };
    const raw = await this.#rawSlots(date);
    // "2026-10-30T14:00:00.000-03:00" -> "14:00" (já no fuso pedido)
    return { date, weekday: WEEKDAYS[parseLocal(date).getDay()], slots: raw.map((s) => String(s.start).slice(11, 16)) };
  }

  async book({ date, time, name, phone, service, notes, email }, { dryRun = false } = {}) {
    const error = this.checkDate(date);
    if (error) throw new Error(error);
    const cfg = this.getConfig().calcom;
    const raw = await this.#rawSlots(date);
    const slot = raw.find((s) => String(s.start).slice(11, 16) === time);
    if (!slot) throw new Error(`O horário ${time} não está disponível.`);
    const data = { date, time, name, phone, service: service || '', notes: notes || '', provider: 'calcom' };
    if (dryRun) return { ...data, id: 'teste', status: 'confirmed', dryRun: true };

    const attendeeEmail = email || cfg.defaultEmail;
    if (!attendeeEmail) throw new Error('Configure o e-mail padrão do Cal.com ou peça o e-mail do cliente');
    const booking = await this.#request('/bookings', {
      method: 'POST',
      version: '2024-08-13',
      body: {
        start: new Date(slot.start).toISOString(),
        eventTypeId: Number(cfg.eventTypeId),
        attendee: {
          name,
          email: attendeeEmail,
          timeZone: cfg.timeZone || 'America/Sao_Paulo',
          phoneNumber: `+${phone}`,
          language: 'pt-BR',
        },
        metadata: { origem: 'whatsapp', servico: String(service || '').slice(0, 40) },
      },
    });
    return this.saveAppointment({ ...data, externalId: booking?.uid || booking?.id });
  }

  async cancel(id, phone, { dryRun = false } = {}) {
    const appt = this.findOwn(id, phone);
    if (!appt) throw new Error('Agendamento não encontrado');
    if (dryRun) return { ...appt, status: 'canceled', dryRun: true };
    if (appt.externalId) {
      await this.#request(`/bookings/${appt.externalId}/cancel`, {
        method: 'POST',
        version: '2024-08-13',
        body: { cancellationReason: 'Cancelado pelo cliente via WhatsApp' },
      });
    }
    appt.status = 'canceled';
    appt.canceledAt = new Date().toISOString();
    this.store.save();
    return appt;
  }
}

/** Retorna a agenda configurada (troca na hora se o usuário mudar no painel). */
export function createCalendar({ store, now, fetchImpl }) {
  const getConfig = () => store.settings.agenda;
  const local = new LocalCalendar({ store, getConfig, now });
  const calcom = new CalComCalendar({ store, getConfig, now, fetchImpl });
  return new Proxy({}, {
    get: (_t, prop) => {
      const target = getConfig().provider === 'calcom' ? calcom : local;
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
