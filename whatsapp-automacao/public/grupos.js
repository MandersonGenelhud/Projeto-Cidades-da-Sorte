// Aba "Grupos do WhatsApp": quantas pessoas de cada grupo já foram atendidas e quantas ainda não (só leitura).
(() => {
  const host = document.querySelector('#tab-lots')?.parentElement;
  if (!host) return;
  const sec = document.createElement('section');
  sec.id = 'tab-groupscov';
  sec.className = 'tab';
  host.appendChild(sec);
  async function render() {
    sec.innerHTML = `<div class="page-head"><h1>Grupos do WhatsApp</h1></div>
      <p class="hint">Escolha um grupo em que o número principal está. O sistema cruza as pessoas do grupo com as conversas, o CRM e os clientes do sistema antigo e mostra quantas <b>já foram atendidas</b> e quantas <b>ainda não</b>. Só leitura: nada é enviado a ninguém.</p>
      <div class="panel"><div id="gpList" class="muted">Carregando os grupos…</div></div><div id="gpOut"></div>`;
    let groups;
    try { groups = await api('/api/groups'); } catch (e) { sec.querySelector('#gpList').textContent = `${e.message}. Conecte o WhatsApp em Conexão.`; return; }
    sec.querySelector('#gpList').innerHTML = groups.length ? groups.map((g) => `<div class="row"><b>${esc(g.name || 'Grupo')}</b><span class="hint">${esc(String(g.participants))} pessoas</span><button class="btn small" data-a="open" data-id="${esc(g.id)}" data-n="${esc(g.name || '')}">Conferir</button></div>`).join('') : 'Nenhum grupo encontrado neste WhatsApp.';
  }
  sec.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-a="open"]'); if (!t) return;
    const out = sec.querySelector('#gpOut'); out.innerHTML = '<p class="muted">Conferindo…</p>';
    try {
      const r = await api(`/api/groups/${encodeURIComponent(t.dataset.id)}/coverage`);
      const pct = r.total ? Math.round((r.attended / r.total) * 100) : 0;
      out.innerHTML = `<div class="panel"><h2>${esc(t.dataset.n)}</h2><div class="grid2"><div class="card"><div class="hint">No grupo</div><b style="font-size:28px">${r.total}</b></div><div class="card"><div class="hint">Já atendidos</div><b style="font-size:28px">${r.attended}</b> <span class="hint">${pct}%</span></div><div class="card"><div class="hint">Já fecharam conosco</div><b style="font-size:28px">${r.closed || 0}</b></div><div class="card"><div class="hint">Ainda não atendidos</div><b style="font-size:28px">${r.unattended}</b></div></div>
        <div class="row"><a class="btn" href="/api/groups/${encodeURIComponent(t.dataset.id)}/coverage?format=csv">Baixar quem ainda não foi atendido</a></div>
        <div class="table-wrap"><table><thead><tr><th>Telefone</th><th>Situação</th></tr></thead><tbody>${r.members.map((m) => `<tr><td>+${esc(m.phone)}</td><td>${m.closed ? `<span class="chip">Já é cliente (${esc(m.closed)})</span>` : m.attended ? `<span class="chip">Atendido (${esc(m.via)})</span>` : 'Ainda não atendido'}</td></tr>`).join('')}</tbody></table></div></div>`;
    } catch (err) { out.innerHTML = ''; toast(err.message, true); }
  });
  loaders.groupscov = () => render().catch((e) => toast(e.message, true));
})();
