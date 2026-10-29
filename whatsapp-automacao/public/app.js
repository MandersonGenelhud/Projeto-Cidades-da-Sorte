// Painel web da automação de WhatsApp (JavaScript puro, sem build).
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const fmtPhone = (p) => {
  const s = String(p || '');
  const br = s.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  if (br) return `(${br[1]}) ${br[2]}-${br[3]}`;
  const py = s.match(/^595(\d{3})(\d{3})(\d{3,4})$/);
  if (py) return `+595 ${py[1]} ${py[2]} ${py[3]}`;
  return /^\d{8,15}$/.test(s) ? `+${s}` : s;
};

const STATUS_LABEL = {
  draft: 'Rascunho', running: 'Enviando', paused: 'Pausada', done: 'Concluída', canceled: 'Cancelada',
  pending: 'Pendente', sent: 'Enviada', failed: 'Falhou', skipped: 'Ignorada',
};
const LOG_LABEL = {
  sent: '📤 Enviada', received: '📥 Recebida', autoreply: '🤖 Resposta automática', error: '⚠️ Erro', system: 'ℹ️ Sistema',
};

function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.className = `show${isError ? ' error' : ''}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.className = ''), 3500);
}

async function api(url, { method = 'GET', body, form } = {}) {
  const opts = { method, headers: {} };
  if (form) opts.body = form;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (res.status === 401 && data?.login) {
    location.href = '/login.html';
    throw new Error(data.error);
  }
  if (!res.ok) throw new Error(data?.error || `Erro ${res.status}`);
  return data;
}

/** Envia o arquivo do input (se houver) e retorna o id do upload. */
async function uploadFrom(input) {
  const file = input?.files?.[0];
  if (!file) return undefined;
  const form = new FormData();
  form.append('file', file);
  const media = await api('/api/uploads', { method: 'POST', form });
  return media.id;
}

function withBusy(form, fn) {
  return async (ev) => {
    ev.preventDefault();
    const buttons = $$('button', form);
    buttons.forEach((b) => (b.disabled = true));
    try {
      await fn(ev);
    } catch (err) {
      toast(err.message, true);
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  };
}

const lines = (text) => String(text || '').split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);

// ---------- Navegação ----------
const loaders = {};
function showTab(name) {
  const btn = $(`nav button[data-tab="${name}"]`);
  if (!btn || (btn.hasAttribute('data-admin') && window.currentUser?.role !== 'admin')) name = window.currentUser?.role === 'admin' ? 'sales' : 'leads';
  $$('nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`));
  location.hash = name;
  window.onTabShown?.(name);
  loaders[name]?.();
  // Aviso da IA desligada nas telas onde ele aparece.
  if (window.currentUser?.role === 'admin' && $(`#tab-${name} [data-ai-banner]`)) renderAgentStatus().catch(() => {});
}
$$('nav button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ---------- Status / conexão ----------
let connState = { status: 'disconnected' };
function renderStatus(state) {
  connState = state;
  const pill = $('#connPill');
  pill.className = `conn-pill ${state.status}`;
  $('#connText').textContent = {
    connected: `Conectado ${state.me?.phone ? `· ${fmtPhone(state.me.phone)}` : ''}`,
    qr: 'Aguardando QR Code',
    connecting: 'Conectando…',
    disconnected: 'Desconectado',
  }[state.status];

  const mode = state.mode || 'qr';
  $$('[name="connMode"]').forEach((r) => (r.checked = r.value === mode));
  $('#qrPanel').hidden = mode !== 'qr';
  $('#cloudPanel').hidden = mode !== 'cloud';
  if (mode === 'cloud') {
    $('#cloudStatus').innerHTML = state.status === 'connected'
      ? `<p>✅ Conectado à API oficial: <b>${esc(state.me?.name || '')}</b> ${esc(fmtPhone(state.me?.phone))}</p>`
      : `<p>⚠️ ${esc(state.error || 'Não conectado')}</p>`;
  }

  $('#pairingBox').hidden = state.status === 'connected';
  const area = $('#qrArea');
  if (state.status === 'connected') {
    area.innerHTML = `<div class="ok">✅</div><h2>WhatsApp conectado</h2><p>${esc(state.me?.name || '')} · ${esc(fmtPhone(state.me?.phone))}</p>`;
  } else if (state.status === 'qr' && state.qr) {
    area.innerHTML = `<img src="${state.qr}" alt="QR Code" /><p>Escaneie com o WhatsApp do celular</p>`;
  } else {
    area.innerHTML = '<p class="muted">Conectando ao WhatsApp… o QR Code aparecerá aqui.</p>';
  }
}

$('#btnRestart').addEventListener('click', async () => {
  await api('/api/connection/restart', { method: 'POST' });
  toast('Reconectando…');
});
$('#btnLogout').addEventListener('click', async () => {
  if (!confirm('Desconectar este número? Será preciso escanear o QR Code de novo.')) return;
  await api('/api/connection/logout', { method: 'POST' });
  toast('Número desconectado');
});

// ---------- Painel ----------
function logItem(l) {
  const who = l.phone ? fmtPhone(l.phone) : '';
  const extra = [l.name, l.campaign && `campanha "${l.campaign}"`, l.rule && `regra "${l.rule}"`, l.schedule && `agendamento "${l.schedule}"`]
    .filter(Boolean).join(' · ');
  return `<li><span class="time">${fmtDate(l.at)}</span><b>${LOG_LABEL[l.type] || esc(l.type)}</b> ${esc(who)} ${extra ? `<span class="muted">${esc(extra)}</span>` : ''}
    ${l.message ? `<span class="msg">${esc(l.message)}</span>` : ''}</li>`;
}

loaders.dashboard = async () => {
  const [s, logs] = await Promise.all([api('/api/stats'), api('/api/logs?limit=30')]);
  const cards = [
    ['Contatos', s.contacts], ['Enviadas hoje', s.today.sent], ['Recebidas hoje', s.today.received],
    ['Respostas do robô hoje', s.today.autoreplies], ['Erros hoje', s.today.errors],
    ['Regras ativas', s.rules], ['Agendamentos', s.schedules], ['Descadastrados', s.blacklist],
  ];
  $('#statsCards').innerHTML = cards.map(([l, v]) => `<div class="card"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('');
  $('#recentFeed').innerHTML = logs.map(logItem).join('') || '<li class="muted">Nada por aqui ainda.</li>';
  renderAgentStatus();
};

// ---------- Contatos ----------
let contactsCache = [];
async function loadTags() {
  const tags = await api('/api/tags');
  const opts = tags.map((t) => `<option value="${esc(t.tag)}">${esc(t.tag)} (${t.count})</option>`).join('');
  const current = $('#contactTag').value;
  $('#contactTag').innerHTML = `<option value="">Todas as etiquetas</option>${opts}`;
  $('#contactTag').value = current;
  $('#campTags').innerHTML = opts;
  $('#schTags').innerHTML = opts;
}

loaders.contacts = async () => {
  const q = encodeURIComponent($('#contactSearch').value);
  const tag = encodeURIComponent($('#contactTag').value);
  contactsCache = await api(`/api/contacts?q=${q}&tag=${tag}`);
  $('#contactsBody').innerHTML = contactsCache.slice(0, 1000).map((c) => `
    <tr>
      <td><input type="checkbox" class="rowCheck" value="${esc(c.id)}" /></td>
      <td>${esc(c.name) || '<span class="muted">sem nome</span>'}</td>
      <td>${esc(fmtPhone(c.phone))}</td>
      <td>${(c.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</td>
      <td>${c.blocked ? '<span class="badge failed">Descadastrado</span>' : '<span class="badge sent">Ativo</span>'}</td>
      <td>
        <button class="btn small" data-edit="${esc(c.id)}">✏️</button>
        <button class="btn small danger" data-del="${esc(c.id)}">🗑️</button>
      </td>
    </tr>`).join('');
  $('#contactsCount').textContent = `${contactsCache.length} contato(s)${contactsCache.length > 1000 ? ' — mostrando os 1000 primeiros' : ''}`;
  $('#checkAll').checked = false;
  loadTags();
};

let searchTimer;
$('#contactSearch').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(loaders.contacts, 300); });
$('#contactTag').addEventListener('change', loaders.contacts);
$('#checkAll').addEventListener('change', (e) => $$('.rowCheck').forEach((c) => (c.checked = e.target.checked)));

$('#contactsBody').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-del]')?.dataset.del;
  const edit = e.target.closest('[data-edit]')?.dataset.edit;
  if (del && confirm('Excluir este contato?')) {
    await api(`/api/contacts/${del}`, { method: 'DELETE' });
    loaders.contacts();
  }
  if (edit) {
    const c = contactsCache.find((x) => x.id === edit);
    const name = prompt('Nome', c.name);
    if (name === null) return;
    const tags = prompt('Etiquetas (separadas por vírgula)', (c.tags || []).join(', '));
    if (tags === null) return;
    await api(`/api/contacts/${edit}`, { method: 'PUT', body: { name, tags } });
    loaders.contacts();
  }
});

$('#btnDeleteSelected').addEventListener('click', async () => {
  const ids = $$('.rowCheck:checked').map((c) => c.value);
  if (!ids.length) return toast('Selecione contatos na tabela');
  if (!confirm(`Excluir ${ids.length} contato(s)?`)) return;
  await api('/api/contacts/bulk-delete', { method: 'POST', body: { ids } });
  loaders.contacts();
});

$('#formContact').addEventListener('submit', withBusy($('#formContact'), async (e) => {
  const f = e.target;
  const r = await api('/api/contacts', { method: 'POST', body: { name: f.name.value, phone: f.phone.value, tags: f.tags.value } });
  toast(r.added ? 'Contato adicionado' : 'Contato atualizado');
  f.reset();
  loaders.contacts();
}));

$('#formImport').addEventListener('submit', withBusy($('#formImport'), async (e) => {
  const f = e.target;
  const form = new FormData();
  if (f.file.files[0]) form.append('file', f.file.files[0]);
  form.append('text', f.text.value);
  form.append('tags', f.tags.value);
  const r = await api('/api/contacts/import', { method: 'POST', form });
  toast(`${r.added} novo(s), ${r.updated} atualizado(s)`);
  f.reset();
  loaders.contacts();
}));

$('#btnGroups').addEventListener('click', async () => {
  const dlg = $('#groupsDialog');
  dlg.showModal();
  $('#groupsList').innerHTML = '<p class="muted">Carregando grupos…</p>';
  try {
    const groups = await api('/api/groups');
    $('#groupsList').innerHTML = groups.length
      ? groups.map((g) => `<div class="item"><div class="grow"><b>${esc(g.name)}</b><div class="meta">${g.participants} participantes</div></div>
          <button class="btn small primary" data-group="${esc(g.id)}" data-name="${esc(g.name)}">Importar</button></div>`).join('')
      : '<p class="muted">Nenhum grupo encontrado.</p>';
  } catch (err) {
    $('#groupsList').innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }
});
$('#groupsList').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-group]');
  if (!btn) return;
  btn.disabled = true;
  try {
    const tag = prompt('Etiqueta para esses contatos', `grupo-${btn.dataset.name}`.toLowerCase().replace(/\s+/g, '-'));
    if (tag === null) return;
    const r = await api(`/api/groups/${encodeURIComponent(btn.dataset.group)}/import`, { method: 'POST', body: { tag } });
    toast(`${r.added} novo(s), ${r.updated} atualizado(s)`);
    loaders.contacts();
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
  }
});

// ---------- Campanhas ----------
function targetFrom(form, prefix) {
  const type = form.targetType.value;
  const target = { type };
  if (type === 'tags') target.tags = $$(`#${prefix}Tags option:checked`).map((o) => o.value);
  if (type === 'manual') target.phones = lines(form.phones.value);
  return target;
}
function bindTargetToggle(prefix) {
  const sel = $(`#${prefix}TargetType`);
  const update = () => {
    $(`#${prefix}TagsWrap`).hidden = sel.value !== 'tags';
    $(`#${prefix}PhonesWrap`).hidden = sel.value !== 'manual';
  };
  sel.addEventListener('change', update);
  update();
}
bindTargetToggle('camp');
bindTargetToggle('sch');

$('#btnAddVariation').addEventListener('click', () => {
  const n = $$('#campMessages textarea').length + 1;
  $('#campMessages').insertAdjacentHTML('beforeend', `<label>Mensagem ${n} <textarea name="message" rows="4"></textarea></label>`);
});

const campMessages = () => $$('#campMessages textarea').map((t) => t.value).filter((t) => t.trim());

$('#btnPreview').addEventListener('click', async () => {
  const f = $('#formCampaign');
  try {
    const r = await api('/api/campaigns/preview', { method: 'POST', body: { target: targetFrom(f, 'camp'), messages: campMessages() } });
    $('#campPreview').innerHTML = `<p><b>${r.total}</b> destinatário(s)${r.blocked ? `, ${r.blocked} descadastrado(s) serão ignorados` : ''}.</p>`
      + r.samples.map((s) => `<div class="muted">${esc(fmtPhone(s.phone))}</div><div class="bubble">${esc(s.text)}</div>`).join('');
  } catch (err) {
    toast(err.message, true);
  }
});

$('#formCampaign').addEventListener('submit', withBusy($('#formCampaign'), async (e) => {
  const f = e.target;
  const startNow = e.submitter?.value === 'start';
  if (startNow && connState.status !== 'connected') {
    if (!confirm('O WhatsApp não está conectado. A campanha vai aguardar a conexão. Continuar?')) return;
  }
  const mediaId = await uploadFrom(f.file);
  await api('/api/campaigns', {
    method: 'POST',
    body: {
      name: f.name.value,
      messages: campMessages(),
      mediaId,
      target: targetFrom(f, 'camp'),
      delayMin: f.delayMin.value,
      delayMax: f.delayMax.value,
      pauseEvery: f.pauseEvery.value,
      pauseMinutes: f.pauseMinutes.value,
      startNow,
    },
  });
  toast(startNow ? 'Campanha iniciada 🚀' : 'Rascunho salvo');
  f.reset();
  $('#campMessages').innerHTML = $('#campMessages label').outerHTML;
  $('#campPreview').innerHTML = '';
  bindTargetToggle('camp');
  applyDefaultDelays();
  loaders.campaigns();
}));

function campaignCard(c) {
  const done = c.counts.sent + c.counts.failed + c.counts.skipped;
  const pct = c.total ? Math.round((done / c.total) * 100) : 0;
  const actions = [];
  if (['draft', 'paused'].includes(c.status)) actions.push(`<button class="btn small primary" data-act="start">▶️ ${c.status === 'draft' ? 'Iniciar' : 'Retomar'}</button>`);
  if (c.status === 'running') actions.push('<button class="btn small" data-act="pause">⏸️ Pausar</button>');
  if (!['done', 'canceled'].includes(c.status)) actions.push('<button class="btn small danger" data-act="cancel">⏹️ Cancelar</button>');
  if (c.counts.failed) actions.push('<button class="btn small" data-act="retry-failed">🔁 Reenviar falhas</button>');
  actions.push('<button class="btn small" data-act="detail">📋 Detalhes</button>');
  actions.push('<button class="btn small danger" data-act="delete">🗑️</button>');
  return `<div class="item" data-id="${esc(c.id)}">
    <div class="grow">
      <b>${esc(c.name)}</b> <span class="badge ${c.status}">${STATUS_LABEL[c.status]}</span>
      <div class="meta">✅ ${c.counts.sent} enviadas · ❌ ${c.counts.failed} falhas · ⏭️ ${c.counts.skipped} ignoradas · ⏳ ${c.counts.pending} pendentes — total ${c.total}
Intervalo ${c.delayMin}-${c.delayMax}s · criada em ${fmtDate(c.createdAt)}</div>
      <div class="progress"><div style="width:${pct}%"></div></div>
    </div>
    <div class="row">${actions.join('')}</div>
  </div>`;
}

let campaignsCache = [];
function renderCampaigns() {
  $('#campaignsList').innerHTML = campaignsCache.map(campaignCard).join('') || '<p class="muted">Nenhuma campanha criada.</p>';
}
loaders.campaigns = async () => {
  campaignsCache = await api('/api/campaigns');
  renderCampaigns();
  loadTags();
};

$('#campaignsList').addEventListener('click', async (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  const id = e.target.closest('[data-id]')?.dataset.id;
  if (!act || !id) return;
  try {
    if (act === 'detail') return showCampaign(id);
    if (act === 'delete') {
      if (!confirm('Excluir esta campanha?')) return;
      await api(`/api/campaigns/${id}`, { method: 'DELETE' });
    } else if (act === 'cancel') {
      if (!confirm('Cancelar esta campanha?')) return;
      await api(`/api/campaigns/${id}/cancel`, { method: 'POST' });
    } else {
      await api(`/api/campaigns/${id}/${act}`, { method: 'POST' });
    }
    loaders.campaigns();
  } catch (err) {
    toast(err.message, true);
  }
});

async function showCampaign(id) {
  const c = await api(`/api/campaigns/${id}`);
  $('#campaignDetail').innerHTML = `<h2>${esc(c.name)} <span class="badge ${c.status}">${STATUS_LABEL[c.status]}</span></h2>
    ${c.messages.map((m) => `<div class="bubble">${esc(m)}</div>`).join('')}
    ${c.media ? `<p class="muted">📎 ${esc(c.media.fileName)}</p>` : ''}
    <div class="table-wrap"><table><thead><tr><th>Contato</th><th>Status</th><th>Quando</th><th>Erro</th></tr></thead><tbody>
    ${c.recipients.map((r) => `<tr><td>${esc(r.name)} ${esc(fmtPhone(r.phone))}</td><td><span class="badge ${r.status}">${STATUS_LABEL[r.status]}</span></td>
      <td>${fmtDate(r.at)}</td><td class="muted">${esc(r.error || '')}</td></tr>`).join('')}
    </tbody></table></div>`;
  $('#campaignDialog').showModal();
}

// ---------- Regras ----------
let rulesCache = [];
const MATCH_LABEL = { contains: 'contém', exact: 'é exatamente', startsWith: 'começa com', regex: 'regex', any: 'qualquer mensagem' };

loaders.rules = async () => {
  rulesCache = await api('/api/rules');
  $('#rulesList').innerHTML = rulesCache.map((r) => `
    <div class="item ${r.enabled ? '' : 'disabled'}" data-id="${esc(r.id)}">
      <div class="grow">
        <b>${esc(r.name)}</b> ${r.enabled ? '' : '<span class="badge draft">Desativada</span>'}
        <div class="meta">Quando ${MATCH_LABEL[r.matchType]} ${r.matchType === 'any' ? '' : `<b>${esc(r.keywords.join(', '))}</b>`}${r.addTag ? ` · etiqueta: ${esc(r.addTag)}` : ''}${r.media ? ` · 📎 ${esc(r.media.fileName)}` : ''}</div>
        <div class="bubble">${esc(r.response)}</div>
      </div>
      <div class="row">
        <button class="btn small" data-act="toggle">${r.enabled ? '⏸️ Desativar' : '▶️ Ativar'}</button>
        <button class="btn small" data-act="edit">✏️ Editar</button>
        <button class="btn small danger" data-act="delete">🗑️</button>
      </div>
    </div>`).join('') || '<p class="muted">Nenhuma regra criada.</p>';
};

function resetRuleForm() {
  const f = $('#formRule');
  f.reset();
  f.id.value = '';
  $('#ruleFormTitle').textContent = 'Nova regra';
}
$('#btnRuleReset').addEventListener('click', resetRuleForm);

$('#formRule').addEventListener('submit', withBusy($('#formRule'), async (e) => {
  const f = e.target;
  const mediaId = await uploadFrom(f.file);
  await api('/api/rules', {
    method: 'POST',
    body: {
      id: f.id.value || undefined,
      name: f.name.value,
      matchType: f.matchType.value,
      keywords: f.keywords.value,
      response: f.response.value,
      addTag: f.addTag.value,
      priority: f.priority.value,
      enabled: f.enabled.checked,
      mediaId,
    },
  });
  toast('Regra salva');
  resetRuleForm();
  loaders.rules();
}));

$('#rulesList').addEventListener('click', async (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  const id = e.target.closest('[data-id]')?.dataset.id;
  const rule = rulesCache.find((r) => r.id === id);
  if (!act || !rule) return;
  if (act === 'delete') {
    if (!confirm('Excluir esta regra?')) return;
    await api(`/api/rules/${id}`, { method: 'DELETE' });
  } else if (act === 'toggle') {
    await api('/api/rules', { method: 'POST', body: { ...rule, media: undefined, enabled: !rule.enabled } });
  } else if (act === 'edit') {
    const f = $('#formRule');
    f.id.value = rule.id;
    f.name.value = rule.name;
    f.matchType.value = rule.matchType;
    f.keywords.value = rule.keywords.join(', ');
    f.response.value = rule.response;
    f.addTag.value = rule.addTag || '';
    f.priority.value = rule.priority ?? 0;
    f.enabled.checked = rule.enabled;
    $('#ruleFormTitle').textContent = `Editando: ${rule.name}`;
    f.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  loaders.rules();
});

$('#formRuleTest').addEventListener('submit', withBusy($('#formRuleTest'), async (e) => {
  const r = await api('/api/rules/test', { method: 'POST', body: { text: e.target.text.value } });
  const kind = { rule: `Regra "${r?.rule}"`, offhours: 'Fora do horário', welcome: 'Boas-vindas', optout: 'Descadastro', optin: 'Recadastro' };
  $('#ruleTestResult').innerHTML = r
    ? `<p class="muted">${esc(kind[r.kind] || r.kind)}</p><div class="bubble">${esc(r.text)}</div>`
    : '<p class="muted">Nenhuma regra respondeu a essa mensagem.</p>';
}));

$('#btnMenuTemplate').addEventListener('click', async () => {
  const templates = [
    { name: 'Menu', matchType: 'contains', keywords: 'oi, olá, ola, menu, bom dia, boa tarde, boa noite', priority: 10,
      response: '{Olá|Oi} {primeiro_nome}! 👋 Como posso ajudar?\n\n1️⃣ Preços\n2️⃣ Horário de atendimento\n3️⃣ Falar com um atendente\n\nResponda com o número da opção.' },
    { name: 'Opção 1 - Preços', matchType: 'exact', keywords: '1', priority: 1, addTag: 'interesse-precos',
      response: '💰 Confira nossos preços e promoções: (coloque aqui seu link ou tabela)' },
    { name: 'Opção 2 - Horários', matchType: 'exact', keywords: '2', priority: 2,
      response: '🕗 Atendemos de segunda a sexta, das 8h às 18h.' },
    { name: 'Opção 3 - Atendente', matchType: 'exact', keywords: '3', priority: 3, addTag: 'quer-atendente',
      response: 'Certo! Um atendente vai falar com você em instantes. 🙋' },
  ];
  for (const t of templates) await api('/api/rules', { method: 'POST', body: t });
  toast('Menu de exemplo criado');
  loaders.rules();
});

// ---------- Agendamentos ----------
const REPEAT_LABEL = { none: 'uma vez', daily: 'todo dia', weekly: 'toda semana', monthly: 'todo mês' };
loaders.schedules = async () => {
  const list = await api('/api/schedules');
  $('#schedulesList').innerHTML = list.map((s) => `
    <div class="item ${s.enabled ? '' : 'disabled'}" data-id="${esc(s.id)}">
      <div class="grow">
        <b>${esc(s.name)}</b> ${s.enabled ? '' : '<span class="badge done">Concluído</span>'}
        <div class="meta">📅 ${fmtDate(s.runAt)} · ${REPEAT_LABEL[s.repeat]} · ${s.target.type === 'all' ? 'todos os contatos' : s.target.type === 'tags' ? `etiquetas: ${esc(s.target.tags.join(', '))}` : `${s.target.phones.length} número(s)`}${s.lastRunAt ? ` · último envio ${fmtDate(s.lastRunAt)}` : ''}</div>
        <div class="bubble">${esc(s.message)}</div>
      </div>
      <button class="btn small danger" data-act="delete">🗑️</button>
    </div>`).join('') || '<p class="muted">Nenhum agendamento.</p>';
  loadTags();
};
$('#schedulesList').addEventListener('click', async (e) => {
  const id = e.target.closest('[data-act="delete"]') && e.target.closest('[data-id]')?.dataset.id;
  if (!id || !confirm('Excluir este agendamento?')) return;
  await api(`/api/schedules/${id}`, { method: 'DELETE' });
  loaders.schedules();
});
$('#formSchedule').addEventListener('submit', withBusy($('#formSchedule'), async (e) => {
  const f = e.target;
  const mediaId = await uploadFrom(f.file);
  await api('/api/schedules', {
    method: 'POST',
    body: {
      name: f.name.value,
      target: targetFrom(f, 'sch'),
      runAt: new Date(f.runAt.value).toISOString(),
      repeat: f.repeat.value,
      message: f.message.value,
      mediaId,
    },
  });
  toast('Mensagem agendada ⏰');
  f.reset();
  bindTargetToggle('sch');
  loaders.schedules();
}));

// ---------- Envio rápido ----------
$('#formSend').addEventListener('submit', withBusy($('#formSend'), async (e) => {
  const f = e.target;
  const mediaId = await uploadFrom(f.file);
  await api('/api/send', { method: 'POST', body: { to: f.to.value, message: f.message.value, mediaId } });
  $('#sendResult').innerHTML = `<div class="bubble">${esc(f.message.value)}</div><p class="muted">✅ Enviada para ${esc(f.to.value)}</p>`;
  f.message.value = '';
  f.file.value = '';
}));
$('#btnCheckNumber').addEventListener('click', async () => {
  const phone = $('#formSend').to.value;
  if (!phone) return toast('Digite um número');
  try {
    const [r] = await api('/api/contacts/check', { method: 'POST', body: { phones: [phone] } });
    toast(r.exists ? `✅ ${phone} tem WhatsApp` : `❌ ${r.error}`, !r.exists);
  } catch (err) {
    toast(err.message, true);
  }
});

// ---------- Histórico ----------
loaders.logs = async () => {
  const type = $('#logType').value;
  const logs = await api(`/api/logs?limit=500${type ? `&type=${type}` : ''}`);
  $('#logsList').innerHTML = logs.map(logItem).join('') || '<li class="muted">Nada por aqui ainda.</li>';
};
$('#logType').addEventListener('change', loaders.logs);
$('#btnClearLogs').addEventListener('click', async () => {
  if (!confirm('Apagar todo o histórico?')) return;
  await api('/api/logs', { method: 'DELETE' });
  loaders.logs();
});

// ---------- Configurações ----------
const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
$('#bhDays').innerHTML = DAYS.map((d, i) => `<label><input type="checkbox" name="bh_day" value="${i}" /> ${d}</label>`).join('');

let settingsCache = {};
function applyDefaultDelays() {
  const f = $('#formCampaign');
  if (settingsCache.defaultDelayMin) f.delayMin.value = settingsCache.defaultDelayMin;
  if (settingsCache.defaultDelayMax) f.delayMax.value = settingsCache.defaultDelayMax;
}

loaders.settings = async () => {
  const [s, blacklist] = await Promise.all([api('/api/settings'), api('/api/blacklist')]);
  settingsCache = s;
  fillPayForm(s.payments || {});
  fillClosingForm(s.closing || {});
  $('#formBrand').name.value = s.brand?.name || '';
  $('#formBrand').tagline.value = s.brand?.tagline || '';
  const f = $('#formSettings');
  for (const k of ['autoReplyEnabled', 'ignoreGroups', 'welcomeEnabled']) f[k].checked = !!s[k];
  for (const k of ['replyCooldownMinutes', 'welcomeMessage', 'optOutMessage', 'optInMessage', 'defaultDelayMin', 'defaultDelayMax']) f[k].value = s[k] ?? '';
  f.optOutKeywords.value = s.optOutKeywords.join(', ');
  f.optInKeywords.value = s.optInKeywords.join(', ');
  f.bh_enabled.checked = s.businessHours.enabled;
  f.bh_start.value = s.businessHours.start;
  f.bh_end.value = s.businessHours.end;
  f.bh_message.value = s.businessHours.message;
  $$('[name="bh_day"]', f).forEach((c) => (c.checked = s.businessHours.days.includes(Number(c.value))));
  $('#blacklistChips').innerHTML = blacklist.map((p) => `<li>${esc(fmtPhone(p))} <button type="button" data-phone="${esc(p)}" title="Remover">✕</button></li>`).join('')
    || '<li class="muted">Nenhum</li>';
};
$('#blacklistChips').addEventListener('click', async (e) => {
  const phone = e.target.dataset.phone;
  if (!phone) return;
  await api(`/api/blacklist/${phone}`, { method: 'DELETE' });
  loaders.settings();
});
$('#formSettings').addEventListener('submit', withBusy($('#formSettings'), async (e) => {
  const f = e.target;
  settingsCache = await api('/api/settings', {
    method: 'PUT',
    body: {
      autoReplyEnabled: f.autoReplyEnabled.checked,
      ignoreGroups: f.ignoreGroups.checked,
      welcomeEnabled: f.welcomeEnabled.checked,
      replyCooldownMinutes: Number(f.replyCooldownMinutes.value || 0),
      welcomeMessage: f.welcomeMessage.value,
      optOutKeywords: lines(f.optOutKeywords.value),
      optOutMessage: f.optOutMessage.value,
      optInKeywords: lines(f.optInKeywords.value),
      optInMessage: f.optInMessage.value,
      defaultDelayMin: Number(f.defaultDelayMin.value || 8),
      defaultDelayMax: Number(f.defaultDelayMax.value || 20),
      businessHours: {
        enabled: f.bh_enabled.checked,
        start: f.bh_start.value,
        end: f.bh_end.value,
        message: f.bh_message.value,
        days: $$('[name="bh_day"]:checked', f).map((c) => Number(c.value)),
      },
    },
  });
  applyDefaultDelays();
  toast('Configurações salvas');
}));


// ---------- Conexão: modo e API oficial ----------
$$('[name="connMode"]').forEach((r) => r.addEventListener('change', async () => {
  try {
    renderStatus(await api('/api/connection/mode', { method: 'POST', body: { mode: r.value } }));
    loaders.connection();
  } catch (err) {
    toast(err.message, true);
  }
}));

function renderInstagram(st) {
  const box = $('#igStatus');
  if (!box) return;
  box.innerHTML = st.status === 'connected'
    ? `<p>✅ Instagram conectado: <b>@${esc(st.me?.username || '')}</b></p>`
    : st.error ? `<p>⚠️ ${esc(st.error)}</p>` : '<p class="muted">Instagram desligado.</p>';
}

loaders.connection = async () => {
  const [info, s, ig] = await Promise.all([api('/api/connection/info'), api('/api/settings'), api('/api/instagram/status')]);
  settingsCache = s;
  renderInstagram(ig);
  $('#igWebhookUrl').value = info.instagramWebhookUrl.replace(/^http:\/\/(?!localhost|127\.)/, 'https://');
  $('#igPrivacyUrl').value = $('#igWebhookUrl').value.replace(/\/webhook\/instagram$/, '/privacidade.html');
  renderTunnel(await api('/api/tunnel'));
  const fi = $('#formInstagram');
  fi.enabled.checked = Boolean(s.instagram?.enabled);
  for (const k of ['accessToken', 'verifyToken', 'appSecret']) fi[k].value = s.instagram?.[k] || '';
  if (info.fromEnv.igToken) fi.accessToken.placeholder = 'definido no arquivo .env';
  if (info.fromEnv.igVerifyToken) fi.verifyToken.placeholder = 'definido no arquivo .env';
  if (info.fromEnv.igAppSecret) fi.appSecret.placeholder = 'definido no arquivo .env';
  $('#webhookUrl').value = info.webhookUrl.replace(/^http:\/\/(?!localhost|127\.)/, 'https://');
  const f = $('#formCloud');
  const c = s.connection.cloud;
  for (const k of ['accessToken', 'phoneNumberId', 'verifyToken', 'appSecret', 'graphVersion']) f[k].value = c[k] || '';
  const env = { accessToken: info.fromEnv.token, phoneNumberId: info.fromEnv.phoneNumberId, verifyToken: info.fromEnv.verifyToken, appSecret: info.fromEnv.appSecret };
  for (const [k, fromEnv] of Object.entries(env)) if (fromEnv) f[k].placeholder = 'definido no arquivo .env';
};

$('#formPairing').addEventListener('submit', withBusy($('#formPairing'), async (e) => {
  const r = await api('/api/connection/pairing-code', { method: 'POST', body: { phone: e.target.phone.value } });
  $('#pairingResult').innerHTML = `<div class="pairing-code">${esc(r.code)}</div>
    <p>Mande este código para o dono do número. No celular dele: WhatsApp → <b>Configurações</b> (ou ⋮) → <b>Dispositivos conectados</b> → <b>Conectar dispositivo</b> → <b>Conectar com número de telefone</b> → digitar o código.</p>
    <p class="hint">O código vale por poucos minutos. Se expirar, gere outro.</p>`;
}));

function renderTunnel(st) {
  const box = $('#tunnelStatus');
  if (!box) return;
  const local = /localhost|127\.0\.0\.1/.test($('#igWebhookUrl').value);
  box.innerHTML = {
    off: local ? '⚪ Desligado. Sem ele, o Instagram não consegue entregar as mensagens neste computador.' : '⚪ Desligado.',
    downloading: '⏬ Baixando o túnel da Cloudflare (só na primeira vez, uns 30 MB)…',
    starting: '⏳ Ligando… (leva uns 10 segundos)',
    on: `✅ Ligado: <b>${esc(st.url || '')}</b>. A URL do webhook abaixo já está com este endereço.`,
    error: `⚠️ ${esc(st.error || 'Erro no túnel')}`,
  }[st.status] || '';
  $('#btnTunnelStart').hidden = st.status === 'on' || st.status === 'starting' || st.status === 'downloading';
  $('#btnTunnelStop').hidden = st.status !== 'on';
  if (st.url) {
    $('#igWebhookUrl').value = `${st.url}/webhook/instagram`;
    $('#igPrivacyUrl').value = `${st.url}/privacidade.html`;
  }
}
$('#btnTunnelStart').addEventListener('click', async (e) => {
  e.target.disabled = true;
  renderTunnel({ status: 'starting' });
  try {
    const st = await api('/api/tunnel/start', { method: 'POST' });
    renderTunnel(st);
    if (st.url) toast('Endereço criado! Copie a URL do webhook e cole na Meta.');
  } catch (err) {
    renderTunnel({ status: 'error', error: err.message });
  }
  e.target.disabled = false;
});
$('#btnTunnelStop').addEventListener('click', async () => {
  renderTunnel(await api('/api/tunnel/stop', { method: 'POST' }));
  setTimeout(async () => renderTunnel(await api('/api/tunnel')), 1500);
});
for (const id of ['#igWebhookUrl', '#igPrivacyUrl']) {
  $(id).addEventListener('click', (e) => {
    e.target.select();
    navigator.clipboard?.writeText(e.target.value).then(() => toast('Copiado ✅')).catch(() => {});
  });
}

$('#btnIgSync').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try {
    const r = await api('/api/instagram/sync', { method: 'POST' });
    toast(`Direct verificado: ${r.recent} para o agente responder (veja em Conversas) e ${r.old} antigas enviadas ao CRM`);
  } catch (err) {
    toast(err.message, true);
  }
  e.target.disabled = false;
});

$('#formInstagram').addEventListener('submit', withBusy($('#formInstagram'), async (e) => {
  const f = e.target;
  await api('/api/settings', {
    method: 'PUT',
    body: { instagram: {
      enabled: f.enabled.checked,
      accessToken: f.accessToken.value.trim(),
      verifyToken: f.verifyToken.value.trim(),
      appSecret: f.appSecret.value.trim(),
    } },
  });
  toast(f.enabled.checked ? 'Instagram salvo. Conectando…' : 'Instagram desligado');
  setTimeout(loaders.connection, 1500);
}));

$('#formCloud').addEventListener('submit', withBusy($('#formCloud'), async (e) => {
  const f = e.target;
  await api('/api/settings', {
    method: 'PUT',
    body: { connection: { cloud: {
      accessToken: f.accessToken.value.trim(),
      phoneNumberId: f.phoneNumberId.value.trim(),
      verifyToken: f.verifyToken.value.trim(),
      appSecret: f.appSecret.value.trim(),
      graphVersion: f.graphVersion.value.trim() || 'v22.0',
    } } },
  });
  toast('Credenciais salvas. Conectando…');
  setTimeout(loaders.connection, 1500);
}));

// ---------- Agente IA ----------
const BUSINESS_FIELDS = ['name', 'segment', 'description', 'services', 'prices', 'hours', 'address', 'faq', 'policies', 'schedulingRules', 'knowledge',
  'story', 'socialProof', 'offer', 'offerUntil', 'priceIncrease', 'marketPrices', 'reservation', 'contractData'];

/** Aviso no topo quando a IA não está pronta para responder, com o que falta e o botão para resolver. */
function renderAiBanner(st) {
  const prov = { openrouter: 'OpenRouter', openai: 'ChatGPT (OpenAI)', anthropic: 'Claude' }[st.provider] || 'Google Gemini';
  let html = '';
  if (!st.configured) html = `<b>🧠 A IA ainda não tem chave.</b> Cole a chave do ${esc(prov)} na aba Agente IA e clique em Salvar. <button type="button" class="btn small" data-go="agent">Abrir Agente IA</button>`;
  else if (!st.enabled) html = '<b>🧠 A chave da IA está salva, mas o agente está desligado.</b> Por isso ele não responde ninguém. <button type="button" class="btn small primary" data-ai-on>Ligar a IA agora</button>';
  else if (st.audience === 'test' && !st.testNumbers) html = '<b>🧪 A IA está ligada em modo de teste, sem números de teste.</b> Ela não responde ninguém. <button type="button" class="btn small primary" data-ai-all>Colocar no ar para todos</button> <button type="button" class="btn small" data-go="agent">Cadastrar números de teste</button>';
  else if (st.audience === 'test') html = `🧪 A IA está em <b>modo de teste</b>: só responde ${st.testNumbers} número(s) de teste. <button type="button" class="btn small" data-ai-all>Colocar no ar para todos</button>`;
  const blocked = !st.active || (st.audience === 'test' && !st.testNumbers);
  $$('[data-ai-banner]').forEach((b) => { b.hidden = !html; b.innerHTML = html; b.classList.toggle('warn', blocked); });
}
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-ai-on],[data-ai-all],[data-go]');
  if (!t || !t.closest('[data-ai-banner]')) return;
  if (t.dataset.go) return showTab(t.dataset.go);
  if (t.hasAttribute('data-ai-all') && !confirm('Colocar a IA no ar? Ela vai responder TODOS os clientes que mandarem mensagem.')) return;
  try {
    const st = await api('/api/agent/enable', { method: 'POST', body: t.hasAttribute('data-ai-all') ? { enabled: true, audience: 'all' } : { enabled: true } });
    renderAiBanner(st);
    toast(st.active ? '🧠 IA ligada' : 'Salvo');
    renderAgentStatus();
  } catch (err) {
    toast(err.message, true);
  }
});

