// Consumo da IA por escritório (tokens e respostas) e calculadora de preço do serviço.
// Os preços do Google NÃO vêm do código: o administrador digita os valores atuais (ai.google.dev/pricing),
// assim a conta nunca usa um número velho ou inventado.
const KEEP_DAYS = 400;
const dayOf = (d = new Date()) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const num = (v, max = 1e9) => Math.min(max, Math.max(0, Number(v) || 0));
const round2 = (v) => Math.round(v * 100) / 100;

export const DEFAULT_PRICING = {
  inPerM: 0,          // US$ por 1 milhão de tokens de ENTRADA (preço atual do modelo usado)
  outPerM: 0,         // US$ por 1 milhão de tokens de SAÍDA
  usdBrl: 0,          // cotação do dólar em reais
  fixedBrl: 0,        // custo fixo mensal total (servidor, domínio, ferramentas) em R$
  clients: 1,         // em quantas empresas esse custo fixo é rateado
  supportHours: 0,    // horas de suporte por mês para esta empresa
  hourBrl: 0,         // valor da hora de suporte
  markupPct: 200,     // quanto somar ao custo (200% = preço 3x o custo)
  setupBrl: 0,        // taxa de implantação (única)
  estInTokens: 17000, // estimativa de entrada por resposta, usada só enquanto não há consumo medido
  estOutTokens: 400,  // estimativa de saída por resposta
};

export function cleanPricing(input = {}, base = DEFAULT_PRICING) {
  const out = { ...base };
  for (const [k, max] of [['inPerM', 1000], ['outPerM', 1000], ['usdBrl', 100], ['fixedBrl', 1e7], ['clients', 1000], ['supportHours', 1000], ['hourBrl', 1e5], ['markupPct', 2000], ['setupBrl', 1e7], ['estInTokens', 2e6], ['estOutTokens', 1e5]]) {
    if (input[k] !== undefined) out[k] = k === 'clients' ? Math.max(1, Math.floor(num(input[k], max))) : num(input[k], max);
  }
  return out;
}

export class Usage {
  constructor({ store }) {
    this.store = store;
    store.data.usage ||= { days: {} };
  }

  get days() {
    return this.store.data.usage.days;
  }

  #bucket(office, day = dayOf()) {
    const d = (this.days[day] ||= {});
    const o = (d[office || 'py'] ||= { atendimento: { calls: 0, inTok: 0, outTok: 0 }, outros: { calls: 0, inTok: 0, outTok: 0 }, replies: 0 });
    // Limpa dias muito antigos de vez em quando.
    const keys = Object.keys(this.days);
    if (keys.length > KEEP_DAYS) for (const k of keys.sort().slice(0, keys.length - KEEP_DAYS)) delete this.days[k];
    return o;
  }

  /** Chamada de IA concluída: soma os tokens (formato OpenAI: prompt_tokens / completion_tokens). */
  record({ usage, meta = {} }) {
    if (!usage) return;
    const inTok = num(usage.prompt_tokens ?? usage.input_tokens ?? 0);
    const outTok = num(usage.completion_tokens ?? usage.output_tokens ?? 0);
    const b = this.#bucket(meta.office);
    const k = meta.kind === 'atendimento' ? b.atendimento : b.outros;
    k.calls += 1; k.inTok += inTok; k.outTok += outTok;
    this.store.save();
  }

  /** A IA mandou uma resposta ao cliente (uma resposta pode usar várias chamadas, por causa das ferramentas). */
  reply(office) {
    this.#bucket(office).replies += 1;
    this.store.save();
  }

  /** Soma do mês (YYYY-MM), de um escritório ou dos dois. */
  month(month, office = '') {
    const t = { atendimento: { calls: 0, inTok: 0, outTok: 0 }, outros: { calls: 0, inTok: 0, outTok: 0 }, replies: 0 };
    for (const [day, offices] of Object.entries(this.days)) {
      if (!day.startsWith(month)) continue;
      for (const [id, b] of Object.entries(offices)) {
        if (office && id !== office) continue;
        for (const kind of ['atendimento', 'outros']) for (const f of ['calls', 'inTok', 'outTok']) t[kind][f] += b[kind][f];
        t.replies += b.replies;
      }
    }
    return t;
  }
}

