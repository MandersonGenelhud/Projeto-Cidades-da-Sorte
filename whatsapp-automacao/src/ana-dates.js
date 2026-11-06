// Datas e horas ditas em português ("amanhã às 14h", "dia 15", "daqui a 2 anos", "15 de dezembro de 2027").
// Usado pela Ana quando a IA não está disponível (ou para conferir o que a IA devolveu).
// Tudo é calculado no relógio local do servidor (TZ do Docker = America/Sao_Paulo) e devolvido como texto: AAAA-MM-DD e HH:MM.

const MONTHS = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const WEEKDAYS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
export const WEEKDAY_LABELS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
export const MAX_YEARS_AHEAD = 5;

/** Minúsculas e sem acento, mantendo o MESMO tamanho do texto (para cortar o título no lugar certo). */
export const fold1 = (s) => [...String(s ?? '')].map((c) => c.normalize('NFD')[0]).join('').toLowerCase();
const pad = (n) => String(n).padStart(2, '0');
export const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromIso = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return new Date(y, m - 1, d); };
export const dBr = (iso) => String(iso || '').split('-').reverse().join('/');
export const weekdayOf = (iso) => WEEKDAY_LABELS[fromIso(iso).getDay()];
export const addDays = (iso, n) => { const d = fromIso(iso); d.setDate(d.getDate() + n); return isoOf(d); };
/** Soma meses mantendo o dia (31 em mês de 30 dias vira o último dia do mês). */
export function addMonths(iso, n) {
  const d = fromIso(iso);
  const day = d.getDate();
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(day, last));
  return isoOf(t);
}
export const validIso = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(String(iso)) && isoOf(fromIso(iso)) === iso;
export const validTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t));

/**
 * { date, time, spans } do que a frase diz. Sem pista, date/time ficam vazios.
 * `spans` são os trechos [início, fim) do texto original que falam de data/hora (para tirar do título).
 */
