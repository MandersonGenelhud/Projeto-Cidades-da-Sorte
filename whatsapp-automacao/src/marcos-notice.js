// Aviso do número novo do Marcos: a Maria escreve, uma vez, para quem conversava com ele no número antigo (o principal, que caiu),
// com uma saudação curta, o assunto da conversa (quando o sistema sabe) e o link que abre direto o WhatsApp novo dele.
// Quem responder é atendido pela Maria como secretária do Grupo Migra (tira dúvidas e pode vender).
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const MARCOS_NEW = '595982543275';
// Vídeo em que o próprio Marcos explica a troca de número (Instagram). Sem os parâmetros de rastreio do link.
export const MARCOS_VIDEO = 'https://www.instagram.com/reel/DfpZGadT-hW/';

/** Conversas do número antigo do Marcos (o principal) nos últimos `days` dias, com telefone, que ainda não receberam o aviso. */
export function noticeCandidates(conversations, { days = 30, now = Date.now(), done = {}, isTeam = () => false, isBlocked = () => false, leadOf = () => null } = {}) {
  const since = now - days * 86_400_000;
  const out = []; const seen = new Set();
  for (const c of conversations || []) {
    const key = String(c?.key || '');
    if (!c || c.simulation || key.startsWith('l:') || key.startsWith('ig:') || key.startsWith('sim:') || key.includes('@g.us')) continue;
    const phone = String(c.phone || key.split('@')[0]).replace(/\D/g, '');
    if (phone.length < 10 || seen.has(phone) || done[phone]) continue;
    if (new Date(c.updatedAt || 0).getTime() < since) continue;
    if (!(c.messages || []).some((m) => m.role === 'user')) continue; // a pessoa falou com o Marcos
    if (c.declined || isTeam(phone) || isBlocked(phone)) continue;
    seen.add(phone);
    const lead = leadOf(c);
    out.push({ key, phone, name: String(lead?.name || c.name || '').trim(), assunto: topicOf(lead, c), at: c.updatedAt });
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/** Assunto em poucas palavras: o interesse registrado; senão, pistas do que a pessoa falou. Vazio quando não dá para saber. */
export function topicOf(lead, conv) {
  if (lead?.interest) return String(lead.interest).slice(0, 60);
  const said = fold((conv?.messages || []).filter((m) => m.role === 'user').slice(-10).map((m) => m.content).join(' '));
  if (/terreno|lote|apartamento|imovel/.test(said)) return 'imóveis no Paraguai';
  if (/carro|moto|veiculo/.test(said)) return 'veículos';
  if (/residencia|cedula|document|migra|paraguai|ruc|empresa/.test(said)) return 'a sua documentação no Paraguai';
  if (/mentoria/.test(said)) return 'a mentoria';
  return '';
}

export function noticeText({ name = '', assunto = '', link = `https://wa.me/${MARCOS_NEW}`, video = MARCOS_VIDEO } = {}) {
  const first = String(name || '').trim().split(/\s+/)[0];
  const hora = new Date().toLocaleString('en-GB', { timeZone: 'America/Asuncion', hour: '2-digit', hour12: false });
  const saud = Number(hora) < 12 ? 'Bom dia' : Number(hora) < 18 ? 'Boa tarde' : 'Boa noite';
  return [
    `${saud}${first ? `, ${first}` : ''}! Aqui é a Maria, do atendimento do Grupo Migra. O WhatsApp antigo do Marcos parou de funcionar e ele está com um número novo.`,
    video ? `Ele mesmo explicou o que aconteceu neste vídeo no Instagram: ${video}` : '',
    `Como vocês já estavam conversando${assunto ? ` sobre ${assunto}` : ''}, ele pediu para eu te passar o contato novo. Para falar direto com ele, é só tocar aqui: ${link}`,
  ].filter(Boolean).join('\n\n');
}
