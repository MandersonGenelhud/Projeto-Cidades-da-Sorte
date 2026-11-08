// Cobrança de vencidos e previsão de recebimento.
// Lê as parcelas das vendas (inclusive as copiadas do sistema antigo), monta a lista de atrasados com o tom certo para cada faixa de atraso
// e só envia depois que o administrador escolhe e aprova, com limite por dia, intervalo entre mensagens e horário comercial.
import crypto from 'node:crypto';

const DAY = 86_400_000;
export const MAX_PER_DAY = 40;
export const DEFAULTS = { perDay: 15, minGapSec: 40, maxGapSec: 90, fromHour: 8, toHour: 19, repeatDays: 7, sundays: false };
const iso = (d) => d.toISOString().slice(0, 10);
const brl = (v) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
const br = (d) => String(d || '').split('-').reverse().join('/');
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY);
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1).toLowerCase();

/** Faixa pelo atraso: tom cada vez mais direto, sempre educado. */
export const tier = (days) => (days <= 15 ? 'leve' : days <= 60 ? 'medio' : 'firme');
export function messageFor(row) {
  const nome = cap(firstName(row.client)) || 'tudo bem';
  const parcela = `${row.label ? `${row.label} ` : ''}no valor de ${brl(row.value)}${row.due ? `, com vencimento em ${br(row.due)}` : ''}`;
  const t = tier(row.daysLate);
  const fim = 'Se já pagou, é só me enviar o comprovante por aqui que eu dou baixa. Se preferir pagar no Pix ou no cartão, me avise que eu te envio agora.';
  if (t === 'leve') return `Olá, ${nome}! Tudo bem? Aqui é da Migra Paraguai. Passando para lembrar da parcela do seu contrato ${row.number}: ${parcela}. ${fim}`;
  if (t === 'medio') return `Olá, ${nome}! Aqui é da Migra Paraguai. Notamos que a parcela do contrato ${row.number} (${parcela}) ainda está em aberto. Queremos te ajudar a regularizar para o seu processo seguir sem atrasos. ${fim} Se houver alguma dificuldade, me conte: podemos conversar sobre a melhor forma.`;
  return `Olá, ${nome}. Aqui é da Migra Paraguai. A parcela do contrato ${row.number} (${parcela}) está em aberto há ${row.daysLate} dias e precisamos regularizar para não prejudicar o andamento do seu processo. ${fim} Responda esta mensagem e combinamos a melhor solução para você.`;
}

