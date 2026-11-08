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
    <div class="row"><button class="btn primary" id="cfGo" type="button">Conferir agora</button></div><div id="cfOut"></div>`;
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
  const run = async () => { $('#cfOut').textContent = 'Conferindo…'; render(await api('/api/reconcile')); };
  box.addEventListener('click', async (e) => {
    try {
      if (e.target.id === 'cfGo') await run();
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
