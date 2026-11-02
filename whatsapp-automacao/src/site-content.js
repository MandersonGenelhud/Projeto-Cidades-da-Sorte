// Conteúdo editável da página inicial do site (título, números confirmados, vídeos de depoimento e perguntas),
// guardado em configurações e desenhado no servidor (rápido, bom para buscadores e sem depender de JavaScript).
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const err = (status, message) => Object.assign(new Error(message), { status });

export const DEFAULT_CONTENT = {
  heroKicker: 'Migra Paraguai',
  heroTitle: 'Seu projeto no Paraguai começa aqui',
  heroText: 'Residência, cédula, abertura de empresa, terrenos, imóveis, veículos e idiomas, com o acompanhamento de uma equipe que já fez esse caminho.',
  // Só aparecem números que a Migra confirmar (value + label). Começa vazio de propósito.
  stats: [],
  videos: [],
  faq: [
    { q: 'Quais documentos preciso para começar?', a: 'O principal é o RG, emitido de 10 anos para cá (um RG com mais de 10 anos não serve). Também pedimos uma foto sua de meio corpo. O passaporte não é necessário nesta etapa: ele só entra mais adiante, se você contratar o serviço de empresa com benefícios. Se o seu RG estiver vencido ou você não tiver, a equipe orienta o melhor caminho.' },
    { q: 'Como é o atendimento?', a: 'Pelo WhatsApp. Uma atendente virtual responde as primeiras dúvidas e, conforme o assunto, você é direcionado a uma pessoa da equipe responsável pela área.' },
    { q: 'Posso indicar amigos e ganhar?', a: 'Sim. No programa de indicação você se cadastra de graça, recebe um link pessoal e ganha comissão quando uma pessoa indicada fecha negócio. Você acompanha tudo no seu painel.' },
    { q: 'A Migra também vende imóveis e veículos?', a: 'Sim. A Migra Imobiliária tem terrenos, loteamentos e imóveis, e a Migra Motors tem veículos com simulação de financiamento. Também temos a Migra School, para idiomas.' },
  ],
};

export const mergeContent = (saved = {}) => ({
  ...DEFAULT_CONTENT,
  ...Object.fromEntries(Object.entries(saved || {}).filter(([k, v]) => k in DEFAULT_CONTENT && v !== undefined && !(Array.isArray(v) && k === 'faq' && !v.length))),
});

const httpsUrl = (u) => { try { const x = new URL(String(u).trim()); return x.protocol === 'https:' ? x.toString() : ''; } catch { return ''; } };

/** Valida o que o administrador enviou. Vídeos só com link https. */
export function sanitizeContent(input = {}) {
  const out = {};
  for (const [k, max] of [['heroKicker', 60], ['heroTitle', 120], ['heroText', 300]]) if (input[k] !== undefined) out[k] = clean(input[k], max) || DEFAULT_CONTENT[k];
  if (input.stats !== undefined) {
    out.stats = (Array.isArray(input.stats) ? input.stats : []).slice(0, 4).map((s) => ({ value: clean(s.value, 20), label: clean(s.label, 60) })).filter((s) => s.value && s.label);
  }
  if (input.videos !== undefined) {
    const list = (Array.isArray(input.videos) ? input.videos : []).slice(0, 8);
    out.videos = list.map((v) => ({ title: clean(v.title, 80), url: httpsUrl(v.url) })).filter((v) => v.title || v.url);
    if (out.videos.some((v) => !v.url)) throw err(400, 'Todo vídeo precisa de um link que comece com https://');
  }
  if (input.faq !== undefined) {
    out.faq = (Array.isArray(input.faq) ? input.faq : []).slice(0, 12).map((f) => ({ q: clean(f.q, 140), a: clean(f.a, 900) })).filter((f) => f.q && f.a);
  }
  return out;
}

/** Tipo de vídeo para a página: YouTube vira "clique para carregar" (rápido e sem rastreio), MP4 toca direto, o resto é link. */
export function videoKind(url) {
  let u; try { u = new URL(url); } catch { return { kind: 'link' }; }
  const yt = (u.hostname.replace(/^www\./, '') === 'youtu.be' && u.pathname.slice(1)) || (/youtube\.com$/.test(u.hostname) && (u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|embed)\/([\w-]{6,})/) || [])[1]));
  if (yt && /^[\w-]{6,20}$/.test(yt)) return { kind: 'youtube', id: yt };
  if (/\.(mp4|webm)(\?|$)/i.test(u.pathname + u.search)) return { kind: 'file' };
  return { kind: 'link' };
}

export function renderHome(html, content, origin) {
  const c = content;
  const faq = c.faq.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('\n      ');
  const faqLd = JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: c.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }).replace(/</g, '\\u003c');
  const stats = c.stats.length ? `<div class="stats">${c.stats.map((s) => `<div><b>${esc(s.value)}</b><span>${esc(s.label)}</span></div>`).join('')}</div>` : '';
  const videos = c.videos.length ? `<section class="section wrap" id="depoimentos"><div class="sec-title"><span class="eyebrow" style="color:var(--leaf)">Depoimentos</span><h2>Quem já fez esse caminho</h2></div><div class="vids">${c.videos.map((v) => {
    const k = videoKind(v.url);
    const title = esc(v.title || 'Depoimento');
    if (k.kind === 'youtube') return `<figure class="vid"><button type="button" class="vid-play" data-yt="${esc(k.id)}" aria-label="Assistir: ${title}"><img src="https://i.ytimg.com/vi/${esc(k.id)}/hqdefault.jpg" alt="" loading="lazy" /><span></span></button><figcaption>${title}</figcaption></figure>`;
    if (k.kind === 'file') return `<figure class="vid"><video controls preload="none" playsinline src="${esc(v.url)}"></video><figcaption>${title}</figcaption></figure>`;
    return `<figure class="vid"><a class="vid-link" href="${esc(v.url)}" target="_blank" rel="noopener">Assistir</a><figcaption>${title}</figcaption></figure>`;
  }).join('')}</div></section>` : '';
  return html
    .replaceAll('{{ORIGIN}}', esc(origin))
    .replaceAll('{{HERO_KICKER}}', esc(c.heroKicker))
    .replaceAll('{{HERO_TITLE}}', esc(c.heroTitle))
    .replaceAll('{{HERO_TEXT}}', esc(c.heroText))
    .replaceAll('{{STATS}}', stats)
    .replaceAll('{{VIDEOS}}', videos)
    .replaceAll('{{FAQ}}', faq)
    .replaceAll('{{FAQ_LD}}', faqLd);
}
