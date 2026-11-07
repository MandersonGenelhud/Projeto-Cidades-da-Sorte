// Orçamentos: avisar quem está com orçamento vencendo hoje ou amanhã. A IA escreve pela conversa do cliente, com o prazo real, sem inventar desconto.
// Só administrador. Cada orçamento é avisado uma vez só (o sistema também faz isso sozinho, no horário de trabalho).
(() => {
  const tab = document.querySelector('#tab-quotes');
  const h1 = tab?.querySelector('h1');
  if (!tab || !h1) return;
  const box = document.createElement('div');
  box.className = 'panel';
  box.id = 'qePanel';
  box.hidden = true;
  box.innerHTML = `<h2>Orçamentos vencendo (hoje e amanhã)</h2>
    <p class="hint">A IA lembra o cliente de que o orçamento vence, retoma a conversa de onde parou e convida a fechar. Usa só o prazo real do orçamento: não inventa desconto, bônus nem vaga limitada. Cada orçamento é avisado uma vez só, e quem já fechou, foi dado como perdido ou está com um atendente não é incomodado. O sistema também faz isso sozinho, no horário de trabalho.</p>
    <div class="row"><button class="btn" id="qeCount">Ver quem seria avisado</button> <button class="btn primary" id="qeGo">Avisar agora</button></div>
    <div id="qeOut" class="muted"></div>`;
  h1.insertAdjacentElement('afterend', box);
  const txt = (r) => {
    const parts = [`${r.total} orçamento(s) vencendo`, `${r.queued} ${r.dryRun === false || r.dryRun === undefined ? 'entraram na fila da IA' : 'seriam avisados'}`];
    if (r.jaAvisados) parts.push(`${r.jaAvisados} já avisados antes`);
    const out = [parts.join(': ')];
    if (r.skipped?.length) out.push(`Ficaram de fora: ${r.skipped.map((s) => `${s.client} (${s.motivo})`).join('; ')}.`);
    return out.join('. ');
  };
  const run = async (dry) => {
    const r = dry ? await api('/api/quotes-expiring') : await api('/api/quotes-expiring/notify', { method: 'POST', body: {} });
    $('#qeOut').textContent = dry ? txt({ ...r, dryRun: true }) : txt({ ...r, dryRun: false });
    if (!dry) toast('Avisos enviados para a fila da IA');
  };
  box.addEventListener('click', async (e) => {
    const id = e.target.id;
    if (id !== 'qeCount' && id !== 'qeGo') return;
    if (id === 'qeGo' && !confirm('A IA vai escrever para os clientes com orçamento vencendo, número por número, no ritmo seguro. Continuar?')) return;
    try { await run(id === 'qeCount'); } catch (err) { toast(err.message, true); }
  });
  const show = () => { box.hidden = window.currentUser?.role !== 'admin'; };
  new MutationObserver(show).observe(tab, { attributes: true, attributeFilter: ['class'] });
  show();
})();