async function renderAgentStatus() {
  const st = await api('/api/agent/status');
  renderAiBanner(st);
  const box = $('#agentStatusBox');
  if (!box) return;
  const who = st.audience === 'test'
    ? `🧪 <b>modo de teste</b> (${st.testNumbers} número(s))`
    : '🟢 <b>no ar</b> para todos os clientes';
  box.innerHTML = (st.active
    ? `<p>🧠 Agente de <b>${esc(st.business)}</b> ligado · ${who} · modelo <code>${esc(st.model)}</code></p>`
    : `<p class="muted">🧠 Agente IA desligado${st.configured ? '' : ' (falta a chave da IA)'}.</p>`)
    + (st.lastError ? `<p class="ai-error">⚠️ <b>A IA falhou</b> (${fmtDate(st.lastError.at)}): ${esc(st.lastError.message)}<br>Os clientes não receberam mensagem de erro: eles estão em <b>Conversas → Clientes esperando resposta</b>. Clique em "Testar a IA agora" depois de corrigir.</p>` : '');
}
$('#btnAgentCheck').addEventListener('click', async (e) => {
  e.target.disabled = true;
  const old = e.target.textContent;
  e.target.textContent = 'Testando…';
  try {
    const r = await api('/api/agent/check', { method: 'POST' });
    if (r.ok) toast(`✅ A IA respondeu em ${(r.ms / 1000).toFixed(1)}s com o modelo ${r.model}${r.fallback ? ' (o modelo escolhido falhou; use este na aba Agente IA)' : ''}`);
    else toast(`❌ ${r.error}`, true);
    renderAgentStatus();
  } catch (err) {
    toast(err.message, true);
  }
  e.target.textContent = old;
  e.target.disabled = false;
});

