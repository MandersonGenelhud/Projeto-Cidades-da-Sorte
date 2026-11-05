// "Contratos (quadros)": um quadro por contrato, com busca, filtros e prévia; e o sininho de avisos (vencimentos, renovações, assinaturas).
(() => {
  // Uma tela só de Contratos: "Quadros" (um cartão por contrato, novo e antigo) e "Lista" (vendas com parcelas e comissões).
  const tab = document.querySelector('#tab-contracts');
  if (!tab) return;
  const head = tab.querySelector('.page-head');
  head.querySelector('h1').textContent = 'Contratos';
  const listBox = document.createElement('div');
  listBox.id = 'contractsList';
  while (head.nextSibling) listBox.appendChild(head.nextSibling);
  const sec = document.createElement('div');
  sec.id = 'contractsCards';
  tab.append(sec, listBox);
  const filters = head.querySelector('.row');
  const seg = document.createElement('div');
  seg.className = 'seg';
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Visualização dos contratos');
  seg.innerHTML = '<button type="button" class="btn small" data-cview="quadros">Quadros</button><button type="button" class="btn small" data-cview="lista">Lista e comissões</button>';
  head.insertBefore(seg, filters);
  let view = (() => { try { return localStorage.getItem('contractsView') === 'lista' ? 'lista' : 'quadros'; } catch { return 'quadros'; } })();
  const listLoader = loaders.contracts;
  function setView(v) {
    view = v;
    try { localStorage.setItem('contractsView', v); } catch { /* ok */ }
    seg.querySelectorAll('[data-cview]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cview === v)));
    sec.hidden = v !== 'quadros';
    listBox.hidden = v !== 'lista';
    filters.hidden = v !== 'lista';
  }
  seg.addEventListener('click', (e) => { const b = e.target.closest('[data-cview]'); if (b) { setView(b.dataset.cview); loaders.contracts(); } });
  setView(view);
  const brl = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const br = (d) => (d ? String(d).split('-').reverse().join('/') : '—');
  const ST = { em_atraso: ['Em atraso', '#d93025'], ativo: ['Em dia', '#1f8a5b'], quitado: ['Quitado', '#1a73e8'], cancelado: ['Cancelado', '#80868b'] };
  const FIL = [['', 'Todos'], ['em_atraso', 'Em atraso'], ['a_renovar', 'A renovar'], ['aguardando', 'Aguardando assinatura'], ['ativo', 'Em dia'], ['quitado', 'Quitados'], ['cancelado', 'Cancelados'], ['antigo', 'Do sistema antigo']];
  const f = { q: '', filter: '', sort: 'recente', page: 1 };
  let last;
  const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
  const card = (c) => {
    const [stTxt, stCor] = ST[c.status] || ['—', '#80868b'];
    const ren = c.renewal && ['vencido', 'renovar', 'proximo'].includes(c.renewal.state) ? `<span class="chip" style="color:${c.renewal.state === 'proximo' ? '#b06000' : '#d93025'}">${c.renewal.state === 'vencido' ? 'Documento vencido' : 'Renovar até ' + esc(br(c.renewal.at))}</span>` : '';
    const sig = c.signature === 'assinado' ? '<span class="chip">Assinado</span>' : c.signature === 'aguardando' ? '<span class="chip" style="color:#b06000">Aguardando assinatura</span>' : c.legacy ? '<span class="chip">Sistema antigo</span>' : '';
    return `<article class="card ctc" data-k="${esc(c.key)}" tabindex="0" style="cursor:pointer;display:grid;gap:8px">
      <div class="row" style="align-items:center;gap:12px"><span class="avatar" style="flex:none">${esc(initials(c.client))}</span><div style="min-width:0;flex:1"><b style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.client || '(sem nome)')}</b><span class="hint">Contrato ${esc(c.number)}${c.service ? ` · ${esc(c.service)}` : ''}</span></div><span class="chip" style="color:${stCor};font-weight:600">${esc(stTxt)}</span></div>
      <div style="display:flex;justify-content:space-between;gap:8px"><span><span class="hint">Total</span><br><b>${brl(c.total)}</b></span><span><span class="hint">Pago</span><br><b>${brl(c.paid)}</b></span><span style="text-align:right"><span class="hint">Em aberto</span><br><b style="color:${c.overdueParcels ? '#d93025' : 'inherit'}">${brl(c.open)}</b></span></div>
      <div style="height:8px;border-radius:6px;background:rgba(127,127,127,.2);overflow:hidden"><div style="width:${c.pct}%;height:100%;background:${c.status === 'em_atraso' ? '#d93025' : '#1f8a5b'}"></div></div>
      <div class="hint">${c.parcels ? `${c.parcelsPaid} de ${c.parcels} parcelas pagas · ` : ''}${c.overdueParcels ? `<b style="color:#d93025">${c.overdueParcels} em atraso (${brl(c.overdueValue)}, ${c.overdueDays} dias)</b>` : c.next ? `próxima: ${c.next.value ? brl(c.next.value) + ' em ' : ''}${esc(br(c.next.due))}` : 'sem parcela futura'}</div>
      <div class="row" style="gap:6px;flex-wrap:wrap">${sig}${ren}${c.claimed ? '<span class="chip">Vendedor avisou pagamento</span>' : ''}${c.phone ? `<span class="chip">+${esc(c.phone)}</span>` : '<span class="chip">sem telefone</span>'}${c.seller ? `<span class="chip">${esc(c.seller)}</span>` : ''}</div></article>`;
  };
  async function load() {
    const qs = new URLSearchParams({ q: f.q, filter: f.filter, sort: f.sort, page: f.page, per: 24 });
    const r = await api(`/api/contract-cards?${qs}`); last = r;
    const pages = Math.max(1, Math.ceil(r.total / r.per));
    sec.innerHTML = `<p class="hint">Um quadro para cada contrato, do sistema novo e do antigo. Busque pelo nome, número do contrato, CPF, telefone, serviço ou vendedor. Clique no quadro para ver a ficha completa do cliente.</p>
      <div class="panel"><div class="row"><input id="ccQ" placeholder="Buscar nome, nº do contrato, CPF, telefone…" value="${esc(f.q)}" style="flex:1;min-width:220px" /><select id="ccS"><option value="recente" ${f.sort === 'recente' ? 'selected' : ''}>Mais recentes</option><option value="atraso" ${f.sort === 'atraso' ? 'selected' : ''}>Maior atraso</option><option value="valor" ${f.sort === 'valor' ? 'selected' : ''}>Maior valor</option><option value="renovacao" ${f.sort === 'renovacao' ? 'selected' : ''}>Renovação mais próxima</option><option value="nome" ${f.sort === 'nome' ? 'selected' : ''}>Nome (A a Z)</option></select></div>
        <div class="row" style="flex-wrap:wrap">${FIL.map(([k, v]) => `<button class="btn small ${f.filter === k ? 'primary' : ''}" data-a="fil" data-v="${k}">${v} <span class="hint">${k === '' ? r.counts.todos : (r.counts[k] ?? '')}</span></button>`).join('')}</div></div>
      <div class="grid2" style="grid-template-columns:repeat(auto-fill,minmax(310px,1fr))">${r.items.map(card).join('') || '<p class="muted">Nenhum contrato com esses filtros.</p>'}</div>
      <div class="row" style="justify-content:center"><button class="btn small" data-a="prev" ${f.page <= 1 ? 'disabled' : ''}>Anterior</button><span class="hint">Página ${r.page} de ${pages} · ${r.total} contrato(s)</span><button class="btn small" data-a="next" ${f.page >= pages ? 'disabled' : ''}>Próxima</button></div>`;
  }
  sec.addEventListener('click', (e) => {
    const t = e.target.closest('[data-a]');
    if (t) { const a = t.dataset.a; if (a === 'fil') { f.filter = t.dataset.v; f.page = 1; } else if (a === 'prev') f.page -= 1; else if (a === 'next') f.page += 1; return load().catch((er) => toast(er.message, true)); }
    const c = e.target.closest('.ctc');
    if (!c) return;
    const k = last?.items.find((x) => x.key === c.dataset.k);
    if (!k) return;
    // Abre a ficha 360 já procurando por esta pessoa.
    const fich = document.querySelector('#tab-customer360');
    if (fich && window.currentUser?.role === 'admin') { fich.dataset.q = k.client; showTab('customer360'); setTimeout(() => { const i = fich.querySelector('#c3Q'); if (i) { i.value = k.client; i.dispatchEvent(new Event('input', { bubbles: true })); } }, 250); }
  });
  let tm;
  sec.addEventListener('input', (e) => { if (e.target.id === 'ccQ') { f.q = e.target.value; f.page = 1; clearTimeout(tm); tm = setTimeout(() => load().then(() => { const i = sec.querySelector('#ccQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }).catch(() => {}), 350); } });
  sec.addEventListener('change', (e) => { if (e.target.id === 'ccS') { f.sort = e.target.value; load().catch(() => {}); } });
  loaders.contracts = () => (view === 'quadros' ? load().catch((e) => toast(e.message, true)) : listLoader?.());
  // Endereço antigo (#contractcards e avisos do sininho) abre os quadros.
  window.tabRedirects = { ...window.tabRedirects, contractcards: () => { setView('quadros'); showTab('contracts'); } };
  loaders.contractcards = window.tabRedirects.contractcards;

  // ---------- Sininho de avisos ----------
  const menu = document.querySelector('.user-menu');
  if (!menu) return;
  const bell = document.createElement('button');
  bell.type = 'button'; bell.className = 'icon-btn'; bell.id = 'btnBell'; bell.setAttribute('aria-label', 'Avisos'); bell.title = 'Avisos'; bell.style.position = 'relative';
  bell.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg><span id="bellBadge" hidden style="position:absolute;top:-2px;right:-2px;background:#d93025;color:#fff;border-radius:10px;font-size:11px;min-width:18px;height:18px;line-height:18px;text-align:center;padding:0 4px"></span>';
  menu.insertBefore(bell, menu.firstChild);
  const pop = document.createElement('div');
  pop.id = 'bellPop'; pop.hidden = true; pop.style.cssText = 'position:fixed;top:56px;right:12px;width:min(380px,calc(100vw - 24px));max-height:70vh;overflow:auto;z-index:80;background:var(--surface,#fff);color:inherit;border:1px solid rgba(127,127,127,.35);border-radius:14px;box-shadow:0 18px 40px -16px rgba(0,0,0,.5);padding:8px';
  document.body.appendChild(pop);
  const LV = { urgente: '#d93025', atencao: '#e8710a', info: '#1a73e8' };
  let seen = new Set(); let first = true;
  async function refresh() {
    let r; try { r = await api('/api/alerts'); } catch { return; }
    const badge = document.getElementById('bellBadge');
    badge.hidden = !r.items.length; badge.textContent = r.items.length;
    pop.innerHTML = `<div style="padding:8px 10px;font-weight:600">Avisos</div>${r.items.map((i) => `<button class="card" data-tab="${esc(i.tab)}" style="display:block;width:100%;text-align:left;margin:6px 0;border-left:4px solid ${LV[i.level]}"><b>${esc(i.title)}</b><div class="hint">${esc(i.text)}</div></button>`).join('') || '<p class="muted" style="padding:10px">Nada pendente agora.</p>'}<div class="hint" style="padding:8px 10px">Você também recebe um resumo no WhatsApp todo dia às 9h.</div>`;
    // Notificação do navegador quando aparece um aviso novo (precisa da sua permissão).
    const fresh = r.items.filter((i) => !seen.has(i.id));
    r.items.forEach((i) => seen.add(i.id));
    if (!first && fresh.length && 'Notification' in window && Notification.permission === 'granted') fresh.slice(0, 3).forEach((i) => { try { new Notification(i.title, { body: i.text }); } catch { /* sem notificação */ } });
    first = false;
  }
  bell.addEventListener('click', () => { pop.hidden = !pop.hidden; if (!pop.hidden && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {}); });
  pop.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { pop.hidden = true; showTab(b.dataset.tab); } });
  document.addEventListener('click', (e) => { if (!pop.hidden && !pop.contains(e.target) && !bell.contains(e.target)) pop.hidden = true; });
  const start = setInterval(() => { if (!window.currentUser) return; clearInterval(start); refresh(); setInterval(refresh, 5 * 60_000); }, 600);
})();
