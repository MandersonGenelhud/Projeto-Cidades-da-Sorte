// Ritmo humano: quanto tempo uma pessoa levaria para ver, ler e digitar.
import { randomBetween } from './utils.js';

export const DEFAULT_HUMANIZE = {
  enabled: true,
  noticeMin: 5, // segundos até "ver" a mensagem
  noticeMax: 20,
  quietSeconds: 6, // espera o cliente parar de mandar mensagens
  maxWaitSeconds: 60, // nunca espera mais que isso para começar
  typingCharsPerSecond: 7, // ~ 80 palavras por minuto no celular
  maxTypingSeconds: 25, // limite do "digitando…" por mensagem
  splitMessages: true, // ideias separadas viram mensagens separadas
};

export const humanizeConfig = (cfg) => ({ ...DEFAULT_HUMANIZE, ...(cfg || {}) });

/** Tempo até perceber a mensagem (aleatório, como alguém olhando o celular). */
export function noticeDelayMs(cfg) {
  const c = humanizeConfig(cfg);
  return randomBetween(c.noticeMin * 1000, c.noticeMax * 1000);
}

/** Tempo de leitura, com calma: ~ 12 caracteres por segundo, entre 2 e 9 segundos. */
export function readingTimeMs(text) {
  const chars = String(text || '').length;
  return Math.min(9000, Math.max(2000, Math.round((chars / 12) * 1000)));
}

/** Tempo digitando uma mensagem, com variação para não parecer cronometrado. */
export function typingTimeMs(text, cfg) {
  const c = humanizeConfig(cfg);
  const chars = String(text || '').length;
  const base = (chars / Math.max(1, c.typingCharsPerSecond)) * 1000;
  const jitter = base * (randomBetween(-15, 20) / 100);
  return Math.min(c.maxTypingSeconds * 1000, Math.max(1500, Math.round(base + jitter)));
}

/** Parágrafo comprido vira duas mensagens, quebrando no fim de uma frase. */
function splitLong(p, limit = 200) {
  if (p.length <= limit || p.includes('http')) return [p];
  const sentences = p.match(/[^.!?…]+[.!?…]+["”)]*\s*|[^.!?…]+$/g) || [p];
  if (sentences.length < 2) return [p];
  let first = '';
  let i = 0;
  while (i < sentences.length - 1 && (first + sentences[i]).length <= p.length / 2 + 40) first += sentences[i++];
  if (!first) first = sentences[i++];
  const rest = sentences.slice(i).join('').trim();
  return rest ? [first.trim(), rest] : [first.trim()];
}

/**
 * Divide a resposta em mensagens curtas, picadas, como uma pessoa faria:
 * cada parágrafo (separado por linha em branco) vira uma mensagem, e parágrafo
 * comprido é quebrado no fim de uma frase. No máximo `max` mensagens.
 */
export function splitIntoBubbles(text, max = 4) {
  const parts = String(text || '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => splitLong(p));
  if (parts.length <= max) return parts.length ? parts : [String(text || '').trim()];
  return [...parts.slice(0, max - 1), parts.slice(max - 1).join('\n\n')];
}
