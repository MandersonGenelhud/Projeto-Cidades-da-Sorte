// Agenda de videochamadas com a equipe: a IA marca quando o cliente diz que vai falar com marido, esposa ou família.
// Regras: horários espaçados (nunca colados), sem domingo, sábado só de manhã, e quem atende (ex.: Eliezer) liga e desliga
// a própria disponibilidade ou avisa que um dia não dá. Nada é enviado a ninguém por este módulo: quem envia é o servidor.
import { uid } from './utils.js';
import { WEEKDAYS, parseLocal, parseRanges, toDateStr } from './agent/calendar.js';

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };

export const DEFAULTS = {
  enabled: true,
  durationMin: 40, // tempo da conversa
  gapMin: 60, // distância mínima entre dois começos (40 de conversa + folga)
  minAdvanceMin: 120,
  maxDaysAhead: 14,
  meetLink: '',
  // 0 = domingo ... 6 = sábado. Domingo fechado; sábado até o meio-dia.
  hours: { 0: '', 1: '09:00-12:00, 14:00-18:00', 2: '09:00-12:00, 14:00-18:00', 3: '09:00-12:00, 14:00-18:00', 4: '09:00-12:00, 14:00-18:00', 5: '09:00-12:00, 14:00-18:00', 6: '09:00-12:00' },
};

const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && Boolean(parseLocal(s));
const brDate = (d) => d.split('-').reverse().join('/');

export class VideoCalls {
  constructor({ store, auth, now = () => new Date() }) {
    this.store = store;
    this.auth = auth;
    this.now = now;
    const d = (store.data.videocall ||= { config: {}, hosts: {}, bookings: [] });
    d.config ||= {}; d.hosts ||= {}; d.bookings ||= [];
    // Primeira vez: quem se chama Eliezer já nasce como a pessoa que faz as videochamadas (o administrador muda quando quiser).
    if (!d.seeded) {
      d.seeded = true;
      for (const u of auth.users) if (/^eliezer\b/i.test(u.name || '')) d.hosts[u.id] = { active: true, offDates: [] };
      store.save();
    }
  }

  get data() { return this.store.data.videocall; }
  get config() {
    const c = { ...DEFAULTS, ...this.data.config };
    c.hours = { ...DEFAULTS.hours, ...(this.data.config.hours || {}) };
    return c;
  }

