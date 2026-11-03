// Aba "Guia de Cidades": contatos úteis de cada cidade do Paraguai para o cliente que está chegando.
(() => {
  const host = document.querySelector('#tab-lots')?.parentElement;
  if (!host) return;
  const sec = document.createElement('section');
  sec.id = 'tab-cities';
  sec.className = 'tab';
  host.appendChild(sec);
  let q = ''; let cur = null; let cats = [];
  async function list() {
    const admin = window.currentUser?.role === 'admin';
    const r = await api(`/api/cities?q=${encodeURIComponent(q)}`); cats = r.categories;
    sec.innerHTML = `<div class="page-head"><h1>Guia de Cidades</h1></div>
      <p class="hint">Escolha a cidade para onde o cliente está indo e envie o guia com os contatos úteis (emergência, saúde, escolas, mercados, bancos…). Os contatos são cadastrados pelo administrador; cidade sem contatos ainda mostra só a emergência nacional. Confira os números antes de enviar.</p>
      <div class="panel"><div class="row"><input id="ctQ" placeholder="Buscar cidade ou departamento" value="${esc(q)}" />${admin ? '<button class="btn" data-a="newcity">Nova cidade</button>' : ''}</div>
        <div class="grid2">${r.cities.map((c) => `<button class="card" data-a="open" data-id="${esc(c.id)}"><b>${esc(c.name)}</b><div class="hint">${esc(c.department)} · ${c.items} contato(s)</div></button>`).join('')}</div></div><div id="ctOut"></div>`;
    if (cur) await open(cur);
  }
  async function open(id) {
    cur = id;
    const admin = window.currentUser?.role === 'admin';
    const c = await api(`/api/cities/${id}`);
    const byCat = cats.map((k) => [k, c.items.filter((i) => i.category === k)]).filter(([, v]) => v.length);
    sec.querySelector('#ctOut').innerHTML = `<div class="panel"><h2>${esc(c.name)} <span class="hint">${esc(c.department)}</span></h2>
      ${byCat.map(([k, v]) => `<h3>${esc(k)}</h3><div class="table-wrap"><table><tbody>${v.map((i) => `<tr data-iid="${esc(i.id)}"><td><b>${esc(i.name)}</b><div class="hint">${esc(i.address)}${i.notes ? ` · ${esc(i.notes)}` : ''}</div></td><td>${esc(i.phone)}</td><td>${i.verified ? '<span class="chip">Conferido</span>' : '<span class="chip">A conferir</span>'}</td><td>${admin ? `<button class="btn small" data-a="verify" data-v="${i.verified ? 0 : 1}">${i.verified ? 'Desmarcar' : 'Conferi'}</button> <button class="btn small danger" data-a="delitem">Tirar</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`).join('') || '<p class="muted">Ainda sem contatos desta cidade.</p>'}
      <h3>Enviar o guia ao cliente</h3><div class="row"><input id="ctPhone" placeholder="WhatsApp do cliente (+595 981 000000)" /><input id="ctName" placeholder="Nome do cliente (opcional)" /><button class="btn" data-a="preview">Ver o texto</button><button class="btn primary" data-a="send">Enviar guia</button></div><pre id="ctPrev" class="hint" style="white-space:pre-wrap"></pre>
      ${admin ? `<h3>Cadastrar contato</h3><div class="grid2"><label>Categoria<select id="ciC">${cats.map((k) => `<option>${esc(k)}</option>`).join('')}</select></label><label>Nome<input id="ciN" /></label><label>Telefone<input id="ciP" /></label><label>Endereço<input id="ciA" /></label></div><button class="btn" data-a="additem">Guardar contato</button>
      <h3>Colar uma planilha</h3><textarea id="ciT" rows="5" placeholder="Categoria;Nome;Telefone;Endereço;Observação&#10;Saúde;Hospital Regional;+595 61 000000;Av. Principal"></textarea><button class="btn" data-a="import">Importar</button>` : ''}</div>`;
    sec.querySelector('#ctOut').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  sec.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-a]'); if (!t) return;
    const a = t.dataset.a; const g = (i) => sec.querySelector(i); const iid = t.closest('[data-iid]')?.dataset.iid;
    try {
      if (a === 'open') return await open(t.dataset.id);
      if (a === 'newcity') { const name = prompt('Nome da cidade:'); if (!name) return; const department = prompt('Departamento:') || ''; await api('/api/cities', { method: 'POST', body: { name, department } }); return await list(); }
      if (a === 'preview') { g('#ctPrev').textContent = (await api(`/api/cities/${cur}`)).message.replace(/^Olá[^!]*! /, g('#ctName').value ? `Olá, ${g('#ctName').value.split(' ')[0]}! ` : 'Olá! '); return; }
      if (a === 'send') { const body = { phone: g('#ctPhone').value, name: g('#ctName').value }; if (!body.phone) return toast('Digite o WhatsApp do cliente', true); if (!confirm('Enviar o guia desta cidade para este cliente agora?')) return; await api(`/api/cities/${cur}/send`, { method: 'POST', body }); return toast('Guia enviado'); }
      if (a === 'additem') { await api(`/api/cities/${cur}/items`, { method: 'POST', body: { category: g('#ciC').value, name: g('#ciN').value, phone: g('#ciP').value, address: g('#ciA').value } }); toast('Contato guardado'); }
      else if (a === 'verify') await api(`/api/cities/${cur}/items/${iid}`, { method: 'PATCH', body: { verified: t.dataset.v === '1' } });
      else if (a === 'delitem') { if (!confirm('Tirar este contato?')) return; await api(`/api/cities/${cur}/items/${iid}`, { method: 'DELETE' }); }
      else if (a === 'import') { const r = await api(`/api/cities/${cur}/import`, { method: 'POST', body: { text: g('#ciT').value } }); toast(`${r.added} contato(s) importado(s)${r.bad.length ? `; ${r.bad.length} linha(s) com problema` : ''}`); }
      await open(cur);
    } catch (err) { toast(err.message, true); }
  });
  let tm;
  sec.addEventListener('input', (e) => { if (e.target.id === 'ctQ') { q = e.target.value; clearTimeout(tm); tm = setTimeout(() => list().then(() => { const i = sec.querySelector('#ctQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }).catch(() => {}), 300); } });
  loaders.cities = () => list().catch((e) => toast(e.message, true));
})();
