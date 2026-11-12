// Exportar conversas guardadas no Migra Hub em um arquivo legível (HTML ou texto), para consulta fora do sistema (ex.: o dono quer rever o que os clientes falaram).
// Só administrador. Contém dados de clientes: o arquivo deve ir só para quem tem direito e ser apagado depois.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const when = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Asuncion', dateStyle: 'short', timeStyle: 'short' }) : '');

/** scope: 'main' (número principal), 'all' (todos, menos grupos e Instagram) | 'line:<id>'. days = só conversas com atividade nos últimos N dias (0 = todas). */
export function pickConversations(all, { scope = 'main', days = 0, now = new Date() } = {}) {
  const since = days > 0 ? now.getTime() - days * 86_400_000 : 0;
  return Object.values(all || {}).filter((c) => {
    const key = String(c?.key || '');
    if (!c || c.simulation || key.startsWith('sim:') || key.includes('@g.us') || key.startsWith('ig:')) return false;
    if (since && new Date(c.updatedAt || 0).getTime() < since) return false;
    if (scope === 'main') return !key.startsWith('l:');
    if (scope.startsWith('line:')) return key.startsWith(`${scope}:`.replace('line:', 'l:'));
    return true;
  }).filter((c) => (c.messages || []).some((m) => typeof m.content === 'string' && m.content.trim())).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

const who = (m, ownerName) => (m.role === 'user' ? 'Cliente' : m.by === 'owner' ? ownerName : m.by === 'human' || m.by === 'seller' ? 'Equipe' : 'Atendente (IA)');
const lines = (c, ownerName) => (c.messages || []).filter((m) => typeof m.content === 'string' && m.content.trim() && (m.role === 'user' || m.role === 'assistant')).map((m) => ({ at: when(m.at), who: who(m, ownerName), text: m.content.trim() }));

export function conversationsToText(list, { ownerName = 'Marcos' } = {}) {
  return `${list.map((c) => `=== ${c.name || 'Sem nome'}${c.phone ? ` · +${c.phone}` : ''} ===\n${lines(c, ownerName).map((l) => `[${l.at}] ${l.who}: ${l.text}`).join('\n')}`).join('\n\n')}\n`;
}

export function conversationsToHtml(list, { ownerName = 'Marcos', title = 'Conversas do Migra Hub' } = {}) {
  const body = list.map((c) => `<section><h2>${esc(c.name || 'Sem nome')}${c.phone ? ` <small>+${esc(c.phone)}</small>` : ''}</h2>${lines(c, ownerName).map((l) => `<p class="${l.who === 'Cliente' ? 'c' : 'a'}"><b>${esc(l.who)}</b> <small>${esc(l.at)}</small><br>${esc(l.text).replace(/\n/g, '<br>')}</p>`).join('')}</section>`).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font-family:system-ui,sans-serif;max-width:760px;margin:0 auto;padding:16px;color:#1d1d1f}h1{font-size:20px}h2{font-size:17px;margin:28px 0 6px;border-bottom:1px solid #ddd;padding-bottom:4px}small{color:#777;font-weight:400}p{margin:6px 0;padding:8px 10px;border-radius:10px;max-width:88%}p.c{background:#f1f1f1}p.a{background:#dcf8c6;margin-left:auto}</style></head><body><h1>${esc(title)}</h1><p><small>${list.length} conversa(s). Use Ctrl+F (ou "Buscar na página") para procurar um nome ou assunto. Contém dados de clientes: não compartilhe e apague depois de usar.</small></p>${body}</body></html>`;
}
