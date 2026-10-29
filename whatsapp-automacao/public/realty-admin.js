// Administração da Migra Imóveis: imóveis, loteamentos (editor do mapa de lotes) e indicadores.
const REALTY_TYPES = { terreno: 'Terreno', lote: 'Lote', casa: 'Casa', departamento: 'Apartamento', galpao: 'Galpão', fazenda: 'Fazenda / chácara', local: 'Ponto comercial' };
const ST_LABEL = { disponivel: 'Disponível', reservado: 'Reservado', vendido: 'Vendido', alugado: 'Alugado' };
const fmtPrice = (v, cur = 'USD', perMonth = false) => (v ? `${{ USD: 'US$', PYG: 'Gs.', BRL: 'R$' }[cur] || cur} ${Number(v).toLocaleString('pt-BR')}${perMonth ? '/mês' : ''}` : '—');
const brlFmt = (v, cur = 'BRL') => (typeof v === 'string' ? v : `${{ USD: 'US$', PYG: 'Gs.', BRL: 'R$' }[cur] || cur} ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
/** Soma valores separando por moeda: "US$ 540,00 + R$ 1.200,00". */
const sumByCurrency = (list) => {
  const by = {};
  for (const c of list) by[c.currency || 'BRL'] = (by[c.currency || 'BRL'] || 0) + Number(c.amount || 0);
  return Object.entries(by).map(([cur, v]) => brlFmt(v, cur)).join(' + ') || brlFmt(0);
};

// ---------- IMÓVEIS ----------
let propsCache = [];
let propEditing = null;
loaders.realty = async () => {
  propsCache = await api('/api/realty/properties');
  $('#propTable').innerHTML = `<thead><tr><th></th><th>Imóvel</th><th>Tipo</th><th>Cidade</th><th>Preço</th><th>Situação</th><th></th></tr></thead><tbody>${propsCache.map((p) => `
    <tr data-prop="${esc(p.id)}">
      <td>${p.images?.[0] ? `<img src="${esc(p.images[0])}" alt="" class="thumb" loading="lazy" />` : '<span class="thumb"></span>'}</td>
      <td><b>${esc(p.title)}</b>${p.featured ? ' <span class="chip small">⭐ destaque</span>' : ''}${p.hidden ? ' <span class="chip small">oculto</span>' : ''}<div class="hint">${p.deal === 'aluguel' ? 'Aluguel' : 'Venda'}${p.areaText ? ` · ${esc(p.areaText)}` : ''}</div></td>
      <td>${esc(REALTY_TYPES[p.type] || p.type)}</td>
      <td>${esc(p.city || '—')}</td>
      <td><b>${fmtPrice(p.price, p.currency, p.perMonth)}</b></td>
      <td><select data-act="status">${Object.entries(ST_LABEL).map(([k, v]) => `<option value="${k}" ${p.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td class="row"><button class="btn small" data-act="edit">Editar</button><a class="btn small" href="/imoveis/p/${esc(p.slug)}" target="_blank" rel="noopener">Ver</a><button class="btn small danger" data-act="del">Excluir</button></td>
    </tr>`).join('') || '<tr><td colspan="7" class="muted">Nenhum imóvel. Clique em "Novo imóvel".</td></tr>'}</tbody>`;
};
function openProp(p) {
  propEditing = p?.id || null;
  const f = $('#formProp');
  f.reset();
  $('#propTitle').textContent = p ? 'Editar imóvel' : 'Novo imóvel';
  const v = p || { type: 'terreno', deal: 'venda', status: 'disponivel', currency: 'USD' };
  for (const k of ['title', 'type', 'deal', 'status', 'city', 'neighborhood', 'address', 'areaText', 'bedrooms', 'bathrooms', 'currency', 'agentName', 'agentWhatsapp', 'description']) f[k].value = v[k] ?? '';
  f.price.value = v.price ? Number(v.price).toLocaleString('pt-BR') : '';
  for (const k of ['perMonth', 'featured', 'hidden']) f[k].checked = Boolean(v[k]);
  f.images.value = (v.images || []).join('\n');
  $('#propView').hidden = !p;
  if (p) $('#propView').href = `/imoveis/p/${p.slug}`;
  $('#propUpHint').textContent = '';
  $('#propDialog').showModal();
}
$('#btnNewProp').addEventListener('click', () => openProp(null));
$('#propClose').addEventListener('click', () => $('#propDialog').close());
$('#propTable').addEventListener('click', async (e) => {
  const act = e.target.closest('button[data-act]')?.dataset.act;
  const id = e.target.closest('[data-prop]')?.dataset.prop;
  if (!act || !id) return;
  if (act === 'edit') return openProp(propsCache.find((p) => p.id === id));
  if (act === 'del' && confirm('Excluir este imóvel do site?')) {
    await api(`/api/realty/properties/${id}`, { method: 'DELETE' });
    loaders.realty();
  }
});
$('#propTable').addEventListener('change', async (e) => {
  if (e.target.dataset.act !== 'status') return;
  const id = e.target.closest('[data-prop]').dataset.prop;
  await api(`/api/realty/properties/${id}`, { method: 'PATCH', body: { status: e.target.value } });
  toast('Situação atualizada no site');
});
$('#propFiles').addEventListener('change', async (e) => {
  const f = $('#formProp');
  const files = [...e.target.files];
  for (const [i, file] of files.entries()) {
    $('#propUpHint').textContent = `Enviando foto ${i + 1} de ${files.length}…`;
    const form = new FormData();
    form.append('file', file);
    try {
      const r = await api('/api/realty/upload', { method: 'POST', form });
      f.images.value = [f.images.value.trim(), r.url].filter(Boolean).join('\n');
    } catch (err) {
      toast(err.message, true);
    }
  }
  $('#propUpHint').textContent = files.length ? `${files.length} foto(s) adicionada(s). Clique em Salvar.` : '';
  e.target.value = '';
});
$('#formProp').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = Object.fromEntries(['title', 'type', 'deal', 'status', 'city', 'neighborhood', 'address', 'areaText', 'bedrooms', 'bathrooms', 'price', 'currency', 'agentName', 'agentWhatsapp', 'description', 'images'].map((k) => [k, f[k].value]));
  for (const k of ['perMonth', 'featured', 'hidden']) body[k] = f[k].checked;
  try {
    await api(propEditing ? `/api/realty/properties/${propEditing}` : '/api/realty/properties', { method: propEditing ? 'PATCH' : 'POST', body });
    toast('Imóvel salvo ✅');
    $('#propDialog').close();
    loaders.realty();
  } catch (err) {
    toast(err.message, true);
  }
});

// ---------- LOTEAMENTOS ----------
let devCurrent = null;
let lotSel = null;
let mapMode = 'select';
let drawPts = [];
let dragRect = null;

loaders.lots = async () => {
  const list = await api('/api/realty/developments');
  $('#devList').innerHTML = list.map((d) => `
    <button type="button" class="dev-card ${devCurrent?.id === d.id ? 'active' : ''}" data-dev="${esc(d.id)}">
      <b>${esc(d.name)}</b><span class="hint">${esc(d.city || '')}</span>
      <span class="counts-row"><span><i class="ldot disponivel"></i>${d.summary.disponivel}</span><span><i class="ldot reservado"></i>${d.summary.reservado}</span><span><i class="ldot vendido"></i>${d.summary.vendido}</span></span>
    </button>`).join('') || `<p class="muted">${isAdmin() ? 'Nenhum loteamento. Clique em "Novo loteamento", envie a planta e desenhe os lotes.' : 'Nenhum loteamento cadastrado.'}</p>`;
  if (devCurrent) openDev(devCurrent.id);
};
$('#devList').addEventListener('click', (e) => {
  const id = e.target.closest('[data-dev]')?.dataset.dev;
  if (id) openDev(id);
});
$('#btnNewDev').addEventListener('click', async () => {
  const name = prompt('Nome do loteamento:');
  if (!name) return;
  try {
    devCurrent = await api('/api/realty/developments', { method: 'POST', body: { name } });
    await loaders.lots();
  } catch (err) {
    toast(err.message, true);
  }
});
async function openDev(id) {
  devCurrent = await api(`/api/realty/developments/${id}`);
  $$('.dev-card').forEach((c) => c.classList.toggle('active', c.dataset.dev === id));
  $('#devEditor').hidden = false;
  $('#devTitle').textContent = devCurrent.name;
  $('#devSiteLink').href = `/imoveis/l/${devCurrent.slug}`;
  const f = $('#formDev');
  for (const k of ['name', 'city', 'address', 'currency', 'agentName', 'agentWhatsapp', 'description']) f[k].value = devCurrent[k] || (k === 'currency' ? 'USD' : '');
  renderLotMap();
  if (lotSel) showLot(lotSel);
}
$('#formDev').addEventListener('submit', withBusy($('#formDev'), async (e) => {
  const body = Object.fromEntries(new FormData(e.target));
  await api(`/api/realty/developments/${devCurrent.id}`, { method: 'PATCH', body });
  toast('Loteamento salvo');
  loaders.lots();
}));
$('#btnDelDev').addEventListener('click', async () => {
  if (!devCurrent || !confirm(`Excluir o loteamento "${devCurrent.name}" e todos os lotes?`)) return;
  await api(`/api/realty/developments/${devCurrent.id}`, { method: 'DELETE' });
  devCurrent = null;
  $('#devEditor').hidden = true;
  loaders.lots();
});
$('#planFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode().catch(() => {});
  const form = new FormData();
  form.append('file', file);
  form.append('width', img.naturalWidth);
  form.append('height', img.naturalHeight);
  try {
    await api(`/api/realty/developments/${devCurrent.id}/plan`, { method: 'POST', form });
    toast('Planta enviada. Agora desenhe os lotes por cima.');
    openDev(devCurrent.id);
  } catch (err) {
    toast(err.message, true);
  }
  e.target.value = '';
});

