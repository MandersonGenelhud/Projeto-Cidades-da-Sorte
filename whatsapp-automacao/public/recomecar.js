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
    <div id="rsOut" class="muted"></div>`;
  anchor.insertAdjacentElement('beforebegin', box);
  const txt = (r) => `${r.total} atendimento(s) parados: ${r.esperando} esperando resposta, ${r.silenciou} em que o cliente parou de responder, ${r.reagendado} com retorno marcado${r.pausadasDono + r.pausadasMarcos ? `; ${r.pausadasDono + r.pausadasMarcos} conversa(s) pausadas serão destravadas` : ''}.${r.dryRun ? '' : ` ${r.queued} entraram na fila da IA${r.blocked ? ` (${r.blocked} ficaram de fora: número desconectado, modo de teste ou Instagram fora das 24 h)` : ''}.`}`;
  const run = async (dryRun) => {
    const r = await api('/api/restart-stalled', { method: 'POST', body: { days: Number($('#rsDays').value), includeSilent: $('#rsSilent').checked, dryRun } });
    $('#rsOut').textContent = txt(r);
    if (!dryRun) { toast('Atendimentos recomeçados'); if (typeof loaders !== 'undefined') loaders.conversations?.(); }
  };
  box.addEventListener('click', async (e) => {
    const id = e.target.id;
    if (id !== 'rsCount' && id !== 'rsGo') return;
    if (id === 'rsGo' && !confirm('Recomeçar todos os atendimentos parados? A IA vai escrever para os clientes, número por número, no ritmo seguro.')) return;
    try { await run(id === 'rsCount'); } catch (err) { toast(err.message, true); }
  });
  const show = () => { box.hidden = window.currentUser?.role !== 'admin'; };
  new MutationObserver(show).observe(tab, { attributes: true, attributeFilter: ['class'] });
  show();
})();
