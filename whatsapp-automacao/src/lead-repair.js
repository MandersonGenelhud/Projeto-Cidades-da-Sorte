// Conversas que a atendente respondeu mas não viraram prospecto no CRM (nada gravado para o vendedor ver): cria o prospecto que faltou.
// Só conversas reais e recentes em que a IA realmente atendeu; ignora grupos, simulações, lista de bloqueio, conversa pessoal do Marcos e conversas
// que uma pessoa assumiu de propósito. Nunca apaga nada.
import { senderOf } from './send-profiles.js';

const DAY = 86_400_000;

export function repairMissingLeads({ store, crm, now = Date.now(), days = 3, dryRun = false, limit = 200, isBlocked = () => false }) {
  const out = { checked: 0, missing: 0, created: 0, linked: 0, skipped: 0 };
  if (crm.config?.autoCreate === false) return { ...out, off: true };
  for (const conv of Object.values(store.data.conversations || {})) {
    if (!conv?.key || conv.simulation || String(conv.key).startsWith('sim:') || String(conv.key).includes('@g.us')) continue;
    const msgs = conv.messages || [];
    const last = msgs.at(-1);
    if (!last || now - (Date.parse(conv.updatedAt || last.at) || 0) > days * DAY) continue;
    if (!msgs.some((m) => m.role === 'user') || !msgs.some((m) => m.role === 'assistant')) continue;
    out.checked += 1;
    if (crm.findForConversation({ key: conv.key, phone: conv.phone, username: conv.username })) {
      // Já tem prospecto: só garante que ele aponta para esta conversa (é por aí que a ficha mostra o histórico).
      const l = crm.findForConversation({ key: conv.key, phone: conv.phone, username: conv.username });
      if (!l.conversationKey) { l.conversationKey = conv.key; out.linked += 1; }
      continue;
    }
    if (conv.phone && isBlocked(conv.phone)) { out.skipped += 1; continue; }
    if (conv.handoff && /^Conversa do Marcos|pessoal/i.test(conv.handoffReason || '')) { out.skipped += 1; continue; }
    out.missing += 1;
    if (dryRun || out.created >= limit) continue;
    const lead = crm.ensureFromConversation({ key: conv.key, phone: conv.phone, name: conv.name, username: conv.username, channel: String(conv.key).startsWith('ig:') ? 'instagram' : 'whatsapp' });
    if (lead) out.created += 1;
  }
  if (!dryRun && (out.created || out.linked)) store.flush();
  return out;
}

/** Diagnóstico simples: quantos prospectos e conversas existem e quantos não se encontram. Serve para achar falha de gravação. */
export function dataHealth({ store, crm, instance }) {
  const convs = Object.values(store.data.conversations || {}).filter((c) => c && !c.simulation && !String(c.key).startsWith('sim:') && !String(c.key).includes('@g.us'));
  const withoutLead = convs.filter((c) => (c.messages || []).some((m) => m.role === 'assistant') && !crm.findForConversation({ key: c.key, phone: c.phone, username: c.username })).length;
  const leadsWithoutConv = crm.leads.filter((l) => l.conversationKey && !store.data.conversations?.[l.conversationKey]).length;
  const newest = crm.leads.reduce((m, l) => (String(l.createdAt || '') > m ? String(l.createdAt) : m), '');
  // Por número (principal, cada vendedor, Instagram): quantas conversas e a hora da mensagem mais nova do cliente. Um número conectado sem mensagem nova há dias merece olhar.
  const byNumber = {};
  for (const c of convs) {
    const k = senderOf(c.key);
    const lastClient = [...(c.messages || [])].reverse().find((m) => m.role === 'user')?.at || '';
    const e = (byNumber[k] ||= { conversations: 0, last24h: 0, newestClientMessageAt: '' });
    e.conversations += 1;
    if (lastClient && Date.now() - Date.parse(lastClient) < DAY) e.last24h += 1;
    if (lastClient > e.newestClientMessageAt) e.newestClientMessageAt = lastClient;
  }
  return {
    byNumber, instance, leads: crm.leads.length, conversations: convs.length, conversationsAnsweredWithoutLead: withoutLead, leadsPointingToMissingConversation: leadsWithoutConv,
    newestLeadAt: newest, deletedLeadsRemembered: (store.data.leadTombstones || []).length,
  };
}
