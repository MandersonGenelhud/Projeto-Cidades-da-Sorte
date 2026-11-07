// Ajustes únicos de equipe, aplicados sozinhos na inicialização (cada um só uma vez).

const first = (u) => String(u?.name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().split(/\s+/)[0].toLowerCase();

/**
 * Nov/2026: o Gabriel saiu da área de corretores. Os atendimentos em aberto dele passam para o Diego.
 * Só marca como feito quando o Diego existe na Equipe (senão tenta de novo na próxima inicialização).
 * Devolve { done, transferred } ou null se já estava feito.
 */
export function moveOldCorretorLeads({ store, auth, crm }) {
  store.data.maintenance ||= {};
  if (store.data.maintenance.gabrielToDiego2026) return null;
  const gab = auth.users.find((u) => first(u) === 'gabriel');
  if (!gab) { store.data.maintenance.gabrielToDiego2026 = true; store.save(); return { done: true, transferred: 0 }; }
  const diego = auth.users.find((u) => first(u) === 'diego' && u.active !== false);
  if (!diego) return { done: false, transferred: 0 };
  const r = crm.transfer({ role: 'admin', name: 'Sistema' }, gab.id, diego.id);
  store.data.maintenance.gabrielToDiego2026 = true;
  store.save();
  return { done: true, transferred: r.transferred, from: gab.name, to: diego.name };
}
