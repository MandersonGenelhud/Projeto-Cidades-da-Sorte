// Guarda de contato: o sistema NÃO procura de novo quem já disse que fechou com outra pessoa, que não quer mais, que pediu para não ser chamado,
// nem quem JÁ FECHOU CONOSCO (contrato assinado, venda, Pix pago, cliente ganho). Também não manda duas chamadas seguidas ao mesmo cliente.
// 1) detectDecline: lê a fala do cliente ("já fechei com um amigo", "não tenho mais interesse", "não me chame mais").
// 2) scanDeclined: faz a mesma leitura em TODAS as conversas antigas.
// 3) buildClosedIndex: lê o banco (índice de clientes) e diz se aquele número/CPF já fechou conosco.
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9?!. ]+/g, ' ').replace(/\s+/g, ' ').trim();
const clip = (s, n = 160) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const DAY = 86_400_000;
const HOUR = 3_600_000;

export const DECLINE_LABEL = {
  fechou_outro: 'Fechou com outra pessoa ou empresa',
  sem_interesse: 'Disse que não tem mais interesse',
  nao_chamar: 'Pediu para não ser chamado',
  fechou_conosco: 'Disse que já fechou conosco',
};

/** O que o cliente disse? Devolve { kind } ou null. Só o texto dele; perguntas e negações ("ainda não fechei") não contam. */
export function detectDecline(text) {
  const t = fold(text);
  if (!t || t.length < 4) return null;
  const isQuestion = /\?\s*$/.test(t);
  const NAO_CHAMAR = /\b(nao (me )?(chame|chama|mande|manda|envie|envia|procure|procura|ligue|liga)( mais)?|pare de (me )?(mandar|enviar|chamar)|para de me (mandar|chamar|enviar)|me (tire|tira|remova|remove|exclua|exclui) (da|de)\b|nao quero (mais )?(receber|ser contatad[oa]))/;
  if (NAO_CHAMAR.test(t)) return { kind: 'nao_chamar' };
  const SEM_INTERESSE = /\b(nao tenho (mais )?interesse|nao temos (mais )?interesse|nao quero mais|nao queremos mais|desisti|desistimos|nao vou mais|nao vamos mais|nao preciso mais|nao precisamos mais|perdi o interesse|deixei de ter interesse)\b/;
  if (SEM_INTERESSE.test(t)) return { kind: 'sem_interesse' };
  if (isQuestion) return null;
  const VERBO = '(fechei|fechamos|fechou|contratei|contratamos|contratou|resolvi|resolvemos|resolveu)';
  // Negação: "ainda não fechei", "não fechei com ninguém".
  if (new RegExp(`\\b(ainda nao|nao|nunca|nem) (ja )?${VERBO}\\b`).test(t)) return null;
  // Fechou com a própria empresa: não é recusa, é venda (a equipe confere).
  if (new RegExp(`\\b${VERBO} com (voces|a migra|a gente de voces|o marcos|a empresa de voces)\\b`).test(t)) return { kind: 'fechou_conosco' };
  if (new RegExp(`\\bja\\b[^.!]{0,30}\\b${VERBO}\\b`).test(t) || new RegExp(`\\b${VERBO} com (outr|um amig|uma amig|a empresa|o despachante|a despachante|um despachante|um escritorio|uma assessoria|um advogad|uma advogad|alguem|outra pessoa)`).test(t)) return { kind: 'fechou_outro' };
  if (/\b(optei|optamos|decidi|decidimos) (por|em) (fechar )?(com )?(outr)/.test(t)) return { kind: 'fechou_outro' };
  if (/\bja (estou|estamos|to|tamo|tamos) com (a )?(documentacao|o processo|tudo)( resolvid[oa])?\b/.test(t) || /\bja (estou|estamos|to|tamo) (com )?(outr[oa]|um amig)/.test(t)) return { kind: 'fechou_outro' };
  return null;
}

export const isAck = (text) => ACK.test(fold(text));
const ACK = /^(ok|okay|certo|beleza|blz|valeu|tudo bem|tudo certo|obrigad[oa]|muito obrigad[oa]|de nada|abraco|abracos|boa sorte|tmj|show|combinado|entendi|sim)[.! ]*$/;

/**
 * Marca no sistema que o cliente recusou: a conversa fica sinalizada (nenhum contato de iniciativa nossa depois disso), o prospecto vai para
 * "perdido" com o motivo, e quem pediu para não ser chamado entra na lista de bloqueio. Nunca apaga nada. Devolve o que foi feito.
 */
export function markDecline({ conv, decline, text = '', crm = null, store = null, now = Date.now(), noteDue = true }) {
  const done = { marked: false, lead: false, blocked: false };
  if (!conv || !decline) return done;
  if (conv.declined?.kind === decline.kind) return done;
  conv.declined = { kind: decline.kind, at: now, text: clip(text), noteDue };
  done.marked = true;
  if (decline.kind === 'nao_chamar' && conv.phone && store) { try { store.addToBlacklist(conv.phone); done.blocked = true; } catch { /* já estava */ } }
  const lead = crm?.findForConversation?.({ key: conv.key, phone: conv.phone, username: conv.username });
  if (lead) {
    const sys = { name: 'Sistema', role: 'admin' };
    try {
      if (decline.kind !== 'fechou_conosco' && !['ganho', 'perdido'].includes(lead.stage)) { crm.setStage(sys, lead, { stage: 'perdido', lostReason: DECLINE_LABEL[decline.kind] }); done.lead = true; }
      crm.addNote(sys, lead.id, decline.kind === 'fechou_conosco'
        ? `O cliente disse que já fechou conosco ("${clip(text, 100)}"). Confira se há contrato e baixa: o sistema parou de procurar este cliente.`
        : `${DECLINE_LABEL[decline.kind]} ("${clip(text, 100)}"). O sistema marcou como perdido e parou de procurar este cliente.`);
    } catch { /* o aviso no CRM nunca derruba o atendimento */ }
  }
  return done;
}

