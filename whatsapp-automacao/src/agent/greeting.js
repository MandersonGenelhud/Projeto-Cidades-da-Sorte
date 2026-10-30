// Saudação certa pelo horário (regra da Migra):
// 00:00–12:59 bom dia · 13:00–18:59 boa tarde · 19:00–23:59 boa noite.
export function greetingFor(now = new Date()) {
  const h = now.getHours();
  if (h < 13) return 'bom dia';
  if (h < 19) return 'boa tarde';
  return 'boa noite';
}

/** Troca "bom dia / boa tarde / boa noite" errados pela saudação de agora, mantendo maiúsculas. */
export function fixGreeting(text, now = new Date()) {
  const right = greetingFor(now);
  return String(text).replace(/\b(bom\s+dia|boa\s+tarde|boa\s+noite)\b/gi, (m) => {
    if (m === m.toUpperCase()) return right.toUpperCase();
    if (m[0] === m[0].toUpperCase()) return right[0].toUpperCase() + right.slice(1);
    return right;
  });
}

/**
 * Tom profissional: troca "beijo/beijinho/bjs" por "abraço" e tira emojis de beijo,
 * mesmo que a IA escorregue (a mensagem pode ir para alguém casado).
 */
export function professionalTone(text) {
  const keepCase = (m, word) => (m === m.toUpperCase() && m.length > 1 ? word.toUpperCase() : m[0] === m[0].toUpperCase() ? word[0].toUpperCase() + word.slice(1) : word);
  return String(text)
    .replace(/\b(beijinhos|beijos|bjss*|bjos)\b/gi, (m) => keepCase(m, 'abraços'))
    .replace(/\b(beijinho|beijão|beijo|bjo|bj)\b/gi, (m) => keepCase(m, 'abraço'))
    .replace(/\s*[\u{1F618}\u{1F617}\u{1F619}\u{1F61A}\u{1F48B}]\uFE0F?/gu, '')
    .replace(/abraço\s+e\s+(um\s+)?abraço/gi, 'abraço');
}
