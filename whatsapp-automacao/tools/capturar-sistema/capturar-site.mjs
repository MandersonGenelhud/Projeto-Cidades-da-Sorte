// Copia o VISUAL de um site PÚBLICO (o do Marcos): HTML, CSS, JavaScript, fontes, imagens, vídeos, fotos de tela no computador e no celular,
// uma gravação da animação de entrada e um relatório dos efeitos (animações, transições, bibliotecas de movimento, cores e fontes).
// Não precisa de login e só LÊ as páginas (nenhum botão é clicado). Roda no computador da pessoa, com o Edge ou o Chrome que já existem.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MAX_PAGINAS = 60;
const IGNORAR = /(google-analytics|googletagmanager|doubleclick|facebook\.net|facebook\.com\/tr|hotjar|clarity\.ms|googleadservices|connect\.facebook|snap\.licdn|analytics)/i;
const TEXTO = /(text\/|javascript|json|xml|svg|css)/i;
const MIDIA = /^(image|video|audio)\//i;
const FONTE = /(font|woff|opentype|truetype)/i;
const EXT = { 'text/css': 'css', 'text/javascript': 'js', 'application/javascript': 'js', 'application/x-javascript': 'js', 'application/json': 'json', 'image/svg+xml': 'svg', 'text/html': 'html', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'font/woff2': 'woff2', 'font/woff': 'woff', 'font/ttf': 'ttf', 'font/otf': 'otf', 'application/font-woff2': 'woff2', 'application/font-woff': 'woff' };

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
const semHash = (u) => { try { const x = new URL(u); x.hash = ''; return x.href; } catch { return u; } };

