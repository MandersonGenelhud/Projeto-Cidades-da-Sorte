// Configuração de envio POR NÚMERO (principal, Instagram e o WhatsApp de cada vendedor): limite por hora, limite por dia,
// intervalo entre respostas, horário de envio e ritmo humano ("vendo", lendo e digitando). Cada número usa o seu próprio perfil;
// o que não for definido herda o padrão geral da aba Agente IA. Um número nunca divide o limite com outro.
import { parseLineKey } from './lines.js';

/** De qual número sai a resposta: cada WhatsApp (principal, cada vendedor, Instagram) tem o seu próprio limite e ritmo. */
export const senderOf = (jid) => {
  const l = parseLineKey(String(jid || ''));
  if (l) return `linha:${l.id}`;
  return String(jid || '').startsWith('ig:') ? 'instagram' : 'principal';
};

const num = (v, min, max) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw Object.assign(new Error('Use só números nas configurações de envio'), { status: 400 });
  return Math.min(max, Math.max(min, n));
};

/** Valida o que veio do painel. Campo vazio = volta a usar o padrão geral. */
export function cleanProfile(input = {}) {
  const out = {
    perHour: num(input.perHour, 1, 200),
    dailyLimit: num(input.dailyLimit, 0, 2000), // 0 = sem limite diário
    minGapSec: num(input.minGapSec, 0, 600),
    maxGapSec: num(input.maxGapSec, 0, 1800),
    from: num(input.from, 0, 23),
    to: num(input.to, 1, 24),
    noticeMin: num(input.noticeMin, 0, 120),
    noticeMax: num(input.noticeMax, 0, 300),
    typingCharsPerSecond: num(input.typingCharsPerSecond, 2, 20),
    maxTypingSeconds: num(input.maxTypingSeconds, 2, 60),
  };
  if (out.minGapSec !== null && out.maxGapSec !== null && out.maxGapSec < out.minGapSec) out.maxGapSec = out.minGapSec;
  if (out.noticeMin !== null && out.noticeMax !== null && out.noticeMax < out.noticeMin) out.noticeMax = out.noticeMin;
  if (out.from !== null && out.to !== null && out.to <= out.from) throw Object.assign(new Error('O horário final precisa ser depois do inicial'), { status: 400 });
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== null));
}

/** Perfil efetivo de um número: o dele por cima do padrão geral. delay = [min, max] padrão da fila (segundos). */
export function profileFor(settings, sender, { delay = [0, 0] } = {}) {
  const a = settings?.agent || {};
  const own = settings?.sendProfiles?.[sender] || {};
  const [gFrom, gTo] = String(a.pendingHours || '7-21').split('-').map(Number);
  const from = own.from ?? (Number.isFinite(gFrom) ? gFrom : 7);
  const to = own.to ?? (Number.isFinite(gTo) ? gTo : 21);
  const minGap = own.minGapSec ?? delay[0];
  const maxGap = Math.max(minGap, own.maxGapSec ?? delay[1]);
  const humanize = { ...(a.humanize || {}) };
  for (const k of ['noticeMin', 'noticeMax', 'typingCharsPerSecond', 'maxTypingSeconds']) if (own[k] !== undefined) humanize[k] = own[k];
  return {
    perHour: Math.max(1, own.perHour ?? (Number(a.pendingPerHour) || 30)), dailyLimit: own.dailyLimit ?? 0,
    from, to, gap: [minGap, maxGap], humanize, custom: Object.keys(own).length > 0,
  };
}