const lotCentroid = (shape) => shape.reduce(([sx, sy], [x, y]) => [sx + x / shape.length, sy + y / shape.length], [0, 0]);
function renderLotMap() {
  const d = devCurrent;
  const s = { disponivel: 0, reservado: 0, vendido: 0 };
  d.lots.forEach((l) => s[l.status]++);
  $('#lotCounts').innerHTML = `<span><i class="ldot disponivel"></i>${s.disponivel} disponíveis</span><span><i class="ldot reservado"></i>${s.reservado} reservados</span><span><i class="ldot vendido"></i>${s.vendido} vendidos</span><span class="hint">${d.lots.length} lotes</span>`;
  const draft = drawPts.length ? `<polyline class="draft" points="${drawPts.map((p) => p.join(',')).join(' ')}" />${drawPts.map(([x, y]) => `<circle class="draft-pt" cx="${x}" cy="${y}" r=".5" />`).join('')}` : '';
  const rect = dragRect ? `<rect class="draft" x="${Math.min(dragRect.x0, dragRect.x1)}" y="${Math.min(dragRect.y0, dragRect.y1)}" width="${Math.abs(dragRect.x1 - dragRect.x0)}" height="${Math.abs(dragRect.y1 - dragRect.y0)}" />` : '';
  $('#lotEditor').innerHTML = `${d.plan ? `<img src="${esc(d.plan)}" alt="Planta" draggable="false" />` : '<div class="noplan">Envie a planta do loteamento (imagem) para desenhar por cima.<br>Sem planta, os lotes ficam sobre uma grade.</div>'}
    <svg viewBox="0 0 100 100" preserveAspectRatio="none">
      ${d.lots.map((l) => `<polygon class="elot ${l.status} ${lotSel === l.id ? 'sel' : ''}" data-lot="${l.id}" points="${l.shape.map((p) => p.join(',')).join(' ')}"><title>${esc(l.code)}</title></polygon>`).join('')}
      ${draft}${rect}
    </svg>
    ${d.lots.map((l) => { const [x, y] = lotCentroid(l.shape); return `<span class="elabel" style="left:${x}%;top:${y}%">${esc(l.number || l.code)}</span>`; }).join('')}`;
}
function pointFrom(e) {
  const r = $('#lotEditor').getBoundingClientRect();
  return [Math.round(((e.clientX - r.left) / r.width) * 10000) / 100, Math.round(((e.clientY - r.top) / r.height) * 10000) / 100];
}
$$('.map-toolbar [data-mode]').forEach((b) => b.addEventListener('click', () => {
  mapMode = b.dataset.mode;
  drawPts = [];
  dragRect = null;
  $$('.map-toolbar [data-mode]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  $('#modeHint').textContent = {
    select: 'Clique em um lote para editar.',
    draw: 'Clique nos cantos do lote, um por um. Para terminar, clique de novo no primeiro ponto (ou dê dois cliques).',
    block: 'Arraste um retângulo sobre a quadra. Depois informe quantas linhas e colunas de lotes ela tem.',
  }[mapMode];
  $('#lotEditor').classList.toggle('drawing', mapMode !== 'select');
  if (devCurrent) renderLotMap();
}));
$('#lotEditor').addEventListener('click', (e) => {
  if (!devCurrent) return;
  if (mapMode === 'select') {
    const id = e.target.closest('[data-lot]')?.dataset.lot;
    if (id) showLot(id);
    return;
  }
  if (mapMode !== 'draw' || !isAdmin()) return;
  const p = pointFrom(e);
  if (drawPts.length >= 3) {
    const [fx, fy] = drawPts[0];
    if (Math.hypot(fx - p[0], fy - p[1]) < 1.2) return finishDraw();
  }
  drawPts.push(p);
  renderLotMap();
});
$('#lotEditor').addEventListener('dblclick', (e) => {
  if (mapMode === 'draw' && drawPts.length >= 3) {
    e.preventDefault();
    finishDraw();
  }
});
$('#lotEditor').addEventListener('pointerdown', (e) => {
  if (mapMode !== 'block' || !isAdmin()) return;
  const [x, y] = pointFrom(e);
  dragRect = { x0: x, y0: y, x1: x, y1: y };
  $('#lotEditor').setPointerCapture(e.pointerId);
});
$('#lotEditor').addEventListener('pointermove', (e) => {
  if (!dragRect || mapMode !== 'block') return;
  [dragRect.x1, dragRect.y1] = pointFrom(e);
  renderLotMap();
});
$('#lotEditor').addEventListener('pointerup', () => {
  if (!dragRect || mapMode !== 'block') return;
  const w = Math.abs(dragRect.x1 - dragRect.x0);
  const h = Math.abs(dragRect.y1 - dragRect.y0);
  if (w < 1 || h < 1) { dragRect = null; renderLotMap(); return; }
  showBlockForm({ x: Math.min(dragRect.x0, dragRect.x1), y: Math.min(dragRect.y0, dragRect.y1), w, h });
});
function finishDraw() {
  const shape = drawPts;
  drawPts = [];
  $('#lotSide').innerHTML = `<h2>Novo lote</h2>${lotFields({})}
    <div class="row"><button class="btn primary" id="btnLotCreate">Criar lote</button><button class="btn" id="btnLotCancel">Cancelar</button></div>`;
  renderLotMap();
  const draft = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  draft.setAttribute('class', 'draft');
  draft.setAttribute('points', shape.map((p) => p.join(',')).join(' '));
  $('#lotEditor svg').appendChild(draft);
  $('#btnLotCancel').onclick = () => { renderLotMap(); $('#lotSide').innerHTML = '<p class="muted">Desenho cancelado.</p>'; };
  $('#btnLotCreate').onclick = async () => {
    try {
      const lot = await api(`/api/realty/developments/${devCurrent.id}/lots`, { method: 'POST', body: { ...readLotFields(), shape } });
      lotSel = lot.id;
      toast(`Lote ${lot.code} criado`);
      openDev(devCurrent.id);
    } catch (err) {
      toast(err.message, true);
    }
  };
}
function showBlockForm(rect) {
  $('#lotSide').innerHTML = `<h2>Gerar quadra</h2>
    <div class="grid2 tight">
      <label>Quadra <input id="bBlock" placeholder="A" /></label>
      <label>Numeração começa em <input id="bStart" type="number" min="1" value="1" /></label>
      <label>Linhas de lotes <input id="bRows" type="number" min="1" max="40" value="2" /></label>
      <label>Lotes por linha <input id="bCols" type="number" min="1" max="40" value="10" /></label>
      <label>Área de cada lote (m²) <input id="bArea" inputmode="decimal" placeholder="360" /></label>
      <label>Preço de cada lote <input id="bPrice" inputmode="decimal" placeholder="15.000" /></label>
    </div>
    <div class="row"><button class="btn primary" id="btnBlock">Gerar lotes</button><button class="btn" id="btnBlockCancel">Cancelar</button></div>
    <p class="hint">Os lotes são criados lado a lado dentro do retângulo. Depois dá para ajustar cada um.</p>`;
  $('#btnBlockCancel').onclick = () => { dragRect = null; renderLotMap(); $('#lotSide').innerHTML = ''; };
  $('#btnBlock').onclick = async () => {
    try {
      const lots = await api(`/api/realty/developments/${devCurrent.id}/block`, {
        method: 'POST',
        body: { ...rect, block: $('#bBlock').value, start: $('#bStart').value, rows: $('#bRows').value, cols: $('#bCols').value, area: $('#bArea').value, price: $('#bPrice').value },
      });
      dragRect = null;
      $('#lotSide').innerHTML = `<p class="muted">✅ ${lots.length} lotes criados. Clique em um lote para ajustar, ou arraste outro retângulo para a próxima quadra.</p>`;
      toast(`${lots.length} lotes criados`);
      openDev(devCurrent.id);
    } catch (err) {
      toast(err.message, true);
    }
  };
}
const lotFields = (l) => `
  <div class="grid2 tight">
    <label>Quadra <input id="lBlock" value="${esc(l.block || '')}" /></label>
    <label>Lote nº <input id="lNumber" value="${esc(l.number || '')}" /></label>
    <label>Código (opcional) <input id="lCode" value="${esc(l.code || '')}" placeholder="QA-L1" /></label>
    <label>Área (m²) <input id="lArea" inputmode="decimal" value="${l.area ?? ''}" /></label>
    <label>Preço <input id="lPrice" inputmode="decimal" value="${l.price ?? ''}" /></label>
    <label>Situação <select id="lStatus">${['disponivel', 'reservado', 'vendido'].map((s) => `<option value="${s}" ${(l.status || 'disponivel') === s ? 'selected' : ''}>${ST_LABEL[s]}</option>`).join('')}</select></label>
  </div>
  <label>Observação interna <input id="lNote" value="${esc(l.note || '')}" placeholder="ex.: reservado para o cliente MIG-4K7P" /></label>`;