/** Roda dentro da página: efeitos de movimento, cores, fontes e mídia. */
function analisar() {
  const out = { titulo: document.title, descricao: document.querySelector('meta[name=description]')?.content || '', og: {}, keyframes: [], animados: [], bibliotecas: [], fontes: [], cores: [], videos: [], iframes: [], links: [] };
  for (const m of document.querySelectorAll('meta[property^="og:"]')) out.og[m.getAttribute('property')] = (m.content || '').slice(0, 200);
  for (const sh of document.styleSheets) {
    let regras; try { regras = sh.cssRules; } catch { continue; }
    for (const r of regras || []) { if (r.type === CSSRule.KEYFRAMES_RULE && out.keyframes.length < 200) out.keyframes.push({ nome: r.name, css: r.cssText.slice(0, 800) }); }
  }
  const sel = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${[...el.classList].slice(0, 3).map((c) => `.${c}`).join('')}`;
  const cont = {};
  const todos = [...document.querySelectorAll('body *')].slice(0, 4000);
  for (const el of todos) {
    const cs = getComputedStyle(el);
    if (cs.animationName && cs.animationName !== 'none' && out.animados.length < 300) out.animados.push({ el: sel(el), tipo: 'animation', nome: cs.animationName, duracao: cs.animationDuration, atraso: cs.animationDelay, curva: cs.animationTimingFunction, repete: cs.animationIterationCount });
    else if (cs.transitionDuration && cs.transitionDuration !== '0s' && cs.transitionProperty !== 'none' && out.animados.length < 300) out.animados.push({ el: sel(el), tipo: 'transition', nome: cs.transitionProperty, duracao: cs.transitionDuration, atraso: cs.transitionDelay, curva: cs.transitionTimingFunction });
    for (const k of ['color', 'backgroundColor']) { const v = cs[k]; if (v && v !== 'rgba(0, 0, 0, 0)') cont[v] = (cont[v] || 0) + 1; }
    for (const a of ['data-aos', 'data-animate', 'data-scroll', 'data-gsap', 'data-framer-appear-id', 'data-sal']) if (el.hasAttribute?.(a) && out.animados.length < 300) out.animados.push({ el: sel(el), tipo: a, nome: el.getAttribute(a) || '' });
  }
  out.cores = Object.entries(cont).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([cor, n]) => ({ cor, n }));
  const fam = new Set();
  for (const el of document.querySelectorAll('h1,h2,h3,p,a,button,li,span')) fam.add(getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '').trim());
  out.fontes = [...fam].filter(Boolean).slice(0, 12);
  out.tipografia = ['h1', 'h2', 'h3', 'p', 'button'].map((t) => { const e = document.querySelector(t); if (!e) return null; const c = getComputedStyle(e); return { tag: t, fonte: c.fontFamily.split(',')[0].replace(/["']/g, ''), tamanho: c.fontSize, peso: c.fontWeight, cor: c.color }; }).filter(Boolean);
  const w = window;
  const mapa = { gsap: w.gsap, ScrollTrigger: w.ScrollTrigger, AOS: w.AOS, lottie: w.lottie || w.bodymovin, Swiper: w.Swiper, THREE: w.THREE, Lenis: w.Lenis, Locomotive: w.LocomotiveScroll, anime: w.anime, Splide: w.Splide, Alpine: w.Alpine, React: w.React, Vue: w.Vue, jQuery: w.jQuery, WOW: w.WOW, particlesJS: w.particlesJS };
  for (const [n, v] of Object.entries(mapa)) if (v) out.bibliotecas.push(n);
  for (const s of document.scripts) { const m = /(framer-motion|gsap|aos|lottie|swiper|lenis|locomotive|three|anime|splide|alpine|wow|particles|motion)/i.exec(s.src || ''); if (m && !out.bibliotecas.includes(m[1].toLowerCase())) out.bibliotecas.push(`${m[1].toLowerCase()} (arquivo)`); }
  for (const v of document.querySelectorAll('video')) out.videos.push({ src: v.currentSrc || v.src || v.querySelector('source')?.src || '', poster: v.poster || '', autoplay: v.autoplay, loop: v.loop, muted: v.muted, controls: v.controls, largura: v.videoWidth, altura: v.videoHeight, duracao: Math.round(v.duration || 0) });
  for (const f of document.querySelectorAll('iframe')) out.iframes.push((f.src || '').slice(0, 300));
  for (const a of document.querySelectorAll('a[href]')) if (a.href.startsWith('http')) out.links.push(a.href);
  return out;
}

async function rolarDevagar(page) {
  const altura = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => 0);
  for (let y = 0; y < altura; y += 350) { await page.evaluate((v) => window.scrollTo({ top: v }), y).catch(() => {}); await esperar(280); }
  await esperar(600);
  await page.evaluate(() => window.scrollTo({ top: 0 })).catch(() => {});
  await esperar(500);
}

export async function copiarSite({ url, pasta, log = console.log, abrir }) {
  const origem = new URL(url).origin; const host = new URL(url).hostname;
  const cod = path.join(pasta, 'codigo'); const mid = path.join(pasta, 'midia');
  for (const d of [path.join(cod, 'paginas'), path.join(cod, 'assets'), path.join(cod, 'telas'), path.join(mid, 'arquivos')]) fs.mkdirSync(d, { recursive: true });
  const assets = new Map(); // url -> info
  const salvar = async (res) => {
    try {
      const u = res.url(); const ct = (res.headers()['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!res.ok() || IGNORAR.test(u) || u.startsWith('data:') || assets.has(u) || res.request().method() !== 'GET') return;
      const mesmoSite = u.startsWith(origem);
      const midia = MIDIA.test(ct); const fonte = FONTE.test(ct) || /\.(woff2?|ttf|otf)(\?|$)/i.test(u); const texto = TEXTO.test(ct);
      if (!mesmoSite && !(midia || fonte || /\.(css|js)(\?|$)/i.test(u) || texto)) return;
      const corpo = await res.body().catch(() => null); if (!corpo) return;
      const limite = ct.startsWith('video/') ? 200_000_000 : 40_000_000;
      const ext = EXT[ct] || (/\.(\w{2,5})(\?|$)/.exec(new URL(u).pathname)?.[1] || 'bin').toLowerCase();
      // Mídia do próprio site: guarda com o nome original (m-<arquivo>), que é o que a página nova espera em public/site.
      const base = mesmoSite ? path.basename(new URL(u).pathname).replace(/[^\w.-]/g, '') : '';
      const nome = midia && base && !/[\\/]/.test(base) ? `m-${base}` : `${hash(u)}.${ext}`;
      const info = { url: u, tipo: ct, bytes: corpo.length, arquivo: '' };
      if (corpo.length <= limite) {
        const destino = (midia ? path.join(mid, 'arquivos') : path.join(cod, 'assets'));
        fs.writeFileSync(path.join(destino, nome), corpo);
        info.arquivo = `${midia ? 'midia/arquivos' : 'codigo/assets'}/${nome}`;
      } else info.arquivo = '(grande demais: só o endereço foi guardado)';
      assets.set(u, info);
    } catch { /* recurso que não deu para guardar */ }
  };
  const abrirContexto = async (opcoes) => { const c = await abrir(opcoes); c.on('response', salvar); return c; };

  // 1) Gravação da animação de entrada da página inicial (computador): abre, espera e rola devagar.
  log('Gravando a animação de entrada da página inicial…');
  const gravDir = path.join(pasta, 'tmp-video');
  const ctxVideo = await abrirContexto({ viewport: { width: 1440, height: 810 }, recordVideo: { dir: gravDir, size: { width: 1280, height: 720 } } });
  const pv = await ctxVideo.newPage();
  await pv.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await esperar(7000);
  await rolarDevagar(pv);
  await esperar(1500);
  const arquivoVideo = await pv.video()?.path().catch(() => null);
  await ctxVideo.close();
  try { if (arquivoVideo && fs.existsSync(arquivoVideo)) fs.copyFileSync(arquivoVideo, path.join(mid, 'gravacao-entrada.webm')); fs.rmSync(gravDir, { recursive: true, force: true }); } catch { /* sem gravação */ }

  // 2) Todas as páginas do mesmo site: HTML renderizado, foto no computador, foto no celular e relatório de efeitos.
  const desk = await abrirContexto({ viewport: { width: 1440, height: 900 } });
  const cel = await abrirContexto({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  const pd = await desk.newPage(); const pc = await cel.newPage();
  const fila = [semHash(url)]; const vistos = new Set(fila); const paginas = []; const falhas = [];
  while (fila.length && paginas.length < MAX_PAGINAS) {
    const alvo = fila.shift();
    try {
      await pd.goto(alvo, { waitUntil: 'load', timeout: 45000 });
      await pd.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      await rolarDevagar(pd);
      const nome = paginas.length === 0 ? 'inicio' : `${String(paginas.length).padStart(2, '0')}-${(new URL(alvo).pathname.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'pagina').slice(0, 40)}`;
      const analise = await pd.evaluate(analisar);
      fs.writeFileSync(path.join(cod, 'paginas', `${nome}.html`), await pd.content());
      await pd.screenshot({ path: path.join(cod, 'telas', `${nome}-computador.png`), fullPage: true }).catch(() => {});
      try { await pc.goto(alvo, { waitUntil: 'load', timeout: 45000 }); await pc.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {}); await rolarDevagar(pc); await pc.screenshot({ path: path.join(cod, 'telas', `${nome}-celular.png`), fullPage: true }); } catch { /* sem foto do celular */ }
      const { links, ...resto } = analise;
      paginas.push({ url: alvo, arquivo: `paginas/${nome}.html`, ...resto });
      for (const l of links) { const u = semHash(l); try { const x = new URL(u); if (x.origin === origem && !vistos.has(u) && !/\.(pdf|zip|jpg|jpeg|png|webp|gif|mp4|svg)(\?|$)/i.test(x.pathname) && !/(wp-admin|login|logout|sair|painel|admin)/i.test(x.pathname)) { vistos.add(u); fila.push(u); } } catch { /* link inválido */ } }
      log(`  ${paginas.length}. ${alvo}`);
    } catch (e) { falhas.push({ url: alvo, motivo: String(e.message).split('\n')[0].slice(0, 160) }); log(`  (pulei ${alvo}: ${String(e.message).split('\n')[0]})`); }
  }
  await desk.close(); await cel.close();

  // 3) Relatório.
  const lista = [...assets.values()];
  const resumo = {
    feitoEm: new Date().toISOString(), site: url, paginas: paginas.length, falhas, arquivos: lista.length,
    bibliotecas: [...new Set(paginas.flatMap((p) => p.bibliotecas))],
    fontes: [...new Set(paginas.flatMap((p) => p.fontes))],
    cores: Object.values(paginas.flatMap((p) => p.cores).reduce((a, c) => { a[c.cor] = a[c.cor] || { cor: c.cor, n: 0 }; a[c.cor].n += c.n; return a; }, {})).sort((a, b) => b.n - a.n).slice(0, 16),
    videos: [...new Map(paginas.flatMap((p) => p.videos).filter((v) => v.src).map((v) => [v.src, v])).values()],
    iframes: [...new Set(paginas.flatMap((p) => p.iframes))],
    keyframes: [...new Map(paginas.flatMap((p) => p.keyframes).map((k) => [k.nome, k])).values()],
    efeitos: paginas.map((p) => ({ pagina: p.url, animados: p.animados.length, exemplos: p.animados.slice(0, 40) })),
  };
  fs.writeFileSync(path.join(cod, 'analise.json'), JSON.stringify({ resumo, paginas }, null, 1));
  fs.writeFileSync(path.join(cod, 'arquivos.json'), JSON.stringify(lista, null, 1));
  fs.writeFileSync(path.join(cod, 'LEIA-ME.txt'), [`Cópia do visual de ${url}`, `Páginas: ${paginas.length} · arquivos baixados: ${lista.length}`, `Bibliotecas de movimento: ${resumo.bibliotecas.join(', ') || 'nenhuma detectada'}`, `Animações (keyframes): ${resumo.keyframes.length}`, `Fontes: ${resumo.fontes.join(', ')}`, `Vídeos: ${resumo.videos.length}`, '', 'Esta pasta ("codigo") é leve: pode subir no GitHub. A pasta "midia" tem imagens e vídeos (pesada).'].join('\n'));
  return { paginas: paginas.length, arquivos: lista.length, bibliotecas: resumo.bibliotecas, host, falhas: falhas.length };
}

function zipar(pasta, destino) {
  return new Promise((ok, no) => {
    const pr = process.platform === 'win32'
      ? spawn('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${pasta.replace(/'/g, "''")}\\*' -DestinationPath '${destino.replace(/'/g, "''")}' -Force`], { stdio: 'ignore' })
      : spawn('zip', ['-qr', destino, '.'], { cwd: pasta, stdio: 'ignore' });
    pr.on('error', no); pr.on('exit', (c) => (c === 0 ? ok() : no(new Error(`código ${c}`))));
  });
}

