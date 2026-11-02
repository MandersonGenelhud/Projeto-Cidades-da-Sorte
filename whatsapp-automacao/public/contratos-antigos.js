// Aba "Contratos antigos": importa o que a ferramenta tools/capturar-sistema copiou do sistema do Marcos.
(() => {
  const host = document.querySelector('#tab-lots')?.parentElement;
  if (!host) return;
  const sec = document.createElement('section');
  sec.id = 'tab-legacy';
  sec.className = 'tab';
  sec.innerHTML = `
    <div class="page-head"><h1>📁 Contratos antigos</h1><a class="btn" href="/api/legacy/export.csv">⬇️ Baixar planilha</a></div>
    <div class="panel"><h2>Passo 1: copiar os contratos do sistema do Marcos (automático)</h2>
      <ol class="legacy-steps">
        <li>Clique em <b>Baixar o programa de cópia</b>. Vai baixar o arquivo <b>CAPTURAR-CONTRATOS.bat</b> (fica na pasta Downloads).</li>
        <li>Dê <b>dois cliques</b> nele. Se o Windows avisar "proteção do computador", clique em <b>Mais informações</b> e depois em <b>Executar assim mesmo</b> (o arquivo é nosso, saiu deste painel).</li>
        <li>Na janela preta, digite o <b>endereço do sistema do Marcos</b> e aperte Enter. Vai abrir o navegador.</li>
        <li><b>No navegador</b>, entre no sistema do Marcos digitando o login e a senha <b>lá</b>, e abra a tela que mostra a <b>lista de contratos</b>.</li>
        <li>Volte na janela preta e aperte <b>Enter</b>. Espere terminar, sem mexer no navegador (pode levar vários minutos).</li>
        <li>Quando acabar, abre sozinha uma pasta na sua <b>Área de Trabalho</b> chamada <b>captura-...</b>. Dentro dela está o arquivo <b>captura.json</b>.</li>
      </ol>
      <a class="btn primary legacy-dl" href="/api/legacy/ferramenta.bat">⬇️ Baixar o programa de cópia</a>
      <p class="hint">Se o Node.js não estiver instalado, o programa instala sozinho (se pedir permissão, clique em Sim) e pede para você abrir o arquivo de novo. Ele só lê o sistema do Marcos: não clica em botões, não apaga nada e a senha nunca passa por aqui.</p>
    </div>
    <div class="panel"><h2>Passo 2: importar o arquivo captura.json</h2>
      <div class="row"><input type="file" id="lgFile" accept=".json" /><button class="btn" id="lgPreview">1) Conferir o arquivo</button><button class="btn primary" id="lgImport" disabled>2) Importar</button></div>
      <div id="lgOut" class="hint"></div></div>
    <div class="panel"><div class="row"><input id="lgQ" placeholder="Buscar por número, cliente, documento…" /><span id="lgInfo" class="hint"></span></div>
      <div class="table-wrap"><table id="lgTable"></table></div><div id="lgDetail"></div></div>`;
  host.appendChild(sec);
  const money = (r) => (r.value === null || r.value === undefined ? '—' : `${{ USD: 'US$', PYG: 'Gs.', BRL: 'R$' }[r.currency] || 'R$'} ${Number(r.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
  const send = async (url) => {
    const f = sec.querySelector('#lgFile').files[0];
    if (!f) throw new Error('Escolha o arquivo captura.json');
    const form = new FormData();
    form.append('file', f);
    return api(url, { method: 'POST', form });
  };
  sec.querySelector('#lgPreview').onclick = async () => {
    try {
      const s = await send('/api/legacy/preview');
      sec.querySelector('#lgOut').innerHTML = `Encontrei <b>${s.total}</b> contratos (${s.comNumero} com número, ${s.comCliente} com cliente, ${s.comValor} com valor, ${s.comData} com data). Último número: <b>${s.ultimoNumero || '—'}</b>. Exemplo: ${s.exemplo.map((e) => `${esc(e.number || '?')} · ${esc(e.client || '?')}`).join(' | ')}`;
      sec.querySelector('#lgImport').disabled = false;
    } catch (e) { sec.querySelector('#lgOut').textContent = e.message; sec.querySelector('#lgImport').disabled = true; }
  };
  sec.querySelector('#lgImport').onclick = async () => {
    try {
      const r = await send('/api/legacy/import');
      toast(`Importado: ${r.added} novo(s), ${r.updated} já existiam. Último número ${r.ultimoNumero}.`);
      sec.querySelector('#lgImport').disabled = true;
      load();
    } catch (e) { toast(e.message, true); }
  };
  async function load() {
    const q = sec.querySelector('#lgQ').value.trim();
    const r = await api(`/api/legacy?q=${encodeURIComponent(q)}`);
    sec.querySelector('#lgInfo').textContent = `${r.total} contrato(s) guardados${r.ultimoNumero ? ` · maior número: ${r.ultimoNumero}` : ''}`;
    sec.querySelector('#lgTable').innerHTML = `<thead><tr><th>Nº</th><th>Cliente</th><th>Documento</th><th>Valor</th><th>Data</th><th>Situação</th><th>Serviço</th></tr></thead><tbody>${r.items.map((c) => `<tr data-id="${esc(c.id)}" style="cursor:pointer"><td><b>${esc(c.number)}</b></td><td>${esc(c.client)}</td><td>${esc(c.doc)}</td><td>${money(c)}</td><td>${esc(c.date ? c.date.split('-').reverse().join('/') : '')}</td><td>${esc(c.status)}</td><td>${esc(c.service)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Nenhum contrato importado ainda.</td></tr>'}</tbody>`;
  }
  sec.querySelector('#lgTable').addEventListener('click', async (e) => {
    const id = e.target.closest('tr[data-id]')?.dataset.id;
    if (!id) return;
    const c = await api(`/api/legacy/${id}`);
    sec.querySelector('#lgDetail').innerHTML = `<h3>Contrato ${esc(c.number)} · ${esc(c.client)}</h3><div class="table-wrap"><table>${Object.entries(c.raw || {}).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table></div>`;
  });
  sec.querySelector('#lgQ').addEventListener('input', () => { clearTimeout(load.t); load.t = setTimeout(load, 300); });
  loaders.legacy = () => load().catch((e) => toast(e.message, true));
})();
