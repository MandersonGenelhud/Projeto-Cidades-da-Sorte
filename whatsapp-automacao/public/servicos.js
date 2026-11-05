// Aba "Serviços": catálogo com preço base, prazo e comissão. O administrador edita; a equipe consulta.
(() => {
  const host = document.querySelector('#tab-lots')?.parentElement;
  if (!host) return;
  const sec = document.createElement('section');
  sec.id = 'tab-services';
  sec.className = 'tab';
  host.appendChild(sec);
  const f = { q: '', category: '', active: '' };
  const money = (v, c = 'BRL') => (v === null || v === undefined ? '—' : `${{ USD: 'US$', PYG: 'Gs.', BRL: 'R$' }[c] || 'R$'} ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
  let cats = {};
  async function load() {
    const admin = window.currentUser?.role === 'admin';
    const r = await api(`/api/services?q=${encodeURIComponent(f.q)}&category=${encodeURIComponent(f.category)}&active=${encodeURIComponent(f.active)}`);
    cats = r.categories;
    const opt = (sel) => Object.entries(cats).map(([k, v]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${esc(v)}</option>`).join('');
    sec.innerHTML = `<div class="page-head"><h1>Serviços</h1></div>
      <p class="hint">Catálogo com preço base, prazo e comissão de cada serviço. ${admin ? 'O orçamento, o contrato e os atalhos do WhatsApp aceitam qualquer serviço ativo com preço.' : 'Use estes nomes no orçamento e nos atalhos do WhatsApp (ex.: /orcamento nome do serviço 2 pessoas).'}</p>
      ${admin ? `<div class="panel"><h2>Novo serviço</h2><div class="grid2">
        <label>Nome<input id="svN" placeholder="Ex.: Adicional Licença para condução" /></label>
        <label>Categoria<select id="svC">${opt('migratorio')}</select></label>
        <label>Preço base (R$)<input id="svP" inputmode="decimal" placeholder="Ex.: 1500" /></label>
        <label>Prazo (dias)<input id="svD" inputmode="numeric" placeholder="Ex.: 60" /></label>
        <label>Comissão do vendedor (%)<input id="svK" inputmode="decimal" placeholder="Ex.: 10" /></label>
        <label>Descrição<input id="svX" placeholder="O que está incluído" /></label></div>
        <button class="btn primary" data-a="add">Cadastrar serviço</button></div>` : ''}
      <div class="panel"><div class="row">
        <input id="svQ" placeholder="Buscar serviço" value="${esc(f.q)}" />
        <select id="svF"><option value="">Todas as categorias</option>${opt(f.category)}</select>
        ${admin ? `<select id="svA"><option value="" ${f.active === '' ? 'selected' : ''}>Ativos e inativos</option><option value="true" ${f.active === 'true' ? 'selected' : ''}>Só ativos</option><option value="false" ${f.active === 'false' ? 'selected' : ''}>Só inativos</option></select>` : ''}
        <span class="hint">${r.items.length} serviço(s)</span></div>
        <div class="table-wrap"><table><thead><tr><th>Serviço</th><th>Categoria</th><th>Preço base</th><th>Prazo</th><th>Comissão</th>${admin ? '<th></th>' : ''}</tr></thead><tbody>
        ${r.items.map((s) => `<tr data-id="${esc(s.id)}" ${s.active ? '' : 'style="opacity:.55"'}>
          <td><b>${esc(s.name)}</b>${s.description ? `<br><span class="hint">${esc(s.description)}</span>` : ''}${s.active ? '' : ' <span class="badge paused">inativo</span>'}</td>
          <td>${esc(cats[s.category] || s.category)}</td><td>${money(s.price, s.currency)}</td>
          <td>${s.durationDays ? `${s.durationDays} dias` : '—'}</td><td>${s.commissionPct !== null && s.commissionPct !== undefined ? `${s.commissionPct}%` : 'padrão'}</td>
          ${admin ? `<td><button class="btn small" data-a="edit">Editar</button> <button class="btn small" data-a="toggle">${s.active ? 'Desativar' : 'Reativar'}</button></td>` : ''}</tr>`).join('') || `<tr><td colspan="6" class="muted">Nenhum serviço. ${admin ? 'Importe a cópia do sistema antigo (Contratos antigos) ou cadastre acima.' : ''}</td></tr>`}
        </tbody></table></div></div>`;
    sec.dataset.items = JSON.stringify(r.items);
  }
  sec.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-a]'); if (!t) return;
    const g = (i) => sec.querySelector(i);
    const id = t.closest('[data-id]')?.dataset.id;
    const item = id ? JSON.parse(sec.dataset.items || '[]').find((x) => x.id === id) : null;
    try {
      if (t.dataset.a === 'add') {
        await api('/api/services', { method: 'POST', body: { name: g('#svN').value, category: g('#svC').value, price: g('#svP').value, durationDays: g('#svD').value, commissionPct: g('#svK').value, description: g('#svX').value } });
        toast('Serviço cadastrado');
      } else if (t.dataset.a === 'toggle') {
        await api(`/api/services/${id}`, { method: 'PATCH', body: { active: !item.active } });
      } else if (t.dataset.a === 'edit') {
        const price = prompt(`Preço base de "${item.name}" (R$):`, item.price ?? ''); if (price === null) return;
        const commissionPct = prompt('Comissão do vendedor (%). Deixe vazio para usar a comissão padrão do vendedor:', item.commissionPct ?? ''); if (commissionPct === null) return;
        const durationDays = prompt('Prazo em dias (vazio se não tiver):', item.durationDays ?? ''); if (durationDays === null) return;
        await api(`/api/services/${id}`, { method: 'PATCH', body: { price, commissionPct, durationDays } });
        toast('Serviço atualizado');
      } else return;
      await load();
    } catch (err) { toast(err.message, true); }
  });
  sec.addEventListener('change', (e) => {
    if (e.target.id === 'svF') { f.category = e.target.value; load(); }
    if (e.target.id === 'svA') { f.active = e.target.value; load(); }
  });
  let tm;
  sec.addEventListener('input', (e) => { if (e.target.id === 'svQ') { f.q = e.target.value; clearTimeout(tm); tm = setTimeout(() => load().then(() => { const i = sec.querySelector('#svQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }), 300); } });
  loaders.services = () => load().catch((e) => toast(e.message, true));
})();
