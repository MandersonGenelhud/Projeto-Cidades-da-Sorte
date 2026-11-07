// Equipe: assinatura da empresa (CONTRATADA) nos contratos. A própria pessoa que assina (ex.: Eliezer) fornece a imagem da assinatura
// e confirma que autoriza; o sistema nunca desenha nem imita assinatura. Só administrador.
(() => {
  const anchor = document.querySelector('#systemLinks');
  if (!anchor) return;
  const box = document.createElement('details');
  box.className = 'panel';
  box.id = 'signerPanel';
  box.hidden = true;
  box.innerHTML = '<summary><b>Assinatura da empresa nos contratos</b></summary><div id="signerBody" class="muted">Carregando…</div>';
  anchor.parentElement.insertBefore(box, anchor);
  let pending = ''; // imagem escolhida agora (JPEG em base64), ainda não salva

  async function load() {
    const m = await api('/api/contract-signer');
    $('#signerBody').innerHTML = `
      <p class="hint">Com isto ligado, todo contrato novo sai com a assinatura da empresa (a imagem abaixo) no lado da CONTRATADA, junto do nome de quem assina. Use a imagem da assinatura da PRÓPRIA pessoa, enviada por ela ou com a autorização dela. Nunca use uma assinatura copiada.</p>
      <p>Situação: ${m.active ? '<span class="badge ok">ligada: vai nos contratos</span>' : '<span class="badge paused">desligada</span>'} ${m.authorizedAt ? `<span class="meta">autorizada por ${esc(m.authorizedBy)} em ${new Date(m.authorizedAt).toLocaleDateString('pt-BR')}</span>` : ''}</p>
      ${m.hasImage ? '<p><img id="signerImg" alt="Assinatura cadastrada" style="max-width:260px;background:#fff;border:1px solid var(--border);border-radius:8px;padding:6px" /></p>' : ''}
      <form id="signerForm" class="form">
        <div class="grid2"><label>Nome completo de quem assina pela empresa<input name="name" value="${esc(m.name)}" placeholder="Ex.: Eliezer Fulano de Tal" required /></label>
        <label>Cargo (opcional)<input name="role" value="${esc(m.role)}" placeholder="Ex.: Diretor" /></label></div>
        <label>Imagem da assinatura (foto ou arquivo, de preferência com fundo branco)<input type="file" id="signerFile" accept="image/*" /></label>
        <p><img id="signerPreview" alt="" style="max-width:260px;background:#fff;border:1px solid var(--border);border-radius:8px;padding:6px" hidden /></p>
        <label class="check"><input type="checkbox" name="authorize" /> A pessoa que assina autoriza o uso da própria assinatura nos contratos da empresa.</label>
        <label class="check"><input type="checkbox" name="enabled" ${m.enabled || !m.hasImage ? 'checked' : ''} /> Colocar nos contratos</label>
        <button class="btn primary">Salvar</button> ${m.hasImage ? '<button type="button" class="btn danger" id="signerDel">Remover a assinatura</button>' : ''}
      </form>`;
    if (m.hasImage) {
      fetch('/api/contract-signer/image', { credentials: 'same-origin' }).then((r) => r.blob()).then((b) => { const i = $('#signerImg'); if (i) i.src = URL.createObjectURL(b); }).catch(() => {});
    }
    pending = '';
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
    if (e.target.id !== 'signerFile' || !e.target.files[0]) return;
    try {
      pending = await toJpeg(e.target.files[0]);
      const p = $('#signerPreview'); p.src = pending; p.hidden = false;
    } catch (err) { toast(err.message, true); }
  });
  box.addEventListener('submit', async (e) => {
    if (e.target.id !== 'signerForm') return;
    e.preventDefault();
    const f = e.target;
    try {
      await api('/api/contract-signer', { method: 'PUT', body: { name: f.name.value, role: f.role.value, enabled: f.enabled.checked, authorize: f.authorize.checked, ...(pending ? { image: pending } : {}) } });
      toast('Assinatura da empresa salva');
      load();
    } catch (err) { toast(err.message, true); }
  });
  box.addEventListener('click', async (e) => {
    if (e.target.id !== 'signerDel') return;
    if (!confirm('Remover a assinatura da empresa dos contratos novos?')) return;
    try { await api('/api/contract-signer', { method: 'DELETE' }); toast('Assinatura removida'); load(); } catch (err) { toast(err.message, true); }
  });
  const show = () => { box.hidden = window.currentUser?.role !== 'admin'; };
  new MutationObserver(show).observe(document.querySelector('#tab-team'), { attributes: true, attributeFilter: ['class'] });
  show();
})();
