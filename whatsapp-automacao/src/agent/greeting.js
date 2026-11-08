// Saudação certa pelo horário (regra da Migra):
// 00:00–12:59 bom dia · 13:00–18:59 boa tarde · 19:00–23:59 boa noite.
export function greetingFor(now = new Date()) {
  const h = now.getHours();
  if (h < 13) return 'bom dia';
  if (h < 19) return 'boa tarde';
  return 'boa noite';
}

/** Troca "bom dia / boa tarde / boa noite" errados pela saudação de agora, mantendo maiúsculas. */
/**
 * Abertura das retomadas do Instagram (clientes que esperaram): saudação do horário, o motivo da demora,
 * o pedido de perdão e o agradecimento. Fica igual para todos; a IA escreve só a continuação.
 */
export function backlogOpening({ name = '', now = new Date() } = {}) {
  const first = String(name || '').trim().replace(/^@/, '').split(/\s+/)[0];
  const hi = greetingFor(now).replace(/^./, (c) => c.toUpperCase());
  const who = first && !/[._\d]/.test(first) ? `, ${first}` : '';
  return `${hi}${who}! Nossa demanda está alta e precisamos aumentar a nossa equipe para conseguir dar o atendimento que você merece. Peço perdão pela demora e agradeço por aguardar!`;
}

export function fixGreeting(text, now = new Date()) {
  const right = greetingFor(now);
  return String(text).replace(/\b(bom\s+dia|boa\s+tarde|boa\s+noite)\b/gi, (m) => {
    if (m === m.toUpperCase()) return right.toUpperCase();
    if (m[0] === m[0].toUpperCase()) return right[0].toUpperCase() + right.slice(1);
    return right;
  });
}

/**
 * Tom profissional (regra da direção): nada de beijo, nada de "com carinho" (a atendente age com calma e gentileza, sem anunciar isso).
 * Troca "beijo/beijinho/bjs" por "abraço", tira os emojis de beijo, e as expressões "com (muito) carinho" e "carinhosamente", mesmo que a IA escorregue.
 * Despedida com "abraço" só se a própria atendente escolher (o prompt a restringe); beijo nunca.
 */
export function professionalTone(text) {
  const keepCase = (m, word) => (m === m.toUpperCase() && m.length > 1 ? word.toUpperCase() : m[0] === m[0].toUpperCase() ? word[0].toUpperCase() + word.slice(1) : word);
  return String(text)
    .replace(/\b(beijinhos|beijos|bjss*|bjos)\b/gi, (m) => keepCase(m, 'abraços'))
    .replace(/\b(beijinho|beijão|beijo|bjo|bj)\b/gi, (m) => keepCase(m, 'abraço'))
    .replace(/abraço\s+e\s+(um\s+)?abraço/gi, 'abraço')
    .replace(/\s*[\u{1F618}\u{1F617}\u{1F619}\u{1F61A}\u{1F48B}]\uFE0F?/gu, '')
    .replace(/[ \t]*,?[ \t]*\bcom (muito |todo |bastante |um )?carinho\b(?=[\s,.!?;:]|$)/gi, '')
    .replace(/[ \t]*\bcarinhosamente\b/gi, '')
    .replace(/[ \t]+([,.!?;:])/g, '$1')
    .replace(/([.!?])\s*([.!?])+(?=\s|$)/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
