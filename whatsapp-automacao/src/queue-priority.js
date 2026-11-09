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

/**
 * Escolhe o próximo da lista (chaves) deste número. state = { n: quantos já foram escolhidos }.
 * Regra: novos primeiro (os mais antigos entre os novos primeiro); a cada oldEvery-ésima escolha, o mais antigo do grupo antigo (se houver).
 */
export function pickNext(jids, items, { now = Date.now(), state = { n: 0 }, newHours = 3, oldEvery = 4, isStarting = () => false } = {}) {
  if (!jids.length) return null;
  // Conversa que está COMEÇANDO agora (primeiro contato, ainda sem resposta nossa) passa na frente de todas; depois vêm os recentes.
  const byAt = (a, b) => (items[a]?.at || 0) - (items[b]?.at || 0);
  const fresh = jids.filter((j) => isFresh(items[j], now, newHours) || isStarting(j)).sort((a, b) => (isStarting(b) - isStarting(a)) || byAt(a, b));
  const old = jids.filter((j) => !fresh.includes(j)).sort((a, b) => (items[a]?.at || 0) - (items[b]?.at || 0));
  if (!fresh.length) return old[0];
  if (!old.length) return fresh[0];
  state.n = (state.n || 0) + 1;
  return state.n % oldEvery === 0 ? old[0] : fresh[0];
}
