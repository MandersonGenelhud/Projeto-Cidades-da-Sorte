// Telas da Migratech Soluções (clientes, contratos, serviços prestados, caixa e saques dos sócios)
// e do Migra Devocional (quantos usuários se cadastraram no aplicativo).
(() => {
  const host = document.querySelector('#tab-lots')?.parentElement;
  if (!host) return;
  const CUR = { BRL: 'R$', USD: 'US$', PYG: 'Gs.' };
  const money = (v, c = 'BRL') => `${CUR[c] || c} ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: c === 'PYG' ? 0 : 2, maximumFractionDigits: c === 'PYG' ? 0 : 2 })}`;
  const byCur = (o) => Object.entries(o || {}).map(([c, v]) => money(v, c)).join(' · ') || money(0);
  const dBr = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—');
  const opt = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${esc(k)}" ${k === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');
  const RECUR = { unico: 'Único', mensal: 'Mensal', anual: 'Anual' };
  const CSTATUS = { ativo: 'Ativo', pausado: 'Pausado', encerrado: 'Encerrado', cancelado: 'Cancelado' };
  const SSTATUS = { a_faturar: 'A faturar', faturado: 'Faturado (a receber)', pago: 'Pago' };
  const CURS = { BRL: 'R$ (reais)', USD: 'US$ (dólares)', PYG: 'Gs. (guaranis)' };

  // ======================= MIGRATECH =======================
  const mt = document.createElement('section');
  mt.id = 'tab-migratech';
  mt.className = 'tab';
  host.appendChild(mt);
  let data = null; let view = 'resumo'; let editing = null;

  const kpi = (label, value, sub = '') => `<div class="card kpi"><div class="kpi-head"><span class="label">${label}</span></div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  function formHtml(kind, x = {}) {
    const clients = data.clients.map((c) => `<option value="${esc(c.id)}" ${c.id === x.clientId ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    if (kind === 'clients') return `<div class="grid2 tight"><label>Nome <input name="name" required value="${esc(x.name || '')}" /></label><label>Empresa <input name="company" value="${esc(x.company || '')}" /></label>
      <label>Documento (CPF, CNPJ, RUC) <input name="doc" value="${esc(x.doc || '')}" /></label><label>Telefone <input name="phone" value="${esc(x.phone || '')}" /></label>
      <label>E-mail <input name="email" type="email" value="${esc(x.email || '')}" /></label></div><label>Observações <input name="notes" value="${esc(x.notes || '')}" /></label>`;
    if (!data.clients.length) return '<p class="hint">Cadastre um cliente primeiro.</p>';
    if (kind === 'contracts') return `<div class="grid2 tight"><label>Cliente <select name="clientId">${clients}</select></label><label>O que cobre <input name="title" required value="${esc(x.title || '')}" placeholder="ex.: sistema de atendimento com IA" /></label>
      <label>Valor <input name="value" inputmode="decimal" required value="${esc(x.value ?? '')}" /></label><label>Moeda <select name="currency">${opt(CURS, x.currency || 'BRL')}</select></label>
      <label>Cobrança <select name="recurrence">${opt(RECUR, x.recurrence || 'mensal')}</select></label><label>Situação <select name="status">${opt(CSTATUS, x.status || 'ativo')}</select></label>
      <label>Início <input type="date" name="startDate" value="${esc(x.startDate || new Date().toISOString().slice(0, 10))}" /></label><label>Fim (se tiver) <input type="date" name="endDate" value="${esc(x.endDate || '')}" /></label></div>
      <label>Observações <input name="notes" value="${esc(x.notes || '')}" /></label>`;
    const contracts = data.contracts.filter((c) => !x.clientId || c.clientId === x.clientId);
    return `<div class="grid2 tight"><label>Cliente <select name="clientId">${clients}</select></label><label>Contrato (opcional) <select name="contractId"><option value="">Sem contrato</option>${contracts.map((c) => `<option value="${esc(c.id)}" ${c.id === x.contractId ? 'selected' : ''}>${esc(c.number)} · ${esc(c.title)}</option>`).join('')}</select></label>
      <label>O que foi feito <input name="description" required value="${esc(x.description || '')}" /></label><label>Data <input type="date" name="date" value="${esc(x.date || new Date().toISOString().slice(0, 10))}" /></label>
      <label>Valor <input name="value" inputmode="decimal" required value="${esc(x.value ?? '')}" /></label><label>Moeda <select name="currency">${opt(CURS, x.currency || 'BRL')}</select></label>
      <label>Horas (opcional) <input name="hours" inputmode="decimal" value="${esc(x.hours ?? '')}" /></label><label>Situação <select name="status">${opt(SSTATUS, x.status || 'a_faturar')}</select></label>
      <label>Forma de pagamento <input name="method" value="${esc(x.method || '')}" placeholder="Pix, transferência…" /></label></div>
      <p class="hint">Quando a situação for <b>Pago</b>, o valor entra sozinho no Caixa Migratech Soluções.</p>`;
  }
  const TITLES = { clients: 'cliente', contracts: 'contrato', services: 'serviço prestado' };

  function render() {
    const t = data.totals;
    const cash = data.cash.byCurrency;
    const tabs = [['resumo', 'Resumo'], ['clients', `Clientes (${t.clients})`], ['contracts', `Contratos (${data.contracts.length})`], ['services', `Serviços prestados (${data.services.length})`], ['socios', 'Saques dos sócios']];
    let body = '';
    if (view === 'resumo') {
      body = `<div class="cards">${kpi('Clientes', t.clients)}${kpi('Contratos ativos', t.activeContracts)}${kpi('Receita mensal dos contratos', byCur(t.mrr), 'mensais + anuais ÷ 12')}${kpi('Recebido no mês (serviços)', byCur(t.paidMonth))}${kpi('A faturar', byCur(t.toBill))}${kpi('A receber', byCur(t.toReceive))}</div>
        <div class="panel"><h2>Caixa Migratech Soluções (este mês)</h2><div class="cards">${Object.keys(cash).length ? Object.entries(cash).map(([c, s]) => `${kpi(`Entradas ${CUR[c] || c}`, money(s.entradas, c))}${kpi(`Saídas ${CUR[c] || c}`, money(s.saidas, c))}${kpi(`Saldo ${CUR[c] || c}`, money(s.saldo, c))}`).join('') : '<p class="hint">Nenhum lançamento neste mês.</p>'}</div>
        <p class="row"><button type="button" class="btn" data-mt="cash">Abrir o Caixa Migratech (entradas, saídas e planilha)</button></p></div>
        <div class="panel"><h2>Saques dos sócios (este mês)</h2>${Object.entries(data.partnerTotals).map(([p, v]) => `<div class="cash-row"><span style="min-width:160px">${esc(p)}</span><b>${byCur(v)}</b></div>`).join('')}</div>`;
    } else if (view === 'socios') {
      body = `<form class="panel form" id="mtSaque"><h2>Registrar saque de sócio</h2><div class="grid2 tight">
          <label>Sócio <select name="partner">${data.partners.map((p) => `<option>${esc(p)}</option>`).join('')}</select></label>
          <label>Valor <input name="amount" inputmode="decimal" required /></label><label>Moeda <select name="currency">${opt(CURS, 'BRL')}</select></label>
          <label>Data <input type="date" name="date" value="${new Date().toISOString().slice(0, 10)}" /></label><label>Forma <input name="method" placeholder="Pix, transferência…" /></label>
          <label>Observação <input name="notes" /></label></div>
          <p class="hint">O saque entra como saída no Caixa Migratech Soluções, na categoria "Retirada de sócio", com o nome do sócio.</p>
          <button class="btn primary">Registrar saque</button></form>
        <div class="panel"><h2>Quanto cada sócio sacou (este mês)</h2>${Object.entries(data.partnerTotals).map(([p, v]) => `<div class="cash-row"><span style="min-width:160px">${esc(p)}</span><b>${byCur(v)}</b></div>`).join('')}
        <p class="hint">Para ver por período, abra o Caixa Migratech e filtre a categoria "Retirada de sócio".</p></div>`;
    } else {
      const rows = {
        clients: () => `<thead><tr><th>Cliente</th><th>Contato</th><th>Contratos ativos</th><th>Serviços</th><th></th></tr></thead><tbody>${data.clients.map((c) => `<tr data-id="${esc(c.id)}"><td><b>${esc(c.name)}</b>${c.company ? `<div class="hint">${esc(c.company)}</div>` : ''}</td><td>${esc([c.phone, c.email, c.doc].filter(Boolean).join(' · ') || '—')}</td><td>${c.contracts}</td><td>${c.services}</td><td class="row"><button class="btn small" data-act="edit">Editar</button><button class="btn small danger" data-act="del">Apagar</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nenhum cliente ainda.</td></tr>'}</tbody>`,
        contracts: () => `<thead><tr><th>Contrato</th><th>Cliente</th><th>Valor</th><th>Situação</th><th>Período</th><th></th></tr></thead><tbody>${data.contracts.map((c) => `<tr data-id="${esc(c.id)}"><td><b>${esc(c.number)}</b><div class="hint">${esc(c.title)}</div></td><td>${esc(c.clientName)}</td><td>${money(c.value, c.currency)}<div class="hint">${esc(RECUR[c.recurrence])}</div></td><td>${esc(CSTATUS[c.status])}</td><td>${dBr(c.startDate)}${c.endDate ? ` a ${dBr(c.endDate)}` : ''}</td><td class="row"><button class="btn small" data-act="edit">Editar</button><button class="btn small danger" data-act="del">Apagar</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nenhum contrato ainda.</td></tr>'}</tbody>`,
        services: () => `<thead><tr><th>Data</th><th>Serviço</th><th>Cliente</th><th>Valor</th><th>Situação</th><th></th></tr></thead><tbody>${data.services.map((x) => `<tr data-id="${esc(x.id)}"><td>${dBr(x.date)}</td><td><b>${esc(x.description)}</b>${x.contractNumber ? `<div class="hint">${esc(x.contractNumber)}</div>` : ''}${x.hours ? `<div class="hint">${x.hours} h</div>` : ''}</td><td>${esc(x.clientName)}</td><td>${money(x.value, x.currency)}</td><td><span class="badge ${x.status === 'pago' ? 'done' : 'paused'}">${esc(SSTATUS[x.status])}</span>${x.paidAt ? `<div class="hint">pago ${dBr(x.paidAt)}</div>` : ''}</td><td class="row">${x.status !== 'pago' ? '<button class="btn small primary" data-act="paid">Recebi</button>' : ''}<button class="btn small" data-act="edit">Editar</button><button class="btn small danger" data-act="del">Apagar</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nenhum serviço registrado.</td></tr>'}</tbody>`,
      };
      body = `<div class="row"><button type="button" class="btn primary" data-act="new">Novo ${TITLES[view]}</button></div>
        <form class="panel form" id="mtForm" ${editing ? '' : 'hidden'}><h2>${editing?.id ? 'Editar' : 'Novo'} ${TITLES[view]}</h2>${editing ? formHtml(view, editing) : ''}<div class="row"><button class="btn primary">Salvar</button><button type="button" class="btn" data-act="cancel">Cancelar</button></div></form>
        <div class="panel"><div class="table-wrap"><table>${rows[view]()}</table></div></div>`;
    }
    mt.innerHTML = `<div class="page-head"><img class="mt-logo" src="/img/marcas/migratech-solucoes.webp" alt="" width="56" height="50" /><h1>Migratech Soluções</h1></div>
      <div class="seg mt-tabs" role="group" aria-label="Partes da Migratech">${tabs.map(([k, l]) => `<button type="button" class="btn small" data-view="${k}" aria-pressed="${k === view}">${esc(l)}</button>`).join('')}</div>
      ${body}`;
  }

  async function load() {
    try { data = await api('/api/migratech'); } catch (e) {
      mt.innerHTML = `<div class="page-head"><h1>Migratech Soluções</h1></div><div class="panel"><p>${esc(e.message)}</p><p class="hint">Quem pode ver a Migratech é definido em Financeiro → Caixa → "Categorias das despesas e quem pode ver o caixa".</p></div>`;
      return;
    }
    render();
  }
  loaders.migratech = load;

  mt.addEventListener('click', async (e) => {
    const v = e.target.closest('[data-view]');
    if (v) { view = v.dataset.view; editing = null; return render(); }
    if (e.target.closest('[data-mt="cash"]')) { if (typeof cashState !== 'undefined') cashState.book = 'migratech'; try { localStorage.setItem('cashBook', 'migratech'); } catch { /* ok */ } return showTab('cash'); }
    const b = e.target.closest('[data-act]'); if (!b) return;
    const rowId = b.closest('tr[data-id]')?.dataset.id;
    const list = view;
    const item = rowId ? data[list].find((x) => x.id === rowId) : null;
    try {
      if (b.dataset.act === 'new') { editing = {}; render(); mt.querySelector('#mtForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      if (b.dataset.act === 'cancel') { editing = null; render(); }
      if (b.dataset.act === 'edit') { editing = { ...item }; render(); mt.querySelector('#mtForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      if (b.dataset.act === 'paid') { await api(`/api/migratech/services/${rowId}`, { method: 'PATCH', body: { status: 'pago' } }); toast('Recebido: entrou no Caixa Migratech'); await load(); }
      if (b.dataset.act === 'del') {
        const reason = prompt('Por que está apagando? (fica guardado no histórico)');
        if (!reason) return;
        await api(`/api/migratech/${list}/${rowId}`, { method: 'DELETE', body: { reason } });
        toast('Apagado'); await load();
      }
    } catch (err) { toast(err.message, true); }
  });
  mt.addEventListener('change', (e) => {
    // Ao trocar o cliente do serviço, só mostra os contratos dele.
    if (e.target.name === 'clientId' && view === 'services' && editing) { editing = { ...editing, ...Object.fromEntries(new FormData(mt.querySelector('#mtForm'))), contractId: '' }; render(); }
  });
  mt.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = Object.fromEntries(new FormData(f));
    try {
      if (f.id === 'mtSaque') { await api('/api/migratech-withdrawals', { method: 'POST', body }); toast('Saque registrado no Caixa Migratech'); return await load(); }
      await api(editing?.id ? `/api/migratech/${view}/${editing.id}` : `/api/migratech/${view}`, { method: editing?.id ? 'PATCH' : 'POST', body });
      toast('Salvo'); editing = null; await load();
    } catch (err) { toast(err.message, true); }
  });

  // ======================= MIGRA DEVOCIONAL =======================
  const dv = document.createElement('section');
  dv.id = 'tab-devocional';
  dv.className = 'tab';
  host.appendChild(dv);
  let shownKey = '';
  async function loadDev() {
    let s;
    try { s = await api('/api/app-signups/devocional'); } catch (e) { dv.innerHTML = `<div class="page-head"><h1>Migra Devocional</h1></div><p>${esc(e.message)}</p>`; return; }
    const max = Math.max(1, ...s.byDay.map((d) => d.count));
    const endpoint = `${location.origin}/api/integrations/devocional/users`;
    dv.innerHTML = `<div class="page-head"><img class="mt-logo" src="/img/marcas/migra-devocional.webp" alt="" width="80" height="50" /><h1>Migra Devocional</h1></div>
      <div class="cards">${kpi('Usuários cadastrados', s.total.toLocaleString('pt-BR'), s.left ? `${s.left} saíram do app` : '')}${kpi('Novos hoje', s.today)}${kpi('Últimos 7 dias', s.last7)}${kpi('Últimos 30 dias', s.last30)}</div>
      <div class="panel"><h2>Cadastros por dia (30 dias)</h2>
        <div class="dv-bars" role="img" aria-label="Cadastros por dia nos últimos 30 dias">${s.byDay.map((d) => `<div class="dv-col" title="${dBr(d.day)}: ${d.count} cadastro(s)"><i style="height:${Math.max(d.count ? 4 : 0, Math.round((d.count / max) * 100))}%"></i></div>`).join('')}</div>
        <div class="dv-axis"><span>${dBr(s.byDay[0].day)}</span><span>hoje</span></div>
        ${Object.keys(s.byPlan).length ? `<p class="hint">Por plano: ${Object.entries(s.byPlan).map(([p, n]) => `<b>${esc(p)}</b> ${n}`).join(' · ')}</p>` : ''}</div>
      <div class="panel"><h2>Últimos cadastros</h2><div class="table-wrap"><table><thead><tr><th>Quando</th><th>Nome</th><th>Contato</th><th>Plano</th></tr></thead><tbody>${s.recent.map((u) => `<tr><td>${fmtDate(u.createdAt)}</td><td>${esc(u.name || '—')}</td><td>${esc([u.email, u.phone].filter(Boolean).join(' · ') || '—')}</td><td>${esc(u.plan || '—')}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nenhum cadastro recebido ainda.</td></tr>'}</tbody></table></div>
        <p class="hint">E-mail e telefone aparecem mascarados para proteger os usuários.</p></div>
      <details class="panel" ${s.connected ? '' : 'open'}><summary><b>Ligar o aplicativo ao Migra Hub</b> ${s.connected ? `<span class="badge done">ligado · chave terminada em ${esc(s.keyHint)}</span>` : '<span class="badge paused">ainda não ligado</span>'}${s.lastAt ? ` <span class="hint">último envio ${fmtDate(s.lastAt)}</span>` : ''}</summary>
        <p class="hint">O aplicativo avisa o Migra Hub a cada cadastro novo. Quem cuida do aplicativo configura uma vez:</p>
        <ol class="hint"><li>Clique em <b>Gerar chave</b> e copie (ela aparece uma vez só).</li><li>Nas configurações do aplicativo (variável de ambiente ou segredo), guarde a chave. Nunca mande por conversa ou e-mail.</li>
          <li>A cada cadastro, o aplicativo envia <code>POST ${esc(endpoint)}</code> com o cabeçalho <code>Authorization: Bearer CHAVE</code> e o corpo <code>{"id":"…","name":"…","email":"…","phone":"…","plan":"…","createdAt":"2026-11-05T10:00:00Z"}</code>. Para mandar os cadastros antigos de uma vez: <code>{"users":[…]}</code> (até 500 por envio).</li></ol>
        ${shownKey ? `<div class="panel dv-key"><b>Chave nova (copie agora):</b><code id="dvKey">${esc(shownKey)}</code><button type="button" class="btn small" data-dv="copy">Copiar</button></div>` : ''}
        <div class="row"><button type="button" class="btn primary" data-dv="key">${s.connected ? 'Trocar a chave' : 'Gerar chave'}</button>${s.connected ? '<button type="button" class="btn danger" data-dv="revoke">Desligar</button>' : ''}</div></details>`;
    shownKey = '';
  }
  loaders.devocional = loadDev;
  dv.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-dv]'); if (!b) return;
    try {
      if (b.dataset.dv === 'key') {
        if (!confirm('Gerar uma chave nova? Se já existia uma, ela para de funcionar e o aplicativo precisa da nova.')) return;
        shownKey = (await api('/api/app-signups/devocional/key', { method: 'POST', body: {} })).key;
        await loadDev();
      }
      if (b.dataset.dv === 'copy') { await navigator.clipboard.writeText(dv.querySelector('#dvKey').textContent); toast('Chave copiada'); }
      if (b.dataset.dv === 'revoke') { if (!confirm('Desligar? O aplicativo para de conseguir mandar cadastros até gerar outra chave.')) return; await api('/api/app-signups/devocional/key', { method: 'DELETE', body: {} }); toast('Desligado'); await loadDev(); }
    } catch (err) { toast(err.message, true); }
  });
})();
