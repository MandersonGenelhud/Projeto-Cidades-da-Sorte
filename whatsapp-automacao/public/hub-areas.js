// Abas novas: Financiamento de lotes, Migra Motors, Migra School e Auditoria.
// Usa os ajudantes de app.js ($, esc, api, toast, fmtDate, loaders).
(() => {
  const host = document.querySelector('#tab-lots')?.parentElement;
  if (!host) return;
  const isAdmin = () => window.currentUser?.role === 'admin';
  const isStaff = () => isAdmin() || window.currentUser?.manager;
  const money = (v, cur = 'R$') => `${cur} ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const CUR = { USD: 'US$', PYG: 'Gs.', BRL: 'R$' };
  const num = (v) => (v === '' || v === undefined ? undefined : Number(String(v).replace(/\./g, '').replace(',', '.')));
  const section = (id, html) => {
    const s = document.createElement('section');
    s.id = `tab-${id}`;
    s.className = 'tab';
    s.innerHTML = html;
    host.appendChild(s);
    return s;
  };
  const field = (label, name, attrs = '') => `<label>${label}<input name="${name}" ${attrs} /></label>`;

  // ================= FINANCIAMENTO DE LOTES =================
  const fin = section('finance', `
    <div class="page-head"><h1>Financiamento de lotes</h1></div>
    <p class="hint">Simule a entrada, as parcelas e os juros (quanto mais parcelas, maior o percentual), e gere a <b>proposta de reserva</b> em PDF. A proposta <b>só vale depois que a taxa de reserva for paga</b>.</p>
    <div class="panel" id="finCfgBox" hidden></div>
    <div class="panel"><h2>Simulador</h2>
      <form id="finForm" class="grid-form">
        <label>Loteamento<select name="devId"></select></label>
        <label>Lote<select name="lotId"></select></label>
        ${field('Entrada (vazio = mínima)', 'entry', 'inputmode="decimal"')}
        ${field('Entrada em quantas vezes', 'entryParts', 'type="number" min="1" value="1"')}
        ${field('Parcelas', 'installments', 'type="number" min="1" value="60"')}
        <div class="row"><button class="btn primary">Simular</button></div>
      </form>
      <div id="finResult"></div>
    </div>
    <div class="panel" id="finClientBox" hidden><h2>Dados do cliente para a reserva</h2>
      <form id="finClient" class="grid-form">
        ${field('Nome completo *', 'name')}${field('Documento (CI/CPF) *', 'doc')}${field('Telefone *', 'phone')}
        ${field('E-mail', 'email')}${field('Endereço *', 'address')}${field('Nacionalidade', 'nationality')}${field('Estado civil', 'civil')}
        <div class="row"><button class="btn primary">Gerar proposta de reserva</button></div>
      </form>
    </div>
    <div class="panel"><h2>Propostas</h2><div id="finReport" class="hint"></div><div class="table-wrap"><table id="finProps"></table></div></div>`);
  let finDevs = [];
  const finForm = fin.querySelector('#finForm');
  const fillLots = () => {
    const d = finDevs.find((x) => x.id === finForm.devId.value);
    finForm.lotId.innerHTML = (d?.lots || []).filter((l) => l.status === 'disponivel').map((l) => `<option value="${esc(l.id)}">${esc(l.code)} · ${l.area ? `${l.area} m² · ` : ''}${money(l.price, CUR[d.currency] || 'R$')}</option>`).join('') || '<option value="">Nenhum lote disponível</option>';
  };
  finForm.devId.addEventListener('change', fillLots);

  async function renderFinConfig() {
    const box = fin.querySelector('#finCfgBox');
    const { config: c, configured } = await api('/api/finance/config');
    box.hidden = false;
    const warn = configured ? '' : '<p class="err">Os juros ainda estão em 0%. O Marcos precisa definir as faixas abaixo antes de usar com clientes.</p>';
    if (!isAdmin()) {
      box.innerHTML = `${warn}<h2>Regras vigentes</h2><p class="hint">Entrada mínima ${c.minEntryPct}% · até ${c.maxInstallments} parcelas · ${c.bands.map((b) => `até ${b.upTo}x: ${b.interestPct}%`).join(' · ')}</p>`;
      return;
    }
    box.innerHTML = `${warn}<h2>Regras e juros (só o administrador altera, tudo fica na Auditoria)</h2>
      <form id="finCfg" class="grid-form">
        ${field('Entrada mínima (%)', 'minEntryPct', `value="${c.minEntryPct}"`)}${field('Taxa de reserva', 'reserveFee', `value="${c.reserveFee}"`)}
        ${field('Máximo de parcelas', 'maxInstallments', `type="number" value="${c.maxInstallments}"`)}${field('Entrada em até (vezes)', 'maxEntryParts', `type="number" value="${c.maxEntryParts}"`)}
        ${field('Validade da proposta (dias)', 'validDays', `type="number" value="${c.validDays}"`)}
      </form>
      <h3>Juros por número de parcelas (% sobre o saldo financiado)</h3>
      <div id="finBands">${c.bands.map((b) => `<div class="row band"><span>até</span><input class="bUp" type="number" min="1" value="${b.upTo}" style="width:90px" /><span>parcelas →</span><input class="bPct" value="${b.interestPct}" style="width:90px" /><span>% de juros</span><button type="button" class="btn small danger bDel"></button></div>`).join('')}</div>
      <div class="row"><button type="button" class="btn small" id="bAdd">Faixa</button><button type="button" class="btn primary" id="finCfgSave">Salvar regras</button></div>`;
    box.querySelector('#bAdd').onclick = () => box.querySelector('#finBands').insertAdjacentHTML('beforeend', '<div class="row band"><span>até</span><input class="bUp" type="number" min="1" style="width:90px" /><span>parcelas →</span><input class="bPct" value="0" style="width:90px" /><span>% de juros</span><button type="button" class="btn small danger bDel"></button></div>');
    box.querySelector('#finBands').onclick = (e) => { if (e.target.classList.contains('bDel')) e.target.closest('.band').remove(); };
    box.querySelector('#finCfgSave').onclick = async () => {
      const f = box.querySelector('#finCfg');
      const bands = [...box.querySelectorAll('.band')].map((r) => ({ upTo: r.querySelector('.bUp').value, interestPct: num(r.querySelector('.bPct').value) }));
      try {
        await api('/api/finance/config', { method: 'PUT', body: { minEntryPct: num(f.minEntryPct.value), reserveFee: num(f.reserveFee.value), maxInstallments: f.maxInstallments.value, maxEntryParts: f.maxEntryParts.value, validDays: f.validDays.value, bands } });
        toast('Regras salvas');
        renderFinConfig();
      } catch (e) { toast(e.message, true); }
    };
  }

  let lastSim = null;
  finForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const body = { devId: finForm.devId.value, lotId: finForm.lotId.value, entry: num(finForm.entry.value), entryParts: finForm.entryParts.value, installments: finForm.installments.value };
    try {
      const [{ sim, configured }, { options }] = await Promise.all([api('/api/finance/simulate', { method: 'POST', body }), api('/api/finance/options', { method: 'POST', body })]);
      lastSim = body;
      const cur = CUR[finDevs.find((x) => x.id === body.devId)?.currency] || 'R$';
      fin.querySelector('#finResult').innerHTML = `${configured ? '' : '<p class="err">Juros não definidos (0%).</p>'}
        <div class="cards"><div class="card"><b>${money(sim.entry, cur)}</b><span>entrada (${sim.entryPct}%)${sim.entryParts > 1 ? ` em ${sim.entryParts}x de ${money(sim.entryPart, cur)}` : ''}</span></div>
        <div class="card"><b>${sim.installments}x ${money(sim.installment, cur)}</b><span>juros ${sim.interestPct}% sobre ${money(sim.balance, cur)}</span></div>
        <div class="card"><b>${money(sim.total, cur)}</b><span>total a pagar</span></div></div>
        <h3>Outros prazos</h3><div class="table-wrap"><table><thead><tr><th>Parcelas</th><th>Juros</th><th>Valor da parcela</th><th>Total</th></tr></thead><tbody>${options.map((o) => `<tr><td>${o.installments}x</td><td>${o.interestPct}%</td><td><b>${money(o.installment, cur)}</b></td><td>${money(o.total, cur)}</td></tr>`).join('')}</tbody></table></div>`;
      fin.querySelector('#finClientBox').hidden = false;
    } catch (e) { toast(e.message, true); }
  });
  fin.querySelector('#finClient').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!lastSim) return toast('Faça a simulação primeiro', true);
    try {
      const p = await api('/api/finance/proposals', { method: 'POST', body: { ...lastSim, client: Object.fromEntries(new FormData(ev.target)) } });
      toast(`Proposta ${p.number} criada. Vale só depois da reserva paga.`);
      window.open(`/api/finance/proposals/${p.id}/pdf`, '_blank');
      loadProposals();
    } catch (e) { toast(e.message, true); }
  });
  const PST = { aberta: 'Aguardando reserva', reservada: 'Reserva paga', vencida: 'Vencida', cancelada: 'Cancelada' };
  async function loadProposals() {
    const list = await api('/api/finance/proposals');
    if (isStaff()) {
      const r = await api('/api/finance/report').catch(() => null);
      fin.querySelector('#finReport').textContent = r ? `${r.reservadas} reservada(s) · ${r.abertas} aguardando · valor reservado ${money(r.valorReservado)} · entradas ${money(r.entradas)}` : '';
    }
    fin.querySelector('#finProps').innerHTML = `<thead><tr><th>Nº</th><th>Cliente</th><th>Lote</th><th>Condição</th><th>Situação</th><th></th></tr></thead><tbody>${list.map((p) => `<tr data-id="${esc(p.id)}"><td><b>${esc(p.number)}</b></td><td>${esc(p.client.name)}<div class="hint">${esc(p.seller)}</div></td><td>${esc(p.devName)} · ${esc(p.lotCode)}</td><td>${money(p.sim.price)} · entrada ${money(p.sim.entry)} · ${p.sim.installments}x ${money(p.sim.installment)}</td><td>${PST[p.status] || p.status}<div class="hint">válida até ${esc(p.validUntil.split('-').reverse().join('/'))}</div></td>
      <td class="row"><a class="btn small" href="/api/finance/proposals/${esc(p.id)}/pdf" target="_blank" rel="noopener">PDF</a><button class="btn small" data-a="sched">Parcelas</button>${isStaff() && p.status === 'aberta' ? '<button class="btn small primary" data-a="paid">Reserva paga</button>' : ''}${isStaff() && ['aberta', 'reservada'].includes(p.status) ? '<button class="btn small danger" data-a="cancel">Cancelar</button>' : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nenhuma proposta ainda.</td></tr>'}</tbody>`;
  }
  fin.querySelector('#finProps').addEventListener('click', async (e) => {
    const a = e.target.dataset.a;
    if (!a) return;
    const id = e.target.closest('tr').dataset.id;
    try {
      if (a === 'paid' && confirm('Confirmar que a taxa de reserva foi paga? O lote ficará reservado.')) await api(`/api/finance/proposals/${id}/paid`, { method: 'POST' });
      else if (a === 'cancel' && confirm('Cancelar esta proposta? Se o lote estava reservado, ele volta a ficar disponível.')) await api(`/api/finance/proposals/${id}/cancel`, { method: 'POST' });
      else if (a === 'sched') {
        const rows = await api(`/api/finance/proposals/${id}/schedule`);
        const win = window.open('', '_blank');
        win.document.write(`<title>Relatório de parcelas</title><body style="font:14px sans-serif;padding:20px"><h2>Relatório de parcelas</h2><table border="1" cellpadding="6" style="border-collapse:collapse"><tr><th>Tipo</th><th>Nº</th><th>Vencimento</th><th>Valor</th><th>Saldo</th></tr>${rows.map((r) => `<tr><td>${r.kind}</td><td>${r.n}</td><td>${r.due.split('-').reverse().join('/')}</td><td>${money(r.amount)}</td><td>${r.balance === undefined ? '' : money(r.balance)}</td></tr>`).join('')}</table>`);
        win.document.close();
        return;
      }
      toast('Feito');
      loadProposals();
    } catch (err) { toast(err.message, true); }
  });
  loaders.finance = async () => {
    finDevs = await api('/api/realty/developments');
    finForm.devId.innerHTML = finDevs.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('');
    fillLots();
    await renderFinConfig();
    await loadProposals();
  };

  // ================= MIGRA MOTORS =================
  const mot = section('motors', `
    <div class="page-head"><h1>Migra Motors</h1></div>
    <p class="hint">Estoque de veículos e comparação de financiamento. As <b>taxas dos bancos/consórcios são cadastradas pelo Marcos</b> abaixo; o sistema só faz a conta com o que foi cadastrado (não inventa taxa).</p>
    <div class="panel"><h2>Comparar financiamento</h2>
      <form id="motCmp" class="grid-form"><label>Veículo<select name="vehicleId"></select></label>${field('Ou valor', 'price', 'inputmode="decimal"')}${field('Entrada', 'entry', 'inputmode="decimal"')}${field('Meses', 'months', 'type="number" value="48"')}<div class="row"><button class="btn primary">Comparar</button></div></form>
      <div id="motCmpOut"></div></div>
    <div class="panel"><div class="page-head"><h2>Veículos</h2><button class="btn primary" id="vNew" data-staff hidden>Novo veículo</button></div>
      <form id="vForm" class="grid-form" hidden>${field('Marca *', 'brand')}${field('Modelo *', 'model')}${field('Versão', 'version')}${field('Ano', 'year', 'type="number"')}${field('Km', 'km', 'type="number"')}${field('Preço', 'price', 'inputmode="decimal"')}
        <label>Moeda<select name="currency"><option value="USD">US$</option><option value="PYG">Gs.</option><option value="BRL">R$</option></select></label>${field('Combustível', 'fuel')}${field('Câmbio', 'transmission')}${field('Cor', 'color')}
        <label class="wide">Fotos (um link por linha)<textarea name="images" rows="2"></textarea></label><label><input type="checkbox" name="published" /> Publicar no site</label>
        <div class="row"><button class="btn primary">Salvar</button><button type="button" class="btn" id="vCancel">Cancelar</button></div></form>
      <div class="table-wrap"><table id="vTable"></table></div></div>
    <div class="panel"><div class="page-head"><h2>Bancos, financeiras e consórcios</h2><button class="btn primary" id="lNew" data-staff hidden>Nova instituição</button></div>
      <form id="lForm" class="grid-form" hidden>${field('Nome *', 'name')}<label>Tipo<select name="type"><option value="banco">Banco</option><option value="financeira">Financeira</option><option value="consorcio">Consórcio</option><option value="proprio">Financiamento próprio</option></select></label>
        ${field('Juros ao mês (%)', 'ratePctMonth', 'inputmode="decimal"')}${field('Taxa de administração total (% consórcio)', 'adminFeePct', 'inputmode="decimal"')}${field('Entrada mínima (%)', 'minEntryPct', 'inputmode="decimal"')}${field('Prazo máximo (meses)', 'maxMonths', 'type="number" value="60"')}${field('Idade máx. do veículo (anos, 0 = sem limite)', 'maxVehicleAgeYears', 'type="number" value="0"')}
        <label class="wide">Exigências / observações<textarea name="requirements" rows="2"></textarea></label><div class="row"><button class="btn primary">Salvar</button><button type="button" class="btn" id="lCancel">Cancelar</button></div></form>
      <div class="table-wrap"><table id="lTable"></table></div></div>`);
  let vehicles = []; let lenders = []; let vEdit = null; let lEdit = null;
  const vForm = mot.querySelector('#vForm'); const lForm = mot.querySelector('#lForm');
  const fillForm = (f, obj, keys) => { f.reset(); keys.forEach((k) => { if (f[k]) f[k].value = obj?.[k] ?? ''; }); };
  async function loadMotors() {
    [vehicles, lenders] = await Promise.all([api('/api/motors/vehicles'), api('/api/motors/lenders')]);
    mot.querySelector('#motCmp [name=vehicleId]').innerHTML = `<option value="">— digitar o valor —</option>${vehicles.filter((v) => v.status !== 'vendido').map((v) => `<option value="${esc(v.id)}">${esc(v.title)} · ${money(v.price, CUR[v.currency])}</option>`).join('')}`;
    mot.querySelector('#vTable').innerHTML = `<thead><tr><th>Veículo</th><th>Km</th><th>Preço</th><th>Situação</th><th></th></tr></thead><tbody>${vehicles.map((v) => `<tr data-id="${esc(v.id)}"><td><b>${esc(v.title)}</b>${v.published ? ' <span class="chip small">no site</span>' : ''}</td><td>${(v.km || 0).toLocaleString('pt-BR')}</td><td>${money(v.price, CUR[v.currency])}</td>
      <td><select data-a="vstatus" ${isStaff() ? '' : 'disabled'}>${['disponivel', 'reservado', 'vendido'].map((s) => `<option value="${s}" ${v.status === s ? 'selected' : ''}>${{ disponivel: 'Disponível', reservado: 'Reservado', vendido: 'Vendido' }[s]}</option>`).join('')}</select></td>
      <td class="row">${isStaff() ? '<button class="btn small" data-a="vedit">Editar</button>' : ''}${isAdmin() ? '<button class="btn small danger" data-a="vdel">Excluir</button>' : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nenhum veículo.</td></tr>'}</tbody>`;
    mot.querySelector('#lTable').innerHTML = `<thead><tr><th>Instituição</th><th>Tipo</th><th>Juros/mês</th><th>Taxa adm.</th><th>Entrada mín.</th><th>Prazo</th><th></th></tr></thead><tbody>${lenders.map((l) => `<tr data-id="${esc(l.id)}"><td><b>${esc(l.name)}</b>${l.active === false ? ' <span class="chip small">desligada</span>' : ''}<div class="hint">${esc(l.requirements || '')}</div></td><td>${esc({ banco: 'Banco', financeira: 'Financeira', consorcio: 'Consórcio', proprio: 'Próprio' }[l.type])}</td><td>${l.ratePctMonth ?? 0}%</td><td>${l.adminFeePct ?? 0}%</td><td>${l.minEntryPct ?? 0}%</td><td>${l.maxMonths}m</td>
      <td class="row">${isStaff() ? '<button class="btn small" data-a="ledit">Editar</button><button class="btn small" data-a="ltoggle">Ligar/desligar</button>' : ''}${isAdmin() ? '<button class="btn small danger" data-a="ldel">Excluir</button>' : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Cadastre os bancos e consórcios com as taxas reais.</td></tr>'}</tbody>`;
  }
  mot.querySelector('#vNew')?.addEventListener('click', () => { vEdit = null; fillForm(vForm, { currency: 'USD' }, ['currency']); vForm.hidden = false; });
  mot.querySelector('#lNew')?.addEventListener('click', () => { lEdit = null; fillForm(lForm, { type: 'banco', maxMonths: 60 }, ['type', 'maxMonths']); lForm.hidden = false; });
  mot.querySelector('#vCancel').onclick = () => (vForm.hidden = true);
  mot.querySelector('#lCancel').onclick = () => (lForm.hidden = true);
  vForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(vForm)); b.price = num(b.price); b.published = vForm.published.checked;
    try { await api(vEdit ? `/api/motors/vehicles/${vEdit}` : '/api/motors/vehicles', { method: vEdit ? 'PATCH' : 'POST', body: b }); vForm.hidden = true; toast('Salvo'); loadMotors(); } catch (err) { toast(err.message, true); }
  });
  lForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(lForm));
    for (const k of ['ratePctMonth', 'adminFeePct', 'minEntryPct']) b[k] = num(b[k]);
    try { await api(lEdit ? `/api/motors/lenders/${lEdit}` : '/api/motors/lenders', { method: lEdit ? 'PATCH' : 'POST', body: b }); lForm.hidden = true; toast('Salvo'); loadMotors(); } catch (err) { toast(err.message, true); }
  });
  mot.addEventListener('click', async (e) => {
    const a = e.target.dataset.a; const id = e.target.closest('tr')?.dataset.id;
    if (!a || !id) return;
    try {
      if (a === 'vedit') { const v = vehicles.find((x) => x.id === id); vEdit = id; fillForm(vForm, { ...v, images: (v.images || []).join('\n') }, ['brand', 'model', 'version', 'year', 'km', 'price', 'currency', 'fuel', 'transmission', 'color', 'images']); vForm.published.checked = Boolean(v.published); vForm.hidden = false; vForm.scrollIntoView(); }
      else if (a === 'vdel' && confirm('Excluir este veículo? Fica registrado na Auditoria.')) { await api(`/api/motors/vehicles/${id}`, { method: 'DELETE' }); loadMotors(); }
      else if (a === 'ledit') { lEdit = id; fillForm(lForm, lenders.find((x) => x.id === id), ['name', 'type', 'ratePctMonth', 'adminFeePct', 'minEntryPct', 'maxMonths', 'maxVehicleAgeYears', 'requirements']); lForm.hidden = false; lForm.scrollIntoView(); }
      else if (a === 'ltoggle') { const l = lenders.find((x) => x.id === id); await api(`/api/motors/lenders/${id}`, { method: 'PATCH', body: { active: l.active === false } }); loadMotors(); }
      else if (a === 'ldel' && confirm('Excluir esta instituição? Fica registrado na Auditoria.')) { await api(`/api/motors/lenders/${id}`, { method: 'DELETE' }); loadMotors(); }
    } catch (err) { toast(err.message, true); }
  });
  mot.addEventListener('change', async (e) => {
    if (e.target.dataset.a !== 'vstatus') return;
    try { await api(`/api/motors/vehicles/${e.target.closest('tr').dataset.id}`, { method: 'PATCH', body: { status: e.target.value } }); toast('Situação atualizada'); } catch (err) { toast(err.message, true); }
  });
  mot.querySelector('#motCmp').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      const r = await api('/api/motors/compare', { method: 'POST', body: { vehicleId: f.vehicleId.value || undefined, price: num(f.price.value), entry: num(f.entry.value), months: f.months.value } });
      mot.querySelector('#motCmpOut').innerHTML = `${r.configured ? '' : '<p class="err">Nenhuma taxa cadastrada ainda: os valores abaixo estão sem juros.</p>'}<div class="table-wrap"><table><thead><tr><th>Instituição</th><th>Entrada</th><th>Parcela</th><th>Custo dos juros/taxas</th><th>Total</th></tr></thead><tbody>${r.results.map((x) => `<tr><td><b>${esc(x.lender)}</b><div class="hint">${esc(x.note)}</div></td><td>${money(x.entry)}</td><td><b>${x.months}x ${money(x.installment)}</b></td><td>${money(x.cost)}</td><td>${money(x.total)}</td></tr>`).join('')}</tbody></table></div>${r.skipped.length ? `<p class="hint">Não atendem: ${r.skipped.map((s) => esc(s.reason)).join(' · ')}</p>` : ''}`;
    } catch (err) { toast(err.message, true); }
  });
  loaders.motors = loadMotors;

  // ================= MIGRA SCHOOL =================
  const sch = section('school', `
    <div class="page-head"><h1>Migra School</h1><button class="btn primary" id="sNew">Novo aluno</button></div>
    <div id="sSummary" class="cards"></div>
    <form id="sForm" class="panel grid-form" hidden>${field('Nome *', 'name')}${field('WhatsApp', 'phone')}${field('E-mail', 'email')}${field('Idioma', 'language', 'value="Espanhol"')}${field('Professor(a)', 'teacher')}
      <label>Nível<select name="level">${['Iniciante', 'Básico', 'Intermediário', 'Avançado', 'Fluente'].map((x) => `<option>${x}</option>`).join('')}</select></label><div class="row"><button class="btn primary">Salvar</button><button type="button" class="btn" id="sCancel">Cancelar</button></div></form>
    <div class="panel"><div class="row"><select id="sFilter"><option value="">Todos</option><option value="matriculado">Matriculados</option><option value="ativo">Estudando</option><option value="trancado">Trancados</option><option value="concluido">Concluídos</option><option value="desistente">Desistentes</option></select><label><input type="checkbox" id="sRisk" /> só quem sumiu há 14+ dias</label></div>
      <div class="table-wrap"><table id="sTable"></table></div></div>`);
  const ST = { matriculado: 'Matriculado', ativo: 'Estudando', trancado: 'Trancado', concluido: 'Concluído', desistente: 'Desistente' };
  const LV = ['Iniciante', 'Básico', 'Intermediário', 'Avançado', 'Fluente'];
  async function loadSchool() {
    const q = new URLSearchParams();
    if (sch.querySelector('#sFilter').value) q.set('stage', sch.querySelector('#sFilter').value);
    if (sch.querySelector('#sRisk').checked) q.set('inactiveDays', '14');
    const [sum, list] = await Promise.all([api('/api/school/summary'), api(`/api/school/students?${q}`)]);
    sch.querySelector('#sSummary').innerHTML = `<div class="card"><b>${sum.total}</b><span>alunos cadastrados</span></div><div class="card"><b>${sum.studying}</b><span>estudando agora</span></div><div class="card"><b>${sum.avgPerWeek}</b><span>acessos por semana (média)</span></div><div class="card"><b>${sum.atRisk}</b><span>sumidos há 14+ dias</span></div>`;
    sch.querySelector('#sTable').innerHTML = `<thead><tr><th>Aluno</th><th>Idioma / nível</th><th>Etapa</th><th>Frequência</th><th>Último acesso</th><th></th></tr></thead><tbody>${list.map((s) => `<tr data-id="${esc(s.id)}"><td><b>${esc(s.name)}</b><div class="hint">${esc(s.phone || '')}</div></td><td>${esc(s.language)}<br><select data-a="level">${LV.map((l) => `<option ${s.level === l ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
      <td><select data-a="stage">${Object.entries(ST).map(([k, v]) => `<option value="${k}" ${s.stage === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td><td>${s.perWeek}/semana<div class="hint">${s.accessCount} acesso(s) no total</div></td><td>${s.daysAway === null ? 'nunca acessou' : s.daysAway === 0 ? 'hoje' : `há ${s.daysAway} dia(s)`}</td>
      <td class="row"><button class="btn small" data-a="access">+ Aula/acesso hoje</button>${isAdmin() ? '<button class="btn small danger" data-a="del">Excluir</button>' : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nenhum aluno.</td></tr>'}</tbody>`;
  }
  sch.querySelector('#sNew').onclick = () => { sch.querySelector('#sForm').reset(); sch.querySelector('#sForm').hidden = false; };
  sch.querySelector('#sCancel').onclick = () => (sch.querySelector('#sForm').hidden = true);
  sch.querySelector('#sFilter').onchange = loadSchool;
  sch.querySelector('#sRisk').onchange = loadSchool;
  sch.querySelector('#sForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/school/students', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); e.target.hidden = true; toast('Aluno cadastrado'); loadSchool(); } catch (err) { toast(err.message, true); }
  });
  sch.addEventListener('change', async (e) => {
    const a = e.target.dataset.a;
    if (a !== 'stage' && a !== 'level') return;
    try { await api(`/api/school/students/${e.target.closest('tr').dataset.id}`, { method: 'PATCH', body: { [a]: e.target.value } }); toast('Atualizado'); loadSchool(); } catch (err) { toast(err.message, true); }
  });
  sch.addEventListener('click', async (e) => {
    const a = e.target.dataset.a; const id = e.target.closest('tr')?.dataset.id;
    if (!id || (a !== 'access' && a !== 'del')) return;
    try {
      if (a === 'access') await api(`/api/school/students/${id}/access`, { method: 'POST' });
      else if (confirm('Excluir este aluno? Fica registrado na Auditoria.')) await api(`/api/school/students/${id}`, { method: 'DELETE' });
      loadSchool();
    } catch (err) { toast(err.message, true); }
  });
  loaders.school = loadSchool;

  // ================= AUDITORIA =================
  const aud = section('audit', `
    <div class="page-head"><h1>Auditoria: quem mexeu em quê</h1></div>
    <p class="hint">Todo cadastro, alteração e exclusão de lotes, preços, juros, veículos, alunos, propostas e perfis de equipe fica aqui, com quem fez, quando e o valor <b>antes e depois</b>. Ninguém consegue apagar este registro pelo painel.</p>
    <div class="panel"><div class="row"><select id="aUser"><option value="">Todas as pessoas</option></select><select id="aAction"><option value="">Tudo</option><option value="criou">Criou</option><option value="alterou">Alterou</option><option value="excluiu">Excluiu</option></select>
      <label><input type="checkbox" id="aSens" /> só dinheiro, juros e exclusões</label><select id="aEntity"><option value="">Todos os tipos</option></select><input id="aQ" placeholder="Buscar (lote, nome, valor…)" /> <button class="btn small" id="aCsv" type="button">Baixar planilha</button></div>
      <div class="table-wrap"><table id="aTable"></table></div></div>`);
  async function loadAudit() {
    const q = new URLSearchParams();
    const u = aud.querySelector('#aUser').value; if (u) q.set('user', u);
    const ac = aud.querySelector('#aAction').value; if (ac) q.set('action', ac);
    if (aud.querySelector('#aSens').checked) q.set('sensitive', '1');
    const en = aud.querySelector('#aEntity').value; if (en) q.set('entity', en);
    const t = aud.querySelector('#aQ').value.trim(); if (t) q.set('q', t);
    const { items, users, entities } = await api(`/api/audit?${q}`);
    const es = aud.querySelector('#aEntity'); const ek = es.value;
    es.innerHTML = `<option value="">Todos os tipos</option>${(entities || []).map((n) => `<option ${n === ek ? 'selected' : ''}>${esc(n)}</option>`).join('')}`;
    const sel = aud.querySelector('#aUser'); const keep = sel.value;
    sel.innerHTML = `<option value="">Todas as pessoas</option>${users.map((n) => `<option ${n === keep ? 'selected' : ''}>${esc(n)}</option>`).join('')}`;
    aud.querySelector('#aTable').innerHTML = `<thead><tr><th>Quando</th><th>Quem</th><th>O quê</th><th>Mudanças</th></tr></thead><tbody>${items.map((e) => `<tr${e.sensitive ? ' style="background:rgba(212,175,55,.12)"' : ''}><td>${fmtDate(e.at)}</td><td><b>${esc(e.user)}</b><div class="hint">${esc(e.role || '')} ${esc(e.ip || '')}</div></td><td>${{ criou: '🆕 criou', alterou: 'alterou', excluiu: 'excluiu' }[e.action] || esc(e.action)} ${esc(e.entity)}<div><b>${esc(e.label)}</b></div></td>
      <td>${e.changes.map((c) => `<div>${esc(c.label)}: <s>${esc(c.from || '—')}</s> → <b>${esc(c.to || '—')}</b></div>`).join('') || esc(e.note || '')}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nada registrado ainda.</td></tr>'}</tbody>`;
  }
  for (const id of ['#aUser', '#aAction', '#aSens', '#aEntity']) aud.querySelector(id).onchange = loadAudit;
  aud.querySelector('#aCsv').onclick = () => {
    const q = new URLSearchParams();
    for (const [k, id] of [['user', '#aUser'], ['action', '#aAction'], ['entity', '#aEntity']]) { const v = aud.querySelector(id).value; if (v) q.set(k, v); }
    if (aud.querySelector('#aSens').checked) q.set('sensitive', '1');
    const t = aud.querySelector('#aQ').value.trim(); if (t) q.set('q', t);
    location.href = `/api/audit.csv?${q}`;
  };
  aud.querySelector('#aQ').addEventListener('input', () => { clearTimeout(loadAudit.t); loadAudit.t = setTimeout(loadAudit, 300); });
  loaders.audit = loadAudit;
})();
