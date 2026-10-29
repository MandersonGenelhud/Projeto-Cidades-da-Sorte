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
  const kpi = (label, value, sub = '', tone = '') => `<div class="card kpi ${tone}"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  $('#salesKpis').innerHTML = [
    kpi('Vendas fechadas', money(s.wonValue), `${s.won} venda(s) · ticket médio ${money(s.avgTicket)}`),
    kpi('Conversão', s.conversion === null ? '—' : `${s.conversion}%`, `${s.won} fechadas de ${s.won + s.lost} decididas`),
    kpi('Prospectos novos', s.newLeads, 'no período'),
    kpi('Em negociação', money(s.openValue), `${s.openLeads} prospecto(s) em aberto`),
    kpi('Retornos', `${s.followUps.today} hoje`,
      s.followUps.overdue ? `<span class="status-warn">⚠️ ${s.followUps.overdue} atrasado(s)</span> · ${s.followUps.next30} nos próximos 30 dias` : `${s.followUps.next30} nos próximos 30 dias · ${s.followUps.later} depois`,
      s.followUps.overdue ? 'warn' : ''),
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
};

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
  $('#teamList').innerHTML = users.map((u) => `
    <div class="item ${u.active ? '' : 'disabled'}" data-user="${esc(u.id)}">
      <div class="grow"><b>${esc(u.name)}</b> ${u.role === 'admin' ? '<span class="badge running">Administrador</span>' : '<span class="badge pending">Vendedor</span>'}
        ${u.active ? '' : '<span class="badge canceled">Inativo</span>'}
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
  f.specialists.value = (c.specialists || []).map((s) => [s.topic, s.name, s.whatsapp ? `+${s.whatsapp}` : ''].join(' = ')).join('\n');
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
  toast(`Cadastrado! Passe o login "${f.login.value}" e a senha para a pessoa.`);
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
      panelUrl: f.panelUrl.value.trim(),
    } },
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

// ---------- NÚMEROS DA EQUIPE ----------
const LINE_STATUS = { connected: '🟢 Conectado', qr: '🟡 Aguardando QR Code', connecting: '⏳ Conectando…', disconnected: '⚪ Desconectado' };
loaders.lines = async () => {
  const [list, users] = await Promise.all([api('/api/lines'), isAdmin() ? api('/api/users') : Promise.resolve([])]);
  const people = users.filter((u) => u.active);
  $('#btnAddLine').hidden = !isAdmin() || list.length >= 6;
  $('#linesGrid').innerHTML = list.map((l) => `
    <article class="panel line-card" data-line="${esc(l.id)}">
      <div class="conv-header">
        <div><h2>${esc(l.label)}</h2><span class="hint">${LINE_STATUS[l.status] || l.status}${l.me?.phone ? ` · ${esc(fmtPhone(l.me.phone))}` : ''}</span></div>
        <label class="check"><input type="checkbox" data-act="agent" ${l.agent !== false ? 'checked' : ''} /> IA responde</label>
      </div>
      ${isAdmin() ? `<div class="row">
        <label>Nome do número <input data-field="label" value="${esc(l.label)}" /></label>
        <label>Vendedor <select data-field="ownerId"><option value="">—</option>${people.map((u) => `<option value="${esc(u.id)}" ${u.id === l.ownerId ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>
      </div>` : ''}
      ${l.status === 'qr' && l.qr ? `<div class="line-qr"><img src="${l.qr}" alt="QR Code" /><p class="hint">No celular do vendedor: WhatsApp → Configurações → Dispositivos conectados → Conectar dispositivo → escaneie.</p></div>
        <div class="row"><label>Ou conecte com código (sem câmera) <input data-field="phone" placeholder="+595 981 123456" /></label><button type="button" class="btn small" data-act="pair">Gerar código</button></div>
        <div class="pairing-code" data-code hidden></div>` : ''}
      ${l.status === 'connected' ? '<p class="hint">✅ Pronto. As conversas deste número aparecem em <b>Conversas</b>.</p>' : ''}
      <div class="row">
        <button type="button" class="btn small" data-act="restart">🔄 Reconectar</button>
        ${l.status === 'connected' ? '<button type="button" class="btn small danger" data-act="logout">Desconectar</button>' : ''}
        ${isAdmin() ? '<button type="button" class="btn small danger" data-act="remove">Remover</button>' : ''}
      </div>
    </article>`).join('') || `<p class="muted">${isAdmin() ? 'Nenhum número da equipe ainda. Clique em "Adicionar número".' : 'O administrador ainda não criou um número para você.'}</p>`;
};
$('#btnAddLine').addEventListener('click', async () => {
  try {
    const n = $$('#linesGrid .line-card').length + 1;
    await api('/api/lines', { method: 'POST', body: { label: `Número ${n}` } });
    toast('Número criado. Aguarde o QR Code aparecer.');
    loaders.lines();
  } catch (err) {
    toast(err.message, true);
  }
});
$('#linesGrid').addEventListener('change', async (e) => {
  const card = e.target.closest('[data-line]');
  if (!card) return;
  const id = card.dataset.line;
  try {
    if (e.target.dataset.act === 'agent') await api(`/api/lines/${id}`, { method: 'PATCH', body: { agent: e.target.checked } });
    else if (e.target.dataset.field === 'label' || e.target.dataset.field === 'ownerId') {
      await api(`/api/lines/${id}`, { method: 'PATCH', body: { [e.target.dataset.field]: e.target.value } });
      toast('Salvo');
    }
  } catch (err) {
    toast(err.message, true);
  }
});
$('#linesGrid').addEventListener('click', async (e) => {
  const act = e.target.closest('button[data-act]')?.dataset.act;
  const card = e.target.closest('[data-line]');
  if (!act || !card) return;
  const id = card.dataset.line;
  try {
    if (act === 'pair') {
      const r = await api(`/api/lines/${id}/pairing-code`, { method: 'POST', body: { phone: $('[data-field="phone"]', card).value } });
      const box = $('[data-code]', card);
      box.hidden = false;
      box.textContent = r.code;
      return;
    }
    if (act === 'restart') await api(`/api/lines/${id}/restart`, { method: 'POST' });
    if (act === 'logout') {
      if (!confirm('Desconectar este número? Vai ser preciso escanear o QR Code de novo.')) return;
      await api(`/api/lines/${id}/logout`, { method: 'POST' });
    }
    if (act === 'remove') {
      if (!confirm('Remover este número da equipe? As conversas ficam guardadas.')) return;
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
  // Não redesenha enquanto alguém digita no cartão.
  lineRefresh = setTimeout(() => {
    if ($('#tab-lines').classList.contains('active') && !$('#linesGrid').contains(document.activeElement)) loaders.lines();
  }, 400);
}
