// Telas do CRM: Vendas (painel do dono), Prospectos, Retornos e Equipe.
// Usa os utilitários de app.js ($, $$, esc, api, toast, loaders, fmtPhone…).
const money = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
const dateBR = (s) => (s ? s.split('-').reverse().join('/') : '');
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const plusDays = (n, base = new Date()) => {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const plusMonths = (n) => {
  const b = new Date();
  const d = new Date(b.getFullYear(), b.getMonth() + n, b.getDate());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const SOURCE_ICON = { whatsapp: '💬', instagram: '📸', instagram_ads: '📣', whatsapp_ads: '📣', manual: '✍️', indicacao: '🤝', site: '🌐', evento: '🎪' };
const TEMP = { quente: { icon: '🔥', label: 'Quente' }, morno: { icon: '🌤️', label: 'Morno' }, frio: { icon: '❄️', label: 'Frio' } };
const MONEY_LABEL = { sim: 'Tem o valor para começar', parcial: 'Tem parte do valor', nao: 'Ainda não tem o valor', nao_informou: 'Não informou' };
const DUE_LABEL = { atrasado: '⚠️ Atrasado', hoje: '🔔 Hoje', agendado: '📅' };
const TL_ICON = { criado: '✨', etapa: '➡️', retorno: '📅', nota: '📝', dono: '👤', ia: '🧠', aviso: '🔔', mensagem: '💬' };

const crmState = { stages: [], packages: [], users: [], view: 'board', current: null };
const isAdmin = () => window.currentUser?.role === 'admin';

async function loadCrmMeta() {
  const [meta, users] = await Promise.all([api('/api/crm/stages'), api('/api/users')]);
  crmState.stages = meta.stages;
  crmState.packages = meta.packages;
  crmState.users = users.filter((u) => u.active !== false);
  const ownerOpts = crmState.users.map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('');
  $('#leadOwnerSel').innerHTML = `<option value="">Sem responsável (equipe)</option>${ownerOpts}`;
  $('#leadStage').innerHTML = crmState.stages.map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join('');
  $('#formLead').interest.innerHTML = `<option value="">—</option>${crmState.packages
    .map((p) => `<option value="${esc(p.name)}">${esc(p.name)} · ${money(p.price)}/pessoa</option>`).join('')}`;
  const salesOwner = $('#salesOwner');
  const keep = salesOwner.value;
  salesOwner.innerHTML = `<option value="">Toda a equipe</option>${ownerOpts}`;
  salesOwner.value = keep;
  if (isAdmin()) {
    const lo = $('#leadOwner');
    const k = lo.value;
    lo.innerHTML = `<option value="">Todos</option><option value="mine">Só os meus</option><option value="none">Sem responsável</option>${ownerOpts}`;
    lo.value = k;
  }
}

// ---------- Gráficos simples (barras horizontais / verticais, sem bibliotecas) ----------
function hbars(el, rows, { fmt = (v) => v, empty = 'Ainda sem dados.' } = {}) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  el.innerHTML = rows.length && max
    ? rows.map((r) => `
      <div class="hbar" title="${esc(r.label)}: ${esc(fmt(r.value))}${r.extra ? ` · ${esc(r.extra)}` : ''}">
        <span class="hbar-label">${esc(r.label)}</span>
        <span class="hbar-track"><span class="hbar-fill${r.tone ? ` ${r.tone}` : ''}" style="width:${Math.max((r.value / max) * 100, r.value ? 2 : 0)}%"></span></span>
        <span class="hbar-value">${esc(fmt(r.value))}${r.extra ? ` <small>${esc(r.extra)}</small>` : ''}</span>
      </div>`).join('')
    : `<p class="muted">${empty}</p>`;
}

function vbars(el, rows) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  el.innerHTML = max
    ? `<div class="vbars-grid">${rows.map((r) => `
        <div class="vbar" title="${esc(r.label)}: ${money(r.value)} · ${r.count} venda(s)">
          <span class="vbar-value">${r.value ? money(r.value) : ''}</span>
          <span class="vbar-col"><span class="vbar-fill" style="height:${(r.value / max) * 100}%"></span></span>
          <span class="vbar-label">${esc(r.label)}</span>
        </div>`).join('')}</div>`
    : '<p class="muted">Nenhuma venda fechada nos últimos 6 meses.</p>';
}

// ---------- VENDAS (painel do dono) ----------
function periodRange() {
  const v = $('#salesPeriod').value;
  const d = new Date();
  const ym = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}`;
  if (v === 'month') return { from: `${ym(d.getFullYear(), d.getMonth())}-01`, to: todayStr() };
  if (v === 'lastmonth') {
    const first = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const last = new Date(d.getFullYear(), d.getMonth(), 0);
    return { from: `${ym(first.getFullYear(), first.getMonth())}-01`, to: `${ym(last.getFullYear(), last.getMonth())}-${String(last.getDate()).padStart(2, '0')}` };
  }
  if (v === '90') return { from: plusDays(-90), to: todayStr() };
  if (v === 'year') return { from: `${d.getFullYear()}-01-01`, to: todayStr() };
  return {};
}

async function refreshDemo() {
  const d = await api('/api/demo');
  $('#demoBanner').hidden = !d.loaded;
  $('#btnDemo').hidden = d.loaded;
}
$('#btnDemo').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try {
    const r = await api('/api/demo', { method: 'POST' });
    toast(`Exemplo carregado: ${r.sellers} vendedores e ${r.leads} clientes. Veja Prospectos, Ranking e Equipe.`);
    crmState.stages = [];
    loaders.sales();
  } catch (err) {
    toast(err.message, true);
  }
  e.target.disabled = false;
});
$('#btnDemoClear').addEventListener('click', async () => {
  await api('/api/demo', { method: 'DELETE' });
  toast('Dados de exemplo apagados');
  crmState.stages = [];
  loaders.sales();
});

loaders.sales = async () => {
  refreshDemo().catch(() => {});
  await loadCrmMeta();
  const q = new URLSearchParams({ ...periodRange(), ...($('#salesOwner').value ? { owner: $('#salesOwner').value } : {}) });
  const [s, insights] = await Promise.all([api(`/api/crm/stats?${q}`), api('/api/crm/insights')]);
  const kpi = (label, value, sub = '', tone = '', ico = '') => `<div class="card kpi ${tone}"><div class="kpi-head"><span class="label">${label}</span>${ico ? `<span class="kpi-ico">${icon(ico, 16)}</span>` : ''}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  $('#salesKpis').innerHTML = [
    kpi('Vendas fechadas', money(s.wonValue), `${s.won} venda(s) · ticket médio ${money(s.avgTicket)}`, '', 'money'),
    kpi('Conversão', s.conversion === null ? '—' : `${s.conversion}%`, `${s.won} fechadas de ${s.won + s.lost} decididas`, '', 'target'),
    kpi('Prospectos novos', s.newLeads, 'no período', '', 'userPlus'),
    kpi('Em negociação', money(s.openValue), `${s.openLeads} prospecto(s) em aberto`, '', 'briefcase'),
    kpi('Retornos', `${s.followUps.today} hoje`,
      s.followUps.overdue ? `<span class="status-warn">⚠️ ${s.followUps.overdue} atrasado(s)</span> · ${s.followUps.next30} nos próximos 30 dias` : `${s.followUps.next30} nos próximos 30 dias · ${s.followUps.later} depois`,
      s.followUps.overdue ? 'warn' : '', 'followups'),
  ].join('');

  hbars($('#chartFunnel'), s.byStage.map((st) => ({
    label: st.label, value: st.count, extra: st.value ? money(st.value) : '',
    tone: st.id === 'ganho' ? 'good' : st.id === 'perdido' ? 'muted' : '',
  })));
  vbars($('#chartMonths'), s.months.map((m) => ({ label: m.label, value: m.value, count: m.won })));
  hbars($('#chartLost'), s.lostReasons.map((r) => ({ label: r.label, value: r.count })), { empty: 'Nenhum prospecto perdido ainda. Ao marcar "Perdido", a equipe informa o motivo.' });
  hbars($('#chartWait'), s.waitReasons.map((r) => ({ label: r.label, value: r.count })), { empty: 'Nenhum cliente aguardando retorno.' });
  hbars($('#chartInterest'), s.byInterest.map((r) => ({ label: r.label, value: r.count })));
  hbars($('#chartSource'), s.bySource.map((r) => ({ label: r.label, value: r.count })));

  $('#sellersTable').innerHTML = `
    <thead><tr><th>Vendedor</th><th>Novos</th><th>Em aberto</th><th>Fechados</th><th>Perdidos</th><th>Conversão</th><th>Vendido</th><th>Retornos atrasados</th></tr></thead>
    <tbody>${s.bySeller.map((r) => `<tr>
      <td><b>${esc(r.name)}</b>${r.active === false ? ' <span class="muted">(inativo)</span>' : ''}</td>
      <td>${r.leads}</td><td>${r.open}</td><td>${r.won}</td><td>${r.lost}</td>
      <td>${r.conversion === null ? '—' : `${r.conversion}%`}</td><td>${money(r.wonValue)}</td>
      <td>${r.overdue ? `<span class="status-warn">⚠️ ${r.overdue}</span>` : '0'}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">Nenhum prospecto ainda.</td></tr>'}</tbody>`;
  renderInsights(insights);
  crmState.handoffs = await api(`/api/crm/handoffs?${q}`).catch(() => []);
  renderHandoffs();
};

function renderHandoffs() {
  const f = $('#handoffFilter').value;
  const open = (r) => !['ganho', 'perdido'].includes(r.stage);
  const rows = (crmState.handoffs || []).filter((r) => !f || (f === 'open' ? open(r) : f === 'idle' ? open(r) && r.idleDays >= 2 : r.stage === f));
  const when = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '—');
  $('#handoffTable').innerHTML = `
    <thead><tr><th>Cliente</th><th>Vendedor</th><th>Recebeu</th><th>Orçamento</th><th>Situação</th><th>O que trava / por que não fechou</th><th>Retorno</th><th>Vendedor mexeu</th></tr></thead>
    <tbody>${rows.map((r) => `<tr data-lead="${esc(r.id)}">
      <td><b>${esc(r.name || r.code)}</b><div class="hint">${esc(r.code)}${r.interest ? ` · ${esc(r.interest)}` : ''}</div></td>
      <td>${esc(r.ownerName)}</td>
      <td>${when(r.at)}<div class="hint">${esc(r.how)}</div></td>
      <td>${r.quote ? `${esc(r.quote.number)}<div class="hint">${money(r.quote.total)}</div>` : '—'}</td>
      <td><span class="chip small ${r.stage === 'ganho' ? 'good' : r.stage === 'perdido' ? 'muted' : ''}">${esc(r.stageLabel)}</span>${r.closedAt ? `<div class="hint">fechou ${when(r.closedAt)} · ${money(r.value)}</div>` : ''}</td>
      <td>${esc(r.lostReason || r.difficulty || '—')}</td>
      <td>${r.followUpAt ? `${when(`${r.followUpAt}T12:00:00`)}${r.followUpReason ? `<div class="hint">${esc(r.followUpReason)}</div>` : ''}` : '—'}</td>
      <td>${r.idleDays === null ? '—' : r.idleDays >= 2 ? `<span class="status-warn">⚠️ há ${r.idleDays} dias</span>` : r.lastSellerAt ? 'em dia' : '<span class="status-warn">ainda não mexeu</span>'}</td>
    </tr>`).join('') || '<tr><td colspan="8" class="muted">Nenhum cliente com vendedor neste período.</td></tr>'}</tbody>`;
}
$('#handoffFilter').addEventListener('change', renderHandoffs);
// Cada cliente que a IA passou para um humano: resumo no WhatsApp do vendedor dele ou do próprio Marcos.
async function digestProgress() {
  const r = await api('/api/handoffs/digest').catch(() => null);
  if (!r) return;
  $('#digestStatus').textContent = r.running ? `📤 Enviando resumos: ${r.done} de ${r.total}${r.failed ? ` (${r.failed} com erro)` : ''}… pode deixar esta tela.` : r.total ? `✅ Último envio: ${r.done} de ${r.total} resumos enviados.` : '';
  if (r.running) setTimeout(digestProgress, 5000);
}
$('#btnDigest').addEventListener('click', async () => {
  try {
    const r = await api('/api/handoffs/digest?days=30');
    if (!r.count) return toast('Nenhum cliente encaminhado esperando resumo nos últimos 30 dias');
    const lines = r.groups.map((g) => `• ${g.name}${g.phone ? ` (+${g.phone})` : ' (SEM WHATSAPP: não recebe)'}: ${g.count} cliente(s)`).join('\n');
    if (!confirm(`Enviar o resumo de ${r.count} cliente(s), uma mensagem por cliente, com o que já foi conversado e como começar?\n\n${lines}\n\nOs vendedores precisam estar com o WhatsApp cadastrado na aba Equipe. Clientes sem vendedor vão para o WhatsApp do Marcos.`)) return;
    await api('/api/handoffs/digest', { method: 'POST', body: { days: 30 } });
    toast('Envio começou: uma mensagem a cada 15 a 30 segundos');
    digestProgress();
  } catch (err) {
    toast(err.message, true);
  }
});
$('#handoffTable').addEventListener('click', (e) => {
  const id = e.target.closest('tr[data-lead]')?.dataset.lead;
  if (id) openLead(id);
});

