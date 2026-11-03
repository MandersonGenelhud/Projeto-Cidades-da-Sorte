// Aba "Tarefas": o que cada pessoa precisa fazer, com prazo e lembrete no WhatsApp.
(() => {
  const host = document.querySelector('#tab-lots')?.parentElement;
  if (!host) return;
  const sec = document.createElement('section');
  sec.id = 'tab-tasks';
  sec.className = 'tab';
  host.appendChild(sec);
  const br = (d) => (d ? d.split('-').reverse().join('/') : 'sem prazo');
  const f = { status: 'open', q: '', who: '' };
  async function load() {
    const admin = window.currentUser?.role === 'admin';
    const r = await api(`/api/tasks?status=${f.status}&q=${encodeURIComponent(f.q)}&who=${encodeURIComponent(f.who)}`);
    sec.innerHTML = `<div class="page-head"><h1>Tarefas</h1></div>
      <p class="hint">Abertas: <b>${r.counts.open}</b> · para hoje: <b>${r.counts.today}</b> · atrasadas: <b style="color:#d93025">${r.counts.late}</b>. No dia do prazo você recebe um lembrete no WhatsApp.</p>
      <div class="panel"><h2>Nova tarefa</h2><div class="grid2"><label>O que fazer<input id="tkT" placeholder="Ex.: conferir o pagamento da entrada da Carla" /></label><label>Prazo<input type="date" id="tkD" /></label><label>Cliente (opcional)<input id="tkC" /></label>${admin ? `<label>Para quem<select id="tkW">${r.people.map((p) => `<option value="${esc(p.id)}" ${p.id === window.currentUser.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>` : ''}</div><label>Detalhes<input id="tkN" /></label><button class="btn primary" data-a="add">Criar tarefa</button></div>
      <div class="panel"><div class="row"><input id="tkQ" placeholder="Buscar" value="${esc(f.q)}" /><select id="tkS"><option value="open" ${f.status === 'open' ? 'selected' : ''}>Abertas</option><option value="done" ${f.status === 'done' ? 'selected' : ''}>Feitas</option><option value="all" ${f.status === 'all' ? 'selected' : ''}>Todas</option></select>${admin ? `<select id="tkF"><option value="">Todas as pessoas</option>${r.people.map((p) => `<option value="${esc(p.id)}" ${f.who === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : ''}</div>
        ${r.items.map((t) => `<div class="card" data-id="${esc(t.id)}"><div class="row"><label class="check"><input type="checkbox" data-a="done" ${t.status === 'done' ? 'checked' : ''} /> <b ${t.status === 'done' ? 'style="text-decoration:line-through"' : ''}>${esc(t.title)}</b></label>${t.late ? '<span class="chip" style="color:#d93025">Atrasada</span>' : ''}<span class="chip">${esc(br(t.due))}</span>${admin || t.assigneeId !== window.currentUser.id ? `<span class="chip">${esc(t.assigneeName)}</span>` : ''}</div>${t.clientName ? `<div class="hint">Cliente: ${esc(t.clientName)}</div>` : ''}${t.notes ? `<div class="hint">${esc(t.notes)}</div>` : ''}<button class="btn small danger" data-a="del">Excluir</button></div>`).join('') || '<p class="muted">Nenhuma tarefa.</p>'}</div>`;
  }
  sec.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-a]'); if (!t) return; const g = (i) => sec.querySelector(i); const id = t.closest('[data-id]')?.dataset.id;
    try {
      if (t.dataset.a === 'add') { await api('/api/tasks', { method: 'POST', body: { title: g('#tkT').value, due: g('#tkD').value, clientName: g('#tkC').value, notes: g('#tkN').value, ...(g('#tkW') ? { assigneeId: g('#tkW').value } : {}) } }); toast('Tarefa criada'); }
      else if (t.dataset.a === 'del') { if (!confirm('Excluir esta tarefa?')) return; await api(`/api/tasks/${id}`, { method: 'DELETE' }); }
      else return;
      await load();
    } catch (err) { toast(err.message, true); }
  });
  sec.addEventListener('change', async (e) => {
    try {
      if (e.target.dataset.a === 'done') { await api(`/api/tasks/${e.target.closest('[data-id]').dataset.id}`, { method: 'PATCH', body: { done: e.target.checked } }); return await load(); }
      if (e.target.id === 'tkS') { f.status = e.target.value; await load(); }
      if (e.target.id === 'tkF') { f.who = e.target.value; await load(); }
    } catch (err) { toast(err.message, true); }
  });
  let tm;
  sec.addEventListener('input', (e) => { if (e.target.id === 'tkQ') { f.q = e.target.value; clearTimeout(tm); tm = setTimeout(() => load().then(() => { const i = sec.querySelector('#tkQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }).catch(() => {}), 300); } });
  loaders.tasks = () => load().catch((e) => toast(e.message, true));
})();
