// Equipe: assinatura da empresa (CONTRATADA) nos contratos. Dois responsáveis: o 1º (ex.: Eliezer, responsável do escritório) e o 2º (ex.: Marcos, para
// cadastrar depois). A própria pessoa fornece a imagem da assinatura e confirma que autoriza; o sistema nunca desenha nem imita assinatura. Só administrador.
(() => {
  const anchor = document.querySelector('#systemLinks');
  if (!anchor) return;
  const box = document.createElement('details');
  box.className = 'panel';
  box.id = 'signerPanel';
  box.hidden = true;
  box.innerHTML = '<summary><b>Assinatura da empresa nos contratos</b></summary><div id="signerBody" class="muted">Carregando…</div>';
  anchor.parentElement.insertBefore(box, anchor);
  const pending = {}; // imagem escolhida agora por responsável (JPEG em base64), ainda não salva
  const base = (n) => (Number(n) === 2 ? '/api/contract-signer/2' : '/api/contract-signer');
  const PH = { 1: 'Nome completo de quem assina (ex.: Eliezer …)', 2: 'Nome completo de quem assina (ex.: Marcos …)' };

  const card = (m) => `<div class="card" data-slot="${m.slot}">
      <h3>${esc(m.label)}</h3>
      <p>Situação: ${m.active ? '<span class="badge ok">ligada: vai nos contratos</span>' : m.hasImage ? '<span class="badge paused">desligada</span>' : '<span class="badge paused">ainda sem assinatura cadastrada</span>'} ${m.authorizedAt ? `<span class="meta">autorizada por ${esc(m.authorizedBy)} em ${new Date(m.authorizedAt).toLocaleDateString('pt-BR')}</span>` : ''}</p>
      ${m.hasImage ? `<p><img data-img="${m.slot}" alt="Assinatura cadastrada" style="max-width:260px;background:#fff;border:1px solid var(--border);border-radius:8px;padding:6px" /></p>` : ''}
      <form class="form" data-form="${m.slot}">
        <div class="grid2"><label>Nome completo de quem assina pela empresa<input name="name" value="${esc(m.name)}" placeholder="${esc(PH[m.slot])}" required /></label>
        <label>Cargo<input name="role" value="${esc(m.role || (m.slot === 1 ? 'Responsável do escritório Migra' : ''))}" placeholder="Ex.: Responsável do escritório Migra" /></label></div>
        <label>Imagem da assinatura (foto ou arquivo, de preferência com fundo branco)<input type="file" data-file="${m.slot}" accept="image/*" /></label>
        <p><img data-preview="${m.slot}" alt="" style="max-width:260px;background:#fff;border:1px solid var(--border);border-radius:8px;padding:6px" hidden /></p>
        <label class="check"><input type="checkbox" name="authorize" /> A pessoa que assina autoriza o uso da própria assinatura nos contratos da empresa.</label>
        <label class="check"><input type="checkbox" name="enabled" ${m.enabled || !m.hasImage ? 'checked' : ''} /> Colocar nos contratos</label>
        <button class="btn primary">Salvar</button> ${m.hasImage ? `<button type="button" class="btn danger" data-del="${m.slot}">Remover a assinatura</button>` : ''}
      </form></div>`;

  async function load() {
    const list = await api('/api/contract-signers');
    $('#signerBody').innerHTML = `<p class="hint">Todo contrato que ainda não foi assinado pelo cliente (e todo contrato novo) sai com a assinatura da empresa de quem estiver ligado abaixo, junto do nome e do cargo. Se os dois estiverem ligados, as duas assinaturas aparecem lado a lado. Use a imagem da assinatura da PRÓPRIA pessoa e marque a confirmação de que ela autoriza: o sistema não desenha nem imita assinatura. Contrato que o cliente já assinou não muda.</p>${list.map(card).join('')}`;
    for (const m of list) {
      if (!m.hasImage) continue;
      fetch(`${base(m.slot)}/image`, { credentials: 'same-origin' }).then((r) => r.blob()).then((b) => { const i = box.querySelector(`[data-img="${m.slot}"]`); if (i) i.src = URL.createObjectURL(b); }).catch(() => {});
    }
    for (const k of Object.keys(pending)) delete pending[k];
  }

  // Foto ou arquivo → JPEG com fundo branco, no tamanho certo para o contrato.
  function toJpeg(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const w = Math.min(700, img.width); const h = Math.round((img.height / img.width) * w);
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL('image/jpeg', 0.9));
      };
      img.onerror = () => reject(new Error('Não consegui abrir essa imagem'));
      img.src = URL.createObjectURL(file);
    });
  }

  box.addEventListener('toggle', () => { if (box.open) load().catch((e) => toast(e.message, true)); });
  box.addEventListener('change', async (e) => {
    const slot = e.target.dataset?.file;
    if (!slot || !e.target.files[0]) return;
    try {
      pending[slot] = await toJpeg(e.target.files[0]);
      const p = box.querySelector(`[data-preview="${slot}"]`); p.src = pending[slot]; p.hidden = false;
    } catch (err) { toast(err.message, true); }
  });
  box.addEventListener('submit', async (e) => {
    const slot = e.target.dataset?.form;
    if (!slot) return;
    e.preventDefault();
    const f = e.target;
    try {
      await api(base(slot), { method: 'PUT', body: { name: f.name.value, role: f.role.value, enabled: f.enabled.checked, authorize: f.authorize.checked, ...(pending[slot] ? { image: pending[slot] } : {}) } });
      toast('Assinatura da empresa salva e contratos refeitos');
      load();
    } catch (err) { toast(err.message, true); }
  });
  box.addEventListener('click', async (e) => {
    const slot = e.target.dataset?.del;
    if (!slot) return;
    if (!confirm('Remover esta assinatura da empresa dos contratos?')) return;
    try { await api(base(slot), { method: 'DELETE' }); toast('Assinatura removida'); load(); } catch (err) { toast(err.message, true); }
  });
  const show = () => { box.hidden = window.currentUser?.role !== 'admin'; };
  new MutationObserver(show).observe(document.querySelector('#tab-team'), { attributes: true, attributeFilter: ['class'] });
  show();
})();