function renderInsights(ins) {
  if (!ins?.text) return;
  const html = esc(ins.text)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/^#+\s*(.+)$/gm, '<b>$1</b>')
    .replace(/\n/g, '<br>');
  $('#insightsText').className = 'insights';
  $('#insightsText').innerHTML = `${html}<p class="hint">Análise de ${fmtDate(ins.at)}</p>`;
}

$('#salesPeriod').addEventListener('change', () => loaders.sales());
$('#salesOwner').addEventListener('change', () => loaders.sales());
$('#btnInsights').addEventListener('click', async (e) => {
  e.target.disabled = true;
  $('#insightsText').className = 'insights muted';
  $('#insightsText').textContent = '🧠 Analisando os números… (leva alguns segundos)';
  try {
    renderInsights(await api('/api/crm/insights', { method: 'POST', body: periodRange() }));
  } catch (err) {
    $('#insightsText').textContent = `Não foi possível analisar: ${err.message}`;
  }
  e.target.disabled = false;
});

// ---------- PROSPECTOS ----------
let leadsCache = [];
function leadQuery() {
  const q = new URLSearchParams();
  const search = $('#leadSearch').value.trim();
  if (search) q.set('q', search);
  let owner = $('#leadOwner').value;
  if (owner === 'mine') owner = window.currentUser.id;
  if (owner) q.set('owner', owner);
  return q;
}

function leadCard(l) {
  const who = l.name || (l.phone ? fmtPhone(l.phone) : l.instagram ? `@${l.instagram}` : 'Sem nome');
  return `<article class="lead-card${l.due === 'atrasado' ? ' overdue' : ''}" draggable="true" data-id="${esc(l.id)}">
    <div class="lead-top"><b>${esc(who)}</b><span>${l.qualification?.temperature ? `<span title="${TEMP[l.qualification.temperature].label}">${TEMP[l.qualification.temperature].icon}</span> ` : ''}<span title="Origem">${SOURCE_ICON[l.source] || '•'}</span></span></div>
    ${l.interest ? `<div class="lead-meta">${esc(l.interest)}${l.people > 1 ? ` · ${l.people} pessoas` : ''}</div>` : ''}
    ${l.value ? `<div class="lead-value">${money(l.stage === 'ganho' ? l.closedValue : l.value)}</div>` : ''}
    ${l.followUpAt && l.due ? `<div class="lead-due ${l.due}">${DUE_LABEL[l.due]} ${dateBR(l.followUpAt)}${l.followUpReason ? ` · ${esc(l.followUpReason)}` : ''}</div>` : ''}
    ${l.stage === 'perdido' && l.lostReason ? `<div class="lead-meta">✖ ${esc(l.lostReason)}</div>` : ''}
    ${l.stage === 'ganho' && !l.closedConfirmed ? '<div class="lead-meta">⏳ aguardando confirmação</div>' : ''}
    <div class="lead-owner">${l.ownerName ? `👤 ${esc(l.ownerName)}` : '<span class="free">Disponível</span>'} <span class="lead-code">${esc(l.code || '')}</span></div>
  </article>`;
}

