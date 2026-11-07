// Auditoria das conversas e mapa de mensagens por número: para cada WhatsApp (principal, Instagram e o de cada vendedor) mostra
// quantas mensagens chegaram e quantas foram respondidas, quem está sem resposta e POR QUÊ, e, por cliente e por dia, quantas
// mensagens chegaram e foram enviadas e se virou fechamento. Só lê: não altera nada.
import { senderOf, profileFor } from './send-profiles.js';

const dayOf = (iso, offsetMin = -180) => new Date(Date.parse(iso) + offsetMin * 60_000).toISOString().slice(0, 10);

/** Por que a última mensagem do cliente ficou sem resposta (texto simples para a equipe). */
export function whyUnanswered(c, ctx) {
  if (ctx.blacklisted?.(c.phone)) return { code: 'bloqueado', text: 'O cliente pediu para não receber mensagens (lista de bloqueio).' };
  if (c.handoff) return { code: 'pausada', text: `Conversa pausada: ${c.handoffReason || 'um humano assumiu'}. A IA não responde enquanto estiver pausada.` };
  if (ctx.line && ctx.line.agent === false) return { code: 'ia_desligada_numero', text: 'A atendente de IA está desligada neste número (só o vendedor responde).' };
  if (!ctx.agentOn) return { code: 'ia_desligada', text: 'A IA está desligada (aba Agente IA).' };
  if (!ctx.llmOn) return { code: 'sem_chave', text: 'Falta a chave da IA ou o limite do plano acabou.' };
  if (ctx.audience === 'test' && !ctx.inTestList?.(c)) return { code: 'modo_teste', text: 'Modo de teste ligado: a IA só responde os números de teste. Troque para "todos" na aba Agente IA.' };
  if (ctx.connected === false) return { code: 'desconectado', text: 'O WhatsApp deste número está desconectado.' };
  if (String(c.key).startsWith('ig:') && Date.now() - Date.parse(c.updatedAt) > 24 * 3_600_000) return { code: 'instagram_24h', text: 'Passou de 24 horas: o Instagram não permite mais responder por aqui.' };
  return { code: 'na_fila', text: 'Sem bloqueio encontrado: está esperando a vez na fila (ou a resposta ainda não saiu).' };
}

/**
 * conversations: conversas completas (com messages); lines: lines.list(); settings; findLead(conv); ownerName(id); stageLabel(stage);
 * isConnected(key); blacklisted(phone); now. Retorna { findings, senders, map, days }.
 */
