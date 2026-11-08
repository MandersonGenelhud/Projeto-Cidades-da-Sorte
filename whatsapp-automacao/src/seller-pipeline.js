// Pipeline por vendedor: para cada pessoa da equipe (Eliezer, Giovana, Diego, Fran, Marcos…), quem ela está atendendo, quem recebeu orçamento,
// quem preencheu a ficha, assinou o contrato, mandou comprovante, pagou, fechou ou não fechou. Também diz DE QUEM é cada cliente (sellerOf).
const OPEN = new Set(['novo', 'em_contato', 'proposta', 'aguardando']);

export const COLUMNS = [
  { id: 'atendendo', label: 'Atendendo' },
  { id: 'orcamento', label: 'Orçamento enviado' },
  { id: 'ficha', label: 'Ficha preenchida' },
  { id: 'contrato', label: 'Contrato assinado' },
  { id: 'comprovante', label: 'Comprovante enviado' },
  { id: 'fechou', label: 'Fechou (pagou)' },
  { id: 'nao_fechou', label: 'Não fechou' },
  { id: 'retornar', label: 'Retornar depois' },
];

/**
 * sellerOf({ lead, convKey, quote }) → { id, name } ou null (cliente ainda sem vendedor).
 * Ordem: dono do prospecto → dono do WhatsApp por onde a conversa chegou → para quem foi passado → quem fez o orçamento.
 */
export function makeSellerOf({ auth, lineOwnerOf = () => null }) {
  const who = (id) => { const u = id ? auth.get(id) : null; return u ? { id: u.id, name: u.name } : null; };
  return ({ lead = null, convKey = '', quote = null } = {}) => who(lead?.ownerId) || who(lineOwnerOf(convKey || lead?.conversationKey)?.ownerId) || who(lead?.handoff?.toId) || who(quote?.createdBy?.id) || null;
}

/** Em que etapa está este cliente (a mais avançada que ele alcançou). */
export function stageOf({ lead, quote, form, payments }) {
  const paid = payments.some((p) => p.status === 'paid' && !p.purpose) || lead?.stage === 'ganho';
  if (paid) return 'fechou';
  if (lead?.stage === 'perdido') return 'nao_fechou';
  if (payments.some((p) => p.status === 'pending' && !p.purpose && (p.receipt || p.claim))) return 'comprovante';
  if (quote?.contract?.status === 'assinado' || form?.term?.status === 'assinado') return 'contrato';
  if (form && ['preenchida', 'preenchido'].includes(form.status)) return 'ficha';
  if (quote) return 'orcamento';
  if (lead?.stage === 'aguardando' || lead?.followUpAt) return 'retornar';
  return 'atendendo';
}

export function buildSellerPipeline({ leads, quotes = [], payments = [], forms = [], users = [], sellerOf, viewer = null, days = 90, now = Date.now() }) {
  const since = now - days * 86_400_000;
  const bySeller = new Map();
  const bucket = (s) => {
    const id = s?.id || 'none';
    if (!bySeller.has(id)) bySeller.set(id, { id, name: s?.name || 'Sem vendedor (a IA ainda atende)', counts: Object.fromEntries(COLUMNS.map((c) => [c.id, 0])), total: 0, rows: [] });
    return bySeller.get(id);
  };
  for (const u of users) if (u.active !== false && u.role !== undefined && (u.receivesLeads || u.role !== 'admin' || /marcos/i.test(u.name))) bucket({ id: u.id, name: u.name });
  for (const lead of leads) {
    if ((Date.parse(lead.updatedAt || lead.createdAt) || 0) < since && OPEN.has(lead.stage) === false) continue;
    const myQuotes = quotes.filter((q) => (q.leadId && q.leadId === lead.id) || (q.convKey && q.convKey === lead.conversationKey));
    const quote = myQuotes.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
    const form = forms.find((f) => (f.leadId && f.leadId === lead.id) || (f.convKey && f.convKey === lead.conversationKey)) || null;
    const pays = payments.filter((p) => (p.leadId && p.leadId === lead.id) || (p.convKey && p.convKey === lead.conversationKey));
    const seller = sellerOf({ lead, convKey: lead.conversationKey, quote });
    if (viewer && viewer.role !== 'admin' && seller?.id !== viewer.id) continue;
    const col = stageOf({ lead, quote, form, payments: pays });
    const b = bucket(seller);
    b.counts[col] += 1; b.total += 1;
    b.rows.push({ id: lead.id, name: lead.name || lead.phone || `@${lead.instagram || ''}`, phone: lead.phone || '', stage: col, quote: quote?.number || '', value: quote?.plan?.total || lead.value || 0, interest: lead.interest || '', updatedAt: lead.updatedAt || lead.createdAt || '' });
  }
  const sellers = [...bySeller.values()].filter((b) => b.total > 0 || b.id !== 'none').map((b) => {
    b.rows.sort((x, y) => String(y.updatedAt).localeCompare(String(x.updatedAt)));
    const recebeu = b.counts.orcamento + b.counts.ficha + b.counts.contrato + b.counts.comprovante + b.counts.fechou + b.counts.nao_fechou;
    return { ...b, taxaFechamento: recebeu ? Math.round((b.counts.fechou / recebeu) * 1000) / 10 : 0 };
  }).sort((a, b) => b.counts.fechou - a.counts.fechou || b.total - a.total);
  return { columns: COLUMNS, days, sellers };
}
