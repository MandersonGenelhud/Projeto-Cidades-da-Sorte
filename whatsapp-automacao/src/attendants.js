// Visão por atendente: separa as conversas e os prospectos de cada pessoa (e do
// número principal e do Instagram) e monta o funil de cada uma: conversas →
// prospectos → em contato → proposta → fechados, mais "de onde veio" cada cliente.
import { sourceLabel } from './crm.js';

const REACHED_CONTACT = new Set(['em_contato', 'proposta', 'aguardando', 'ganho']);
const REACHED_PROPOSAL = new Set(['proposta', 'ganho']);
const MAX_ITEMS = 60;

const emptyFunnel = () => ({ conversas: 0, prospectos: 0, contato: 0, proposta: 0, fechados: 0, perdidos: 0, valorFechado: 0 });
function addLead(f, lead) {
  f.prospectos += 1;
  if (REACHED_CONTACT.has(lead.stage)) f.contato += 1;
  if (REACHED_PROPOSAL.has(lead.stage)) f.proposta += 1;
  if (lead.stage === 'ganho') { f.fechados += 1; f.valorFechado += Number(lead.closedValue || 0); }
  if (lead.stage === 'perdido') f.perdidos += 1;
}

/**
 * conversations: lista de listConversations(); leads: crm.leads; users: auth users ativos;
 * lineOwner(key) → { ownerId, label } | null (conversa de número de vendedor); findLead(conv) → lead | null.
 */
/** De quem é esta conversa? id do atendente (ou 'triagem' enquanto a IA ainda não direcionou). */
export function attendantOf(c, { ids, lineOwner, findLead }) {
  const line = lineOwner(c.key);
  if (line) return line.ownerId && ids.has(line.ownerId) ? line.ownerId : `line:${line.label}`;
  const lead = findLead(c);
  return lead?.ownerId && ids.has(lead.ownerId) ? lead.ownerId : 'triagem';
}

export function byAttendant({ conversations, leads, users, lineOwner, findLead }) {
  const buckets = new Map();
  const bucket = (id, name, kind) => {
    if (!buckets.has(id)) buckets.set(id, { id, name, kind, funnel: emptyFunnel(), sources: new Map(), conversations: [] });
    return buckets.get(id);
  };
  for (const u of users) if (u.active !== false) bucket(u.id, u.name, u.role === 'admin' ? 'admin' : 'vendedor');
  // Toda conversa vai para um atendente. Só fica aqui quem acabou de chegar e a IA ainda está
  // conversando para descobrir o assunto (terreno → Diego, migração → equipe, veículo → Marcos).
  bucket('triagem', 'IA conversando (ainda não direcionada)', 'canal');

  const leadBucket = (lead) => {
    if (lead.ownerId && buckets.has(lead.ownerId)) return lead.ownerId;
    return 'triagem';
  };
  for (const lead of leads) {
    const b = buckets.get(leadBucket(lead));
    addLead(b.funnel, lead);
    const label = sourceLabel(lead.source);
    const s = b.sources.get(label) || { label, leads: 0, fechados: 0 };
    s.leads += 1;
    if (lead.stage === 'ganho') s.fechados += 1;
    b.sources.set(label, s);
  }
  for (const c of conversations) {
    const ids = new Set(users.map((u) => u.id));
    let id = attendantOf(c, { ids, lineOwner, findLead });
    if (id.startsWith('line:')) id = bucket(id, id.slice(5) || 'Número da equipe', 'vendedor').id;
    const b = buckets.get(id);
    b.funnel.conversas += 1;
    if (b.conversations.length < MAX_ITEMS) {
      b.conversations.push({
        key: c.key, name: c.name || '', phone: c.phone || '', channel: String(c.key).startsWith('ig:') ? 'ig' : 'wa', handoff: Boolean(c.handoff),
        updatedAt: c.updatedAt, count: c.count, lastRole: c.last?.role || '', lastText: String(c.last?.content || '').slice(0, 140),
      });
    }
  }
  const out = [...buckets.values()].map((b) => ({ ...b, sources: [...b.sources.values()].sort((x, y) => y.leads - x.leads) }));
  // Só mostra quem tem movimento ou é pessoa da equipe; canais vazios somem.
  const shown = out.filter((b) => b.kind !== 'canal' || b.funnel.conversas || b.funnel.prospectos);
  const total = emptyFunnel();
  for (const b of shown) for (const k of Object.keys(total)) total[k] += b.funnel[k];
  const sources = new Map();
  for (const b of shown) for (const s of b.sources) {
    const t = sources.get(s.label) || { label: s.label, leads: 0, fechados: 0 };
    t.leads += s.leads; t.fechados += s.fechados;
    sources.set(s.label, t);
  }
  const rank = { admin: 0, vendedor: 1, canal: 2 };
  shown.sort((a, b) => rank[a.kind] - rank[b.kind] || b.funnel.conversas - a.funnel.conversas);
  return { attendants: shown, total, sources: [...sources.values()].sort((x, y) => y.leads - x.leads) };
}

