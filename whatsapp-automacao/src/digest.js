// Reenvio dos encaminhamentos: cada cliente que a IA passou para um humano vira uma
// mensagem de resumo no WhatsApp de quem vai atender (o vendedor dono do cliente ou o
// próprio Marcos), com o que já foi conversado e uma sugestão de como puxar a conversa.
import { chatPreview } from './routing.js';

const FORWARD_RE = /(encaminh|transferi|enviando seu contato|passar (seu|o seu) contato|atendente dentro do escrit|consultor\w* (vai|continua|j[aá] recebeu)|marcos (vai|j[aá]|te chama|entra)|vai finalizar com voc)/i;
const OWNER_REPLIED = 'Você respondeu pelo celular';
const OPEN = new Set(['novo', 'em_contato', 'proposta', 'aguardando']);
const first = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const money = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const clip = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/**
 * Quem a IA passou para um humano. maxDays: só conversas mexidas nesse período.
 * Devolve [{ key, phone, name, lead, to: { kind: 'vendedor' | 'marcos', user }, promised }].
 */
export function collectHandoffs({ store, crm, auth, maxDays = 30, includeSent = false, now = Date.now() }) {
  const since = now - maxDays * 86_400_000;
  const out = [];
  for (const conv of Object.values(store.data.conversations || {})) {
    if (conv.simulation || String(conv.key).startsWith('sim:')) continue;
    if (Date.parse(conv.updatedAt || 0) < since) continue;
    if (conv.digestSentAt && !includeSent) continue;
    if (conv.triage && conv.triage.responder === false) continue; // conversa pessoal ou do próprio Marcos
    const lead = crm.findForConversation({ key: conv.key, phone: conv.phone, username: conv.username });
    if (lead && !OPEN.has(lead.stage)) continue; // já fechou ou foi perdido
    const promisedMsg = [...(conv.messages || [])].reverse().find((m) => m.role === 'assistant' && FORWARD_RE.test(String(m.content || '')));
    const paused = conv.handoff && conv.handoffReason !== OWNER_REPLIED;
    const routed = Boolean(lead?.handoff || lead?.closingBrief || lead?.routedAt || conv.routedTo);
    if (!promisedMsg && !paused && !routed) continue;
    // Para quem: o vendedor responsável (com WhatsApp); se a IA prometeu o Marcos ou não há vendedor, o Marcos.
    const promised = String(promisedMsg?.content || '');
    const ownerId = lead?.ownerId || conv.routedTo || null;
    const owner = ownerId ? auth.get(ownerId) : null;
    const seller = owner && owner.role !== 'admin' && owner.active !== false && owner.whatsapp ? owner : null;
    const toMarcos = !seller || (/marcos/i.test(promised) && !new RegExp(first(seller.name), 'i').test(promised));
    out.push({
      key: conv.key,
      phone: conv.phone || lead?.phone || '',
      name: lead?.name || conv.name || '',
      lead,
      conv,
      reason: conv.handoffReason || lead?.handoff?.reason || '',
      promised,
      to: toMarcos ? { kind: 'marcos', user: null } : { kind: 'vendedor', user: seller },
    });
  }
  return out.sort((a, b) => String(b.conv.updatedAt).localeCompare(String(a.conv.updatedAt)));
}

/** Texto do resumo para quem vai chamar o cliente. */
export function digestMessage(item, { index = 1, total = 1, senderName = 'Marcos', quote = null } = {}) {
  const { lead, conv } = item;
  const brief = lead?.closingBrief || {};
  const q = lead?.qualification || {};
  const who = item.name || (item.phone ? `+${item.phone}` : 'Cliente');
  const interest = lead?.interest || brief.pacote || '';
  const people = lead?.people > 1 ? ` · ${lead.people} pessoas` : '';
  const doubt = brief.objecao || q.objections || '';
  const lastClient = [...(conv.messages || [])].reverse().find((m) => m.role === 'user')?.content || '';
  const opener = `Oi${first(item.name) ? `, ${first(item.name)}` : ''}! Aqui é ${first(senderName) || 'da equipe'}, da Migra Paraguai. Nossa atendente me passou o seu atendimento${interest ? ` sobre o ${interest}` : ''}${doubt ? `, e vi que ficou uma dúvida sobre ${clip(doubt, 80)}` : ''}. Posso te ajudar a finalizar agora?`;
  return [
    `📌 *Cliente para você chamar* (${index}/${total})`,
    `👤 ${who}${item.phone ? ` · +${item.phone}` : ''}${lead?.code ? ` · ${lead.code}` : ''}`,
    item.phone ? `💬 Abrir a conversa: https://wa.me/${item.phone}` : '💬 Cliente do Instagram: responda pelo painel (Conversas)',
    interest ? `📦 ${interest}${people}${quote ? ` · orçamento ${quote.number} (${money(quote.plan.total)}, entrada ${money(quote.plan.entry)})` : ''}` : '',
    lead?.aiSummary || brief.resumo ? `📝 *Sobre o cliente:* ${clip(brief.resumo || lead.aiSummary, 400)}` : '',
    brief.interesse ? `🎯 *Interesse real:* ${clip(brief.interesse, 200)}` : '',
    doubt ? `🚧 *Dúvida ou receio:* ${clip(doubt, 200)}` : '',
    item.promised ? `🤝 *O que a IA disse a ele:* "${clip(item.promised, 260)}"` : item.reason ? `🤝 *Motivo do encaminhamento:* ${clip(item.reason, 200)}` : '',
    lastClient ? `🗨️ *Última mensagem dele:* "${clip(lastClient, 220)}"` : '',
    brief.dica ? `🧠 *Técnica de fechamento:* ${clip(brief.dica, 200)}` : '',
    `\n💬 *Resumo da conversa:*\n${chatPreview(conv, 6) || '—'}`,
    `\n✍️ *Como começar (copie e mande):*\n${opener}`,
  ].filter(Boolean).join('\n');
}
