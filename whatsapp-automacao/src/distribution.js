// Controle do rodízio e dos fechamentos: para cada vendedor, quantos clientes a central entregou (e por onde chegaram), quantos já foram
// atendidos e em quanto tempo, quantos viraram proposta e contrato, e se o rodízio está sendo justo. Também aponta quem está esperando
// contato (cliente parado) para o vendedor ser lembrado antes de o cliente esfriar. Só lê os dados que o sistema já guarda.

const OPEN = new Set(['novo', 'em_contato', 'proposta', 'aguardando']);
const dayOf = (iso) => String(iso || '').slice(0, 10);
const MIN = 60_000;

/** Como o cliente chegou ao vendedor: rodizio | ia | indicacao | pix | transferencia | manual. */
export function viaOf(e) {
  const v = String(e.via || (/\(([^)]+)\)/.exec(e.text || '')?.[1] ?? '')).toLowerCase();
  if (/rod[ií]zio/.test(v)) return 'rodizio';
  if (/indica/.test(v)) return 'indicacao';
  if (/pix/.test(v)) return 'pix';
  if (/\bia\b|peneira|receio|atendente|escrit[oó]rio/.test(v)) return 'ia';
  return e.fromId ? 'transferencia' : 'manual';
}
export const VIA_LABEL = { rodizio: 'Rodízio', ia: 'IA passou', indicacao: 'Indicação de parceiro', pix: 'Pix não pago', transferencia: 'Transferência', manual: 'Manual' };

/** Todas as entregas de cliente a vendedor (de qualquer data), tiradas da linha do tempo de cada prospecto. */
export function assignments(leads) {
  const out = [];
  for (const lead of leads) for (const e of lead.timeline || []) if (e.type === 'dono' && e.toId) out.push({ at: e.at, toId: e.toId, fromId: e.fromId || null, via: viaOf(e), lead });
  return out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/** Primeira ação do vendedor depois de receber o cliente (anotação, etapa, retorno ou conversa pelo WhatsApp dele). Minutos, ou null. */
function firstActionMin(a, convOf) {
  const t0 = Date.parse(a.at);
  const acts = (a.lead.timeline || []).filter((e) => e.byId === a.toId && e.type !== 'dono' && Date.parse(e.at) > t0).map((e) => Date.parse(e.at));
  const conv = convOf?.(a.lead);
  if (conv?.ownerRepliedAt && conv.ownerRepliedAt > t0) acts.push(conv.ownerRepliedAt);
  if (!acts.length) return null;
  return Math.round((Math.min(...acts) - t0) / MIN);
}

export function distributionReport({ leads, users, rotation = [], sales = [], convOf = () => null, from = '', to = '', now = new Date(), slaHours = 2, days = 14, conversations = 0 }) {
  const inRange = (iso) => (!from || dayOf(iso) >= from) && (!to || dayOf(iso) <= to);
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const rot = new Set(rotation.map((u) => u.id));
  const dayList = Array.from({ length: Math.min(60, Math.max(1, days)) }, (_, i) => dayOf(new Date(now.getTime() - (days - 1 - i) * 86_400_000).toISOString()));
  const rows = new Map();
  const row = (id) => {
    if (!rows.has(id)) rows.set(id, { id, name: nameOf.get(id) || 'Ex-vendedor', inRotation: rot.has(id), received: 0, byVia: {}, attended: 0, noAction: 0, firstMins: [], stillMine: 0, repassado: 0, proposta: 0, ganho: 0, perdido: 0, open: 0, perDay: Object.fromEntries(dayList.map((d) => [d, 0])), waiting: [] });
    return rows.get(id);
  };
  for (const u of users) if (u.active !== false && (rot.has(u.id) || u.role !== 'admin')) row(u.id);

  const all = assignments(leads);
  let totalRodizio = 0;
  for (const a of all) {
    const d = dayOf(a.at);
    if (a.toId && rows.has(a.toId) && d in rows.get(a.toId).perDay) rows.get(a.toId).perDay[d] += 1;
    if (!inRange(a.at)) continue;
    const r = row(a.toId);
    r.received += 1;
    r.byVia[a.via] = (r.byVia[a.via] || 0) + 1;
    if (a.via === 'rodizio') totalRodizio += 1;
    const mine = a.lead.ownerId === a.toId;
    if (!mine) { r.repassado += 1; continue; }
    r.stillMine += 1;
    if (a.lead.stage === 'ganho') r.ganho += 1;
    else if (a.lead.stage === 'perdido') r.perdido += 1;
    else if (a.lead.stage === 'proposta') r.proposta += 1;
    const m = firstActionMin(a, convOf);
    if (m === null) {
      if (OPEN.has(a.lead.stage)) {
        const waitMin = Math.max(0, Math.round((now.getTime() - Date.parse(a.at)) / MIN));
        r.noAction += 1;
        r.waiting.push({ id: a.lead.id, name: a.lead.name || a.lead.phone || 'sem nome', phone: a.lead.phone || '', waitMin, late: waitMin >= slaHours * 60, via: a.via });
      }
    } else { r.attended += 1; r.firstMins.push(m); }
  }
  for (const l of leads) if (OPEN.has(l.stage) && l.ownerId) row(l.ownerId).open += 1;

  // Contratos fechados no período, por vendedor (da aba Contratos/Vendas).
  const contracts = sales.filter((s) => s.status !== 'cancelada' && inRange(s.createdAt)).map((s) => ({ number: s.number, client: s.client?.nome || s.client || '', sellerId: s.sellerId, seller: s.sellerName || nameOf.get(s.sellerId) || '', total: Number(s.total) || 0, at: s.createdAt, received: Number(s.received) || 0 }));
  const closedBy = new Map();
  for (const c of contracts) { const e = closedBy.get(c.sellerId) || { n: 0, v: 0 }; e.n += 1; e.v += c.total; closedBy.set(c.sellerId, e); }

  const sellers = [...rows.values()].map((r) => {
    const c = closedBy.get(r.id) || { n: 0, v: 0 };
    const sorted = [...r.firstMins].sort((x, y) => x - y);
    return {
      id: r.id, name: r.name, inRotation: r.inRotation, received: r.received, byVia: r.byVia, open: r.open,
      attended: r.attended, noAction: r.noAction, attendedPct: r.stillMine ? Math.round((r.attended / r.stillMine) * 100) : null,
      firstActionMedianMin: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
      repassado: r.repassado, proposta: r.proposta, ganho: r.ganho, perdido: r.perdido,
      contracts: c.n, contractsValue: c.v,
      conversionPct: r.received ? Math.round((Math.max(r.ganho, c.n) / r.received) * 100) : null,
      waiting: r.waiting.sort((a, b) => b.waitMin - a.waitMin), perDay: dayList.map((d) => r.perDay[d] || 0),
    };
  }).sort((a, b) => b.received - a.received || a.name.localeCompare(b.name));

  // Rodízio justo: quem está no rodízio deveria ter recebido parecido. Desvio só faz sentido com volume.
  const eligible = sellers.filter((s) => s.inRotation);
  const expected = eligible.length ? totalRodizio / eligible.length : 0;
  for (const s of sellers) {
    const got = s.byVia.rodizio || 0;
    s.fair = s.inRotation && totalRodizio >= 10 ? { got, expected: Math.round(expected * 10) / 10, deviationPct: expected ? Math.round(((got - expected) / expected) * 100) : 0 } : null;
  }
  const created = leads.filter((l) => inRange(l.createdAt)).length;
  const funnel = { conversas: conversations, prospectos: created, entregues: sellers.reduce((n, s) => n + s.received, 0), atendidos: sellers.reduce((n, s) => n + s.attended, 0), propostas: sellers.reduce((n, s) => n + s.proposta + s.ganho, 0), contratos: contracts.length, valor: contracts.reduce((n, c) => n + c.total, 0) };
  const waiting = sellers.flatMap((s) => s.waiting.filter((w) => w.late).map((w) => ({ ...w, sellerId: s.id, seller: s.name }))).sort((a, b) => b.waitMin - a.waitMin);
  return { from, to, days: dayList, slaHours, funnel, sellers, contracts: contracts.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 200), waiting, totalRodizio, viaLabels: VIA_LABEL };
}

