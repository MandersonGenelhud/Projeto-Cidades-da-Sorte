// Painel de FECHAMENTOS: quem continuou a conversa DEPOIS de receber o orçamento (todo mundo recebe orçamento, então o orçamento sozinho não mede nada).
// O percentual de fechamento é calculado sobre quem continuou, não sobre quem recebeu o PDF. Mostra: o funil, a lista de acompanhamento
// (checklist), as objeções que mais aparecem e quanto cada uma fecha (radar), e quem não tinha condições (plano em PDF).
const DAY = 86_400_000;
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const OBJECTIONS = [
  { id: 'preco', label: 'Está caro / valor', re: /\b(caro|careca|muito alto|nao cabe|valor alto|desconto|mais barato|barato)\b/ },
  { id: 'pensar', label: 'Vou pensar / depois', re: /\b(vou pensar|deixa eu pensar|depois eu|mais pra frente|mais para frente|qualquer coisa eu (te )?chamo|vou ver)\b/ },
  { id: 'familia', label: 'Preciso falar com a família', re: /\b(minha esposa|meu marido|minha mulher|meu esposo|minha familia|conversar com (ela|ele)|falar com (ela|ele))\b/ },
  { id: 'confianca', label: 'Confiança / segurança', re: /\b(golpe|confiavel|confianca|seguro|garantia|e verdade|medo|desconfi)\b/ },
  { id: 'dinheiro', label: 'Sem dinheiro agora', re: /\b(sem dinheiro|nao tenho (o )?(valor|dinheiro)|nao tenho condicoes|apertad[oa]|so depois do salario|sem condicoes|nao posso pagar|nao consigo pagar)\b/ },
  { id: 'prazo', label: 'Prazo / quando começar', re: /\b(quanto tempo|demora|prazo|so daqui|daqui a (alguns )?(meses|mes))\b/ },
  { id: 'concorrente', label: 'Concorrente / outra opção', re: /\b(outra empresa|outro despachante|concorrente|em outro lugar|achei mais)\b/ },
];
export const classifyObjections = (text) => { const t = fold(text); return OBJECTIONS.filter((o) => o.re.test(t)).map((o) => o.id); };

const lastQuotePerConv = (quotes) => { const m = new Map(); for (const q of quotes) if (q.convKey && !String(q.convKey).startsWith('sim:') && (!m.has(q.convKey) || q.createdAt > m.get(q.convKey).createdAt)) m.set(q.convKey, q); return [...m.values()]; };

