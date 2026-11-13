// Tempo real do painel (Server-Sent Events) com FILTRO POR PESSOA.
// Antes, cada evento (mensagem de cliente, registro do sistema, conversa) ia para TODOS os navegadores logados, inclusive vendedores e a
// equipe de tráfego: um vendedor recebia, no navegador, nome e texto de clientes de outros vendedores. Agora:
//  - administrador recebe tudo;
//  - equipe de tráfego recebe só o estado da conexão;
//  - vendedor recebe mensagens e conversas SÓ das conversas que ele pode ver, e nunca os registros (logs) do sistema;
//  - a mensagem vai resumida (sem o conteúdo bruto do WhatsApp) e eventos repetidos de conversa são agrupados (menos peso no navegador).

const STAFF_EVENTS = new Set(['status', 'lineStatus', 'crm', 'crmAssigned', 'crmDue', 'appointments', 'payment', 'paymentPaid', 'sales', 'closing', 'videocall', 'user', 'seller', 'learnings', 'instagramStatus', 'tunnel']);
const CONV_EVENTS = new Set(['message', 'conversation']);

/** Mensagem que vai para o navegador: só o necessário para a tela. */
export const slimMessage = (m = {}) => ({
  jid: m.jid, key: m.jid, name: m.name || '', phone: m.phone || '', username: m.username || '', isGroup: Boolean(m.isGroup),
  line: m.line || null, text: String(m.text || '').slice(0, 300), at: m.timestamp || Date.now(),
});

/** Este evento pode ir para esta pessoa? canSeeConv(user, key) diz se ela enxerga a conversa. */
export function allowEvent(user, event, data, { canSeeConv = () => false } = {}) {
  if (!user) return false;
  if (user.trafficOnly) return event === 'status';
  if (user.role === 'admin') return true;
  if (CONV_EVENTS.has(event)) {
    const key = data?.key || data?.jid || '';
    if (!key || data?.isGroup) return false;
    try { return Boolean(canSeeConv(user, key)); } catch { return false; }
  }
  return STAFF_EVENTS.has(event);
}

export class SseHub {
  constructor({ canSeeConv = () => false } = {}) {
    this.clients = new Map(); // res → user
    this.canSeeConv = canSeeConv;
  }

  add(res, user) { this.clients.set(res, user); }
  remove(res) { this.clients.delete(res); }
  get size() { return this.clients.size; }

  notify(event, data) {
    const body = event === 'message' ? slimMessage(data) : data;
    let payload = null;
    for (const [res, user] of this.clients) {
      if (!allowEvent(user, event, body, { canSeeConv: this.canSeeConv })) continue;
      payload ||= `event: ${event}\ndata: ${JSON.stringify(body ?? null)}\n\n`;
      try { res.write(payload); } catch { this.clients.delete(res); }
    }
  }
}
