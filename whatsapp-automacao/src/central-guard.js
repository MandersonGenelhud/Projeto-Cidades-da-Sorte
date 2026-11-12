// Rede de segurança da Central: a IA às vezes DIZ ao cliente que encaminhou ao vendedor sem chamar a ferramenta, e aí ninguém recebe nada.
// Estas regras decidem, sem depender da IA, quando o sistema precisa encaminhar por conta própria.
export const HANDOFF_CLAIM = /\b(encaminh|repass|direcion|passei|vou te passar|vou passar|te passar para|consultor(a)?\s+(vai|ir[aá])|vendedor(a)?\s+(vai|ir[aá])|equipe\s+(vai|ir[aá]))/i;
export const HANDOFF_TOOLS = new Set(['passar_fechamento_para_humano', 'direcionar_para_setor', 'encaminhar_para_especialista', 'transferir_para_humano', 'avisar_marcos', 'encaminhar_para_vendedor']);

const userCount = (conv) => (conv?.messages || []).filter((m) => m.role === 'user').length;

/** Depois de uma resposta da IA na mesa de entrada: precisa encaminhar agora? tellClient = avisar o cliente (a IA não disse que encaminhou). */
export function needsAutoForward({ conv, text, actions = [], lead, humanSpoke = false }) {
  if (humanSpoke || conv?.declined) return { should: false };
  if (lead?.handoff?.at || ['ganho', 'perdido'].includes(lead?.stage)) return { should: false };
  if (actions.some((a) => HANDOFF_TOOLS.has(a.tool) && !a.result?.erro)) return { should: false };
  const claims = HANDOFF_CLAIM.test(String(text || ''));
  if (!claims && userCount(conv) < 2) return { should: false }; // ainda está perguntando o interesse
  return { should: true, tellClient: !claims, claims };
}

/** Conversa em que a IA disse que encaminhou, mas nenhum vendedor recebeu o aviso (nem pessoa assumiu). */
export function isStuck({ conv, lead, humanSpoke = false, now = Date.now(), recentDays = 3 }) {
  if (!conv || conv.simulation || conv.declined || humanSpoke || userCount(conv) < 1) return false;
  if (!lead || ['ganho', 'perdido'].includes(lead.stage)) return false;
  if (lead.handoff?.at) {
    // Encaminhado, mas o aviso ao vendedor não chegou (ou é de antes do registro de entrega): recente = reenviar.
    if (lead.handoff.notifiedAt) return false;
    if (now - new Date(lead.handoff.at).getTime() > recentDays * 86_400_000) return false;
  }
  return (conv.messages || []).some((m) => m.role === 'assistant' && HANDOFF_CLAIM.test(String(m.content || '')));
}

/**
 * Conversa da Central que ainda NÃO chegou a um vendedor (para "encaminhar todos os pendentes"): o cliente escreveu, ninguém da equipe falou com ele,
 * não recusou nem fechou, e não há aviso entregue a um VENDEDOR (encaminhado só aos administradores, por falta de vendedor, conta como pendente).
 * Parada há pelo menos `quietMin` minutos, para não atropelar a Central no meio da conversa.
 */
export function needsDelivery({ conv, lead, humanSpoke = false, now = Date.now(), days = 7, quietMin = 3 }) {
  if (!conv || conv.simulation || conv.declined || humanSpoke || userCount(conv) < 1) return false;
  const last = new Date(conv.updatedAt || 0).getTime();
  if (now - last > days * 86_400_000 || now - last < quietMin * 60_000) return false;
  if (lead && ['ganho', 'perdido'].includes(lead.stage)) return false;
  return !(lead?.handoff?.notifiedAt && lead.handoff.toId);
}

/** Por que alguém da equipe está (ou não) no rodízio da Central: lista de motivos em português; vazia = está no rodízio. */
export function rotationReasons(u, { isCentral = false, isOwner = false } = {}) {
  const why = [];
  if (u.active === false) why.push('desativado');
  if (u.pending) why.push('cadastro aguardando liberação');
  if (u.trafficOnly) why.push('acesso só ao Tráfego');
  if (isCentral) why.push('é o usuário da Central');
  if (isOwner) why.push('é o dono (não recebe clientes)');
  if (!u.whatsapp) why.push('sem WhatsApp no cadastro');
  if (!(u.receivesLeads ?? u.role === 'seller')) why.push('rodízio desligado');
  if (u.sectors?.length && !u.sectors.includes('documentacao')) why.push(`só atende ${u.sectors.map((s) => ({ loteamentos: 'imóveis', veiculos: 'veículos' })[s] || s).join(' e ')}`);
  return why;
}
