// Aba "Retomar contatos": leads do Instagram/Facebook/site/quiz que ainda não foram atendidos.
(() => {
  const host = document.querySelector('#tab-lots')?.parentElement;
  if (!host) return;
  const sec = document.createElement('section');
  sec.id = 'tab-reengage';
  sec.className = 'tab';
  sec.innerHTML = `
    <div class="page-head"><h1>📨 Retomar contatos</h1></div>
    <p class="hint">Pessoas que pediram atendimento pelo Instagram, Facebook, site ou quiz e ainda não foram atendidas. O sistema cruza com as conversas do WhatsApp e com o CRM: quem <b>já falou</b> com a gente <b>não recebe nada</b>. Quem <b>não falou</b> aparece aqui para você conferir e aprovar. Nada é enviado sem a sua aprovação.</p>
    <div id="rgCards" class="cards"></div>
    <div class="panel"><h2>1. Trazer os contatos</h2>
      <div class="row"><input type="file" id="rgFile" accept=".csv,.json,.txt" />
        <select id="rgSource"><option value="">Descobrir a origem sozinho</option><option value="instagram">Instagram</option><option value="facebook">Facebook</option><option value="site">Cadastro no site</option><option value="quiz">Quiz</option><option value="grupo">Grupo de WhatsApp</option><option value="outro">Outro</option></select>
        <button class="btn primary" id="rgImport">Importar e cruzar</button></div>
      <p class="hint">Serve planilha CSV (colunas nome, telefone/WhatsApp, e-mail, origem) ou o arquivo <b>captura.json</b> do programa de cópia. Contatos de <b>grupo</b> nunca recebem mensagem automática (eles não pediram atendimento).</p>
      <div id="rgImportOut" class="hint"></div></div>
    <div class="panel"><h2>2. Mensagem que será enviada</h2><div id="rgTpl"></div></div>
    <div class="panel"><h2>3. Conferir e aprovar</h2>
      <div class="row"><select id="rgStatus"><option value="novo">Ainda não atendidos (novos)</option><option value="ja_atendido">Já falaram com a gente</option><option value="enviado">Mensagem enviada</option><option value="respondeu">Responderam</option><option value="nao_incomodar">Não incomodar</option><option value="ignorado">Ignorados</option><option value="">Todos</option></select>
        <select id="rgSrcFilter"><option value="">Todas as origens</option></select><input id="rgQ" placeholder="Buscar nome ou telefone" />
        <button class="btn" id="rgAll">☑️ Marcar todos da lista</button><button class="btn primary" id="rgSend">📨 Enviar aos marcados</button><button class="btn danger" id="rgStop" hidden>⏹️ Parar</button></div>
      <p id="rgRun" class="hint"></p>
      <div class="table-wrap"><table id="rgTable"></table></div></div>`;
  host.appendChild(sec);
  const SRC = { instagram: 'Instagram', facebook: 'Facebook', site: 'Cadastro no site', quiz: 'Quiz', grupo: 'Grupo', outro: 'Outro' };
  const ST = { novo: '🟡 Novo', ja_atendido: '✅ Já falou conosco', enviado: '📨 Enviada', respondeu: '💬 Respondeu', nao_incomodar: '🚫 Não incomodar', ignorado: '⚪ Ignorado' };
  let items = []; let templates = {};
  const q = (s) => sec.querySelector(s);
  async function load() {
    const p = new URLSearchParams();
    if (q('#rgStatus').value) p.set('status', q('#rgStatus').value);
    if (q('#rgSrcFilter').value) p.set('source', q('#rgSrcFilter').value);
    if (q('#rgQ').value.trim()) p.set('q', q('#rgQ').value.trim());
    const r = await api(`/api/reengage?${p}`);
    items = r.items; templates = r.templates;
    const s = r.summary;
    q('#rgCards').innerHTML = `<div class="card"><b>${s.novo}</b><span>ainda não atendidos</span></div><div class="card"><b>${s.jaAtendido}</b><span>já falaram conosco</span></div><div class="card"><b>${s.enviado}</b><span>mensagens enviadas</span></div><div class="card"><b>${s.respondeu}</b><span>responderam</span></div><div class="card"><b>${s.sentToday}/${s.perDay}</b><span>enviadas hoje</span></div>`;
    if (!q('#rgSrcFilter').dataset.ok) { q('#rgSrcFilter').insertAdjacentHTML('beforeend', Object.entries(SRC).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')); q('#rgSrcFilter').dataset.ok = '1'; }
    q('#rgTpl').innerHTML = ['instagram', 'facebook', 'site', 'quiz'].map((k) => `<details><summary><b>${SRC[k]}</b></summary><textarea data-tpl="${k}" rows="5" style="width:100%">${esc(templates[k] || '')}</textarea></details>`).join('') + '<div class="row"><button class="btn small" id="rgSaveTpl">Salvar os textos</button><span class="hint">{nome} vira o primeiro nome da pessoa.</span></div>';
    q('#rgSaveTpl').onclick = async () => { try { await api('/api/reengage/templates', { method: 'PUT', body: Object.fromEntries([...sec.querySelectorAll('[data-tpl]')].map((t) => [t.dataset.tpl, t.value])) }); toast('Textos salvos'); } catch (e) { toast(e.message, true); } };
    const run = s.run;
    q('#rgRun').textContent = run?.running ? `Enviando… ${run.sent}/${run.total} (${run.failed} falha(s)). Um por vez, com intervalo.` : run?.finishedAt ? `Último envio: ${run.sent} enviada(s), ${run.failed} falha(s).` : '';
    q('#rgStop').hidden = !run?.running;
    q('#rgTable').innerHTML = `<thead><tr><th></th><th>Nome</th><th>WhatsApp</th><th>Origem</th><th>Situação</th><th>Mensagem</th><th></th></tr></thead><tbody>${items.map((c) => `<tr data-id="${esc(c.id)}"><td>${c.status === 'novo' && !c.hold ? `<input type="checkbox" class="rgChk" />` : ''}</td><td><b>${esc(c.name || '—')}</b><div class="hint">${esc(c.email || '')}</div></td><td>${esc(c.phone ? `+${c.phone}` : '—')}</td><td>${esc(SRC[c.source] || c.source)}</td>
      <td>${ST[c.status] || c.status}${c.history?.talked ? `<div class="hint">${c.history.conversation ? 'conversa no WhatsApp' : 'está no CRM'}${c.history.lastAt ? ` · ${fmtDate(c.history.lastAt)}` : ''}</div>` : ''}${c.hold ? `<div class="hint">${esc(c.hold)}</div>` : ''}</td>
      <td class="hint" style="max-width:340px">${esc(c.message || '')}</td><td class="row">${['novo'].includes(c.status) ? '<button class="btn small" data-a="ignorado">Ignorar</button><button class="btn small danger" data-a="nao_incomodar">Não incomodar</button>' : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Nada por aqui. Importe uma planilha ou o captura.json.</td></tr>'}</tbody>`;
  }
  q('#rgImport').onclick = async () => {
    const f = q('#rgFile').files[0];
    if (!f) return toast('Escolha o arquivo', true);
    const form = new FormData(); form.append('file', f); form.append('source', q('#rgSource').value);
    try {
      const s = await api('/api/reengage/import', { method: 'POST', form });
      q('#rgImportOut').innerHTML = `Li <b>${s.lidas}</b> linhas: <b>${s.novos}</b> ainda não atendidos, <b>${s.jaAtendidos}</b> já falaram conosco, ${s.grupo} de grupo (sem envio automático), ${s.repetidos} repetidos, ${s.semTelefone} sem telefone, ${s.naoIncomodar} em "não incomodar".`;
      load();
    } catch (e) { q('#rgImportOut').textContent = e.message; }
  };
  q('#rgAll').onclick = () => sec.querySelectorAll('.rgChk').forEach((c) => (c.checked = true));
  q('#rgSend').onclick = async () => {
    const ids = [...sec.querySelectorAll('.rgChk:checked')].map((c) => c.closest('tr').dataset.id);
    if (!ids.length) return toast('Marque quem vai receber', true);
    if (!confirm(`Enviar a primeira mensagem para ${ids.length} pessoa(s)? Vai uma por vez, com intervalo, até o limite do dia.`)) return;
    try { await api('/api/reengage/send', { method: 'POST', body: { ids } }); toast('Envio iniciado'); load(); } catch (e) { toast(e.message, true); }
  };
  q('#rgStop').onclick = async () => { await api('/api/reengage/stop', { method: 'POST' }); toast('Parando…'); load(); };
  sec.addEventListener('click', async (e) => {
    const a = e.target.dataset.a; if (!a) return;
    try { await api(`/api/reengage/${e.target.closest('tr').dataset.id}`, { method: 'PATCH', body: { status: a } }); load(); } catch (err) { toast(err.message, true); }
  });
  for (const id of ['#rgStatus', '#rgSrcFilter']) q(id).onchange = load;
  q('#rgQ').addEventListener('input', () => { clearTimeout(load.t); load.t = setTimeout(load, 300); });
  loaders.reengage = () => { load().catch((e) => toast(e.message, true)); clearInterval(load.poll); load.poll = setInterval(() => { if (sec.classList.contains('active')) load().catch(() => {}); else clearInterval(load.poll); }, 8000); };
})();
