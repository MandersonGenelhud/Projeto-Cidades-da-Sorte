// Cobrança e previsão → "Conferência dos contratos": totais do mês (a receber, recebido, em atraso), contratos repetidos, valores que não fecham
// e diferenças com a cópia do sistema antigo. Só lê; arquivar um repetido é por sua escolha, um a um, e dá para restaurar.
(() => {
  const sec = document.querySelector('#tab-collections');
  if (!sec) return;
  const brl = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const KIND = { soma: 'A soma das parcelas não fecha', sem_data: 'Parcela sem vencimento', sem_pagamento: 'Paga sem data', parcela_zero: 'Parcela sem valor', aproximado: 'Parcelas aproximadas', muito_antiga: 'Vencida há mais de 1 ano', sem_telefone: 'Sem telefone para cobrar', valor: 'Sem valor' };
  const DKIND = { sem_venda: 'Está lá e não veio para cá', valor_diferente: 'Valor diferente', pago_diferente: 'Pago diferente', status_diferente: 'Cancelado lá, ativo aqui', fora_da_copia: 'Está aqui e não está na cópia' };
  const box = document.createElement('div');
  box.className = 'panel';
  box.id = 'cfPanel';
  box.innerHTML = `<h2>Conferência dos contratos e do dinheiro</h2>
    <p class="hint">Confere se os contratos, as parcelas e os totais fecham: acha contratos repetidos (provavelmente da cópia do sistema antigo), valores que não batem e diferenças com a última cópia do sistema antigo. Nada é apagado nem enviado: você decide o que arquivar. Para comparar com o sistema antigo de novo, rode a cópia dos contratos (ferramenta em Contratos antigos) e depois clique em Conferir.</p>
    <div class="row"><button class="btn primary" id="cfGo" type="button">Conferir agora</button></div><div id="cfPan"></div><div id="cfOut"></div>
    <h3>Conversas antigas sem registro de cliente</h3>
    <p class="hint">A Maria e a busca já leem todo o histórico que está no sistema. Este botão cria o registro de cliente (prospecto) das conversas dos últimos 12 meses que a atendente respondeu e ficaram sem cadastro, para nenhum cliente que conversou ficar de fora. Nada é apagado nem enviado ao cliente.</p>
    <div class="row"><button class="btn" id="cfOld" type="button">Ver quantas são</button> <button class="btn primary" id="cfOldGo" type="button">Criar os registros que faltam</button></div><div id="cfOldOut" class="muted"></div>`;
  const place = () => { if (!sec.querySelector('#cfPanel')) { const head = sec.querySelector('.page-head'); if (head) head.insertAdjacentElement('afterend', box); else sec.prepend(box); } };
  new MutationObserver(place).observe(sec, { childList: true });
  place();
  const row = (g, e) => `<tr><td>${e.canArchive ? `<input type="checkbox" data-id="${esc(e.id)}" />` : ''}</td><td>${esc(e.number)}</td><td>${esc(g.client)}</td><td>${brl(e.total)}</td><td>${brl(e.paid)}</td><td>${e.legacy ? 'Sistema antigo' : 'Sistema novo'}</td><td>${esc(g.keep.number)} (fica)</td><td>${e.canArchive ? '' : `<span class="hint">${esc(e.whyNot)}</span>`}</td></tr>`;
  const render = (r) => {
    const t = r.totals; const d = r.totalsWithoutDuplicates;
    const card = (label, v, v2) => `<div class="card"><div class="hint">${label}</div><b style="font-size:22px">${brl(v)}</b>${v2 !== v ? `<div class="hint">sem os repetidos prováveis: ${brl(v2)}</div>` : ''}</div>`;
    $('#cfOut').innerHTML = `<div class="grid2">${card('A receber neste mês', t.aReceberMes, d.aReceberMes)}${card('Recebido neste mês', t.recebidoMes, d.recebidoMes)}${card(`Em atraso (${t.atrasoParcelas} parcelas)`, t.atraso, d.atraso)}${card('Total em aberto', t.aberto, d.aberto)}</div>
      <p class="hint">${r.contracts} contrato(s) ativos${r.legacyRecords ? ` · ${r.legacyRecords} na cópia do sistema antigo` : ' · nenhuma cópia do sistema antigo guardada ainda'}.</p>
      <h3>Contratos repetidos (${r.duplicates.length} grupo(s))</h3>
      ${r.duplicates.length ? `<p class="hint">Fica o contrato criado aqui (ou o que tem baixas feitas por pessoas). Marque os que são cópia e clique em arquivar: eles saem da cobrança e dos totais, mas continuam guardados e podem ser restaurados.</p>
        ${r.duplicates.map((g) => `<div class="card"><b>${esc(g.client)}</b> · <span class="hint">${esc(g.reason)} (${g.confidence === 'igual' ? 'quase certo' : 'provável'})</span>
          <div class="table-wrap"><table><thead><tr><th></th><th>Contrato</th><th>Cliente</th><th>Valor</th><th>Pago</th><th>Origem</th><th>Fica</th><th></th></tr></thead><tbody>${g.extras.map((e) => row(g, e)).join('')}</tbody></table></div></div>`).join('')}
        <div class="row"><button class="btn primary" id="cfArchive" type="button">Arquivar as marcadas</button></div>` : '<p class="hint">Nenhum contrato repetido encontrado.</p>'}
      <h3>Valores que não fecham (${r.issues.length})</h3>
      ${r.issues.length ? `<p class="hint">${Object.entries(r.issueCounts).map(([k, n]) => `${esc(KIND[k] || k)}: ${n}`).join(' · ')}</p><div class="table-wrap"><table><thead><tr><th>Contrato</th><th>Cliente</th><th>O que há</th></tr></thead><tbody>${r.issues.slice(0, 150).map((i) => `<tr><td>${esc(i.number)}</td><td>${esc(i.client)}</td><td>${esc(i.text)}</td></tr>`).join('')}</tbody></table></div>${r.issues.length > 150 ? `<p class="hint">Mostrando 150 de ${r.issues.length}.</p>` : ''}` : '<p class="hint">Tudo fecha.</p>'}
      <h3>Diferenças com o sistema antigo (${r.diffs.length})</h3>
      ${r.diffs.length ? `<p class="hint">${Object.entries(r.diffCounts).map(([k, n]) => `${esc(DKIND[k] || k)}: ${n}`).join(' · ')}</p><div class="table-wrap"><table><thead><tr><th>Contrato</th><th>Cliente</th><th>Lá</th><th>Aqui</th><th>O que há</th></tr></thead><tbody>${r.diffs.slice(0, 150).map((x) => `<tr><td>${esc(x.number)}</td><td>${esc(x.client)}</td><td>${x.legacy ? `${x.legacy.value == null ? '' : brl(x.legacy.value)}${x.legacy.paid == null ? '' : ` · pago ${brl(x.legacy.paid)}`}` : ''}</td><td>${x.sale ? `${brl(x.sale.total)} · pago ${brl(x.sale.paid)}` : ''}</td><td>${esc(x.text)}</td></tr>`).join('')}</tbody></table></div>` : `<p class="hint">${r.legacyRecords ? 'Nenhuma diferença com a cópia guardada.' : 'Sem cópia do sistema antigo para comparar.'}</p>`}`;
  };
  // Panorama lado a lado: Migra Hub × cópia do sistema antigo (vencidos, vencendo, parcelas, a receber, recebido, a pagar).
  const n = (v) => Number(v || 0).toLocaleString('pt-BR');
  const dBr = (d) => (d ? String(d).split('-').reverse().join('/') : '');
  const renderPan = (p) => {
    const h = p.hub;
    const line = (label, k, money = false) => `<tr><td>${label}</td><td><b>${money ? brl(h.todos[k]) : n(h.todos[k])}</b></td><td>${money ? brl(h.antigo[k]) : n(h.antigo[k])}</td><td>${money ? brl(h.novo[k]) : n(h.novo[k])}</td></tr>`;
    const lista = (titulo, arr, extra) => `<details><summary><b>${titulo}</b> (${arr.length})</summary>${arr.length ? `<div class="table-wrap"><table><thead><tr><th>Contrato</th><th>Cliente</th><th>Origem</th><th>Última parcela</th><th>Em aberto</th>${extra ? `<th>${extra}</th>` : ''}</tr></thead><tbody>${arr.map((x) => `<tr><td>${esc(x.number)}</td><td>${esc(x.client)}</td><td>${x.origem === 'antigo' ? 'Sistema antigo' : 'Novo'}</td><td>${esc(dBr(x.ultimaParcela))}</td><td>${brl(x.aberto)}</td>${extra ? `<td>${x.vencidas} · ${brl(x.valorVencido)}</td>` : ''}</tr>`).join('')}</tbody></table></div>` : '<p class="hint">Nenhum.</p>'}</details>`;
    $('#cfPan').innerHTML = `<h3>Panorama do dinheiro (hoje, ${esc(dBr(p.today))})</h3>
      <div class="table-wrap"><table><thead><tr><th></th><th>Total no Hub</th><th>Veio do sistema antigo</th><th>Nasceu no Hub</th></tr></thead><tbody>
        ${line('Contratos ativos (com saldo)', 'ativos')}${line('Quitados', 'quitados')}${line('Cancelados', 'cancelados')}
        ${line('Vencidos com saldo (última parcela já passou)', 'vencidosComSaldo')}${line('Vencendo (última parcela nos próximos 30 dias)', 'vencendo30')}
        ${line('Contratos com parcela vencida', 'comParcelaVencida')}${line('Parcelas vencidas', 'parcelasVencidas')}${line('Valor vencido', 'valorVencido', true)}
        ${line('Parcelas a vencer em 30 dias', 'parcelasAVencer30')}${line('Valor a vencer em 30 dias', 'valorAVencer30', true)}
        ${line('Valor dos contratos', 'valorContratos', true)}${line('Recebido', 'recebido', true)}${line('A receber', 'aReceber', true)}${line('Comissões a pagar', 'comissoesAPagar', true)}
      </tbody></table></div>
      <h3>Bate com o sistema antigo?</h3>
      ${p.temCopia ? `<p class="hint">Compara só o que veio do sistema antigo com a cópia dele (o Hub tem a mais os contratos novos). A cópia traz, por contrato, só valor, pago e situação.</p>
        <div class="table-wrap"><table><thead><tr><th></th><th>Sistema antigo (cópia)</th><th>Hub (o que veio de lá)</th><th>Diferença</th><th></th></tr></thead><tbody>
        ${p.comparacao.map((c) => `<tr><td>${esc(c.item)}</td><td>${c.dinheiro ? brl(c.antigo) : n(c.antigo)}</td><td>${c.dinheiro ? brl(c.hub) : n(c.hub)}</td><td>${c.dinheiro ? brl(c.diferenca) : n(c.diferenca)}</td><td>${c.bate ? '<span class="badge done">bate</span>' : '<span class="badge pending">confira</span>'}</td></tr>`).join('')}
        </tbody></table></div><p class="hint">A cópia tem ${n(p.antigo.registros)} registro(s): ${n(p.antigo.cancelados)} cancelado(s) e ${n(p.antigo.semValor)} sem valor. As diferenças contrato por contrato estão logo abaixo, em "Diferenças com o sistema antigo".</p>`
        : '<p class="hint">Ainda não há cópia do sistema antigo guardada. Faça uma cópia nova (Contratos antigos → Capturar) para comparar.</p>'}
      ${lista('Vencidos com saldo', p.listas.vencidosComSaldo)}${lista('Vencendo nos próximos 30 dias', p.listas.vencendo30)}${lista('Com parcela vencida', p.listas.comParcelaVencida, 'Vencidas')}`;
  };
  const run = async () => {
    $('#cfOut').textContent = 'Conferindo…';
    const [r, p] = await Promise.all([api('/api/reconcile'), api('/api/conferencia-financeira')]);
    renderPan(p); render(r);
  };
  box.addEventListener('click', async (e) => {
    try {
      if (e.target.id === 'cfGo') await run();
      if (e.target.id === 'cfOld' || e.target.id === 'cfOldGo') {
        const dry = e.target.id === 'cfOld';
        if (!dry && !confirm('Criar o registro de cliente de todas as conversas antigas que ficaram sem cadastro? Nada é enviado aos clientes.')) return;
        const r = await api('/api/leads-repair', { method: 'POST', body: { days: 365, limit: 2000, dryRun: dry } });
        $('#cfOldOut').textContent = dry ? `${r.missing} conversa(s) antiga(s) sem registro de cliente (de ${r.checked} conversas respondidas pela atendente).` : `${r.created} registro(s) criados${r.linked ? `, ${r.linked} ligados a conversas` : ''}.`;
      }
      if (e.target.id === 'cfArchive') {
        const ids = [...box.querySelectorAll('input[data-id]:checked')].map((i) => i.dataset.id);
        if (!ids.length) { toast('Marque os contratos repetidos que quer arquivar', true); return; }
        if (!confirm(`Arquivar ${ids.length} contrato(s) como repetido(s)? Eles saem da cobrança e dos totais, mas ficam guardados e podem ser restaurados.`)) return;
        const r = await api('/api/reconcile/archive', { method: 'POST', body: { ids } });
        toast(`${r.archived} arquivado(s)${r.skipped.length ? `, ${r.skipped.length} ficaram de fora` : ''}`);
        await run();
      }
    } catch (err) { toast(err.message, true); }
  });
  const show = () => { box.hidden = window.currentUser?.role !== 'admin'; };
  new MutationObserver(show).observe(sec, { attributes: true, attributeFilter: ['class'] });
  show();
})();
