// Conversas → "Ao vivo": clientes novos de hoje e encaminhamentos de hoje, atualizando sozinho. Clicar abre a conversa completa logo abaixo.
(() => {
  const tab = document.querySelector('#tab-conversations');
  if (!tab) return;
  const box = document.createElement('div');
  box.className = 'panel';
  box.id = 'liveDesk';
  box.hidden = true;
  tab.querySelector('h1')?.after(box);
  const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');
  const SETOR = { documentacao: 'Documentação', loteamentos: 'Imóveis', veiculos: 'Veículos' };
  let timer = null;
  async function load() {
    if (window.currentUser?.role !== 'admin') return;
    const r = await api('/api/live-desk');
    const ce = await api('/api/clientes-esperando').catch(() => null);
    const ceShow = ce && ce.linhas?.length;
    const dg = ce?.linhas?.length ? await api('/api/diagnostico-numero').catch(() => null) : null;
    box.hidden = false;
    const naoEntregues = r.encaminhados.filter((x) => !x.entregue).length;
    const esperaHtml = ceShow ? (() => {
      const j = ce.job || {};
      const prontos = ce.esperando.filter((x) => !x.bloqueio).length;
      return `<div style="border:1px solid var(--line,#ddd);border-radius:10px;padding:10px;margin-bottom:12px">
        <h3>Clientes da Migra esperando resposta no seu WhatsApp (${ce.esperando.length})</h3>
        <p class="hint">Quem escreveu sobre a Migra (veio pela Central, mandou o código, é prospecto ou falou de serviço/contrato) nos últimos ${ce.days} dias e ainda não foi respondido, inclusive quem recebeu só "Só um momento". Conversas pessoais ficam de fora${ce.ignorados ? ` (${ce.ignorados} deixada(s) de fora)` : ''}. Só o seu número: os dos outros vendedores continuam como estão. A IA atende um de cada vez, no ritmo humano. No WhatsApp, você também pode digitar /retomar.</p>
        ${ce.esperando.map((x) => `<div class="item" data-key="${esc(x.key)}" style="cursor:pointer"><div class="grow"><b>${esc(x.nome || `+${x.phone}`)}</b> <span class="badge">${esc(x.linhaNome)}</span> ${x.soUmMomento ? '<span class="badge pending">disse "Só um momento"</span>' : ''} ${x.bloqueio ? `<span class="badge canceled">${esc(x.bloqueio)}</span>` : ''}<div class="meta">${esc(hora(x.at))} · ${esc(x.motivo)} · ${esc(x.ultima)}</div></div></div>`).join('') || '<p class="muted">Ninguém esperando agora.</p>'}
        ${j.running ? `<p class="hint"><b>Atendendo…</b> ${j.iniciados} de ${j.total}${j.atual ? ` · agora: ${esc(j.atual)}` : ''}</p><button class="btn danger" data-a="ceStop">Parar</button>` : `<button class="btn primary" data-a="ceStart" ${prontos ? '' : 'disabled'}>Atender agora (${prontos})</button>`}
      </div>`;
    })() : '';
    const dgHtml = dg ? `<details ${dg.problemas ? 'open' : ''} style="margin-bottom:12px"><summary><b>Diagnóstico da IA do seu WhatsApp</b> ${dg.problemas ? `<span class="badge canceled">${dg.problemas} problema(s)</span>` : '<span class="badge running">tudo certo</span>'}</summary><div class="meta" style="white-space:pre-wrap;margin-top:6px">${esc(dg.linhas.join('\n'))}</div></details>` : '';
    box.innerHTML = `${dgHtml}${esperaHtml}<h2>Ao vivo: hoje</h2>
      <p class="hint">Atualiza sozinho a cada 10 segundos. Clique em um cliente para ver a conversa completa logo abaixo.</p>
      <div class="grid2" style="align-items:start">
        <div><h3>Clientes novos (${r.novos.length})</h3><div style="max-height:40vh;overflow:auto">
          ${r.novos.map((c) => `<div class="item" data-key="${esc(c.key)}" style="cursor:pointer"><div class="grow"><b>${esc(c.name || (c.phone ? `+${c.phone}` : 'Cliente'))}</b> <span class="badge">${esc(c.canal)}</span> ${c.encaminhadoPara ? `<span class="badge running">com ${esc(c.encaminhadoPara.split(' ')[0])}</span>` : '<span class="badge pending">na Central</span>'}<div class="meta">${esc(hora(c.at))} · ${c.ultimaDe ? `${c.ultimaDe === 'cliente' ? 'Cliente' : 'Atendente'}: ` : ''}${esc(c.ultima)}</div></div></div>`).join('') || '<p class="muted">Nenhum cliente novo hoje ainda.</p>'}
        </div></div>
        <div><h3>Encaminhados aos vendedores (${r.encaminhados.length})${naoEntregues ? ` <span class="badge canceled">${naoEntregues} aviso(s) não chegaram</span>` : ''}</h3><div style="max-height:40vh;overflow:auto">
          ${r.encaminhados.map((c) => `<div class="item" data-key="${esc(c.key)}" style="cursor:pointer"><div class="grow"><b>${esc(c.name || (c.phone ? `+${c.phone}` : 'Cliente'))}</b> → ${esc(c.para)} <span class="badge">${esc(SETOR[c.setor] || c.setor)}</span> ${c.entregue ? '<span class="badge running">aviso entregue</span>' : '<span class="badge canceled">aviso NÃO entregue</span>'}${c.link ? (c.chegou ? ` <span class="badge running">cliente chamou ${esc(hora(c.chegou))}</span>` : ` <span class="badge pending">link enviado${c.lembretes ? ` · ${c.lembretes} lembrete(s)` : ''}</span>`) : ''}<div class="meta">${esc(hora(c.at))}</div></div></div>`).join('') || '<p class="muted">Nenhum encaminhamento hoje ainda.</p>'}
        </div></div></div>`;
  }
  box.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]');
    if (a?.dataset.a === 'ceStart' || a?.dataset.a === 'ceStop') {
      try {
        if (a.dataset.a === 'ceStop') { await api('/api/clientes-esperando/stop', { method: 'POST', body: {} }); toast('Vai parar depois do cliente atual.'); }
        else {
          if (!confirm('A IA do seu número vai começar a atender os clientes da Migra que estavam esperando, um de cada vez. Continuar?')) return;
          const r = await api('/api/clientes-esperando/start', { method: 'POST', body: {} });
          toast(`Começou: ${r.total} cliente(s).`);
        }
        await load();
      } catch (err) { toast(err.message, true); }
      return;
    }
    const item = e.target.closest('[data-key]');
    if (!item?.dataset.key) return;
    try {
      await openConversation(item.dataset.key);
      document.querySelector('#convHeader')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) { toast(err.message, true); }
  });
  const tick = () => {
    clearTimeout(timer);
    if (!tab.classList.contains('active')) return;
    load().catch(() => {}).finally(() => { timer = setTimeout(tick, 10000); });
  };
  const prev = loaders.conversations;
  // Só quando a pessoa abre a aba (não a cada mensagem que chega: a tela "Ao vivo" já se atualiza sozinha a cada 10 s).
  loaders.conversations = (opts = {}) => { if (!opts.keepThread) tick(); return prev?.(opts); };
})();
