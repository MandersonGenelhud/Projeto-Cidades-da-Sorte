// Conversas: recomeçar todos os atendimentos parados dos últimos dias (todos os números). A IA lê as últimas mensagens, confere se é assunto da
// Migra e retoma de onde parou, número por número, no ritmo seguro de cada um. Só administrador.
(() => {
  const tab = document.querySelector('#tab-conversations');
  const anchor = tab?.querySelector('#pendingPanel');
  if (!tab || !anchor) return;
  const box = document.createElement('div');
  box.className = 'panel';
  box.id = 'restartPanel';
  box.hidden = true;
  box.innerHTML = `<h2>Recomeçar atendimentos parados</h2>
    <div class="panel" id="oneBox">
      <h3>Um por um</h3>
      <p class="hint">Veja cada atendimento parado e retome só os que você escolher. Clique no nome para abrir a conversa. Quem já é cliente, recusou ou já foi atendido por uma pessoa da equipe não aparece aqui.</p>
      <div class="row"><label>Últimos <select id="oneDays"><option value="7">7 dias</option><option value="15">15 dias</option><option value="30" selected>30 dias</option><option value="60">60 dias</option></select></label>
        <label>Número <select id="oneNum"><option value="">Todos</option></select></label>
        <label>Situação <select id="oneKind"><option value="">Todas</option><option value="esperando">Esperando resposta</option><option value="silenciou">Parou de responder</option><option value="reagendado">Retorno marcado</option></select></label>
        <button class="btn primary" id="oneLoad" type="button">Ver a lista</button></div>
      <div id="oneOut"></div>
    </div>
    <details id="bulkBox"><summary><b>Retomar vários de uma vez</b> (passo a passo antigo)</summary>
    <div class="panel" id="stepsBox">
      <h3>Passo a passo (comece por aqui)</h3>
      <ol class="hint">
        <li><b>Ver o plano</b>: o sistema separa todas as conversas dos últimos dias em: já são clientes (banco de dados ou pagamento/contrato nas últimas 20 mensagens), recusaram, já atendidas pelo Marcos ou pessoais, com atendente humano, e <b>a retomar</b>.</li>
        <li><b>Começar o atendimento</b>: lê as conversas antigas, marca quem recusou e chama de volta <u>somente</u> quem ficou sem continuidade e fala de serviço da Migra, no ritmo seguro de cada número. Também avisa os orçamentos que estão vencendo. Quem já é cliente nunca é chamado.</li>
        <li>Acompanhe em <b>Clientes esperando resposta</b> (logo abaixo). Para parar tudo de iniciativa nossa, use <b>Pausar</b>; para voltar, <b>Continuar</b>. Cliente novo que escrever continua sendo atendido normalmente.</li>
      </ol>
      <div class="row"><button class="btn" id="stPlan" type="button">1. Ver o plano</button> <button class="btn primary" id="stStart" type="button">2. Começar o atendimento</button> <button class="btn danger" id="stPause" type="button">Pausar</button></div>
      <p id="stState" class="hint"></p><div id="stPlanOut" class="muted"></div>
    </div>
    <p class="hint">Procura nos últimos dias, em todos os números e no Instagram, quem ficou sem continuidade: cliente esperando resposta, cliente que parou de responder, retorno combinado que chegou e conversa pausada. A IA lê as últimas 20 mensagens, só retoma o que é assunto de algum serviço da Migra e escreve de onde parou. Cada número responde no seu ritmo (limite por hora de cada um), das 7h às 23h. Quem já fechou ou foi dado como perdido não é incomodado.</p>
    <div class="row"><label>Últimos <select id="rsDays"><option value="15">15 dias</option><option value="30" selected>30 dias</option><option value="45">45 dias</option><option value="60">60 dias</option></select></label>
      <label class="check"><input type="checkbox" id="rsSilent" checked /> Incluir quem parou de responder e retornos combinados</label>
      <button class="btn" id="rsCount">Ver quantos são</button> <button class="btn primary" id="rsGo">Recomeçar agora</button></div>
    <div id="rsOut" class="muted"></div>
    </details>
    <h3>Quem já fechou com outro ou não quer mais</h3>
    <p class="hint">O sistema lê o que o cliente disse (por exemplo "já fechei com um amigo", "não tenho mais interesse", "não me chame mais") e para de procurar essa pessoa: o prospecto vai para perdido com o motivo. Quem já fechou conosco (contrato assinado, venda, Pix pago ou cliente ganho no banco de dados) também não recebe mais chamada de iniciativa nossa. Este botão lê todas as conversas antigas de uma vez.</p>
    <div class="row"><button class="btn" id="dcCount" type="button">Ver quantas conversas</button> <button class="btn primary" id="dcGo" type="button">Marcar quem já recusou</button></div><div id="dcOut" class="muted"></div>
    <h3>Por que a atendente parou?</h3>
    <p class="hint">Mostra, para cada cliente que escreveu e ainda não foi respondido, o motivo: conversa pausada (e por quê), IA que falhou, fila do número, fora do horário ou sem motivo conhecido.</p>
    <div class="row"><button class="btn" id="stGo" type="button">Ver por que pararam</button></div><div id="stOut" class="muted"></div>
    <h3>Chamar de volta quem sumiu</h3>
    <p class="hint">Cliente que parou de responder recebe, sozinho, uma mensagem de gente: "você ainda está por aí? você realmente tem interesse?", explicando a fila de espera. Se passar 24 horas sem resposta, o sistema avisa com gentileza que vai encerrar o atendimento e o cliente volta para o final da fila (a atendente chama de novo em 30 dias). Se ele responder a qualquer momento, o atendimento segue normal. Cada aviso sai uma vez só, no horário de trabalho, no ritmo seguro de cada número.</p>
    <div class="row"><label class="check"><input type="checkbox" id="slOn" checked /> Ligado</label> <label>Chamar depois de <input type="number" id="slHours" min="1" max="72" value="4" style="width:70px" /> h sem resposta</label>
      <button class="btn small" id="slSave" type="button">Salvar</button> <button class="btn" id="slCount" type="button">Ver quantos são</button> <button class="btn primary" id="slGo" type="button">Chamar agora</button></div><div id="slOut" class="muted"></div>
    <details id="rsTpl"><summary><b>Mensagem de retorno automática</b> (a primeira mensagem para quem esperou)</summary>
      <p class="hint">Vai sozinha, antes da IA, para quem esperou o atendimento (ou que entrou no "recomeçar"), no número por onde o cliente falou. Texto fixo, sem pedir desculpas. Use {saudacao} (bom dia, boa tarde, boa noite), {nome} e {data} (o dia que tinha sido combinado). Vazio = texto padrão.</p>
      <label class="check"><input type="checkbox" id="rsOn" checked /> Enviar a mensagem de retorno</label>
      <label>Enviar para quem esperou há mais de (horas) <input type="number" id="rsHours" min="0" max="72" value="6" /></label>
      <label>Quando havia um dia combinado <textarea id="rsT1" rows="4" maxlength="800" placeholder="Padrão: Bom dia, Fulano! Agradecemos muito por aguardar... Ficou combinado de falarmos no dia {data}..."></textarea></label>
      <label>Quando NÃO havia dia combinado <textarea id="rsT2" rows="4" maxlength="800" placeholder="Padrão: Bom dia, Fulano! Agradecemos muito por aguardar... o seu retorno acabou ficando pendente..."></textarea></label>
      <button class="btn small primary" id="rsSave">Salvar mensagem</button></details>`;
  anchor.insertAdjacentElement('beforebegin', box);
  const txt = (r) => `${r.total} atendimento(s) parados: ${r.esperando} esperando resposta, ${r.silenciou} em que o cliente parou de responder, ${r.reagendado} com retorno marcado${r.pausadasDono + r.pausadasMarcos ? `; ${r.pausadasDono + r.pausadasMarcos} conversa(s) pausadas serão destravadas` : ''}.${r.dryRun ? '' : ` ${r.queued} entraram na fila da IA${r.blocked ? ` (${r.blocked} ficaram de fora: número desconectado, modo de teste ou Instagram fora das 24 h)` : ''}.`}`;
  const run = async (dryRun) => {
    const r = await api('/api/restart-stalled', { method: 'POST', body: { days: Number($('#rsDays').value), includeSilent: $('#rsSilent').checked, dryRun } });
    $('#rsOut').textContent = txt(r);
    if (!dryRun) { toast('Atendimentos recomeçados'); if (typeof loaders !== 'undefined') loaders.conversations?.(); }
  };
  const planTxt = (p) => `Nos últimos ${p.days} dias: ${p.total} conversas. <b>${p.retomar} a retomar</b>${p.retomarPorCondicao ? ` (${p.retomarPorCondicao.sim} com condições de fechar, ${p.retomarPorCondicao.parcial} em parte, ${p.retomarPorCondicao.nao} sem condições agora, ${p.retomarPorCondicao.desconhecida} ainda não sabemos)` : ''} · ${p.fechados} já são clientes (não serão chamados) · ${p.recusaram} recusaram (não serão chamados) · ${p.marcos} já atendidas pelo Marcos/equipe ou pessoais (não serão chamadas) · ${p.comHumano} com atendente humano · ${p.emDia} em dia${p.bloqueados ? ` · ${p.bloqueados} bloqueados` : ''}.`;
  const showState = (paused) => {
    $('#stState').innerHTML = paused ? '<b>Situação: PAUSADO.</b> Nenhuma mensagem de iniciativa nossa sai. Cliente que escreve continua sendo atendido.' : '<b>Situação: liberado.</b> As chamadas de iniciativa nossa saem no ritmo seguro de cada número.';
    $('#stPause').textContent = paused ? 'Continuar' : 'Pausar';
    $('#stPause').className = paused ? 'btn primary' : 'btn danger';
    $('#stStart').disabled = paused;
    box.dataset.paused = paused ? '1' : '';
  };
  const loadPlan = async () => { const p = await api('/api/atendimento/plano'); $('#stPlanOut').innerHTML = planTxt(p); showState(p.paused); return p; };
  const loadTpl = async () => {
    const o = (await api('/api/settings')).agent?.backlogOpening || {};
    $('#rsOn').checked = o.enabled !== false; $('#rsHours').value = o.minHours ?? 6; $('#rsT1').value = o.template || ''; $('#rsT2').value = o.templateNoDate || '';
  };
  $('#rsTpl').addEventListener('toggle', (e) => { if (e.target.open) loadTpl().catch(() => {}); });
  // ---- Um por um ----
  const KIND = { esperando: 'Esperando resposta', silenciou: 'Parou de responder', reagendado: 'Retorno marcado' };
  let oneRows = [];
  const fmtAt = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
  const renderOne = () => {
    const num = $('#oneNum').value; const kind = $('#oneKind').value;
    const list = oneRows.filter((r) => (!num || r.numero === num) && (!kind || r.tipo === kind));
    $('#oneOut').innerHTML = `<p class="hint">${list.length} atendimento(s) parado(s)${list.length !== oneRows.length ? ` (de ${oneRows.length})` : ''}.</p>` + (list.map((r) => `<div class="item" data-k="${esc(r.key)}"><div class="grow">
        <a href="#" data-open="${esc(r.key)}"><b>${esc(r.nome || (r.phone ? `+${r.phone}` : r.username ? `@${r.username}` : 'Cliente'))}</b></a>
        <span class="badge">${esc(r.numero)}</span> <span class="badge ${r.tipo === 'esperando' ? 'pending' : ''}">${esc(KIND[r.tipo] || r.tipo)}</span>${r.pausada ? ' <span class="badge">pausada</span>' : ''}${r.naFila ? ' <span class="badge running">na fila da IA</span>' : ''}${r.bloqueio ? ` <span class="badge canceled">${esc(r.bloqueio)}</span>` : ''}${r.conectado ? '' : ' <span class="badge canceled">número desconectado</span>'}
        <div class="meta">${esc(fmtAt(r.ultimaAt || r.lastAt))}${r.ultima ? ` · "${esc(r.ultima)}"` : ''}${r.motivo ? ` · retorno combinado: ${esc(r.motivo)}` : ''}</div></div>
        <button class="btn small primary" data-retomar="${esc(r.key)}" ${r.naFila || r.bloqueio || !r.conectado ? 'disabled' : ''}>${r.naFila ? 'Na fila' : 'Retomar'}</button></div>`).join('') || '<p class="muted">Nenhum atendimento parado com esses filtros.</p>');
  };
  const loadOne = async () => {
    const r = await api(`/api/atendimento/lista?days=${$('#oneDays').value}`);
    oneRows = r.rows;
    const nums = [...new Set(oneRows.map((x) => x.numero))].sort();
    const cur = $('#oneNum').value;
    $('#oneNum').innerHTML = `<option value="">Todos</option>${nums.map((n) => `<option ${n === cur ? 'selected' : ''}>${esc(n)}</option>`).join('')}`;
    renderOne();
  };
  box.addEventListener('change', (e) => { if (e.target.id === 'oneNum' || e.target.id === 'oneKind') renderOne(); if (e.target.id === 'oneDays') loadOne().catch((err) => toast(err.message, true)); });
  box.addEventListener('click', async (e) => {
    const op = e.target.closest('[data-open]');
    if (op) { e.preventDefault(); try { await openConversation(op.dataset.open); document.querySelector('#convHeader')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (err) { toast(err.message, true); } return; }
    const rb = e.target.closest('[data-retomar]');
    if (rb) {
      rb.disabled = true;
      try {
        await api('/api/atendimento/retomar-um', { method: 'POST', body: { key: rb.dataset.retomar, days: Number($('#oneDays').value) } });
        const row = oneRows.find((x) => x.key === rb.dataset.retomar); if (row) row.naFila = true;
        toast('Entrou na fila da IA: ela retoma este atendimento no ritmo seguro do número.');
        renderOne();
      } catch (err) { toast(err.message, true); rb.disabled = false; }
      return;
    }
    if (e.target.id === 'oneLoad') { try { await loadOne(); } catch (err) { toast(err.message, true); } }
  });
  box.addEventListener('click', async (e) => {
    const id = e.target.id;
    if (id === 'stPlan') { try { await loadPlan(); } catch (err) { toast(err.message, true); } return; }
    if (id === 'stPause') {
      try {
        const paused = box.dataset.paused !== '1';
        if (paused && !confirm('Pausar? Nenhuma mensagem de iniciativa nossa vai sair e a fila de chamadas será esvaziada. Quem escrever continua sendo atendido.')) return;
        const r = await api('/api/atendimento/pausa', { method: 'POST', body: { paused } });
        showState(r.paused); toast(r.paused ? 'Atendimento de iniciativa nossa pausado' : 'Atendimento liberado'); if (typeof loaders !== 'undefined') loaders.conversations?.();
      } catch (err) { toast(err.message, true); }
      return;
    }
    if (id === 'stStart') {
      try {
        const p = await loadPlan();
        if (!confirm(`Começar agora? Serão chamados ${p.retomar} atendimentos parados. NÃO serão chamados: ${p.fechados} que já são clientes e ${p.recusaram} que recusaram. Cada número sai no seu ritmo seguro.`)) return;
        const r = await api('/api/atendimento/comecar', { method: 'POST', body: {} });
        $('#stPlanOut').innerHTML = `${planTxt(r.plano)}<br><b>Feito:</b> ${r.recusasMarcadas} recusas marcadas · ${r.retomada.queued} entraram na fila da IA · ${r.orcamentos.queued} avisos de orçamento vencendo.`;
        toast('Atendimento começado'); if (typeof loaders !== 'undefined') loaders.conversations?.();
      } catch (err) { toast(err.message, true); }
      return;
    }
    if (id === 'rsSave') {
      try { await api('/api/settings', { method: 'PUT', body: { agent: { backlogOpening: { enabled: $('#rsOn').checked, minHours: Math.max(0, Number($('#rsHours').value) || 0), template: $('#rsT1').value.trim(), templateNoDate: $('#rsT2').value.trim() } } } }); toast('Mensagem de retorno salva'); } catch (err) { toast(err.message, true); }
      return;
    }
    if (id === 'dcCount' || id === 'dcGo') {
      try {
        if (id === 'dcGo' && !confirm('Ler todas as conversas antigas e marcar quem já fechou com outro ou não quer mais? Os prospectos dessas pessoas vão para "perdido" e elas não recebem mais chamadas nossas.')) return;
        const r = id === 'dcCount' ? await api('/api/declined') : await api('/api/declined/scan', { method: 'POST', body: {} });
        const K = { fechou_outro: 'fecharam com outro', sem_interesse: 'sem interesse', nao_chamar: 'pediram para não ser chamados', fechou_conosco: 'dizem que já fecharam conosco' };
        $('#dcOut').textContent = `${r.checked} conversas lidas: ${r.found} de quem já recusou (${Object.entries(r.byKind).map(([k, n]) => `${n} ${K[k] || k}`).join(', ') || 'nenhuma'})${id === 'dcGo' ? `. ${r.marked} marcadas agora.` : '.'}`;
      } catch (err) { toast(err.message, true); }
      return;
    }
    if (id === 'stGo') {
      try {
        const r = await api('/api/ai-stalls?hours=72');
        const NOME = { pausada: 'conversa pausada', ia_falhou: 'a IA falhou', na_fila: 'na fila do número', fora_horario: 'fora do horário', pendente: 'esperando entrar na fila', sem_motivo: 'sem motivo conhecido', bloqueado: 'bloqueado', ia_desligada: 'IA desligada' };
        $('#stOut').innerHTML = r.total ? `${r.total} cliente(s) esperando resposta: ${Object.entries(r.porMotivo).map(([k, n]) => `${esc(NOME[k] || k)}: ${n}`).join(' · ')}<ul>${r.rows.slice(0, 25).map((x) => `<li><b>${esc(x.name || x.phone)}</b> · ${x.waitingHours} h · ${esc(x.motivo)}<br><span class="hint">"${esc(x.last)}"</span></li>`).join('')}</ul>` : 'Nenhum cliente esperando resposta nos últimos 3 dias.';
      } catch (err) { toast(err.message, true); }
      return;
    }
    if (id === 'slSave') { try { await api('/api/settings', { method: 'PUT', body: { agent: { silence: { enabled: $('#slOn').checked, nudgeHours: Math.max(1, Math.min(72, Number($('#slHours').value) || 4)) } } } }); toast('Salvo'); } catch (err) { toast(err.message, true); } return; }
    if (id === 'slCount' || id === 'slGo') {
      try {
        if (id === 'slGo' && !confirm('Mandar agora a chamada de volta (e os avisos de encerramento) para os clientes que sumiram? Sai uma mensagem para cada um, no ritmo seguro de cada número.')) return;
        const r = id === 'slCount' ? await api('/api/silence') : await api('/api/silence/run', { method: 'POST', body: {} });
        $('#slOut').textContent = `${r.nudges} cliente(s) para chamar de volta e ${r.closings} para avisar o encerramento${id === 'slGo' ? `. ${r.queued} entraram na fila` : ''}.${r.off ? ' (O recurso está desligado.)' : ''}`;
      } catch (err) { toast(err.message, true); }
      return;
    }
    if (id !== 'rsCount' && id !== 'rsGo') return;
    if (id === 'rsGo' && !confirm('Recomeçar todos os atendimentos parados? A IA vai escrever para os clientes, número por número, no ritmo seguro.')) return;
    try { await run(id === 'rsCount'); } catch (err) { toast(err.message, true); }
  });
  let slLoaded = false;
  const show = () => {
    box.hidden = window.currentUser?.role !== 'admin';
    if (!box.hidden && !slLoaded) { slLoaded = true; loadPlan().catch(() => {}); api('/api/silence').then((r) => { $('#slOn').checked = r.config.enabled !== false; $('#slHours').value = r.config.nudgeHours; }).catch(() => { slLoaded = false; }); }
  };
  new MutationObserver(show).observe(tab, { attributes: true, attributeFilter: ['class'] });
  show();
})();
