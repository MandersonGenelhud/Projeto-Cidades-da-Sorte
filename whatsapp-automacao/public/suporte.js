// Aba "Suporte": chamados internos com prazo de primeira resposta e de solução.
(() => {
  const host = document.querySelector('#tab-lots')?.parentElement;
  if (!host) return;
  const sec = document.createElement('section');
  sec.id = 'tab-support';
  sec.className = 'tab';
  host.appendChild(sec);
  const f = { status: 'abertos', q: '' };
  let open = null;
  const when = (d) => (d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const slaTag = (t) => (t.status === 'resolvido' ? '<span class="badge ok">Resolvido</span>'
    : t.sla.solveLate ? '<span class="badge paused">Solução atrasada</span>'
      : t.sla.firstLate ? '<span class="badge paused">Resposta atrasada</span>'
        : '<span class="badge pending">No prazo</span>');

  async function load() {
    const admin = window.currentUser?.role === 'admin';
    const r = await api(`/api/support?status=${f.status}&q=${encodeURIComponent(f.q)}`);
    const badge = document.getElementById('supportBadge');
    if (badge) { badge.hidden = !(admin && r.counts.abertos); badge.textContent = r.counts.abertos; }
    const urg = Object.entries(r.sla).map(([k, v]) => `<option value="${k}" ${k === 'media' ? 'selected' : ''}>${esc(v.label)} · resposta em até ${v.first >= 60 ? `${v.first / 60}h` : `${v.first} min`}</option>`).join('');
    sec.innerHTML = `<div class="page-head"><h1>Suporte</h1></div>
      <p class="hint">Problema no sistema, dúvida ou pedido para a administração. Abertos: <b>${r.counts.abertos}</b> · com prazo estourado: <b style="color:#d93025">${r.counts.atrasados}</b>. ${admin ? 'Você recebe cada chamado novo no WhatsApp.' : 'Você recebe a resposta no seu WhatsApp.'}</p>
      <div class="panel"><h2>Abrir chamado</h2>
        <label>Título<input id="spT" placeholder="Ex.: Não consigo gerar o orçamento do cliente Carlos" /></label>
        <label>O que aconteceu<textarea id="spD" rows="3" placeholder="O que você fez, o que apareceu na tela e em qual aba"></textarea></label>
        <label>Urgência<select id="spU">${urg}</select></label>
        <button class="btn primary" data-a="open">Abrir chamado</button></div>
      <div class="panel"><div class="row"><input id="spQ" placeholder="Buscar" value="${esc(f.q)}" />
        <select id="spS"><option value="abertos" ${f.status === 'abertos' ? 'selected' : ''}>Abertos</option><option value="resolvido" ${f.status === 'resolvido' ? 'selected' : ''}>Resolvidos</option><option value="todos" ${f.status === 'todos' ? 'selected' : ''}>Todos</option></select></div>
        ${r.items.map((t) => `<div class="card" data-id="${esc(t.id)}"><div class="row"><b>${esc(t.number)} · ${esc(t.title)}</b> ${slaTag(t)} <span class="chip small">${esc(t.urgencyLabel)}</span></div>
          <div class="hint">${esc(t.createdBy)} · aberto em ${when(t.createdAt)} · resposta até ${when(t.firstResponseDue)} · solução até ${when(t.resolutionDue)}</div>
          <button class="btn small" data-a="view">${open === t.id ? 'Fechar' : 'Abrir conversa'}</button><div class="sp-detail" ${open === t.id ? '' : 'hidden'}></div></div>`).join('') || '<p class="muted">Nenhum chamado.</p>'}</div>`;
    if (open) await detail(open);
    const c = await api('/api/team-contacts').catch(() => ({ items: [] }));
    if (c.items.length) {
      const box = document.createElement('div');
      box.className = 'panel';
      box.innerHTML = `<h2>Contatos da equipe</h2><div class="table-wrap"><table><thead><tr><th>Nome</th><th>Cargo</th><th>Setor</th><th>Telefone</th><th>E-mail</th></tr></thead><tbody>${c.items.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.role)}</td><td>${esc(x.department)}</td><td>${esc(x.phone)}</td><td>${esc(x.email)}</td></tr>`).join('')}</tbody></table></div>`;
      sec.appendChild(box);
    }
  }
  async function detail(id) {
    const box = sec.querySelector(`[data-id="${CSS.escape(id)}"] .sp-detail`);
    if (!box) return;
    const admin = window.currentUser?.role === 'admin';
    const t = await api(`/api/support/${id}`);
    box.hidden = false;
    box.innerHTML = `<p style="white-space:pre-wrap">${esc(t.description)}</p>
      ${t.messages.map((m) => `<div class="card" style="margin:6px 0;${m.admin ? 'border-left:3px solid #0a7d3b' : ''}"><small>${esc(m.by)} · ${when(m.at)}</small><div style="white-space:pre-wrap">${esc(m.text)}</div></div>`).join('')}
      ${t.solution ? `<div class="card" style="border-left:3px solid #0a7d3b"><b>Solução</b> (${esc(t.resolvedBy || '')} · ${when(t.resolvedAt)})<div style="white-space:pre-wrap">${esc(t.solution)}</div></div>` : ''}
      <label>Mensagem<textarea class="spM" rows="2"></textarea></label>
      <button class="btn small" data-a="reply">Enviar</button> ${admin && t.status !== 'resolvido' ? '<button class="btn small primary" data-a="resolve">Marcar resolvido</button>' : ''}`;
  }
  sec.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const g = (i) => sec.querySelector(i); const id = b.closest('[data-id]')?.dataset.id;
    try {
      if (b.dataset.a === 'open') { await api('/api/support', { method: 'POST', body: { title: g('#spT').value, description: g('#spD').value, urgency: g('#spU').value } }); toast('Chamado aberto. A administração foi avisada.'); }
      else if (b.dataset.a === 'view') { open = open === id ? null : id; }
      else if (b.dataset.a === 'reply') { await api(`/api/support/${id}/messages`, { method: 'POST', body: { text: b.closest('.sp-detail').querySelector('.spM').value } }); }
      else if (b.dataset.a === 'resolve') { const solution = prompt('Qual foi a solução? (quem abriu recebe no WhatsApp)'); if (!solution) return; await api(`/api/support/${id}/resolve`, { method: 'POST', body: { solution } }); }
      else return;
      await load();
    } catch (err) { toast(err.message, true); }
  });
  sec.addEventListener('change', (e) => { if (e.target.id === 'spS') { f.status = e.target.value; load(); } });
  let tm;
  sec.addEventListener('input', (e) => { if (e.target.id === 'spQ') { f.q = e.target.value; clearTimeout(tm); tm = setTimeout(() => load().then(() => { const i = sec.querySelector('#spQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }), 300); } });
  loaders.support = () => load().catch((err) => toast(err.message, true));
})();
