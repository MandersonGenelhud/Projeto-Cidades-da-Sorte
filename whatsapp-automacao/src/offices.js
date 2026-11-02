// Escritórios: o mesmo sistema atende dois escritórios separados (Paraguai e Paraná).
// Administrador (Marcos e Manderson) enxerga os dois; cada equipe só enxerga o próprio escritório.
// Padrão seguro: o que não tem escritório marcado é do Paraguai (onde o sistema sempre funcionou).
export const OFFICE_IDS = ['py', 'pr'];
export const DEFAULT_OFFICES = [
  { id: 'py', name: 'Migra Paraguai', place: 'Paraguai' },
  { id: 'pr', name: 'Migra Paraná', place: 'Paraná' },
];
export const normOffice = (v) => (OFFICE_IDS.includes(v) ? v : null);
/** Administrador geral: vê os dois escritórios. */
export const isGlobal = (u) => Boolean(u) && u.role === 'admin';
export const officeOfUser = (u) => normOffice(u?.office) || 'py';
/** O usuário pode ver coisas deste escritório? */
export const sees = (user, office) => isGlobal(user) || officeOfUser(user) === (normOffice(office) || 'py');
/** Lista de escritórios com os nomes que o administrador definiu. */
export const officeList = (settings) => DEFAULT_OFFICES.map((o) => ({ ...o, ...(settings?.offices?.[o.id] ? { name: settings.offices[o.id].name || o.name, place: settings.offices[o.id].place || o.place } : {}) }));
