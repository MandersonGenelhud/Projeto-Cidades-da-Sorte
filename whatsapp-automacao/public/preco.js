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
  async function load() {
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
  loaders.pricing = () => load().catch((e) => toast(e.message, true));
})();
