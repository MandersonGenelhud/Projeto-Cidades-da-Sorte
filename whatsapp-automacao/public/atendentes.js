// Aba "Atendentes": conversas e funil separados por pessoa.
// Computador: uma coluna por atendente, tudo numa tela. Celular: cartões grandes, toque abre a pessoa e depois a conversa.
(() => {
  const host = document.querySelector('#tab-conversations')?.parentElement;
  if (!host) return;
  const sec = document.createElement('section');
  sec.id = 'tab-attendants';
  sec.className = 'tab';
  sec.innerHTML = `
    <div class="page-head"><h1>👥 Atendentes</h1><button class="btn" id="attRefresh">🔄 Atualizar</button></div>
    <p class="hint att-intro">Cada pessoa com as suas conversas e o seu funil, do primeiro contato até o fechamento, e de onde veio cada cliente.</p>
    <div id="attBody"></div>`;
  host.appendChild(sec);
  const body = sec.querySelector('#attBody');
  const mobile = window.matchMedia('(max-width: 800px)');
  let data = null;
  const view = { att: null, conv: null }; // celular: qual atendente / conversa está aberta
  const money = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
  const ago = (iso) => {
    const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
    return m < 1 ? 'agora' : m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.round(m / 60)} h` : `há ${Math.round(m / 1440)} d`;
  };
  const STEPS = [['conversas', 'Conversas', '💬'], ['prospectos', 'Viraram prospecto', '🗂️'], ['contato', 'Em contato', '📞'], ['proposta', 'Receberam proposta', '🧾'], ['fechados', 'Fecharam', '🏆']];

  const funnel = (f) => {
    const max = Math.max(1, f.conversas, f.prospectos);
    return `<div class="att-funnel">${STEPS.map(([k, label, icon], i) => {
      const prev = i ? f[STEPS[i - 1][0]] : 0;
      return `<div class="att-step"><div class="att-step-top"><span>${icon} ${label}</span><b>${f[k]}</b></div>
        <div class="att-bar"><i style="width:${Math.max(f[k] ? 4 : 0, Math.round((f[k] / max) * 100))}%"></i></div>${i >= 2 ? `<small>${pct(f[k], prev)} de quem estava na etapa anterior</small>` : ''}</div>`;
    }).join('')}
      <div class="att-foot"><span>✅ ${money(f.valorFechado)} fechado</span><span>❌ ${f.perdidos} perdido(s)</span></div></div>`;
  };
  const sources = (list) => (list.length
    ? `<div class="att-sources">${list.map((s) => `<span class="chip">${esc(s.label)}: <b>${s.leads}</b>${s.fechados ? ` · 🏆 ${s.fechados}` : ''}</span>`).join('')}</div>`
    : '<p class="hint">Sem clientes cadastrados ainda.</p>');
  const convItem = (a, c) => `<button type="button" class="att-conv" data-att="${esc(a.id)}" data-key="${esc(c.key)}">
      <div class="att-conv-top"><b>${c.channel === 'ig' ? '📸' : '💬'} ${esc(c.name || c.phone || c.key)}</b><small>${esc(ago(c.updatedAt))}</small></div>
      <div class="att-last">${c.lastRole === 'user' ? '' : '🤖 '}${esc(c.lastText)}</div>${c.handoff ? '<span class="badge paused">humano</span>' : ''}</button>`;
  const kindLabel = { admin: 'Administrador', vendedor: 'Vendedor', canal: 'Canal' };

  function chat(c) {
    return `<div class="att-chatbar"><b>${esc(c.name || fmtPhone(c.phone) || '')}</b> <small>${esc(fmtPhone(c.phone) || '')}</small>
        <div class="hint">${c.handoff ? '🙋 Atendimento humano' : '🤖 Robô atendendo'}</div></div>
      <div class="chat att-chat">${c.messages.map((m) => chatBubble(m.role, m.content, m.at)).join('')}</div>
      <button type="button" class="btn" id="attOpenConv">Abrir na tela de Conversas (responder, assumir)</button>`;
  }
  async function loadChat(key, into) {
    into.innerHTML = '<p class="muted">Carregando…</p>';
    try {
      const c = await api(`/api/conversations/${encodeURIComponent(key)}`);
      into.innerHTML = chat(c);
      const box = into.querySelector('.att-chat');
      box.scrollTop = box.scrollHeight;
      into.querySelector('#attOpenConv').onclick = () => { currentConv = key; showTab('conversations'); };
    } catch (e) { into.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }

  function renderDesktop() {
    body.innerHTML = `<div class="panel att-summary"><h2>Funil geral</h2><div class="att-summary-grid">${funnel(data.total)}<div><h3>De onde vieram os clientes</h3>${sources(data.sources)}</div></div></div>
      <div class="att-cols">${data.attendants.map((a) => `<div class="panel att-col"><div class="att-col-head"><h2>${esc(a.name)}</h2><small>${kindLabel[a.kind]}</small></div>
        ${funnel(a.funnel)}${sources(a.sources)}<h3>Conversas (${a.funnel.conversas})</h3><div class="att-convs">${a.conversations.map((c) => convItem(a, c)).join('') || '<p class="hint">Nenhuma conversa.</p>'}</div></div>`).join('')}</div>
      <div class="att-drawer" id="attDrawer" hidden><button type="button" class="btn small" id="attClose">✕ Fechar</button><div id="attDrawerBody"></div></div>`;
    body.querySelector('#attClose').onclick = () => (body.querySelector('#attDrawer').hidden = true);
  }
  function renderMobile() {
    const a = data.attendants.find((x) => x.id === view.att);
    if (!a) {
      body.innerHTML = `<div class="att-m-list"><button type="button" class="att-m-card att-m-total" data-open-total>📊 Funil de todos <small>${data.total.conversas} conversas · ${data.total.fechados} fechados</small></button>
        ${data.attendants.map((x) => `<button type="button" class="att-m-card" data-open="${esc(x.id)}"><b>${esc(x.name)}</b><small>${kindLabel[x.kind]}</small>
          <div class="att-m-nums"><span>💬 ${x.funnel.conversas}</span><span>🗂️ ${x.funnel.prospectos}</span><span>🏆 ${x.funnel.fechados}</span></div></button>`).join('')}</div>`;
      return;
    }
    if (view.att === '__total') {
      body.innerHTML = `<button type="button" class="btn att-back" id="attBack">← Voltar</button><div class="panel"><h2>Funil de todos</h2>${funnel(data.total)}<h3>De onde vieram</h3>${sources(data.sources)}</div>`;
      return;
    }
    if (view.conv) {
      body.innerHTML = '<button type="button" class="btn att-back" id="attBack">← Voltar para ' + esc(a.name) + '</button><div class="panel" id="attMChat"></div>';
      loadChat(view.conv, body.querySelector('#attMChat'));
      return;
    }
    body.innerHTML = `<button type="button" class="btn att-back" id="attBack">← Todos os atendentes</button><div class="panel"><h2>${esc(a.name)}</h2>${funnel(a.funnel)}<h3>De onde vieram</h3>${sources(a.sources)}</div>
      <h2 class="att-h2">Conversas (${a.funnel.conversas})</h2><div class="att-convs">${a.conversations.map((c) => convItem(a, c)).join('') || '<p class="hint">Nenhuma conversa.</p>'}</div>`;
  }
  function render() {
    if (!data) return;
    if (mobile.matches) renderMobile(); else renderDesktop();
  }
  // Tudo é um toque só: delegação de cliques para os dois layouts.
  body.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('#attBack')) {
      if (view.conv) view.conv = null; else view.att = null;
      render(); window.scrollTo(0, 0); return;
    }
    const total = t.closest('[data-open-total]');
    if (total) { view.att = '__total'; render(); window.scrollTo(0, 0); return; }
    const open = t.closest('[data-open]');
    if (open) { view.att = open.dataset.open; view.conv = null; render(); window.scrollTo(0, 0); return; }
    const conv = t.closest('.att-conv');
    if (conv) {
      if (mobile.matches) { view.att = conv.dataset.att; view.conv = conv.dataset.key; render(); window.scrollTo(0, 0); } else {
        const d = body.querySelector('#attDrawer'); d.hidden = false;
        body.querySelectorAll('.att-conv').forEach((x) => x.classList.toggle('active', x === conv));
        loadChat(conv.dataset.key, d.querySelector('#attDrawerBody'));
      }
    }
  });
  mobile.addEventListener('change', render);
  async function load() {
    data = await api('/api/attendants');
    render();
  }
  sec.querySelector('#attRefresh').onclick = () => load().catch((e) => toast(e.message, true));
  loaders.attendants = () => load().catch((e) => { body.innerHTML = `<p class="err">${esc(e.message)}</p>`; });
})();
