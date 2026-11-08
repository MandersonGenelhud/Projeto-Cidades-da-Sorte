// "Por que a atendente parou de falar?": para cada conversa em que a última mensagem é do cliente e a IA não respondeu, mostra o MOTIVO.
// Só lê. Serve para o administrador achar a causa em vez de adivinhar.
import { isWithinWorkHours } from './utils.js';

const HOUR = 3_600_000;

export function stallReport({ conversations, pending = { queue: [], items: {} }, agentCfg = {}, active = true, isBlocked = () => false, now = Date.now(), hours = 72, minWaitMin = 3, limit = 60 }) {
  const rows = [];
  for (const conv of conversations) {
    if (!conv?.key || conv.simulation || String(conv.key).startsWith('sim:') || String(conv.key).includes('@g.us')) continue;
    const msgs = conv.messages || [];
    const last = msgs.at(-1);
    if (!last || last.role !== 'user') continue;
    const at = Date.parse(last.at) || 0;
    if (now - at > hours * HOUR || now - at < minWaitMin * 60_000) continue;
    let motivo; let codigo;
    if (conv.phone && isBlocked(conv.phone)) { codigo = 'bloqueado'; motivo = 'contato na lista de bloqueio (pediu para não receber mensagens)'; }
    else if (!active) { codigo = 'ia_desligada'; motivo = 'o agente de IA está desligado'; }
    else if (conv.handoff) { codigo = 'pausada'; motivo = `conversa pausada: ${conv.handoffReason || 'uma pessoa assumiu'}`; }
    else if (conv.aiFailedAt) { codigo = 'ia_falhou'; motivo = 'a IA falhou ao responder (a fila tenta de novo sozinha)'; }
    else if (pending.queue?.includes(conv.key)) { codigo = 'na_fila'; motivo = 'na fila de respostas, esperando a vez do número (limite por hora)'; }
    else if (!isWithinWorkHours(agentCfg.workHours, new Date(now))) { codigo = 'fora_horario'; motivo = 'fora do horário de trabalho da IA: responde quando abrir'; }
    else if (pending.items?.[conv.key]) { codigo = 'pendente'; motivo = 'na lista de clientes esperando resposta (ainda não entrou na fila)'; }
    else { codigo = 'sem_motivo'; motivo = 'sem motivo conhecido: a mensagem pode ter chegado e não ter sido entregue à IA'; }
    rows.push({ key: conv.key, name: conv.name || conv.username || conv.phone || '', phone: conv.phone || '', waitingHours: Math.round(((now - at) / HOUR) * 10) / 10, codigo, motivo, last: String(last.content || '').slice(0, 120) });
  }
  rows.sort((a, b) => b.waitingHours - a.waitingHours);
  const porMotivo = rows.reduce((m, r) => ({ ...m, [r.codigo]: (m[r.codigo] || 0) + 1 }), {});
  return { total: rows.length, porMotivo, rows: rows.slice(0, limit) };
}
