// Retornos ATRASADOS que na verdade já foram feitos: se depois da data do retorno a equipe ou a IA já falaram com o cliente,
// o prospecto sai de "Atrasados" e vai para o quadro "Já contatados: aguardando decisão" (respondeu ou não respondeu), para a equipe
// saber se ele vai continuar ou não. Nada é enviado ao cliente; só reorganiza o CRM e deixa tudo anotado na linha do tempo.
const OPEN = new Set(['novo', 'em_contato', 'proposta', 'aguardando']);
const last9 = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 8 ? d.slice(-9) : ''; };
const brDate = (iso) => String(iso || '').slice(0, 10).split('-').reverse().join('/');

/** A conversa do prospecto: pela chave guardada ou pelo telefone. */
function convFinder(conversations) {
  const all = Object.values(conversations || {}).filter((c) => c?.key && !c.simulation && !String(c.key).includes('@g.us'));
  const byPhone = new Map();
  for (const c of all) { const k = last9(c.phone); if (k) { const arr = byPhone.get(k) || []; arr.push(c); byPhone.set(k, arr); } }
  return (lead) => {
    const direct = [lead.conversationKey, lead.whatsappKey].map((k) => (k ? conversations[k] : null)).filter(Boolean);
    const phone = byPhone.get(last9(lead.phone)) || [];
    return [...new Set([...direct, ...phone])];
  };
}

/**
 * Confere os retornos atrasados. dryRun só conta. Devolve { overdue, resolved, replied, silent }.
 * Resolve quem tem mensagem NOSSA depois da data do retorno (IA, Marcos ou equipe).
 */
export function reconcileOverdue({ crm, store, now = Date.now(), dryRun = false }) {
  const today = new Date(now).toISOString().slice(0, 10);
  const find = convFinder(store.data.conversations);
  const out = { overdue: 0, resolved: 0, replied: 0, silent: 0, dryRun };
  for (const lead of crm.leads) {
    if (!lead.followUpAt || lead.followUpAt >= today || !OPEN.has(lead.stage)) continue;
    out.overdue += 1;
    const since = `${lead.followUpAt}T00:00:00`;
    let lastOurs = null; let lastUser = null;
    for (const conv of find(lead)) {
      for (const m of conv.messages || []) {
        if ((m.at || '') < since) continue;
        if (m.role === 'assistant') { if (!lastOurs || m.at > lastOurs.at) lastOurs = m; } else if (m.role === 'user') { if (!lastUser || m.at > lastUser.at) lastUser = m; }
      }
    }
    if (!lastOurs) continue; // ninguém falou com ele depois do retorno: continua atrasado, de verdade
    const replied = Boolean(lastUser && lastUser.at > lastOurs.at) || Boolean(lastUser);
    out.resolved += 1; if (replied) out.replied += 1; else out.silent += 1;
    if (dryRun) continue;
    crm.markContacted(lead, { at: lastOurs.at, replied, lastUserAt: lastUser?.at || null, snippet: String(lastOurs.content || '').replace(/\s+/g, ' ').slice(0, 140), prevDate: lead.followUpAt, now });
  }
  if (!dryRun && out.resolved) store.save();
  return out;
}
export { brDate };
