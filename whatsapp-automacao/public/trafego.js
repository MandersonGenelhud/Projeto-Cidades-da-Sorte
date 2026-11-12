// Aba "Tráfego": quantas pessoas chegam por dia, por número e por anúncio. Só números (sem nome nem telefone de cliente).
// O administrador também configura o relatório diário; a equipe de tráfego (acesso restrito) só enxerga esta aba.
(() => {
  const host = document.querySelector('#tab-lots')?.parentElement;
  if (!host) return;
  const sec = document.createElement('section');
  sec.id = 'tab-traffic';
  sec.className = 'tab';
  host.appendChild(sec);
  const day = (d) => String(d).split('-').reverse().join('/');
  const iso = (offset) => new Date(Date.now() - offset * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Asuncion' });
  let range = { from: iso(6), to: iso(0) };
  async function load() {
    const r = await api(`/api/traffic?from=${range.from}&to=${range.to}`);
    const t = r.totais; const admin = window.currentUser?.role === 'admin';
    const c = r.config || {};
    sec.innerHTML = `<div class="page-head"><h1>Tráfego</h1></div>
      <p class="hint">Quantas pessoas chegaram, por qual número e por qual anúncio. Só números: nenhum nome nem telefone de cliente aparece aqui. Horário do Paraguai.</p>
      <div class="panel"><div class="row">
        <label>De <input type="date" id="trFrom" value="${esc(r.from)}" /></label><label>Até <input type="date" id="trTo" value="${esc(r.to)}" /></label>
        <button class="btn" data-q="7">Últimos 7 dias</button> <button class="btn" data-q="30">30 dias</button> <button class="btn" data-q="1">Hoje</button>
        <button class="btn primary" data-a="go">Ver</button> <a class="btn" href="/api/traffic.csv?from=${esc(r.from)}&to=${esc(r.to)}">Baixar planilha (CSV)</a></div></div>
      <div class="panel"><div class="grid2">
        <div class="card"><div class="hint">Novos contatos</div><b style="font-size:28px">${t.novos}</b><div class="hint">${t.deAnuncio} de anúncio · ${t.organicos} orgânicos</div></div>
        <div class="card"><div class="hint">Encaminhados ao vendedor</div><b style="font-size:28px">${t.encaminhados}</b><div class="hint">${t.fechados} fechados (${t.conversao}%)</div></div>
        <div class="card"><div class="hint">Primeira resposta (mediana)</div><b style="font-size:28px">${t.tempoMedianoMin === null ? '—' : `${t.tempoMedianoMin} min`}</b><div class="hint">${t.respondidosEm5min === null ? '' : `${t.respondidosEm5min}% em até 5 min`}</div></div>
        <div class="card"><div class="hint">Sem resposta</div><b style="font-size:28px">${t.semResposta}</b><div class="hint">pessoas que escreveram e ainda não foram respondidas</div></div></div></div>
      <div class="panel"><h2>Por dia</h2><div class="table-wrap"><table><thead><tr><th>Dia</th><th>Novos</th><th>De anúncio</th><th>Orgânicos</th><th>Por número</th><th>Encaminhados</th><th>Fechados</th><th>1ª resposta</th></tr></thead><tbody>
        ${[...r.dias].reverse().map((d) => `<tr><td>${esc(day(d.dia))}</td><td><b>${d.novos}</b></td><td>${d.deAnuncio}</td><td>${d.organicos}</td><td>${Object.entries(d.porNumero).map(([k, v]) => `${esc(k)}: ${v}`).join('<br>')}</td><td>${d.encaminhados}</td><td>${d.fechados}</td><td>${d.tempoMedianoMin === null ? '—' : `${d.tempoMedianoMin} min`}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">Nenhum contato neste período.</td></tr>'}
        </tbody></table></div></div>
      <div class="grid2"><div class="panel"><h2>Por número</h2><div class="table-wrap"><table><thead><tr><th>Número</th><th>Novos</th><th>De anúncio</th><th>Encaminhados</th><th>Fechados</th></tr></thead><tbody>
        ${r.numeros.map((n) => `<tr><td>${esc(n.numero)}</td><td><b>${n.novos}</b></td><td>${n.deAnuncio}</td><td>${n.encaminhados}</td><td>${n.fechados}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">—</td></tr>'}</tbody></table></div></div>
        <div class="panel"><h2>Por anúncio</h2><div class="table-wrap"><table><thead><tr><th>Anúncio</th><th>Novos</th><th>Encaminhados</th><th>Fechados</th></tr></thead><tbody>
        ${r.anuncios.map((a) => `<tr><td>${esc(a.anuncio)}</td><td><b>${a.novos}</b></td><td>${a.encaminhados}</td><td>${a.fechados}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nenhum contato de anúncio identificado neste período.</td></tr>'}</tbody></table></div></div></div>
      ${admin ? `<div class="panel"><h2>Relatório diário</h2>
        <p class="hint">Todo dia, no horário escolhido, o resumo do dia vai para os administradores e para os números abaixo (ex.: o gestor de tráfego). Vai só o resumo em números.</p>
        <label class="check"><input type="checkbox" id="trOn" ${c.reportOn === false ? '' : 'checked'} /> Enviar o relatório todo dia</label>
        <div class="grid2"><label>Horário (0 a 23, hora do Paraguai)<input id="trHour" type="number" min="0" max="23" value="${esc(c.reportHour ?? 21)}" /></label>
        <label>Nome do número principal nos relatórios<input id="trMain" value="${esc(c.mainLabel || 'Número principal')}" /></label></div>
        <label>Enviar também para (WhatsApp com DDD, separados por vírgula)<input id="trPhones" value="${esc((c.reportPhones || []).join(', '))}" placeholder="+595 981 000000" /></label>
        <button class="btn primary" data-a="save">Salvar</button> <button class="btn" data-a="send">Enviar o relatório de hoje agora</button></div>
      <div class="panel"><h2>Acesso da equipe de tráfego</h2><p class="hint">Em Equipe, cadastre o login do gestor de tráfego e marque "Equipe de tráfego: acesso SÓ à aba Tráfego". Ele não vê clientes, vendas, conversas nem configurações.</p></div>` : ''}`;
  }
  sec.addEventListener('click', async (e) => {
    const q = e.target.closest('[data-q]'); const a = e.target.closest('[data-a]');
    try {
      if (q) { range = { from: iso(Number(q.dataset.q) - 1), to: iso(0) }; return await load(); }
      if (!a) return;
      if (a.dataset.a === 'go') { range = { from: sec.querySelector('#trFrom').value, to: sec.querySelector('#trTo').value }; await load(); }
      if (a.dataset.a === 'save') { await api('/api/traffic/config', { method: 'PUT', body: { reportOn: sec.querySelector('#trOn').checked, reportHour: sec.querySelector('#trHour').value, mainLabel: sec.querySelector('#trMain').value, reportPhones: sec.querySelector('#trPhones').value } }); toast('Salvo.'); await load(); }
      if (a.dataset.a === 'send') { await api('/api/traffic/send-report', { method: 'POST', body: {} }); toast('Relatório enviado.'); }
    } catch (err) { toast(err.message, true); }
  });
  loaders.traffic = () => load().catch((e) => toast(e.message, true));
})();