const readLotFields = () => ({ block: $('#lBlock').value, number: $('#lNumber').value, code: $('#lCode').value, area: $('#lArea').value, price: $('#lPrice').value, status: $('#lStatus').value, note: $('#lNote').value });
function showLot(id) {
  const l = devCurrent.lots.find((x) => x.id === id);
  if (!l) return;
  lotSel = id;
  $$('.elot').forEach((p) => p.classList.toggle('sel', p.dataset.lot === id));
  if (!isAdmin()) {
    $('#lotSide').innerHTML = `<h2>${esc(l.code)}</h2><p class="hint">${l.area ? `${l.area} m² · ` : ''}${fmtPrice(l.price, devCurrent.currency)}</p>
      <label>Situação <select id="lStatus">${['disponivel', 'reservado', 'vendido'].map((s) => `<option value="${s}" ${l.status === s ? 'selected' : ''}>${ST_LABEL[s]}</option>`).join('')}</select></label>
      <button class="btn primary" id="btnLotSave">Salvar situação</button>`;
    $('#btnLotSave').onclick = async () => {
      await api(`/api/realty/developments/${devCurrent.id}/lots/${id}`, { method: 'PATCH', body: { status: $('#lStatus').value } });
      toast('Situação atualizada no mapa');
      openDev(devCurrent.id);
    };
    return;
  }
  $('#lotSide').innerHTML = `<h2>${esc(l.code)}</h2>${lotFields(l)}
    <div class="row"><button class="btn primary" id="btnLotSave">Salvar</button><button class="btn danger" id="btnLotDel">Excluir lote</button></div>`;
  $('#btnLotSave').onclick = async () => {
    try {
      await api(`/api/realty/developments/${devCurrent.id}/lots/${id}`, { method: 'PATCH', body: readLotFields() });
      toast('Lote salvo');
      openDev(devCurrent.id);
    } catch (err) {
      toast(err.message, true);
    }
  };
  $('#btnLotDel').onclick = async () => {
    if (!confirm('Excluir este lote do mapa?')) return;
    await api(`/api/realty/developments/${devCurrent.id}/lots/${id}`, { method: 'DELETE' });
    lotSel = null;
    $('#lotSide').innerHTML = '';
    openDev(devCurrent.id);
  };
}

