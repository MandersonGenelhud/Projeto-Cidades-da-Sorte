// Conversas: auditoria dos números (quem recebe, quem responde, quem está sem resposta e por quê), mapa de mensagens por cliente e por dia,
// e a configuração de envio de cada número (limite por hora e por dia, intervalo, horário e ritmo humano). Só administrador.
(() => {
  const tab = document.querySelector('#tab-conversations');
  const layout = tab?.querySelector('.conv-layout');
  if (!tab || !layout) return;
  const wrap = document.createElement('div');
  wrap.id = 'auditWrap';
  wrap.hidden = true;
  wrap.innerHTML = `
    <details class="panel" id="auditPanel"><summary><b>Auditoria dos números e mapa de mensagens</b></summary><div id="auditBody" class="muted">Carregando…</div></details>
    <details class="panel" id="sendPanel"><summary><b>Envio de cada número (limites e ritmo humano)</b></summary><div id="sendBody" class="muted">Carregando…</div></details>`;
  layout.parentElement.insertBefore(wrap, layout);
  const REASON = { pausada: 'conversa pausada', modo_teste: 'modo de teste', ia_desligada: 'IA desligada', ia_desligada_numero: 'IA desligada no número', sem_chave: 'sem chave da IA', bloqueado: 'bloqueado', desconectado: 'desconectado', instagram_24h: 'passou de 24h (Instagram)', na_fila: 'na fila' };
  const wait = (m) => (m >= 1440 ? `${Math.floor(m / 1440)} d` : m >= 60 ? `${Math.floor(m / 60)} h` : `${m} min`);
  const mon = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const state = { sender: '', days: 14 };

  async function loadAudit() {
    const q = `days=${state.days}${state.sender ? `&sender=${encodeURIComponent(state.sender)}` : ''}`;
    const r = await api(`/api/audit/messaging?${q}`);
    const lvl = { critico: 'danger', aviso: 'pending', info: 'paused', ok: 'ok' };
    const dayHead = r.days.map((d) => `<th title="${esc(d)}">${esc(d.slice(8))}/${esc(d.slice(5, 7))}</th>`).join('');
    $('#auditBody').innerHTML = `
      <div>${r.findings.map((f) => `<p><span class="badge ${lvl[f.level] || 'paused'}">${esc(f.level)}</span> ${esc(f.text)}</p>`).join('')}</div>
      <div class="table-wrap"><table><thead><tr><th>Número</th><th>Conectado</th><th>Recebidas</th><th>Enviadas</th><th>Sem resposta</th><th>Envio configurado</th></tr></thead><tbody>
      ${r.senders.map((s) => `<tr><td><b>${esc(s.label)}</b></td><td>${s.connected ? 'sim' : '<b>não</b>'}</td><td>${s.inbound}</td><td>${s.outbound}</td>
        <td>${s.unanswered ? `<b>${s.unanswered}</b> (a mais antiga há ${esc(wait(s.oldestWaitMin))})<br><span class="meta">${Object.entries(s.reasons).map(([k, n]) => `${n} ${esc(REASON[k] || k)}`).join(' · ')}</span>` : '0'}</td>
        <td class="meta">${s.profile.perHour}/hora${s.profile.dailyLimit ? `, ${s.profile.dailyLimit}/dia` : ''}, ${s.profile.from}h às ${s.profile.to}h, intervalo ${s.profile.gap[0]}-${s.profile.gap[1]}s${s.profile.custom ? ' (próprio)' : ' (padrão)'}</td></tr>`).join('')}
      </tbody></table></div>
      <h3>Mapa de mensagens por cliente</h3>
      <div class="row"><label>Número <select id="auditSender"><option value="">Todos</option>${r.senders.map((s) => `<option value="${esc(s.key)}" ${state.sender === s.key ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></label>
        <label>Dias <select id="auditDays">${[7, 14, 30, 60].map((n) => `<option ${state.days === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <span class="meta">${r.mapTotal} cliente(s) com movimento${r.mapTotal > r.map.length ? ` (mostrando ${r.map.length})` : ''}. Cada dia mostra recebidas/enviadas.</span></div>
      <div class="table-wrap"><table class="audit-map"><thead><tr><th>Cliente</th><th>Responsável</th><th>Situação</th><th>Rec.</th><th>Env.</th>${dayHead}</tr></thead><tbody>
      ${r.map.map((m) => `<tr class="${m.waiting ? 'row-wait' : ''}"><td><b>${esc(m.name || m.phone || m.key)}</b> <span class="chan">${m.channel === 'ig' ? 'IG' : 'WA'}</span>${m.waiting ? `<br><span class="meta">esperando há ${esc(wait(m.waitMin))}: ${esc(m.why)}</span>` : ''}</td>
        <td>${esc(m.owner || '—')}</td>
        <td>${m.closed ? `<span class="badge ok">fechou ${esc(mon(m.value))}</span>` : m.lost ? '<span class="badge paused">perdido</span>' : esc(m.stageLabel || 'sem prospecto')}</td>
        <td>${m.in}</td><td>${m.out}</td>
        ${m.perDay.map((d) => `<td class="${d.in || d.out ? 'has' : ''}">${d.in || d.out ? `${d.in}/${d.out}` : ''}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${5 + r.days.length}" class="muted">Sem movimento neste período.</td></tr>`}
      </tbody></table></div>`;
  }

  const FIELDS = [['perHour', 'Respostas por hora', 1], ['dailyLimit', 'Por dia (0 = sem limite)', 0], ['minGapSec', 'Intervalo mínimo (s)', 0], ['maxGapSec', 'Intervalo máximo (s)', 0], ['from', 'Começa às (h)', 0], ['to', 'Termina às (h)', 1], ['noticeMin', '"Vendo" mínimo (s)', 0], ['noticeMax', '"Vendo" máximo (s)', 0], ['typingCharsPerSecond', 'Digitação (letras/s)', 2], ['maxTypingSeconds', 'Digitando, no máximo (s)', 2]];
  async function loadSend() {
    const r = await api('/api/send-profiles');
    $('#sendBody').innerHTML = `<p class="hint">Cada número tem o seu próprio limite e ritmo: o limite de um nunca é dividido com os outros. Campo vazio = usa o padrão geral. "Vendo" é o tempo até a atendente aparecer lendo; "digitação" é a velocidade do "escrevendo…" (menos letras por segundo = mais devagar, como uma pessoa).</p>
      ${r.senders.map((s) => `<form class="card send-form" data-key="${esc(s.key)}"><h3>${esc(s.label)} ${s.effective.custom ? '<span class="badge pending">configurado</span>' : '<span class="badge paused">padrão geral</span>'}</h3>
        <div class="grid3">${FIELDS.map(([k, label, min]) => `<label>${esc(label)}<input type="number" min="${min}" name="${k}" value="${s.own[k] ?? ''}" placeholder="${esc(k === 'perHour' ? s.effective.perHour : k === 'from' ? s.effective.from : k === 'to' ? s.effective.to : k === 'minGapSec' ? s.effective.gap[0] : k === 'maxGapSec' ? s.effective.gap[1] : k === 'dailyLimit' ? 'sem limite' : (s.effective.humanize[k] ?? 'padrão'))}" /></label>`).join('')}</div>
        <button class="btn small primary">Salvar este número</button> <button type="button" class="btn small" data-reset>Voltar ao padrão</button></form>`).join('')}`;
  }

  $('#auditPanel').addEventListener('toggle', (e) => { if (e.target.open) loadAudit().catch((err) => toast(err.message, true)); });
  $('#sendPanel').addEventListener('toggle', (e) => { if (e.target.open) loadSend().catch((err) => toast(err.message, true)); });
  wrap.addEventListener('change', (e) => {
    if (e.target.id === 'auditSender') { state.sender = e.target.value; loadAudit().catch((err) => toast(err.message, true)); }
    if (e.target.id === 'auditDays') { state.days = Number(e.target.value); loadAudit().catch((err) => toast(err.message, true)); }
  });
  wrap.addEventListener('submit', async (e) => {
    const f = e.target.closest('.send-form');
    if (!f) return;
    e.preventDefault();
    try {
      await api(`/api/send-profiles/${encodeURIComponent(f.dataset.key)}`, { method: 'PUT', body: Object.fromEntries(new FormData(f)) });
      toast('Envio deste número salvo');
      loadSend();
    } catch (err) { toast(err.message, true); }
  });
  wrap.addEventListener('click', async (e) => {
    const f = e.target.closest('.send-form');
    if (!f || !e.target.closest('[data-reset]')) return;
    try { await api(`/api/send-profiles/${encodeURIComponent(f.dataset.key)}`, { method: 'PUT', body: {} }); toast('Voltou ao padrão geral'); loadSend(); } catch (err) { toast(err.message, true); }
  });
  // Só o administrador vê (o servidor também recusa os outros).
  const show = () => { wrap.hidden = window.currentUser?.role !== 'admin'; };
  new MutationObserver(show).observe(tab, { attributes: true, attributeFilter: ['class'] });
  show();
})();