loaders.agent = async () => {
  const s = await api('/api/settings');
  settingsCache = s;
  const f = $('#formAgent');
  const a = s.agent;
  f.enabled.checked = a.enabled;
  f.rulesFirst.checked = a.rulesFirst;
  f.pauseOnOwnerReply.checked = a.pauseOnOwnerReply !== false;
  f.humanizeEnabled.checked = a.humanize?.enabled !== false;
  f.noticeMin.value = a.humanize?.noticeMin ?? 5;
  f.noticeMax.value = a.humanize?.noticeMax ?? 20;
  for (const k of ['apiKey', 'model', 'geminiKey', 'geminiModel', 'openaiKey', 'openaiModel', 'claudeKey', 'temperature', 'memoryMessages', 'agentName', 'roleLabel', 'instructions', 'handoffNotifyPhone']) f[k].value = a[k] ?? '';
  f.claudeModel.value = a.claudeModel || 'claude-opus-5-5';
  f.provider.value = ['openrouter', 'openai', 'anthropic'].includes(a.provider) ? a.provider : 'gemini';
  f.provider.dispatchEvent(new Event('change'));
  $$('[name="audience"]', f).forEach((r) => (r.checked = r.value === (a.audience || 'test')));
  f.testNumbers.value = (a.testNumbers || []).join('\n');
  if (!$('#presetSelect').options.length) {
    const presets = await api('/api/agent/presets');
    $('#presetSelect').innerHTML = presets.map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('');
  }
  for (const k of BUSINESS_FIELDS) f[`b_${k}`].value = s.business[k] ?? '';
  const info = await api('/api/connection/info');
  if (info.fromEnv.openrouter) f.apiKey.placeholder = 'definida no arquivo .env';
  if (info.fromEnv.gemini) f.geminiKey.placeholder = 'definida no arquivo .env';
  if (info.fromEnv.openai) f.openaiKey.placeholder = 'definida no arquivo .env';
  if (info.fromEnv.anthropic) f.claudeKey.placeholder = 'definida no arquivo .env';
};

