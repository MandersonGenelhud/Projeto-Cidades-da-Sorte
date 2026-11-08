// Cliente que SUMIU: o sistema chama de volta, como uma pessoa faria.
//  1) Depois de algumas horas sem resposta (padrão 4 h): "você ainda está por aí? você realmente tem interesse?", explicando que há fila de espera e que,
//     sem retorno em 24 h, o atendimento será encerrado e a pessoa volta para o fim da fila.
//  2) Passadas 24 h do aviso sem resposta: avisa com gentileza que está iniciando o encerramento; a pessoa vai para o fim da fila (retorno marcado para
//     30 dias depois, em que a atendente chama de novo sozinha). Se ela responder a qualquer momento, o atendimento segue normal.
// Textos FIXOS (a IA não reescreve), sem pedir desculpas. Cada fase sai UMA vez por silêncio; a mesma conversa nunca recebe a mesma fase duas vezes.
import { greetingOf } from './opening.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const CLOSED = new Set(['ganho', 'perdido']);

// Sem mensagens repetidas: por padrão NÃO há segunda chamada (nudge). Quem não responde recebe, depois de closeHours, um único aviso de encerramento.
export const DEFAULT_SILENCE = { enabled: true, nudge: false, nudgeHours: 4, closeHours: 24, closing: true };
export const silenceConfig = (agentCfg) => ({ ...DEFAULT_SILENCE, ...(agentCfg?.silence || {}) });

export const NUDGE_TEXT = '{saudacao}, {nome}! Estou entrando em contato para dar continuidade ao seu atendimento. Caso você não tenha mais interesse, já se manifeste, por favor: a nossa demanda está alta e existem muitas pessoas na fila de espera que realmente querem mudar de vida e estão aproveitando essa oportunidade. Se eu não tiver retorno em até 24 horas, vou precisar finalizar o seu atendimento para dar a vez a quem está aguardando. Outra coisa: com tanta gente procurando o serviço, é possível que taxas e valores sejam reajustados, então quem deixa para depois pode acabar pagando mais pelo mesmo serviço. A oportunidade bate à porta e, quando a gente não aproveita, depois acaba pagando mais caro por ela. Você já deve ter passado por algo parecido, não é? Se ainda faz sentido para você, me responde aqui com um "sim" que eu continuo agora mesmo com o seu atendimento.';
export const CLOSING_TEXT = '{saudacao}, {nome}. Como não tivemos retorno, vou encerrar o seu atendimento por aqui. Agradeço por ter entrado em contato e pelo seu interesse, mas, pelo visto, não faz sentido para você neste momento. Continuo à disposição para tirar qualquer dúvida. Só lembro que, com a alta procura pelo serviço, os preços podem ser reajustados. Se mudar de ideia, é só me chamar por aqui.';

const firstName = (name) => {
  const n = String(name || '').trim().split(/\s+/)[0];
  return n && !/^[+@\d]/.test(n) && n.length > 1 ? n.charAt(0).toUpperCase() + n.slice(1) : '';
};

/** Texto da fase ('nudge' | 'encerramento'). Modelos editáveis em agent.silence.nudgeText / closingText, com {saudacao} e {nome}. */
export function buildSilenceText(kind, { name = '', now = new Date(), cfg = {} } = {}) {
  const tpl = String((kind === 'nudge' ? cfg.nudgeText : cfg.closingText) || (kind === 'nudge' ? NUDGE_TEXT : CLOSING_TEXT));
  const nome = firstName(name);
  return tpl
    .replace(/\{saudacao\}, \{nome\}([!.])/g, (_, p) => (nome ? `${greetingOf(now)}, ${nome}${p}` : `${greetingOf(now)}${p}`))
    .replace(/\{saudacao\}/g, greetingOf(now))
    .replace(/\{nome\}/g, nome)
    .replace(/\s{2,}/g, ' ').trim();
}

