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
    <p class="hint">Procura nos últimos dias, em todos os números e no Instagram, quem ficou sem continuidade: cliente esperando resposta, cliente que parou de responder, retorno combinado que chegou e conversa pausada. A IA lê as últimas 20 mensagens, só retoma o que é assunto de algum serviço da Migra e escreve de onde parou. Cada número responde no seu ritmo (limite por hora de cada um), das 7h às 23h. Quem já fechou ou foi dado como perdido não é incomodado.</p>
    <div class="row"><label>Últimos <select id="rsDays"><option value="15">15 dias</option><option value="30" selected>30 dias</option><option value="45">45 dias</option><option value="60">60 dias</option></select></label>
      <label class="check"><input type="checkbox" id="rsSilent" checked /> Incluir quem parou de responder e retornos combinados</label>
      <button class="btn" id="rsCount">Ver quantos são</button> <button class="btn primary" id="rsGo">Recomeçar agora</button></div>
    <div id="rsOut" class="muted"></div>
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
  const loadTpl = async () => {
    const o = (await api('/api/settings')).agent?.backlogOpening || {};
    $('#rsOn').checked = o.enabled !== false; $('#rsHours').value = o.minHours ?? 6; $('#rsT1').value = o.template || ''; $('#rsT2').value = o.templateNoDate || '';
  };
  $('#rsTpl').addEventListener('toggle', (e) => { if (e.target.open) loadTpl().catch(() => {}); });
  box.addEventListener('click', async (e) => {
    const id = e.target.id;
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
    if (!box.hidden && !slLoaded) { slLoaded = true; api('/api/silence').then((r) => { $('#slOn').checked = r.config.enabled !== false; $('#slHours').value = r.config.nudgeHours; }).catch(() => { slLoaded = false; }); }
  };
  new MutationObserver(show).observe(tab, { attributes: true, attributeFilter: ['class'] });
  show();
})();
