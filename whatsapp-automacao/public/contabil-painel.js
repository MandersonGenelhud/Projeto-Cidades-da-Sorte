// Painel da Migra Contábil Paraguay: empresas clientes, obrigações do mês, documentos pedidos, honorários e configuração.
(() => {
  const host = document.querySelector('#tab-lots')?.parentElement;
  if (!host) return;
  const CUR = { BRL: 'R$', USD: 'US$', PYG: 'Gs.' };
  const money = (v, c = 'PYG') => `${CUR[c] || c} ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: c === 'PYG' ? 0 : 2, maximumFractionDigits: c === 'PYG' ? 0 : 2 })}`;
  const byCur = (o) => Object.entries(o || {}).map(([c, v]) => money(v, c)).join(' · ') || '—';
  const dBr = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—');
  const mBr = (m) => { const [y, mo] = String(m).split('-'); return `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(mo) - 1]}/${y}`; };
  const opt = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${esc(k)}" ${k === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');
  const kpi = (label, value, sub = '', go = '') => `<${go ? `button type="button" data-view="${go}"` : 'div'} class="card kpi ${go ? 'ct-link' : ''}"><div class="kpi-head"><span class="label">${label}</span></div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</${go ? 'button' : 'div'}>`;
  const STATUS_TONE = { pendente: 'paused', em_andamento: 'paused', aguardando_cliente: 'paused', entregue: 'done', dispensado: 'canceled' };

  const sec = document.createElement('section');
  sec.id = 'tab-contabil';
  sec.className = 'tab';
  host.appendChild(sec);
  let d = null; let view = 'resumo'; let editing = null; let month = new Date().toISOString().slice(0, 7); let filter = { q: '', status: '', resp: '' };

  function companyForm(c = {}) {
    const L = d.labels;
    return `<div class="grid2 tight">
      <label>Razão social <input name="name" required value="${esc(c.name || '')}" /></label><label>Nome fantasia <input name="tradeName" value="${esc(c.tradeName || '')}" /></label>
      <label>RUC <input name="ruc" value="${esc(c.ruc || '')}" placeholder="80012345-6" /></label><label>CNPJ (se tiver no Brasil) <input name="cnpj" value="${esc(c.cnpj || '')}" /></label>
      <label>Regime <select name="regime">${opt(L.regimes, c.regime || 'ire_simple')}</select></label><label>Situação <select name="status">${opt(L.companyStatus, c.status || 'ativo')}</select></label>
      <label>Atividade <input name="activity" value="${esc(c.activity || '')}" placeholder="comércio, serviços…" /></label><label>Responsável no escritório <input name="responsible" value="${esc(c.responsible || window.currentUser?.name || '')}" /></label>
      <label>Contato na empresa <input name="contactName" value="${esc(c.contactName || '')}" /></label><label>Telefone / WhatsApp <input name="phone" value="${esc(c.phone || '')}" /></label>
      <label>E-mail <input name="email" type="email" value="${esc(c.email || '')}" /></label><label>Cliente desde <input type="date" name="startDate" value="${esc(c.startDate || new Date().toISOString().slice(0, 10))}" /></label>
      <label>Honorário mensal <input name="monthlyFee" inputmode="decimal" value="${esc(c.monthlyFee ?? '')}" /></label><label>Moeda <select name="currency">${opt({ PYG: 'Gs. (guaranis)', BRL: 'R$ (reais)', USD: 'US$ (dólares)' }, c.currency || 'PYG')}</select></label>
      <label>Dia de pagar o honorário <input name="feeDay" type="number" min="1" max="28" value="${esc(c.feeDay ?? 10)}" /></label></div>
      <fieldset class="ct-obls"><legend>Obrigações desta empresa ${c.id ? '' : '<span class="hint">(vazio = as do regime escolhido)</span>'}</legend>${d.obligations.filter((o) => o.active).map((o) => `<label class="check"><input type="checkbox" name="obl" value="${esc(o.id)}" ${c.obligationIds?.includes(o.id) ? 'checked' : ''} /> ${esc(o.name)} <span class="hint">${esc(d.labels.periods[o.period])}</span></label>`).join('')}</fieldset>
      <label>Observações <input name="notes" value="${esc(c.notes || '')}" /></label>`;
  }

  function render() {
    const t = d.totals;
    const tabs = [['resumo', 'Resumo'], ['empresas', `Empresas (${t.companies})`], ['obrigacoes', `Obrigações do mês (${t.pending} pendentes)`], ['documentos', `Documentos (${t.docsPending} esperando)`], ['honorarios', 'Honorários'], ['config', 'Configurar']];
    let body = '';
    if (view === 'resumo') {
      const pct = t.tasks ? Math.round((t.delivered / t.tasks) * 100) : 0;
      body = `<div class="cards">${kpi('Empresas ativas', t.companies, t.inactive ? `${t.inactive} suspensa(s) ou encerrada(s)` : '', 'empresas')}${kpi(`Obrigações de ${mBr(d.month)}`, `${t.delivered} de ${t.tasks}`, `${pct}% entregues`, 'obrigacoes')}${kpi('Atrasadas (todas)', t.lateTasks, t.lateTasks ? 'resolver primeiro' : 'nenhuma', 'obrigacoes')}${kpi('Documentos esperando', t.docsPending, '', 'documentos')}${kpi('Honorários a receber', byCur(t.feesOpen), t.feesLate && Object.keys(t.feesLate).length ? `em atraso: ${byCur(t.feesLate)}` : '', 'honorarios')}${kpi('Receita mensal da carteira', byCur(t.monthlyRevenue))}</div>
        <div class="progress ct-progress" title="${pct}% entregues"><span style="width:${pct}%"></span></div>
        <div class="grid2">
          <div class="panel"><h2>Atrasadas</h2>${d.late.length ? d.late.slice(0, 12).map((x) => `<div class="cash-row"><span class="grow"><b>${esc(x.companyName)}</b> · ${esc(x.name)}</span><span class="status-warn">venceu ${dBr(x.dueDate)}</span></div>`).join('') : '<p class="hint">Nada atrasado.</p>'}</div>
          <div class="panel"><h2>Vencem nos próximos 7 dias</h2>${d.soon.length ? d.soon.slice(0, 12).map((x) => `<div class="cash-row"><span class="grow"><b>${esc(x.companyName)}</b> · ${esc(x.name)}</span><span>${dBr(x.dueDate)}</span></div>`).join('') : '<p class="hint">Nada vence nesta semana.</p>'}</div>
          <div class="panel"><h2>Carteira por regime</h2>${Object.entries(d.byRegime).map(([k, v]) => `<div class="cash-row"><span class="grow">${esc(k)}</span><b>${v}</b></div>`).join('') || '<p class="hint">Cadastre as empresas.</p>'}</div>
          <div class="panel"><h2>Carteira por responsável</h2>${Object.entries(d.byResponsible).map(([k, v]) => `<div class="cash-row"><span class="grow">${esc(k)}</span><b>${v}</b></div>`).join('') || '<p class="hint">Sem empresas.</p>'}</div>
        </div>`;
    } else if (view === 'empresas') {
      const q = filter.q.toLowerCase();
      const list = d.companies.filter((c) => (!q || `${c.name} ${c.tradeName} ${c.ruc} ${c.cnpj} ${c.contactName}`.toLowerCase().includes(q)) && (!filter.status || c.status === filter.status) && (!filter.resp || c.responsible === filter.resp));
      body = `<div class="row"><button type="button" class="btn primary" data-act="new-company">Nova empresa</button><input id="ctQ" class="grow" placeholder="Buscar razão social, RUC, contato" value="${esc(filter.q)}" />
          <select id="ctStatus"><option value="">Todas as situações</option>${opt(d.labels.companyStatus, filter.status)}</select>
          <select id="ctResp"><option value="">Todos os responsáveis</option>${[...new Set(d.companies.map((c) => c.responsible).filter(Boolean))].map((r) => `<option ${r === filter.resp ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></div>
        ${editing?.list === 'companies' ? `<form class="panel form" id="ctForm" data-list="companies"><h2>${editing.id ? 'Editar empresa' : 'Nova empresa'}</h2>${companyForm(editing)}<div class="row"><button class="btn primary">Salvar</button><button type="button" class="btn" data-act="cancel">Cancelar</button></div></form>` : ''}
        <div class="panel"><div class="table-wrap"><table><thead><tr><th>Empresa</th><th>RUC</th><th>Regime</th><th>Responsável</th><th>Honorário</th><th>Pendências</th><th></th></tr></thead><tbody>${list.map((c) => `<tr data-id="${esc(c.id)}"><td><b>${esc(c.name)}</b>${c.tradeName ? `<div class="hint">${esc(c.tradeName)}</div>` : ''}${c.status !== 'ativo' ? `<span class="badge canceled">${esc(d.labels.companyStatus[c.status])}</span>` : ''}</td><td>${esc(c.ruc || '—')}</td><td>${esc(c.regimeLabel)}</td><td>${esc(c.responsible || '—')}</td><td>${c.monthlyFee ? money(c.monthlyFee, c.currency) : '—'}</td><td>${c.late ? `<span class="status-warn">${c.late} atrasada(s)</span> ` : ''}${c.open ? `${c.open} aberta(s)` : 'em dia'}${c.docs ? `<div class="hint">${c.docs} documento(s) esperando</div>` : ''}</td><td class="row"><button class="btn small" data-act="edit-company">Editar</button><button class="btn small" data-act="ask-doc">Pedir documento</button><button class="btn small danger" data-act="del-company">Apagar</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">Nenhuma empresa ainda. Clique em "Nova empresa".</td></tr>'}</tbody></table></div></div>`;
    } else if (view === 'obrigacoes') {
      const tasks = d.tasks.filter((x) => (!filter.status || (filter.status === 'atrasada' ? x.late : x.status === filter.status)) && (!filter.resp || x.responsible === filter.resp));
      body = `<div class="row"><label class="inline">Mês de vencimento <input type="month" id="ctMonth" value="${esc(month)}" /></label>
          <select id="ctStatus"><option value="">Todas</option><option value="atrasada" ${filter.status === 'atrasada' ? 'selected' : ''}>Atrasadas</option>${opt(d.labels.taskStatus, filter.status)}</select>
          <select id="ctResp"><option value="">Todos os responsáveis</option>${[...new Set(d.tasks.map((x) => x.responsible).filter(Boolean))].map((r) => `<option ${r === filter.resp ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></div>
        <p class="hint">As obrigações de cada mês aparecem sozinhas para cada empresa ativa, conforme o regime e o que foi marcado na empresa. Mensais vencem no mês seguinte ao de referência.</p>
        <div class="panel"><div class="table-wrap"><table><thead><tr><th>Vence</th><th>Empresa</th><th>Obrigação</th><th>Referência</th><th>Responsável</th><th>Situação</th><th></th></tr></thead><tbody>${tasks.map((x) => `<tr data-id="${esc(x.id)}"><td>${dBr(x.dueDate)}${x.late ? '<div class="status-warn">atrasada</div>' : ''}</td><td><b>${esc(x.companyName)}</b></td><td>${esc(x.name)}</td><td>${esc(/^\d{4}$/.test(x.reference) ? x.reference : mBr(x.reference))}</td><td>${esc(x.responsible || '—')}</td><td><span class="badge ${STATUS_TONE[x.status]}">${esc(d.labels.taskStatus[x.status])}</span>${x.deliveredAt ? `<div class="hint">em ${dBr(x.deliveredAt)}${x.protocol ? ` · ${esc(x.protocol)}` : ''}</div>` : ''}</td><td class="row">${x.status !== 'entregue' ? '<button class="btn small primary" data-act="deliver">Entregue</button>' : ''}<select class="ct-task-status" aria-label="Mudar situação">${opt(d.labels.taskStatus, x.status)}</select></td></tr>`).join('') || '<tr><td colspan="7" class="muted">Nenhuma obrigação neste mês. Cadastre as empresas e marque as obrigações de cada uma.</td></tr>'}</tbody></table></div></div>`;
    } else if (view === 'documentos') {
      body = `<form class="panel form" id="ctDoc"><h2>Pedir documento ao cliente</h2><div class="grid2 tight"><label>Empresa <select name="companyId">${d.companies.filter((c) => c.status === 'ativo').map((c) => `<option value="${esc(c.id)}" ${editing?.companyId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
          <label>Documento <input name="title" required placeholder="ex.: extrato bancário, notas de compra" /></label><label>Mês de referência <input type="month" name="month" value="${esc(month)}" /></label><label>Prazo (opcional) <input type="date" name="dueDate" /></label></div>
          <button class="btn primary">Registrar pedido</button></form>
        <div class="panel"><div class="table-wrap"><table><thead><tr><th>Empresa</th><th>Documento</th><th>Referência</th><th>Pedido em</th><th>Situação</th><th></th></tr></thead><tbody>${d.requests.map((r) => `<tr data-id="${esc(r.id)}"><td><b>${esc(r.companyName)}</b></td><td>${esc(r.title)}</td><td>${esc(mBr(r.month))}</td><td>${dBr(r.requestedAt)}${r.dueDate ? `<div class="hint">prazo ${dBr(r.dueDate)}</div>` : ''}</td><td><span class="badge ${r.status === 'recebido' ? 'done' : 'paused'}">${r.status === 'recebido' ? `recebido ${dBr(r.receivedAt)}` : 'esperando'}</span></td><td class="row">${r.status === 'pedido' ? '<button class="btn small primary" data-act="doc-received">Recebi</button>' : ''}<button class="btn small danger" data-act="del-doc">Apagar</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nenhum documento pedido.</td></tr>'}</tbody></table></div></div>`;
    } else if (view === 'honorarios') {
      body = `<div class="row"><label class="inline">Mês <input type="month" id="ctMonth" value="${esc(month)}" /></label></div>
        <div class="cards">${kpi('A receber', byCur(t.feesOpen))}${kpi('Recebido', byCur(t.feesPaid))}${kpi('Em atraso', byCur(t.feesLate))}</div>
        <p class="hint">Um honorário por empresa ativa com valor mensal. Ao marcar <b>Pago</b>, entra sozinho no Caixa Migra Contábil Paraguay.</p>
        <div class="panel"><div class="table-wrap"><table><thead><tr><th>Empresa</th><th>Valor</th><th>Vence</th><th>Situação</th><th></th></tr></thead><tbody>${d.fees.map((f) => `<tr data-id="${esc(f.id)}"><td><b>${esc(f.companyName)}</b></td><td>${money(f.amount, f.currency)}</td><td>${dBr(f.dueDate)}${f.late ? '<div class="status-warn">atrasado</div>' : ''}</td><td><span class="badge ${f.status === 'pago' ? 'done' : f.status === 'cancelado' ? 'canceled' : 'paused'}">${f.status === 'pago' ? `pago ${dBr(f.paidAt)}` : f.status === 'cancelado' ? 'cancelado' : 'aberto'}</span></td><td class="row">${f.status === 'aberto' ? '<button class="btn small primary" data-act="fee-paid">Pago</button><button class="btn small" data-act="fee-cancel">Cancelar</button>' : ''}${f.status !== 'aberto' ? '<button class="btn small" data-act="fee-reopen">Reabrir</button>' : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nenhum honorário neste mês. Coloque o honorário mensal na empresa.</td></tr>'}</tbody></table></div></div>`;
    } else if (view === 'config') {
      body = `<form class="panel form" id="ctRuc"><h2>Vencimento pelo último número do RUC</h2>
          <p class="hint">Dia do mês em que vencem as obrigações "pelo RUC", conforme o último número do RUC (antes do dígito verificador). Estes dias são um ponto de partida: confira no calendário oficial da DNIT e ajuste aqui se mudar.</p>
          <div class="ct-ruc">${Object.entries(d.rucDays).map(([k, v]) => `<label>Final ${k} <input name="d${k}" type="number" min="1" max="31" value="${esc(v)}" /></label>`).join('')}</div>
          <button class="btn primary">Salvar dias</button></form>
        <div class="panel"><h2>Obrigações do escritório</h2><p class="hint">O que o escritório entrega. Ao cadastrar uma empresa, já vêm marcadas as obrigações do regime dela.</p>
          <div class="row"><button type="button" class="btn primary" data-act="new-obl">Nova obrigação</button></div>
          ${editing?.list === 'obligations' ? `<form class="form" id="ctForm" data-list="obligations"><div class="grid2 tight"><label>Nome <input name="name" required value="${esc(editing.name || '')}" /></label><label>Frequência <select name="period">${opt(d.labels.periods, editing.period || 'mensal')}</select></label>
            <label>Vencimento <select name="due">${opt({ ruc: 'Pelo último número do RUC', dia: 'Dia fixo' }, editing.due || 'ruc')}</select></label><label>Dia fixo (se for dia fixo) <input name="day" type="number" min="1" max="31" value="${esc(editing.day ?? '')}" /></label>
            <label>Mês (se for anual) <input name="month" type="number" min="1" max="12" value="${esc(editing.month ?? '')}" /></label></div>
            <fieldset class="ct-obls"><legend>Já vem marcada para os regimes</legend>${Object.entries(d.labels.regimes).map(([k, v]) => `<label class="check"><input type="checkbox" name="reg" value="${esc(k)}" ${editing.regimes?.includes(k) ? 'checked' : ''} /> ${esc(v)}</label>`).join('')}</fieldset>
            <div class="row"><button class="btn primary">Salvar</button><button type="button" class="btn" data-act="cancel">Cancelar</button></div></form>` : ''}
          <div class="table-wrap"><table><thead><tr><th>Obrigação</th><th>Frequência</th><th>Vencimento</th><th>Regimes</th><th></th></tr></thead><tbody>${d.obligations.map((o) => `<tr data-id="${esc(o.id)}"><td><b>${esc(o.name)}</b>${o.active ? '' : ' <span class="badge canceled">desligada</span>'}</td><td>${esc(d.labels.periods[o.period])}${o.period === 'anual' ? ` · mês ${o.month}` : ''}</td><td>${o.due === 'ruc' ? 'pelo RUC' : `dia ${o.day}`}</td><td class="hint">${(o.regimes || []).map((r) => esc(d.labels.regimes[r])).join(', ') || '—'}</td><td class="row"><button class="btn small" data-act="edit-obl">Editar</button><button class="btn small" data-act="toggle-obl">${o.active ? 'Desligar' : 'Ligar'}</button></td></tr>`).join('')}</tbody></table></div></div>`;
    }
    sec.innerHTML = `<div class="page-head"><img class="mt-logo" src="/img/marcas/migra-contabil-paraguay.webp" alt="" width="50" height="54" /><h1>Migra Contábil Paraguay</h1></div>
      <div class="seg mt-tabs" role="group" aria-label="Partes do painel">${tabs.map(([k, l]) => `<button type="button" class="btn small" data-view="${k}" aria-pressed="${k === view}">${esc(l)}</button>`).join('')}</div>${body}`;
  }

  async function load() {
    try { d = await api(`/api/contabil?month=${month}`); } catch (e) {
      sec.innerHTML = `<div class="page-head"><h1>Migra Contábil Paraguay</h1></div><div class="panel"><p>${esc(e.message)}</p><p class="hint">Quem vê este painel é quem vê o Caixa Migra Contábil Paraguay (Financeiro → Caixa → "quem pode ver o caixa").</p></div>`;
      return;
    }
    render();
  }
  loaders.contabil = () => load();

  const call = async (fn, msg) => { try { await fn(); if (msg) toast(msg); await load(); } catch (err) { toast(err.message, true); } };
  sec.addEventListener('click', (e) => {
    const v = e.target.closest('[data-view]');
    if (v) { view = v.dataset.view; editing = null; filter = { q: '', status: '', resp: '' }; return render(); }
    const b = e.target.closest('[data-act]'); if (!b) return;
    const id = b.closest('tr[data-id]')?.dataset.id;
    const act = b.dataset.act;
    if (act === 'cancel') { editing = null; return render(); }
    if (act === 'new-company') { editing = { list: 'companies' }; render(); return sec.querySelector('#ctForm')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    if (act === 'edit-company') { editing = { list: 'companies', ...d.companies.find((c) => c.id === id) }; render(); return sec.querySelector('#ctForm')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    if (act === 'ask-doc') { view = 'documentos'; editing = { companyId: id }; return render(); }
    if (act === 'new-obl') { editing = { list: 'obligations' }; return render(); }
    if (act === 'edit-obl') { editing = { list: 'obligations', ...d.obligations.find((o) => o.id === id) }; return render(); }
    if (act === 'toggle-obl') { const o = d.obligations.find((x) => x.id === id); return call(() => api(`/api/contabil/obligations/${id}`, { method: 'PATCH', body: { active: !o.active } })); }
    if (act === 'deliver') { const protocol = prompt('Número do protocolo ou comprovante (opcional):') ?? null; if (protocol === null) return; return call(() => api(`/api/contabil/tasks/${id}`, { method: 'PATCH', body: { status: 'entregue', protocol } }), 'Marcada como entregue'); }
    if (act === 'doc-received') return call(() => api(`/api/contabil/requests/${id}`, { method: 'PATCH', body: { status: 'recebido' } }), 'Documento recebido');
    if (act === 'fee-paid') { const method = prompt('Forma de pagamento (Pix, transferência, dinheiro…):') ?? null; if (method === null) return; return call(() => api(`/api/contabil/fees/${id}`, { method: 'PATCH', body: { status: 'pago', method } }), 'Pago: entrou no Caixa Migra Contábil Paraguay'); }
    if (act === 'fee-cancel') { if (!confirm('Cancelar este honorário?')) return; return call(() => api(`/api/contabil/fees/${id}`, { method: 'PATCH', body: { status: 'cancelado' } })); }
    if (act === 'fee-reopen') return call(() => api(`/api/contabil/fees/${id}`, { method: 'PATCH', body: { status: 'aberto' } }));
    if (act === 'del-company' || act === 'del-doc') {
      const reason = prompt('Por que está apagando? (fica guardado no histórico)'); if (!reason) return;
      return call(() => api(`/api/contabil/${act === 'del-company' ? 'companies' : 'requests'}/${id}`, { method: 'DELETE', body: { reason } }), 'Apagado');
    }
  });
  sec.addEventListener('change', (e) => {
    if (e.target.id === 'ctMonth') { month = e.target.value || month; return load(); }
    if (e.target.id === 'ctStatus') { filter.status = e.target.value; return render(); }
    if (e.target.id === 'ctResp') { filter.resp = e.target.value; return render(); }
    if (e.target.classList.contains('ct-task-status')) { const id = e.target.closest('tr[data-id]').dataset.id; return call(() => api(`/api/contabil/tasks/${id}`, { method: 'PATCH', body: { status: e.target.value } })); }
  });
  let tm;
  sec.addEventListener('input', (e) => {
    if (e.target.id !== 'ctQ') return;
    filter.q = e.target.value; clearTimeout(tm);
    tm = setTimeout(() => { render(); const i = sec.querySelector('#ctQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250);
  });
  sec.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const fd = new FormData(f);
    const body = Object.fromEntries(fd);
    if (f.id === 'ctRuc') { const days = {}; for (let i = 0; i <= 9; i++) days[i] = Number(body[`d${i}`]); return call(() => api('/api/contabil-ruc-days', { method: 'PUT', body: { days } }), 'Dias salvos (valem para as próximas obrigações geradas)'); }
    if (f.id === 'ctDoc') return call(() => api('/api/contabil/requests', { method: 'POST', body }), 'Pedido registrado');
    const list = f.dataset.list;
    if (list === 'companies') { const obl = fd.getAll('obl'); delete body.obl; if (obl.length || editing?.id) body.obligationIds = obl; }
    if (list === 'obligations') { body.regimes = fd.getAll('reg'); delete body.reg; }
    return call(async () => { await api(editing?.id ? `/api/contabil/${list}/${editing.id}` : `/api/contabil/${list}`, { method: editing?.id ? 'PATCH' : 'POST', body }); editing = null; }, 'Salvo');
  });
})();