function renderLeads() {
  if (crmState.view === 'board') {
    $('#leadBoard').innerHTML = crmState.stages.map((st) => {
      const list = leadsCache.filter((l) => l.stage === st.id);
      const total = list.reduce((s, l) => s + (Number(st.id === 'ganho' ? l.closedValue : l.value) || 0), 0);
      return `<section class="board-col" data-stage="${st.id}">
        <header><b>${esc(st.label)}</b> <span class="muted">${list.length}${total ? ` · ${money(total)}` : ''}</span></header>
        <div class="board-list">${list.map(leadCard).join('') || '<p class="muted small">Arraste um prospecto para cá</p>'}</div>
      </section>`;
    }).join('');
  } else {
    $('#leadTable').innerHTML = `<thead><tr><th>Cliente</th><th>Etapa</th><th>Pacote</th><th>Valor</th><th>Retorno</th><th>Responsável</th><th>Atualizado</th></tr></thead>
      <tbody>${leadsCache.map((l) => `<tr class="clickable" data-id="${esc(l.id)}">
        <td>${SOURCE_ICON[l.source] || ''} <b>${esc(l.name || '—')}</b> <span class="muted">${esc(fmtPhone(l.phone) || (l.instagram ? `@${l.instagram}` : ''))}</span></td>
        <td>${esc(l.stageLabel)}</td><td>${esc(l.interest || '—')}${l.people > 1 ? ` ×${l.people}` : ''}</td>
        <td>${l.value ? money(l.stage === 'ganho' ? l.closedValue : l.value) : '—'}</td>
        <td>${l.followUpAt && l.due ? `<span class="lead-due ${l.due}">${DUE_LABEL[l.due]} ${dateBR(l.followUpAt)}</span>` : '—'}</td>
        <td>${esc(l.ownerName || 'Disponível')}</td><td>${fmtDate(l.updatedAt)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Nenhum prospecto encontrado.</td></tr>'}</tbody>`;
  }
  $('#leadBoard').hidden = crmState.view !== 'board';
  $('#leadList').hidden = crmState.view !== 'list';
}

loaders.leads = async () => {
  if (!crmState.stages.length) await loadCrmMeta();
  leadsCache = await api(`/api/leads?${leadQuery()}`);
  renderLeads();
};

let leadSearchTimer;
$('#leadSearch').addEventListener('input', () => {
  clearTimeout(leadSearchTimer);
  leadSearchTimer = setTimeout(loaders.leads, 300);
});
$('#leadOwner').addEventListener('change', () => loaders.leads());
$$('#tab-leads [data-view]').forEach((b) => b.addEventListener('click', () => {
  crmState.view = b.dataset.view;
  $$('#tab-leads [data-view]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  try { localStorage.setItem('crmView', crmState.view); } catch {}
  renderLeads();
}));
try {
  const saved = localStorage.getItem('crmView');
  if (saved) $(`#tab-leads [data-view="${saved}"]`)?.click();
} catch {}

$('#leadBoard').addEventListener('click', (e) => {
  const id = e.target.closest('.lead-card')?.dataset.id;
  if (id) openLead(id);
});
$('#leadTable').addEventListener('click', (e) => {
  const id = e.target.closest('tr[data-id]')?.dataset.id;
  if (id) openLead(id);
});

// Arrastar e soltar entre as colunas do funil.
$('#leadBoard').addEventListener('dragstart', (e) => {
  const card = e.target.closest('.lead-card');
  if (!card) return;
  e.dataTransfer.setData('text/plain', card.dataset.id);
  card.classList.add('dragging');
});
$('#leadBoard').addEventListener('dragend', (e) => e.target.closest('.lead-card')?.classList.remove('dragging'));
$('#leadBoard').addEventListener('dragover', (e) => {
  const col = e.target.closest('.board-col');
  if (!col) return;
  e.preventDefault();
  $$('.board-col.over').forEach((c) => c !== col && c.classList.remove('over'));
  col.classList.add('over');
});
$('#leadBoard').addEventListener('dragleave', (e) => {
  const col = e.target.closest('.board-col');
  if (col && !col.contains(e.relatedTarget)) col.classList.remove('over');
});
$('#leadBoard').addEventListener('drop', async (e) => {
  const col = e.target.closest('.board-col');
  if (!col) return;
  e.preventDefault();
  col.classList.remove('over');
  const id = e.dataTransfer.getData('text/plain');
  const lead = leadsCache.find((l) => l.id === id);
  const stage = col.dataset.stage;
  if (!lead || lead.stage === stage) return;
  // Etapas que pedem informação abrem a ficha para completar.
  if (['aguardando', 'perdido', 'ganho'].includes(stage)) {
    await openLead(id);
    $('#leadStage').value = stage;
    syncStageExtras();
    $({ aguardando: '[name="followUpAt"]', perdido: '[name="lostReason"]', ganho: '[name="closedValue"]' }[stage], $('#formLead')).focus();
    return;
  }
  try {
    await api(`/api/leads/${id}`, { method: 'PATCH', body: { stage } });
    loaders.leads();
  } catch (err) {
    toast(err.message, true);
  }
});

// ---------- Ficha do prospecto ----------
const QUICK = [
  ['+1 semana', () => plusDays(7)], ['+15 dias', () => plusDays(15)], ['+1 mês', () => plusMonths(1)],
  ['+3 meses', () => plusMonths(3)], ['+6 meses', () => plusMonths(6)], ['+1 ano', () => plusMonths(12)], ['+2 anos', () => plusMonths(24)],
];
$('#quickDates').innerHTML = QUICK.map(([label], i) => `<button type="button" class="btn small" data-q="${i}">${label}</button>`).join('');
$('#quickDates').addEventListener('click', (e) => {
  const i = e.target.closest('[data-q]')?.dataset.q;
  if (i !== undefined) $('#formLead').followUpAt.value = QUICK[i][1]();
});

function syncStageExtras() {
  const st = $('#leadStage').value;
  $('#stageWait').hidden = st !== 'aguardando';
  $('#stageLost').hidden = st !== 'perdido';
  $('#stageWon').hidden = st !== 'ganho';
  const f = $('#formLead');
  f.followUpAt.min = plusDays(1);
  if (st === 'ganho' && !f.closedValue.value) f.closedValue.value = f.value.value;
}
$('#leadStage').addEventListener('change', syncStageExtras);
$('#formLead').interest.addEventListener('change', recalcValue);
$('#formLead').people.addEventListener('input', recalcValue);
function recalcValue() {
  const f = $('#formLead');
  const p = crmState.packages.find((x) => x.name === f.interest.value);
  if (p) f.value.value = p.price * Math.max(1, Number(f.people.value) || 1);
}

function fillLead(l) {
  crmState.current = l;
  const f = $('#formLead');
  f.reset();
  $('#leadTitle').textContent = l.id ? (l.name || fmtPhone(l.phone) || (l.instagram ? `@${l.instagram}` : 'Prospecto')) : 'Novo prospecto';
  for (const k of ['name', 'city', 'interest', 'people', 'value', 'followUpAt', 'followUpReason', 'lostReason', 'closedValue']) {
    if (f[k]) f[k].value = l[k] ?? '';
  }
  if (l.interest && ![...f.interest.options].some((o) => o.value === l.interest)) {
    f.interest.insertAdjacentHTML('beforeend', `<option value="${esc(l.interest)}">${esc(l.interest)}</option>`);
    f.interest.value = l.interest;
  }
  f.phone.value = l.phone ? fmtPhone(l.phone) : '';
  f.instagram.value = l.instagram ? `@${l.instagram}` : '';
  f.people.value = l.people || 1;
  f.stage.value = l.stage || 'novo';
  f.ownerId.value = l.ownerId || '';
  f.ownerId.disabled = !isAdmin();
  syncStageExtras();

  const mine = l.ownerId === window.currentUser.id;
  $('#btnTakeLead').hidden = !l.id || mine || (l.ownerId && !isAdmin());
  $('#btnDeleteLead').hidden = !l.id || !isAdmin();
  $('#leadWa').hidden = !l.phone;
  if (l.phone) $('#leadWa').href = `https://wa.me/${l.phone}`;

  const t = TEMP[l.qualification?.temperature];
  $('#leadBadges').innerHTML = l.id ? [
    l.code && `<span class="chip">🔖 ${esc(l.code)}</span>`,
    t && `<span class="chip temp-${esc(l.qualification.temperature)}">${t.icon} ${t.label}</span>`,
    l.adTitle && `<span class="chip">📣 Anúncio: ${esc(l.adTitle)}</span>`,
    l.affiliateName && `<span class="chip">🤝 Indicado por ${esc(l.affiliateName)}</span>`,
    l.category === 'imoveis' && '<span class="chip">🏠 Imóveis</span>',
    l.stage === 'ganho' && (l.closedConfirmed ? '<span class="chip ok">✅ Venda confirmada</span>' : '<span class="chip warn">⏳ Venda aguardando confirmação do administrador</span>'),
  ].filter(Boolean).join('') : '';
  const q = l.qualification;
  $('#leadQual').hidden = !q;
  if (q) {
    $('#leadQual').innerHTML = `<b>🔎 Peneira da IA</b>
      <dl>
        ${t ? `<dt>Temperatura</dt><dd>${t.icon} ${t.label}</dd>` : ''}
        ${q.money ? `<dt>Dinheiro</dt><dd>${esc(MONEY_LABEL[q.money] || q.money)}${q.moneyEvidence ? `<br><i>"${esc(q.moneyEvidence)}"</i>` : ''}</dd>` : ''}
        ${q.start ? `<dt>Quer iniciar</dt><dd>${esc(q.start)}</dd>` : ''}
        ${q.objections ? `<dt>Dúvidas</dt><dd>${esc(q.objections)}</dd>` : ''}
      </dl><p class="hint">Avaliado em ${fmtDate(q.at)}. Frases entre aspas são do próprio cliente.</p>`;
  }
  $('#btnConfirmSale').hidden = !(isAdmin() && l.stage === 'ganho' && !l.closedConfirmed);
  $('#btnLeadPix').hidden = !l.id || l.stage === 'perdido';
  renderLeadClosing(l);
  $('#btnLeadPlan').hidden = !l.id;

  const ai = [l.aiSummary && `🧠 <b>Resumo da IA:</b> ${esc(l.aiSummary)}`, l.objective && `🎯 <b>Objetivo:</b> ${esc(l.objective)}`].filter(Boolean);
  $('#leadAi').hidden = !ai.length;
  $('#leadAi').innerHTML = ai.join('<br>');

  $('#leadNote').value = '';
  $('#leadNote').disabled = $('#btnAddNote').disabled = !l.id;
  $('#leadTimeline').innerHTML = (l.timeline || []).slice().reverse().map((t) => `
    <li class="tl-${esc(t.type)}"><span class="tl-icon">${TL_ICON[t.type] || '•'}</span>
      <div><div class="tl-text">${esc(t.text)}</div><div class="tl-meta">${esc(t.by)} · ${fmtDate(t.at)}</div></div></li>`).join('')
    || '<li class="muted">O histórico aparece aqui depois de salvar.</li>';

  const conv = l.conversation || [];
  $('#leadConvWrap').hidden = !l.conversationKey;
  $('#leadConv').innerHTML = conv.map((m) => chatBubble(m.role, m.content, m.at)).join('') || '<p class="muted">Sem mensagens.</p>';
}

async function openLead(id) {
  try {
    if (!crmState.stages.length) await loadCrmMeta();
    fillLead(await api(`/api/leads/${id}`));
    if (!$('#leadDialog').open) $('#leadDialog').showModal();
  } catch (err) {
    toast(err.message, true);
  }
}

/** Abre (ou cria) o prospecto ligado a uma conversa — usado na tela Conversas. */
async function openLeadFromConversation(key) {
  try {
    if (!crmState.stages.length) await loadCrmMeta();
    const lead = await api('/api/leads/from-conversation', { method: 'POST', body: { key } });
    await openLead(lead.id);
  } catch (err) {
    toast(err.message, true);
  }
}

$('#btnNewLead').addEventListener('click', async () => {
  if (!crmState.stages.length) await loadCrmMeta();
  fillLead({ stage: 'novo', people: 1, ownerId: isAdmin() ? '' : window.currentUser.id, timeline: [] });
  $('#formLead').ownerId.disabled = !isAdmin();
  $('#leadDialog').showModal();
  $('#formLead').name.focus();
});
$('#leadClose').addEventListener('click', () => $('#leadDialog').close());

$('#formLead').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const l = crmState.current || {};
  const body = {
    name: f.name.value.trim(),
    phone: f.phone.value.trim(),
    instagram: f.instagram.value.trim(),
    city: f.city.value.trim(),
    interest: f.interest.value,
    people: Number(f.people.value || 1),
    value: Number(f.value.value || 0),
  };
  const stage = f.stage.value;
  if (isAdmin()) body.ownerId = f.ownerId.value || null;
  if (stage === 'aguardando' && !f.followUpAt.value) return toast('Escolha a data do retorno (ou use os botões +1 mês, +1 ano…)', true);
  if (stage === 'perdido' && !f.lostReason.value.trim()) return toast('Conte por que o cliente não fechou — isso ajuda o Marcos a melhorar as vendas', true);
  $('#btnSaveLead').disabled = true;
  try {
    let saved;
    if (!l.id) {
      saved = await api('/api/leads', { method: 'POST', body: { ...body, ownerId: isAdmin() ? body.ownerId : window.currentUser.id } });
    } else {
      saved = await api(`/api/leads/${l.id}`, { method: 'PATCH', body });
    }
    // Etapa (com os dados que ela pede) e retorno.
    if (stage === 'aguardando') {
      if (saved.stage !== 'aguardando' || saved.followUpAt !== f.followUpAt.value || saved.followUpReason !== f.followUpReason.value.trim()) {
        saved = await api(`/api/leads/${saved.id}/followup`, { method: 'POST', body: { date: f.followUpAt.value, reason: f.followUpReason.value.trim() } });
      }
    } else if (stage !== saved.stage) {
      saved = await api(`/api/leads/${saved.id}`, {
        method: 'PATCH',
        body: { stage, lostReason: f.lostReason.value.trim(), closedValue: Number(f.closedValue.value || body.value) },
      });
    }
    toast('Prospecto salvo ✅');
    $('#leadDialog').close();
    refreshCrmViews();
  } catch (err) {
    toast(err.message, true);
  } finally {
    $('#btnSaveLead').disabled = false;
  }
});

$('#btnAddNote').addEventListener('click', async () => {
  const text = $('#leadNote').value.trim();
  if (!text || !crmState.current?.id) return;
  try {
    await api(`/api/leads/${crmState.current.id}/notes`, { method: 'POST', body: { text } });
    openLead(crmState.current.id);
  } catch (err) {
    toast(err.message, true);
  }
});
$('#leadNote').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $('#btnAddNote').click();
  }
});
$('#btnTakeLead').addEventListener('click', async () => {
  try {
    await api(`/api/leads/${crmState.current.id}/assign`, { method: 'POST', body: { ownerId: window.currentUser.id } });
    toast('Agora este prospecto é seu 🙋');
    openLead(crmState.current.id);
    refreshCrmViews();
  } catch (err) {
    toast(err.message, true);
  }
});
$('#btnConfirmSale').addEventListener('click', async () => {
  try {
    await api(`/api/leads/${crmState.current.id}/confirm`, { method: 'POST' });
    toast('Venda confirmada: já conta no ranking 🏆');
    openLead(crmState.current.id);
    refreshCrmViews();
  } catch (err) {
    toast(err.message, true);
  }
});
$('#btnDeleteLead').addEventListener('click', async () => {
  if (!confirm('Excluir este prospecto e todo o histórico? Para clientes que não fecharam, prefira marcar "Perdido" com o motivo.')) return;
  await api(`/api/leads/${crmState.current.id}`, { method: 'DELETE' });
  $('#leadDialog').close();
  refreshCrmViews();
});
$('#btnLeadAi').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try {
    const r = await api(`/api/leads/${crmState.current.id}/ai`, { method: 'POST' });
    toast(r.info ? 'A IA leu a conversa e atualizou o que faltava 🧠' : 'A IA não encontrou informações novas', !r.info);
    openLead(crmState.current.id);
  } catch (err) {
    toast(err.message, true);
  }
  e.target.disabled = false;
});

// ---------- RETORNOS ----------
loaders.followups = async () => {
  const a = await api('/api/crm/agenda');
  updateDueBadge(a);
  const group = (title, list, tone, empty) => `
    <div class="panel fu-group ${tone}">
      <h2>${title} <span class="muted">${list.length}</span></h2>
      ${list.map((l) => `<div class="item fu-item" data-id="${esc(l.id)}">
        <div class="grow"><b>${esc(l.name || fmtPhone(l.phone) || `@${l.instagram}`)}</b> <span class="muted">${esc(fmtPhone(l.phone) || '')}</span>
          <div class="meta">📅 ${dateBR(l.followUpAt)}${l.followUpReason ? ` · ${esc(l.followUpReason)}` : ''}${l.interest ? ` · ${esc(l.interest)}` : ''}${isAdmin() ? ` · 👤 ${esc(l.ownerName || 'sem responsável')}` : ''}</div></div>
        ${l.phone ? `<a class="btn small" href="https://wa.me/${esc(l.phone)}" target="_blank" rel="noopener">💬 Chamar</a>` : ''}
        <button class="btn small" data-open="${esc(l.id)}">Abrir ficha</button>
      </div>`).join('') || `<p class="muted">${empty}</p>`}
    </div>`;
  $('#followupsBox').innerHTML = [
    a.atrasados.length ? group('⚠️ Atrasados', a.atrasados, 'warn', '') : '',
    group('🔔 Hoje', a.hoje, 'today', 'Nenhum retorno para hoje.'),
    group('📅 Próximos 30 dias', a.proximos, '', 'Nada nos próximos 30 dias.'),
    group('🗓️ Mais para frente', a.futuros, '', 'Nenhum retorno distante (ex.: "ano que vem", "daqui 2 anos").'),
  ].join('');
};
$('#followupsBox').addEventListener('click', (e) => {
  const id = e.target.closest('[data-open]')?.dataset.open;
  if (id) openLead(id);
});

function updateDueBadge(a) {
  const n = a.atrasados.length + a.hoje.length;
  $('#dueBadge').hidden = !n;
  $('#dueBadge').textContent = n;
}
async function refreshDueBadge() {
  try {
    updateDueBadge(await api('/api/crm/agenda'));
  } catch {}
}

