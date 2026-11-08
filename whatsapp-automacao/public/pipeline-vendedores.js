// Aba "Pipeline dos vendedores": para cada pessoa da equipe, quem está atendendo e em que etapa está (orçamento, ficha, contrato, comprovante, fechou).
// O administrador vê todos; cada vendedor vê só os dele.
(() => {
  const host = document.querySelector('#tab-lots')?.parentElement;
  if (!host) return;
  const sec = document.createElement('section');
  sec.id = 'tab-sellerpipe';
  sec.className = 'tab';
  host.appendChild(sec);
  let days = 90; let current = '';
  async function render() {
    sec.innerHTML = '<div class="page-head"><h1>Pipeline dos vendedores</h1></div><p class="muted">Carregando…</p>';
    let r;
    try { r = await api(`/api/sellers-pipeline?days=${days}`); } catch (e) { sec.innerHTML = `<div class="page-head"><h1>Pipeline dos vendedores</h1></div><p class="muted">${esc(e.message)}</p>`; return; }
    const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    if (!current || !r.sellers.some((s) => s.id === current)) current = r.sellers[0]?.id || '';
    const sel = r.sellers.find((s) => s.id === current);
    sec.innerHTML = `<div class="page-head"><h1>Pipeline dos vendedores</h1></div>
      <p class="hint">Quem atende cada cliente, e em que etapa ele está. O vendedor é o dono do prospecto, o dono do WhatsApp por onde o cliente chegou, para quem foi passado ou quem fez o orçamento.</p>
      <div class="row"><label>Período <select id="spDays">${[30, 90, 180, 365].map((d) => `<option value="${d}" ${d === days ? 'selected' : ''}>últimos ${d} dias</option>`).join('')}</select></label></div>
      <div class="grid2">${r.sellers.map((s) => `<button type="button" class="card ${s.id === current ? 'active' : ''}" data-seller="${esc(s.id)}" style="text-align:left;cursor:pointer">
        <b>${esc(s.name)}</b><div class="hint">${s.total} clientes · ${s.counts.fechou} fecharam (${s.taxaFechamento}% de quem recebeu orçamento)</div>
        <div class="hint">${s.counts.atendendo} atendendo · ${s.counts.orcamento} com orçamento · ${s.counts.comprovante} com comprovante</div></button>`).join('') || '<p class="muted">Nenhum vendedor com clientes neste período.</p>'}</div>
      ${sel ? `<div class="panel"><h2>${esc(sel.name)}</h2>
        <div style="display:flex;gap:12px;overflow-x:auto;align-items:flex-start">${r.columns.map((c) => `<div style="min-width:220px;flex:1"><h3>${esc(c.label)} <span class="badge pending">${sel.counts[c.id]}</span></h3>
          ${sel.rows.filter((x) => x.stage === c.id).slice(0, 40).map((x) => `<div class="card" style="margin-bottom:8px"><b>${esc(x.name)}</b><div class="hint">${esc(x.phone ? `+${x.phone}` : '')}${x.quote ? ` · ${esc(x.quote)} · ${brl(x.value)}` : ''}</div>${x.interest ? `<div class="hint">${esc(x.interest)}</div>` : ''}<button class="btn small" data-open="${esc(x.id)}" type="button">Abrir ficha</button></div>`).join('') || '<p class="muted">—</p>'}
        </div>`).join('')}</div></div>` : ''}`;
    sec.querySelector('#spDays').addEventListener('change', (e) => { days = Number(e.target.value); render(); });
    sec.querySelectorAll('[data-seller]').forEach((b) => b.addEventListener('click', () => { current = b.dataset.seller; render(); }));
    sec.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openLead(b.dataset.open)));
  }
  loaders.sellerpipe = () => render().catch((e) => toast(e.message, true));
})();
