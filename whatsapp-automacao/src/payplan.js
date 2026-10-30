// Etapas de pagamento do processo (o "fluxograma" que o cliente recebe).
// Regra do material "Seu pagamento, passo a passo" da Migra: a entrada
// (R$ 1.000 + R$ 800 por adulto) é paga na assinatura e abatida do total;
// o saldo é dividido em 50% na 1ª vinda, 30% na 2ª vinda e 20% na retirada.
import crypto from 'node:crypto';

export const DEFAULT_STEPS = [
  { pct: 50, days: 15, when: 'Com 15 dias', note: 'Na sua primeira vinda ao Paraguai' },
  { pct: 30, days: 90, when: 'Com 90 dias', note: 'Na sua segunda vinda ao Paraguai' },
  { pct: 20, days: 120, when: 'Com 120 dias', note: 'Quando retirar os documentos' },
];

const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const pad = (n) => String(n).padStart(2, '0');
/** Hoje no formato AAAA-MM-DD (horário local do computador). */
export function todayIso(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
/** Soma dias a uma data AAAA-MM-DD; caindo no sábado ou domingo, passa para a segunda. */
export function dueDate(startIso, days) {
  const [y, m, d] = String(startIso).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + Number(days || 0)));
  const wd = dt.getUTCDay();
  const moved = wd === 6 ? 2 : wd === 0 ? 1 : 0;
  if (moved) dt.setUTCDate(dt.getUTCDate() + moved);
  return { date: `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`, weekday: WEEKDAYS[dt.getUTCDay()], moved: Boolean(moved) };
}
export const fmtBr = (iso) => String(iso || '').split('-').reverse().join('/');
const dayLabel = (x) => `${x.weekday.replace('-feira', '')}, ${fmtBr(x.date)}`;

const cents = (v) => Math.round(Number(v || 0) * 100) / 100;
export const money = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * price: valor do pacote por pessoa; people: pessoas no processo; adults: adultos (taxa das certidões);
 * total: valor fechado (quando o orçamento mistura pacotes), no lugar de price × people.
 * Devolve { total, entry, balance, parcels: [{ label, pct, value, when, note }] }. As parcelas somam o saldo exato.
 */
export function paymentPlan({ price, people = 1, adults = people, base = 1000, perAdult = 800, steps = DEFAULT_STEPS, start = todayIso(), total: fixedTotal = null }) {
  const p = Math.max(1, Math.round(Number(people) || 1));
  // Com total fixo (orçamento com pacotes diferentes), os adultos não ficam presos ao número de pessoas.
  const a = Math.max(1, fixedTotal != null ? Math.round(Number(adults) || p) : Math.min(p, Math.round(Number(adults) || p)));
  const total = cents(fixedTotal != null ? fixedTotal : Number(price) * p);
  const entry = cents(Number(base) + Number(perAdult) * a);
  const balance = cents(Math.max(0, total - entry));
  let rest = balance;
  const parcels = steps.map((s, i) => {
    const value = i === steps.length - 1 ? cents(rest) : cents((balance * Number(s.pct)) / 100);
    rest = cents(rest - value);
    const days = Number(s.days ?? DEFAULT_STEPS[i]?.days ?? 0);
    const due = dueDate(start, days);
    return { label: `${i + 1}ª parcela`, pct: Number(s.pct), value, days, when: s.when || `Com ${days} dias`, note: s.note, date: due.date, weekday: due.weekday, moved: due.moved };
  });
  const st = dueDate(start, 0);
  return { total, entry, base: cents(base), perAdult: cents(perAdult), balance, people: p, adults: a, start, startWeekday: WEEKDAYS[new Date(`${start}T12:00:00Z`).getUTCDay()], startMoved: st.moved, parcels };
}

/** Mensagem de WhatsApp com o passo a passo (fluxograma em texto). */
export function planMessage(plan, { packageName = '', link = '' } = {}) {
  const lines = [
    `📋 *Seu pagamento, passo a passo*${packageName ? `\n${packageName} · ${plan.people} pessoa${plan.people > 1 ? 's' : ''}` : ''}`,
    '',
    `✍️ *Na assinatura do termo${plan.start ? ` · ${plan.startWeekday.replace('-feira', '')}, ${fmtBr(plan.start)}` : ''}*\nEntrada: ${money(plan.entry)}${plan.base !== undefined ? `\n• ${money(plan.base)}: sinal de contratação dos serviços\n• ${money(plan.perAdult * plan.adults)} (${money(plan.perAdult)} × ${plan.adults} adulto${plan.adults > 1 ? 's' : ''}): certidões da Interpol e da Informática da Polícia Nacional do Paraguai, sem as quais não conseguimos iniciar o processo` : ''}`,
    ...plan.parcels.flatMap((x, i) => ['⬇️', `${i === plan.parcels.length - 1 ? '🪪' : '✈️'} *${x.date ? `${dayLabel(x)} · ` : ''}${x.when.toLowerCase()}*\n${x.label}: ${money(x.value)}\n${x.note}`]),
    '',
    `💰 *Valor total: ${money(plan.total)}*`,
    plan.parcels.some((x) => x.moved) ? 'Quando o prazo cai no sábado ou domingo, a data passa para a segunda-feira.\nAs datas das viagens e da retirada são confirmadas pela equipe.' : 'As datas das viagens e da retirada são confirmadas pela equipe.',
  ];
  if (link) lines.push('', `Veja o passo a passo completo: ${link}`);
  return lines.join('\n');
}

/** Planos enviados aos clientes (para a página visual /etapas/:id). */
export class PayPlans {
  constructor({ store, secret }) {
    this.store = store;
    this.secret = secret;
    store.data.payplans ||= [];
  }

  token(id) {
    return crypto.createHmac('sha256', this.secret).update(`etapas:${id}`).digest('base64url').slice(0, 16);
  }

  /** Calcula sem guardar (calculadora do painel). */
  preview({ price, people, adults, start }) {
    const pay = this.store.settings.payments || {};
    return paymentPlan({
      price, people, adults, start: start || todayIso(),
      base: pay.reservation?.base ?? 1000,
      perAdult: pay.reservation?.perAdult ?? 800,
      steps: pay.plan?.steps?.length ? pay.plan.steps : DEFAULT_STEPS,
    });
  }

  create({ leadId = null, convKey = null, packageName = '', price, people, adults, start }) {
    const pay = this.store.settings.payments || {};
    const plan = paymentPlan({
      price, people, adults, start: start || todayIso(),
      base: pay.reservation?.base ?? 1000,
      perAdult: pay.reservation?.perAdult ?? 800,
      steps: pay.plan?.steps?.length ? pay.plan.steps : DEFAULT_STEPS,
    });
    const rec = { id: crypto.randomBytes(6).toString('hex'), leadId, convKey, packageName, price: Number(price), plan, createdAt: new Date().toISOString() };
    this.store.data.payplans.push(rec);
    if (this.store.data.payplans.length > 2000) this.store.data.payplans.splice(0, this.store.data.payplans.length - 2000);
    this.store.save();
    return rec;
  }

  get(id, t) {
    const rec = this.store.data.payplans.find((p) => p.id === id);
    if (!rec || t !== this.token(id)) return null;
    return rec;
  }
}
