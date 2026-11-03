// Aba "Tutoriais": guia do sistema e treinamento semanal de fechamento. O vendedor só vê o dele; o administrador vê tudo e edita.
(() => {
  const host = document.querySelector('#tab-lots')?.parentElement;
  if (!host) return;
  const sec = document.createElement('section');
  sec.id = 'tab-tutorials';
  sec.className = 'tab';
  host.appendChild(sec);
  const AUD = { admin: 'Só administrador', seller: 'Vendedores', all: 'Todos' };
  // Texto simples → HTML seguro (parágrafos e listas), sem aceitar HTML de fora.
  const render = (body) => String(body).split(/\n{2,}/).map((blk) => {
    const lines = blk.split('\n');
    if (lines.every((l) => /^\s*[-•]\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${esc(l.replace(/^\s*[-•]\s+/, ''))}</li>`).join('')}</ul>`;
    return lines.map((l) => (/^\d+\.\s/.test(l) ? `<h3>${esc(l)}</h3>` : /^\s*[-•]\s+/.test(l) ? `<li>${esc(l.replace(/^\s*[-•]\s+/, ''))}</li>` : `<p>${esc(l)}</p>`)).join('');
  }).join('');
  let open = null;
  async function load() {
    const admin = window.currentUser?.role === 'admin';
    const list = await api('/api/tutorials');
    sec.innerHTML = `<div class="page-head"><h1>Tutoriais</h1>${admin ? '<span><button class="btn" data-a="weekly">Criar treinamento da semana agora</button> <button class="btn primary" data-a="new">Novo tutorial</button></span>' : ''}</div>
      <p class="hint">Guias de como o sistema funciona e <b>um treinamento novo de fechamento de venda toda semana</b>. Quem fecha mais, ganha mais comissão: leia cada treinamento.</p>
      <div id="tuForm"></div>
      <div class="panel">${list.map((t) => `<div class="card" data-id="${esc(t.id)}"><div class="row"><b>${esc(t.title)}</b> <span class="chip">${esc(t.category)}</span>${t.auto ? ' <span class="chip">Treinamento da semana</span>' : ''}${admin ? ` <span class="chip">${AUD[t.audience]}</span>${t.hidden ? ' <span class="chip">Oculto</span>' : ''}` : ''}</div>
        <div class="hint">${esc(new Date(t.createdAt).toLocaleDateString('pt-BR'))} · ${esc(t.preview)}…</div>
        <div class="row"><button class="btn small primary" data-a="read">Ler</button>${admin ? '<button class="btn small" data-a="edit">Editar</button><button class="btn small danger" data-a="del">Excluir</button>' : ''}</div></div>`).join('') || '<p class="muted">Nenhum tutorial ainda.</p>'}</div>
      <div id="tuRead"></div>`;
    if (open) await read(open);
  }
  async function read(id) {
    open = id;
    const t = await api(`/api/tutorials/${id}`);
    const el = sec.querySelector('#tuRead');
    el.innerHTML = `<div class="panel"><h2>${esc(t.title)}</h2><div class="tu-body">${render(t.body)}</div><button class="btn" data-a="close">Fechar</button></div>`;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async function form(id) {
    const t = id ? await api(`/api/tutorials/${id}`) : { audience: 'seller', category: 'Geral', title: '', body: '' };
    sec.querySelector('#tuForm').innerHTML = `<div class="panel"><h2>${id ? 'Editar' : 'Novo'} tutorial</h2>
      <label>Título<input id="tfT" value="${esc(t.title)}" /></label>
      <div class="grid2"><label>Categoria<input id="tfC" value="${esc(t.category)}" /></label><label>Quem vê<select id="tfA">${Object.entries(AUD).map(([k, v]) => `<option value="${k}" ${t.audience === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
      <label>Conteúdo (linhas com "- " viram lista; linhas com "1. " viram título)<textarea id="tfB" rows="14">${esc(t.body)}</textarea></label>
      <label class="check"><input type="checkbox" id="tfH" ${t.hidden ? 'checked' : ''} /> Ocultar dos vendedores</label>
      <div class="row"><button class="btn primary" data-a="save" data-id="${esc(id || '')}">Salvar</button><button class="btn" data-a="cancel">Cancelar</button></div></div>`;
  }
  sec.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-a]'); if (!t) return;
    const a = t.dataset.a; const id = t.closest('[data-id]')?.dataset.id || t.dataset.id;
    try {
      if (a === 'read') return await read(id);
      if (a === 'close') { open = null; return (sec.querySelector('#tuRead').innerHTML = ''); }
      if (a === 'new') return await form();
      if (a === 'edit') return await form(id);
      if (a === 'cancel') return (sec.querySelector('#tuForm').innerHTML = '');
      if (a === 'save') { const g = (i) => sec.querySelector(i); const body = { title: g('#tfT').value, category: g('#tfC').value, audience: g('#tfA').value, body: g('#tfB').value, hidden: g('#tfH').checked }; if (t.dataset.id) await api(`/api/tutorials/${t.dataset.id}`, { method: 'PATCH', body }); else await api('/api/tutorials', { method: 'POST', body }); toast('Tutorial salvo'); }
      else if (a === 'del') { if (!confirm('Excluir este tutorial?')) return; await api(`/api/tutorials/${id}`, { method: 'DELETE' }); open = null; }
      else if (a === 'weekly') { t.disabled = true; toast('A IA está escrevendo o treinamento… pode levar um minuto'); await api('/api/tutorials/weekly/run', { method: 'POST', body: {} }); toast('Treinamento criado e vendedores avisados'); }
      await load();
    } catch (err) { toast(err.message, true); t.disabled = false; }
  });
  loaders.tutorials = () => load().catch((e) => toast(e.message, true));
})();
