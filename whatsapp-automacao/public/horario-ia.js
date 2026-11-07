// Agente IA: horário de trabalho da atendente (padrão: todos os dias, das 7h às 23h). Fora dele a IA não responde; a mensagem espera e a fila
// responde quando o horário abre. Só administrador.
(() => {
  const tab = document.querySelector('#tab-agent');
  if (!tab) return;
  const box = document.createElement('details');
  box.className = 'panel';
  box.id = 'workPanel';
  box.hidden = true;
  box.innerHTML = '<summary><b>Horário de trabalho da atendente de IA</b></summary><div id="workBody" class="muted">Carregando…</div>';
  const h1 = tab.querySelector('h1');
  (h1 ? h1.insertAdjacentElement('afterend', box) : tab.prepend(box));
  const DAYS = [['1', 'Seg'], ['2', 'Ter'], ['3', 'Qua'], ['4', 'Qui'], ['5', 'Sex'], ['6', 'Sáb'], ['0', 'Dom']];
  async function load() {
    const s = await api('/api/settings');
    const w = { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], start: '07:00', end: '23:00', message: '', ...(s.agent?.workHours || {}) };
    $('#workBody').innerHTML = `<form id="workForm" class="form">
      <p class="hint">Com isto ligado, a IA atende só dentro do horário (fuso de Brasília). Quem escrever fora dele não recebe resposta na hora: a mensagem fica esperando em "Clientes esperando resposta" e a IA responde sozinha quando o horário abre, no ritmo seguro de cada número.</p>
      <label class="check"><input type="checkbox" name="enabled" ${w.enabled !== false ? 'checked' : ''} /> Limitar o atendimento ao horário abaixo (desligado = a IA atende 24 horas)</label>
      <div class="row"><label>Começa às <input type="time" name="start" value="${esc(w.start)}" /></label><label>Termina às <input type="time" name="end" value="${esc(w.end)}" /></label></div>
      <div class="row">${DAYS.map(([n, l]) => `<label class="check"><input type="checkbox" name="d${n}" ${w.days.map(String).includes(n) ? 'checked' : ''} /> ${l}</label>`).join('')}</div>
      <label>Aviso para quem escrever fora do horário (opcional, vai uma vez a cada 8 horas; vazio = não avisa) <input name="message" maxlength="300" value="${esc(w.message || '')}" placeholder="Ex.: Olá, {primeiro_nome}! Nosso atendimento volta às 7h. Pode deixar a sua mensagem que respondemos logo cedo." /></label>
      <button class="btn primary">Salvar horário</button></form>`;
  }
  box.addEventListener('toggle', () => { if (box.open) load().catch((e) => toast(e.message, true)); });
  box.addEventListener('submit', async (e) => {
    if (e.target.id !== 'workForm') return;
    e.preventDefault();
    const f = e.target;
    const days = DAYS.map(([n]) => n).filter((n) => f[`d${n}`].checked).map(Number);
    if (!days.length) { toast('Marque pelo menos um dia', true); return; }
    if (f.end.value <= f.start.value) { toast('O horário final precisa ser depois do inicial', true); return; }
    try {
      const [sh] = f.start.value.split(':').map(Number); const [eh, em] = f.end.value.split(':').map(Number);
      await api('/api/settings', { method: 'PUT', body: { agent: { workHours: { enabled: f.enabled.checked, days, start: f.start.value, end: f.end.value, message: f.message.value.trim() }, pendingHours: `${sh}-${em ? eh + 1 : eh}` } } });
      toast('Horário de trabalho da IA salvo');
    } catch (err) { toast(err.message, true); }
  });
  const show = () => { box.hidden = window.currentUser?.role !== 'admin'; };
  new MutationObserver(show).observe(tab, { attributes: true, attributeFilter: ['class'] });
  show();
})();