$('#formAgent').addEventListener('submit', withBusy($('#formAgent'), async (e) => {
  const f = e.target;
  const business = Object.fromEntries(BUSINESS_FIELDS.map((k) => [k, f[`b_${k}`].value]));
  await api('/api/settings', {
    method: 'PUT',
    body: {
      agent: {
        enabled: f.enabled.checked,
        rulesFirst: f.rulesFirst.checked,
        provider: f.provider.value,
        geminiKey: f.geminiKey.value.trim(),
        geminiModel: f.geminiModel.value.trim() || 'gemini-3.8-flash',
        apiKey: f.apiKey.value.trim(),
        model: f.model.value.trim() || '~anthropic/claude-sonnet-latest',
        openaiKey: f.openaiKey.value.trim(),
        openaiModel: f.openaiModel.value.trim() || 'gpt-5-mini',
        claudeKey: f.claudeKey.value.trim(),
        claudeModel: f.claudeModel.value,
        temperature: Number(f.temperature.value || 0.4),
        memoryMessages: Number(f.memoryMessages.value || 20),
        agentName: f.agentName.value,
        roleLabel: f.roleLabel.value,
        instructions: f.instructions.value,
        audience: $('[name="audience"]:checked', f)?.value || 'test',
        testNumbers: f.testNumbers.value.split('\n').map((n) => n.trim()).filter(Boolean),
        handoffNotifyPhone: f.handoffNotifyPhone.value.trim(),
        pauseOnOwnerReply: f.pauseOnOwnerReply.checked,
        humanize: {
          enabled: f.humanizeEnabled.checked,
          noticeMin: Math.max(0, Number(f.noticeMin.value || 0)),
          noticeMax: Math.max(Number(f.noticeMin.value || 0), Number(f.noticeMax.value || 0)),
        },
      },
      business,
    },
  });
  const st = await api('/api/agent/status');
  let msg = 'Agente salvo 🧠';
  const provName = { openrouter: 'OpenRouter', openai: 'ChatGPT (OpenAI)', anthropic: 'Claude' }[st.provider] || 'Google Gemini';
  if (st.enabled && !st.configured) msg = `⚠️ Salvo, mas falta a chave do ${provName}`;
  else if (!st.enabled && st.configured) msg = '⚠️ Salvo, mas o agente está DESLIGADO: marque "Agente ligado" e salve de novo';
  else if (st.enabled && st.audience === 'test' && !st.testNumbers) msg = '⚠️ Modo de teste sem números: o agente não vai responder ninguém';
  toast(msg, msg.startsWith('⚠️'));
  loaders.agent();
}));

