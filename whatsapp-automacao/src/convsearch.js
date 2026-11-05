// Busca por palavra nas conversas guardadas (WhatsApp e Instagram, de todos os números): ignora acentos e maiúsculas.
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Procura todas as palavras digitadas (em qualquer ordem) no texto de cada mensagem, no nome e no telefone.
 * `days` limita ao período (0 = todo o período guardado). Devolve as conversas com os trechos encontrados, a mais recente primeiro.
 */
export function searchConversations(convs, { q = '', days = 0, canSee = () => true, now = Date.now(), perConv = 3, limit = 100 } = {}) {
  const words = fold(q).split(/\s+/).filter((w) => w.length >= 2);
  if (!words.length) return { total: 0, items: [] };
  const since = days > 0 ? now - days * 86_400_000 : 0;
  const items = [];
  for (const c of convs) {
    if (!c || c.simulation || !canSee(c)) continue;
    const head = fold(`${c.name || ''} ${c.phone || ''} ${c.username || ''}`);
    const hits = [];
    let count = 0;
    for (const m of c.messages || []) {
      const t = Date.parse(m.at || '') || 0;
      if (since && t && t < since) continue;
      const text = fold(m.content);
      if (!text || !words.every((w) => text.includes(w) || head.includes(w))) continue;
      count += 1;
      if (hits.length < perConv) {
        const i = Math.max(0, text.indexOf(words.find((w) => text.includes(w)) || words[0]) - 40);
        const raw = String(m.content);
        hits.push({ role: m.role, at: m.at || null, snippet: `${i > 0 ? '…' : ''}${raw.slice(i, i + 160).replace(/\s+/g, ' ')}${raw.length > i + 160 ? '…' : ''}` });
      }
    }
    if (!count) continue;
    const last = hits.length ? (c.messages || []).at(-1)?.at || c.updatedAt || '' : '';
    items.push({ key: c.key, name: c.name || '', phone: c.phone || '', username: c.username || '', matches: count, hits, lastAt: last || c.updatedAt || '' });
  }
  items.sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)));
  return { total: items.length, items: items.slice(0, limit) };
}
