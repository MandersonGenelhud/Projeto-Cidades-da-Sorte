// Plano de atendimento: separa TODAS as conversas dos últimos dias em grupos claros, para o administrador saber o que o botão "Começar" vai fazer.
//  fechados   → já são clientes (contrato, venda, Pix pago, cliente ganho, ou a conversa mostra pagamento/contrato). Nunca recebem chamada nossa.
//  recusaram  → disseram que fecharam com outro, não têm interesse ou pediram para não ser chamados. Nunca recebem chamada nossa.
//  marcos     → conversa pessoal ou de outro assunto (marcada "Conversa do Marcos"); a IA só confere se há interesse nos serviços da Migra.
//  comHumano  → uma pessoa da equipe assumiu de propósito. Não mexe.
//  retomar    → ficaram sem continuidade: o cliente esperando resposta, que sumiu ou com retorno combinado. São os que o botão chama.
//  emDia      → já foram respondidos recentemente; nada a fazer agora.
import { collectStalled } from './restart.js';
import { detectClosedByMessages } from './closed-signals.js';
import { OWNER_PAUSE } from './agent/agent.js';

const DAY = 86_400_000;

export function buildPlan({ store, leadOf = () => null, closedFor = () => '', isBlocked = () => false, now = Date.now(), days = 30, includeSilent = true }) {
  const convs = Object.values(store.data.conversations || {}).filter((c) => c?.key && !c.simulation && !String(c.key).startsWith('sim:') && !String(c.key).includes('@g.us'));
  const recentConvs = convs.filter((c) => c.messages?.length && now - (Date.parse(c.messages.at(-1).at) || 0) <= days * DAY);
  const stalled = new Set(collectStalled({ conversations: recentConvs, now, days, includeSilent, leadOf, isBlocked }).map((x) => x.key));
  const out = { days, total: recentConvs.length, fechados: 0, recusaram: 0, marcos: 0, comHumano: 0, retomar: 0, emDia: 0, bloqueados: 0, retomarPorCondicao: { sim: 0, parcial: 0, nao: 0, desconhecida: 0 }, porMotivoFechado: {} };
  for (const c of recentConvs) {
    const lead = leadOf(c);
    const why = (lead?.stage === 'ganho' && 'cliente fechado no CRM') || closedFor({ phone: c.phone, key: c.key }) || (c.declined?.kind === 'fechou_conosco' && 'disse que já fechou conosco') || detectClosedByMessages(c);
    if (why) { out.fechados += 1; out.porMotivoFechado[why] = (out.porMotivoFechado[why] || 0) + 1; continue; }
    if (c.declined || lead?.stage === 'perdido') { out.recusaram += 1; continue; }
    if (c.phone && isBlocked(c.phone)) { out.bloqueados += 1; continue; }
    if (c.handoff && c.handoffReason !== OWNER_PAUSE) { if (/^Conversa do Marcos/.test(c.handoffReason || '')) out.marcos += 1; else out.comHumano += 1; continue; }
    if (stalled.has(c.key)) { out.retomar += 1; out.retomarPorCondicao[c.qualificacao?.capacidade || 'desconhecida'] += 1; } else out.emDia += 1;
  }
  return out;
}