$('#btnApplyPreset').addEventListener('click', async () => {
  const sel = $('#presetSelect');
  const label = sel.options[sel.selectedIndex]?.text;
  if (!confirm(`Carregar o perfil "${label}"? Os campos da base do negócio, a personalidade e as mensagens de teste serão substituídos.`)) return;
  try {
    await api(`/api/agent/presets/${sel.value}/apply`, { method: 'POST' });
    $('#stressList').innerHTML = '';
    toast('Perfil carregado ✅');
    loaders.agent();
  } catch (err) {
    toast(err.message, true);
  }
});

$('#aiProvider').addEventListener('change', (e) => {
  $('#aiGemini').hidden = e.target.value !== 'gemini';
  $('#aiOpenrouter').hidden = e.target.value !== 'openrouter';
  $('#aiOpenai').hidden = e.target.value !== 'openai';
  $('#aiAnthropic').hidden = e.target.value !== 'anthropic';
});

$('#btnShowPrompt').addEventListener('click', async () => {
  $('#promptText').textContent = await api('/api/agent/prompt');
  $('#promptDialog').showModal();
});

// ---------- Testar agente ----------
let simSession = `s${Date.now()}`;
const nowTime = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const TOOL_LABEL = {
  consultar_horarios_disponiveis: '🔎 consultou a agenda',
  agendar_horario: '📅 agendou',
  listar_meus_agendamentos: '📋 listou agendamentos',
  cancelar_agendamento: '❌ cancelou agendamento',
  transferir_para_humano: '🙋 transferiu para humano',
  enviar_ficha_de_dados: '📝 enviou a ficha de dados',
  gerar_pix: '💳 gerou o Pix',
  cliente_informou_pagamento: '🧾 avisou a equipe do pagamento',
  encaminhar_para_vendedor: '🤝 passou para o consultor',
  encaminhar_para_especialista: '🏠 passou para o especialista',
  agendar_visita_escritorio: '🏢 pediu a visita ao Marcos',
  enviar_etapas_pagamento: '📋 enviou as etapas de pagamento',
};
function chatBubble(role, text, at) {
  return `<div class="msg ${role}">${esc(text)}<time>${at ? fmtDate(at) : nowTime()}</time></div>`;
}
function actionChip(a) {
  const detail = a.result?.erro ? ` — erro: ${a.result.erro}` : a.tool === 'consultar_horarios_disponiveis'
    ? ` ${a.args.data}: ${(a.result.horarios || []).join(', ') || 'nenhum'}`
    : a.tool === 'agendar_horario' && a.result.ok ? ` ${a.result.data} ${a.result.hora}` : '';
  return `<div class="action">${TOOL_LABEL[a.tool] || a.tool}${esc(detail)}</div>`;
}
const scrollDown = (el) => { el.scrollTop = el.scrollHeight; };

