// Aba "Currículos": quem perguntou por vaga ou mandou currículo (sem avisar ninguém).
(() => {
  const host = document.querySelector('#tab-lots')?.parentElement;
  if (!host) return;
  const sec = document.createElement('section');
  sec.id = 'tab-resumes';
  sec.className = 'tab';
  sec.innerHTML = `<div class="page-head"><h1>Currículos</h1><a class="btn" href="/api/resumes/export.csv">Baixar planilha</a></div>
    <p class="hint">Quem pergunta por vaga ou trabalho recebe a resposta de que as vagas de vendedor foram preenchidas e é convidado a enviar o currículo. O contato e o arquivo ficam guardados aqui, <b>sem avisar o Marcos, a equipe ou parceiros</b>. Só o administrador vê esta tela.</p>
    <div class="panel"><div class="row"><input id="cvQ" placeholder="Buscar nome, telefone ou área" /></div><div class="table-wrap"><table id="cvTable"></table></div></div>`;
  host.appendChild(sec);
  const ST = { novo: 'Novo contato', recebido: 'Currículo recebido', visto: 'Visto', chamar: 'Chamar', arquivado: 'Arquivado' };
  async function load() {
    const list = await api(`/api/resumes?q=${encodeURIComponent(sec.querySelector('#cvQ').value.trim())}`);
    sec.querySelector('#cvTable').innerHTML = `<thead><tr><th>Quando</th><th>Pessoa</th><th>Procura</th><th>Arquivos</th><th>Situação</th><th></th></tr></thead><tbody>${list.map((r) => `<tr data-id="${esc(r.id)}"><td>${fmtDate(r.at)}</td><td><b>${esc(r.name || '—')}</b><div class="hint">${esc(r.phone ? `+${r.phone}` : '')} ${r.channel === 'instagram' ? '(Instagram)' : ''}</div></td><td>${esc(r.interest)}<div class="hint">${esc(r.summary)}</div></td>
      <td>${r.files.map((f) => `<a class="btn small" href="/api/resumes/${esc(r.id)}/files/${esc(f.id)}" target="_blank" rel="noopener">${esc(f.ext.toUpperCase())}</a>`).join(' ') || '<span class="hint">sem arquivo</span>'}</td>
      <td><select data-a="status">${Object.entries(ST).map(([k, v]) => `<option value="${k}" ${r.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td><td><button class="btn small danger" data-a="del">Excluir</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nenhum currículo ainda.</td></tr>'}</tbody>`;
  }
  sec.addEventListener('change', async (e) => {
    if (e.target.dataset.a !== 'status') return;
    try { await api(`/api/resumes/${e.target.closest('tr').dataset.id}`, { method: 'PATCH', body: { status: e.target.value } }); toast('Atualizado'); } catch (err) { toast(err.message, true); }
  });
  sec.addEventListener('click', async (e) => {
    if (e.target.dataset.a !== 'del' || !confirm('Excluir este candidato e os arquivos dele? Fica registrado na Auditoria.')) return;
    try { await api(`/api/resumes/${e.target.closest('tr').dataset.id}`, { method: 'DELETE' }); load(); } catch (err) { toast(err.message, true); }
  });
  sec.querySelector('#cvQ').addEventListener('input', () => { clearTimeout(load.t); load.t = setTimeout(load, 300); });
  loaders.resumes = () => load().catch((e) => toast(e.message, true));
})();