export class Collections {
  constructor({ store, sales, resolvePhone = () => '', send, canSend = () => true, now = () => new Date() }) {
    this.store = store; this.sales = sales; this.resolvePhone = resolvePhone; this.send = send; this.canSend = canSend; this.now = now;
    const d = (store.data.collections ||= { queue: [], log: [], config: {} });
    d.queue ||= []; d.log ||= []; d.config ||= {};
  }
  get data() { return this.store.data.collections; }
  get config() { return { ...DEFAULTS, ...this.data.config }; }
  setConfig(p = {}) {
    const c = { ...this.data.config };
    const num = (k, min, max) => { if (p[k] === undefined) return; const n = Math.round(Number(p[k])); if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${k}: use um número de ${min} a ${max}`); c[k] = n; };
    num('perDay', 1, MAX_PER_DAY); num('minGapSec', 20, 600); num('maxGapSec', 20, 900); num('fromHour', 0, 23); num('toHour', 1, 24); num('repeatDays', 1, 60);
    if (p.sundays !== undefined) c.sundays = Boolean(p.sundays);
    const m = { ...DEFAULTS, ...c };
    if (m.maxGapSec < m.minGapSec) throw new Error('O intervalo máximo não pode ser menor que o mínimo');
    if (m.toHour <= m.fromHour) throw new Error('O horário final precisa ser depois do inicial');
    this.data.config = c; this.store.save(); return this.config;
  }
  today() { return iso(this.now()); }

  /** Parcelas vencidas e ainda não recebidas, uma linha por parcela. */
  overdue({ minDays = 1, q = '', inOffice = () => true } = {}) {
    const t = this.today(); const n = String(q).toLowerCase().trim();
    const rows = [];
    for (const s of this.sales.list) {
      if (s.status === 'cancelada' || !inOffice(s)) continue;
      s.parcels.forEach((p, i) => {
        if (p.status === 'pago' || !p.due || p.due >= t) return;
        const daysLate = daysBetween(p.due, t);
        if (daysLate < minDays) return;
        const phone = this.resolvePhone(s) || '';
        const sentLog = this.data.log.filter((l) => l.ok && l.saleId === s.id && l.index === i); const last = sentLog.at(-1);
        const row = { key: `${s.id}:${i}`, saleId: s.id, index: i, number: s.legacyNumber || s.number, client: s.client?.nome || '', doc: s.client?.doc || '', phone, label: p.label, value: p.value, due: p.due, daysLate, tier: tier(daysLate), claimed: Boolean(p.claim), lastNoticeAt: last?.at || null, notices: sentLog.length, queued: this.data.queue.some((x) => x.key === `${s.id}:${i}`) };
        if (!n || `${row.number} ${row.client} ${row.doc} ${row.phone}`.toLowerCase().includes(n)) rows.push(row);
      });
    }
    return rows.sort((a, b) => b.daysLate - a.daysLate);
  }
  summary(rows) {
    const sum = (l) => Math.round(l.reduce((s, r) => s + r.value, 0) * 100) / 100;
    const by = (f) => rows.filter(f);
    return { parcelas: rows.length, valor: sum(rows), clientes: new Set(rows.map((r) => r.saleId)).size, semTelefone: by((r) => !r.phone).length,
      faixas: { leve: { n: by((r) => r.tier === 'leve').length, valor: sum(by((r) => r.tier === 'leve')) }, medio: { n: by((r) => r.tier === 'medio').length, valor: sum(by((r) => r.tier === 'medio')) }, firme: { n: by((r) => r.tier === 'firme').length, valor: sum(by((r) => r.tier === 'firme')) } } };
  }
  /** O administrador aprova: as parcelas escolhidas entram na fila (só quem tem telefone, sem aviso recente e sem pagamento informado). */
  enqueue(keys = [], by = '') {
    const rows = new Map(this.overdue().map((r) => [r.key, r]));
    const cfg = this.config; const t = this.today();
    const out = { queued: 0, skipped: [] };
    for (const key of [...new Set(keys)].slice(0, 500)) {
      const r = rows.get(key);
      if (!r) { out.skipped.push({ key, motivo: 'parcela não está mais vencida' }); continue; }
      if (!r.phone) { out.skipped.push({ key, client: r.client, motivo: 'sem telefone' }); continue; }
      if (r.queued) { out.skipped.push({ key, client: r.client, motivo: 'já está na fila' }); continue; }
      if (r.claimed) { out.skipped.push({ key, client: r.client, motivo: 'o vendedor avisou que o cliente pagou: confira antes' }); continue; }
      if (r.lastNoticeAt && daysBetween(r.lastNoticeAt.slice(0, 10), t) < cfg.repeatDays) { out.skipped.push({ key, client: r.client, motivo: `já avisado há menos de ${cfg.repeatDays} dias` }); continue; }
      this.data.queue.push({ id: crypto.randomBytes(5).toString('hex'), key, saleId: r.saleId, index: r.index, approvedBy: by, approvedAt: this.now().toISOString() });
      out.queued += 1;
    }
    this.store.save();
    return out;
  }
  cancelQueue() { const n = this.data.queue.length; this.data.queue = []; this.store.save(); return n; }
  sentToday() { const t = this.today(); return this.data.log.filter((l) => l.at.slice(0, 10) === t && l.ok).length; }
  inWindow() {
    const cfg = this.config; const d = this.now(); const h = d.getHours();
    return h >= cfg.fromHour && h < cfg.toHour && (cfg.sundays || d.getDay() !== 0);
  }
  /** Chamado de tempos em tempos: manda UMA mensagem da fila, se couber no limite, no horário e no intervalo. */
  async tick() {
    const q = this.data.queue; const cfg = this.config;
    if (!q.length || !this.canSend() || !this.inWindow() || this.sentToday() >= cfg.perDay) return null;
    const lastAt = this.data.log.at(-1)?.at;
    const wait = (this.#gap ??= (cfg.minGapSec + Math.random() * (cfg.maxGapSec - cfg.minGapSec)) * 1000);
    if (lastAt && this.now() - new Date(lastAt) < wait) return null;
    this.#gap = null;
    const item = q.shift();
    const sale = this.sales.list.find((s) => s.id === item.saleId); const p = sale?.parcels[item.index];
    const rows = this.overdue({ q: '' }); const row = rows.find((r) => r.key === item.key);
    const entry = { at: this.now().toISOString(), saleId: item.saleId, index: item.index, ok: false };
    // Se foi pago, cancelado ou o vendedor avisou o pagamento depois da aprovação, não manda.
    if (!sale || !p || !row || row.claimed || !row.phone) { entry.skip = 'não precisa mais (pago, avisado ou sem telefone)'; this.data.log.push(entry); this.store.save(); return entry; }
    try { await this.send(row.phone, messageFor(row)); entry.ok = true; entry.phone = row.phone; entry.tier = row.tier; } catch (e) { entry.error = String(e.message).slice(0, 160); }
    this.data.log.push(entry); this.data.log = this.data.log.slice(-5000); this.store.save();
    return entry;
  }
  #gap = null;
  status() { const cfg = this.config; return { queued: this.data.queue.length, sentToday: this.sentToday(), perDay: cfg.perDay, inWindow: this.inWindow(), config: cfg, recent: this.data.log.slice(-15).reverse() }; }

  /** Previsão: quanto entra em cada mês (a receber), o que já está atrasado e o que foi recebido. */
  forecast({ months = 12, inOffice = () => true } = {}) {
    const t = this.today(); const ym = (d) => String(d).slice(0, 7);
    const out = new Map(); const cell = (k) => { if (!out.has(k)) out.set(k, { month: k, toReceive: 0, received: 0, count: 0 }); return out.get(k); };
    let overdue = 0; let overdueCount = 0; let totalOpen = 0;
    for (const s of this.sales.list) {
      if (s.status === 'cancelada' || !inOffice(s)) continue;
      for (const p of s.parcels) {
        if (p.status === 'pago') { if (p.paidAt) cell(ym(p.paidAt)).received += p.value; continue; }
        totalOpen += p.value;
        if (!p.due) continue;
        if (p.due < t) { overdue += p.value; overdueCount += 1; continue; }
        const c = cell(ym(p.due)); c.toReceive += p.value; c.count += 1;
      }
    }
    const round = (v) => Math.round(v * 100) / 100;
    const thisMonth = ym(t);
    const list = [...out.values()].filter((c) => c.month >= ym(new Date(this.now().getTime() - 12 * 31 * DAY).toISOString()) ).sort((a, b) => a.month.localeCompare(b.month)).slice(-(months + 12)).map((c) => ({ ...c, toReceive: round(c.toReceive), received: round(c.received) }));
    return { today: t, thisMonth, overdue: round(overdue), overdueCount, totalOpen: round(totalOpen), months: list };
  }
}