// ---------- EQUIPE ----------
loaders.team = async () => {
  const [users, settings] = await Promise.all([api('/api/users'), api('/api/settings')]);
  const active = users.filter((u) => u.active);
  const inRotation = active.filter((u) => u.whatsapp && u.receivesLeads)
    .sort((a, b) => (a.rotationSeq || 0) - (b.rotationSeq || 0) || a.name.localeCompare(b.name));
  $('#rotationInfo').innerHTML = inRotation.length
    ? `🔄 <b>Rodízio:</b> ${inRotation.map((u, i) => `${i === 0 ? '<b>➡️ ' : ''}${esc(u.name)}${i === 0 ? ' (próximo)</b>' : ''}`).join(' → ')}`
    : '⚠️ Ninguém no rodízio. Cadastre vendedores com WhatsApp e marque "Entra no rodízio" para a IA poder encaminhar clientes.';
  const pending = users.filter((u) => u.pending);
  $('#teamPending').hidden = !pending.length;
  $('#teamPending').innerHTML = pending.length ? `<h3>🆕 Aguardando liberação (${pending.length})</h3><p class="hint">Libere só quem você conhece. No primeiro acesso, a pessoa liga a verificação em duas etapas.</p>${pending.map((u) => `
    <div class="item" data-user="${esc(u.id)}"><div class="grow"><b>${esc(u.name)}</b><div class="meta">login: ${esc(u.login)} · WhatsApp ${esc(fmtPhone(u.whatsapp))} · pediu em ${fmtDate(u.requestedAt)}</div></div>
      <button class="btn small primary" data-act="approve">✅ Liberar</button><button class="btn small danger" data-act="reject">Recusar</button></div>`).join('')}` : '';
  $('#teamList').innerHTML = users.filter((u) => !u.pending).map((u) => `
    <div class="item ${u.active ? '' : 'disabled'}" data-user="${esc(u.id)}">
      <div class="grow"><b>${esc(u.name)}</b> ${u.role === 'admin' ? '<span class="badge running">Administrador</span>' : '<span class="badge pending">Vendedor</span>'}
        ${u.active ? '' : '<span class="badge canceled">Inativo</span>'} ${u.twoFactor ? '<span class="badge done">🔐 2 etapas</span>' : '<span class="badge paused">só senha</span>'}
        <div class="meta">login: ${esc(u.login)}${u.whatsapp ? ` · WhatsApp ${esc(fmtPhone(u.whatsapp))}` : ' · sem WhatsApp (fora do rodízio)'}
          · ${u.receivesLeads && u.whatsapp ? `🔄 no rodízio · ${u.leadsReceived} cliente(s) recebido(s)` : '⏸️ fora do rodízio'}</div></div>
      ${u.active ? `<button class="btn small" data-act="rotation">${u.receivesLeads ? '⏸️ Pausar rodízio' : '▶️ Pôr no rodízio'}</button>` : ''}
      <button class="btn small" data-act="edit">✏️ Editar</button>
      <button class="btn small" data-act="password">🔑 Senha</button>
      ${u.id === window.currentUser.id ? '' : `<button class="btn small ${u.active ? 'danger' : ''}" data-act="toggle">${u.active ? 'Desativar' : 'Reativar'}</button>`}
      <button class="btn small" data-act="transfer" title="Passar os prospectos em aberto para outra pessoa">🔁 Passar carteira</button>
    </div>`).join('');
  $('#teamList').dataset.users = JSON.stringify(active.map(({ id, name, receivesLeads }) => ({ id, name, receivesLeads })));

  const c = settings.crm || {};
  const f = $('#formCrmSettings');
  f.autoAssign.value = c.autoAssign || 'qualified';
  f.routingEnabled.checked = c.routing?.enabled !== false;
  f.routingCriteria.value = c.routing?.criteria || '';
  f.panelUrl.value = c.panelUrl || '';
  f.ownerPhone.value = c.ownerPhone ? `+${c.ownerPhone}` : '';
  const qs = settings.quotes || {};
  f.quoteNext.value = qs.nextNumber || 1;
  f.quoteDays.value = qs.validityDays || 7;
  f.quotePhone.value = qs.phone || '';
  f.quoteEmail.value = qs.email || '';
  f.fxUSD.value = c.fx?.USD ?? 5.5;
  f.fxPYG.value = c.fx?.PYG ?? 0.0007;
  f.specialists.value = (c.specialists || []).map((s) => [s.topic, s.name, s.whatsapp ? `+${s.whatsapp}` : ''].join(' = ')).join('\n');
  const sec = c.sectors || {};
  const people = (id) => (sec[id]?.people || []).map((p) => `${p.name} = ${p.whatsapp ? `+${p.whatsapp}` : ''}`).join('\n');
  f.sectorLoteamentos.value = people('loteamentos');
  f.sectorDocumentacao.value = people('documentacao');
  f.sectorVeiculos.value = people('veiculos');
  f.autoCreate.checked = c.autoCreate !== false;
  f.aiExtract.checked = c.aiExtract !== false;
  f.notifyFollowUps.checked = c.notifyFollowUps !== false;
  f.packages.value = (c.packages || []).map((p) => `${p.name} = ${p.price}`).join('\n');
};

$('#teamList').addEventListener('click', async (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  const id = e.target.closest('[data-user]')?.dataset.user;
  if (!act || !id) return;
  try {
    if (act === 'rotation') {
      const u = JSON.parse($('#teamList').dataset.users || '[]').find((x) => x.id === id);
      await api(`/api/users/${id}`, { method: 'PATCH', body: { receivesLeads: !u?.receivesLeads } });
    } else if (act === 'edit') {
      const name = prompt('Nome:');
      if (name === null) return;
      const whatsapp = prompt('WhatsApp para os avisos (deixe vazio para não receber):');
      if (whatsapp === null) return;
      await api(`/api/users/${id}`, { method: 'PATCH', body: { ...(name.trim() ? { name } : {}), whatsapp } });
    } else if (act === 'password') {
      const password = prompt('Nova senha (mínimo 6 caracteres):');
      if (!password) return;
      await api(`/api/users/${id}`, { method: 'PATCH', body: { password } });
      toast('Senha alterada');
    } else if (act === 'toggle') {
      const disabling = !e.target.closest('.item').classList.contains('disabled');
      if (disabling && !confirm('Desativar esta pessoa? Ela não consegue mais entrar. Depois use "Passar carteira" para os prospectos dela.')) return;
      await api(`/api/users/${id}`, { method: 'PATCH', body: { active: !disabling } });
    } else if (act === 'transfer') {
      const others = JSON.parse($('#teamList').dataset.users || '[]').filter((u) => u.id !== id);
      const menu = others.map((u, i) => `${i + 1} = ${u.name}`).join('\n');
      const pick = prompt(`Passar os prospectos EM ABERTO desta pessoa para quem?\n${menu}\n0 = deixar disponível para a equipe`);
      if (pick === null || pick.trim() === '') return;
      const n = Number(pick);
      if (!Number.isInteger(n) || n < 0 || n > others.length) return toast('Opção inválida', true);
      const r = await api(`/api/users/${id}/transfer`, { method: 'POST', body: { toId: n ? others[n - 1].id : null } });
      toast(`${r.transferred} prospecto(s) transferido(s)`);
    }
    loaders.team();
  } catch (err) {
    toast(err.message, true);
  }
});

$('#formUser').addEventListener('submit', withBusy($('#formUser'), async (e) => {
  const f = e.target;
  await api('/api/users', { method: 'POST', body: { ...Object.fromEntries(new FormData(f)), receivesLeads: f.receivesLeads.checked } });
  toast(`Cadastrado! Passe o login "${f.login.value}" e a senha. A pessoa já aparece em Conexões WhatsApp para conectar o WhatsApp dela.`);
  f.reset();
  crmState.stages = [];
  loaders.team();
}));

$('#formCrmSettings').addEventListener('submit', withBusy($('#formCrmSettings'), async (e) => {
  const f = e.target;
  const packages = f.packages.value.split('\n').map((line) => {
    const m = line.match(/^(.+?)\s*[=:]\s*(?:R\$\s*)?([\d.,]+)\s*$/);
    if (!m) return null;
    return { name: m[1].trim(), price: Number(m[2].replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')) || 0 };
  }).filter(Boolean);
  await api('/api/settings', {
    method: 'PUT',
    body: { crm: {
      autoAssign: f.autoAssign.value, autoCreate: f.autoCreate.checked, aiExtract: f.aiExtract.checked, notifyFollowUps: f.notifyFollowUps.checked, packages,
      routing: { enabled: f.routingEnabled.checked, criteria: f.routingCriteria.value },
      specialists: f.specialists.value.split('\n').map((line) => line.split('=').map((x) => x.trim()))
        .filter(([topic, name]) => topic && name)
        .map(([topic, name, whatsapp = '']) => ({ topic, name, whatsapp: whatsapp.replace(/\D/g, '') })),
      sectors: (() => {
        const parse = (t) => t.split('\n').map((l) => l.split(/[=:]/).map((x) => x.trim())).filter(([n]) => n).map(([name, w = '']) => ({ name, whatsapp: w.replace(/\D/g, '') }));
        return { loteamentos: { people: parse(f.sectorLoteamentos.value) }, documentacao: { people: parse(f.sectorDocumentacao.value) }, veiculos: { people: parse(f.sectorVeiculos.value) } };
      })(),
      panelUrl: f.panelUrl.value.trim(),
      ownerPhone: f.ownerPhone.value.replace(/\D/g, ''),
      fx: { USD: Number(f.fxUSD.value) || 1, PYG: Number(f.fxPYG.value) || 0 },
    },
    quotes: { nextNumber: Number(f.quoteNext.value) || 1, validityDays: Number(f.quoteDays.value) || 7, phone: f.quotePhone.value.trim(), email: f.quoteEmail.value.trim() } },
  });
  crmState.stages = [];
  toast('Regras do CRM salvas');
  loaders.team();
}));

// ---------- RANKING ----------
const monthLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return s[0].toUpperCase() + s.slice(1);
};
(() => {
  const d = new Date();
  const opts = [];
  for (let i = 0; i < 12; i++) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const ym = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
    opts.push(`<option value="${ym}">${monthLabel(ym)}</option>`);
  }
  $('#rankMonth').innerHTML = opts.join('');
})();
$('#rankMonth').addEventListener('change', () => loaders.ranking());

const goalText = (metric, v) => (metric === 'revenue' ? money(v) : `${v} venda${v === 1 ? '' : 's'}`);
function progressBar(pct, tiers) {
  const max = Math.max(100, ...tiers.map((t) => Number(t.percent)), pct || 0);
  const marks = tiers.map((t) => `<span class="pmark" style="left:${(t.percent / max) * 100}%" title="${esc(t.name)}: ${t.percent}%"></span>`).join('');
  return `<div class="pbar" role="img" aria-label="${pct ?? 0}% da meta"><span class="pfill" style="width:${Math.min(100, ((pct || 0) / max) * 100)}%"></span>${marks}</div>`;
}

