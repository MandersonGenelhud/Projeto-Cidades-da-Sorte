// Junta os dados de duas instalações (ex.: o computador e a VPS) SEM apagar nada da instalação de destino:
// só acrescenta o que existe na origem e falta no destino (clientes, conversas, mensagens, vendas, pagamentos, equipe...).
// O que já existe no destino (configurações, chaves, registros com o mesmo id) fica como está.

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const keyOf = (item) => {
  if (!isObj(item)) return JSON.stringify(item);
  if (item.id !== undefined) return `id:${item.id}`;
  if (item.phone && 'name' in item) return `phone:${item.phone}`; // contatos
  return JSON.stringify(item);
};
const msgKey = (m) => `${m?.role || ''}|${m?.at || m?.timestamp || ''}|${String(m?.content ?? m?.text ?? '').slice(0, 120)}`;
const msgTime = (m) => Date.parse(m?.at || '') || Number(m?.timestamp) || 0;

/** Soma ao `target` o que falta, vindo de `source`. Devolve o contador do que foi acrescentado. */
export function mergeData(target, source, stats = { added: {} }, path = '') {
  const count = (where, n = 1) => { stats.added[where] = (stats.added[where] || 0) + n; };
  for (const [k, sv] of Object.entries(source || {})) {
    const where = path ? `${path}.${k}` : k;
    if (path === '' && ['settings', 'logs'].includes(k)) {
      // Configurações: só entram chaves que não existem no destino. Registros (logs) não são trazidos.
      if (k === 'settings') target.settings = fillMissing(target.settings || {}, sv, stats, 'settings');
      continue;
    }
    const tv = target[k];
    if (tv === undefined || tv === null) { target[k] = sv; count(where, Array.isArray(sv) ? sv.length : isObj(sv) ? Object.keys(sv).length : 1); continue; }
    if (Array.isArray(tv) && Array.isArray(sv)) {
      // Mensagens de uma conversa: junta sem repetir e deixa em ordem de horário.
      if (k === 'messages') {
        const have = new Set(tv.map(msgKey));
        const extra = sv.filter((m) => !have.has(msgKey(m)));
        if (extra.length) { tv.push(...extra); tv.sort((a, b) => msgTime(a) - msgTime(b)); count(where, extra.length); }
        continue;
      }
      const have = new Set(tv.map(keyOf));
      const extra = sv.filter((x) => !have.has(keyOf(x)));
      if (extra.length) { tv.push(...extra); count(where, extra.length); }
      continue;
    }
    if (isObj(tv) && isObj(sv)) { mergeData(tv, sv, stats, where); continue; }
    // escalares: o destino manda
  }
  return stats;
}

/** Só acrescenta o que falta (recursivo), sem mexer no que já está. */
function fillMissing(target, source, stats, path) {
  for (const [k, sv] of Object.entries(source || {})) {
    if (target[k] === undefined || target[k] === null) { target[k] = sv; stats.added[path] = (stats.added[path] || 0) + 1; }
    else if (isObj(target[k]) && isObj(sv)) fillMissing(target[k], sv, stats, `${path}.${k}`);
  }
  return target;
}
