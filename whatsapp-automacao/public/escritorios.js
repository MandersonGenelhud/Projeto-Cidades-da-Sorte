// Aba "Escritórios" (administrador geral): resultados lado a lado, nome de cada escritório e IA própria de cada um.
(() => {
  const host = document.querySelector('#tab-lots')?.parentElement;
  if (!host) return;
  const sec = document.createElement('section');
  sec.id = 'tab-offices';
  sec.className = 'tab';
  sec.innerHTML = `
    <div class="page-head"><h1>Escritórios</h1></div>
    <p class="hint">Os dois escritórios usam o mesmo sistema, mas cada equipe vê só o que é do seu escritório. Aqui você compara os resultados e configura a IA de cada um. No topo da tela você escolhe qual escritório enxergar (ou os dois).</p>
    <div class="panel"><h2>Resultados do mês, lado a lado</h2><div class="table-wrap"><table id="ofCmp" class="office-cmp"></table></div></div>
    <div id="ofForms" class="office-grid"></div>`;
  host.appendChild(sec);
  const money = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
  // [rótulo, campo, tipo]: n = número, m = dinheiro, p = porcentagem (sem total)
  const ROWS = [
    ['Equipe ativa', 'equipe', 'n'], ['Números de WhatsApp', 'numeros', 'n'], ['Conversas', 'conversas', 'n'],
    ['Clientes novos no mês', 'leadsMes', 'n'], ['Em atendimento (abertos)', 'abertos', 'n'], ['Fechados no mês', 'fechadosMes', 'n'],
    ['Conversão', 'conversao', 'p'], ['Vendas no mês', 'vendasMes', 'n'], ['Vendido no mês', 'vendidoMes', 'm'],
    ['Recebido no mês', 'recebidoMes', 'm'], ['A receber', 'aReceber', 'm'], ['Em atraso', 'atrasado', 'm'],
  ];
  const show = (v, t) => (t === 'm' ? money(v) : t === 'p' ? (v == null ? '—' : `${v}%`) : String(v ?? 0));
  async function load() {
    const cmp = await api('/api/offices-compare');
    sec.querySelector('#ofCmp').innerHTML = `<thead><tr><th></th>${cmp.map((o) => `<th>${esc(o.name)}</th>`).join('')}<th>Total</th></tr></thead><tbody>${ROWS.map(([label, key, t]) => `<tr><th>${esc(label)}</th>${cmp.map((o) => `<td><b>${esc(show(o[key], t))}</b></td>`).join('')}<td>${t === 'p' ? '' : esc(show(cmp.reduce((a, o) => a + Number(o[key] || 0), 0), t))}</td></tr>`).join('')}</tbody>`;
    const forms = [];
    for (const o of cmp) {
      const d = await api(`/api/offices/${o.id}`);
      const ov = d.overrides || {};
      forms.push(`<form class="panel" data-office="${esc(o.id)}"><h2>${esc(o.name)}</h2>
        <label>Nome do escritório <input name="name" value="${esc(d.name)}" maxlength="60" /></label>
        <label>Onde fica <input name="place" value="${esc(d.place || '')}" maxlength="40" /></label>
        <h3>IA deste escritório</h3>
        <p class="hint">Deixe em branco para usar o mesmo texto do outro escritório (Agente IA). O que você preencher vale só para as conversas deste escritório.</p>
        <label>Nome da atendente <input name="agentName" value="${esc(ov.agent?.agentName || '')}" maxlength="40" /></label>
        <label>Instruções extras <textarea name="instructions" rows="4">${esc(ov.agent?.instructions || '')}</textarea></label>
        <label>Nome da empresa na conversa <input name="bname" value="${esc(ov.business?.name || '')}" maxlength="80" /></label>
        <label>Sobre o escritório <textarea name="description" rows="3">${esc(ov.business?.description || '')}</textarea></label>
        <label>Serviços <textarea name="services" rows="3">${esc(ov.business?.services || '')}</textarea></label>
        <label>Preços e condições <textarea name="prices" rows="3">${esc(ov.business?.prices || '')}</textarea></label>
        <label>Horário de funcionamento <input name="hours" value="${esc(ov.business?.hours || '')}" /></label>
        <label>Endereço <input name="address" value="${esc(ov.business?.address || '')}" /></label>
        <button class="btn primary" type="submit">Salvar</button></form>`);
    }
    sec.querySelector('#ofForms').innerHTML = forms.join('');
  }
  sec.querySelector('#ofForms').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target; const v = (n) => f[n].value;
    try {
      await api(`/api/offices/${f.dataset.office}`, { method: 'PUT', body: { name: v('name'), place: v('place'), overrides: { agent: { agentName: v('agentName'), instructions: v('instructions') }, business: { name: v('bname'), description: v('description'), services: v('services'), prices: v('prices'), hours: v('hours'), address: v('address') } } } });
      toast('Escritório salvo');
    } catch (err) { toast(err.message, true); }
  });
  loaders.offices = () => load().catch((e) => toast(e.message, true));
})();