export function auditMessaging({ conversations, lines = [], settings, findLead = () => null, ownerName = () => '', senderLabel, isConnected = () => true, blacklisted = () => false, llmOn = true, now = new Date(), days = 14 }) {
  const agent = settings.agent || {};
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const dayList = Array.from({ length: days }, (_, i) => dayOf(new Date(now.getTime() - (days - 1 - i) * 86_400_000).toISOString()));
  const inTest = (c) => {
    const list = agent.testNumbers || [];
    const phone = String(c.phone || '').replace(/\D/g, '');
    return list.some((n) => (String(n).startsWith('@') ? c.username && `@${String(c.username).toLowerCase()}` === String(n).toLowerCase() : phone && String(n).replace(/\D/g, '').endsWith(phone.slice(-8))));
  };
  const findings = [];
  if (agent.enabled === false) findings.push({ level: 'critico', text: 'A IA está DESLIGADA: nenhuma conversa recebe resposta automática. Ligue na aba Agente IA.' });
  if (agent.audience === 'test') findings.push({ level: 'critico', text: `Modo de TESTE ligado: a IA só responde ${(agent.testNumbers || []).length} número(s) de teste, e ignora todos os outros clientes. Para atender todo mundo, mude para "todos" na aba Agente IA.` });
  if (settings.autoReplyEnabled === false) findings.push({ level: 'aviso', text: 'As respostas automáticas estão desligadas nas configurações gerais.' });
  if (agent.pauseOnOwnerReply !== false) findings.push({ level: 'info', text: 'Se o dono responder pelo celular, a IA pausa aquela conversa (padrão). Conversas pausadas aparecem abaixo como "pausada".' });

  const senders = new Map();
  const get = (k) => {
    if (!senders.has(k)) {
      const prof = profileFor(settings, k);
      senders.set(k, { key: k, label: senderLabel?.(k) || k, connected: true, inbound: 0, outbound: 0, conversations: 0, unanswered: 0, reasons: {}, oldestWaitMin: 0, profile: { perHour: prof.perHour, dailyLimit: prof.dailyLimit, from: prof.from, to: prof.to, gap: prof.gap, custom: prof.custom } });
    }
    return senders.get(k);
  };
  get('principal'); // o número principal sempre aparece
  for (const l of lines) get(`linha:${l.id}`);

  const map = [];
  for (const c of conversations) {
    if (c.simulation) continue;
    const k = senderOf(c.key);
    const s = get(k);
    const ln = k.startsWith('linha:') ? lineById.get(k.slice(6)) : null;
    const connected = isConnected(c.key);
    s.connected = connected !== false;
    const perDay = Object.fromEntries(dayList.map((d) => [d, { in: 0, out: 0 }]));
    let totalIn = 0; let totalOut = 0;
    for (const m of c.messages || []) {
      const d = dayOf(m.at);
      const cell = perDay[d];
      if (m.role === 'user') { if (cell) cell.in += 1; if (cell) totalIn += 1; } else if (m.role === 'assistant') { if (cell) cell.out += 1; if (cell) totalOut += 1; }
    }
    s.inbound += totalIn; s.outbound += totalOut; s.conversations += 1;
    const last = (c.messages || []).at(-1);
    const waiting = last?.role === 'user';
    let why = null; let waitMin = 0;
    if (waiting) {
      waitMin = Math.max(0, Math.round((now.getTime() - Date.parse(last.at)) / 60_000));
      if (waitMin >= 2) {
        why = whyUnanswered(c, { blacklisted, line: ln, agentOn: agent.enabled !== false, llmOn, audience: agent.audience, inTestList: inTest, connected });
        s.unanswered += 1;
        s.reasons[why.code] = (s.reasons[why.code] || 0) + 1;
        s.oldestWaitMin = Math.max(s.oldestWaitMin, waitMin);
      }
    }
    if (totalIn + totalOut === 0 && !waiting) continue; // sem movimento no período
    const lead = findLead(c);
    map.push({
      key: c.key, sender: k, name: c.name || '', phone: c.phone || '', channel: String(c.key).startsWith('ig:') ? 'ig' : 'wa',
      owner: ownerName(lead?.ownerId) || '', stage: lead?.stage || '', stageLabel: lead?.stageLabel || '', closed: lead?.stage === 'ganho', lost: lead?.stage === 'perdido', value: lead?.stage === 'ganho' ? Number(lead.closedValue || 0) : 0,
      in: totalIn, out: totalOut, perDay: dayList.map((d) => perDay[d]), waiting: Boolean(why), waitMin: why ? waitMin : 0, why: why?.text || '', whyCode: why?.code || '', handoff: Boolean(c.handoff), updatedAt: c.updatedAt,
    });
  }
  const unansweredTotal = [...senders.values()].reduce((n, x) => n + x.unanswered, 0);
  const byReason = {};
  for (const s of senders.values()) for (const [r, n] of Object.entries(s.reasons)) byReason[r] = (byReason[r] || 0) + n;
  if (byReason.pausada) findings.push({ level: 'aviso', text: `${byReason.pausada} cliente(s) esperando resposta estão com a conversa PAUSADA (o dono respondeu pelo celular ou a IA passou para humano). Use "Retomar com a IA" nas conversas que devem voltar.` });
  if (byReason.modo_teste) findings.push({ level: 'critico', text: `${byReason.modo_teste} cliente(s) sem resposta só porque o modo de teste está ligado.` });
  if (!unansweredTotal) findings.push({ level: 'ok', text: 'Nenhum cliente esperando resposta há mais de 2 minutos.' });
  map.sort((a, b) => Number(b.waiting) - Number(a.waiting) || b.waitMin - a.waitMin || String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const out = [...senders.values()].sort((a, b) => (a.key === 'principal' ? -1 : b.key === 'principal' ? 1 : b.unanswered - a.unanswered));
  return { generatedAt: now.toISOString(), days: dayList, findings, senders: out, unansweredTotal, byReason, map: map.slice(0, 300), mapTotal: map.length };
}