/**
 * Cliente parado: entregue ao vendedor e sem nenhuma ação dele depois do prazo (contado só no horário comercial).
 * Devolve quem lembrar (1ª vez) e quem escalar para a administração (2x o prazo). Quem chama grava os selos para não repetir.
 */
export function slaCheck({ leads, convOf = () => null, now = new Date(), slaHours = 2, open = 8, close = 20 }) {
  const startOfCount = (iso) => {
    const d = new Date(iso);
    if (d.getHours() < open) d.setHours(open, 0, 0, 0);
    else if (d.getHours() >= close) { d.setDate(d.getDate() + 1); d.setHours(open, 0, 0, 0); }
    return d.getTime();
  };
  const inHours = now.getHours() >= open && now.getHours() < close && now.getDay() !== 0;
  const out = { nudge: [], escalate: [] };
  if (!inHours) return out;
  const last = new Map(); // prospecto → a entrega mais recente
  for (const a of assignments(leads)) last.set(a.lead.id, a);
  for (const a of last.values()) {
    const l = a.lead;
    if (!OPEN.has(l.stage) || l.ownerId !== a.toId) continue;
    if (firstActionMin(a, convOf) !== null) continue;
    const waited = (now.getTime() - startOfCount(a.at)) / (60 * MIN);
    if (waited >= slaHours * 2) { if (!l.slaEscalatedAt) out.escalate.push({ lead: l, sellerId: a.toId, hours: Math.floor(waited) }); }
    else if (waited >= slaHours && !l.slaNudgedAt) out.nudge.push({ lead: l, sellerId: a.toId, hours: Math.floor(waited) });
  }
  return out;
}
