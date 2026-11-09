// Prioridade da fila de atendimento: quem acabou de chegar (cliente novo escrevendo agora) passa na frente; os antigos (retomadas, recomeços,
// pedidos parados há dias) são atendidos aos poucos, sem travar: a cada `oldEvery` atendimentos, um é do grupo antigo.
const HOUR = 3_600_000;

/** Conversa que está iniciando: nenhuma resposta nossa ainda e a primeira mensagem do cliente é recente. */
export function startingConv(conv, now = Date.now(), hours = 6) {
  const msgs = conv?.messages || [];
  if (!msgs.length) return true;
  if (msgs.some((m) => m.role === 'assistant')) return false;
  return now - (Date.parse(msgs[0].at) || 0) <= hours * 3_600_000;
}

/** O item é "novo"? Cliente que escreveu há pouco e não é retomada nossa. */
export function isFresh(item, now, newHours = 3) {
  if (!item) return false;
  if (item.restart || ['retomar', 'nudge', 'encerramento', 'orcamento'].includes(item.kind)) return false;
  return now - (Number(item.at) || 0) <= newHours * HOUR;
}

/** Item que é o CLIENTE falando conosco (respondeu uma mensagem nossa ou escreveu agora): não é retomada/recomeço/lembrete nosso. */
export function isClientMessage(item) {
  if (!item) return false;
  return !(item.restart || ['retomar', 'nudge', 'encerramento', 'orcamento'].includes(item.kind));
}

/**
 * Escolhe o próximo da lista (chaves) deste número. state = { n: quantos já foram escolhidos }.
 * Ordem de prioridade:
 *  1) quem RESPONDEU (cliente falou conosco numa conversa que já existia), do que espera há mais tempo ao mais recente;
 *  2) quem está CHEGANDO agora (primeiro contato, ainda sem resposta nossa);
 *  3) as retomadas e recomeços antigos, do mais antigo ao mais recente.
 * Para as antigas nunca ficarem paradas para sempre, a cada oldEvery-ésima escolha sai uma delas (só quando ainda há gente nos grupos 1 e 2).
 * Mensagem de cliente com mais de replyDays dias sem resposta deixa de ser "resposta" e entra no grupo das antigas.
 */
export function pickNext(jids, items, { now = Date.now(), state = { n: 0 }, replyDays = 3, oldEvery = 8, isStarting = () => false } = {}) {
  if (!jids.length) return null;
  const at = (j) => Number(items[j]?.at) || 0;
  const byAt = (a, b) => at(a) - at(b);
  const live = jids.filter((j) => isClientMessage(items[j]) && now - at(j) <= replyDays * 24 * HOUR);
  const starting = live.filter((j) => isStarting(j)).sort(byAt);
  const replies = live.filter((j) => !isStarting(j)).sort(byAt);
  const old = jids.filter((j) => !live.includes(j)).sort(byAt);
  const top = [...replies, ...starting];
  if (!top.length) return old[0];
  if (!old.length) return top[0];
  state.n = (state.n || 0) + 1;
  return state.n % oldEvery === 0 ? old[0] : top[0];
}
