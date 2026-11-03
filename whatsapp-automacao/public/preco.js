// Aba "Preço do serviço": consumo real da IA, custo por resposta e planos sugeridos para revender a automação.
(() => {
  const host = document.querySelector('#tab-lots')?.parentElement;
  if (!host) return;
  const sec = document.createElement('section');
  sec.id = 'tab-pricing';
  sec.className = 'tab';
  sec.innerHTML = `
    <div class="page-head"><h1>Preço do serviço</h1></div>
    <p class="hint">Calcula quanto cobrar de uma empresa (como a Migra Paraná) pela automação: custo da IA por resposta, custos fixos, suporte e a sua margem. O sistema mede o consumo real. <b>Os preços do Google você digita</b> (ai.google.dev/pricing), para a conta nunca usar número velho.</p>
    <div id="prWarn"></div>
    <div class="panel"><h2>Mensagens da atendente</h2>
      <div id="usCards" class="cards"></div><p id="usNote" class="hint"></p>
      <div class="row"><label>Gasto real com a IA até hoje (R$) <input id="usSpent" inputmode="decimal" placeholder="415,83" /></label><button class="btn" id="usSave" type="button">Salvar gasto</button></div></div>
    <div class="panel"><h2>Calibrar com o gasto real</h2>
      <p class="hint">Digite quanto já foi gasto com a IA (em reais) e, se quiser, o período. O sistema conta as mensagens que a atendente já enviou, divide pelos dias em que rodou e projeta 30 dias. A contagem é um mínimo, porque cada conversa guarda só as últimas 200 mensagens.</p>
      <div class="row"><label>Gasto total até agora (R$) <input id="hsCost" inputmode="decimal" placeholder="415,83" /></label><label>De <input id="hsFrom" type="date" /></label><label>Até <input id="hsTo" type="date" /></label>
        <label>Escritório <select id="hsOffice"><option value="">Os dois</option><option value="py">Paraguai</option><option value="pr">Paraná</option></select></label><button class="btn primary" id="hsGo" type="button">Calcular</button></div>
      <div id="hsOut"></div></div>
    <form id="prForm" class="panel">
      <h2>Valores da conta</h2>
      <div class="row">
        <label>Entrada: US$ por 1 milhão de tokens <input name="inPerM" inputmode="decimal" /></label>
        <label>Saída: US$ por 1 milhão de tokens <input name="outPerM" inputmode="decimal" /></label>
        <label>Dólar (R$) <input name="usdBrl" inputmode="decimal" /></label>
      </div>
      <div class="row">
        <label>Custos fixos por mês (R$): servidor, domínio, ferramentas <input name="fixedBrl" inputmode="decimal" /></label>
        <label>Dividido entre quantas empresas <input name="clients" type="number" min="1" /></label>
      </div>
      <div class="row">
        <label>Horas de suporte por mês <input name="supportHours" inputmode="decimal" /></label>
        <label>Valor da hora (R$) <input name="hourBrl" inputmode="decimal" /></label>
        <label>Margem sobre o custo (%) <input name="markupPct" inputmode="decimal" /></label>
        <label>Implantação, cobrança única (R$) <input name="setupBrl" inputmode="decimal" /></label>
      </div>
      <details><summary>Estimativa para quando ainda não há consumo medido</summary>
        <div class="row"><label>Tokens de entrada por resposta <input name="estInTokens" type="number" /></label><label>Tokens de saída por resposta <input name="estOutTokens" type="number" /></label></div></details>
      <div class="row"><button class="btn primary" type="submit">Salvar e recalcular</button></div>
    </form>
    <div class="panel"><div class="row"><h2 style="margin:0">Consumo real</h2><input type="month" id="prMonth" /><select id="prOffice"><option value="">Os dois escritórios</option><option value="py">Paraguai</option><option value="pr">Paraná</option></select></div>
      <div id="prMeasured" class="cards"></div></div>
    <div class="panel"><h2>Planos sugeridos</h2><div class="table-wrap"><table id="prPlans"></table></div><p id="prExtra" class="hint"></p><pre id="prProposal" class="hint" style="white-space:pre-wrap;display:none"></pre></div>`;
  host.appendChild(sec);
  const brl = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const brl0 = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
  const q = (s) => sec.querySelector(s);
  const f = q('#prForm');
  let last = null;
  const month = () => q('#prMonth').value || new Date().toISOString().slice(0, 7);
  async function loadUsage() {
    const u = await api('/api/usage/summary');
    const n = (v) => Number(v || 0).toLocaleString('pt-BR');
    q('#usCards').innerHTML = `<div class="card"><b>${n(u.total)}</b><span>respostas da atendente até hoje</span></div><div class="card"><b>${n(u.month)}</b><span>neste mês</span></div><div class="card"><b>${n(u.today)}</b><span>hoje</span></div>
      <div class="card"><b>${u.costPerReply ? brl(u.costPerReply) : '—'}</b><span>custo por resposta${u.costPerReply ? ` (${brl(u.costPer1000)} a cada 1.000)` : ' (informe o gasto)'}</span></div>`;
    const b = u.backfill;
    q('#usNote').textContent = `Total = ${n(u.estimatedReplies)} respostas contadas pela memória das conversas${b?.from ? ` (de ${b.from.split('-').reverse().join('/')} a ${b.to.split('-').reverse().join('/')}; é um mínimo, porque cada conversa guarda só as últimas 200 mensagens)` : ''} + ${n(u.measuredReplies)} medidas com exatidão desde ${u.since.split('-').reverse().join('/')}.${u.spentBrl ? ` Gasto informado: ${brl(u.spentBrl)}${u.spentAsOf ? ` em ${u.spentAsOf.split('-').reverse().join('/')}` : ''}.` : ''}`;
    if (u.spentBrl && !q('#usSpent').value) q('#usSpent').value = String(u.spentBrl).replace('.', ',');
  }
  q('#usSave').onclick = async () => {
    const v = Number(String(q('#usSpent').value || '').replace(/\./g, '').replace(',', '.'));
    if (!(v >= 0)) return toast('Digite o gasto em reais', true);
    try { await api('/api/pricing', { method: 'PUT', body: { spentBrl: v, spentAsOf: new Date().toISOString().slice(0, 10) } }); toast('Gasto salvo'); loadUsage(); } catch (e) { toast(e.message, true); }
  };
  async function load() {
    loadUsage().catch(() => {});
    q('#prMonth').value ||= new Date().toISOString().slice(0, 7);
    const r = await api(`/api/pricing?month=${month()}&office=${q('#prOffice').value}`);
    last = r;
    for (const [k, v] of Object.entries(r.config)) if (f[k]) f[k].value = v;
    const m = r.model; const me = r.measured;
    q('#prWarn').innerHTML = !m.configured ? '<p class="err">Preencha os preços do Google e o dólar para o cálculo ficar certo. Sem eles, o custo aparece zerado.</p>' : (!m.measuredData ? '<p class="hint">Ainda há poucas respostas medidas neste período (menos de 20): o cálculo usa a estimativa de tokens por resposta.</p>' : '');
    q('#prMeasured').innerHTML = `<div class="card"><b>${me.replies}</b><span>respostas da IA</span></div><div class="card"><b>${me.atendimento.calls + me.outros.calls}</b><span>chamadas à IA</span></div>
      <div class="card"><b>${m.inPerReply.toLocaleString('pt-BR')}</b><span>tokens de entrada por resposta${m.measuredData ? '' : ' (estimativa)'}</span></div><div class="card"><b>${m.outPerReply.toLocaleString('pt-BR')}</b><span>tokens de saída por resposta</span></div>
      <div class="card"><b>${brl(m.brlPerReply)}</b><span>custo da IA por resposta (US$ ${m.usdPerReply})</span></div><div class="card"><b>${brl0(m.brlPerReply * 1000)}</b><span>custo da IA a cada 1.000 respostas</span></div>`;
    q('#prPlans').innerHTML = `<thead><tr><th>Respostas por mês</th><th>IA</th><th>Fixo</th><th>Suporte</th><th>Custo total</th><th>Preço sugerido</th><th>Lucro</th><th>Margem</th><th></th></tr></thead><tbody>${m.plans.map((p) => `<tr><td><b>${p.replies.toLocaleString('pt-BR')}</b></td><td>${brl(p.variable)}</td><td>${brl(p.fixed)}</td><td>${brl(p.support)}</td><td>${brl(p.cost)}</td><td><b>${brl0(p.price)}</b></td><td>${brl0(p.profit)}</td><td>${p.marginPct}%</td><td><button class="btn small" data-n="${p.replies}">Gerar proposta</button></td></tr>`).join('')}</tbody>`;
    q('#prExtra').textContent = `Excedente sugerido: ${brl(m.overagePer100)} a cada 100 respostas além do plano. Implantação: ${brl0(m.setupBrl)} (cobrança única).`;
  }
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/pricing', { method: 'PUT', body: Object.fromEntries([...new FormData(f)].map(([k, v]) => [k, Number(String(v).replace(',', '.'))])) }); toast('Salvo'); load(); } catch (err) { toast(err.message, true); }
  });
  q('#prPlans').addEventListener('click', (e) => {
    const n = Number(e.target.dataset.n); if (!n || !last) return;
    const p = last.model.plans.find((x) => x.replies === n);
    const pre = q('#prProposal');
    pre.style.display = 'block';
    pre.textContent = `Proposta: automação de atendimento por WhatsApp com IA\n\nPlano: até ${p.replies.toLocaleString('pt-BR')} respostas da IA por mês\nMensalidade: ${brl0(p.price)}\nExcedente: ${brl(last.model.overagePer100)} a cada 100 respostas além do plano\nImplantação (única): ${brl0(last.model.setupBrl)}\n\nInclui: atendente virtual no WhatsApp, CRM, contratos, painel de resultados, suporte e atualizações.\nO consumo de respostas é medido pelo próprio sistema e mostrado todo mês.`;
  });
  for (const id of ['#prMonth', '#prOffice']) q(id).onchange = load;
  q('#hsGo').onclick = async () => {
    const cost = String(q('#hsCost').value || '').replace(/\./g, '').replace(',', '.');
    if (!(Number(cost) > 0)) return toast('Digite o gasto total em reais', true);
    try {
      const h = await api(`/api/pricing/history?cost=${encodeURIComponent(cost)}&from=${q('#hsFrom').value}&to=${q('#hsTo').value}&office=${q('#hsOffice').value}`);
      if (h.empty) { q('#hsOut').innerHTML = '<p class="err">Não encontrei mensagens da atendente neste período.</p>'; return; }
      const fx = (a, b) => `${a.split('-').reverse().slice(0, 2).join('/')} a ${b.split('-').reverse().join('/')}`;
      q('#hsOut').innerHTML = `<div class="cards"><div class="card"><b>${h.messages.toLocaleString('pt-BR')}</b><span>mensagens enviadas pela atendente (${fx(h.start, h.end)}, ${h.periodDays} dias)</span></div>
        <div class="card"><b>${h.messagesPerDay.toLocaleString('pt-BR')}</b><span>mensagens por dia (média)</span></div><div class="card"><b>${h.monthlyMessages.toLocaleString('pt-BR')}</b><span>mensagens por mês (30 dias)</span></div>
        <div class="card"><b>${brl(h.costPerMessage)}</b><span>custo por mensagem (${brl(h.costPer1000)} a cada 1.000)</span></div>
        <div class="card"><b>${brl(h.monthlyCost)}</b><span>custo mensal da IA, no mesmo ritmo</span></div><div class="card"><b>${brl(h.totalMonthlyCost)}</b><span>custo mensal total (com custo fixo e suporte da tabela abaixo)</span></div></div>
        <p><b>Preço mensal sugerido: ${brl0(h.price)}</b> (margem de ${h.markupPct}% sobre o custo: lucro de ${brl0(h.profit)} por mês, ${h.marginPct}% do preço).</p>
        <p class="hint">Atenção: o gasto pode incluir testes, conversas atrasadas processadas de uma vez e outros usos (voz, resumos). Se o ritmo real de atendimento for menor ou maior que o do período, o valor muda. Use o "Consumo real" mais abaixo para confirmar depois de algumas semanas.</p>`;
    } catch (e) { toast(e.message, true); }
  };
  loaders.pricing = () => load().catch((e) => toast(e.message, true));
})();