loaders.test = async () => {
  if (!$('#stressList').children.length) {
    const tests = await api('/api/agent/stress-tests');
    $('#stressList').innerHTML = tests.map((t) => stressItem(t)).join('');
  }
  if (!$('#simChat').children.length) {
    $('#simChat').innerHTML = '<div class="typing">Mande uma mensagem como se fosse um cliente. Ex.: "Oi, tudo bem?"</div>';
  }
};
const stressItem = (t) => `<div class="stress-item" data-text="${esc(t)}"><div class="q">“${esc(t)}”</div><div class="a"></div></div>`;

// Mesmo ritmo do WhatsApp de verdade (src/humanize.js), só que mais rápido para "ver" a mensagem.
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const readMs = (t) => Math.min(9000, Math.max(2000, (t.length / 12) * 1000));
const typeMs = (t, h) => Math.min((h.maxTypingSeconds || 25) * 1000, Math.max(1500, (t.length / (h.typingCharsPerSecond || 7)) * 1000 * rand(0.85, 1.2)));
const setPresence = (t) => { $('#simPresence').textContent = t; $('#simPresence').classList.toggle('on', t !== 'online'); };
const typingDots = '<div class="typing dots" aria-label="digitando"><i></i><i></i><i></i></div>';

$('#formSim').addEventListener('submit', withBusy($('#formSim'), async (e) => {
  const input = e.target.text;
  const text = input.value.trim();
  if (!text) return;
  const chat = $('#simChat');
  const human = $('#simHuman').checked;
  chat.querySelector('.typing')?.remove();
  chat.insertAdjacentHTML('beforeend', chatBubble('user', text).replace('</time>', ' <span class="ticks">✓</span></time>'));
  const ticks = chat.lastElementChild.querySelector('.ticks');
  input.value = '';
  scrollDown(chat);
  const started = Date.now();
  const reply = api('/api/agent/simulate', { method: 'POST', body: { text, session: simSession, dryRun: $('#simDryRun').checked } });
  try {
    if (human) {
      await sleepMs(rand(1200, 3000)); // "vê" a mensagem
      ticks.textContent = '✓✓';
      ticks.classList.add('read');
      setPresence('online');
      await sleepMs(readMs(text)); // lê com calma
    } else {
      chat.insertAdjacentHTML('beforeend', typingDots);
    }
    const r = await reply;
    chat.querySelector('.typing')?.remove();
    if (r.actions.length) chat.insertAdjacentHTML('beforeend', r.actions.map((a) => actionChip(a) + (a.result?.enviado ? chatBubble('assistant', a.result.enviado) : '')).join(''));
    const bubbles = human ? r.bubbles || [r.text] : [r.text];
    const thinking = Date.now() - started;
    for (const [i, b] of bubbles.entries()) {
      if (human) {
        setPresence('digitando…');
        chat.insertAdjacentHTML('beforeend', typingDots);
        scrollDown(chat);
        await sleepMs(Math.max(1200, typeMs(b, r.humanize || {}) - (i === 0 ? Math.max(0, thinking - readMs(text) - 3000) : 0)));
        chat.querySelector('.typing')?.remove();
        setPresence('online');
      }
      chat.insertAdjacentHTML('beforeend', chatBubble('assistant', b));
      scrollDown(chat);
      if (human && i < bubbles.length - 1) await sleepMs(rand(700, 1800));
    }
  } catch (err) {
    chat.querySelector('.typing')?.remove();
    setPresence('online');
    throw err;
  } finally {
    scrollDown(chat);
    input.focus();
  }
}));

$('#btnSimReset').addEventListener('click', async () => {
  await api(`/api/agent/simulate/${simSession}`, { method: 'DELETE' });
  simSession = `s${Date.now()}`;
  $('#simChat').innerHTML = '';
  loaders.test();
});

$('#btnStressAdd').addEventListener('click', () => {
  const v = $('#stressCustom').value.trim();
  if (!v) return;
  $('#stressList').insertAdjacentHTML('beforeend', stressItem(v));
  $('#stressCustom').value = '';
});

$('#btnStressRun').addEventListener('click', async (e) => {
  const btn = e.target;
  btn.disabled = true;
  const items = $$('#stressList .stress-item');
  let ok = 0;
  for (const item of items) {
    item.className = 'stress-item';
    const out = $('.a', item);
    out.textContent = 'testando…';
    try {
      const r = await api('/api/agent/stress-test', { method: 'POST', body: { text: item.dataset.text } });
      const acts = r.actions.map((a) => TOOL_LABEL[a.tool] || a.tool).join(', ');
      out.textContent = `${r.text}${acts ? `\n[${acts}]` : ''}`;
      item.classList.add('ok');
      ok++;
    } catch (err) {
      out.textContent = `Erro: ${err.message}`;
      item.classList.add('err');
    }
  }
  btn.disabled = false;
  toast(`${ok}/${items.length} testes responderam. Leia as respostas e ajuste a base se precisar.`);
});