loaders.ranking = async () => {
  const r = await api(`/api/crm/ranking?month=${$('#rankMonth').value}`);
  const me = window.currentUser.id;
  const team = r.team;
  $('#rankTeam').innerHTML = team.target
    ? `<div class="conv-header"><h2>🤝 Meta da equipe: ${goalText(r.metric, team.achieved)} de ${goalText(r.metric, team.target)}</h2><b>${team.percent}%</b></div>
       ${progressBar(team.percent, [{ name: 'Meta', percent: 100 }])}
       <p class="hint">${team.percent >= 100 ? '🎉 Meta da equipe batida!' : 'Faltam ' + goalText(r.metric, Math.max(0, team.target - team.achieved)) + '.'}${team.reward ? ` Prêmio para todos: <b>${esc(team.reward)}</b>` : ''}</p>`
    : '<p class="muted">Sem meta de equipe definida.</p>';

  const medals = ['🥇', '🥈', '🥉'];
  const top = r.rows.slice(0, 3);
  $('#rankPodium').innerHTML = top.length && top[0].points > 0 ? top.map((x, i) => `
    <div class="podium-card p${i + 1}${x.id === me ? ' me' : ''}">
      <div class="medal">${medals[i]}</div>
      <b>${esc(x.name)}</b>
      <div class="pts">${x.points} pts</div>
      <div class="muted small">${goalText('sales', x.sales)} · ${money(x.revenue)}</div>
    </div>`).join('') : '<p class="muted">O pódio aparece quando alguém marcar pontos neste mês. Bora! 💪</p>';

  $('#rankTable').innerHTML = `<thead><tr><th>#</th><th>Vendedor</th><th>Pontos</th><th>Vendas</th><th>Vendido</th><th>Propostas</th><th>Conversão</th><th>Clientes recebidos</th><th>Meta</th><th>Conquistas</th></tr></thead>
    <tbody>${r.rows.map((x) => {
      const g = x.goal;
      return `<tr class="${x.id === me ? 'me' : ''}">
        <td>${medals[x.position - 1] || x.position}</td>
        <td><b>${esc(x.name)}</b>${x.id === me ? ' <span class="muted">(você)</span>' : ''}</td>
        <td><b>${x.points}</b></td>
        <td>${x.sales}${x.pendingConfirmation ? ` <span class="muted" title="aguardando confirmação">+${x.pendingConfirmation} ⏳</span>` : ''}</td>
        <td>${money(x.revenue)}</td><td>${x.proposals}</td>
        <td>${x.conversion === null ? '—' : `${x.conversion}%`}</td>
        <td>${x.received}</td>
        <td class="goal-cell">${g.target ? `${progressBar(g.percent, r.tiers)}<div class="small">${goalText(r.metric, g.achieved)} de ${goalText(r.metric, g.target)} · ${g.percent}%
          ${g.tier ? ` · <b>${esc(g.tier.name)}</b>` : ''}${g.nextTier ? `<br><span class="muted">Faltam ${goalText(r.metric, g.missing)} para ${esc(g.nextTier.name)} (${esc(g.nextTier.reward || '')})</span>` : g.tier ? ' 🎉' : ''}</div>` : '—'}</td>
        <td>${x.badges.map((b) => `<span title="${esc(b.label)}" class="badge-ico">${b.icon}</span>`).join(' ') || '<span class="muted">—</span>'}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="10" class="muted">Nenhum vendedor cadastrado ainda.</td></tr>'}</tbody>`;

  const P = r.rules.points;
  $('#rankRules').innerHTML = [
    `🏆 Venda fechada${r.rules.requireConfirmation ? ' (confirmada pelo administrador)' : ''}: <b>+${P.sale}</b>`,
    `💰 Cada R$ 1.000 vendidos: <b>+${P.perThousand}</b>`,
    `📨 Proposta enviada (mover para "Proposta enviada"): <b>+${P.proposal}</b>`,
    `⚠️ Cada retorno atrasado na carteira: <b>${P.overdue}</b>`,
    ...r.tiers.map((t) => `🎁 <b>${esc(t.name)}</b>: ${t.percent}% da meta → ${esc(t.reward || '')}`),
    '🎯 🏆 📅 🎓 📨 Conquistas: primeira venda, meta batida, carteira em dia, melhor conversão e mais propostas.',
  ].map((t) => `<li>${t}</li>`).join('');

  if (isAdmin()) fillGoalsForm(r);
};

async function fillGoalsForm() {
  const [settings, users] = await Promise.all([api('/api/settings'), api('/api/users')]);
  const g = settings.crm?.goals || {};
  const f = $('#formGoals');
  f.metric.value = g.metric || 'sales';
  f.target.value = g.target ?? '';
  f.teamTarget.value = g.team?.target ?? '';
  f.teamReward.value = g.team?.reward || '';
  f.requireConfirmation.checked = settings.crm?.requireConfirmation !== false;
  $('#goalPerUser').innerHTML = `<h3>Meta individual (deixe vazio para usar a meta padrão)</h3>` + users.filter((u) => u.active && (u.role === 'seller' || u.receivesLeads))
    .map((u) => `<label>${esc(u.name)} <input type="number" min="0" data-user="${esc(u.id)}" value="${g.perUser?.[u.id] ?? ''}" placeholder="padrão" /></label>`).join('');
  renderTiers(g.tiers || []);
}
function renderTiers(tiers) {
  $('#goalTiers').innerHTML = tiers.map((t) => `<div class="row tier-row">
    <label>Nível <input data-k="name" value="${esc(t.name)}" placeholder="Ouro" /></label>
    <label>% da meta <input data-k="percent" type="number" min="1" value="${esc(t.percent)}" /></label>
    <label class="grow">Bonificação <input data-k="reward" value="${esc(t.reward || '')}" placeholder="ex.: R$ 500, folga, viagem" /></label>
    <button type="button" class="btn small danger" data-del-tier>✕</button></div>`).join('');
}
const readTiers = () => $$('#goalTiers .tier-row').map((row) => ({
  name: $('[data-k="name"]', row).value.trim(),
  percent: Number($('[data-k="percent"]', row).value) || 100,
  reward: $('[data-k="reward"]', row).value.trim(),
})).filter((t) => t.name);
$('#btnAddTier').addEventListener('click', () => renderTiers([...readTiers(), { name: '', percent: 200, reward: '' }]));
$('#goalTiers').addEventListener('click', (e) => {
  if (!e.target.closest('[data-del-tier]')) return;
  e.target.closest('.tier-row').remove();
});
$('#formGoals').addEventListener('submit', withBusy($('#formGoals'), async (e) => {
  const f = e.target;
  const perUser = {};
  for (const inp of $$('#goalPerUser [data-user]')) perUser[inp.dataset.user] = inp.value === '' ? null : Number(inp.value);
  await api('/api/settings', {
    method: 'PUT',
    body: { crm: {
      requireConfirmation: f.requireConfirmation.checked,
      goals: { metric: f.metric.value, target: Number(f.target.value || 0), perUser, tiers: readTiers(), team: { target: Number(f.teamTarget.value || 0), reward: f.teamReward.value.trim() } },
    } },
  });
  toast('Metas salvas 🎯');
  loaders.ranking();
}));

// ---------- Atualização em tempo real ----------
function refreshCrmViews() {
  for (const tab of ['leads', 'followups', 'sales', 'ranking']) {
    if ($(`#tab-${tab}`).classList.contains('active')) loaders[tab]();
  }
  refreshDueBadge();
}
let crmRefreshTimer;
function onCrmEvent() {
  clearTimeout(crmRefreshTimer);
  crmRefreshTimer = setTimeout(() => {
    if (!$('#leadDialog').open) refreshCrmViews();
    else refreshDueBadge();
  }, 600);
}
function onCrmDue() {
  toast('🔔 Chegou o dia de um retorno — veja em "Retornos"');
  refreshDueBadge();
}

function onCrmAssigned(data) {
  if (data.ownerId === window.currentUser?.id) toast('🎯 Novo cliente encaminhado para você! Veja em Prospectos.');
  onCrmEvent();
}

// ---------- CALCULADORA DE ORÇAMENTO E ETAPAS DE PAGAMENTO ----------
const calc = { lead: null, text: '' };
const brl2 = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const WD_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const diaSemana = (iso) => `${WD_SHORT[new Date(`${iso}T12:00:00Z`).getUTCDay()]}, ${iso.split('-').reverse().join('/')}`;
async function openCalc(lead = null) {
  calc.lead = lead;
  const f = $('#calcForm');
  if (!f.packageName.options.length) {
    const meta = await api('/api/crm/stages');
    f.packageName.innerHTML = (meta.packages || []).map((p) => `<option value="${esc(p.name)}">${esc(p.name)} · ${brl2(p.price)} por pessoa</option>`).join('');
  }
  if (lead?.interest) f.packageName.value = lead.interest;
  f.people.value = lead?.people || 1;
  f.adults.value = lead?.people || 1;
  f.start.value = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  $('#calcFor').textContent = lead ? `Cliente: ${lead.name || lead.code}` : 'Monte o orçamento para explicar ao cliente quanto fica a entrada, as parcelas e as datas.';
  $('#calcSend').hidden = !lead?.id;
  $('#calcQuoteSend').hidden = !lead?.id;
  if (!$('#calcDialog').open) $('#calcDialog').showModal();
  runCalc();
}
async function runCalc() {
  const f = $('#calcForm');
  if (Number(f.adults.value) > Number(f.people.value)) f.adults.value = f.people.value;
  try {
    const r = await api('/api/payments/calc', { method: 'POST', body: { packageName: f.packageName.value, people: Number(f.people.value), adults: Number(f.adults.value), start: f.start.value } });
    const p = r.plan;
    calc.text = r.text;
    $('#calcResult').innerHTML = `
      <div class="calc-total"><div><span>Valor total</span><b>${brl2(p.total)}</b><small>${brl2(r.price)} × ${p.people} pessoa(s)</small></div><div><span>Entrada na assinatura</span><b>${brl2(p.entry)}</b><small>${brl2(p.base)} de sinal + ${brl2(p.perAdult)} × ${p.adults} adulto(s) das certidões (Interpol e Polícia Nacional) · ${diaSemana(p.start)}</small></div></div>
      <ol class="calc-steps">${p.parcels.map((x, i) => `<li><span class="calc-dot">${i === p.parcels.length - 1 ? '🪪' : '✈️'}</span><div><b>${brl2(x.value)}</b> · ${esc(x.label)} (${x.pct}% do saldo)<div class="hint">${esc(diaSemana(x.date))} · ${esc(x.when.toLowerCase())} · ${esc(x.note)}${x.moved ? ' · <b>caiu no fim de semana, passou para segunda</b>' : ''}</div></div></li>`).join('')}</ol>
      <p class="hint">Saldo depois da entrada: ${brl2(p.balance)}. As datas das viagens e da retirada são confirmadas pela equipe.</p>`;
  } catch (err) {
    $('#calcResult').innerHTML = `<p class="err">${esc(err.message)}</p>`;
  }
}
$('#btnCalc').addEventListener('click', () => openCalc());
$('#calcClose').addEventListener('click', () => $('#calcDialog').close());
$('#calcForm').addEventListener('input', runCalc);
$('#calcForm').addEventListener('submit', (e) => e.preventDefault());
$('#calcCopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(calc.text); toast('Mensagem copiada: cole no WhatsApp'); } catch { prompt('Copie a mensagem:', calc.text); }
});
$('#calcSend').addEventListener('click', async () => {
  const f = $('#calcForm');
  if (!calc.lead?.id || !confirm('Enviar este passo a passo para o cliente no WhatsApp?')) return;
  try {
    await api('/api/payments/calc', { method: 'POST', body: { send: true, leadId: calc.lead.id, packageName: f.packageName.value, people: Number(f.people.value), adults: Number(f.adults.value), start: f.start.value } });
    toast('Etapas de pagamento enviadas ao cliente');
    $('#calcDialog').close();
  } catch (err) {
    toast(err.message, true);
  }
});
async function makeQuote(send) {
  const f = $('#calcForm');
  const client = calc.lead ? calc.lead.name : prompt('Nome do cliente para o orçamento:', '');
  if (client === null) return;
  if (send && !confirm('Gerar o orçamento e enviar ao cliente no WhatsApp (PDF + resumo)?')) return;
  try {
    const r = await api('/api/quotes', { method: 'POST', body: { send, leadId: calc.lead?.id || null, client, items: [{ pacote: f.packageName.value, quantidade: Number(f.people.value) }], adults: Number(f.adults.value), start: f.start.value } });
    calc.text = r.text;
    toast(send ? `Orçamento ${r.number} enviado ao cliente` : `Orçamento ${r.number} gerado`);
    if (!send) window.open(r.url, '_blank');
  } catch (err) {
    toast(err.message, true);
  }
}
$('#calcQuote').addEventListener('click', () => makeQuote(false));
$('#calcQuoteSend').addEventListener('click', () => makeQuote(true));
$('#btnLeadPlan').addEventListener('click', () => crmState.current?.id && openCalc(crmState.current));