/** Instrução curta para a atendente responder uma única vez, com educação, sem vender (usada na próxima resposta). */
export function declineNote(kind) {
  if (kind === 'nao_chamar') return '';
  if (kind === 'fechou_conosco') return '# CLIENTE DIZ QUE JÁ FECHOU CONOSCO (regra da direção)\nResponda em UMA frase simpática: agradeça e diga que a equipe vai conferir o contrato e já retorna. Não venda nada e não faça perguntas de vendas.';
  return `# CLIENTE JÁ RESOLVEU OU NÃO QUER MAIS (regra da direção)\nO cliente acabou de dizer que ${kind === 'fechou_outro' ? 'já fechou com outra pessoa ou empresa' : 'não tem mais interesse'}. Responda em UMA ou DUAS frases curtas e simpáticas: agradeça pela atenção, deseje sucesso e diga que a porta continua aberta se precisar de algo no futuro. NÃO tente vender, NÃO insista, NÃO faça perguntas de vendas e NÃO use ferramentas.`;
}

/**
 * Lê TODAS as conversas antigas: quem já recusou fica sinalizado. Vale a última recusa se depois dela o cliente só agradeceu ("ok", "obrigado")
 * ou não falou mais; se ele voltou com interesse, não é recusa. dryRun só conta.
 */
export function scanDeclined({ store, crm = null, now = Date.now(), days = 180, dryRun = false }) {
  const out = { checked: 0, found: 0, marked: 0, byKind: {} };
  for (const conv of Object.values(store.data.conversations || {})) {
    if (!conv?.key || conv.simulation || String(conv.key).startsWith('sim:') || String(conv.key).includes('@g.us')) continue;
    const msgs = conv.messages || [];
    const users = msgs.map((m, i) => ({ m, i })).filter((x) => x.m.role === 'user');
    if (!users.length) continue;
    if (now - (Date.parse(users.at(-1).m.at) || 0) > days * DAY) continue;
    out.checked += 1;
    let hit = null;
    for (let k = users.length - 1; k >= 0 && !hit; k--) { const d = detectDecline(users[k].m.content); if (d) hit = { d, k }; }
    if (!hit) continue;
    const after = users.slice(hit.k + 1);
    if (!after.every((x) => ACK.test(fold(x.m.content)))) continue; // voltou a conversar de verdade
    out.found += 1; out.byKind[hit.d.kind] = (out.byKind[hit.d.kind] || 0) + 1;
    if (dryRun) continue;
    if (markDecline({ conv, decline: hit.d, text: users[hit.k].m.content, crm, store, now, noteDue: false }).marked) out.marked += 1;
  }
  if (!dryRun && out.marked) store.flush();
  return out;
}

/** Índice de quem JÁ FECHOU CONOSCO, lido do banco (cada pessoa já vem com contratos, vendas, Pix e prospecto juntos). */
export function buildClosedIndex(dir) {
  const last9 = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 8 ? d.slice(-9) : ''; };
  const byPhone = new Map(); const byDoc = new Map(); const byKey = new Map();
  for (const p of dir?.people || []) {
    let why = '';
    for (const it of p.items) {
      if (it.kind === 'contrato' && it.signed) why = 'contrato assinado';
      else if (['venda', 'venda do sistema antigo'].includes(it.kind) && it.status !== 'cancelada') why ||= 'tem venda';
      else if (it.kind === 'contrato do sistema antigo' && !/cancel|rescind|distrat/i.test(it.status || '')) why ||= 'contrato do sistema antigo';
      else if (it.kind === 'Pix' && it.status === 'pago') why ||= 'Pix pago';
      else if (it.kind === 'prospecto' && it.status === 'ganho') why ||= 'cliente fechado no CRM';
    }
    if (!why) continue;
    for (const ph of p.phones) if (last9(ph)) byPhone.set(last9(ph), why);
    for (const c of p.cpfs) byDoc.set(c, why);
    for (const it of p.items) if (it.convKey) byKey.set(it.convKey, why);
  }
  return { size: byPhone.size + byDoc.size, closedFor: ({ phone = '', cpf = '', key = '' } = {}) => byKey.get(key) || byPhone.get(last9(phone)) || byDoc.get(String(cpf).replace(/\D/g, '')) || '' };
}

/** Item de fila que é INICIATIVA nossa (não é resposta a algo que o cliente acabou de escrever). */
export const isProactive = (p) => Boolean(p) && (p.restart === true || ['retomar', 'nudge', 'encerramento', 'orcamento'].includes(p.kind) || /^(recomeçar|orçamento|silêncio|retomada)/i.test(String(p.source || '')));

/**
 * Decide se podemos procurar o cliente. Devolve '' (pode) ou o motivo: 'recusou', 'fechou_conosco' ou 'recente'.
 * getClosed() → índice de buildClosedIndex (montado e guardado pelo chamador).
 */
export function outreachBlock({ conv, item, getClosed = () => null, now = Date.now(), minGapHours = 12 }) {
  if (conv?.declined) return 'recusou';
  if (!isProactive(item)) return '';
  if (conv?.lastProactiveAt && now - conv.lastProactiveAt < minGapHours * HOUR) return 'recente';
  const idx = getClosed();
  const why = idx?.closedFor({ phone: conv?.phone || item?.phone || '', key: conv?.key || item?.jid || '' });
  return why ? 'fechou_conosco' : '';
}