/** Custo de uma resposta e tabela de planos sugeridos. */
export function priceModel(measured, cfg, { tiers = [500, 1500, 3000, 6000, 12000] } = {}) {
  const hasData = measured.replies >= 20 && measured.atendimento.calls > 0;
  const inPerReply = hasData ? (measured.atendimento.inTok + measured.outros.inTok) / measured.replies : cfg.estInTokens;
  const outPerReply = hasData ? (measured.atendimento.outTok + measured.outros.outTok) / measured.replies : cfg.estOutTokens;
  const usdPerReply = (inPerReply * cfg.inPerM + outPerReply * cfg.outPerM) / 1e6;
  const brlPerReply = usdPerReply * cfg.usdBrl;
  const configured = cfg.inPerM > 0 && cfg.outPerM > 0 && cfg.usdBrl > 0;
  const fixedShare = cfg.fixedBrl / Math.max(1, cfg.clients);
  const support = cfg.supportHours * cfg.hourBrl;
  const plans = tiers.map((n) => {
    const variable = n * brlPerReply;
    const cost = variable + fixedShare + support;
    const price = Math.ceil((cost * (1 + cfg.markupPct / 100)) / 10) * 10;
    return { replies: n, variable: round2(variable), fixed: round2(fixedShare), support: round2(support), cost: round2(cost), price, profit: round2(price - cost), marginPct: price ? Math.round(((price - cost) / price) * 100) : 0 };
  });
  const overagePer100 = Math.ceil(brlPerReply * 100 * (1 + cfg.markupPct / 100) * 100) / 100;
  return { configured, measuredData: hasData, inPerReply: Math.round(inPerReply), outPerReply: Math.round(outPerReply), usdPerReply: Number(usdPerReply.toFixed(5)), brlPerReply: Number(brlPerReply.toFixed(4)), plans, overagePer100: round2(overagePer100), setupBrl: cfg.setupBrl };
}

/**
 * Calibra o preço com o gasto REAL: conta as mensagens que a atendente enviou (guardadas nas conversas),
 * divide o gasto total pelos dias em que o sistema rodou e projeta 30 dias.
 * Limite: cada conversa guarda só as últimas 200 mensagens, então a contagem é um mínimo.
 */
export function historyReport(conversations, { totalCostBrl, from = '', to = '', include = () => true, markupPct = 200, extraMonthlyBrl = 0 } = {}) {
  const perDay = new Map();
  let inbound = 0;
  for (const c of conversations) {
    if (c.simulation || !include(c)) continue;
    for (const m of c.messages || []) {
      const day = dayOf(m.at);
      if ((from && day < from) || (to && day > to)) continue;
      if (m.role === 'assistant') perDay.set(day, (perDay.get(day) || 0) + 1);
      else if (m.role === 'user') inbound += 1;
    }
  }
  const days = [...perDay.keys()].sort();
  if (!days.length) return { messages: 0, inbound, empty: true };
  const start = from || days[0];
  const end = to || days.at(-1);
  const periodDays = Math.max(1, Math.round((new Date(`${end}T12:00:00Z`) - new Date(`${start}T12:00:00Z`)) / 86400000) + 1);
  const messages = [...perDay.values()].reduce((a, b) => a + b, 0);
  const cost = num(totalCostBrl, 1e8);
  const costPerMessage = cost && messages ? cost / messages : 0;
  const messagesPerDay = messages / periodDays;
  const monthlyMessages = messagesPerDay * 30;
  const monthlyCost = cost ? (cost / periodDays) * 30 : 0;
  const totalMonthlyCost = monthlyCost + num(extraMonthlyBrl, 1e8);
  const price = Math.ceil((totalMonthlyCost * (1 + num(markupPct, 2000) / 100)) / 10) * 10;
  return {
    messages, inbound, start, end, periodDays, activeDays: days.length,
    messagesPerDay: round2(messagesPerDay), monthlyMessages: Math.round(monthlyMessages),
    costPerMessage: Number(costPerMessage.toFixed(4)), costPer1000: round2(costPerMessage * 1000),
    totalCost: round2(cost), monthlyCost: round2(monthlyCost), extraMonthly: round2(num(extraMonthlyBrl, 1e8)), totalMonthlyCost: round2(totalMonthlyCost),
    markupPct: num(markupPct, 2000), price, profit: round2(price - totalMonthlyCost), marginPct: price ? Math.round(((price - totalMonthlyCost) / price) * 100) : 0,
    series: days.slice(-45).map((d) => ({ day: d, messages: perDay.get(d) })),
  };
}