  setConfig(patch = {}) {
    // Trabalha numa cópia: se algo for inválido, nada é gravado.
    const c = structuredClone(this.data.config);
    if (patch.enabled !== undefined) c.enabled = Boolean(patch.enabled);
    for (const [k, min, max] of [['durationMin', 10, 180], ['gapMin', 15, 480], ['minAdvanceMin', 0, 2880], ['maxDaysAhead', 1, 60]]) {
      if (patch[k] !== undefined) { const n = Math.round(Number(patch[k])); if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${k}: use um número entre ${min} e ${max}`); c[k] = n; }
    }
    const cfg = { ...DEFAULTS, ...c };
    if (cfg.gapMin < cfg.durationMin) throw new Error('A distância entre videochamadas não pode ser menor que a duração da conversa');
    if (patch.meetLink !== undefined) {
      const v = String(patch.meetLink || '').trim();
      if (v && !/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(v)) throw new Error('O link da sala precisa começar com https://');
      c.meetLink = v;
    }
    if (patch.hours) {
      c.hours ||= {};
      for (let i = 0; i < 7; i++) if (patch.hours[i] !== undefined) {
        const txt = String(patch.hours[i] || '').trim();
        if (txt && !parseRanges(txt).length) throw new Error(`Horário inválido em ${WEEKDAYS[i]}. Use assim: 09:00-12:00, 14:00-18:00`);
        c.hours[i] = txt;
      }
    }
    this.data.config = c;
    this.store.save();
    return this.config;
  }

  // ---- quem atende ----
  hostEntry(userId) { return this.data.hosts[userId] || null; }
  isHost(userId) { return Boolean(this.hostEntry(userId)); }
  setHost(userId, on) {
    if (!this.auth.get(userId)) throw new Error('Usuário não encontrado');
    if (on) this.data.hosts[userId] ||= { active: true, offDates: [] };
    else delete this.data.hosts[userId];
    this.store.save();
  }
  /** O próprio atendente liga/desliga e avisa dias sem atendimento. */
  setMine(userId, { active, offDate, clearDate, tomorrowOff } = {}) {
    const h = this.hostEntry(userId);
    if (!h) throw new Error('Você não está na lista de quem faz videochamadas. Peça ao administrador.');
    if (active !== undefined) h.active = Boolean(active);
    const today = toDateStr(this.now());
    if (tomorrowOff) { const t = new Date(this.now()); t.setDate(t.getDate() + 1); h.offDates = [...new Set([...(h.offDates || []), toDateStr(t)])]; }
    if (offDate) { if (!isDay(offDate)) throw new Error('Data inválida'); h.offDates = [...new Set([...(h.offDates || []), offDate])]; }
    if (clearDate) h.offDates = (h.offDates || []).filter((d) => d !== clearDate);
    h.offDates = (h.offDates || []).filter((d) => d >= today).sort();
    this.store.save();
    return this.mine(userId);
  }
  mine(userId) {
    const h = this.hostEntry(userId);
    if (!h) return null;
    return { active: h.active !== false, offDates: h.offDates || [], bookings: this.upcoming({ hostId: userId }), needsReschedule: this.needsReschedule({ hostId: userId }) };
  }
  hosts() {
    return Object.entries(this.data.hosts).map(([id, h]) => ({ id, name: this.auth.get(id)?.name || '(removido)', active: h.active !== false, offDates: h.offDates || [] }));
  }
  #hostFree(id, date) {
    const h = this.data.hosts[id];
    const u = this.auth.get(id);
    return Boolean(h && h.active !== false && u && u.active !== false && !(h.offDates || []).includes(date));
  }

  // ---- reservas ----
  upcoming({ hostId } = {}) {
    const today = toDateStr(this.now());
    return this.data.bookings.filter((b) => b.status === 'confirmed' && b.date >= today && (!hostId || b.hostId === hostId)).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  }
  /** Reservas em dia que quem atende marcou como "não posso": alguém precisa remarcar com o cliente. */
  needsReschedule({ hostId } = {}) {
    return this.upcoming({ hostId }).filter((b) => !this.#hostFree(b.hostId, b.date));
  }
  forPhone(phone) { return phone ? this.upcoming().filter((b) => b.phone === phone) : []; }

  /** Horários livres de um dia (já respeitando espaçamento, domingo/sábado, folgas e antecedência). */
  slots(date) {
    const cfg = this.config;
    const day = parseLocal(date);
    if (!cfg.enabled) return { date, closed: true, motivo: 'As videochamadas estão desligadas no momento.', slots: [] };
    if (!day) return { date, error: 'Data inválida. Use AAAA-MM-DD.', slots: [] };
    const today = parseLocal(toDateStr(this.now()));
    if (day < today) return { date, error: 'Essa data já passou.', slots: [] };
    if ((day - today) / 86_400_000 > cfg.maxDaysAhead) return { date, error: `Só marco videochamada com até ${cfg.maxDaysAhead} dias de antecedência.`, slots: [] };
    const weekday = WEEKDAYS[day.getDay()];
    const ranges = parseRanges(cfg.hours[day.getDay()]);
    if (!ranges.length) return { date, weekday, closed: true, motivo: day.getDay() === 0 ? 'Domingo não há atendimento.' : 'Não há atendimento nesse dia.', slots: [] };
    if (!Object.keys(this.data.hosts).some((id) => this.#hostFree(id, date))) return { date, weekday, closed: true, motivo: 'Nesse dia não há ninguém disponível para a videochamada.', slots: [] };
    const earliest = new Date(this.now().getTime() + cfg.minAdvanceMin * 60_000);
    const taken = this.data.bookings.filter((b) => b.status === 'confirmed' && b.date === date).map((b) => toMin(b.time));
    const slots = [];
    for (const [start, end] of ranges) {
      for (let m = start; m + cfg.durationMin <= end; m += cfg.gapMin) {
        if (taken.some((t) => Math.abs(t - m) < cfg.gapMin)) continue;
        if (parseLocal(date, hhmm(m)) < earliest) continue;
        slots.push(hhmm(m));
      }
    }
    return { date, weekday, slots };
  }

  /** A partir de uma data, os próximos dias com horário livre (para a IA oferecer sem tentar dia por dia). */
  nextDays(from, { days = 3 } = {}) {
    const start = parseLocal(isDay(from) ? from : toDateStr(new Date(this.now().getTime() + 86_400_000)));
    const out = []; const closed = [];
    for (let i = 0; i < 21 && out.length < days; i++) {
      const d = new Date(start); d.setDate(d.getDate() + i);
      const r = this.slots(toDateStr(d));
      if (r.error && /antecedência/.test(r.error)) break;
      if (r.slots?.length) out.push({ data: r.date, dia: r.weekday, horarios: r.slots });
      else if (i === 0 && r.motivo) closed.push({ data: r.date, dia: r.weekday, motivo: r.motivo });
    }
    return { dias: out, primeiroDiaSemAtendimento: closed[0] || null };
  }

  book({ date, time, name, phone, people, notes, convKey, source = 'ia' }, { dryRun = false } = {}) {
    const r = this.slots(date);
    if (r.error) throw new Error(r.error);
    if (r.closed) throw new Error(r.motivo || 'Não atendemos nesse dia.');
    if (!r.slots.includes(time)) throw new Error(`O horário ${time} não está livre. Livres: ${r.slots.join(', ') || 'nenhum'}`);
    // Quem atende nesse dia e tem menos videochamadas marcadas.
    const hostId = Object.keys(this.data.hosts).filter((id) => this.#hostFree(id, date))
      .sort((a, b) => this.data.bookings.filter((x) => x.hostId === a && x.status === 'confirmed').length - this.data.bookings.filter((x) => x.hostId === b && x.status === 'confirmed').length)[0];
    const cfg = this.config;
    const b = { id: uid(), status: 'confirmed', date, time, durationMin: cfg.durationMin, hostId, hostName: this.auth.get(hostId)?.name || '', name: String(name || '').slice(0, 120), phone: phone || '', convKey: convKey || '', people: Number(people) || null, notes: String(notes || '').slice(0, 500), meetLink: cfg.meetLink, source, createdAt: new Date().toISOString() };
    if (dryRun) return { ...b, id: 'teste', dryRun: true };
    // Um cliente só tem uma videochamada marcada: remarcar troca a anterior.
    for (const old of this.forPhone(phone)) { old.status = 'canceled'; old.canceledAt = b.createdAt; old.canceledReason = 'remarcada'; }
    this.data.bookings.push(b);
    this.data.bookings = this.data.bookings.filter((x) => x.status === 'confirmed' || (Date.now() - Date.parse(x.createdAt)) < 90 * 86_400_000).slice(-3000);
    this.store.save();
    return b;
  }

  cancel(id, reason = 'cancelada') {
    const b = this.data.bookings.find((x) => x.id === id && x.status === 'confirmed');
    if (!b) throw new Error('Videochamada não encontrada');
    b.status = 'canceled'; b.canceledAt = new Date().toISOString(); b.canceledReason = reason;
    this.store.save();
    return b;
  }

  /** Texto para o prompt da IA: regras do dia a dia da agenda. */
  promptInfo() {
    const cfg = this.config;
    const hosts = this.hosts().filter((h) => h.active).map((h) => h.name.split(' ')[0]);
    return [
      `Quem faz as videochamadas: ${hosts.join(' ou ') || '(ninguém disponível agora: não ofereça videochamada)'}.`,
      `Cada videochamada dura ${cfg.durationMin} minutos e os horários ficam espaçados (${cfg.gapMin} min entre um e outro). Só ofereça horários devolvidos pela ferramenta, nunca invente.`,
      'Domingo não há atendimento; sábado só pela manhã. Se amanhã não tiver atendimento, a ferramenta devolve o próximo dia com horário.',
    ].join('\n');
  }
  fmt(b) { return `${brDate(b.date)} às ${b.time}`; }
}
