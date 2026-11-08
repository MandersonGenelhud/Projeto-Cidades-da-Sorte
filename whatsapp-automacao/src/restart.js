// Recomeçar os atendimentos parados: varre as conversas guardadas dos últimos 30 dias (de todos os números e do Instagram) e põe na fila da IA
// quem ficou sem continuidade: (1) o cliente falou e ninguém respondeu, (2) o cliente parou de responder depois da última mensagem,
// (3) o retorno combinado chegou, (4) a conversa ficou pausada por "o dono respondeu pelo celular" ou marcada como "do Marcos".
// A IA lê as últimas 20 mensagens, só segue se o assunto for de algum serviço da Migra e retoma de onde parou, no ritmo seguro de cada número.
import { OWNER_PAUSE } from './agent/agent.js';
import { detectClosedByMessages } from './closed-signals.js';
import { qualRank } from './qualificacao.js';
import { answeredOurOutreach } from './outreach-apology.js';

const DAY = 86_400_000;
/** O dono ou a equipe já falaram de verdade nesta conversa (pelo celular). */
export const humanReplied = (conv) => Boolean(conv?.ownerRepliedAt) || (conv?.messages || []).some((m) => m.by === 'owner');
const CLOSED = new Set(['ganho', 'perdido']);

/** Já procuramos esta pessoa (retorno, chamada ou aviso) e ela não respondeu: não repete; quem cuida é o aviso de encerramento. */
const weReachedOutNoReply = (conv) => { const last = (conv?.messages || []).at(-1); return last?.role === 'assistant' && answeredOurOutreach(conv, { days: 30 }); };

/** Classifica cada conversa. Não altera nada. */
export function collectStalled({ conversations, now = Date.now(), days = 30, minSilentHours = 24, resumeOwnerPauseHours = 2, includeSilent = true, includeMarcos = false, skipHumanReplied = true, onlyKeys = null, leadOf = () => null, isBlocked = () => false, today = new Date(now).toISOString().slice(0, 10) }) {
  const out = [];
  for (const conv of conversations) {
    if (!conv || conv.simulation || !conv.key || String(conv.key).includes('@g.us')) continue;
    if (onlyKeys && !onlyKeys.includes(conv.key)) continue;
    const msgs = conv.messages || [];
    const last = msgs.at(-1);
    if (!last) continue;
    const lastAt = Date.parse(last.at) || 0;
    if (now - lastAt > days * DAY) continue;
    if (conv.phone && isBlocked(conv.phone)) continue;
    const lead = leadOf(conv);
    if (lead && CLOSED.has(lead.stage)) continue; // já fechou ou já foi dado como perdido: não incomoda
    if (conv.declined || detectClosedByMessages(conv)) continue; // recusou, ou a conversa mostra pagamento/contrato: conflito de interesse
    if (skipHumanReplied && humanReplied(conv)) continue; // o Marcos ou a equipe já responderam nesta conversa: não é cliente "não atendido" (regra da direção)
    const item = { key: conv.key, conv, lead, lastAt, handoff: '', kind: '', reason: '' };
    if (conv.handoff) {
      const why = conv.handoffReason || '';
      if (why === OWNER_PAUSE) {
        if (now - (conv.ownerRepliedAt || 0) < resumeOwnerPauseHours * 3_600_000) continue; // o dono acabou de falar: deixa com ele
        item.handoff = 'dono';
      } else if (/^Conversa do Marcos/.test(why)) { if (!includeMarcos) continue; item.handoff = 'marcos'; }
      else continue; // uma pessoa assumiu de propósito (painel, transferência): não mexe
    }
    const due = lead?.followUpAt && lead.followUpAt <= today && ['novo', 'em_contato', 'proposta', 'aguardando'].includes(lead.stage);
    if (last.role === 'user') item.kind = 'esperando';
    else if (includeSilent && !weReachedOutNoReply(conv) && msgs.some((m) => m.role === 'user') && !String(conv.key).startsWith('ig:') && (due || now - lastAt >= minSilentHours * 3_600_000)) {
      item.kind = due ? 'reagendado' : 'silenciou';
      item.reason = due ? String(lead.followUpReason || '').slice(0, 200) : '';
    } else continue;
    out.push(item);
  }
  return out;
}

/**
 * Põe as conversas paradas na fila da IA. pending = PendingInbox. Devolve os números por tipo e quantas entraram na fila.
 * dryRun só conta. Quem recebe a mensagem é a própria conversa (o mesmo número por onde o cliente falou): o limite por hora vale por número.
 */
export function restartStalled({ store, agent, pending, leadOf, isBlocked, now = Date.now(), days = 30, includeSilent = true, includeMarcos = false, skipHumanReplied = true, onlyKeys = null, minSilentHours = 24, resumeOwnerPauseHours = 2, dryRun = false, limit = 2000 }) {
  const conversations = Object.values(store.data.conversations || {});
  // Quem está mais perto de fechar (tem condições) é chamado primeiro; quem não tem condições agora, por último.
  const found = collectStalled({ conversations, now, days, includeSilent, includeMarcos, skipHumanReplied, onlyKeys, minSilentHours, resumeOwnerPauseHours, leadOf, isBlocked }).sort((a, b) => qualRank(a.conv) - qualRank(b.conv)).slice(0, limit);
  const counts = { esperando: 0, silenciou: 0, reagendado: 0, pausadasDono: 0, pausadasMarcos: 0 };
  const keys = [];
  for (const it of found) {
    counts[it.kind] += 1;
    if (it.handoff === 'dono') counts.pausadasDono += 1;
    if (it.handoff === 'marcos') counts.pausadasMarcos += 1;
    if (dryRun) continue;
    const c = it.conv;
    if (it.handoff === 'dono') { c.handoff = false; c.handoffReason = ''; }
    if (pending.queue.includes(it.key)) continue;
    const existing = pending.items[it.key];
    const trailing = [];
    if (it.kind === 'esperando') for (let i = c.messages.length - 1; i >= 0 && c.messages[i].role === 'user'; i--) trailing.unshift(String(c.messages[i].content || ''));
    pending.items[it.key] = {
      ...(existing || {}),
      jid: it.key, channel: String(it.key).startsWith('ig:') ? 'instagram' : 'whatsapp', username: c.username || existing?.username || '', phone: c.phone || existing?.phone || null, name: c.name || existing?.name || '',
      texts: it.kind === 'esperando' ? trailing.slice(-5) : [], at: it.lastAt, source: 'recomeçar', restart: true, reTriage: it.handoff === 'marcos',
      kind: it.kind === 'esperando' ? existing?.kind : 'retomar', reason: it.reason, scheduledFor: it.lead?.followUpAt && it.lead.followUpAt <= new Date(now).toISOString().slice(0, 10) ? it.lead.followUpAt : '', silentDays: Math.max(1, Math.round((now - it.lastAt) / DAY)),
    };
    keys.push(it.key);
  }
  let queued = { queued: 0, blocked: 0, reasons: {} };
  if (!dryRun && keys.length) {
    store.save();
    try { queued = pending.enqueue(keys); } catch (e) { queued = { queued: 0, blocked: keys.length, reasons: {}, error: e.message }; }
  }
  return { total: found.length, ...counts, ...queued, dryRun };
}
