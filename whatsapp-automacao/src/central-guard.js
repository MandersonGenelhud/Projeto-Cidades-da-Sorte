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