/**
 * Quem deve receber a fase 1 (nudge) e a fase 2 (encerramento) agora. Só lê.
 * Fica de fora: grupo, simulação, conversa que uma pessoa assumiu, bloqueado, cliente fechado ou perdido, conversa sem resposta do cliente ainda,
 * e quem já recebeu a fase. O Instagram só recebe dentro das 24 h da última mensagem do cliente.
 */
export function collectSilent({ conversations, now = Date.now(), cfg = DEFAULT_SILENCE, leadOf = () => null, isBlocked = () => false, maxAgeDays = 7 }) {
  const out = { nudges: [], closings: [] };
  for (const conv of conversations) {
    if (!conv?.key || conv.simulation || String(conv.key).startsWith('sim:') || String(conv.key).includes('@g.us')) continue;
    if (conv.handoff) continue;
    const msgs = conv.messages || [];
    const last = msgs.at(-1);
    if (!last || last.role !== 'assistant') continue; // a vez é do cliente: não é silêncio dele
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
    if (!lastUser) continue; // ele nunca falou: quem chamou foi a gente, outra fila cuida
    if (conv.phone && isBlocked(conv.phone)) continue;
    const lead = leadOf(conv);
    if (lead && CLOSED.has(lead.stage)) continue;
    const ours = Date.parse(last.at) || 0;
    const userAt = Date.parse(lastUser.at) || 0;
    const ig = String(conv.key).startsWith('ig:');
    const s = conv.silence || {};
    if (cfg.nudge === false) {
      // Sem segunda chamada: só o encerramento, uma vez, depois de closeHours sem resposta.
      if (cfg.closing !== false && !s.closeAt && now - ours >= cfg.closeHours * HOUR && now - ours <= maxAgeDays * DAY && !(ig && now - userAt > 23 * HOUR)) out.closings.push(conv);
    } else if (!s.nudgeAt) {
      if (now - ours >= cfg.nudgeHours * HOUR && now - ours <= maxAgeDays * DAY && !(ig && now - userAt > 23 * HOUR)) out.nudges.push(conv);
    } else if (cfg.closing !== false && !s.closeAt && now - s.nudgeAt >= cfg.closeHours * HOUR) {
      out.closings.push(conv);
    }
  }
  return out;
}

/** Põe as fases na fila de envio (que respeita o limite por hora e o intervalo de cada número). */
export function enqueueSilence({ store, pending, conversations, now = Date.now(), leadOf, isBlocked, dryRun = false, limit = 60 }) {
  const cfg = silenceConfig(store.settings.agent);
  const out = { nudges: 0, closings: 0, queued: 0, skipped: 0, dryRun };
  if (cfg.enabled === false) return { ...out, off: true };
  const found = collectSilent({ conversations, now, cfg, leadOf, isBlocked });
  out.nudges = found.nudges.length; out.closings = found.closings.length;
  if (dryRun) return out;
  const keys = [];
  for (const [list, kind] of [[found.closings, 'encerramento'], [found.nudges, 'nudge']]) {
    for (const c of list) {
      if (keys.length >= limit || pending.queue.includes(c.key)) { out.skipped += 1; continue; }
      const ex = pending.items[c.key];
      pending.items[c.key] = {
        ...(ex || {}), jid: c.key, channel: String(c.key).startsWith('ig:') ? 'instagram' : 'whatsapp', username: c.username || ex?.username || '', phone: c.phone || ex?.phone || null,
        name: c.name || ex?.name || '', texts: [], at: now, source: 'silêncio do cliente', kind, noOpening: true, restart: false,
      };
      keys.push(c.key);
    }
  }
  if (keys.length) {
    store.save();
    try { out.queued = pending.enqueue(keys).queued || 0; } catch { /* o que não entrou continua para a próxima rodada */ }
    // Item que não entrou na fila (número desconectado, modo de teste) não fica na lista de "esperando resposta".
    for (const k of keys) if (!pending.queue.includes(k) && pending.items[k]?.source === 'silêncio do cliente') delete pending.items[k];
  }
  return out;
}