export function buildClosings({ store, quotes = [], payments = [], leadOf = () => null, now = Date.now(), days = 60 }) {
  const convs = store.data.conversations || {};
  const forms = store.data.closing || [];
  const paid = payments.filter((p) => p.status === 'paid');
  const rows = []; const radar = Object.fromEntries(OBJECTIONS.map((o) => [o.id, { id: o.id, label: o.label, total: 0, fechou: 0 }]));
  const f = { orcamentos: 0, continuaram: 0, comCondicoes: 0, ficha: 0, contrato: 0, pagos: 0, semCondicoes: 0, planoPdf: 0, recusaram: 0 };
  for (const q of lastQuotePerConv(quotes).filter((x) => now - Date.parse(x.createdAt) <= days * DAY)) {
    f.orcamentos += 1;
    const conv = convs[q.convKey];
    if (!conv) continue;
    const after = (conv.messages || []).filter((m) => (m.at || '') > q.createdAt);
    const userAfter = after.filter((m) => m.role === 'user');
    if (!userAfter.length) continue; // só recebeu o PDF e não respondeu: não entra no percentual
    f.continuaram += 1;
    const lead = leadOf(conv);
    const mine = (p) => p.convKey === q.convKey || (lead && p.leadId === lead.id);
    const cap = conv.qualificacao?.capacidade || 'desconhecida';
    const ficha = forms.some((x) => (x.convKey === q.convKey || x.quoteId === q.id) && x.status === 'preenchida');
    const contrato = q.contract?.status === 'assinado';
    const pago = paid.some((p) => !p.purpose && mine(p)) || lead?.stage === 'ganho';
    const plano = paid.some((p) => p.purpose === 'plano_pdf' && mine(p));
    const recusou = Boolean(conv.declined) || lead?.stage === 'perdido';
    if (['sim', 'parcial'].includes(cap)) f.comCondicoes += 1;
    if (ficha || contrato || pago) f.ficha += 1;
    if (contrato || pago) f.contrato += 1;
    if (pago) f.pagos += 1;
    if (cap === 'nao') f.semCondicoes += 1;
    if (plano) f.planoPdf += 1;
    if (recusou) f.recusaram += 1;
    const cats = new Set([...userAfter.flatMap((m) => classifyObjections(m.content)), ...classifyObjections(conv.qualificacao?.objecoes)]);
    for (const c of cats) { radar[c].total += 1; if (pago) radar[c].fechou += 1; }
    const etapa = pago ? 'fechou' : plano ? 'comprou o plano em PDF' : recusou ? 'recusou' : contrato ? 'contrato assinado (falta o Pix)' : ficha ? 'ficha preenchida (falta assinar)' : cap === 'sim' ? 'tem condições (falta a ficha)' : cap === 'parcial' ? 'tem em parte' : cap === 'nao' ? 'sem condições agora' : 'conversando (condições a descobrir)';
    const proximo = pago || plano || recusou ? '' : contrato ? 'Conferir o Pix da reserva' : ficha ? 'Lembrar de assinar o contrato' : cap === 'sim' ? 'Pedir o sim e enviar a ficha' : cap === 'parcial' ? 'Combinar a data da entrada ou o pacote menor' : cap === 'nao' ? 'Oferecer o plano em PDF ou combinar retorno' : 'Descobrir se tem condições de dar a entrada';
    const last = conv.messages.at(-1);
    rows.push({ key: q.convKey, nome: conv.name || q.client || '', phone: conv.phone || '', orcamento: q.number, valor: q.plan?.total || 0, etapa, capacidade: cap, objecoes: [...cats].map((c) => radar[c].label), proximo, aguardando: last?.role === 'user', ultimaAt: last?.at || '', aberto: !(pago || plano || recusou) });
  }
  const pct = (n) => (f.continuaram ? Math.round((n / f.continuaram) * 1000) / 10 : 0);
  const funil = [
    { id: 'continuaram', label: 'Continuaram depois do orçamento', n: f.continuaram, pct: 100 },
    { id: 'comCondicoes', label: 'Com condições de fechar (total ou em parte)', n: f.comCondicoes, pct: pct(f.comCondicoes) },
    { id: 'ficha', label: 'Preencheram a ficha (entraram no processo)', n: f.ficha, pct: pct(f.ficha) },
    { id: 'contrato', label: 'Assinaram o contrato', n: f.contrato, pct: pct(f.contrato) },
    { id: 'pagos', label: 'Pagaram a entrada (fechados)', n: f.pagos, pct: pct(f.pagos) },
  ];
  const sort = { 'tem condições (falta a ficha)': 0, 'ficha preenchida (falta assinar)': 1, 'contrato assinado (falta o Pix)': 2 };
  rows.sort((a, b) => (b.aberto - a.aberto) || ((sort[a.etapa] ?? 9) - (sort[b.etapa] ?? 9)) || String(b.ultimaAt).localeCompare(String(a.ultimaAt)));
  return { days, orcamentos: f.orcamentos, semResposta: f.orcamentos - f.continuaram, ...f, funil, taxaFechamento: pct(f.pagos), checklist: rows, radar: Object.values(radar).filter((r) => r.total).map((r) => ({ ...r, taxa: Math.round((r.fechou / r.total) * 1000) / 10 })).sort((a, b) => b.total - a.total) };
}
