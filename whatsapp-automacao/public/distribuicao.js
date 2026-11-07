// Equipe: controle do rodízio e dos fechamentos. Quantos clientes a central entregou a cada vendedor (e por onde chegaram), quem já atendeu
// e em quanto tempo, o que virou proposta e contrato, se o rodízio está justo e quem está com cliente parado. Só administrador.
(() => {
  const anchor = document.querySelector('#systemLinks');
  const tab = document.querySelector('#tab-team');
  if (!anchor || !tab) return;
  const box = document.createElement('details');
  box.className = 'panel';
  box.id = 'distPanel';
  box.hidden = true;
  box.innerHTML = '<summary><b>Rodízio e fechamentos (quem recebeu, quem atendeu, quem fechou)</b></summary><div id="distBody" class="muted">Carregando…</div>';
  anchor.parentElement.insertBefore(box, anchor);
  const state = { days: 30 };
  const iso = (d) => d.toISOString().slice(0, 10);
  const brl = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const wait = (m) => (m == null ? '—' : m >= 1440 ? `${Math.floor(m / 1440)} d` : m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);
  const dm = (d) => `${d.slice(8)}/${d.slice(5, 7)}`;

  async function load() {
    const from = iso(new Date(Date.now() - (state.days - 1) * 86_400_000));
    const r = await api(`/api/distribution?from=${from}&to=${iso(new Date())}&days=${Math.min(state.days, 14)}`);
    const baixas = await api('/api/maria-receipts').catch(() => ({ items: [] }));
    const f = r.funnel;
    const step = (label, n, extra = '') => `<div class="stat"><b>${n}</b><span>${esc(label)}</span>${extra}</div>`;
    const viaTxt = (s) => Object.entries(s.byVia).map(([k, n]) => `${n} ${esc((r.viaLabels[k] || k).toLowerCase())}`).join(' · ') || '—';
    $('#distBody').innerHTML = `
      <div class="row"><label>Período <select id="distDays">${[7, 14, 30, 60].map((n) => `<option value="${n}" ${state.days === n ? 'selected' : ''}>Últimos ${n} dias</option>`).join('')}</select></label>
        <span class="meta">Cliente parado = entregue ao vendedor e sem ação dele há mais de ${r.slaHours} h no horário comercial (ele é lembrado no WhatsApp; a administração é avisada em dobro do prazo).</span></div>
      <div class="stats-row">${step('Conversas', f.conversas)}${step('Prospectos', f.prospectos)}${step('Entregues aos vendedores', f.entregues)}${step('Já atendidos', f.atendidos)}${step('Propostas e fechados', f.propostas)}${step('Contratos fechados', f.contratos, `<small>${esc(brl(f.valor))}</small>`)}</div>
      ${r.waiting.length ? `<div class="panel alert"><h3>Clientes esperando contato (${r.waiting.length})</h3>${r.waiting.slice(0, 15).map((w) => `<div class="item"><div class="grow"><b>${esc(w.name)}</b> <span class="meta">com ${esc(w.seller)} · esperando há ${esc(wait(w.waitMin))} · ${esc((r.viaLabels[w.via] || w.via))}</span></div></div>`).join('')}</div>` : '<p><span class="badge ok">Nenhum cliente parado além do prazo</span></p>'}
      <div class="table-wrap"><table class="audit-map"><thead><tr><th>Vendedor</th><th>Recebidos</th><th>Como chegaram</th><th>Atendidos</th><th>1º contato (mediana)</th><th>Parados</th><th>Propostas</th><th>Contratos</th><th>Conversão</th><th>Rodízio justo?</th>${r.days.map((d) => `<th>${esc(dm(d))}</th>`).join('')}</tr></thead><tbody>
      ${r.sellers.map((s) => `<tr><td><b>${esc(s.name)}</b>${s.inRotation ? '' : ' <span class="meta">(fora do rodízio)</span>'}</td><td><b>${s.received}</b>${s.repassado ? `<br><span class="meta">${s.repassado} repassado(s)</span>` : ''}</td><td class="meta">${viaTxt(s)}</td>
        <td>${s.attended}${s.attendedPct != null ? ` (${s.attendedPct}%)` : ''}</td><td>${esc(wait(s.firstActionMedianMin))}</td><td>${s.noAction ? `<b>${s.noAction}</b>` : 0}</td><td>${s.proposta + s.ganho}</td>
        <td><b>${s.contracts}</b>${s.contracts ? `<br><span class="meta">${esc(brl(s.contractsValue))}</span>` : ''}</td><td>${s.conversionPct != null ? `${s.conversionPct}%` : '—'}</td>
        <td>${s.fair ? `${s.fair.got} de ${s.fair.expected} esperados ${Math.abs(s.fair.deviationPct) >= 30 ? `<b>(${s.fair.deviationPct > 0 ? '+' : ''}${s.fair.deviationPct}%)</b>` : ''}` : '—'}</td>
        ${s.perDay.map((n) => `<td class="${n ? 'has' : ''}">${n || ''}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${10 + r.days.length}" class="muted">Sem entregas neste período.</td></tr>`}
      </tbody></table></div>
      <h3>Pagamentos baixados pela Maria (${baixas.items.length})</h3>
      <p class="hint">Cada comprovante que o vendedor manda é lido pela Maria. "Baixa" = lançado como recebido; "conferir" = você confirma no extrato do banco; "sem parcela" = o valor não bateu com nenhuma parcela. O arquivo fica guardado.</p>
      <div class="table-wrap"><table><thead><tr><th>Quando</th><th>Cliente</th><th>Parcela</th><th>Valor</th><th>Quem pagou</th><th>Enviado por</th><th>Situação</th></tr></thead><tbody>
      ${baixas.items.map((b) => `<tr><td>${esc(new Date(b.at).toLocaleString('pt-BR'))}</td><td>${esc(b.cliente || '—')}</td><td>${esc(b.label || '')} ${esc(b.saleNumber || '')}</td><td>${esc(brl(b.amount))}</td><td>${esc(b.payer || '')}</td><td>${esc(b.byName || '')}</td><td>${b.status === 'baixa' ? '<span class="badge ok">baixa</span>' : b.status === 'conferir' ? `<span class="badge pending" title="${esc((b.problems || []).join('; '))}">conferir</span>` : '<span class="badge paused">sem parcela</span>'}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Nenhum comprovante lançado ainda.</td></tr>'}
      </tbody></table></div>
      <h3>Contratos fechados no período (${r.contracts.length})</h3>
      <div class="table-wrap"><table><thead><tr><th>Contrato</th><th>Cliente</th><th>Vendedor</th><th>Valor</th><th>Data</th></tr></thead><tbody>
      ${r.contracts.map((c) => `<tr><td>${esc(c.number)}</td><td>${esc(c.client)}</td><td>${esc(c.seller)}</td><td>${esc(brl(c.total))}</td><td>${esc(new Date(c.at).toLocaleDateString('pt-BR'))}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nenhum contrato neste período.</td></tr>'}
      </tbody></table></div>`;
  }
  box.addEventListener('toggle', () => { if (box.open) load().catch((e) => toast(e.message, true)); });
  box.addEventListener('change', (e) => { if (e.target.id === 'distDays') { state.days = Number(e.target.value); load().catch((err) => toast(err.message, true)); } });
  const show = () => { box.hidden = window.currentUser?.role !== 'admin'; };
  new MutationObserver(show).observe(tab, { attributes: true, attributeFilter: ['class'] });
  show();
})();
