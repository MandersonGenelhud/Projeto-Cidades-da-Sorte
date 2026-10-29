// Etapas de pagamento do processo (o "fluxograma" que o cliente recebe).
// Regra do material "Seu pagamento, passo a passo" da Migra: a entrada
// (R$ 1.000 + R$ 800 por adulto) é paga na assinatura e abatida do total;
// o saldo é dividido em 50% na 1ª vinda, 30% na 2ª vinda e 20% na retirada.
import crypto from 'node:crypto';

export const DEFAULT_STEPS = [
  { pct: 50, when: 'Com 15 dias', note: 'Na sua primeira vinda ao Paraguai' },
  { pct: 30, when: 'Com 90 dias', note: 'Na sua segunda vinda ao Paraguai' },
  { pct: 20, when: 'Com 120 dias', note: 'Quando retirar os documentos' },
];

const cents = (v) => Math.round(Number(v || 0) * 100) / 100;
export const money = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * price: valor do pacote por pessoa; people: pessoas no processo; adults: adultos (taxa das certidões).
 * Devolve { total, entry, balance, parcels: [{ label, pct, value, when, note }] }. As parcelas somam o saldo exato.
 */
export function paymentPlan({ price, people = 1, adults = people, base = 1000, perAdult = 800, steps = DEFAULT_STEPS }) {
  const p = Math.max(1, Math.round(Number(people) || 1));
  const a = Math.max(1, Math.min(p, Math.round(Number(adults) || p)));
  const total = cents(Number(price) * p);
  const entry = cents(Number(base) + Number(perAdult) * a);
  const balance = cents(Math.max(0, total - entry));
  let rest = balance;
  const parcels = steps.map((s, i) => {
    const value = i === steps.length - 1 ? cents(rest) : cents((balance * Number(s.pct)) / 100);
    rest = cents(rest - value);
    return { label: `${i + 1}ª parcela`, pct: Number(s.pct), value, when: s.when, note: s.note };
  });
  return { total, entry, balance, people: p, adults: a, parcels };
}

/** Mensagem de WhatsApp com o passo a passo (fluxograma em texto). */
export function planMessage(plan, { packageName = '', link = '' } = {}) {
  const lines = [
    `📋 *Seu pagamento, passo a passo*${packageName ? `\n${packageName} · ${plan.people} pessoa${plan.people > 1 ? 's' : ''}` : ''}`,
    '',
    `✍️ *Na assinatura do termo*\nEntrada: ${money(plan.entry)}`,
    ...plan.parcels.flatMap((x) => ['⬇️', `${x.label === '3ª parcela' ? '🪪' : '✈️'} *${x.when}*\n${x.label}: ${money(x.value)}\n${x.note}`]),
    '',
    `💰 *Valor total: ${money(plan.total)}*`,
    'As datas das viagens e da retirada são confirmadas pela equipe.',
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

  create({ leadId = null, convKey = null, packageName = '', price, people, adults }) {
    const pay = this.store.settings.payments || {};
    const plan = paymentPlan({
      price, people, adults,
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