async function main() {
  console.log('Programa de cópia do VISUAL do site iniciado.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const args = process.argv.slice(2);
  const iS = args.indexOf('--saida');
  const sobra = args.filter((x, i) => !x.startsWith('--') && !(iS >= 0 && i === iS + 1));
  const padrao = String(process.env.MIGRA_SITE_PUBLICO || '').trim();
  let url = (sobra[0] || '').trim();
  for (let t = 0; !url && t < 5; t++) url = (await rl.question(padrao ? `Endereço do SITE para copiar o visual [Enter usa ${padrao}]: ` : 'Digite o endereço do site (ex.: migrapyassessoria.com) e aperte Enter: ')).trim() || padrao;
  if (!url) throw new Error('Não recebi o endereço do site.');
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  new URL(url);
  let pw; try { pw = await import('playwright-core'); } catch { pw = await import('playwright'); }
  let browser;
  for (const channel of ['msedge', 'chrome']) { try { browser = await pw.chromium.launch({ channel, headless: true }); break; } catch { /* tenta o próximo */ } }
  if (!browser) throw new Error('Não achei o Microsoft Edge nem o Google Chrome neste computador.');
  const saida = iS >= 0 ? args[iS + 1] : '.';
  const pasta = path.resolve(saida, `site-${new URL(url).hostname}-${new Date().toISOString().slice(0, 10)}`);
  console.log(`Copiando ${url}. Isso leva alguns minutos; não precisa mexer em nada.\n`);
  const r = await copiarSite({ url, pasta, abrir: (op) => browser.newContext(op) });
  await browser.close();
  console.log(`\nPronto: ${r.paginas} página(s), ${r.arquivos} arquivo(s). Bibliotecas de movimento: ${r.bibliotecas.join(', ') || 'nenhuma detectada'}.\nPasta: ${pasta}`);
  for (const [sub, nome] of [['codigo', 'site-codigo.zip'], ['midia', 'site-midia.zip']]) {
    try { await zipar(path.join(pasta, sub), path.join(pasta, nome)); console.log(`Arquivo: ${path.join(pasta, nome)}`); } catch (e) { console.log(`(não consegui montar ${nome}: ${e.message}; use a pasta "${sub}")`); }
  }
  console.log('\nPróximo passo: envie o "site-codigo.zip" (leve) para o GitHub, na pasta "referencias/site-antigo" do projeto, e me avise. O "site-midia.zip" é pesado: se o GitHub recusar, guarde-o e me mande só os vídeos principais.');
  rl.close();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch((e) => { console.error(`\nErro: ${e.message}`); process.exitCode = 1; });
