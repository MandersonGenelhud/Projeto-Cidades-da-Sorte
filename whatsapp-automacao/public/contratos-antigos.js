// Aba "Contratos antigos": importa o que a ferramenta tools/capturar-sistema copiou do sistema do Marcos.
(() => {
  const host = document.querySelector('#tab-lots')?.parentElement;
  if (!host) return;
  const sec = document.createElement('section');
  sec.id = 'tab-legacy';
  sec.className = 'tab';
  sec.innerHTML = `
    <div class="page-head"><h1>Contratos antigos</h1><a class="btn" href="/api/legacy/export.csv">Baixar planilha</a></div>
    <div class="panel"><h2>Passo 1: copiar os contratos do sistema do Marcos (automático)</h2>
      <ol class="legacy-steps">
        <li>Clique em <b>Baixar o programa de cópia</b>. Vai baixar o arquivo <b>CAPTURAR-CONTRATOS.bat</b> (fica na pasta Downloads).</li>
        <li>Dê <b>dois cliques</b> nele. Se o Windows avisar "proteção do computador", clique em <b>Mais informações</b> e depois em <b>Executar assim mesmo</b> (o arquivo é nosso, saiu deste painel).</li>
        <li>Na janela preta, digite o <b>endereço do sistema do Marcos</b> e aperte Enter. Vai abrir o navegador.</li>
        <li><b>No navegador</b>, entre no sistema do Marcos digitando o login e a senha <b>lá</b>, e abra a tela que mostra a <b>lista de contratos</b>.</li>
        <li>Volte na janela preta e aperte <b>Enter</b>. Espere terminar, sem mexer no navegador (pode levar vários minutos).</li>
        <li>Quando acabar, abre sozinha uma pasta na sua <b>Área de Trabalho</b> chamada <b>captura-...</b>. Dentro dela está o arquivo <b>captura.json</b>.</li>
      </ol>
      <a class="btn primary legacy-dl" href="/api/legacy/ferramenta.bat">Baixar o programa de cópia</a> <a class="btn legacy-dl" href="/api/legacy/ferramenta-site.bat">Baixar o programa que copia o visual do site</a>
      <p class="hint">Se o Node.js não estiver instalado, o programa instala sozinho (se pedir permissão, clique em Sim) e pede para você abrir o arquivo de novo. Ele só lê o sistema do Marcos: não clica em botões, não apaga nada e a senha nunca passa por aqui.</p>
    </div>
    <div class="panel"><h2>Passo 2: importar o arquivo captura.json</h2>
      <div class="row"><input type="file" id="lgFile" accept=".json" /><button class="btn" id="lgPreview">1) Conferir o arquivo</button><button class="btn primary" id="lgImport" disabled>2) Importar</button><button class="btn" id="lgMap" title="Lista as telas do sistema antigo e compara com o que já temos (sem dados de clientes)">4) Mapa das telas</button><button class="btn" id="lgApply">3) Levar para Vendas e CRM</button></div>
      <div id="lgOut" class="hint"></div></div>
    <div class="panel"><h2>Auditoria da cópia</h2><p class="hint">Compara o que o sistema antigo diz que tem (os números das telas) com o que foi copiado, e mostra páginas que não abriram.</p><div id="lgAudit"></div></div>
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
      sec.querySelector('#lgOut').innerHTML = `Encontrei <b>${s.total}</b> contratos (${s.comNumero} com número, ${s.comCliente} com cliente, ${s.comValor} com valor, ${s.comData} com data) e <b>${s.parcelas}</b> parcelas em ${s.comParcelas} contratos (<b>${s.parcelasAtrasadas}</b> atrasadas, ${brl2(s.valorAtrasado)}; a receber ${brl2(s.valorAReceber)}). Último número: <b>${s.ultimoNumero || '—'}</b>. Exemplo: ${s.exemplo.map((e) => `${esc(e.number || '?')} · ${esc(e.client || '?')}`).join(' | ')}`;
      sec.querySelector('#lgImport').disabled = false;
    } catch (e) { sec.querySelector('#lgOut').textContent = e.message; sec.querySelector('#lgImport').disabled = true; }
  };
  sec.querySelector('#lgImport').onclick = async () => {
    try {
      const r = await send('/api/legacy/import');
      toast(`Importado: ${r.added} contrato(s) novo(s), ${r.updated} já existiam, ${r.clients} cliente(s). Agora clique em "Levar para Vendas e CRM".`);
      sec.querySelector('#lgImport').disabled = true;
      load();
    } catch (e) { toast(e.message, true); }
  };
  // Mapa das telas do sistema antigo x o que já temos. Não leva nomes nem valores de clientes.
  let lastMap = null;
  sec.querySelector('#lgMap').onclick = async () => {
    try {
      const r = await send('/api/legacy/screen-map');
      lastMap = r;
      const label = { tem: 'Já temos', parcial: 'Temos em parte', falta: 'Falta', conferir: 'Conferir' };
      const rows = r.comparison.rows.map((x) => `<tr><td><b>${esc(x.theme)}</b><br><span class="hint">${esc(x.title || x.path)} · ${x.pages} página(s)</span></td><td>${esc(x.columns.join(', ') || x.fields.join(', ') || '—')}</td><td>${esc(x.ours)}</td><td><span class="badge ${x.status === 'tem' ? 'ok' : x.status === 'falta' ? 'paused' : 'pending'}">${label[x.status]}</span><br><span class="hint">${esc(x.note)}</span></td></tr>`).join('');
      const c = r.comparison.byStatus;
      sec.querySelector('#lgOut').innerHTML = `<b>${r.comparison.rows.length} tipos de tela</b> no sistema antigo: ${c.tem || 0} já temos, ${c.parcial || 0} em parte, ${c.falta || 0} faltam, ${c.conferir || 0} para conferir. <button type="button" class="btn small" id="lgMapDl">Baixar o mapa (sem dados de clientes)</button><div class="table-wrap"><table><thead><tr><th>Tela do sistema antigo</th><th>Colunas e campos</th><th>No Migra Hub</th><th>Situação</th></tr></thead><tbody>${rows}</tbody></table></div>`;
      sec.querySelector('#lgMapDl').onclick = () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify({ map: lastMap.map, comparison: lastMap.comparison }, null, 2)], { type: 'application/json' }));
        a.download = 'mapa-do-sistema-antigo.json';
        a.click();
      };
    } catch (e) { sec.querySelector('#lgOut').textContent = e.message; }
  };
  const brl2 = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  sec.querySelector('#lgApply').onclick = async () => {
    if (!confirm('Levar os contratos com parcelas para Vendas (vencimentos, atrasos e painel) e os clientes para o CRM? Nada é enviado a ninguém e a comissão fica zerada. Pode repetir sem duplicar.')) return;
    try {
      const r = await api('/api/legacy/apply', { method: 'POST', body: {} });
      toast(`Pronto: ${r.sales} venda(s) com parcelas, ${r.clients} cliente(s) no CRM (${r.salesSkipped + r.clientsSkipped} já existiam, ${r.noParcels} contrato(s) sem parcelas). ${r.fromCobranca ? `${r.fromCobranca} com as parcelas reais da Cobrança.` : ''}${r.upgraded ? ` ${r.upgraded} atualizado(s) com as parcelas reais.` : ''}`);
    } catch (e) { toast(e.message, true); }
  };
  async function loadAudit() {
    const { last: a } = await api('/api/legacy/audit');
    if (!a) { sec.querySelector('#lgAudit').innerHTML = '<p class="hint">Ainda não há cópia para auditar.</p>'; return; }
    const ENT = { clientes: 'Clientes', contratos: 'Contratos', processos: 'Processos', documentos: 'Documentos', orcamentos: 'Orçamentos', leads: 'Leads' };
    sec.querySelector('#lgAudit').innerHTML = `<p><b>${a.ok ? 'Tudo bateu com o que o sistema antigo mostra.' : 'Há pontos para conferir.'}</b> ${a.paginas} páginas lidas, ${a.arquivos} arquivos, ${a.contratosSemParcelas} contratos sem parcelas, ${a.contratosSemCliente} sem cliente. Feita em ${new Date(a.at).toLocaleString('pt-BR')}.</p>
      <div class="table-wrap"><table><thead><tr><th>Assunto</th><th>O sistema antigo mostra</th><th>Copiado</th><th>Situação</th></tr></thead><tbody>${a.items.map((i) => `<tr><td>${esc(ENT[i.entity] || i.entity)}</td><td>${i.esperado ?? '—'}</td><td>${i.copiado}</td><td>${i.status === 'ok' ? 'Conferido' : i.status === 'faltam' ? `Faltam ${i.faltam}` : 'Sem número para comparar'}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Sem números para comparar.</td></tr>'}</tbody></table></div>
      ${a.falhas.length ? `<h3>Páginas que não abriram (${a.falhas.length})</h3><div class="table-wrap"><table>${a.falhas.slice(0, 30).map((f) => `<tr><td>${esc(f.url)}</td><td>${esc(f.motivo)}</td></tr>`).join('')}</table></div><p class="hint">Rode a cópia de novo: ela só acrescenta o que faltou, sem duplicar.</p>` : ''}`;
  }
  async function load() {
    loadAudit().catch(() => {});
    const q = sec.querySelector('#lgQ').value.trim();
    const r = await api(`/api/legacy?q=${encodeURIComponent(q)}`);
    sec.querySelector('#lgInfo').textContent = `${r.total} contrato(s) e ${r.clients ?? 0} cliente(s) guardados${r.ultimoNumero ? ` · maior número: ${r.ultimoNumero}` : ''}`;
    sec.querySelector('#lgTable').innerHTML = `<thead><tr><th>Nº</th><th>Cliente</th><th>Documento</th><th>Valor</th><th>Data</th><th>Situação</th><th>Serviço</th></tr></thead><tbody>${r.items.map((c) => `<tr data-id="${esc(c.id)}" style="cursor:pointer"><td><b>${esc(c.number)}</b></td><td>${esc(c.client)}</td><td>${esc(c.doc)}</td><td>${money(c)}</td><td>${esc(c.date ? c.date.split('-').reverse().join('/') : '')}</td><td>${esc(c.status)}</td><td>${esc(c.service)}${c.parcelas ? `<div class="hint">${c.parcelas} parcela(s)</div>` : ''}${c.files?.length ? `<div class="hint">${c.files.length} arquivo(s)</div>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Nenhum contrato importado ainda.</td></tr>'}</tbody>`;
  }
  sec.querySelector('#lgTable').addEventListener('click', async (e) => {
    const id = e.target.closest('tr[data-id]')?.dataset.id;
    if (!id) return;
    const c = await api(`/api/legacy/${id}`);
    sec.querySelector('#lgDetail').innerHTML = `<h3>Contrato ${esc(c.number)} · ${esc(c.client)}</h3><div class="table-wrap"><table>${Object.entries(c.raw || {}).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table></div>${c.files?.length ? `<h3>Documentos e arquivos</h3><div class="row">${c.files.map((f) => `<a class="btn small" href="/api/legacy/files/${esc(f.id)}" target="_blank" rel="noopener">${esc(f.kind === 'pdf' ? 'PDF' : f.kind === 'imagem' ? 'Imagem' : 'Documento')}: ${esc(f.name)}</a>`).join('')}</div>` : ''}${c.parcels?.length ? `<h3>Parcelas</h3><div class="table-wrap"><table><thead><tr><th>Parcela</th><th>Vencimento</th><th>Valor</th><th>Situação</th></tr></thead><tbody>${c.parcels.map((p) => `<tr><td>${esc(p.label)}</td><td>${esc(p.due.split('-').reverse().join('/'))}</td><td>${brl2(p.value)}</td><td>${p.paid ? 'Paga' : p.due < new Date().toISOString().slice(0, 10) ? 'Atrasada' : 'A vencer'}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
  });
  sec.querySelector('#lgQ').addEventListener('input', () => { clearTimeout(load.t); load.t = setTimeout(load, 300); });
  loaders.legacy = () => load().catch((e) => toast(e.message, true));
})();
