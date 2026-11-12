// "O cliente chama o vendedor": a Central entrega ao cliente um link que abre o WhatsApp do vendedor com a mensagem pronta (com o código do cliente).
// Assim a conversa no número do vendedor nasce do CLIENTE (o número do vendedor não "dispara" para gente nova, menor risco de bloqueio).
// Tempos de retomada (pesquisa: MIT/InsideSales 2007 e Harvard Business Review 2011 mostram que a chance de falar com o lead cai muito depois de
// 5 a 30 minutos e que agir dentro da 1ª hora qualifica ~7x mais; no WhatsApp, a janela de 24 h desde a última mensagem do cliente é o limite e o
// recomendado é no máximo 2 lembretes):
//   +15 min sem o cliente chamar  → 1º lembrete da Central (com o mesmo link)
//   +60 min sem chamar            → aviso ao vendedor para decidir se chama ele mesmo (ainda dentro da 1ª hora)
//   +20 h (antes de fechar as 24 h) → 2º e último lembrete da Central
// Lembretes só saem em horário comercial (8h às 20h no Paraguai); fora dele, esperam (e o último só sai se ainda estiver dentro das 24 h).
export const LINK_TIMES = { remind1Min: 15, sellerAlertMin: 60, remind2Min: 20 * 60, windowMin: 23.5 * 60 };

/** Link que abre o WhatsApp do vendedor com a mensagem pronta. */
export function sellerWaLink({ sellerPhone, sellerName = '', code = '' }) {
  const phone = String(sellerPhone || '').replace(/\D/g, '');
  if (!phone) return '';
  const first = String(sellerName || '').trim().split(/\s+/)[0];
  const text = `Olá${first ? ` ${first}` : ''}, vim pela Central da Migra.${code ? ` Meu código é ${code}.` : ''}`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

/**
 * O que fazer agora com um encaminhamento por link. h = handoff do prospecto ({ linkAt, arrivedAt, remind1At, sellerAlertAt, remind2At }).
 * inHours = está em horário comercial agora. Devolve 'remind1' | 'sellerAlert' | 'remind2' | ''.
 */
export function nextLinkAction(h, { now = Date.now(), inHours = true, times = LINK_TIMES } = {}) {
  if (!h?.linkAt || h.arrivedAt) return '';
  const age = (now - new Date(h.linkAt).getTime()) / 60_000;
  if (age >= times.windowMin) return '';
  if (age >= times.sellerAlertMin && !h.sellerAlertAt) return 'sellerAlert'; // aviso ao vendedor sai a qualquer hora (é para a equipe)
  if (!inHours) return '';
  if (age >= times.remind2Min && !h.remind2At) return 'remind2';
  if (age >= times.remind1Min && !h.remind1At && age < times.remind2Min) return 'remind1';
  return '';
}

export const remindText = (first, link, last = false) => (last
  ? `Oi! Passando só para não deixar você sem atendimento: ${first || 'nossa consultora'} continua à disposição. Quando puder, é só tocar aqui: ${link}`
  : `Oi! Só para lembrar: ${first || 'nossa consultora'} já está te esperando. É só tocar aqui para falar direto: ${link}`);