// ---------- Conversas sem resposta ----------
const ago = (ms) => {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 60) return `há ${Math.max(min, 1)} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `há ${h} h` : `há ${Math.round(h / 24)} dias`;
};
async function loadPending() {
  const r = await api('/api/pending');
  $('#pendingCount').textContent = r.count;
  const checked = new Set($$('.pendingCheck:checked').map((c) => c.value));
  $('#pendingList').innerHTML = r.items.map((p) => `
    <label class="pending-item ${p.queued ? 'queued' : ''}">
      <input type="checkbox" class="pendingCheck" value="${esc(p.jid)}" ${checked.has(p.jid) ? 'checked' : ''} />
      <div>${p.channel === 'instagram' ? '📸' : '💬'} <b>${esc(p.name || fmtPhone(p.phone) || 'Contato')}</b> <span class="muted">${esc(p.name ? fmtPhone(p.phone) || '' : '')}</span> <span class="chip small">${esc(p.channelLabel || '')}</span>
        <div class="txt">${esc(p.texts.join(' · '))}</div></div>
      <span class="when">${p.queued ? '⏳ na fila' : ago(p.at)}</span>
    </label>`).join('') || '<p class="muted">Ninguém esperando resposta. 🎉</p>';
  $('#pendingStatus').textContent = r.running
    ? `🤖 Respondendo… ${r.queue} na fila. Pode deixar esta tela aberta ou fechada.`
    : '';
  $('#btnPendingCancel').hidden = !r.running;
}
const markedPending = () => $$('.pendingCheck:checked').map((c) => c.value);
$('#btnPendingAll').addEventListener('click', () => {
  const boxes = $$('.pendingCheck');
  const all = boxes.every((c) => c.checked);
  boxes.forEach((c) => (c.checked = !all));
});
$('#btnPendingReply').addEventListener('click', async () => {
  const jids = markedPending();
  if (!jids.length) return toast('Marque os clientes que o agente deve responder');
  try {
    const r = await api('/api/pending/reply', { method: 'POST', body: { jids } });
    let msg = `${r.queued} cliente(s) na fila do agente`;
    if (r.blocked) msg += `. ${r.blocked} ignorado(s): o agente está em modo de teste (só responde os números de teste)`;
    toast(msg, Boolean(r.blocked && !r.queued));
    loadPending();
  } catch (err) {
    toast(err.message, true);
  }
});
$('#btnPendingDismiss').addEventListener('click', async () => {
  const jids = markedPending();
  if (!jids.length) return toast('Marque os clientes que quer tirar da lista');
  await api('/api/pending/dismiss', { method: 'POST', body: { jids } });
  loadPending();
});
$('#btnPendingCancel').addEventListener('click', async () => {
  await api('/api/pending/cancel', { method: 'POST' });
  loadPending();
});

// ---------- Conversas ----------
let currentConv = null;
loaders.conversations = async () => {
  loadPending();
  const list = await api('/api/conversations');
  $('#convList').innerHTML = list.map((c) => `
    <div class="conv-item ${c.key === currentConv ? 'active' : ''}" data-key="${esc(c.key)}">
      ${String(c.key).startsWith('ig:') ? '📸' : '💬'} <b>${esc(c.name || fmtPhone(c.phone) || c.key)}</b> ${c.handoff ? '<span class="badge paused">humano</span>' : ''}
      <span class="chip small">${esc(c.channelLabel || '')}</span>
      <div class="last">${c.last ? `${c.last.role === 'user' ? '' : '🤖 '}${esc(c.last.content)}` : ''}</div>
    </div>`).join('') || '<p class="muted">Nenhuma conversa ainda. Quando clientes falarem com o agente, elas aparecem aqui.</p>';
  if (currentConv) openConversation(currentConv);
};
$('#convList').addEventListener('click', (e) => {
  const key = e.target.closest('[data-key]')?.dataset.key;
  if (key) {
    currentConv = key;
    $$('.conv-item').forEach((el) => el.classList.toggle('active', el.dataset.key === key));
    openConversation(key);
  }
});
async function openConversation(key) {
  const c = await api(`/api/conversations/${encodeURIComponent(key)}`);
  $('#convHeader').className = 'conv-header';
  $('#convHeader').innerHTML = `<div><b>${esc(c.name || '')}</b> ${esc(fmtPhone(c.phone) || '')}
      ${c.handoff ? `<div class="hint">🙋 Atendimento humano${c.handoffReason ? `: ${esc(c.handoffReason)}` : ''} — o robô está pausado</div>` : '<div class="hint">🤖 Robô atendendo</div>'}</div>
    <div class="row">
      <button class="btn small" id="btnConvLead">🗂️ Ver prospecto</button>
      <button class="btn small" id="btnHandoff">${c.handoff ? '🤖 Devolver para o robô' : '🙋 Assumir conversa'}</button>
      <button class="btn small danger" id="btnConvClear" title="Apagar memória" data-admin>🗑️</button>
    </div>`;
  $('#convChat').innerHTML = c.messages.map((m) => chatBubble(m.role, m.content, m.at)).join('');
  $('#formConvReply').hidden = false;
  scrollDown($('#convChat'));
  $('#btnConvLead').onclick = () => openLeadFromConversation(key);
  $('#btnHandoff').onclick = async () => {
    await api(`/api/conversations/${encodeURIComponent(key)}/handoff`, { method: 'POST', body: { value: !c.handoff } });
    loaders.conversations();
  };
  $('#btnConvClear').onclick = async () => {
    if (!confirm('Apagar a memória desta conversa? O agente vai esquecer o que foi falado.')) return;
    await api(`/api/conversations/${encodeURIComponent(key)}`, { method: 'DELETE' });
    currentConv = null;
    $('#convChat').innerHTML = '';
    $('#formConvReply').hidden = true;
    loaders.conversations();
  };
}
$('#formConvReply').addEventListener('submit', withBusy($('#formConvReply'), async (e) => {
  const text = e.target.text.value.trim();
  if (!text || !currentConv) return;
  await api(`/api/conversations/${encodeURIComponent(currentConv)}/reply`, { method: 'POST', body: { text } });
  e.target.text.value = '';
  openConversation(currentConv);
}));

// ---------- Agenda ----------
const DAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
$('#agendaHours').innerHTML = DAY_NAMES.map((d, i) => `<span>${d}</span><input name="h_${i}" placeholder="fechado" />`).join('');
$('#formAgenda').provider.addEventListener('change', (e) => {
  $('#agendaLocal').hidden = e.target.value !== 'local';
  $('#agendaCalcom').hidden = e.target.value !== 'calcom';
});

loaders.agenda = async () => {
  const [s, appts] = await Promise.all([api('/api/settings'), api('/api/appointments')]);
  settingsCache = s;
  const a = s.agenda;
  const f = $('#formAgenda');
  f.enabled.checked = a.enabled !== false;
  f.provider.value = a.provider;
  f.provider.dispatchEvent(new Event('change'));
  for (let i = 0; i < 7; i++) f[`h_${i}`].value = a.hours?.[i] || '';
  for (const k of ['slotMinutes', 'minAdvanceMinutes', 'maxDaysAhead']) f[k].value = a[k];
  for (const k of ['apiKey', 'eventTypeId', 'timeZone', 'defaultEmail']) f[`c_${k}`].value = a.calcom?.[k] || '';

  const byDay = {};
  for (const ap of appts) (byDay[ap.date] ||= []).push(ap);
  $('#apptList').innerHTML = Object.entries(byDay).map(([date, list]) => {
    const d = new Date(`${date}T12:00:00`);
    return `<h3>${DAY_NAMES[d.getDay()]}, ${d.toLocaleDateString('pt-BR')}</h3>` + list.map((ap) => `
      <div class="item" data-id="${esc(ap.id)}">
        <div class="grow"><b>${esc(ap.time)}</b> · ${esc(ap.name)} <span class="muted">${esc(fmtPhone(ap.phone))}</span>
          <div class="meta">${esc(ap.service || '')}${ap.provider === 'calcom' ? ' · Cal.com' : ''}</div></div>
        <button class="btn small danger" data-cancel="${esc(ap.id)}">Cancelar</button>
      </div>`).join('');
  }).join('') || '<p class="muted">Nenhum agendamento futuro.</p>';
};

$('#apptList').addEventListener('click', async (e) => {
  const id = e.target.closest('[data-cancel]')?.dataset.cancel;
  if (!id || !confirm('Cancelar este agendamento?')) return;
  try {
    await api(`/api/appointments/${id}/cancel`, { method: 'POST' });
    loaders.agenda();
  } catch (err) {
    toast(err.message, true);
  }
});

$('#formAgenda').addEventListener('submit', withBusy($('#formAgenda'), async (e) => {
  const f = e.target;
  const hours = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((i) => [i, f[`h_${i}`].value.trim()]));
  await api('/api/settings', {
    method: 'PUT',
    body: { agenda: {
      enabled: f.enabled.checked,
      provider: f.provider.value,
      hours,
      slotMinutes: Number(f.slotMinutes.value || 30),
      minAdvanceMinutes: Number(f.minAdvanceMinutes.value || 0),
      maxDaysAhead: Number(f.maxDaysAhead.value || 30),
      calcom: {
        apiKey: f.c_apiKey.value.trim(),
        eventTypeId: f.c_eventTypeId.value.trim(),
        timeZone: f.c_timeZone.value.trim() || 'America/Sao_Paulo',
        defaultEmail: f.c_defaultEmail.value.trim(),
      },
    } },
  });
  toast('Disponibilidade salva');
  loaders.agenda();
}));

$('#formAppt').date.addEventListener('change', async (e) => {
  const sel = $('#formAppt').time;
  sel.innerHTML = '<option value="">carregando…</option>';
  try {
    const r = await api(`/api/agenda/slots?date=${e.target.value}`);
    const opts = r.slots.map((t) => `<option>${t}</option>`).join('');
    sel.innerHTML = opts || `<option value="">${esc(r.error || (r.closed ? 'fechado neste dia' : 'sem horários livres'))}</option>`;
  } catch (err) {
    sel.innerHTML = `<option value="">${esc(err.message)}</option>`;
  }
});
$('#formAppt').addEventListener('submit', withBusy($('#formAppt'), async (e) => {
  const f = e.target;
  await api('/api/appointments', { method: 'POST', body: { date: f.date.value, time: f.time.value, name: f.name.value, phone: f.phone.value, service: f.service.value } });
  toast('Agendado 📅');
  f.reset();
  loaders.agenda();
}));

// ---------- Atualização ----------
$('#btnUpdateCheck').addEventListener('click', async () => {
  $('#updateStatus').textContent = 'Verificando…';
  try {
    const r = await api('/api/update/check');
    const when = r.latest.date ? new Date(r.latest.date).toLocaleString('pt-BR') : '';
    $('#updateStatus').textContent = r.updateAvailable
      ? `Há uma versão nova (${when}): ${r.latest.message}`
      : `Você já está com a versão mais nova (${when}).`;
  } catch (err) {
    $('#updateStatus').textContent = `Não foi possível verificar: ${err.message}`;
  }
});
$('#btnUpdateNow').addEventListener('click', async (e) => {
  e.target.disabled = true;
  $('#updateStatus').textContent = 'Baixando e instalando… (pode levar até 1 minuto)';
  try {
    await api('/api/update', { method: 'POST' });
    $('#updateStatus').textContent = '✅ Atualizado! Reiniciando… a página recarrega sozinha.';
    // Espera o programa voltar e recarrega a página.
    setTimeout(function wait() {
      fetch('/api/status').then((r) => (r.ok ? location.reload() : setTimeout(wait, 1500))).catch(() => setTimeout(wait, 1500));
    }, 4000);
  } catch (err) {
    $('#updateStatus').textContent = `Falha na atualização: ${err.message}`;
    e.target.disabled = false;
  }
});

// ---------- Tempo real ----------
function connectEvents() {
  const es = new EventSource('/api/events');
  es.addEventListener('status', (e) => renderStatus(JSON.parse(e.data)));
  es.addEventListener('campaign', (e) => {
    const c = JSON.parse(e.data);
    const idx = campaignsCache.findIndex((x) => x.id === c.id);
    if (idx >= 0) campaignsCache[idx] = c; else campaignsCache.unshift(c);
    if ($('#tab-campaigns').classList.contains('active')) renderCampaigns();
  });
  es.addEventListener('log', (e) => {
    const log = JSON.parse(e.data);
    if (log.type === 'autoreply' && $('#tab-conversations').classList.contains('active')) loaders.conversations();
    if ($('#tab-logs').classList.contains('active') && (!$('#logType').value || $('#logType').value === log.type)) {
      $('#logsList').insertAdjacentHTML('afterbegin', logItem(log));
    }
    if ($('#tab-dashboard').classList.contains('active')) {
      clearTimeout(connectEvents.t);
      connectEvents.t = setTimeout(loaders.dashboard, 500);
    }
  });
  es.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (!m.isGroup) toast(`💬 ${m.name || fmtPhone(m.phone)}: ${m.text.slice(0, 80)}`);
  });
  const refreshIfActive = (tab) => () => {
    if ($(`#tab-${tab}`).classList.contains('active')) loaders[tab]();
  };
  es.addEventListener('conversation', refreshIfActive('conversations'));
  es.addEventListener('instagramStatus', (e) => renderInstagram(JSON.parse(e.data)));
  es.addEventListener('pending', () => {
    if ($('#tab-conversations').classList.contains('active')) loadPending();
  });
  es.addEventListener('appointments', refreshIfActive('agenda'));
  es.addEventListener('visits', (e) => {
    if (!isAdmin()) return;
    loaders.visits?.().catch(() => {});
    if (JSON.parse(e.data || '{}').new) toast('🏢 Novo pedido de visita ao escritório');
  });
  es.addEventListener('tunnel', (e) => renderTunnel(JSON.parse(e.data)));
  es.addEventListener('crm', () => onCrmEvent());
  es.addEventListener('paymentPaid', (e) => onPaymentPaid(JSON.parse(e.data)));
  es.addEventListener('payment', () => onPaymentEvent());
  es.addEventListener('lineStatus', () => onLineStatus());
  es.addEventListener('agentError', (e) => {
    toast(`⚠️ A IA falhou: ${JSON.parse(e.data).message}`, true);
    renderAgentStatus();
  });
  es.addEventListener('crmAssigned', (e) => onCrmAssigned(JSON.parse(e.data)));
  es.addEventListener('crmDue', () => onCrmDue());
  es.addEventListener('message', refreshIfActive('conversations'));
  es.onerror = () => renderStatus({ ...connState, status: 'disconnected' });
}