// ---------- VISITAS AO ESCRITÓRIO ----------
const VISIT_STATUS = { pendente: '<span class="badge paused">⏳ Aguardando você</span>', confirmada: '<span class="badge done">✅ Confirmada</span>', remarcar: '<span class="badge pending">🔁 Remarcando</span>', cancelada: '<span class="badge canceled">Cancelada</span>', realizada: '<span class="badge running">Realizada</span>' };
loaders.visits = async () => {
  const [list, settings, users] = await Promise.all([api('/api/visits'), api('/api/settings'), api('/api/users').catch(() => [])]);
  // Todo vendedor ativo da aba Equipe aparece aqui; quem está sem WhatsApp aparece apagado (não tem como receber).
  const sellers = (Array.isArray(users) ? users : users.users || []).filter((u) => u.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  const sellerOptions = sellers.map((u) => `<option value="${esc(u.id)}"${u.whatsapp ? '' : ' disabled'}>${esc(u.name)}${u.role === 'admin' ? ' (administrador)' : ''}${u.whatsapp ? '' : ' (sem WhatsApp)'}</option>`).join('');
  const today = new Date().toISOString().slice(0, 10);
  $('#visitTable').innerHTML = `<thead><tr><th>Pedido</th><th>Cliente</th><th>Preferência</th><th>Assunto</th><th>Vem preparado?</th><th>Situação</th><th></th></tr></thead><tbody>${list.map((v) => `
    <tr data-visit="${esc(v.id)}"><td>${fmtDate(v.createdAt)}</td>
      <td><b>${esc(v.name || 'Cliente')}</b><div class="hint">${v.phone ? esc(fmtPhone(v.phone)) : ''}${v.leadCode ? ` · ${esc(v.leadCode)}` : ''} · ${v.people} pessoa(s)</div>
        <div class="hint">${v.forwardedTo ? `📤 Passado para <b>${esc(v.forwardedTo)}</b>` : v.ownerName ? `👤 Com <b>${esc(v.ownerName)}</b>` : '<span class="status-warn">Sem vendedor</span>'}</div>
        ${v.status !== 'cancelada' && sellerOptions ? `<div class="visit-actions"><select data-f="seller"><option value="">Escolha o vendedor…</option>${sellerOptions}</select><button class="btn small" data-act="forward">📤 Passar para o vendedor</button></div>` : ''}</td>
      <td>${esc(v.preferred || '—')}${v.period ? `<div class="hint">${esc(v.period)}</div>` : ''}</td>
      <td>${esc(v.subject || '—')}</td><td class="small">${esc(v.prepared || '—')}</td>
      <td>${VISIT_STATUS[v.status] || esc(v.status)}${v.status === 'confirmada' ? `<div class="hint">${esc(v.date.split('-').reverse().join('/'))} às ${esc(v.time)}</div>` : ''}</td>
      <td>${['pendente', 'remarcar'].includes(v.status) ? `<div class="visit-actions"><input type="date" data-f="date" min="${today}" /><input type="time" data-f="time" step="900" /><button class="btn small primary" data-act="confirm">Confirmar</button><button class="btn small" data-act="reschedule">Propor outro dia</button><button class="btn small danger" data-act="cancel">Recusar</button></div>`
        : v.status === 'confirmada' ? '<button class="btn small" data-act="done">Marcar como realizada</button>' : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Nenhum pedido de visita ainda.</td></tr>'}</tbody>`;
  const pend = list.filter((v) => v.status === 'pendente').length;
  $('#visitBadge').hidden = !pend;
  $('#visitBadge').textContent = pend;
  const c = settings.visits || {};
  const f = $('#formVisits');
  f.enabled.checked = c.enabled !== false;
  for (const k of ['address', 'notifyPhone', 'hours', 'bring']) f[k].value = c[k] || '';
};
$('#visitTable').addEventListener('click', async (e) => {
  const act = e.target.closest('button[data-act]')?.dataset.act;
  const row = e.target.closest('[data-visit]');
  if (!act || !row) return;
  const id = row.dataset.visit;
  try {
    if (act === 'confirm') {
      const date = $('[data-f="date"]', row).value;
      const time = $('[data-f="time"]', row).value;
      if (!date || !time) return toast('Escolha o dia e o horário', true);
      const note = prompt('Recado para o cliente junto com a confirmação (opcional):', '') ?? '';
      await api(`/api/visits/${id}/confirm`, { method: 'POST', body: { date, time, note } });
      toast('Visita confirmada: o cliente recebeu no WhatsApp');
    } else if (act === 'reschedule') {
      const message = prompt('Mensagem para o cliente propondo outro dia:', 'Oi! Nesse dia não consigo te receber. Pode ser em outro dia? Me diz qual fica melhor para você.');
      if (!message) return;
      await api(`/api/visits/${id}/reschedule`, { method: 'POST', body: { message } });
      toast('Mensagem enviada');
    } else if (act === 'cancel') {
      const message = prompt('Mensagem para o cliente (opcional):', '');
      if (message === null) return;
      await api(`/api/visits/${id}/cancel`, { method: 'POST', body: { message } });
    } else if (act === 'forward') {
      const sel = $('[data-f="seller"]', row);
      if (!sel.value) return toast('Escolha o vendedor', true);
      const name = sel.selectedOptions[0].textContent;
      if (!confirm(`Passar este cliente para ${name}? Ele(a) vira o responsável e recebe o resumo no WhatsApp, enviado pelo número conectado.`)) return;
      await api(`/api/visits/${id}/forward`, { method: 'POST', body: { ownerId: sel.value } });
      toast(`Enviado para ${name}`);
    } else if (act === 'done') {
      await api(`/api/visits/${id}/done`, { method: 'POST' });
    }
    loaders.visits();
  } catch (err) {
    toast(err.message, true);
  }
});
$('#formVisits').addEventListener('submit', withBusy($('#formVisits'), async (e) => {
  const f = e.target;
  await api('/api/settings', { method: 'PUT', body: { visits: { enabled: f.enabled.checked, address: f.address.value.trim(), notifyPhone: f.notifyPhone.value.trim(), hours: f.hours.value.trim(), bring: f.bring.value.trim() } } });
  toast('Salvo');
  loaders.visits();
}));

// ---------- FECHAMENTO NA FICHA DO PROSPECTO (ficha de dados → Pix → termo) ----------
async function renderLeadClosing(l) {
  const box = $('#leadClosing');
  box.hidden = !l.id;
  if (!l.id) return;
  const f = await api(`/api/leads/${l.id}/closing`).catch(() => null);
  const step = (ok, label, extra = '') => `<li class="${ok ? 'done' : ''}">${ok ? '✅' : '⚪'} ${label}${extra}</li>`;
  box.innerHTML = `<b>📝 Fechamento da reserva</b>
    <ol class="closing-steps">
      ${step(Boolean(f), 'Ficha de dados enviada', f ? ` <a href="${esc(f.formUrl)}" target="_blank" rel="noopener">abrir</a>` : '')}
      ${step(f?.status === 'preenchida', 'Ficha preenchida pelo cliente', f?.filledAt ? ` · ${fmtDate(f.filledAt)}` : '')}
      ${step(Boolean(f?.term), 'Termo da reserva enviado')}
      ${step(f?.term?.status === 'assinado', 'Termo assinado', f?.termPdf ? ` · <a href="${esc(f.termPdf)}" target="_blank" rel="noopener">ver PDF</a>` : '')}
    </ol>
    ${f?.status === 'preenchida' ? `<details><summary>Dados da ficha</summary><dl>${Object.entries({ Nome: f.data.nome, CPF: f.data.cpf, RG: `${f.data.rg} ${f.data.rgOrgao || ''}`, Nascimento: f.data.nascimento, 'Estado civil': f.data.estadoCivil, Endereço: [f.data.rua, f.data.numero, f.data.bairro, `${f.data.cidade}/${f.data.uf}`].filter(Boolean).join(', '), Adultos: f.data.adultos, Acompanhantes: f.data.acompanhantes }).filter(([, v]) => v && String(v).trim()).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl></details>` : ''}
    <div class="row">${f?.status !== 'preenchida' ? `<button type="button" class="btn small primary" id="btnSendFicha">${f ? 'Reenviar a ficha no WhatsApp' : 'Enviar a ficha no WhatsApp'}</button>` : ''}
    ${f ? `<button type="button" class="btn small" id="btnCopyFicha">Copiar link da ficha</button>` : ''}</div>`;
  $('#btnSendFicha')?.addEventListener('click', async () => {
    try {
      await api(`/api/leads/${l.id}/closing`, { method: 'POST', body: { send: true } });
      toast('Ficha enviada ao cliente no WhatsApp');
      renderLeadClosing(l);
    } catch (err) {
      toast(err.message, true);
    }
  });
  $('#btnCopyFicha')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(f.formUrl); toast('Link copiado'); } catch { prompt('Copie o link:', f.formUrl); }
  });
}

