// Painel executivo (visual escuro/futurista) e tela de Módulos (standby).
(() => {
  const host = document.querySelector('#tab-lots')?.parentElement;
  if (!host) return;
  const brl = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const brl2 = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const dm = (s) => (s ? s.split('-').reverse().slice(0, 2).join('/') : '—');

  // ---------------- PAINEL EXECUTIVO ----------------
  const ex = document.createElement('section');
  ex.id = 'tab-executive';
  ex.className = 'tab';
  ex.innerHTML = '<div class="xd" id="xd"><p class="xd-muted">Carregando o painel…</p></div>';
  host.appendChild(ex);
  let data = null; let per = 'mes';

  const bars = (items, { a, b, label }) => {
    const max = Math.max(1, ...items.flatMap((i) => [i[a], b ? i[b] : 0]));
    return `<div class="xd-bars" role="img" aria-label="Gráfico de barras por mês">${items.map((i) => `<div class="xd-col" title="${esc(i.label)}: ${esc(label(i))}">
      <div class="xd-pair"><i class="xd-bar a" style="height:${Math.max(i[a] ? 3 : 0, Math.round((i[a] / max) * 100))}%"></i>${b ? `<i class="xd-bar b" style="height:${Math.max(i[b] ? 3 : 0, Math.round((i[b] / max) * 100))}%"></i>` : ''}</div><span>${esc(i.label)}</span></div>`).join('')}</div>`;
  };
  const kpi = (ic, label, value, sub, tone = '', go = '', filter = '') => `<${go ? `button type="button" data-go="${go}" data-filter="${filter}" title="Abrir ${label.toLowerCase()}"` : 'div'} class="xd-kpi ${tone}${go ? ' xd-link' : ''}"><span class="xd-ico">${icon(ic, 18)}</span><small>${label}</small><b>${value}</b><em>${sub || ''}</em></${go ? 'button' : 'div'}>`;

  function render() {
    const d = data;
    const c = d.cobrancas[per];
    const k = d.kpis;
    const crm = d.crm || {};
    const alerts = [];
    if (k.atrasadasQtd) alerts.push([`${k.atrasadasQtd} parcela(s) em atraso somando ${brl(k.atrasadoTotal)}`, 'collections']);
    if (d.extras.esperando) alerts.push([`${d.extras.esperando} cliente(s) esperando resposta`, 'conversations', '#pendingPanel']);
    if (d.extras.visitasAbertas) alerts.push([`${d.extras.visitasAbertas} visita(s) para resolver`, 'visits']);
    if (d.extras.retomarNovos) alerts.push([`${d.extras.retomarNovos} contato(s) para retomar`, 'reengage']);
    if (d.extras.whatsapp !== 'connected') alerts.push(['WhatsApp desconectado', 'connection']);
    ex.querySelector('#xd').innerHTML = `
      <header class="xd-head"><div><small>${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</small><h1>Painel</h1></div><button class="xd-btn" id="xdRefresh" type="button">Atualizar</button></header>
      ${alerts.length ? `<div class="xd-alerts">${alerts.map(([a, tab, focus]) => `<button type="button" class="xd-alert" data-go="${tab}" data-focus="${focus || ''}">${icon('alert', 15)}${esc(a)}<span class="xd-go">Resolver →</span></button>`).join('')}</div>` : '<div class="xd-alerts ok"><span>Sem pendências no momento</span></div>'}
      <section class="xd-grid xd-kpis">
        ${kpi('wallet', 'Recebido no mês', brl(k.recebidoMes), `${d.months.at(-1).vendas} venda(s) no mês`, 'g', 'payments')}
        ${kpi('inbox', 'A receber (total)', brl(k.aReceberTotal), `${k.contratosAtivos} contratos ativos`, 'c', 'contractcards', 'ativo')}
        ${kpi('alert', 'Em atraso', brl(k.atrasadoTotal), `${k.atrasadasQtd} parcela(s)`, k.atrasadasQtd ? 'r' : 'g', 'collections')}
        ${kpi('trend', 'Vendido no mês', brl(k.vendidoMes), `comissões em aberto: ${brl(k.comissaoAberta)}`, 'v', 'sales')}
        ${kpi('attendants', 'Leads novos no mês', crm.newLeads ?? 0, `${crm.openLeads ?? 0} em aberto`, 'c', 'leads')}
        ${kpi('inbox', 'Respostas da IA no mês', (d.usage?.month ?? 0).toLocaleString('pt-BR'), `${(d.usage?.total ?? 0).toLocaleString('pt-BR')} no total, ${(d.usage?.today ?? 0).toLocaleString('pt-BR')} hoje`, '', 'conversations')}
        ${kpi('award', 'Conversão', crm.conversion == null ? '—' : `${crm.conversion}%`, `${crm.won ?? 0} fechado(s) · ${brl(crm.wonValue)}`, 'g', 'sales')}
      </section>
      <section class="xd-card"><div class="xd-card-head"><h2>Cobranças e vencimentos <button type="button" class="xd-more" data-go="contractcards" data-filter="vencendo">Ver quem vence →</button></h2>
        <div class="xd-seg" role="tablist">${Object.entries(d.cobrancas).map(([key, v]) => `<button type="button" data-per="${key}" class="${key === per ? 'on' : ''}">${esc(v.label)}</button>`).join('')}</div></div>
        <p class="xd-muted">${dm(c.from)} a ${dm(c.to)} · ${c.quantidade} cobrança(s) com vencimento no período</p>
        <div class="xd-grid xd-four">
          <div class="xd-mini"><small>Vence no período</small><b>${brl(c.vence)}</b></div>
          <div class="xd-mini g"><small>Já recebido</small><b>${brl(c.recebido)}</b></div>
          <div class="xd-mini c"><small>A receber</small><b>${brl(c.aReceber)}</b></div>
          <div class="xd-mini r"><small>Atrasado</small><b>${brl(c.atrasado)}</b></div></div>
        <div class="xd-progress" title="Recebido ${brl(c.recebido)} de ${brl(c.vence)}"><i style="width:${c.vence ? Math.min(100, Math.round((c.recebido / c.vence) * 100)) : 0}%"></i></div>
        <p class="xd-muted">${c.vence ? `${Math.round((c.recebido / c.vence) * 100)}% do que vence no período já foi pago` : 'Nada vence neste período'} · entrou no caixa no período: <b>${brl(c.entrou)}</b></p></section>
      <section class="xd-grid xd-two">
        <div class="xd-card"><h2>Recebido × vendido (12 meses)</h2><div class="xd-legend"><span class="a">Recebido</span><span class="b">Vendido</span></div>${bars(d.months, { a: 'recebido', b: 'vendido', label: (i) => `recebido ${brl(i.recebido)} · vendido ${brl(i.vendido)}` })}</div>
        <div class="xd-card"><h2>O que deve entrar nas próximas 8 semanas</h2>${bars(d.semanas.map((w) => ({ ...w, label: dm(w.from) })), { a: 'valor', label: (i) => `${brl(i.valor)} (${i.quantidade} parcela(s))` })}<p class="xd-muted">Total: <b>${brl(d.semanas.reduce((a, w) => a + w.valor, 0))}</b></p></div>
      </section>
      <section class="xd-grid xd-two">
        <div class="xd-card"><h2>Atrasos por faixa <button type="button" class="xd-more" data-go="collections">Ver todos →</button></h2>${d.faixas.map((f) => `<div class="xd-row"><span>${esc(f.label)}</span><b>${f.quantidade}</b><em>${brl(f.valor)}</em></div>`).join('')}
          <h3>Maiores atrasos</h3>${d.atrasadas.slice(0, 6).map((p) => `<div class="xd-row"><span>${esc(p.client || p.number)}<small>${esc(p.label)} · venceu ${dm(p.due)}</small></span><b>${p.daysLate}d</b><em>${brl2(p.value)}</em></div>`).join('') || '<p class="xd-muted">Nenhuma parcela em atraso. </p>'}</div>
        <div class="xd-card"><h2>Vendedores no mês <button type="button" class="xd-more" data-go="sales">Ver vendas →</button></h2>${d.vendedores.map((v) => `<div class="xd-row"><span>${esc(v.name)}<small>${v.vendas} venda(s) · recebido ${brl(v.recebido)}</small></span><b>${brl(v.vendido)}</b><em>comissão ${brl(v.comissaoAberta)}</em></div>`).join('') || '<p class="xd-muted">Sem vendas ainda.</p>'}
          <h3>De onde vêm os clientes (mês)</h3><div class="xd-chips">${(crm.bySource || []).map((s) => `<span>${esc(s.label)} <b>${s.count}</b></span>`).join('') || '<span>Sem dados</span>'}</div></div>
      </section>`;
    ex.querySelector('#xdRefresh').onclick = load;
    ex.querySelectorAll('#xd [data-go]').forEach((b) => (b.onclick = () => window.goTo(b.dataset.go, b.dataset.filter ? { filter: b.dataset.filter } : b.dataset.focus ? { focus: b.dataset.focus } : {})));
    ex.querySelectorAll('[data-per]').forEach((b) => (b.onclick = () => { per = b.dataset.per; render(); }));
  }
  async function load() {
    try { data = await api('/api/executive'); render(); } catch (e) { ex.querySelector('#xd').innerHTML = `<p class="xd-muted">${esc(e.message)}</p>`; }
  }
  loaders.executive = () => { load(); if (window.currentUser?.role === 'admin') loaders.dashboard?.().catch?.(() => {}); clearInterval(load.t); load.t = setInterval(() => { if (ex.classList.contains('active')) load(); else clearInterval(load.t); }, 60000); };

  // O antigo "Painel" (números do atendimento automático) virou um bloco deste painel.
  const dash = document.getElementById('tab-dashboard');
  if (dash) {
    dash.querySelector('h1')?.remove();
    const box = document.createElement('details');
    box.className = 'panel exec-robot';
    box.id = 'execRobot';
    box.setAttribute('data-admin', '');
    try { box.open = localStorage.getItem('execRobotOpen') !== '0'; } catch { box.open = true; }
    box.innerHTML = '<summary><b>Atendimento automático</b> <span class="hint">números de hoje, atividade recente e como começar</span></summary>';
    while (dash.firstChild) box.appendChild(dash.firstChild);
    dash.remove();
    ex.appendChild(box);
    box.addEventListener('toggle', () => { try { localStorage.setItem('execRobotOpen', box.open ? '1' : '0'); } catch { /* ok */ } });
    window.tabRedirects = { ...window.tabRedirects, dashboard: () => { box.open = true; showTab('executive'); } };
  }

  // ---------------- MÓDULOS (STANDBY) ----------------
  const md = document.createElement('section');
  md.id = 'tab-modules';
  md.className = 'tab';
  md.innerHTML = `<div class="page-head"><h1>Módulos (standby)</h1></div>
    <p class="hint">Telas que não usamos agora ficam em <b>standby</b>: somem do menu, mas nada é apagado, e é só ligar de novo quando precisar. Aqui também está o que decidimos sobre o sistema antigo do Marcos.</p>
    <div class="panel"><h2>Telas do nosso sistema</h2><div id="mdList" class="md-list"></div></div>
    <div class="panel"><h2>O que decidimos do sistema antigo do Marcos</h2><div class="table-wrap"><table id="mdPlan"></table></div></div>`;
  host.appendChild(md);
  const PLAN = [
    ['Dashboard executivo e cobranças e vencimentos', 'agora', 'Feito: Painel executivo (hoje, semana, mês, ano).'],
    ['Clientes, contratos, processos, documentos e orçamentos', 'ja', 'Contratos antigos (importação) + Contratos e vendas + Orçamentos.'],
    ['Gerador de contratos', 'ja', 'Já existe aqui (PDF automático). Comparar com o do Marcos e aprimorar.'],
    ['Leads, cadastro no site e leads do Instagram/Facebook', 'agora', 'Feito: Retomar contatos (cruza com WhatsApp e CRM).'],
    ['Mensagem automática de contratos vencidos (Pix/boleto)', 'proximo', 'Próxima etapa, com texto gentil e aprovação.'],
    ['Comissões e saques', 'proximo', 'Comissões já existem; falta o controle de saques.'],
    ['Vendedores, níveis e metas, equipe, auditoria', 'ja', 'Equipe, Ranking e Auditoria já existem (e melhores).'],
    ['Agenda e reuniões', 'ja', 'Agenda e Visitas já existem.'],
    ['WhatsApp automático, voz e IA', 'ja', 'Já é o coração do sistema.'],
    ['Google Meet / reuniões ao vivo', 'agora', 'Feito: aba Live (página pública com o Meet e os grupos) e Videochamadas (agenda espaçada). Sem precisar ligar a conta Google: o link da sala é colado no painel.'],
    ['Live no Instagram', 'standby', 'Standby: a Meta não deixa iniciar live por programa.'],
    ['Reuniões gravadas', 'agora', 'Feito: aba Reuniões gravadas (biblioteca de links com título, data e assunto). O vídeo fica no Google Drive ou YouTube; aqui fica o endereço.'],
    ['Contabilidade', 'standby', 'Standby até o processo contábil começar.'],
    ['Caixa Paraguai', 'standby', 'Standby: finalidade ainda não confirmada.'],
    ['Relatórios e modelos', 'standby', 'Standby: os relatórios úteis já estão no Painel executivo.'],
    ['Marketing (campanhas, leads, performance)', 'standby', 'Standby: a equipe de IA assume depois.'],
    ['Links de contato, guia de cidades', 'standby', 'Standby: não são necessários agora.'],
    ['Leads do quiz e leads de grupos', 'standby', 'Standby: grupos não recebem mensagem automática; quiz entra pelo Retomar contatos.'],
    ['Curso, tutoriais e despachante (Motors)', 'standby', 'Standby: depois da cópia, trazemos os textos e as aulas.'],
  ];
  const TAG = { agora: ['Feito agora', 'g'], ja: ['Já temos', 'g'], proximo: ['Próxima etapa', 'c'], standby: ['Standby', 'm'] };
  md.querySelector('#mdPlan').innerHTML = `<thead><tr><th>Do sistema antigo</th><th>Decisão</th><th>Detalhe</th></tr></thead><tbody>${PLAN.map(([n, t, d]) => `<tr><td><b>${esc(n)}</b></td><td><span class="xd-tag ${TAG[t][1]}">${TAG[t][0]}</span></td><td>${esc(d)}</td></tr>`).join('')}</tbody>`;
  async function loadModules() {
    const m = await api('/api/modules');
    const stand = new Set(m.standby); const prot = new Set(m.protected);
    const btns = [...document.querySelectorAll('nav button[data-tab]')];
    md.querySelector('#mdList').innerHTML = btns.map((b) => { const t = b.dataset.tab; const label = b.textContent.replace(/\s+\d+$/, '').trim(); return `<label class="md-item ${prot.has(t) ? 'lock' : ''}"><input type="checkbox" data-tab="${esc(t)}" ${stand.has(t) ? '' : 'checked'} ${prot.has(t) ? 'disabled' : ''} /><span>${esc(label)}</span>${prot.has(t) ? '<small>sempre ligada</small>' : ''}</label>`; }).join('');
  }
  md.addEventListener('change', async (e) => {
    if (!e.target.dataset.tab) return;
    const off = [...md.querySelectorAll('#mdList input[data-tab]:not(:checked):not(:disabled)')].map((i) => i.dataset.tab);
    try {
      const r = await api('/api/modules', { method: 'PUT', body: { standby: off } });
      window.standbyTabs = new Set(r.standby);
      document.querySelectorAll('nav button[data-tab]').forEach((b) => { b.hidden = window.standbyTabs.has(b.dataset.tab) || (b.hasAttribute('data-staff') && !(window.currentUser?.role === 'admin' || window.currentUser?.manager) ? true : b.hasAttribute('data-cash') && !window.currentUser?.cashAccess); });
      toast(e.target.checked ? 'Tela ligada de volta' : 'Tela em standby');
    } catch (err) { toast(err.message, true); e.target.checked = !e.target.checked; }
  });
  loaders.modules = () => loadModules().catch((e) => toast(e.message, true));
})();
