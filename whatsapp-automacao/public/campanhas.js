// Aba "Campanhas" (só administrador): quantas pessoas vieram por cada campanha e variante, e quantas fecharam. Serve para continuar, pausar ou testar outra coisa.
(() => {
  const host = document.querySelector('#tab-lots')?.parentElement;
  if (!host) return;
  const sec = document.createElement('section');
  sec.id = 'tab-campaigns2';
  sec.className = 'tab';
  host.appendChild(sec);
  let current = '';
  const STAGE = { atendendo: 'conversando', retornar: 'retornar depois', nao_fechou: 'não fechou', orcamento: 'orçamento enviado', ficha: 'ficha preenchida', contrato: 'contrato assinado', comprovante: 'comprovante enviado', fechou: 'fechou (pagou)' };
  const when = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

  async function render() {
    sec.innerHTML = '<div class="page-head"><h1>Campanhas</h1></div><p class="muted">Carregando…</p>';
    let list;
    try { list = await api('/api/campanhas'); } catch (e) { sec.innerHTML = `<div class="page-head"><h1>Campanhas</h1></div><p class="muted">${esc(e.message)}</p>`; return; }
    if (!current || !list.some((c) => c.id === current)) current = list[0]?.id || '';
    const r = current ? await api(`/api/campanhas/${current}`) : null;
    sec.innerHTML = `<div class="page-head"><h1>Campanhas</h1></div>
      <p class="hint">Cada pessoa que vem falar de uma promoção é guardada aqui uma vez só: pelo código do link da legenda (ref IDI-A, IDI-B…) ou por palavras como "oferta relâmpago" e "curso de idiomas". Compare as variantes (arte A, arte B, legenda diferente) para saber o que funciona, e pause o que não funciona.</p>
      <div class="row">${list.map((c) => `<button class="btn ${c.id === current ? 'primary' : ''}" data-c="${esc(c.id)}" type="button">${esc(c.name)} · ${c.vieram}</button>`).join('')}<button class="btn small" id="cpNew" type="button">Nova campanha</button></div>
      ${r ? `<div class="panel"><h2>${esc(r.campaign.name)} <span class="badge ${r.campaign.status === 'ativa' ? 'running' : 'paused'}">${esc(r.campaign.status)}</span></h2>
        <p class="hint">Código ${esc(r.campaign.code)} · de ${esc(r.campaign.startsAt || '—')} a ${esc(r.campaign.endsAt || 'sem data final')}. Variantes: ${esc((r.campaign.variants || []).join(', ') || 'nenhuma')}. Na aba Fechamentos, a legenda pode sair com o código da variante.</p>
        <div class="row"><button class="btn small" data-s="ativa" type="button">Ativar</button><button class="btn small" data-s="pausada" type="button">Pausar</button><button class="btn small" data-s="encerrada" type="button">Encerrar</button><button class="btn small" id="cpScan" type="button">Procurar quem já veio (7 dias)</button></div>
        <div class="grid2"><div class="card"><div class="hint">Vieram falar da oferta</div><b style="font-size:28px">${r.total.vieram}</b></div><div class="card"><div class="hint">Receberam orçamento</div><b style="font-size:28px">${r.total.orcamento}</b> <span class="hint">${r.total.taxaOrcamento}%</span></div><div class="card"><div class="hint">Fecharam (pagaram a entrada)</div><b style="font-size:28px">${r.total.fecharam}</b> <span class="hint">${r.total.taxaFechamento}%</span></div><div class="card"><div class="hint">Brinde reservado / confirmado</div><b style="font-size:28px">${r.total.brinde} / ${r.total.brindeConfirmado}</b></div></div>
        <p class="hint">${esc(r.nota)}</p>
        <h3>Variantes (o que está funcionando)</h3>
        <div class="table-wrap"><table><thead><tr><th>Variante</th><th>Vieram</th><th>Orçamento</th><th>Ficha</th><th>Contrato</th><th>Fecharam</th><th>% fecharam</th></tr></thead><tbody>
        ${r.byVariant.map((v) => `<tr><td><b>${esc(v.variant ? `Variante ${v.variant}` : v.label)}</b></td><td>${v.vieram}</td><td>${v.orcamento}</td><td>${v.ficha}</td><td>${v.contrato}</td><td>${v.fecharam}</td><td>${v.taxaFechamento}%</td></tr>`).join('')}</tbody></table></div>
        <h3>Por dia</h3><p class="hint">${r.perDay.map((d) => `${esc(d.day.split('-').reverse().join('/'))}: <b>${d.n}</b>`).join(' · ') || 'Ainda ninguém.'}</p>
        <h3>Quem veio</h3>
        <div class="table-wrap"><table><thead><tr><th>Pessoa</th><th>Variante</th><th>Como veio</th><th>Quando</th><th>Etapa</th><th>Vendedor</th><th>Brinde</th></tr></thead><tbody>
        ${r.rows.map((x) => `<tr><td><b>${esc(x.name || 'Contato')}</b><div class="hint">${esc(x.phone ? `+${x.phone}` : '')}</div></td><td>${esc(x.variant || '—')}</td><td>${x.via === 'link' ? 'link' : 'palavras'}</td><td>${esc(when(x.at))}</td><td>${esc(STAGE[x.stage] || x.stage)}${x.quote ? ` · ${esc(x.quote)}` : ''}</td><td>${esc(x.seller || '—')}</td><td>${esc(x.brinde || '—')}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Ninguém ainda.</td></tr>'}</tbody></table></div></div>` : '<p class="muted">Nenhuma campanha.</p>'}`;
    sec.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => { current = b.dataset.c; render(); }));
    sec.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', async () => { try { await api(`/api/campanhas/${current}/situacao`, { method: 'POST', body: { status: b.dataset.s } }); render(); } catch (err) { toast(err.message, true); } }));
    sec.querySelector('#cpScan')?.addEventListener('click', async () => { try { const x = await api(`/api/campanhas/${current}/escanear`, { method: 'POST', body: { days: 7 } }); toast(`${x.found} pessoa(s) encontradas`); render(); } catch (err) { toast(err.message, true); } });
    sec.querySelector('#cpNew')?.addEventListener('click', async () => {
      const name = prompt('Nome da campanha (ex.: Promoção de dezembro)'); if (!name) return;
      const code = prompt('Código curto (letras, ex.: DEZ)') || ''; const variants = (prompt('Variantes para testar, separadas por vírgula (ex.: A,B)', 'A,B') || '').split(',');
      const words = (prompt('Palavras que as pessoas costumam escrever, separadas por vírgula (ex.: promoção de dezembro)') || '').split(',');
      try { const c = await api('/api/campanhas', { method: 'POST', body: { name, code, variants, keywords: words } }); current = c.id; render(); } catch (err) { toast(err.message, true); }
    });
  }
  loaders.campaigns2 = () => render().catch((e) => toast(e.message, true));
})();
