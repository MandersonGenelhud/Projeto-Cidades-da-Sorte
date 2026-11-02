// Aba "Site": edita a página inicial do site público (título, números confirmados, vídeos de depoimento e perguntas).
(() => {
  const host = document.querySelector('#tab-lots')?.parentElement;
  if (!host) return;
  const sec = document.createElement('section');
  sec.id = 'tab-site';
  sec.className = 'tab';
  sec.innerHTML = `
    <div class="page-head"><h1>Site da Migra: página inicial</h1></div>
    <p class="hint">O que você escrever aqui aparece na página inicial do site (no domínio do site). Escreva só o que for verdade e puder ser provado: números e promessas precisam ser confirmados pela Migra.</p>
    <form id="siteForm" class="panel">
      <label>Frase pequena acima do título <input name="heroKicker" maxlength="60" /></label>
      <label>Título principal <input name="heroTitle" maxlength="120" /></label>
      <label>Texto abaixo do título <textarea name="heroText" rows="3" maxlength="300"></textarea></label>
      <label>Números de destaque (um por linha, no formato <b>valor | o que significa</b>). Deixe vazio se não houver número confirmado.
        <textarea name="stats" rows="3" placeholder="Exemplo: 1.500+ | clientes atendidos"></textarea></label>
      <label>Vídeos de depoimento (um por linha: <b>título | link https</b>). Aceita YouTube e arquivos .mp4.
        <textarea name="videos" rows="4" placeholder="Maria, residência concluída | https://www.youtube.com/watch?v=..."></textarea></label>
      <label>Perguntas frequentes (separe cada pergunta por uma linha em branco: a primeira linha é a pergunta e o resto é a resposta)
        <textarea name="faq" rows="12"></textarea></label>
      <div class="row"><button class="btn primary" type="submit">Salvar</button><span id="siteMsg" class="hint"></span></div>
    </form>`;
  host.appendChild(sec);
  const f = sec.querySelector('#siteForm');
  const toText = (c) => ({
    ...c,
    stats: (c.stats || []).map((s) => `${s.value} | ${s.label}`).join('\n'),
    videos: (c.videos || []).map((v) => `${v.title} | ${v.url}`).join('\n'),
    faq: (c.faq || []).map((x) => `${x.q}\n${x.a}`).join('\n\n'),
  });
  const lines = (t) => String(t || '').split('\n').map((l) => l.trim()).filter(Boolean);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      heroKicker: f.heroKicker.value, heroTitle: f.heroTitle.value, heroText: f.heroText.value,
      stats: lines(f.stats.value).map((l) => { const [value, ...r] = l.split('|'); return { value: value.trim(), label: r.join('|').trim() }; }),
      videos: lines(f.videos.value).map((l) => { const [title, ...r] = l.split('|'); return { title: title.trim(), url: r.join('|').trim() }; }),
      faq: f.faq.value.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean).map((b) => { const [q, ...r] = b.split('\n'); return { q: q.trim(), a: r.join(' ').trim() }; }),
    };
    try { await api('/api/site', { method: 'PUT', body }); sec.querySelector('#siteMsg').textContent = 'Salvo. A página já está atualizada.'; toast('Site atualizado'); } catch (err) { toast(err.message, true); }
  });
  loaders.site = async () => {
    const c = toText(await api('/api/site'));
    for (const k of ['heroKicker', 'heroTitle', 'heroText', 'stats', 'videos', 'faq']) f[k].value = c[k] || '';
  };
})();
