// Diagnóstico do número de um vendedor: "por que a minha IA não responde?". Mostra, em português simples, cada coisa que pode estar travando
// (conexão, IA do número, agente geral, horário, pausa por pessoa usando o celular, fila) e, para os últimos clientes sem resposta, o motivo.
// Usado pelo atalho /diagnostico no WhatsApp do vendedor e por GET /api/diagnostico-numero (só o próprio número de quem pede).

const LINE_KEY = /^l:([^:]+):/;
const ok = (b) => (b ? '✅' : '🔴');

/**
 * ctx: { store, agent, wa, lines, pending, isWithinWorkHours(), convWhyNot(conv), now() }
 * Devolve { linhas: [texto...], problemas: n }.
 */
export function lineDiagnosis(ctx, lineId) {
  const { store, agent, wa, lines } = ctx;
  const now = ctx.now ? ctx.now() : Date.now();
  const line = lines.list().find((l) => l.id === lineId);
  if (!line) return { linhas: ['🔴 Número não encontrado no sistema.'], problemas: 1 };
  const out = [];
  let problemas = 0;
  const check = (cond, good, bad) => { if (!cond) problemas += 1; out.push(`${ok(cond)} ${cond ? good : bad}`); };
  const key1 = `l:${line.id}:1@s.whatsapp.net`;
  const s = store.settings || {};

  check(wa.isConnected(key1), `WhatsApp conectado${line.me?.phone ? ` (+${line.me.phone})` : ''}.`, 'WhatsApp DESCONECTADO: conecte de novo em Conexões (ler o QR Code).');
  check(line.agent !== false, 'IA deste número: LIGADA.', 'IA deste número: DESLIGADA (Equipe → Conexões). Ligue para ela responder.');
  check(s.agent?.enabled !== false && agent.active, 'Agente de IA geral ligado e com a chave.', 'Agente de IA geral DESLIGADO ou sem a chave (aba Agente IA).');
  check(s.agent?.audience !== 'test', 'Responde todos os clientes (não está em modo de teste).', 'MODO DE TESTE: a IA só responde os números de teste (Agente IA → Quem a IA atende).');
  check(s.autoReplyEnabled !== false, 'Respostas automáticas ligadas.', 'Respostas automáticas DESLIGADAS (Configurações).');
  check(ctx.isWithinWorkHours(), 'Dentro do horário da IA.', 'Fora do horário da IA: ela responde quando o horário abrir (Agente IA → horário de trabalho).');
  const gap = wa.humanWaitMs ? wa.humanWaitMs(key1) : 0;
  out.push(gap > 0 ? `⏳ Você escreveu pelo celular agora há pouco: intervalo de ${Math.ceil(gap / 1000)} s neste número.` : '✅ Sem pausa por uso do celular no número.');
  const busy = [...(agent.accountLocks?.keys?.() || [])].includes(`linha:${line.id}`);
  if (busy) out.push('⏳ A IA está respondendo um cliente deste número agora (um de cada vez).');
  const fila = ctx.pending?.status?.().bySender?.find((b) => b.key === `linha:${line.id}`);
  if (fila?.waiting) out.push(`📋 Fila de "sem resposta" deste número: ${fila.waiting} esperando${fila.queued ? `, ${fila.queued} na fila agora` : ''}.`);

  // Últimos clientes deste número cuja última mensagem é deles (sem resposta), com o motivo.
  const convs = Object.values(store.data.conversations || {})
    .filter((c) => c && LINE_KEY.test(c.key || '') && String(c.key).split(':')[1] === line.id && !/@g\.us$/.test(c.key) && !c.simulation)
    .filter((c) => (c.messages || []).filter((m) => m.role === 'user' || m.role === 'assistant').at(-1)?.role === 'user')
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, 6);
  if (convs.length) {
    out.push('', '*Clientes esperando resposta neste número:*');
    for (const c of convs) {
      const last = (c.messages || []).filter((m) => m.role === 'user').at(-1);
      const min = last?.at ? Math.round((now - Date.parse(last.at)) / 60_000) : null;
      let why = [];
      try { why = ctx.convWhyNot(c) || []; } catch { why = []; }
      out.push(`• ${c.name || `+${c.phone || '?'}`}${min !== null ? ` (há ${min} min)` : ''}: ${why.length ? why.join(' ') : 'nada impede; se não respondeu, veja os erros abaixo'}`);
    }
  } else out.push('', 'Nenhum cliente com a última mensagem sem resposta na memória da IA deste número.');

  // Erros recentes (2 h) deste número ou dos clientes dele.
  const phones = new Set(convs.map((c) => String(c.phone || '')).filter(Boolean));
  const label = String(line.label || '');
  const allErrs = (store.data.logs || []).filter((l) => l.type === 'error' && now - Date.parse(l.at) < 2 * 3_600_000
    && ((label && String(l.message || '').includes(label)) || phones.has(String(l.phone || '')) || String(l.phone || '').startsWith(`l:${line.id}:`))).slice(-4);
  // Erro de CONEXÃO de antes da última vez que o número conectou já foi resolvido: não conta como problema (só uma linha informando).
  const phone = String(line.phone || line.me?.phone || '').replace(/\D/g, '');
  const connectedAt = Math.max(Number(ctx.connectedAt?.(line.id)) || 0, ...(store.data.logs || [])
    .filter((l) => l.type === 'system' && /conectado/i.test(String(l.message || '')) && ((phone && String(l.message).includes(phone)) || (label && String(l.message).includes(label))))
    .map((l) => Date.parse(l.at) || 0));
  const isConnErr = (e) => /WhatsApp:|sess[aã]o|conex[aã]o|desconect/i.test(String(e.message || ''));
  const online = wa.isConnected(key1);
  const resolved = allErrs.filter((e) => online && isConnErr(e) && Date.parse(e.at) <= connectedAt);
  const errs = allErrs.filter((e) => !resolved.includes(e));
  if (resolved.length) out.push('', `✅ ${resolved.length === 1 ? 'Um erro de conexão anterior já foi resolvido' : `${resolved.length} erros de conexão anteriores já foram resolvidos`}: o número reconectou às ${new Date(connectedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Asuncion' })}.`);
  if (errs.length) {
    problemas += errs.length;
    out.push('', '*Erros recentes:*', ...errs.map((e) => `🔴 ${new Date(e.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Asuncion' })} ${String(e.message || '').slice(0, 200)}`));
  }
  return { linhas: out, problemas };
}

export const diagnosisText = (label, d) => `*Diagnóstico do WhatsApp${label ? ` de ${label}` : ''}*\n${d.linhas.join('\n')}${d.problemas ? '' : '\n\nTudo certo do lado do sistema.'}`;

export function registerDiagnosticoNumeroRoutes(app, ctx) {
  app.get('/api/diagnostico-numero', (req, res) => {
    const own = ctx.lines.byOwner?.(req.user?.id);
    if (!own) return res.json({ linhas: ['Você não tem um WhatsApp conectado ao sistema.'], problemas: 0 });
    res.json(lineDiagnosis(ctx, own.id));
  });
  return { forLine: (lineId) => lineDiagnosis(ctx, lineId) };
}