// ---------- Pagamentos (configuração) ----------
function fillPayForm(p) {
  const f = $('#formPay');
  f.enabled.checked = p.enabled !== false;
  f.provider.value = p.provider === 'mercadopago' ? 'mercadopago' : 'pix';
  for (const k of ['pixKey', 'receiverName', 'receiverCity', 'notifyPhone', 'bankInfo']) f[k].value = p[k] || '';
  f.resBase.value = p.reservation?.base ?? '';
  f.resPerAdult.value = p.reservation?.perAdult ?? '';
  f.resDescription.value = p.reservation?.description || '';
  f.coName.value = p.company?.name || '';
  f.coDocument.value = p.company?.document || '';
  f.coAddress.value = p.company?.address || '';
  f.coContact.value = [p.company?.phone, p.company?.email].filter(Boolean).join(' · ');
  f.mpToken.value = p.mercadopago?.accessToken || '';
  f.mpEmail.value = p.mercadopago?.payerEmail || '';
  $('#mpBox').hidden = f.provider.value !== 'mercadopago';
}
// ---------- Fechamento (ficha de dados e termo da reserva) ----------
let defaultTerm = '';
async function fillClosingForm(c = {}) {
  const f = $('#formClosing');
  if (!defaultTerm) defaultTerm = (await api('/api/closing/template').catch(() => ({}))).text || '';
  f.enabled.checked = c.enabled !== false;
  f.termAfter.value = c.termAfter === 'payment' ? 'payment' : 'pix';
  f.termTemplate.value = c.termTemplate?.trim() || defaultTerm;
}
$('#btnTermDefault').addEventListener('click', () => { $('#formClosing').termTemplate.value = defaultTerm; });
$('#formClosing').addEventListener('submit', withBusy($('#formClosing'), async (e) => {
  const f = e.target;
  const text = f.termTemplate.value.trim();
  const s = await api('/api/settings', {
    method: 'PUT',
    body: { closing: { enabled: f.enabled.checked, termAfter: f.termAfter.value, termTemplate: text === defaultTerm.trim() ? '' : text } },
  });
  fillClosingForm(s.closing);
  toast('Fechamento salvo');
}));
$('#formPay').provider.addEventListener('change', (e) => { $('#mpBox').hidden = e.target.value !== 'mercadopago'; });
$('#formPay').addEventListener('submit', withBusy($('#formPay'), async (e) => {
  const f = e.target;
  const [phone = '', email = ''] = f.coContact.value.split(/\s*·\s*|\s*\|\s*/);
  const s = await api('/api/settings', {
    method: 'PUT',
    body: { payments: {
      enabled: f.enabled.checked,
      provider: f.provider.value,
      pixKey: f.pixKey.value.trim(),
      receiverName: f.receiverName.value.trim(),
      receiverCity: f.receiverCity.value.trim(),
      notifyPhone: f.notifyPhone.value.trim(),
      bankInfo: f.bankInfo.value.trim(),
      reservation: { base: Number(f.resBase.value || 0), perAdult: Number(f.resPerAdult.value || 0), description: f.resDescription.value.trim() },
      company: { name: f.coName.value.trim(), document: f.coDocument.value.trim(), address: f.coAddress.value.trim(), phone: phone.trim(), email: email.trim() },
      mercadopago: { accessToken: f.mpToken.value.trim(), payerEmail: f.mpEmail.value.trim() },
    } },
  });
  fillPayForm(s.payments);
  toast('Pagamentos salvos');
}));
$('#btnPixTest').addEventListener('click', async () => {
  try {
    const p = await api('/api/payments', { method: 'POST', body: { amount: 1, description: 'teste do Pix', send: false } });
    $('#pixTestBox').innerHTML = `<p>✅ Pix de teste gerado. Pague R$ 1,00 com o app do banco para conferir se o nome e a chave estão certos:</p>
      <img src="/api/payments/${esc(p.id)}/qr" alt="QR Code Pix" width="200" height="200" />
      <p><code class="pix-code">${esc(p.brcode)}</code></p>`;
  } catch (err) {
    $('#pixTestBox').textContent = `❌ ${err.message}`;
  }
});

// ---------- Marca ----------
function applyBrand(b) {
  const name = b?.name || 'Migra Hub';
  $('#brandName').textContent = name;
  $('#brandTagline').textContent = b?.tagline || 'Atendimento e vendas';
  document.title = `${name} · Atendimento e Vendas`;
}
function reloadLogos() {
  const v = Date.now();
  for (const img of [$('#brandLogo'), $('#brandPreview')]) img.src = `/brand/logo?v=${v}`;
}
$('#formBrand').addEventListener('submit', withBusy($('#formBrand'), async (e) => {
  const f = e.target;
  const s = await api('/api/settings', { method: 'PUT', body: { brand: { name: f.name.value.trim() || 'Migra Hub', tagline: f.tagline.value.trim() } } });
  if (f.logo.files[0]) {
    const form = new FormData();
    form.append('file', f.logo.files[0]);
    await api('/api/brand/logo', { method: 'POST', form });
    f.logo.value = '';
    reloadLogos();
  }
  applyBrand(s.brand);
  toast('Marca salva');
}));
$('#btnLogoReset').addEventListener('click', async () => {
  await api('/api/brand/logo', { method: 'DELETE' });
  reloadLogos();
  toast('Logo da Migra restaurada');
});

// ---------- Login ----------
$('#btnSignOut').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.href = '/login.html';
});

// ---------- Início ----------
(async () => {
  const state = await fetch('/api/auth/state').then((r) => r.json()).catch(() => ({}));
  if (!state.user) return (location.href = `/login.html${location.hash ? `?volta=${encodeURIComponent(location.hash)}` : ''}`);
  fetch('/api/brand').then((r) => r.json()).then(applyBrand).catch(() => {});
  window.currentUser = state.user;
  const admin = state.user.role === 'admin';
  document.body.classList.toggle('seller', !admin);
  $('#userName').textContent = state.user.name;
  $('#userAvatar').textContent = state.user.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  $('#userAvatar').title = admin ? 'Administrador' : 'Vendedor';
  $('#topSearch').addEventListener('submit', (e) => {
    e.preventDefault();
    showTab('leads');
    $('#leadSearch').value = $('#topSearchInput').value.trim();
    loaders.leads();
  });
  try {
    renderStatus(await api('/api/status'));
    if (admin) {
      await loaders.settings();
      applyDefaultDelays();
    }
  } catch (err) {
    toast(err.message, true);
  }
  connectEvents();
  refreshDueBadge();
  const initial = location.hash.slice(1);
  // Link da ficha (vem no aviso do vendedor): #lead=ID
  const leadLink = initial.match(/^lead=(.+)$/);
  if (leadLink) {
    showTab('leads');
    openLead(decodeURIComponent(leadLink[1]));
    return;
  }
  showTab(loaders[initial] || initial === 'send' ? initial : admin ? 'sales' : 'leads');
})();