// ---------- WHATSAPP DE CADA VENDEDOR (a atendente de IA trabalha no número dele) ----------
const LINE_STATUS = { connected: 'Conectado', qr: 'Aguardando QR Code', connecting: 'Conectando…', disconnected: 'Desconectado' };
const initials = (name) => String(name || '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
function numberCheck(l) {
  if (!l.phone) return '';
  const phone = esc(fmtPhone(l.phone));
  if (l.verified === true) return `<p class="num-check ok">✅ WhatsApp ${phone} confere com o cadastro de ${esc(l.ownerName || l.label)}</p>`;
  if (l.verified === false) {
    return `<p class="num-check warn">⚠️ Conectado com ${phone}, mas o cadastro de ${esc(l.ownerName)} tem ${esc(fmtPhone(l.ownerWhatsapp))}.
      ${isAdmin() ? '<button type="button" class="btn small" data-act="usephone">Usar o número conectado no cadastro</button>' : 'Avise o administrador.'}</p>`;
  }
  return `<p class="num-check">📱 WhatsApp ${phone} conectado. Ninguém da equipe tem esse número no cadastro.</p>`;
}
const lineCard = (l, people) => `
    <article class="panel line-card" data-line="${esc(l.id)}">
      <div class="line-head">
        <span class="avatar lg">${esc(initials(l.label))}</span>
        <div class="grow"><h2>${esc(l.label)}</h2><span class="line-status ${esc(l.status)}">${LINE_STATUS[l.status] || esc(l.status)}</span></div>
      </div>
      <button type="button" class="ai-toggle ${l.agent !== false ? 'on' : ''}" data-act="ai" aria-pressed="${l.agent !== false}">
        <span class="switch" aria-hidden="true"><i></i></span>
        <span><b>${l.agent !== false ? 'IA ligada' : 'IA desligada'}</b><small>${l.agent !== false ? 'A atendente responde os clientes deste WhatsApp' : 'Só o vendedor responde neste WhatsApp'}</small></span>
      </button>
      ${numberCheck(l)}
      ${isAdmin() && !l.ownerId ? `<div class="row">
        <label>Nome da conexão <input data-field="label" value="${esc(l.label)}" /></label>
        <label>Vendedor <select data-field="ownerId"><option value="">—</option>${people.map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}</select></label>
      </div>` : ''}
      ${l.status === 'qr' && l.qr ? `<div class="line-qr"><img src="${l.qr}" alt="QR Code" /><p class="hint">No celular de ${esc(l.label.split(' ')[0])}: WhatsApp → Configurações → Dispositivos conectados → Conectar dispositivo → escaneie.</p></div>
        <div class="row"><label>Ou conecte com código (sem câmera) <input data-field="phone" placeholder="+55 11 98765-4321" value="${esc(l.ownerWhatsapp ? `+${l.ownerWhatsapp}` : '')}" /></label><button type="button" class="btn small" data-act="pair">Gerar código</button></div>
        <div class="pairing-code" data-code hidden></div>` : ''}
      ${l.status === 'connecting' || (l.status === 'qr' && !l.qr) ? '<p class="hint">Gerando o QR Code… aguarde alguns segundos.</p>' : ''}
      ${l.status !== 'connected' && l.lastError ? `<p class="err">⚠️ ${esc(l.lastError)}</p>` : ''}
      <div class="row">
        <button type="button" class="btn small" data-act="restart">Reconectar</button>
        ${l.status === 'connected' ? '<button type="button" class="btn small danger" data-act="logout">Desconectar</button>' : ''}
        ${isAdmin() ? '<button type="button" class="btn small danger" data-act="remove">Remover</button>' : ''}
      </div>
    </article>`;
const sellerSlot = (u) => `
    <article class="panel line-card empty" data-owner="${esc(u.id)}">
      <span class="avatar lg">${esc(initials(u.name))}</span>
      <b>${esc(u.name)}</b>
      <span class="hint">${u.whatsapp ? `WhatsApp cadastrado: ${esc(fmtPhone(u.whatsapp))}` : 'Sem WhatsApp no cadastro: o número que conectar vira o dele.'}</span>
      <button type="button" class="btn primary small" data-act="add">${u.id === window.currentUser?.id ? 'Conectar meu WhatsApp' : 'Conectar WhatsApp'}</button>
    </article>`;
loaders.lines = async () => {
  const [list, users] = await Promise.all([api('/api/lines'), isAdmin() ? api('/api/users') : Promise.resolve([])]);
  const people = users.filter((u) => u.active && !list.some((l) => l.ownerId === u.id));
  // Todo vendedor ativo aparece: conectado (cartão da conexão) ou com o botão para conectar.
  const me = window.currentUser;
  const waiting = isAdmin() ? people.filter((u) => u.role === 'seller') : list.length ? [] : [me];
  const html = list.map((l) => lineCard(l, people)).join('') + waiting.map(sellerSlot).join('')
    || `<p class="muted">${isAdmin() ? 'Cadastre os vendedores na aba Equipe: cada um aparece aqui para conectar o WhatsApp dele.' : ''}</p>`;
  $$('[data-lines-grid]').forEach((grid) => {
    const typing = grid.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
    if (!typing) grid.innerHTML = html;
  });
  $('#btnAddLine').hidden = !isAdmin();
  if ($('#connSummary')) {
    const on = list.filter((l) => l.status === 'connected').length;
    $('#connSummary').innerHTML = `<span><i class="ldot disponivel"></i>${on} de ${list.length + waiting.length} vendedores conectados</span><span>🤖 IA ligada em ${list.filter((l) => l.agent !== false).length}</span>${list.some((l) => l.verified === false) ? '<span>⚠️ número diferente do cadastro</span>' : ''}`;
  }
};
async function addLine(ownerId = null) {
  try {
    await api('/api/lines', { method: 'POST', body: ownerId ? { ownerId } : { label: 'WhatsApp da equipe' } });
    toast('O QR Code aparece em alguns segundos.');
    loaders.lines();
  } catch (err) {
    toast(err.message, true);
  }
}
$('#btnAddLine').addEventListener('click', () => addLine());
document.addEventListener('change', async (e) => {
  const card = e.target.closest('[data-lines-grid] [data-line]');
  if (!card || !['label', 'ownerId'].includes(e.target.dataset.field)) return;
  try {
    await api(`/api/lines/${card.dataset.line}`, { method: 'PATCH', body: { [e.target.dataset.field]: e.target.value } });
    toast('Salvo');
    loaders.lines();
  } catch (err) {
    toast(err.message, true);
  }
});
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-lines-grid] [data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === 'add') return addLine(btn.closest('[data-owner]')?.dataset.owner);
  const card = btn.closest('[data-line]');
  if (!card) return;
  const id = card.dataset.line;
  try {
    if (act === 'ai') {
      const on = btn.getAttribute('aria-pressed') !== 'true';
      await api(`/api/lines/${id}`, { method: 'PATCH', body: { agent: on } });
      toast(on ? '🤖 IA ligada: ela responde os clientes deste WhatsApp' : 'IA desligada neste WhatsApp');
    }
    if (act === 'usephone') {
      const line = (await api('/api/lines')).find((l) => l.id === id);
      if (!confirm(`Trocar o WhatsApp do cadastro de ${line.ownerName} para ${fmtPhone(line.phone)}?`)) return;
      await api(`/api/users/${line.ownerId}`, { method: 'PATCH', body: { whatsapp: line.phone } });
      toast('Cadastro atualizado');
    }
    if (act === 'pair') {
      const r = await api(`/api/lines/${id}/pairing-code`, { method: 'POST', body: { phone: $('[data-field="phone"]', card).value } });
      const box = $('[data-code]', card);
      box.hidden = false;
      box.textContent = r.code;
      return;
    }
    if (act === 'restart') await api(`/api/lines/${id}/restart`, { method: 'POST' });
    if (act === 'logout') {
      if (!confirm('Desconectar este WhatsApp? Vai ser preciso escanear o QR Code de novo.')) return;
      await api(`/api/lines/${id}/logout`, { method: 'POST' });
    }
    if (act === 'remove') {
      if (!confirm('Remover esta conexão? As conversas ficam guardadas.')) return;
      await api(`/api/lines/${id}`, { method: 'DELETE' });
    }
    loaders.lines();
  } catch (err) {
    toast(err.message, true);
  }
});
let lineRefresh;
function onLineStatus() {
  clearTimeout(lineRefresh);
  lineRefresh = setTimeout(() => {
    if ($('#tab-lines').classList.contains('active') || $('#tab-connection').classList.contains('active')) loaders.lines();
  }, 400);
}
{
  const loadConnection = loaders.connection;
  loaders.connection = async (...args) => {
    await loadConnection?.(...args);
    await loaders.lines();
  };
}

// ---------- PAGAMENTOS (Pix) ----------
const PAY_STATUS = {
  pending: '<span class="badge paused">⏳ Aguardando</span>',
  paid: '<span class="badge done">✅ Pago</span>',
  canceled: '<span class="badge canceled">✖ Cancelado</span>',
};
const brl = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
loaders.payments = async () => {
  const list = await api('/api/payments');
  const month = new Date().toISOString().slice(0, 7);
  const paidMonth = list.filter((p) => p.status === 'paid' && String(p.paidAt).startsWith(month));
  const pending = list.filter((p) => p.status === 'pending');
  $('#payKpis').innerHTML = [
    ['Recebido no mês', brl(paidMonth.reduce((s, p) => s + p.amount, 0)), `${paidMonth.length} Pix confirmado(s)`, 'money'],
    ['Aguardando pagamento', brl(pending.reduce((s, p) => s + p.amount, 0)), `${pending.length} cobrança(s)${pending.some((p) => p.claimedAt) ? ' · 🔔 tem cliente dizendo que pagou' : ''}`, 'schedules'],
  ].map(([l, v, sub, ico]) => `<div class="card kpi"><div class="kpi-head"><span class="label">${l}</span><span class="kpi-ico">${icon(ico, 16)}</span></div><div class="value">${v}</div><div class="sub">${sub}</div></div>`).join('');
  $('#payTable').innerHTML = `<thead><tr><th>Data</th><th>Cliente</th><th>Valor</th><th>Referente a</th><th>Situação</th><th>Vendedor</th><th></th></tr></thead><tbody>${list.map((p) => `
    <tr data-pay="${esc(p.id)}">
      <td>${fmtDate(p.createdAt)}</td>
      <td><b>${esc(p.payerName || p.leadName || '—')}</b>${p.leadCode ? ` <span class="lead-code">${esc(p.leadCode)}</span>` : ''}</td>
      <td><b>${brl(p.amount)}</b></td>
      <td class="small">${esc(p.description)}</td>
      <td>${PAY_STATUS[p.status] || p.status}${p.status === 'pending' && p.claimedAt ? '<br><span class="status-warn small">🔔 cliente disse que pagou</span>' : ''}${p.status === 'paid' ? `<br><span class="hint">${fmtDate(p.paidAt)} · ${esc(p.confirmedBy || '')}</span>` : ''}</td>
      <td>${esc(p.ownerName || '—')}</td>
      <td class="row">
        ${p.status === 'pending' ? `<a class="btn small" href="/api/payments/${esc(p.id)}/qr" target="_blank" rel="noopener">QR</a>
          ${p.convKey ? '<button class="btn small" data-act="resend">Reenviar</button>' : ''}
          ${isAdmin() ? '<button class="btn small primary" data-act="confirm">Confirmar</button>' : ''}
          <button class="btn small danger" data-act="cancel">Cancelar</button>` : ''}
        ${p.status === 'paid' ? `<a class="btn small" href="/api/payments/${esc(p.id)}/receipt" target="_blank" rel="noopener">🧾 Recibo nº ${String(p.receiptNo).padStart(4, '0')}</a>` : ''}
      </td>
    </tr>`).join('') || '<tr><td colspan="7" class="muted">Nenhum Pix gerado ainda.</td></tr>'}</tbody>`;
  $('#btnNotifyPerm').hidden = !('Notification' in window) || Notification.permission === 'granted';
};
$('#payTable').addEventListener('click', async (e) => {
  const act = e.target.closest('button[data-act]')?.dataset.act;
  const id = e.target.closest('[data-pay]')?.dataset.pay;
  if (!act || !id) return;
  try {
    if (act === 'confirm') {
      if (!confirm('Confirmar que o Pix caiu na conta? A venda fecha, o recibo vai para o cliente e o aviso para o WhatsApp.')) return;
      await api(`/api/payments/${id}/confirm`, { method: 'POST' });
      toast('✅ Pagamento confirmado e recibo enviado');
    }
    if (act === 'cancel') {
      if (!confirm('Cancelar esta cobrança?')) return;
      await api(`/api/payments/${id}/cancel`, { method: 'POST' });
    }
    if (act === 'resend') {
      await api(`/api/payments/${id}/resend`, { method: 'POST' });
      toast('Pix reenviado ao cliente');
    }
    loaders.payments();
  } catch (err) {
    toast(err.message, true);
  }
});
$('#btnNotifyPerm').addEventListener('click', async () => {
  const r = await Notification.requestPermission();
  toast(r === 'granted' ? '🔔 Pronto: este aparelho avisa quando cair um Pix (com o painel aberto)' : 'O navegador não liberou as notificações', r !== 'granted');
  loaders.payments();
});

// Botão "Gerar Pix" na ficha do cliente.
$('#btnLeadPix').addEventListener('click', async () => {
  const l = crmState.current;
  if (!l?.id) return;
  const value = prompt('Valor do Pix (R$). Deixe em branco para usar a regra da reserva:', '');
  if (value === null) return;
  try {
    const p = await api('/api/payments', { method: 'POST', body: { leadId: l.id, amount: value ? Number(value.replace(/\./g, '').replace(',', '.')) : undefined, adults: l.people } });
    toast(p.convKey ? `Pix de ${brl(p.amount)} enviado ao cliente` : `Pix de ${brl(p.amount)} gerado (o cliente não tem conversa ligada: copie em Pagamentos)`);
    openLead(l.id);
  } catch (err) {
    toast(err.message, true);
  }
});

