// Aba "Documentos": documentos emitidos para os clientes, entrega e aviso de renovação (o aviso sai só quando alguém clica).
(() => {
  const host = document.querySelector('#tab-lots')?.parentElement;
  if (!host) return;
  const sec = document.createElement('section');
  sec.id = 'tab-documents';
  sec.className = 'tab';
  host.appendChild(sec);
  const br = (d) => (d ? d.split('-').reverse().join('/') : '');
  const ST = { '': 'Todas', emitido: 'Emitidos', entregue: 'Entregues', renovacao: 'Renovação' };
  const f = { type: '', status: '', q: '', trash: false };
  let data;
  const dateInput = (id, v = '') => `<input type="date" id="${id}" value="${esc(v)}" />`;

  async function render() {
    const admin = window.currentUser?.role === 'admin';
    const qs = new URLSearchParams({ type: f.type, status: f.status, q: f.q, trash: f.trash ? '1' : '' });
    data = await api(`/api/documents?${qs}`);
    const c = data.counts;
    const pills = [['', 'Todos', c.total], ...Object.entries(data.types).map(([k, v]) => [k, v, c.byType[k] || 0])].map(([k, v, n]) => `<button class="btn small ${f.type === k ? 'primary' : ''}" data-a="type" data-v="${esc(k)}">${esc(v)} <span class="hint">${n}</span></button>`).join(' ');
    const stPills = Object.entries(ST).map(([k, v]) => `<button class="btn small ${f.status === k ? 'primary' : ''}" data-a="status" data-v="${esc(k)}">${v} <span class="hint">${k === '' ? c.total : c[k]}</span></button>`).join(' ');
    sec.innerHTML = `<div class="page-head"><h1>Documentos</h1><button class="btn primary" data-a="new">Cadastrar documento</button></div>
      <p class="hint">Cédula, admissão temporária, RUC, licença e outros documentos emitidos para os clientes: quem recebeu, quando foi entregue e quando avisar da renovação.${data.toNotify ? ` <b>${data.toNotify} cliente(s) já podem ser avisados da renovação</b> (filtro Renovação). O aviso só sai quando você clica em "Avisar".` : ''}</p>
      <div class="panel"><div class="row">${pills}</div><div class="row">${stPills}<button class="btn small ${f.trash ? 'primary' : ''}" data-a="trash">Lixeira ${c.trash}</button></div>
        <div class="row"><input id="dcQ" placeholder="Buscar por nome, dependente, nº do contrato, nº do documento ou telefone" value="${esc(f.q)}" /></div></div>
      <div id="dcForm"></div>
      <div class="panel">${data.items.map((d) => `<div class="card" data-id="${esc(d.id)}"><div class="row"><b>${esc(d.clientName)}</b> <span class="chip">${esc(data.types[d.type])}</span> <span class="chip">${d.status === 'entregue' ? 'Entregue' : 'Emitido'}</span>${d.renewalDue ? ' <span class="chip">Com renovação</span>' : ''}${d.noticedAt ? ' <span class="chip">Avisado</span>' : ''}</div>
        <div class="hint">${d.dependentOf ? `Dependente · contrato de ${esc(d.dependentOf)} · ` : ''}${d.number ? `Nº ${esc(d.number)} · ` : ''}${esc(d.contractNumber)}${d.responsible ? ` · Resp.: ${esc(d.responsible)}` : ''}</div>
        <div class="hint">Emissão ${esc(br(d.issuedAt)) || '—'} · 1º aviso ${esc(br(d.noticeAt)) || '—'} · Renovação ${esc(br(d.renewalAt)) || '—'}${d.deliveredAt ? ` · Entregue ${esc(br(d.deliveredAt))}` : ''}</div>
        <div class="row">${f.trash ? '<button class="btn small" data-a="restore">Restaurar</button>' : `<button class="btn small" data-a="edit">Editar</button>${d.status !== 'entregue' ? '<button class="btn small" data-a="deliver">Marcar como entregue</button>' : ''}<button class="btn small" data-a="notify">Avisar</button><button class="btn small danger" data-a="del">Lixeira</button>`}</div></div>`).join('') || '<p class="muted">Nenhum documento com esses filtros.</p>'}</div>
      ${admin ? `<div class="panel"><h2>Regras de aviso (em meses depois da emissão)</h2><div class="grid2">${['admissao_temporaria', 'cedula_identidade'].map((t) => `<label>${esc(data.types[t])}: 1º aviso / renovação<span class="row"><input type="number" data-r="${t}" data-k="notice" value="${data.rules[t]?.notice ?? ''}" /><input type="number" data-r="${t}" data-k="renewal" value="${data.rules[t]?.renewal ?? ''}" /></span></label>`).join('')}</div><button class="btn" data-a="rules">Salvar regras</button><p class="hint">Valores vistos no sistema antigo: 15 e 20 meses. A data digitada à mão em um documento vale mais que a regra.</p></div>` : ''}`;
  }
  function form(d = {}) {
    const el = sec.querySelector('#dcForm');
    el.innerHTML = `<div class="panel"><h2>${d.id ? 'Editar documento' : 'Novo documento'}</h2><div class="grid2">
      <label>Cliente<input id="dfName" value="${esc(d.clientName || '')}" /></label>
      <label>Dependente do contrato de (opcional)<input id="dfDep" value="${esc(d.dependentOf || '')}" /></label>
      <label>Tipo<select id="dfType">${Object.entries(data.types).map(([k, v]) => `<option value="${k}" ${d.type === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
      <label>Nº do documento<input id="dfNum" value="${esc(d.number || '')}" /></label>
      <label>Nº do contrato<input id="dfCon" value="${esc(d.contractNumber || '')}" /></label>
      <label>Responsável<input id="dfResp" value="${esc(d.responsible || '')}" /></label>
      <label>Telefone do cliente (para avisar)<input id="dfPhone" value="${esc(d.phone || '')}" placeholder="+595 981 000000" /></label>
      <label>Emissão${dateInput('dfIss', d.issuedAt)}</label><label>1º aviso (vazio = pela regra)${dateInput('dfNot', d.noticeAt)}</label><label>Renovação (vazio = pela regra)${dateInput('dfRen', d.renewalAt)}</label><label>Entrega${dateInput('dfDel', d.deliveredAt)}</label></div>
      <label>Anotações<input id="dfNotes" value="${esc(d.notes || '')}" /></label>
      <div class="row"><button class="btn primary" data-a="save" data-id="${esc(d.id || '')}">Salvar</button><button class="btn" data-a="cancel">Cancelar</button></div></div>`;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  const body = () => { const v = (i) => sec.querySelector(i).value; return { clientName: v('#dfName'), dependentOf: v('#dfDep'), type: v('#dfType'), number: v('#dfNum'), contractNumber: v('#dfCon'), responsible: v('#dfResp'), phone: v('#dfPhone'), issuedAt: v('#dfIss'), noticeAt: v('#dfNot'), renewalAt: v('#dfRen'), deliveredAt: v('#dfDel'), status: v('#dfDel') ? 'entregue' : 'emitido', notes: v('#dfNotes') }; };

  sec.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-a]'); if (!t) return;
    const a = t.dataset.a; const id = t.closest('[data-id]')?.dataset.id || t.dataset.id;
    try {
      if (a === 'type') { f.type = t.dataset.v; return await render(); }
      if (a === 'status') { f.status = t.dataset.v; return await render(); }
      if (a === 'trash') { f.trash = !f.trash; return await render(); }
      if (a === 'new') return form();
      if (a === 'cancel') return (sec.querySelector('#dcForm').innerHTML = '');
      if (a === 'edit') return form(data.items.find((x) => x.id === id));
      if (a === 'save') { const p = body(); if (t.dataset.id) await api(`/api/documents/${t.dataset.id}`, { method: 'PATCH', body: p }); else await api('/api/documents', { method: 'POST', body: p }); toast('Documento salvo'); }
      else if (a === 'deliver') await api(`/api/documents/${id}`, { method: 'PATCH', body: { status: 'entregue' } });
      else if (a === 'del') { if (!confirm('Mandar este documento para a lixeira?')) return; await api(`/api/documents/${id}`, { method: 'DELETE' }); }
      else if (a === 'restore') await api(`/api/documents/${id}/restore`, { method: 'POST', body: {} });
      else if (a === 'notify') {
        const n = await api(`/api/documents/${id}/notice`);
        if (!n.phone) return toast('Não achei o telefone deste cliente. Edite o documento e preencha o telefone.', true);
        if (!confirm(`Enviar este aviso para +${n.phone} agora?\n\n${n.text}`)) return;
        await api(`/api/documents/${id}/notify`, { method: 'POST', body: {} }); toast('Aviso enviado');
      } else if (a === 'rules') {
        const rules = {}; sec.querySelectorAll('[data-r]').forEach((i) => { (rules[i.dataset.r] ||= {})[i.dataset.k] = i.value; });
        await api('/api/documents/rules', { method: 'PUT', body: rules }); toast('Regras salvas');
      }
      await render();
    } catch (err) { toast(err.message, true); }
  });
  let tm;
  sec.addEventListener('input', (e) => { if (e.target.id === 'dcQ') { f.q = e.target.value; clearTimeout(tm); tm = setTimeout(() => render().then(() => { const i = sec.querySelector('#dcQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }).catch(() => {}), 300); } });
  loaders.documents = () => render().catch((e) => toast(e.message, true));
  // Quem cuida dos documentos (setor de documentação) também vê a aba.
  const t0 = setInterval(() => {
    if (!window.currentUser) return;
    clearInterval(t0);
    if (window.currentUser.role !== 'admin' && (window.currentUser.sectors || []).includes('documentacao')) { const b = document.querySelector('nav button[data-tab="documents"]'); if (b) { b.removeAttribute('data-admin'); b.hidden = false; } }
  }, 400);
})();
