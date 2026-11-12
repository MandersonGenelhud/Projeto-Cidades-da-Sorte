// Resgate: as conversas que ficaram no número principal (que parou de funcionar) para o dono continuar PELO Hub, respondendo por outro número conectado.
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const texts = (c) => (c.messages || []).filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim());

/** Conversas do número principal (sem linhas, grupos, Instagram e simulações), da mais recente para a mais antiga. q procura em nome, telefone e no texto. */
export function listRescue(all, { q = '', limit = 300 } = {}) {
  const needle = fold(q).trim();
  const out = [];
  for (const c of Object.values(all || {})) {
    const key = String(c?.key || '');
    if (!c || c.simulation || key.startsWith('sim:') || key.startsWith('ig:') || key.startsWith('l:') || key.includes('@g.us')) continue;
    const base = c.rescuedKey ? all[c.rescuedKey] || c : c;
    const m = texts(base);
    if (!m.length) continue;
    if (needle && !fold(`${c.name} ${c.phone} ${m.map((x) => x.content).join(' ')}`).includes(needle)) continue;
    const last = m.at(-1);
    out.push({ key, name: c.name || '', phone: c.phone || key.replace(/\D/g, ''), last: String(last.content).slice(0, 140), lastRole: last.role, lastAt: last.at || c.updatedAt || '', count: m.length, rescued: Boolean(c.rescuedKey), answered: Boolean(c.rescuedKey) && last.role === 'user' });
  }
  return out.sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt))).slice(0, limit);
}

/** A conversa inteira para mostrar: a nova (do número onde o dono respondeu), que já traz o histórico copiado; senão a antiga. */
export function rescueThread(all, key) {
  const old = all?.[key];
  if (!old) return null;
  const cur = old.rescuedKey ? all[old.rescuedKey] || old : old;
  return { key, rescuedKey: old.rescuedKey || null, name: old.name || cur.name || '', phone: old.phone || key.replace(/\D/g, ''), messages: texts(cur).map((m) => ({ role: m.role, by: m.by || '', text: m.content, at: m.at || '' })) };
}

/** Copia o histórico para a conversa do número novo (a IA e o dono passam a ver o contexto) e marca a conversa como assumida pelo dono (a IA não puxa conversa). */
export function seedRescued(oldConv, newConv, { keep = 30, now = new Date() } = {}) {
  if (!newConv.messages?.length) newConv.messages = texts(oldConv).slice(-keep).map((m) => ({ ...m }));
  newConv.phone ||= oldConv.phone || String(oldConv.key).replace(/\D/g, '');
  newConv.name ||= oldConv.name || '';
  newConv.rescuedFrom = oldConv.key;
  newConv.humanSpokeAt = now.toISOString();
  oldConv.rescuedKey = newConv.key;
  oldConv.rescuedAt = oldConv.rescuedAt || now.toISOString();
  return newConv;
}