function onPaymentPaid(d) {
  const text = `💰 Pix confirmado: ${brl(d.amount)}${d.name ? ` de ${d.name}` : ''}`;
  toast(text);
  try {
    if ('Notification' in window && Notification.permission === 'granted') new Notification('Venda fechada! Pix confirmado', { body: `${text}\n${d.description || ''}`, icon: '/img/migra-emblema.png' });
  } catch {}
  if ($('#tab-payments').classList.contains('active')) loaders.payments();
  onCrmEvent();
}
function onPaymentEvent() {
  if ($('#tab-payments').classList.contains('active')) loaders.payments();
}
// Cadastros aguardando liberação (vendedores que se cadastraram pelo link).
$('#teamPending').addEventListener('click', async (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  const id = e.target.closest('[data-user]')?.dataset.user;
  if (!id || !['approve', 'reject'].includes(act)) return;
  try {
    if (act === 'reject' && !confirm('Recusar este cadastro? Ele será apagado.')) return;
    await api(`/api/users/${id}/${act}`, { method: 'POST' });
    toast(act === 'approve' ? 'Acesso liberado: a pessoa recebe o aviso no WhatsApp' : 'Cadastro recusado');
    loaders.team();
  } catch (err) {
    toast(err.message, true);
  }
});

// ---------- ORÇAMENTOS (vendedores e administrador) ----------
const quoteState = { packages: [], timer: null, last: null };
const qf = () => $('#quoteForm');
const todayLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const addDaysIso = (iso, d) => { const x = new Date(`${iso}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
function quoteItemRow(name = '', qty = 1) {
  const div = document.createElement('div');
  div.className = 'quote-item';
  div.innerHTML = `<select data-q="pkg">${quoteState.packages.map((p) => `<option value="${esc(p.name)}"${p.name === name ? ' selected' : ''}>${esc(p.name)} · ${brl2(p.price)}/pessoa</option>`).join('')}</select>
    <input data-q="qty" type="number" min="1" max="50" value="${qty}" title="Pessoas neste pacote" />
    <button type="button" class="btn small" data-q="del" title="Remover">✕</button>`;
  $('#quoteItems').append(div);
}
function quoteParcelRows(list) {
  $('#quoteParcels').innerHTML = `${list.map((p, i) => `<div class="quote-parcel"><b>${i + 1}ª</b>
      <label class="inline">% do saldo <input data-p="pct" type="number" min="1" max="100" step="0.5" value="${p.pct}" /></label>
      <input data-p="date" type="date" value="${p.date}" />
      <button type="button" class="btn small" data-p="del" title="Remover">✕</button></div>`).join('')}
    <button type="button" class="btn small" id="btnQuoteAddParcel">➕ Adicionar parcela</button>`;
}
function quoteBody() {
  const f = qf();
  const items = $$('#quoteItems .quote-item').map((r) => ({ pacote: $('[data-q="pkg"]', r).value, quantidade: Number($('[data-q="qty"]', r).value) || 1 }));
  const custom = f.planMode.value === 'custom';
  const parcels = custom ? $$('#quoteParcels .quote-parcel').map((r) => ({ pct: Number($('[data-p="pct"]', r).value), date: $('[data-p="date"]', r).value })) : null;
  return { client: f.client.value.trim(), phone: f.phone.value.trim(), start: f.start.value, adults: Number(f.adults.value) || 1, items, parcels };
}
async function quotePreview() {
  const b = quoteBody();
  if (!b.items.length) return ($('#quotePreview').innerHTML = '<p class="muted">Adicione um pacote.</p>');
  try {
    const r = await api('/api/quotes/preview', { method: 'POST', body: b });
    quoteState.last = r;
    const p = r.plan;
    $('#quotePreview').innerHTML = `<div class="quote-sum"><span class="hint">Investimento total · ${p.people} pessoa(s)</span><span class="big">${brl2(p.total)}</span>
      <div class="row-x"><span><b>Entrada na reserva</b> · ${diaSemana(p.start)}<div class="hint">${brl2(p.base)} de sinal + ${brl2(p.perAdult)} × ${p.adults} adulto(s) das certidões</div></span><b>${brl2(p.entry)}</b></div>
      ${p.parcels.map((x) => `<div class="row-x"><span>${esc(x.label)} (${x.pct}%)<div class="hint">${esc(diaSemana(x.date))}${x.moved ? ' · fim de semana, passou para segunda' : ''}</div></span><b>${brl2(x.value)}</b></div>`).join('')}</div>`;
  } catch (err) {
    $('#quotePreview').innerHTML = `<p class="err">${esc(err.message)}</p>`;
  }
}
const quotePreviewSoon = () => { clearTimeout(quoteState.timer); quoteState.timer = setTimeout(quotePreview, 350); };
async function loadQuoteList() {
  const list = await api(`/api/quotes?q=${encodeURIComponent($('#quoteSearch').value || '')}`);
  const admin = window.currentUser?.role === 'admin';
  $('#quoteTable').innerHTML = `<thead><tr><th>Número</th><th>Emissão</th><th>Cliente</th><th>Pacotes</th><th>Total</th>${admin ? '<th>Vendedor</th>' : ''}<th>Validade</th><th></th></tr></thead>
    <tbody>${list.map((q) => `<tr><td><b>${esc(q.number)}</b></td><td>${esc(q.issued.split('-').reverse().join('/'))}</td>
      <td>${esc(q.client)}<div class="hint">${q.phone ? esc(fmtPhone(q.phone)) : ''}</div></td>
      <td class="small">${q.items.map((i) => `${esc(i.name)} × ${i.qty}`).join('<br>')}${q.custom ? '<div class="hint">parcelas personalizadas</div>' : ''}</td>
      <td><b>${brl2(q.total)}</b></td>${admin ? `<td>${esc(q.createdBy || q.consultant)}</td>` : ''}
      <td>${q.expired ? '<span class="badge canceled">Vencido</span>' : `<span class="badge done">até ${esc(q.validUntil.split('-').reverse().join('/'))}</span>`}</td>
      <td><a class="btn small" href="${q.url}" target="_blank" rel="noopener">Abrir PDF</a> <a class="btn small" href="${q.url}?download=1">Baixar</a></td></tr>`).join('') || `<tr><td colspan="${admin ? 8 : 7}" class="muted">Nenhum orçamento ainda.</td></tr>`}</tbody>`;
}
loaders.quotes = async () => {
  if (!quoteState.packages.length) {
    const meta = await api('/api/crm/stages');
    quoteState.packages = meta.packages || [];
  }
  if (!$('#quoteItems').children.length) {
    qf().start.value = todayLocal();
    quoteItemRow(quoteState.packages.find((p) => /ouro/i.test(p.name))?.name || quoteState.packages[0]?.name, 1);
    quotePreview();
  }
  loadQuoteList();
};
$('#btnQuoteAddItem').addEventListener('click', () => { quoteItemRow(quoteState.packages[0]?.name, 1); quotePreviewSoon(); });
$('#quoteItems').addEventListener('click', (e) => {
  if (e.target.dataset.q === 'del') { e.target.closest('.quote-item').remove(); quotePreviewSoon(); }
});
qf().addEventListener('input', quotePreviewSoon);
qf().addEventListener('change', (e) => {
  if (e.target.name === 'planMode') {
    const custom = e.target.value === 'custom';
    $('#quoteParcels').hidden = !custom;
    if (custom && !$('#quoteParcels').children.length) {
      // Começa pelas datas e percentuais do padrão, para o vendedor só ajustar.
      const p = quoteState.last?.plan;
      quoteParcelRows(p ? p.parcels.map((x) => ({ pct: x.pct, date: x.date })) : [{ pct: 50, date: addDaysIso(qf().start.value || todayLocal(), 15) }, { pct: 30, date: addDaysIso(qf().start.value || todayLocal(), 90) }, { pct: 20, date: addDaysIso(qf().start.value || todayLocal(), 120) }]);
    }
  }
  quotePreviewSoon();
});
qf().addEventListener('submit', (e) => e.preventDefault());
$('#quoteParcels').addEventListener('click', (e) => {
  if (e.target.dataset.p === 'del') { e.target.closest('.quote-parcel').remove(); quotePreviewSoon(); }
  if (e.target.id === 'btnQuoteAddParcel') {
    const rows = $$('#quoteParcels .quote-parcel').map((r) => ({ pct: Number($('[data-p="pct"]', r).value), date: $('[data-p="date"]', r).value }));
    const last = rows.at(-1)?.date || qf().start.value || todayLocal();
    quoteParcelRows([...rows, { pct: 0, date: addDaysIso(last, 30) }]);
    quotePreviewSoon();
  }
});
$('#btnQuoteCreate').addEventListener('click', async (e) => {
  const b = quoteBody();
  if (!b.client) return toast('Informe o nome do cliente', true);
  e.target.disabled = true;
  try {
    const q = await api('/api/quotes', { method: 'POST', body: b });
    const phone = String(b.phone || '').replace(/\D/g, '');
    $('#quoteResult').innerHTML = `<div class="quote-result"><b>✅ Orçamento ${esc(q.number)} gerado · ${brl2(q.total)}</b>
      <div class="row"><a class="btn primary small" href="${q.url}" target="_blank" rel="noopener">Abrir PDF</a><a class="btn small" href="${q.url}?download=1">Baixar PDF</a>
      <button type="button" class="btn small" id="btnQuoteCopy">Copiar mensagem</button>
      ${phone ? `<a class="btn small" href="https://wa.me/${phone}?text=${encodeURIComponent(q.text)}" target="_blank" rel="noopener">Abrir WhatsApp do cliente</a>` : ''}</div>
      <p class="hint">Baixe o PDF e envie junto com a mensagem pelo seu WhatsApp.</p></div>`;
    $('#btnQuoteCopy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(q.text); toast('Mensagem copiada'); } catch { prompt('Copie a mensagem:', q.text); }
    });
    loadQuoteList();
  } catch (err) {
    toast(err.message, true);
  } finally {
    e.target.disabled = false;
  }
});
$('#quoteSearch').addEventListener('input', () => { clearTimeout(quoteState.search); quoteState.search = setTimeout(loadQuoteList, 300); });

// Ficha de dados: link para o cliente só tocar e preencher (o vendedor copia a mensagem ou abre o WhatsApp do cliente).
$('#btnQuoteFicha').addEventListener('click', async (e) => {
  const b = quoteBody();
  if (!b.phone) return toast('Informe o WhatsApp do cliente', true);
  e.target.disabled = true;
  try {
    const r = await api('/api/closing/link', { method: 'POST', body: { client: b.client, phone: b.phone, adults: b.adults, servico: b.items.map((i) => `${i.pacote} × ${i.quantidade}`).join(', ') } });
    const phone = b.phone.replace(/\D/g, '');
    $('#quoteResult').innerHTML = `<div class="quote-result"><b>📝 Ficha de dados pronta para o cliente</b>
      <p class="hint">O cliente toca no link, preenche os campos no celular e toca em "Enviar meus dados". Depois disso, o sistema manda sozinho a confirmação, o orçamento com o nome completo dele, o Pix e o termo da reserva.</p>
      <div class="row"><a class="btn primary small" href="https://wa.me/${phone}?text=${encodeURIComponent(r.text)}" target="_blank" rel="noopener">Abrir WhatsApp do cliente com a mensagem</a>
      <button type="button" class="btn small" id="btnFichaCopy">Copiar mensagem</button></div></div>`;
    $('#btnFichaCopy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(r.text); toast('Mensagem copiada'); } catch { prompt('Copie a mensagem:', r.text); }
    });
  } catch (err) {
    toast(err.message, true);
  } finally {
    e.target.disabled = false;
  }
});
