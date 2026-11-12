// Aba "Resgate de conversas": as conversas do número principal (parado) para o dono continuar pelo Hub, respondendo por outro número conectado.
(() => {
  const host = document.querySelector('#tab-lots')?.parentElement;
  if (!host) return;
  const sec = document.createElement('section');
  sec.id = 'tab-rescue';
  sec.className = 'tab';
  host.appendChild(sec);
  const fmt = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
  let state = { q: '', list: [], lines: [], open: null };

  async function loadList() {
    const r = await api(`/api/rescue?q=${encodeURIComponent(state.q)}`);
    state.list = r.list; state.lines = r.lines;
    render();
  }
  async function openThread(key) {
    state.open = await api(`/api/rescue/thread?key=${encodeURIComponent(key)}`);
    render();
    const box = sec.querySelector('#rsThread'); if (box) box.scrollTop = box.scrollHeight;
  }
  function render() {
    const o = state.open;
    sec.innerHTML = `<div class="page-head"><h1>Resgate de conversas</h1></div>
      <p class="hint">As conversas que ficaram no número principal. Clique em uma, leia o histórico e responda por aqui: a resposta sai por um número da equipe que esteja conectado (por padrão, a Central). A conversa continua pelo Hub, e a IA não responde por cima enquanto você estiver conduzindo.</p>
      <div class="grid2" style="align-items:start">
        <div class="panel"><input id="rsQ" placeholder="Buscar por nome, telefone ou assunto" value="${esc(state.q)}" />
          <div style="max-height:62vh;overflow:auto;margin-top:8px">${state.list.map((c) => `<div class="item" data-key="${esc(c.key)}" style="cursor:pointer;${o?.key === c.key ? 'background:var(--hover,#eef)' : ''}"><div class="grow"><b>${esc(c.name || `+${c.phone}`)}</b> ${c.answered ? '<span class="badge pending">respondeu</span>' : c.rescued ? '<span class="badge">retomada</span>' : ''}<div class="meta">${esc(c.last)}</div><div class="meta">${esc(fmt(c.lastAt))} · ${c.count} mensagens</div></div></div>`).join('') || '<p class="muted">Nenhuma conversa encontrada.</p>'}</div></div>
        <div class="panel">${o ? `<h2>${esc(o.name || `+${o.phone}`)} <small class="muted">+${esc(o.phone)}</small></h2>
          <div id="rsThread" style="max-height:44vh;overflow:auto;border:1px solid #ddd;border-radius:10px;padding:8px">${o.messages.map((m) => `<p style="margin:6px 0;padding:8px 10px;border-radius:10px;max-width:90%;${m.role === 'user' ? 'background:#f1f1f1' : 'background:#dcf8c6;margin-left:auto'}"><b>${m.role === 'user' ? 'Cliente' : m.by === 'owner' ? 'Marcos' : 'Atendente'}</b> <small class="muted">${esc(fmt(m.at))}</small><br>${esc(m.text).replace(/\n/g, '<br>')}</p>`).join('')}</div>
          <label>Responder por<select id="rsLine">${state.lines.map((l) => `<option value="${esc(l.id)}" ${l.central ? 'selected' : ''}>${esc(l.label)}${l.central ? ' (Central)' : ''}</option>`).join('') || '<option value="">Nenhum número conectado</option>'}</select></label>
          <textarea id="rsText" rows="3" placeholder="Escreva a resposta ao cliente"></textarea>
          <button class="btn primary" data-a="send" ${state.lines.length ? '' : 'disabled'}>Enviar resposta</button>
          <p class="hint">O cliente recebe a mensagem do número escolhido. Se ele responder, a resposta aparece em Conversas e aqui.</p>` : '<p class="muted">Escolha uma conversa à esquerda.</p>'}</div></div>`;
  }
  sec.addEventListener('click', async (e) => {
    const item = e.target.closest('[data-key]'); const a = e.target.closest('[data-a]');
    try {
      if (item) return await openThread(item.dataset.key);
      if (a?.dataset.a === 'send') {
        const text = sec.querySelector('#rsText').value.trim();
        if (!text) return toast('Escreva a mensagem', true);
        a.disabled = true;
        state.open = await api('/api/rescue/send', { method: 'POST', body: { key: state.open.key, text, lineId: sec.querySelector('#rsLine').value } });
        toast('Mensagem enviada');
        await loadList();
        render();
        const box = sec.querySelector('#rsThread'); if (box) box.scrollTop = box.scrollHeight;
      }
    } catch (err) { toast(err.message, true); render(); }
  });
  let timer = null;
  sec.addEventListener('input', (e) => {
    if (e.target.id !== 'rsQ') return;
    state.q = e.target.value; clearTimeout(timer);
    timer = setTimeout(() => loadList().then(() => { const i = sec.querySelector('#rsQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }).catch(() => {}), 350);
  });
  loaders.rescue = () => loadList().catch((e) => toast(e.message, true));
})();
