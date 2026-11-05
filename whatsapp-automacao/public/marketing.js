// Aba "Marketing": os números dos anúncios da Meta em português simples (só leitura).
(() => {
  const host = document.querySelector('#tab-lots')?.parentElement;
  if (!host) return;
  const sec = document.createElement('section');
  sec.id = 'tab-marketing';
  sec.className = 'tab';
  host.appendChild(sec);
  const n = (v) => Number(v || 0).toLocaleString('pt-BR');
  async function load(sync) {
    const preset = sec.querySelector('#mkPreset')?.value || 'last_30d';
    const r = sync ? await api('/api/marketing/sync', { method: 'POST', body: { preset } }).then((x) => ({ ...x, configured: true, snapshot: x.snapshot })) : await api('/api/marketing');
    const cfg = sync ? await api('/api/marketing') : r;
    const s = r.snapshot; const cur = s?.account?.currency || '';
    sec.innerHTML = `<div class="page-head"><h1>Marketing</h1></div>
      <p class="hint">Os números dos seus anúncios no Facebook e Instagram, sem precisar abrir o gerenciador da Meta. Só leitura: este sistema não cria nem altera anúncios.</p>
      <div class="panel"><div class="row"><select id="mkPreset">${Object.entries(cfg.presets).map(([k, v]) => `<option value="${k}" ${(s?.preset || 'last_30d') === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select><button class="btn primary" data-a="sync" ${cfg.configured ? '' : 'disabled'}>Buscar os números agora</button></div>
        ${s ? `<p class="hint">Conta ${esc(s.account.name)} · atualizado em ${esc(new Date(s.syncedAt).toLocaleString('pt-BR'))}</p>
        <div class="grid2"><div class="card"><div class="hint">Gasto</div><b style="font-size:26px">${esc(cur)} ${n(s.totals.spend)}</b></div><div class="card"><div class="hint">Contatos gerados</div><b style="font-size:26px">${n(s.totals.results)}</b></div><div class="card"><div class="hint">Custo por contato</div><b style="font-size:26px">${s.totals.cpl === null ? '—' : `${esc(cur)} ${n(s.totals.cpl)}`}</b></div><div class="card"><div class="hint">Cliques</div><b style="font-size:26px">${n(s.totals.clicks)}</b></div></div>
        <h3>Em português simples</h3><pre style="white-space:pre-wrap">${esc(r.summary || cfg.summary)}</pre>
        <div class="table-wrap"><table><thead><tr><th>Campanha</th><th>Gasto</th><th>Contatos</th><th>Custo por contato</th><th>Cliques</th><th>CTR</th></tr></thead><tbody>${s.campaigns.map((c) => `<tr><td>${esc(c.name)}</td><td>${n(c.spend)}</td><td>${n(c.results)} <span class="hint">(${n(c.chats)} conversas, ${n(c.leads)} formulários)</span></td><td>${c.cpl === null ? '—' : n(c.cpl)}</td><td>${n(c.clicks)}</td><td>${c.ctr}%</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Sem campanhas no período.</td></tr>'}</tbody></table></div>` : '<p class="muted">Ainda não buscamos os números. Configure abaixo e clique em "Buscar".</p>'}</div>
      <div class="panel"><h2>Configurar a conexão com a Meta</h2>
        <p class="hint">Cole o ID da sua conta de anúncios e uma chave de acesso de leitura (Meta Business → Usuários do sistema → gerar token com permissão "ads_read"). A chave fica guardada só aqui no painel e nunca deve ser enviada por mensagem. Se a Meta recusar, gere outra.</p>
        <div class="grid2"><label>ID da conta de anúncios<input id="mkAcct" value="${esc(cfg.adAccountId)}" placeholder="1234567890" /></label><label>Chave de acesso ${cfg.hasToken ? '(já cadastrada: deixe vazio para manter)' : ''}<input id="mkTok" type="text" class="secret-field" autocomplete="off" spellcheck="false" data-lpignore="true" data-1p-ignore placeholder="${cfg.hasToken ? '••••••' : 'cole aqui'}" /></label></div>
        <button class="btn" data-a="save">Salvar conexão</button></div>`;
  }
  sec.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-a]'); if (!t) return;
    try {
      if (t.dataset.a === 'save') { const tok = sec.querySelector('#mkTok').value; await api('/api/marketing/config', { method: 'PUT', body: { adAccountId: sec.querySelector('#mkAcct').value, ...(tok ? { metaToken: tok } : {}) } }); toast('Conexão salva'); return await load(false); }
      if (t.dataset.a === 'sync') { t.disabled = true; toast('Buscando na Meta…'); await load(true); }
    } catch (err) { toast(err.message, true); t.disabled = false; }
  });
  loaders.marketing = () => load(false).catch((e) => toast(e.message, true));
})();
