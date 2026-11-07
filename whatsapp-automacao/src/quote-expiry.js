// Aviso de orçamento que vai vencer: quem recebeu a proposta e ainda não fechou é lembrado, com o prazo REAL do orçamento,
// pela própria conversa (o mesmo número por onde já falaram). A IA escreve a mensagem, sem inventar desconto nem prazo novo.
// Cada orçamento é avisado UMA vez só (expiryNoticeAt). Não avisa quem já fechou, quem foi dado como perdido, quem está na lista de bloqueio
// nem conversa que uma pessoa assumiu. Quem não tem conversa guardada não recebe mensagem "do nada": aparece no relatório para o vendedor chamar.
import { OWNER_PAUSE } from './agent/agent.js';

const DAY = 86_400_000;
const CLOSED = new Set(['ganho', 'perdido']);
const digits = (s) => String(s || '').replace(/\D/g, '');
const brDate = (iso) => String(iso || '').split('-').reverse().join('/');
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Orçamentos que vencem hoje ou amanhã, sem contrato e sem venda (mesma regra do aviso do sino). */
export function expiringQuotes({ quotes, sales = [], now = Date.now(), daysAhead = 1 }) {
  const today = isoDay(now);
  const limit = isoDay(now + daysAhead * DAY);
  return quotes.filter((q) => !q.contract && q.validUntil >= today && q.validUntil <= limit && !sales.some((s) => s.quoteId === q.id));
}

/** Instrução dada à IA para escrever o aviso. */
export const quoteNote = (p) => {
  const q = p.quote || {};
  const quando = q.daysLeft <= 0 ? 'HOJE' : q.daysLeft === 1 ? 'AMANHÃ' : `em ${q.daysLeft} dias`;
  return `# AVISO DE ORÇAMENTO A VENCER (regra da direção)
O orçamento ${q.number || ''} enviado a este cliente vale até ${brDate(q.validUntil)}, ou seja, vence ${quando}. Depois do prazo ele é desativado e os valores e condições precisam ser conferidos de novo. Esse prazo é REAL e é o único gatilho permitido.
Escreva UMA mensagem curta, calorosa e humana: cumprimente pelo horário, avise que o orçamento vence ${quando} (${brDate(q.validUntil)}), pergunte se ficou alguma dúvida e convide a dar continuidade e reservar o atendimento. Leia as últimas mensagens para retomar de onde pararam e responda o que ele deixou pendente.
PROIBIDO: inventar desconto, bônus, vaga limitada, prazo novo ou qualquer promessa; pressionar; pedir desculpas. Se ele disser que não quer mais, agradeça com educação e não insista. Se pedir mais prazo ou desconto, diga que vai verificar com a equipe e use passar_fechamento_para_humano.`;
};

/**
 * Põe os avisos na fila da IA. dryRun só conta. Devolve os números e a lista de quem ficou de fora com o motivo.
 * pending = PendingInbox; agent = Agent; leadOf(conv|quote) => lead do CRM.
 */
export function noticeExpiringQuotes({ store, agent, pending, quotes, sales = [], leadOf = () => null, isBlocked = () => false, now = Date.now(), daysAhead = 1, dryRun = false, resumeOwnerPauseHours = 2 }) {
  const found = expiringQuotes({ quotes, sales, now, daysAhead });
  const out = { total: found.length, queued: 0, jaAvisados: 0, semConversa: 0, bloqueados: 0, comAtendente: 0, fechados: 0, jaNaFila: 0, skipped: [] };
  const convs = Object.values(store.data.conversations || {});
  const keys = [];
  for (const q of found) {
    const skip = (why, counter) => { out[counter] += 1; out.skipped.push({ client: q.client, number: q.number, validUntil: q.validUntil, motivo: why }); };
    if (q.expiryNoticeAt) { out.jaAvisados += 1; continue; }
    const ph = digits(q.phone);
    const conv = (q.convKey && agent.conversation(q.convKey, { create: false })) || (ph ? convs.find((c) => c && !c.simulation && !String(c.key).includes('@g.us') && digits(c.phone) === ph) : null);
    if (!conv) { skip(ph ? 'sem conversa guardada com esse telefone: o vendedor precisa chamar' : 'orçamento sem telefone', 'semConversa'); continue; }
    if (conv.phone && isBlocked(conv.phone)) { skip('contato na lista de bloqueio', 'bloqueados'); continue; }
    const lead = leadOf(conv) || leadOf({ key: conv.key, phone: q.phone });
    if (lead && CLOSED.has(lead.stage)) { skip('cliente já fechou ou foi dado como perdido', 'fechados'); continue; }
    if (conv.handoff && !(conv.handoffReason === OWNER_PAUSE && now - (conv.ownerRepliedAt || 0) >= resumeOwnerPauseHours * 3_600_000)) { skip('uma pessoa está atendendo esta conversa', 'comAtendente'); continue; }
    if (pending.queue.includes(conv.key)) { skip('já está na fila de respostas', 'jaNaFila'); continue; }
    if (dryRun) { out.queued += 1; continue; }
    if (conv.handoff) { conv.handoff = false; conv.handoffReason = ''; }
    const existing = pending.items[conv.key];
    pending.items[conv.key] = {
      ...(existing || {}),
      jid: conv.key, channel: String(conv.key).startsWith('ig:') ? 'instagram' : 'whatsapp', username: conv.username || existing?.username || '', phone: conv.phone || q.phone || existing?.phone || null,
      name: conv.name || existing?.name || q.client, texts: [], at: now, source: 'orçamento a vencer', restart: true, noOpening: true, kind: 'orcamento',
      quote: { id: q.id, number: q.number, validUntil: q.validUntil, daysLeft: Math.max(0, Math.round((Date.parse(`${q.validUntil}T12:00:00Z`) - Date.parse(`${isoDay(now)}T12:00:00Z`)) / DAY)) },
    };
    keys.push({ key: conv.key, q, hadItem: Boolean(existing) });
  }
  if (!dryRun && keys.length) {
    store.save();
    try { pending.enqueue(keys.map((k) => k.key)); } catch { /* o que não entrou é desfeito abaixo */ }
    for (const k of keys) {
      if (pending.queue.includes(k.key)) { k.q.expiryNoticeAt = new Date(now).toISOString(); out.queued += 1; }
      else {
        if (!k.hadItem) delete pending.items[k.key];
        out.skipped.push({ client: k.q.client, number: k.q.number, validUntil: k.q.validUntil, motivo: 'número desconectado, modo de teste ou fora das regras de envio' });
        out.bloqueados += 1;
      }
    }
    store.save();
  }
  return out;
}