const BOARD_ITEMS = 40;

/**
 * Um QUADRO por pessoa da equipe (e um para a IA ainda sem direcionar e um para cada número da equipe sem dono), cada um com as suas
 * conversas e "como está respondendo": quantos clientes esperam resposta, quanto tempo o mais antigo espera e quantas estão com humano.
 * conversations: listConversations(); users: auth.users; lineOwner(key); findLead(conv); now: Date.
 */
export function conversationBoards({ conversations, users, lineOwner, findLead, now = new Date() }) {
  const active = users.filter((u) => u.active !== false);
  const ids = new Set(active.map((u) => u.id));
  const boards = new Map();
  const board = (id, name, kind) => {
    if (!boards.has(id)) boards.set(id, { id, name, kind, total: 0, waiting: 0, human: 0, answered: 0, oldestWaitMin: 0, items: [] });
    return boards.get(id);
  };
  board('triagem', 'IA ainda sem direcionar (número principal)', 'canal');
  for (const u of active) board(u.id, u.name, u.role === 'admin' ? 'admin' : 'vendedor');
  for (const c of conversations) {
    let id = attendantOf(c, { ids, lineOwner, findLead });
    if (id.startsWith('line:')) id = board(id, id.slice(5) || 'WhatsApp da equipe', 'equipe').id;
    const b = boards.get(id);
    const waiting = c.last?.role === 'user' && !c.handoff;
    const waitMin = waiting ? Math.max(0, Math.round((now.getTime() - Date.parse(c.updatedAt)) / 60_000)) : 0;
    b.total += 1;
    if (c.handoff) b.human += 1;
    if (waiting) { b.waiting += 1; b.oldestWaitMin = Math.max(b.oldestWaitMin, waitMin); } else b.answered += 1;
    b.items.push({
      key: c.key, name: c.name || '', phone: c.phone || '', channel: String(c.key).startsWith('ig:') ? 'ig' : 'wa', handoff: Boolean(c.handoff),
      state: c.handoff ? 'humano' : waiting ? 'aguardando' : 'respondida', waitMin, updatedAt: c.updatedAt, count: c.count,
      lastRole: c.last?.role || '', lastText: String(c.last?.content || '').replace(/\s+/g, ' ').slice(0, 140),
    });
  }
  const rank = { canal: 0, admin: 1, vendedor: 2, equipe: 3 };
  return [...boards.values()]
    .map((b) => ({ ...b, shown: Math.min(b.items.length, BOARD_ITEMS), items: b.items.sort((x, y) => String(y.updatedAt).localeCompare(String(x.updatedAt))).slice(0, BOARD_ITEMS) }))
    .filter((b) => b.kind !== 'equipe' || b.total)
    .sort((a, b) => rank[a.kind] - rank[b.kind] || b.waiting - a.waiting || b.total - a.total || a.name.localeCompare(b.name));
}
