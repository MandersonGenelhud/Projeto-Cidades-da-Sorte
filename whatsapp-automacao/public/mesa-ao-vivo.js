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
    box.hidden = false;
    const naoEntregues = r.encaminhados.filter((x) => !x.entregue).length;
    box.innerHTML = `<h2>Ao vivo: hoje</h2>
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
  loaders.conversations = (...args) => { tick(); return prev?.(...args); };
})();
