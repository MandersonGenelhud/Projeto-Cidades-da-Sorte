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
export function byAttendant({ conversations, leads, users, lineOwner, findLead }) {
  const buckets = new Map();
  const bucket = (id, name, kind) => {
    if (!buckets.has(id)) buckets.set(id, { id, name, kind, funnel: emptyFunnel(), sources: new Map(), conversations: [] });
    return buckets.get(id);
  };
  for (const u of users) if (u.active !== false) bucket(u.id, u.name, u.role === 'admin' ? 'admin' : 'vendedor');
  bucket('main', 'Número principal (Marcos)', 'canal');
  bucket('ig', 'Instagram (ainda sem vendedor)', 'canal');

  const leadBucket = (lead) => {
    if (lead.ownerId && buckets.has(lead.ownerId)) return lead.ownerId;
    return /instagram/.test(lead.source || '') ? 'ig' : 'main';
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
    const line = lineOwner(c.key);
    let id;
    if (line) id = line.ownerId && buckets.has(line.ownerId) ? line.ownerId : bucket(`line:${line.label}`, line.label || 'Número da equipe', 'vendedor').id;
    else {
      const lead = findLead(c);
      id = lead?.ownerId && buckets.has(lead.ownerId) ? lead.ownerId : String(c.key).startsWith('ig:') ? 'ig' : 'main';
    }
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
