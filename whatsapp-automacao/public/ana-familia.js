// Aba "Ana e casa" (só administrador): cadastra a pessoa da casa (ex.: a esposa) que usa a Ana pelo mesmo número da Maria.
(() => {
  const host = document.querySelector('#tab-lots')?.parentElement;
  if (!host) return;
  const sec = document.createElement('section');
  sec.id = 'tab-anafam';
  sec.className = 'tab';
  host.appendChild(sec);
  async function render() {
    sec.innerHTML = '<div class="page-head"><h1>Ana e a casa</h1></div><p class="muted">Carregando…</p>';
    let r;
    let cfg; try { r = await api('/api/ana/family'); cfg = await api('/api/ana'); } catch (e) { sec.innerHTML = `<div class="page-head"><h1>Ana e a casa</h1></div><p class="muted">${esc(e.message)}</p>`; return; }
    sec.innerHTML = `<div class="page-head"><h1>Ana e a casa</h1></div>
      <p class="hint">Cadastre quem mora com você para usar a Ana pelo <b>mesmo número da Maria</b>, sem acesso ao painel nem à empresa. Cada um tem a <b>própria agenda e o próprio financeiro</b> (contas da casa e pessoais separadas). Só duas coisas são divididas entre as duas pessoas ligadas: a <b>lista de compras</b> (uma só) e os <b>avisos</b> ("a Carol adicionou um lembrete para você"). O 9º dígito do celular não atrapalha. A pessoa precisa saber e concordar em usar. Ela escreve "Ana, ..." no WhatsApp da Maria.</p>
      <div class="panel"><h2>Pessoas da casa</h2>
        ${r.list.map((f) => `<div class="item" data-id="${esc(f.id)}"><div class="grow"><b>${esc(f.name)}</b> · +${esc(f.whatsapp)}<div class="meta">Ligada à Ana de ${esc(f.linkedName || '—')}</div></div><button class="btn small danger" data-del="${esc(f.id)}" type="button">Remover</button></div>`).join('') || '<p class="muted">Ninguém cadastrado ainda.</p>'}
      </div>
      <div class="panel"><h2>Quem pode usar a Ana</h2>
        <p class="hint">Cada pessoa marcada tem a <b>própria Ana</b>, com agenda, lembretes (de hoje até 30 anos), anotações e financeiro só dela. Para usar, ela escreve "Ana, ..." no WhatsApp da Maria. A pessoa precisa ter o WhatsApp cadastrado na Equipe.</p>
        ${cfg.people.map((p) => `<label class="check"><input type="checkbox" data-anauser="${esc(p.id)}" ${p.allowed ? 'checked' : ''} ${p.whatsapp ? '' : 'disabled'} /> ${esc(p.name)}${p.whatsapp ? '' : ' (sem WhatsApp na Equipe)'}</label>`).join('')}
        <button class="btn primary" id="auSave" type="button">Salvar quem usa a Ana</button></div>
      <div class="panel"><h2>Mesma pasta da Ana (duas pessoas da equipe)</h2>
        <p class="hint">Para quem já está na Equipe (ex.: a Silvani e o Marcos): as duas pessoas falam com a <b>mesma Ana</b> e usam <b>uma pasta só</b>: mesma agenda, mesmas anotações e mesmo financeiro pessoal. O que a pessoa já tinha guardado é juntado na pasta comum. O Manderson e o Marcos continuam com pastas separadas.</p>
        ${(r.joint || []).map((j) => `<div class="item"><div class="grow"><b>${esc(j.name)}</b> usa a mesma pasta de <b>${esc(j.withName)}</b></div><button class="btn small danger" data-unjoint="${esc(j.userId)}" type="button">Separar</button></div>`).join('') || '<p class="muted">Nenhuma pasta dividida.</p>'}
        <label>Pessoa que vai usar a pasta de outra <select id="ajUser">${(r.team || r.people).map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label>
        <label>Dona da pasta (a Ana de quem) <select id="ajWith">${(r.team || r.people).map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label>
        <button class="btn primary" id="ajAdd" type="button">Dividir a pasta</button></div>
      <div class="panel"><h2>Adicionar</h2>
        <label>Nome <input id="afName" maxlength="60" placeholder="Ex.: Carol" /></label>
        <label>WhatsApp com DDD <input id="afPhone" placeholder="+55 69 99287-6716" /></label>
        <label>Ligada à Ana de <select id="afOwner">${r.people.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label>
        <button class="btn primary" id="afAdd" type="button">Cadastrar</button></div>`;
    sec.querySelector('#afAdd').addEventListener('click', async () => {
      try { await api('/api/ana/family', { method: 'POST', body: { name: sec.querySelector('#afName').value, whatsapp: sec.querySelector('#afPhone').value, linkedUserId: sec.querySelector('#afOwner').value } }); toast('Cadastrada. Avise-a para escrever "Ana, ..." no WhatsApp da Maria.'); render(); } catch (e) { toast(e.message, true); }
    });
    sec.querySelector('#auSave').addEventListener('click', async () => {
      const users = [...sec.querySelectorAll('[data-anauser]')].filter((c) => c.checked).map((c) => c.dataset.anauser);
      try { await api('/api/ana', { method: 'PUT', body: { users } }); toast('Salvo.'); render(); } catch (e) { toast(e.message, true); }
    });
    sec.querySelector('#ajAdd').addEventListener('click', async () => {
      try { const x = await api('/api/ana/joint', { method: 'POST', body: { userId: sec.querySelector('#ajUser').value, withUserId: sec.querySelector('#ajWith').value } }); toast('Pronto: as duas pessoas usam a mesma pasta da Ana.'); render(); } catch (e) { toast(e.message, true); }
    });
    sec.querySelectorAll('[data-unjoint]').forEach((b) => b.addEventListener('click', async () => { if (!confirm('Separar as pastas? O que já foi guardado fica na pasta do dono; a outra pessoa recomeça com uma pasta vazia.')) return; try { await api(`/api/ana/joint/${b.dataset.unjoint}`, { method: 'DELETE' }); render(); } catch (e) { toast(e.message, true); } }));
    sec.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { if (!confirm('Remover esta pessoa da Ana? A agenda dela continua guardada, mas ela deixa de usar.')) return; try { await api(`/api/ana/family/${b.dataset.del}`, { method: 'DELETE' }); render(); } catch (e) { toast(e.message, true); } }));
  }
  loaders.anafam = () => render().catch((e) => toast(e.message, true));
})();