// ---------- INDICADORES ----------
loaders.affiliates = async () => {
  const [list, comms, settings] = await Promise.all([api('/api/affiliates'), api('/api/affiliates-commissions'), api('/api/settings')]);
  const toPay = comms.filter((c) => c.status === 'a_pagar');
  const sum = (l, f) => l.reduce((s, x) => s + (Number(f(x)) || 0), 0);
  $('#affKpis').innerHTML = [
    ['Indicadores ativos', list.filter((a) => a.status === 'ativo').length, `${list.length} cadastrados`, 'affiliates'],
    ['Cliques nos links', sum(list, (a) => a.stats.clicks), `${sum(list, (a) => a.stats.visitors)} pessoas diferentes`, 'send'],
    ['Indicações', sum(list, (a) => a.stats.leads), `${sum(list, (a) => a.stats.won)} fecharam negócio`, 'userPlus'],
    ['Comissões a pagar', sumByCurrency(toPay), `${toPay.length} comissão(ões)`, 'money'],
  ].map(([l, v, sub, ico]) => `<div class="card kpi"><div class="kpi-head"><span class="label">${l}</span><span class="kpi-ico">${icon(ico, 16)}</span></div><div class="value">${v}</div><div class="sub">${sub}</div></div>`).join('');
  $('#commTable').innerHTML = `<thead><tr><th>Data</th><th>Indicador</th><th>Cliente</th><th>Linha</th><th>Venda</th><th>Comissão</th><th>Pix do indicador</th><th>Situação</th><th></th></tr></thead><tbody>${comms.map((c) => `
    <tr data-comm="${esc(c.id)}"><td>${fmtDate(c.createdAt)}</td><td><b>${esc(c.affName)}</b></td><td>${esc(c.clientName)}</td><td>${c.category === 'imoveis' ? 'Imóveis' : 'Migração'}</td>
      <td>${brlFmt(c.saleValue, c.currency)}</td><td><b>${brlFmt(c.amount, c.currency)}</b><div class="hint">${c.percent}%${c.fixed ? ` + ${brlFmt(c.fixed, c.currency)}` : ''}</div></td><td class="small">${esc(c.affPix || '—')}</td>
      <td>${c.status === 'paga' ? `<span class="badge done">Paga ${fmtDate(c.paidAt)}</span>` : c.status === 'cancelada' ? '<span class="badge canceled">Cancelada</span>' : '<span class="badge paused">A pagar</span>'}</td>
      <td class="row">${c.status === 'a_pagar' ? '<button class="btn small primary" data-act="paid">Marcar como paga</button><button class="btn small danger" data-act="cancel">Cancelar</button>' : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">As comissões aparecem aqui quando uma venda de cliente indicado é confirmada.</td></tr>'}</tbody>`;
  $('#affTable').innerHTML = `<thead><tr><th>Indicador</th><th>Código</th><th>WhatsApp</th><th>Cliques</th><th>Indicações</th><th>Vendas</th><th>A receber</th><th>Situação</th></tr></thead><tbody>${list.map((a) => `
    <tr data-aff="${esc(a.id)}"><td><b>${esc(a.name)}</b><div class="hint">desde ${fmtDate(a.createdAt)}${a.email ? ` · ${esc(a.email)}` : ''}</div></td><td><code>${esc(a.code)}</code></td><td>${esc(fmtPhone(a.whatsapp))}</td>
      <td>${a.stats.clicks}</td><td>${a.stats.leads}</td><td>${a.stats.won}</td><td>${brlFmt(a.stats.toReceive)}</td>
      <td><button class="btn small ${a.status === 'ativo' ? '' : 'danger'}" data-act="toggle">${a.status === 'ativo' ? 'Ativo · bloquear' : 'Bloqueado · reativar'}</button></td></tr>`).join('') || '<tr><td colspan="8" class="muted">Ninguém cadastrado ainda. Divulgue a página /parceiros.</td></tr>'}</tbody>`;
  const a = settings.affiliates || {};
  const f = $('#formAff');
  f.enabled.checked = a.enabled !== false;
  f.imoveisPercent.value = a.rates?.imoveis?.percent ?? 0;
  f.imoveisFixed.value = a.rates?.imoveis?.fixed ?? 0;
  f.migracaoPercent.value = a.rates?.migracao?.percent ?? 0;
  f.migracaoFixed.value = a.rates?.migracao?.fixed ?? 0;
  f.cookieDays.value = a.cookieDays ?? 180;
  f.shareMessage.value = a.shareMessage || '';
};
$('#commTable').addEventListener('click', async (e) => {
  const act = e.target.closest('button[data-act]')?.dataset.act;
  const id = e.target.closest('[data-comm]')?.dataset.comm;
  if (!act || !id) return;
  try {
    if (act === 'paid') {
      if (!confirm('Confirmar que a comissão foi paga no Pix do indicador? Ele recebe um aviso no WhatsApp.')) return;
      await api(`/api/affiliates-commissions/${id}/paid`, { method: 'POST' });
    }
    if (act === 'cancel' && confirm('Cancelar esta comissão?')) await api(`/api/affiliates-commissions/${id}/cancel`, { method: 'POST' });
    loaders.affiliates();
  } catch (err) {
    toast(err.message, true);
  }
});
$('#affTable').addEventListener('click', async (e) => {
  if (e.target.closest('button')?.dataset.act !== 'toggle') return;
  const id = e.target.closest('[data-aff]').dataset.aff;
  const blocked = e.target.textContent.startsWith('Bloqueado');
  await api(`/api/affiliates/${id}`, { method: 'PATCH', body: { status: blocked ? 'ativo' : 'bloqueado' } });
  loaders.affiliates();
});
$('#formAff').addEventListener('submit', withBusy($('#formAff'), async (e) => {
  const f = e.target;
  await api('/api/settings', {
    method: 'PUT',
    body: { affiliates: {
      enabled: f.enabled.checked,
      cookieDays: Number(f.cookieDays.value || 180),
      shareMessage: f.shareMessage.value,
      rates: {
        imoveis: { percent: Number(f.imoveisPercent.value || 0), fixed: Number(f.imoveisFixed.value || 0) },
        migracao: { percent: Number(f.migracaoPercent.value || 0), fixed: Number(f.migracaoFixed.value || 0) },
      },
    } },
  });
  toast('Regras do programa salvas');
  loaders.affiliates();
}));
