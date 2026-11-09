// Relatório de uma campanha: quantas pessoas vieram (por variante A, B… e "sem código"), quantas receberam orçamento, preencheram a ficha, assinaram,
// pagaram a entrada (fecharam) e quantas garantiram o brinde. Mostra a taxa de cada variante para decidir continuar, pausar ou testar outra.
import { stageOf } from './seller-pipeline.js';

const ORDER = ['atendendo', 'retornar', 'nao_fechou', 'orcamento', 'ficha', 'contrato', 'comprovante', 'fechou'];
const reached = (stage, target) => stage !== 'nao_fechou' && ORDER.indexOf(stage) >= ORDER.indexOf(target) && stage !== 'retornar';
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);

export function campaignReport({ camp, hits, leadOf = () => null, quotes = [], forms = [], payments = [], claims = [], sellerOf = () => null, now = Date.now() }) {
  const mine = hits.filter((h) => h.campaignId === camp.id);
  const rows = mine.map((h) => {
    const lead = leadOf(h);
    const q = quotes.filter((x) => (x.convKey && x.convKey === h.convKey) || (lead && x.leadId === lead.id)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
    const form = forms.find((f) => (f.convKey && f.convKey === h.convKey) || (lead && f.leadId === lead.id)) || null;
    const pays = payments.filter((p) => (p.convKey && p.convKey === h.convKey) || (lead && p.leadId === lead.id));
    const stage = stageOf({ lead, quote: q, form, payments: pays });
    const claim = claims.find((c) => c.convKey === h.convKey && ['reservada', 'confirmada'].includes(c.status)) || null;
    const seller = sellerOf({ lead, convKey: h.convKey, quote: q });
    return { id: h.id, name: h.name || lead?.name || '', phone: h.phone || lead?.phone || '', variant: h.variant || '', via: h.via, at: h.at, stage, quote: q?.number || '', brinde: claim ? (claim.status === 'confirmada' ? 'confirmado' : 'reservado') : '', seller: seller?.name || '', first: h.first };
  });
  const group = (list) => ({
    vieram: list.filter((r) => r.via !== 'ia').length,
    apresentadas: list.filter((r) => r.via === 'ia').length,
    orcamento: list.filter((r) => reached(r.stage, 'orcamento')).length,
    ficha: list.filter((r) => reached(r.stage, 'ficha')).length,
    contrato: list.filter((r) => reached(r.stage, 'contrato')).length,
    fecharam: list.filter((r) => r.stage === 'fechou').length,
    brinde: list.filter((r) => r.brinde).length,
    brindeConfirmado: list.filter((r) => r.brinde === 'confirmado').length,
  });
  const withRates = (g) => ({ ...g, taxaOrcamento: pct(g.orcamento, g.vieram + g.apresentadas), taxaFechamento: pct(g.fecharam, g.vieram + g.apresentadas) });
  const variants = [...new Set([...(camp.variants || []), ...rows.map((r) => r.variant)])].filter((v) => v !== '');
  const byVariant = [...variants.map((v) => ({ variant: v, ...withRates(group(rows.filter((r) => r.variant === v))) })), { variant: '', label: 'Sem código (palavras da oferta ou link antigo)', ...withRates(group(rows.filter((r) => !r.variant))) }];
  const days = {};
  for (const r of rows) { const d = r.at.slice(0, 10); days[d] = (days[d] || 0) + 1; }
  const best = byVariant.filter((v) => v.variant && v.vieram >= 5).sort((a, b) => b.taxaFechamento - a.taxaFechamento || b.vieram - a.vieram)[0] || null;
  return {
    campaign: { id: camp.id, name: camp.name, code: camp.code, status: camp.status, variants: camp.variants, startsAt: camp.startsAt, endsAt: camp.endsAt, log: camp.log || [] },
    total: withRates(group(rows)), byVariant, perDay: Object.entries(days).sort(([a], [b]) => a.localeCompare(b)).map(([day, n]) => ({ day, n })),
    nota: best ? `Até agora a variante ${best.variant} é a que mais fecha (${best.taxaFechamento}% de quem veio). Poucos dados ainda podem enganar: confirme com mais pessoas antes de decidir.` : 'Ainda há poucas pessoas por variante (menos de 5) para comparar com segurança.',
    rows: rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 300),
  };
}
