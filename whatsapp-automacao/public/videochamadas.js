// Aba "Videochamadas": quem atende liga/desliga e avisa dias sem atendimento; o administrador define regras e quem atende.
(() => {
  const host = document.querySelector('#tab-lots')?.parentElement;
  if (!host) return;
  const sec = document.createElement('section');
  sec.id = 'tab-video';
  sec.className = 'tab';
  host.appendChild(sec);
  const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const br = (d) => d.split('-').reverse().join('/');
  const bookingsTable = (list, canCancel) => `<div class="table-wrap"><table><thead><tr><th>Quando</th><th>Cliente</th><th>Quem atende</th><th></th></tr></thead><tbody>${list.map((b) => `<tr><td><b>${esc(br(b.date))} às ${esc(b.time)}</b><div class="hint">${esc(String(b.durationMin))} min</div></td><td>${esc(b.name || '—')}<div class="hint">${esc(b.phone ? `+${b.phone}` : '')}${b.people ? ` · ${esc(String(b.people))} pessoa(s)` : ''}</div>${b.notes ? `<div class="hint">${esc(b.notes)}</div>` : ''}</td><td>${esc(b.hostName)}</td><td>${canCancel ? `<button class="btn small danger" data-a="cancel" data-id="${esc(b.id)}">Cancelar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nenhuma videochamada marcada.</td></tr>'}</tbody></table></div>`;

  async function render() {
    const admin = window.currentUser?.role === 'admin';
    const me = await api('/api/videocall/me').catch(() => ({ host: false }));
    let html = `<div class="page-head"><h1>Videochamadas</h1></div>
      <p class="hint">Quando o cliente diz que vai falar com marido, esposa ou família, a IA convida para uma videochamada de ${esc(String(me.config?.durationMin || 40))} minutos com um consultor. Os horários ficam espaçados, domingo não tem atendimento e sábado é só de manhã.</p>`;
    if (me.host) {
      html += `<div class="panel"><h2>Minha disponibilidade</h2>
        <label class="check"><input type="checkbox" id="vcActive" ${me.active ? 'checked' : ''}/> Estou disponível para videochamadas</label>
        <div class="row"><button class="btn" data-a="tomorrow">Amanhã eu não posso atender por vídeo</button><input type="date" id="vcDate" /><button class="btn" data-a="offdate">Avisar este dia</button></div>
        <p class="hint">Dias sem atendimento: ${me.offDates.length ? me.offDates.map((d) => `<span class="chip">${esc(br(d))} <a href="#" data-a="clear" data-d="${esc(d)}">tirar</a></span>`).join(' ') : 'nenhum'}. Nesses dias a IA não marca nada.</p>
        ${me.needsReschedule.length ? `<div class="alert">Atenção: há ${me.needsReschedule.length} cliente(s) marcados em dia sem atendimento. Avise e remarque.</div>` : ''}
        <h3>Minhas próximas videochamadas</h3>${bookingsTable(me.bookings, true)}</div>`;
    }
    if (admin) {
      const v = await api('/api/videocall');
      const c = v.config;
      html += `<div class="panel"><h2>Quem faz as videochamadas</h2>
        <div class="table-wrap"><table><tbody>${v.candidates.map((u) => { const h = v.hosts.find((x) => x.id === u.id); return `<tr><td>${esc(u.name)}</td><td>${h ? `<span class="chip">${h.active ? 'disponível' : 'indisponível'}${h.offDates.length ? ` · folga: ${h.offDates.map(br).join(', ')}` : ''}</span>` : ''}</td><td><button class="btn small ${h ? '' : 'primary'}" data-a="host" data-id="${esc(u.id)}" data-on="${h ? 0 : 1}">${h ? 'Tirar da lista' : 'Passou a fazer videochamadas'}</button></td></tr>`; }).join('')}</tbody></table></div></div>
        <div class="panel"><h2>Regras da agenda</h2>
        <label class="check"><input type="checkbox" id="cfgOn" ${c.enabled ? 'checked' : ''}/> IA pode marcar videochamadas</label>
        <div class="grid2"><label>Duração (minutos)<input type="number" id="cfgDur" value="${c.durationMin}" /></label><label>Distância entre um começo e outro (minutos)<input type="number" id="cfgGap" value="${c.gapMin}" /></label><label>Antecedência mínima (minutos)<input type="number" id="cfgAdv" value="${c.minAdvanceMin}" /></label><label>Marcar com até (dias)<input type="number" id="cfgMax" value="${c.maxDaysAhead}" /></label><label>Valor da videochamada (R$, pago antes; 0 = grátis)<input type="number" id="cfgFee" value="${c.fee}" /></label><label>Segurar o horário esperando o pagamento (minutos)<input type="number" id="cfgHold" value="${c.holdMin}" /></label></div>
        <label>Link da sala (Google Meet) enviado ao cliente<input id="cfgLink" value="${esc(c.meetLink)}" placeholder="https://meet.google.com/..." /></label>
        <h3>Horários de cada dia (deixe vazio para não atender)</h3>
        ${DAYS.map((n, i) => `<label>${n}<input data-h="${i}" value="${esc(c.hours[i] || '')}" placeholder="09:00-12:00, 14:00-18:00" /></label>`).join('')}
        <button class="btn primary" data-a="saveCfg">Salvar regras</button></div>
        <div class="panel"><h2>Todas as próximas videochamadas</h2>${v.needsReschedule.length ? `<div class="alert">${v.needsReschedule.length} marcada(s) em dia sem atendimento: avise o cliente e remarque.</div>` : ''}${bookingsTable(v.upcoming, true)}</div>`;
    }
    if (!admin && !me.host) html += '<p class="muted">Você não está na lista de quem faz videochamadas.</p>';
    sec.innerHTML = html;
  }

  sec.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-a]');
    if (!t) return;
    e.preventDefault();
    const a = t.dataset.a;
    try {
      if (a === 'tomorrow') { await api('/api/videocall/me', { method: 'POST', body: { tomorrowOff: true } }); toast('Pronto: amanhã a IA não marca videochamadas'); }
      else if (a === 'offdate') { const d = sec.querySelector('#vcDate').value; if (!d) return toast('Escolha o dia', true); await api('/api/videocall/me', { method: 'POST', body: { offDate: d } }); toast('Dia avisado'); }
      else if (a === 'clear') await api('/api/videocall/me', { method: 'POST', body: { clearDate: t.dataset.d } });
      else if (a === 'host') await api('/api/videocall/hosts', { method: 'POST', body: { userId: t.dataset.id, on: t.dataset.on === '1' } });
      else if (a === 'cancel') { if (!confirm('Cancelar esta videochamada? Avise o cliente.')) return; await api(`/api/videocall/${t.dataset.id}/cancel`, { method: 'POST', body: {} }); }
      else if (a === 'saveCfg') {
        const hours = {}; sec.querySelectorAll('[data-h]').forEach((i) => { hours[i.dataset.h] = i.value.trim(); });
        await api('/api/videocall/config', { method: 'PUT', body: { enabled: sec.querySelector('#cfgOn').checked, durationMin: sec.querySelector('#cfgDur').value, gapMin: sec.querySelector('#cfgGap').value, minAdvanceMin: sec.querySelector('#cfgAdv').value, maxDaysAhead: sec.querySelector('#cfgMax').value, fee: sec.querySelector('#cfgFee').value, holdMin: sec.querySelector('#cfgHold').value, meetLink: sec.querySelector('#cfgLink').value, hours } });
        toast('Regras salvas');
      }
      await render();
    } catch (err) { toast(err.message, true); }
  });
  sec.addEventListener('change', async (e) => {
    if (e.target.id !== 'vcActive') return;
    try { await api('/api/videocall/me', { method: 'POST', body: { active: e.target.checked } }); toast(e.target.checked ? 'Você está disponível' : 'Você está indisponível: a IA não marca videochamadas'); await render(); } catch (err) { toast(err.message, true); }
  });
  loaders.video = () => render().catch((e) => toast(e.message, true));

  // Quem atende (não administrador) também vê a aba.
  const t0 = setInterval(async () => {
    if (!window.currentUser) return;
    clearInterval(t0);
    if (window.currentUser.role === 'admin') return;
    const me = await api('/api/videocall/me').catch(() => null);
    const btn = document.querySelector('nav button[data-tab="video"]');
    if (me?.host && btn) { btn.removeAttribute('data-admin'); btn.hidden = false; }
  }, 400);
})();
