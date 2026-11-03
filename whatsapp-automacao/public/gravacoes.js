// Aba "Reuniões gravadas": biblioteca de links das gravações (a equipe vê; o administrador cadastra).
(() => {
  const host = document.querySelector('#tab-lots')?.parentElement;
  if (!host) return;
  const sec = document.createElement('section');
  sec.id = 'tab-recordings';
  sec.className = 'tab';
  host.appendChild(sec);
  const br = (d) => (d ? d.split('-').reverse().join('/') : '');
  async function render() {
    const admin = window.currentUser?.role === 'admin';
    const list = await api(`/api/recordings?q=${encodeURIComponent(sec.querySelector('#rcQ')?.value?.trim() || '')}`);
    const q = sec.querySelector('#rcQ')?.value || '';
    sec.innerHTML = `<div class="page-head"><h1>Reuniões gravadas</h1></div>
      <p class="hint">Biblioteca das gravações (lives, aulas, reuniões). O vídeo fica no Google Drive, YouTube ou Meet; aqui ficam o título, a data, o assunto e o endereço para assistir.</p>
      ${admin ? `<div class="panel"><h2>Nova gravação</h2><div class="grid2"><label>Título<input id="rcT" /></label><label>Data<input type="date" id="rcD" /></label><label>Assunto<input id="rcS" placeholder="Ex.: residência, terrenos" /></label><label>Endereço da gravação<input id="rcL" placeholder="https://..." /></label></div><label>Anotações<input id="rcN" /></label><button class="btn primary" data-a="add">Guardar</button></div>` : ''}
      <div class="panel"><div class="row"><input id="rcQ" placeholder="Buscar por título ou assunto" value="${esc(q)}" /></div><div class="table-wrap"><table><thead><tr><th>Data</th><th>Gravação</th><th>Assunto</th><th></th></tr></thead><tbody>${list.map((r) => `<tr><td>${esc(br(r.date))}</td><td><b>${esc(r.title)}</b>${r.notes ? `<div class="hint">${esc(r.notes)}</div>` : ''}</td><td>${esc(r.topic)}</td><td><a class="btn small" href="${esc(r.link)}" target="_blank" rel="noopener noreferrer">Assistir</a> ${admin ? `<button class="btn small danger" data-a="del" data-id="${esc(r.id)}">Excluir</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nenhuma gravação ainda.</td></tr>'}</tbody></table></div></div>`;
  }
  sec.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-a]'); if (!t) return;
    try {
      if (t.dataset.a === 'add') {
        await api('/api/recordings', { method: 'POST', body: { title: sec.querySelector('#rcT').value, date: sec.querySelector('#rcD').value, topic: sec.querySelector('#rcS').value, link: sec.querySelector('#rcL').value, notes: sec.querySelector('#rcN').value } });
        toast('Gravação guardada');
      } else if (t.dataset.a === 'del') { if (!confirm('Excluir esta gravação da lista? O vídeo em si não é apagado.')) return; await api(`/api/recordings/${t.dataset.id}`, { method: 'DELETE' }); }
      await render();
    } catch (err) { toast(err.message, true); }
  });
  let tm;
  sec.addEventListener('input', (e) => { if (e.target.id === 'rcQ') { clearTimeout(tm); tm = setTimeout(() => render().then(() => { const i = sec.querySelector('#rcQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }).catch(() => {}), 300); } });
  loaders.recordings = () => render().catch((e) => toast(e.message, true));
})();
