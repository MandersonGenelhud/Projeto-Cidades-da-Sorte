// Ranking da equipe: pontos, metas do mês, níveis de bonificação e conquistas.
// Regras pensadas para competição saudável: todos recebem clientes pelo mesmo
// rodízio, a venda só conta depois de confirmada e cuidar da carteira dá pontos.
export const POINTS = { sale: 100, perThousand: 1, proposal: 10, overdue: -5 };

const monthOf = (iso) => String(iso || '').slice(0, 7);

export function currentMonth(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function buildRanking({ leads, users, settings, month = currentMonth(), today }) {
  const crm = settings.crm || {};
  const goals = crm.goals || {};
  const metric = goals.metric === 'revenue' ? 'revenue' : 'sales';
  const tiers = [...(goals.tiers || [])].filter((t) => t && t.name).sort((a, b) => a.percent - b.percent);
  const needConfirm = crm.requireConfirmation !== false;
  const open = new Set(['novo', 'em_contato', 'proposta', 'aguardando']);

  const people = users.filter((u) => u.active !== false && (u.role === 'seller' || u.receivesLeads || leads.some((l) => l.ownerId === u.id)));
  const rows = people.map((u) => {
    const mine = leads.filter((l) => l.ownerId === u.id);
    const sold = mine.filter((l) => l.stage === 'ganho' && monthOf(l.closedAt) === month);
    const confirmed = sold.filter((l) => !needConfirm || l.closedConfirmed);
    const lost = mine.filter((l) => l.stage === 'perdido' && monthOf(l.updatedAt) === month);
    const proposals = leads.filter((l) => (l.timeline || []).some((t) =>
      t.type === 'etapa' && t.byId === u.id && monthOf(t.at) === month && /→ Proposta enviada/.test(t.text))).length;
    const received = leads.filter((l) => (l.timeline || []).some((t) => t.type === 'dono' && t.toId === u.id && monthOf(t.at) === month)).length;
    // Retornos atrasados só pesam no mês atual (é a carteira de hoje).
    const overdue = month === String(today).slice(0, 7) ? mine.filter((l) => open.has(l.stage) && l.followUpAt && l.followUpAt < today).length : 0;
    const fx = crm.fx || {};
    const revenue = confirmed.reduce((s, l) => s + (Number(l.closedValue) || 0) * (l.currency && l.currency !== 'BRL' ? Number(fx[l.currency]) || 1 : 1), 0);
    const sales = confirmed.length;
    const points = Math.max(0, sales * POINTS.sale + Math.floor(revenue / 1000) * POINTS.perThousand + proposals * POINTS.proposal + overdue * POINTS.overdue);
    const target = Number(goals.perUser?.[u.id] ?? goals.target ?? 0) || 0;
    const achieved = metric === 'revenue' ? revenue : sales;
    const percent = target ? Math.round((achieved / target) * 100) : null;
    const tier = percent === null ? null : [...tiers].reverse().find((t) => percent >= Number(t.percent)) || null;
    const nextTier = percent === null ? null : tiers.find((t) => percent < Number(t.percent)) || null;
    const decided = sales + lost.length;
    return {
      id: u.id,
      name: u.name,
      points,
      sales,
      revenue,
      pendingConfirmation: sold.length - confirmed.length,
      proposals,
      received,
      lost: lost.length,
      conversion: decided ? Math.round((sales / decided) * 100) : null,
      overdue,
      openLeads: mine.filter((l) => open.has(l.stage)).length,
      goal: { metric, target, achieved, percent, tier, nextTier, missing: nextTier ? Math.max(0, Math.ceil((Number(nextTier.percent) / 100) * target - achieved)) : 0 },
      badges: [],
    };
  });

  rows.sort((a, b) => b.points - a.points || b.revenue - a.revenue || a.name.localeCompare(b.name));
  rows.forEach((r, i) => { r.position = i + 1; });

  // Conquistas: reconhecem comportamentos diferentes, não só volume.
  const best = (fn, min = 1) => {
    const top = rows.filter((r) => fn(r) !== null && fn(r) >= min).sort((a, b) => fn(b) - fn(a))[0];
    return top && rows.filter((r) => fn(r) === fn(top)).length === 1 ? top : null;
  };
  for (const r of rows) {
    if (r.sales >= 1) r.badges.push({ icon: '🎯', label: 'Primeira venda do mês' });
    if (r.goal.percent !== null && r.goal.percent >= 100) r.badges.push({ icon: '🏆', label: 'Meta batida' });
    if (r.openLeads >= 3 && r.overdue === 0) r.badges.push({ icon: '📅', label: 'Carteira em dia (nenhum retorno atrasado)' });
  }
  const conv = best((r) => (r.sales + r.lost >= 3 ? r.conversion : null));
  if (conv) conv.badges.push({ icon: '🎓', label: 'Melhor conversão do mês' });
  const prop = best((r) => r.proposals, 3);
  if (prop) prop.badges.push({ icon: '📨', label: 'Mais propostas enviadas' });

  const teamAchieved = rows.reduce((s, r) => s + (metric === 'revenue' ? r.revenue : r.sales), 0);
  const teamTarget = Number(goals.team?.target || 0);
  return {
    month,
    metric,
    tiers,
    rows,
    team: {
      target: teamTarget,
      achieved: teamAchieved,
      percent: teamTarget ? Math.round((teamAchieved / teamTarget) * 100) : null,
      reward: goals.team?.reward || '',
    },
    rules: { points: POINTS, requireConfirmation: needConfirm },
  };
}
