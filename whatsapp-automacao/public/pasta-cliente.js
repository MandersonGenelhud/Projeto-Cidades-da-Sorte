// Pasta do cliente dentro do contrato: lista, envia e baixa os documentos do cliente. Mostra também os documentos de contratos anteriores
// do mesmo cliente (renovação: não precisa pedir de novo).
(() => {
  const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const dt = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '');
  async function render(id) {
    const body = document.querySelector('#saleBody');
    if (!body) return;
    let box = body.querySelector('#saleDocs');
    if (!box) { box = document.createElement('div'); box.id = 'saleDocs'; body.querySelector('h3:last-of-type')?.before(box); }
    let r;
    try { r = await api(`/api/sales/${encodeURIComponent(id)}/docs`); } catch (err) { box.innerHTML = `<p class="err">${esc(err.message)}</p>`; return; }
    const admin = window.currentUser?.role === 'admin';
    const row = (sid, d) => `<div class="item"><div class="grow"><b>${esc(d.kindLabel)}</b> · ${esc(d.name)}<div class="meta">${esc(dt(d.at))} · ${esc(kb(d.size))}${d.by ? ` · por ${esc(d.by)}` : ''}${d.note ? ` · ${esc(d.note)}` : ''}</div></div>
      <a class="btn small" href="/api/sales/${encodeURIComponent(id)}/docs/${encodeURIComponent(d.id)}">Baixar</a>${admin && sid === id ? ` <button class="btn small danger" data-del="${esc(d.id)}">Excluir</button>` : ''}</div>`;
    box.innerHTML = `<h3>Pasta do cliente (documentos)</h3>
      <p class="hint">Guarde aqui os documentos do cliente (passaporte, RG/CNH, certidões, antecedentes, foto, comprovantes, contrato assinado). Na renovação, eles já estarão aqui. Só PDF ou foto, até 15 MB.</p>
      ${r.docs.map((d) => row(id, d)).join('') || '<p class="muted">Nenhum documento guardado ainda.</p>'}
      ${r.anteriores.length ? `<h4>Documentos de contratos anteriores deste cliente</h4>${r.anteriores.map((a) => `<p class="hint">${esc(a.number)} · ${esc(dt(a.createdAt))}</p>${a.docs.map((d) => row(a.saleId, d)).join('')}`).join('')}` : ''}
      <form id="saleDocForm" class="row" style="margin-top:8px"><select name="kind">${Object.entries(r.kinds).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('')}</select>
        <input name="note" placeholder="Observação (ex.: validade 2030)" maxlength="200" /><input type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp" required />
        <button class="btn small primary" type="submit">Guardar na pasta</button></form>`;
    box.querySelector('#saleDocForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target; const file = f.file.files[0];
      if (!file) return;
      const fd = new FormData(); fd.append('file', file); fd.append('kind', f.kind.value); fd.append('note', f.note.value); fd.append('name', file.name.replace(/\.[^.]+$/, ''));
      try { await api(`/api/sales/${encodeURIComponent(id)}/docs`, { method: 'POST', form: fd }); toast('Documento guardado na pasta do cliente'); render(id); } catch (err) { toast(err.message, true); }
    });
    box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Excluir este documento da pasta do cliente?')) return;
      try { await api(`/api/sales/${encodeURIComponent(id)}/docs/${encodeURIComponent(b.dataset.del)}`, { method: 'DELETE' }); render(id); } catch (err) { toast(err.message, true); }
    }));
  }
  document.addEventListener('sale-opened', (e) => render(e.detail.id).catch(() => {}));
})();
