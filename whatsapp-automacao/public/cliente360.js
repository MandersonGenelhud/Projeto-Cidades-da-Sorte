// Aba "Ficha do cliente (360)": busca uma pessoa e mostra contratos, parcelas, orçamentos, documentos, conversas e a linha do tempo.
(() => {
  const host = document.querySelector('#tab-lots')?.parentElement;
  if (!host) return;
  const sec = document.createElement('section');
  sec.id = 'tab-customer360';
  sec.className = 'tab';
  host.appendChild(sec);
  const brl = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const br = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—');
  const ST = { pago: 'Pago', pendente: 'Pendente' };
  function shell(results = '', body = '') {
    sec.innerHTML = `<div class="page-head"><h1>Ficha do cliente (360)</h1></div>
      <p class="hint">Digite o nome, o telefone ou o CPF. A ficha junta tudo da pessoa: contratos, parcelas (pagas e em atraso), orçamentos, documentos, conversas e a linha do tempo.</p>
      <div class="panel"><div class="row"><input id="c3Q" placeholder="Nome, telefone ou CPF" value="${esc(sec.dataset.q || '')}" /></div><div id="c3Res">${results}</div></div><div id="c3Out">${body}</div>`;
  }
  async function search(q) {
    sec.dataset.q = q;
    const list = q.trim().length < 2 ? [] : await api(`/api/customers/search?q=${encodeURIComponent(q)}`);
    sec.querySelector('#c3Res').innerHTML = list.map((p) => `<button class="card" data-a="open" data-n="${esc(p.name)}" data-p="${esc(p.phone)}" data-d="${esc(p.doc)}"><b>${esc(p.name || '(sem nome)')}</b><div class="hint">${p.phone ? `+${esc(p.phone)} · ` : ''}${esc(p.doc)} · ${esc(p.sources.join(', '))}</div></button>`).join('') || (q.trim().length >= 2 ? '<p class="muted">Ninguém encontrado.</p>' : '');
  }
  async function open(n, p, d) {
    const r = await api(`/api/customers/360?name=${encodeURIComponent(n)}&phone=${encodeURIComponent(p)}&doc=${encodeURIComponent(d)}`);
    const m = r.money;
    sec.querySelector('#c3Out').innerHTML = `<div class="panel"><h2>${esc(r.person.name)}</h2><div class="hint">${r.person.phone ? `+${esc(r.person.phone)} · ` : ''}${esc(r.person.doc)} ${esc(r.person.email)}</div>
      <div class="grid2"><div class="card"><div class="hint">Vendido</div><b style="font-size:22px">${brl(m.sold)}</b></div><div class="card"><div class="hint">Recebido</div><b style="font-size:22px">${brl(m.received)}</b><div class="hint">${m.parcelsPaid} de ${m.parcelsTotal} parcelas</div></div><div class="card"><div class="hint">Em aberto</div><b style="font-size:22px">${brl(m.open)}</b></div><div class="card"><div class="hint">Em atraso</div><b style="font-size:22px;color:${m.overdue ? '#d93025' : 'inherit'}">${brl(m.overdue)}</b><div class="hint">${m.overdueParcels} parcela(s)</div></div></div></div>
      ${r.sales.map((s) => `<div class="panel"><h3>Contrato ${esc(s.number)} · ${brl(s.total)} <span class="chip">${esc(s.status)}</span>${s.legacy ? ' <span class="chip">sistema antigo</span>' : ''}</h3><div class="hint">${esc(s.seller)}</div><div class="table-wrap"><table><tbody>${s.parcels.map((p) => `<tr><td>${esc(p.label)}</td><td>${brl(p.value)}</td><td>${esc(br(p.due))}</td><td>${p.status === 'pago' ? `<span class="chip">Pago ${esc(br(p.paidAt))}</span>` : p.late ? '<span class="chip" style="color:#d93025">Atrasada</span>' : 'A vencer'}${p.claimed ? ' <span class="chip">vendedor avisou</span>' : ''}</td></tr>`).join('')}</tbody></table></div></div>`).join('') || '<div class="panel"><p class="muted">Sem contratos ligados a esta pessoa.</p></div>'}
      <div class="panel"><h3>Documentos</h3>${r.documents.map((d) => `<div>${esc(d.type.replace(/_/g, ' '))} ${d.number ? `nº ${esc(d.number)}` : ''} · ${esc(d.status)} · emitido ${esc(br(d.issuedAt))}${d.renewalAt ? ` · renovação ${esc(br(d.renewalAt))}` : ''}</div>`).join('') || '<p class="muted">Nenhum.</p>'}
        <h3>Orçamentos</h3>${r.quotes.map((q) => `<div>${esc(q.number)} · ${brl(q.total)} · válido até ${esc(br(q.validUntil))}</div>`).join('') || '<p class="muted">Nenhum.</p>'}
        <h3>No CRM</h3>${r.leads.map((l) => `<div>${esc(l.code)} · etapa ${esc(l.stage)}${l.owner ? ` · ${esc(l.owner)}` : ''}${l.interest ? ` · ${esc(l.interest)}` : ''}</div>`).join('') || '<p class="muted">Não está no CRM.</p>'}</div>
      <div class="panel"><h3>Linha do tempo</h3>${r.timeline.map((e) => `<div class="row"><span class="hint" style="width:90px">${esc(br(e.date))}</span><span class="chip">${esc(e.kind)}</span><span>${esc(e.text)}</span></div>`).join('') || '<p class="muted">Sem eventos.</p>'}</div>
      ${r.conversations.map((c) => `<div class="panel"><h3>Últimas mensagens</h3>${c.messages.map((m) => `<div class="hint"><b>${m.role === 'user' ? 'Cliente' : 'Atendimento'}:</b> ${esc(m.content)}</div>`).join('')}</div>`).join('')}`;
    sec.querySelector('#c3Out').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  let tm;
  sec.addEventListener('input', (e) => { if (e.target.id === 'c3Q') { clearTimeout(tm); tm = setTimeout(() => search(e.target.value).catch((err) => toast(err.message, true)), 300); } });
  sec.addEventListener('click', (e) => { const t = e.target.closest('[data-a="open"]'); if (t) open(t.dataset.n, t.dataset.p, t.dataset.d).catch((err) => toast(err.message, true)); });
  // Duplicados: cadastros repetidos de clientes (só junta com a sua confirmação).
  async function dups() {
    const g = await api('/api/customers/duplicates?source=clients');
    sec.querySelector('#c3Out').innerHTML = `<div class="panel"><h2>Cadastros repetidos (${g.length} grupo(s))</h2><p class="hint">Mesma pessoa escrita mais de uma vez (mesmo documento, telefone ou nome). "Juntar" fica com o primeiro e completa os dados dele com os outros.</p>${g.slice(0, 60).map((x) => `<div class="card"><div class="hint">${esc(x.reasons.join(', '))}</div>${x.members.map((m) => `<div>${esc(m.name)} · ${esc(m.phone)} · ${esc(m.doc)}</div>`).join('')}<button class="btn small" data-a="merge" data-ids="${esc(x.members.map((m) => m.id).join(','))}">Juntar em um só</button></div>`).join('') || '<p class="muted">Nenhum repetido.</p>'}</div>`;
  }
  sec.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-a]'); if (!t) return;
    try {
      if (t.dataset.a === 'dups') return await dups();
      if (t.dataset.a === 'merge') { if (!confirm('Juntar estes cadastros em um só? Não dá para desfazer.')) return; await api('/api/customers/duplicates/merge', { method: 'POST', body: { ids: t.dataset.ids.split(',') } }); toast('Cadastros juntados'); await dups(); }
    } catch (err) { toast(err.message, true); }
  });
  loaders.customer360 = () => { shell(); sec.querySelector('.page-head').insertAdjacentHTML('beforeend', '<button class="btn" data-a="dups">Ver cadastros repetidos</button>'); };
})();