export function parseWhenPt(text, now = new Date()) {
  const raw = String(text ?? '');
  const n = fold1(raw);
  const today = isoOf(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  const spans = [];
  let date = '';
  let time = '';
  const take = (m) => { if (m) spans.push([m.index, m.index + m[0].length]); return m; };

  // ---- hora
  let m;
  if ((m = take(n.match(/\b(?:as\s+)?(\d{1,2})\s*(?:h|hs|horas?)\s*(\d{2})?\b(?:\s+da\s+(manha|tarde|noite|madrugada))?/)))
    || (m = take(n.match(/\b(?:as\s+)?(\d{1,2}):(\d{2})\b(?:\s+da\s+(manha|tarde|noite|madrugada))?/)))
    || (m = take(n.match(/\bas\s+(\d{1,2})\b(?:\s+da\s+(manha|tarde|noite|madrugada))?(?!\s*(?:reais|real|r\$|%|de\s+(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)))/)))) {
    let hh = Number(m[1]);
    const mm = /^\d{2}$/.test(m[2] || '') ? Number(m[2]) : 0;
    const part = [m[2], m[3]].find((x) => /^(manha|tarde|noite|madrugada)$/.test(x || ''));
    if ((part === 'tarde' || part === 'noite') && hh < 12) hh += 12;
    if (hh <= 23 && mm <= 59) time = `${pad(hh)}:${pad(mm)}`;
  } else if ((m = take(n.match(/\bmeio[-\s]?dia\b/)))) time = '12:00';
  else if ((m = take(n.match(/\bmeia[-\s]?noite\b/)))) time = '00:00';

  const addSpan = (re) => { const x = n.match(re); if (x) spans.push([x.index, x.index + x[0].length]); return x; };

  // ---- data
  let x;
  if ((x = addSpan(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
    const d = Number(x[1]); const mo = Number(x[2]);
    let y = x[3] ? Number(x[3]) : now.getFullYear();
    if (y < 100) y += 2000;
    let cand = `${y}-${pad(mo)}-${pad(d)}`;
    if (validIso(cand) && !x[3] && cand < today) cand = `${y + 1}-${pad(mo)}-${pad(d)}`;
    if (validIso(cand)) date = cand;
  } else if ((x = addSpan(new RegExp(`\\b(?:dia\\s+)?(\\d{1,2})\\s+de\\s+(${MONTHS.join('|')})(?:\\s+de\\s+(\\d{4}))?\\b`)))) {
    const d = Number(x[1]); const mo = MONTHS.indexOf(x[2]) + 1;
    const y = x[3] ? Number(x[3]) : now.getFullYear();
    let cand = `${y}-${pad(mo)}-${pad(d)}`;
    if (validIso(cand) && !x[3] && cand < today) cand = `${y + 1}-${pad(mo)}-${pad(d)}`;
    if (validIso(cand)) date = cand;
  } else if ((x = addSpan(/\b(?:daqui\s+a|daqui|em|dentro\s+de)\s+(\d{1,3})\s+(dias?|semanas?|mes(?:es)?|anos?)\b/))) {
    const q = Number(x[1]);
    const u = x[2];
    date = /^dia/.test(u) ? addDays(today, q) : /^semana/.test(u) ? addDays(today, q * 7) : /^mes/.test(u) ? addMonths(today, q) : addMonths(today, q * 12);
  } else if (addSpan(/\bdepois\s+de\s+amanha\b/)) date = addDays(today, 2);
  else if (addSpan(/\bamanha\b/)) date = addDays(today, 1);
  else if (addSpan(/\bhoje\b/)) date = today;
  else if (addSpan(/\b(?:no\s+)?ano\s+que\s+vem\b|\bproximo\s+ano\b/)) date = addMonths(today, 12);
  else if (addSpan(/\b(?:no\s+)?mes\s+que\s+vem\b|\bproximo\s+mes\b/)) date = addMonths(today, 1);
  else if (addSpan(/\bsemana\s+que\s+vem\b|\bproxima\s+semana\b/)) date = addDays(today, 7);
  else if ((x = addSpan(new RegExp(`\\b(?:na\\s+|no\\s+|proxima\\s+|proximo\\s+)?(${WEEKDAYS.join('|')})(?:-feira)?(?:\\s+que\\s+vem)?\\b`)))) {
    const target = WEEKDAYS.indexOf(x[1]);
    let diff = (target - now.getDay() + 7) % 7;
    if (diff === 0) diff = 7; // "na sexta" dito numa sexta é a próxima
    date = addDays(today, diff);
  } else if ((x = addSpan(/\bdia\s+(\d{1,2})\b/))) {
    const d = Number(x[1]);
    let cand = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(d)}`;
    if (!validIso(cand) || cand < today) {
      const nm = addMonths(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, 1);
      cand = `${nm.slice(0, 8)}${pad(d)}`;
    }
    if (validIso(cand)) date = cand;
  }

  if (date) {
    const limit = addMonths(today, MAX_YEARS_AHEAD * 12);
    if (date > limit) date = '';
  }
  return { date, time, spans: mergeSpans(spans) };
}

function mergeSpans(spans) {
  const s = [...spans].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [a, b] of s) {
    if (out.length && a <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Tira do texto original os trechos de data/hora e as palavras de comando, sobrando o assunto ("reunião com o contador"). */
export function titleFrom(text, spans, { drop = [] } = {}) {
  let out = '';
  let pos = 0;
  const raw = String(text ?? '');
  for (const [a, b] of spans) { out += raw.slice(pos, a); pos = b; }
  out += raw.slice(pos);
  for (const re of drop) out = out.replace(re, ' ');
  return out.replace(/\s+/g, ' ').replace(/^[\s,.:;!-]+|[\s,.:;!-]+$/g, '').replace(/^(de|do|da|que|sobre|para|pra)\s+/i, '').trim();
}

/** "sexta-feira, 06/11" (com o ano quando não é o atual). */
export function dayLabel(iso, now = new Date()) {
  const d = fromIso(iso);
  return `${weekdayOf(iso)}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}${d.getFullYear() !== now.getFullYear() ? `/${d.getFullYear()}` : ''}`;
}
