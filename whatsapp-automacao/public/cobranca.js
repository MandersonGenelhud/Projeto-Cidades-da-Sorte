// Aba "Cobrança e previsão": parcelas vencidas (aviso só com a sua aprovação) e quanto entra em cada mês.
(() => {
  const host = document.querySelector('#tab-lots')?.parentElement;
  if (!host) return;
  const sec = document.createElement('section');
  sec.id = 'tab-collections';
  sec.className = 'tab';
  host.appendChild(sec);
  const brl = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const br = (d) => (d ? d.split('-').reverse().join('/') : '—');
  const TIER = { leve: 'Até 15 dias', medio: '16 a 60 dias', firme: 'Mais de 60 dias' };
  const f = { minDays: 1, q: '' };
  const sel = new Set();
  async function load() {
    const r = await api(`/api/collections?minDays=${f.minDays}&q=${encodeURIComponent(f.q)}`);
    const s = r.summary; const st = r.status; const fc = r.forecast; const max = Math.max(1, ...fc.months.map((m) => m.toReceive));
    sec.innerHTML = `<div class="page-head"><h1>Cobrança e previsão</h1></div>
      <p class="hint">Parcelas vencidas de todas as vendas (inclusive as do sistema antigo). Nenhuma mensagem sai sozinha: você escolhe e aprova, e o sistema envia aos poucos, no horário comercial e dentro do limite por dia.</p>
      <div class="grid2"><div class="card"><div class="hint">Em atraso</div><b style="font-size:26px">${brl(s.valor)}</b><div class="hint">${s.parcelas} parcela(s) · ${s.clientes} cliente(s)</div></div>
        <div class="card"><div class="hint">Até 15 dias / 16 a 60 / mais de 60</div><b>${s.faixas.leve.n} · ${s.faixas.medio.n} · ${s.faixas.firme.n}</b><div class="hint">${brl(s.faixas.leve.valor)} · ${brl(s.faixas.medio.valor)} · ${brl(s.faixas.firme.valor)}</div></div>
        <div class="card"><div class="hint">Total em aberto</div><b style="font-size:26px">${brl(fc.totalOpen)}</b><div class="hint">${s.semTelefone} atrasada(s) sem telefone</div></div>
        <div class="card"><div class="hint">Fila de avisos</div><b style="font-size:26px">${st.queued}</b><div class="hint">enviados hoje: ${st.sentToday} de ${st.perDay} · ${st.inWindow ? 'dentro do horário' : 'fora do horário de envio'}</div></div></div>
      <div class="panel"><h2>Quanto entra por mês</h2><p class="hint">Atrasado agora: <b>${brl(fc.overdue)}</b> (${fc.overdueCount} parcelas). Barras: o que vence em cada mês.</p>
        ${fc.months.map((m) => `<div class="row"><span style="width:80px">${esc(m.month.split('-').reverse().join('/'))}${m.month === fc.thisMonth ? ' (mês atual)' : ''}</span><div style="flex:1;background:rgba(127,127,127,.15);border-radius:6px"><div style="width:${Math.round((m.toReceive / max) * 100)}%;min-width:2px;height:16px;background:var(--accent,#1f8a5b);border-radius:6px"></div></div><span style="width:260px;text-align:right">a receber ${brl(m.toReceive)}${m.received ? ` · recebido ${brl(m.received)}` : ''}</span></div>`).join('') || '<p class="muted">Sem parcelas futuras com data.</p>'}</div>
      <div class="panel"><div class="row"><input id="cbQ" placeholder="Buscar contrato, cliente, CPF ou telefone" value="${esc(f.q)}" /><select id="cbMin"><option value="1">Todas as vencidas</option><option value="16" ${f.minDays === 16 ? 'selected' : ''}>Mais de 15 dias</option><option value="61" ${f.minDays === 61 ? 'selected' : ''}>Mais de 60 dias</option></select>
        <button class="btn primary" data-a="approve">Aprovar aviso das marcadas (${sel.size})</button><button class="btn small" data-a="all">Marcar as 25 mais antigas com telefone</button>${st.queued ? '<button class="btn small danger" data-a="cancelq">Cancelar a fila</button>' : ''}</div>
        <div class="table-wrap"><table><thead><tr><th></th><th>Contrato</th><th>Cliente</th><th>Parcela</th><th>Valor</th><th>Venceu</th><th>Atraso</th><th>Avisos</th></tr></thead><tbody>${r.rows.map((x) => `<tr><td><input type="checkbox" data-k="${esc(x.key)}" ${sel.has(x.key) ? 'checked' : ''} ${x.phone && !x.claimed && !x.queued ? '' : 'disabled'} /></td><td>${esc(x.number)}</td><td>${esc(x.client)}<div class="hint">${x.phone ? `+${esc(x.phone)}` : 'sem telefone'}</div></td><td>${esc(x.label)}</td><td><b>${brl(x.value)}</b></td><td>${esc(br(x.due))}</td><td>${x.daysLate} dia(s)<div class="hint">${esc(TIER[x.tier])}</div></td><td>${x.queued ? 'na fila' : x.claimed ? 'vendedor avisou que pagou' : x.notices ? `${x.notices} (último ${esc(br((x.lastNoticeAt || '').slice(0, 10)))})` : '—'}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">Nenhuma parcela vencida.</td></tr>'}</tbody></table></div>${r.shown < s.parcelas ? `<p class="hint">Mostrando ${r.shown} de ${s.parcelas}; use a busca para achar as outras.</p>` : ''}</div>
      <div class="panel"><h2>Limites de envio</h2><div class="grid2"><label>Máximo por dia (até 40)<input type="number" id="cfPer" value="${st.config.perDay}" /></label><label>Horário (início e fim)<span class="row"><input type="number" id="cfFrom" value="${st.config.fromHour}" /><input type="number" id="cfTo" value="${st.config.toHour}" /></span></label><label>Intervalo entre mensagens (segundos, mínimo e máximo)<span class="row"><input type="number" id="cfMin" value="${st.config.minGapSec}" /><input type="number" id="cfMax" value="${st.config.maxGapSec}" /></span></label><label>Avisar a mesma parcela de novo só depois de (dias)<input type="number" id="cfRep" value="${st.config.repeatDays}" /></label></div><button class="btn" data-a="cfg">Salvar limites</button>
        <h3>Últimos avisos</h3>${st.recent.map((l) => `<div class="hint">${esc(new Date(l.at).toLocaleString('pt-BR'))} · ${l.ok ? 'enviado' : esc(l.skip || l.error || 'não enviado')}</div>`).join('') || '<p class="muted">Nenhum aviso enviado ainda.</p>'}</div>`;
    window._cbRows = r.rows;
  }
  sec.addEventListener('change', (e) => {
    if (e.target.dataset.k) { e.target.checked ? sel.add(e.target.dataset.k) : sel.delete(e.target.dataset.k); }
    if (e.target.id === 'cbMin') { f.minDays = Number(e.target.value); load(); }
  });
  let tm;
  sec.addEventListener('input', (e) => { if (e.target.id === 'cbQ') { f.q = e.target.value; clearTimeout(tm); tm = setTimeout(() => load().then(() => { const i = sec.querySelector('#cbQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }).catch(() => {}), 350); } });
  sec.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-a]'); if (!t) return;
    const g = (i) => sec.querySelector(i);
    try {
      if (t.dataset.a === 'all') { (window._cbRows || []).filter((x) => x.phone && !x.claimed && !x.queued).slice(0, 25).forEach((x) => sel.add(x.key)); return await load(); }
      if (t.dataset.a === 'approve') {
        if (!sel.size) return toast('Marque as parcelas que podem ser avisadas', true);
        if (!confirm(`Aprovar o aviso de cobrança para ${sel.size} parcela(s)? As mensagens saem aos poucos, no horário e limite combinados.`)) return;
        const r = await api('/api/collections/enqueue', { method: 'POST', body: { keys: [...sel] } }); sel.clear();
        toast(`${r.queued} na fila${r.skipped.length ? `; ${r.skipped.length} ficaram de fora (${[...new Set(r.skipped.map((x) => x.motivo))].join(', ')})` : ''}`);
      } else if (t.dataset.a === 'cancelq') { if (!confirm('Cancelar os avisos que ainda não saíram?')) return; await api('/api/collections/queue', { method: 'DELETE' }); }
      else if (t.dataset.a === 'cfg') { await api('/api/collections/config', { method: 'PUT', body: { perDay: g('#cfPer').value, fromHour: g('#cfFrom').value, toHour: g('#cfTo').value, minGapSec: g('#cfMin').value, maxGapSec: g('#cfMax').value, repeatDays: g('#cfRep').value } }); toast('Limites salvos'); }
      await load();
    } catch (err) { toast(err.message, true); }
  });
  loaders.collections = () => load().catch((e) => toast(e.message, true));
})();
