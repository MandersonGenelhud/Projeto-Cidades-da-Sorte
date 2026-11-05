// Aba "Comissões e saques": nível do mês, comissão liberada (proporcional ao que o cliente pagou) e pedidos de saque.
(() => {
  const host = document.querySelector('#tab-lots')?.parentElement;
  if (!host) return;
  const sec = document.createElement('section');
  sec.id = 'tab-commissions';
  sec.className = 'tab';
  host.appendChild(sec);
  const brl = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const dt = (d) => (d ? new Date(d).toLocaleDateString('pt-BR') : '');
  const ST = { pedido: ['Pedido', 'pending'], aprovado: ['Aprovado', 'pending'], pago: ['Pago', 'ok'], recusado: ['Recusado', 'paused'] };
  const badge = (s) => `<span class="badge ${ST[s]?.[1] || ''}">${ST[s]?.[0] || esc(s)}</span>`;
  const lvl = (l) => `<span class="badge" style="background:${esc(l.color)}22;color:${esc(l.color)};border:1px solid ${esc(l.color)}55">${esc(l.label)} · ${l.pct}%</span>`;

  async function load() {
    const admin = window.currentUser?.role === 'admin';
    const me = await api('/api/commissions/me');
    const b = me.balance;
    let html = `<div class="page-head"><h1>Comissões e saques</h1></div>
      <div class="panel"><h2>Você neste mês</h2>
        <p>Nível: ${lvl(me.level)} ${me.levelsOn ? '' : '<span class="hint">(os níveis estão desligados: vale a comissão definida pelo administrador)</span>'}</p>
        <p>Vendas no mês: <b>${brl(me.sold)}</b>${me.next ? ` · faltam <b>${brl(me.next.missing)}</b> para ${lvl(me.next)}` : ' · você está no nível mais alto'}</p>
        <div class="cards">
          <div class="card"><small>Comissão total (em aberto)</small><b>${brl(b.total)}</b></div>
          <div class="card"><small>Liberada (cliente já pagou)</small><b>${brl(b.released)}</b></div>
          <div class="card"><small>Aguardando pagamento do cliente</small><b>${brl(b.waiting)}</b></div>
          <div class="card"><small>Disponível para saque</small><b style="color:#0a7d3b">${brl(b.available)}</b></div>
        </div>
        <p class="hint">A comissão é liberada na proporção do que o cliente pagou e o administrador confirmou. Pedidos em análise: ${brl(b.pending)} · já pagos: ${brl(b.paid)}.</p>
        <div class="grid2"><label>Valor do saque<input id="cmA" inputmode="decimal" placeholder="Até ${brl(b.available)}" /></label><label>Chave Pix para receber<input id="cmK" placeholder="CPF, e-mail, telefone ou chave aleatória" /></label></div>
        <label>Observação (opcional)<input id="cmN" /></label>
        <button class="btn primary" data-a="ask" ${b.available > 0 ? '' : 'disabled'}>Pedir saque</button>
        ${me.withdrawals.length ? `<h3>Meus pedidos</h3><div class="table-wrap"><table><thead><tr><th>Data</th><th>Valor</th><th>Situação</th></tr></thead><tbody>${me.withdrawals.map((w) => `<tr><td>${dt(w.createdAt)}</td><td>${brl(w.amount)}</td><td>${badge(w.status)}${w.reason ? `<br><span class="hint">${esc(w.reason)}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
      </div>`;
    if (admin) {
      const o = await api('/api/commissions/overview');
      html += `<div class="panel"><h2>Níveis de comissão (meta de vendas do mês)</h2>
        <label class="check"><input type="checkbox" id="cmOn" ${o.config.enabled ? 'checked' : ''} /> Usar os níveis para calcular a comissão das vendas novas (a comissão definida para a pessoa na Equipe continua valendo mais)</label>
        <div class="table-wrap"><table><thead><tr><th>Nível</th><th>Comissão %</th><th>Meta no mês (R$)</th></tr></thead><tbody>${o.config.plans.map((p, i) => `<tr data-i="${i}" data-id="${esc(p.id)}" data-color="${esc(p.color)}"><td><input data-k="label" value="${esc(p.label)}" /></td><td><input data-k="pct" inputmode="decimal" value="${p.pct}" /></td><td><input data-k="goal" inputmode="decimal" value="${p.goal}" /></td></tr>`).join('')}</tbody></table></div>
        <button class="btn primary" data-a="levels">Salvar níveis</button> <button class="btn" data-a="recalc" title="Aplica o nível final do mês às vendas deste mês ainda não pagas">Recalcular comissões deste mês pelo nível</button></div>
        <div class="panel"><h2>Pedidos de saque</h2><div class="table-wrap"><table><thead><tr><th>Data</th><th>Vendedor</th><th>Valor</th><th>Pix</th><th>Situação</th><th></th></tr></thead><tbody>
        ${o.requests.map((w) => `<tr data-id="${esc(w.id)}"><td>${dt(w.createdAt)}</td><td>${esc(w.sellerName)}</td><td>${brl(w.amount)}</td><td>${esc(w.pixKey)}</td><td>${badge(w.status)}${w.reason ? `<br><span class="hint">${esc(w.reason)}</span>` : ''}</td>
          <td>${w.status === 'pedido' ? '<button class="btn small" data-a="approve">Aprovar</button> ' : ''}${['pedido', 'aprovado'].includes(w.status) ? '<button class="btn small primary" data-a="pay">Marcar pago</button> <button class="btn small danger" data-a="reject">Recusar</button>' : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nenhum pedido.</td></tr>'}
        </tbody></table></div></div>
        <div class="panel"><h2>Equipe neste mês</h2><div class="table-wrap"><table><thead><tr><th>Vendedor</th><th>Nível</th><th>Vendas no mês</th><th>Comissão em aberto</th><th>Liberada</th><th>Em análise</th><th>Disponível</th></tr></thead><tbody>
        ${o.rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${lvl(r.level)}</td><td>${brl(r.sold)}</td><td>${brl(r.balance.total)}</td><td>${brl(r.balance.released)}</td><td>${brl(r.balance.pending)}</td><td><b>${brl(r.balance.available)}</b></td></tr>`).join('')}
        </tbody></table></div></div>
        ${o.legacy ? `<div class="panel"><h2>Saldo no sistema antigo (só consulta)</h2><p class="hint">Copiado em ${dt(o.legacy.at)}. Não entra no saldo daqui: serve para conferir e fechar as contas antigas.</p><div class="table-wrap"><table><thead><tr><th>Vendedor</th><th>Comissão total</th><th>Liberada</th><th>Pendente</th><th>Sacado</th><th>Disponível</th></tr></thead><tbody>${o.legacy.sellers.map((s) => `<tr><td>${esc(s.name)}</td><td>${brl(s.total)}</td><td>${brl(s.released)}</td><td>${brl(s.pending)}</td><td>${brl(s.withdrawn)}</td><td>${brl(s.available)}</td></tr>`).join('')}</tbody></table></div></div>` : ''}`;
    }
    sec.innerHTML = html;
  }
  sec.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-a]'); if (!t) return;
    const g = (i) => sec.querySelector(i); const id = t.closest('[data-id]')?.dataset.id;
    try {
      if (t.dataset.a === 'ask') {
        await api('/api/withdrawals', { method: 'POST', body: { amount: g('#cmA').value, pixKey: g('#cmK').value, notes: g('#cmN').value } });
        toast('Pedido enviado. O administrador foi avisado.');
      } else if (t.dataset.a === 'levels') {
        const plans = [...sec.querySelectorAll('tr[data-i]')].map((tr) => ({ id: tr.dataset.id, color: tr.dataset.color, label: tr.querySelector('[data-k=label]').value, pct: Number(String(tr.querySelector('[data-k=pct]').value).replace(',', '.')), goal: Number(String(tr.querySelector('[data-k=goal]').value).replace(/\./g, '').replace(',', '.')) }));
        await api('/api/commissions/levels', { method: 'PUT', body: { enabled: g('#cmOn').checked, plans } });
        toast('Níveis salvos');
      } else if (t.dataset.a === 'recalc') {
        if (!confirm('Aplicar o nível de cada vendedor às vendas deste mês que ainda não tiveram a comissão paga nem definida à mão?')) return;
        const r = await api('/api/commissions/recalc', { method: 'POST', body: {} });
        toast(`${r.changed} venda(s) recalculada(s)`);
      } else if (['approve', 'pay', 'reject'].includes(t.dataset.a)) {
        const body = {};
        if (t.dataset.a === 'reject') { body.reason = prompt('Motivo da recusa (o vendedor recebe):') || ''; if (!body.reason) return; }
        if (t.dataset.a === 'pay' && !confirm('Confirmar que este saque já foi pago?')) return;
        await api(`/api/withdrawals/${id}/${t.dataset.a}`, { method: 'POST', body });
      } else return;
      await load();
    } catch (err) { toast(err.message, true); }
  });
  loaders.commissions = () => load().catch((e) => toast(e.message, true));
})();
