// Conversas: "Encaminhar os atendimentos em andamento aos vendedores". Mostra a prévia (quantos, por segmento) e só envia depois do clique do administrador.
(() => {
  const tab = document.querySelector('#tab-conversations');
  if (!tab) return;
  const box = document.createElement('div');
  box.className = 'panel';
  box.id = 'bulkHandoff';
  box.hidden = true;
  tab.querySelector('h1')?.after(box);
  const SEG = { documentacao: 'Documentação (rodízio dos vendedores)', loteamentos: 'Imóveis (corretor)', veiculos: 'Veículos' };
  let timer = null;
  async function load() {
    if (window.currentUser?.role !== 'admin') return;
    const r = await api('/api/handoff-bulk');
    box.hidden = false;
    const st = await api('/api/central/stuck').catch(() => ({ total: 0 }));
    const l = r.ultimo;
    box.innerHTML = `${st.total ? `<div class="ai-banner"><b>${st.total} conversa(s)</b> em que a Central disse ao cliente que encaminhou, mas nenhum vendedor recebeu. <button class="btn primary" data-a="fixstuck">Corrigir agora</button></div>` : ''}<h2>Encaminhar aos vendedores os atendimentos em andamento</h2>
      <p class="hint">Cada pessoa que hoje está sendo atendida pela IA recebe a mensagem "Vou te encaminhar para um de nossos vendedores para dar continuidade ao seu atendimento", e o vendedor do segmento recebe o resumo para continuar. Não entram: quem já falou com uma pessoa, quem recusou, clientes que já fecharam e quem já foi encaminhado. O envio é devagar (um a cada 20 a 45 segundos), só entre 8h e 20h.</p>
      <p><b>${r.total}</b> atendimento(s) para encaminhar: ${Object.entries(r.porSegmento).map(([k, v]) => `${esc(SEG[k])}: <b>${v}</b>`).join(' · ')}</p>
      ${r.exemplos.length ? `<p class="hint">Exemplos: ${r.exemplos.map((x) => `${esc(x.nome)} (${esc(SEG[x.segmento].split(' (')[0])})`).join(', ')}</p>` : ''}
      ${l ? `<p class="hint">Último envio: ${esc(new Date(l.startedAt).toLocaleString('pt-BR'))} · ${l.enviados} enviados, ${l.falhas} falhas, ${l.pulados} pulados de ${l.total}${l.terminou ? ' · terminou' : r.rodando ? ' · rodando…' : ''}${l.interrompido ? ' · interrompido' : ''}</p>` : ''}
      <button class="btn primary" data-a="start" ${r.total && !r.rodando ? '' : 'disabled'}>Encaminhar agora</button>
      <button class="btn danger" data-a="stop" ${r.rodando ? '' : 'disabled'}>Parar</button>`;
    clearTimeout(timer);
    if (r.rodando) timer = setTimeout(() => load().catch(() => {}), 15000);
  }
  box.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]'); if (!a) return;
    try {
      if (a.dataset.a === 'start') {
        if (!confirm('Enviar agora a mensagem de encaminhamento para todos da lista e avisar os vendedores? Não dá para desfazer.')) return;
        const r = await api('/api/handoff-bulk/start', { method: 'POST', body: {} });
        toast(`Começou: ${r.total} atendimento(s), um de cada vez.`);
      }
      if (a.dataset.a === 'fixstuck') {
        if (!confirm('Encaminhar agora aos vendedores (rodízio, corretor ou veículos) as conversas em que a Central disse que encaminhou? Os clientes não recebem mensagem nova: só os vendedores são avisados.')) return;
        a.disabled = true; toast('Encaminhando… pode levar alguns minutos.');
        const r = await api('/api/central/stuck/fix', { method: 'POST', body: {} });
        toast(`${r.ok} encaminhada(s)${r.falhas ? `, ${r.falhas} com falha` : ''}.`);
      }
      if (a.dataset.a === 'stop') { await api('/api/handoff-bulk/stop', { method: 'POST', body: {} }); toast('Vai parar depois do atendimento atual.'); }
      await load();
    } catch (err) { toast(err.message, true); }
  });
  const prev = loaders.conversations;
  loaders.conversations = (...args) => { load().catch(() => {}); return prev?.(...args); };
})();
