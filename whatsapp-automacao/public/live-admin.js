// Aba "Live": frase de em breve / ao vivo, link do Meet e grupos de WhatsApp da página pública.
(() => {
  const host = document.querySelector('#tab-lots')?.parentElement;
  if (!host) return;
  const sec = document.createElement('section');
  sec.id = 'tab-livepage';
  sec.className = 'tab';
  host.appendChild(sec);
  const ST = { off: 'Desligada', soon: 'Em breve', live: 'AO VIVO', ended: 'Encerrada' };
  let cfg;
  const groupRow = (g = {}) => `<div class="row" data-g><input data-n placeholder="Nome do grupo" value="${esc(g.name || '')}" /><input data-u placeholder="https://chat.whatsapp.com/..." value="${esc(g.url || '')}" /><button class="btn small" data-a="rmg">Tirar</button></div>`;
  async function render() {
    cfg = await api('/api/live');
    sec.innerHTML = `<div class="page-head"><h1>Live</h1></div>
      <p class="hint">Página pública onde o cliente entra na live pelo Google Meet e nos grupos de WhatsApp. Situação agora: <b>${esc(ST[cfg.status] || cfg.status)}</b>. O link da sala só aparece na página quando você aperta "Estamos ao vivo".</p>
      <div class="panel"><div class="row"><button class="btn" data-a="st" data-s="soon">Vamos entrar em breve</button><button class="btn primary" data-a="st" data-s="live">Estamos ao vivo</button><button class="btn" data-a="st" data-s="ended">Encerrar</button><button class="btn" data-a="st" data-s="off">Desligar página</button></div>
      <p>Endereço da página para divulgar: <b>${esc(cfg.pageUrl)}</b> <button class="btn small" data-a="copy">Copiar</button></p></div>
      <div class="panel"><h2>Link para fechar pelo WhatsApp</h2><p>Cada clique vai para um vendedor diferente, em rodízio, direto no WhatsApp dele. Esse botão já aparece na página da live. Para divulgar à parte: <b>${esc(cfg.closeUrl)}</b> <button class="btn small" data-a="copyclose">Copiar</button></p><div id="lkStats" class="hint"></div></div>
      <div class="panel"><h2>Dados da live</h2>
        <label>Título<input id="lvTitle" value="${esc(cfg.title)}" /></label>
        <label>Dia e horário<input type="datetime-local" id="lvWhen" value="${esc(cfg.startsAt)}" /></label>
        <label>Link da sala do Google Meet<input id="lvMeet" value="${esc(cfg.meetLink)}" placeholder="https://meet.google.com/abc-defg-hij" /></label>
        <label>Frase de "em breve"<input id="lvSoon" value="${esc(cfg.soonText)}" /></label>
        <label>Frase de "ao vivo"<input id="lvLive" value="${esc(cfg.liveText)}" /></label>
        <label>Frase de "encerrada"<input id="lvEnd" value="${esc(cfg.endedText)}" /></label>
        <h3>Grupos de WhatsApp</h3><div id="lvGroups">${(cfg.groups.length ? cfg.groups : [{}]).map(groupRow).join('')}</div>
        <div class="row"><button class="btn" data-a="addg">Mais um grupo</button><button class="btn primary" data-a="save">Salvar</button></div>
        <p class="hint">Dica: no Meet, deixe a entrada com aprovação do anfitrião para evitar intrusos. Os links de grupo são endereços públicos de convite, não são senhas.</p></div>`;
  }
  async function stats() { try { const r = await api('/api/links/stats'); const el = sec.querySelector('#lkStats'); if (el) el.textContent = `Cliques no total: ${r.total}. ${r.sellers.map((x) => `${x.name}: ${x.total} (${x.week} na semana)`).join(' · ')}`; } catch { /* sem estatística */ } }
  const collect = () => ({ title: sec.querySelector('#lvTitle').value, startsAt: sec.querySelector('#lvWhen').value, meetLink: sec.querySelector('#lvMeet').value, soonText: sec.querySelector('#lvSoon').value, liveText: sec.querySelector('#lvLive').value, endedText: sec.querySelector('#lvEnd').value, groups: [...sec.querySelectorAll('[data-g]')].map((r) => ({ name: r.querySelector('[data-n]').value, url: r.querySelector('[data-u]').value })).filter((g) => g.url.trim() || g.name.trim()) });
  sec.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-a]'); if (!t) return;
    try {
      if (t.dataset.a === 'addg') sec.querySelector('#lvGroups').insertAdjacentHTML('beforeend', groupRow());
      else if (t.dataset.a === 'rmg') t.closest('[data-g]').remove();
      else if (t.dataset.a === 'copyclose') { await navigator.clipboard?.writeText(cfg.closeUrl); toast('Link copiado'); }
      else if (t.dataset.a === 'copy') { await navigator.clipboard?.writeText(cfg.pageUrl); toast('Endereço copiado'); }
      else if (t.dataset.a === 'save') { await api('/api/live', { method: 'PUT', body: collect() }); toast('Salvo'); await render(); }
      else if (t.dataset.a === 'st') { await api('/api/live', { method: 'PUT', body: { ...collect(), status: t.dataset.s } }); toast(`Página: ${ST[t.dataset.s]}`); await render(); }
    } catch (err) { toast(err.message, true); }
  });
  loaders.livepage = () => render().then(stats).catch((e) => toast(e.message, true));
})();
