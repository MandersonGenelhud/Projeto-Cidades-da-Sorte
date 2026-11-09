// Aba "Enviar aos grupos" (só administrador): escolhe os grupos, o texto e uma imagem ou vídeo, e o sistema envia UM GRUPO DE CADA VEZ,
// com pausa aleatória entre eles, só em horário comercial e sem atropelar a IA quando ela está atendendo um cliente.
(() => {
  const host = document.querySelector('#tab-lots')?.parentElement;
  if (!host) return;
  const sec = document.createElement('section');
  sec.id = 'tab-groupsend';
  sec.className = 'tab';
  host.appendChild(sec);
  let groups = []; let media = null; let timer = null;
  const when = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
  const ST = { draft: 'rascunho', running: 'enviando', paused: 'pausado', done: 'concluído', canceled: 'cancelado' };
  const IT = { pending: 'na fila', sent: 'enviado', failed: 'falhou', skipped: 'não enviado' };

  async function loadList() {
    const list = await api('/api/group-broadcasts');
    const box = sec.querySelector('#gsList');
    if (!box) return;
    box.innerHTML = list.map((b) => `<div class="panel" data-id="${esc(b.id)}"><h3>${esc(b.name)} <span class="badge ${b.status === 'done' ? 'done' : b.status === 'running' ? 'running' : 'paused'}">${esc(ST[b.status] || b.status)}</span></h3>
      <p class="hint">${b.counts.sent} enviados · ${b.counts.pending} na fila · ${b.counts.failed} falhas · ${b.total} grupos · intervalo de ${b.delayMin} a ${b.delayMax} s${b.media ? ` · ${esc(b.media.fileName)}` : ''}${b.waiting ? `<br><b>Agora:</b> ${esc(b.waiting)}` : ''}</p>
      <div class="row">${['draft', 'paused'].includes(b.status) ? '<button class="btn small primary" data-gs="start">Iniciar / continuar</button>' : ''}${b.status === 'running' ? '<button class="btn small" data-gs="pause">Pausar</button>' : ''}${!['done', 'canceled'].includes(b.status) ? '<button class="btn small danger" data-gs="cancel">Cancelar</button>' : ''}</div>
      <details><summary>Ver grupos</summary><div class="table-wrap"><table><tbody>${b.items.map((i) => `<tr><td>${esc(i.name || i.groupId)}</td><td>${esc(IT[i.status] || i.status)}</td><td>${esc(when(i.at))}</td><td class="muted">${esc(i.error)}</td></tr>`).join('')}</tbody></table></div></details></div>`).join('') || '<p class="muted">Nenhum envio ainda.</p>';
    clearTimeout(timer);
    if (list.some((b) => b.status === 'running')) timer = setTimeout(() => { if (sec.classList.contains('active') || !sec.hidden) loadList().catch(() => {}); }, 8000);
  }

  async function render() {
    sec.innerHTML = '<div class="page-head"><h1>Enviar aos grupos</h1></div><p class="muted">Carregando os grupos…</p>';
    try { groups = await api('/api/groups'); } catch (e) { sec.innerHTML = `<div class="page-head"><h1>Enviar aos grupos</h1></div><p class="muted">${esc(e.message)}. Conecte o WhatsApp principal em Conexão.</p>`; return; }
    groups.sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
    sec.innerHTML = `<div class="page-head"><h1>Enviar aos grupos</h1></div>
      <p class="hint">Escolha os grupos, escreva o texto e anexe uma imagem ou um vídeo. O sistema envia <b>um grupo de cada vez</b>, com uma pausa aleatória entre eles, só das 8h às 21h, e <b>espera a IA ficar livre</b> antes de cada envio (nunca ao mesmo tempo que ela atende um cliente neste número). Comece por <b>um grupo de teste</b>. Quanto mais grupos de uma vez e quanto menor o intervalo, maior o risco de o WhatsApp restringir o número: prefira intervalos longos.</p>
      <div class="panel"><h2>1. Grupos <span id="gsCount" class="badge pending">0</span></h2>
        <div class="row"><input type="search" id="gsSearch" placeholder="Buscar grupo" style="flex:1;min-width:200px" /><button class="btn small" id="gsAll" type="button">Marcar todos</button><button class="btn small" id="gsNone" type="button">Desmarcar</button></div>
        <div id="gsGroups" style="max-height:320px;overflow:auto;margin-top:8px">${groups.map((g) => `<label class="check" data-name="${esc(String(g.name).toLowerCase())}" style="display:block"><input type="checkbox" class="gsG" value="${esc(g.id)}" data-n="${esc(g.name)}" /> ${esc(g.name)} <span class="hint">(${g.participants} pessoas)</span></label>`).join('')}</div></div>
      <div class="panel"><h2>2. Texto e arquivo</h2>
        <label>Nome deste envio <input id="gsName" maxlength="80" placeholder="Ex.: Oferta relâmpago" /></label>
        <div class="row"><label>Variante <select id="gsVariant"><option value="">sem código</option><option value="A">A</option><option value="B">B</option></select></label> <button class="btn small" id="gsCaption" type="button">Usar a legenda da oferta relâmpago</button></div>
        <label>Texto (vai como legenda da imagem ou do vídeo) <textarea id="gsText" rows="10" maxlength="3500" style="width:100%"></textarea></label>
        <label>Imagem ou vídeo <input type="file" id="gsFile" accept="image/*,video/*" /></label><div id="gsMedia" class="hint"></div></div>
      <div class="panel"><h2>3. Ritmo</h2>
        <div class="row"><label>Esperar entre um grupo e outro, de <input id="gsMin" type="number" min="45" value="90" style="width:80px" /> até <input id="gsMax" type="number" min="45" value="240" style="width:80px" /> segundos</label></div>
        <div class="row"><button class="btn primary" id="gsGo" type="button">Criar e iniciar o envio</button></div></div>
      <div class="panel"><h2>Envios</h2><div id="gsList"></div></div>`;
    const upd = () => { sec.querySelector('#gsCount').textContent = sec.querySelectorAll('.gsG:checked').length; };
    sec.querySelector('#gsGroups').addEventListener('change', upd);
    sec.querySelector('#gsSearch').addEventListener('input', (e) => { const q = e.target.value.toLowerCase(); sec.querySelectorAll('#gsGroups label').forEach((l) => { l.hidden = Boolean(q) && !l.dataset.name.includes(q); }); });
    sec.querySelector('#gsAll').addEventListener('click', () => { sec.querySelectorAll('#gsGroups label:not([hidden]) .gsG').forEach((c) => { c.checked = true; }); upd(); });
    sec.querySelector('#gsNone').addEventListener('click', () => { sec.querySelectorAll('.gsG').forEach((c) => { c.checked = false; }); upd(); });
    sec.querySelector('#gsCaption').addEventListener('click', async () => { try { const r = await api(`/api/flash-offer/legenda?variant=${encodeURIComponent(sec.querySelector('#gsVariant').value)}`); sec.querySelector('#gsText').value = r.text; } catch (e) { toast(e.message, true); } });
    sec.querySelector('#gsFile').addEventListener('change', async (e) => {
      const f = e.target.files[0]; media = null; sec.querySelector('#gsMedia').textContent = '';
      if (!f) return;
      try { const form = new FormData(); form.append('file', f); media = await api('/api/uploads', { method: 'POST', form }); sec.querySelector('#gsMedia').textContent = `Arquivo pronto: ${media.fileName}`; } catch (err) { toast(err.message, true); }
    });
    sec.querySelector('#gsGo').addEventListener('click', async () => {
      const chosen = [...sec.querySelectorAll('.gsG:checked')].map((c) => ({ id: c.value, name: c.dataset.n }));
      if (!chosen.length) return toast('Escolha pelo menos um grupo', true);
      const delayMin = Number(sec.querySelector('#gsMin').value) || 90; const delayMax = Number(sec.querySelector('#gsMax').value) || 240;
      if (!confirm(`Enviar para ${chosen.length} grupo(s), um de cada vez, com ${delayMin} a ${delayMax} segundos entre eles? Os envios só saem das 8h às 21h.`)) return;
      try {
        const b = await api('/api/group-broadcasts', { method: 'POST', body: { name: sec.querySelector('#gsName').value.trim(), text: sec.querySelector('#gsText').value, mediaId: media?.id || '', groups: chosen, delayMin, delayMax } });
        await api(`/api/group-broadcasts/${b.id}/start`, { method: 'POST', body: {} });
        toast('Envio iniciado'); loadList();
      } catch (err) { toast(err.message, true); }
    });
    sec.querySelector('#gsList').addEventListener('click', async (e) => {
      const act = e.target.closest('[data-gs]')?.dataset.gs; const id = e.target.closest('[data-id]')?.dataset.id;
      if (!act || !id) return;
      if (act === 'cancel' && !confirm('Cancelar? O que ainda não foi enviado não será enviado.')) return;
      try { await api(`/api/group-broadcasts/${id}/${act}`, { method: 'POST', body: {} }); loadList(); } catch (err) { toast(err.message, true); }
    });
    loadList().catch((e) => toast(e.message, true));
  }
  loaders.groupsend = () => render().catch((e) => toast(e.message, true));
})();
