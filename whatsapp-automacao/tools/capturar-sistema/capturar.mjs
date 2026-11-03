// Ferramenta para copiar os contratos do sistema antigo para o Migra Hub.
// Roda no SEU computador, com o SEU login digitado por você no navegador que ela abre.
// A senha nunca passa por aqui. Ela só LÊ páginas (nunca clica em botões nem envia formulários,
// e evita links de sair, excluir, cancelar e parecidos). O resultado vai para a pasta "captura-..."
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PERIGOSO = /(logout|log-out|signout|sign-out|sair|deslog|exit|excluir|delete|destroy|remover|remove|apagar|cancelar|cancel|desativar|inativar|reset|senha|password)/i;
const ARQUIVO = /\.(css|js|mjs|map|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|mp4|mp3|zip|rar|xlsx?|docx?)(\?|$)/i;
const SEM_VALOR = /(senha|password|passwd|token|csrf|_token|captcha|cartao|card)/i;

/** Roda dentro da página: lê tabelas, campos de formulário e pares "rótulo: valor". Nunca lê campo de senha. */
function lerPagina() {
  const txt = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  const out = { title: document.title, tables: [], fields: [], links: [], pdfs: [], arquivos: [], assinaturas: [], media: [], texto: (document.body?.innerText || '').slice(0, 60000) };
  for (const t of document.querySelectorAll('table')) {
    const rows = [...t.querySelectorAll('tr')];
    if (rows.length < 2) continue;
    const ficha = rows.every((r) => r.children.length === 2 && r.children[0].tagName === 'TH' && r.children[1].tagName === 'TD');
    const head = ficha ? null : rows.find((r) => r.querySelector('th'));
    if (head && rows.length > 1) {
      const headers = [...head.children].map(txt);
      const body = rows.filter((r) => r !== head && r.querySelector('td')).slice(0, 1000).map((r) => [...r.children].map(txt));
      if (body.length) out.tables.push({ headers, rows: body });
    }
    // Ficha em duas colunas: <th>Rótulo</th><td>Valor</td>
    for (const r of rows) if (r.children.length === 2 && r.children[0].tagName === 'TH' && r.children[1].tagName === 'TD') out.fields.push({ label: txt(r.children[0]), value: txt(r.children[1]) });
  }
  for (const dt of document.querySelectorAll('dt')) if (dt.nextElementSibling?.tagName === 'DD') out.fields.push({ label: txt(dt), value: txt(dt.nextElementSibling) });
  const SKIP = /(senha|password|passwd|token|csrf|_token|captcha|cartao|card)/i;
  for (const el of document.querySelectorAll('input, select, textarea')) {
    const type = (el.type || '').toLowerCase();
    if (['hidden', 'password', 'file', 'submit', 'button', 'image', 'reset'].includes(type)) continue;
    if (SKIP.test(`${el.name} ${el.id}`)) continue;
    const lab = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label');
    const label = txt(lab) || el.getAttribute('aria-label') || el.placeholder || el.name || el.id;
    let value = el.value;
    if (el.tagName === 'SELECT') value = txt(el.selectedOptions?.[0]);
    if (type === 'checkbox' || type === 'radio') { if (!el.checked) continue; value = label; }
    if (label && value) out.fields.push({ label: label.replace(/[:*]\s*$/, ''), value: String(value) });
  }
  for (const el of document.querySelectorAll('li, p, div, span')) {
    if (el.children.length > 3) continue;
    const t = txt(el);
    const m = t.length < 250 && t.match(/^([^:\n]{2,40}):\s*(.{1,200})$/);
    if (m && !el.querySelector('div, ul, table')) out.fields.push({ label: m[1], value: m[2] });
    if (out.fields.length > 200) break;
  }
  for (const el of document.querySelectorAll('iframe[src], video[src], video source[src], a[href*="youtube.com"], a[href*="youtu.be"], a[href*="vimeo.com"], a[href*="instagram.com/reel"]')) {
    const src = el.src || el.href;
    if (/^https?:/i.test(src || '')) out.media.push({ type: el.tagName.toLowerCase(), src, title: (el.title || el.getAttribute('aria-label') || '').slice(0, 80) });
  }
  // Documentos e fotos enviados (RG, comprovantes, contratos escaneados): imagens grandes e links de arquivo.
  for (const im of document.querySelectorAll('img[src]')) {
    if (/^https?:/i.test(im.src) && im.naturalWidth >= 150 && im.naturalHeight >= 150 && !/(\/assets\/|\/static\/|\/_next\/|favicon|logo|sprite|icon|avatar|placeholder)/i.test(im.src)) out.arquivos.push(im.src);
  }
  // Assinaturas (a da empresa aparece em todos os contratos): imagens pequenas dentro de um bloco que fala "assinatura".
  for (const im of document.querySelectorAll('img[src]')) {
    const bloco = im.closest('section,article,div[class*="card" i],div') ;
    const texto = (bloco?.parentElement?.innerText || bloco?.innerText || '').slice(0, 400);
    if (/assinatura/i.test(texto) && im.naturalWidth >= 40 && /^(https?:|data:image\/(png|jpe?g|webp|svg\+xml);base64,)/i.test(im.src) && im.src.length < 1_500_000) out.assinaturas.push({ src: im.src, rotulo: texto.replace(/\s+/g, ' ').slice(0, 160) });
  }
  for (const a of document.querySelectorAll('a[href]')) {
    if (/^https?:/i.test(a.href) && /\.(jpe?g|png|webp|docx?|odt|zip|mp4|webm|mov)(\?|$)/i.test(a.href)) out.arquivos.push(a.href);
  }
  for (const a of document.querySelectorAll('a[href]')) {
    const h = a.href;
    if (/^https?:/i.test(h)) (/\.pdf(\?|$)/i.test(h) || /pdf|imprimir|print|download/i.test(h) ? out.pdfs : out.links).push(h);
  }
  return out;
}

/** Acha o botão "Próxima" (só botões, não links: os links o programa já segue sozinho) e o marca. */
function marcarProxima(perigoso) {
  const ruim = new RegExp(perigoso, 'i');
  const norm = (t) => (t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const nome = /^(proxima|proximo|next|seguinte|>|›|»|→|>>)$/;
  for (const el of document.querySelectorAll('[data-migra-prox]')) el.removeAttribute('data-migra-prox');
  for (const el of document.querySelectorAll('button, [role="button"], li, span, a')) {
    const href = el.getAttribute('href');
    if (el.tagName === 'A' && href && !href.startsWith('#') && !/^javascript:/i.test(href)) continue;
    const rotulo = norm(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent);
    if (!(nome.test(rotulo) || /^(pagina )?(proxima|next)( pagina| page)?$/.test(rotulo))) continue;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true' || /disabled/i.test(el.className) || /disabled/i.test(el.parentElement?.className || '')) continue;
    if (ruim.test(rotulo) || ruim.test(href || '')) continue;
    const form = el.closest('form');
    if (form && (form.method || '').toLowerCase() === 'post') continue;
    if (!el.offsetParent) continue;
    el.setAttribute('data-migra-prox', '1');
    return true;
  }
  return false;
}
/** Acha o próximo botão SEGURO que só mostra informação (sino de notificações, abas e "carregar mais") e o marca. */
function marcarSeguro([perigoso, jaFeitos]) {
  const ruim = new RegExp(perigoso, 'i');
  const norm = (t) => (t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  for (const el of document.querySelectorAll('[data-migra-seguro]')) el.removeAttribute('data-migra-seguro');
  const vistos = new Set();
  for (const el of document.querySelectorAll('[aria-label*="otifica" i], [title*="otifica" i], [data-testid*="notif" i], [class*="bell" i], [role="tab"], button, [role="button"]')) {
    const alvo = el.closest('button, [role="button"], [role="tab"]') || el;
    if (vistos.has(alvo)) continue;
    vistos.add(alvo);
    const href = alvo.getAttribute?.('href');
    if (alvo.tagName === 'A' && href && !href.startsWith('#') && !/^javascript:/i.test(href)) continue;
    const rotulo = norm(alvo.getAttribute('aria-label') || alvo.getAttribute('title') || alvo.textContent);
    const ehSino = /notifica/.test(rotulo) || /bell/.test(`${el.className} ${alvo.className}`.toString().toLowerCase()) || /notif/.test((alvo.getAttribute('data-testid') || '').toLowerCase());
    const ehAba = alvo.getAttribute('role') === 'tab' && alvo.getAttribute('aria-selected') !== 'true';
    const ehMais = /^(carregar mais|ver mais|mostrar mais|load more)$/.test(rotulo);
    // Botões que só trocam a forma de ver (ex.: Kanban / Lista em Processos): a lista traz a tabela com valor, pago e prazo.
    const ehVisao = /^(lista|tabela|list|table)$/.test(rotulo);
    if (!(ehSino || ehAba || ehMais || ehVisao)) continue;
    if (alvo.disabled || alvo.getAttribute('aria-disabled') === 'true' || !alvo.offsetParent) continue;
    if (ruim.test(rotulo) || ruim.test(href || '')) continue;
    const form = alvo.closest('form');
    if (form && (form.method || '').toLowerCase() === 'post' && alvo.type === 'submit') continue;
    const chave = rotulo || 'sem-nome';
    if (jaFeitos.includes(chave)) continue;
    alvo.setAttribute('data-migra-seguro', '1');
    return chave;
  }
  return null;
}
const assinatura = (r) => r.join('\u0001');
/** Junta o que apareceu depois de clicar em "Próxima" ao que já tinha sido lido. Devolve quantas linhas/campos novos. */
function juntar(base, novo) {
  let n = 0;
  for (const t of novo.tables) {
    const alvo = base.tables.find((x) => x.headers.join('|') === t.headers.join('|'));
    if (!alvo) { base.tables.push(t); n += t.rows.length; continue; }
    const tem = new Set(alvo.rows.map(assinatura));
    for (const r of t.rows) if (!tem.has(assinatura(r)) && alvo.rows.length < 20000) { alvo.rows.push(r); n += 1; }
  }
  const temF = new Set(base.fields.map((f) => `${f.label}=${f.value}`));
  for (const f of novo.fields) if (!temF.has(`${f.label}=${f.value}`) && base.fields.length < 2000) { base.fields.push(f); temF.add(`${f.label}=${f.value}`); n += 1; }
  if (novo.texto) {
    const tem = new Set(String(base.texto || '').split('\n'));
    const novas = novo.texto.split('\n').filter((l) => l.trim() && !tem.has(l));
    if (novas.length && String(base.texto || '').length < 120000) { base.texto = `${base.texto || ''}\n${novas.join('\n')}`; n += novas.length; }
  }
  return n;
}

/** Guarda a página (HTML limpo + foto da tela inteira) de modelos de contrato e de algumas amostras, para eu copiar o modelo aprovado. */
async function salvarModelo(page, pasta, url, lista) {
  const n = String(lista.length + 1).padStart(2, '0');
  fs.mkdirSync(path.join(pasta, 'modelos'), { recursive: true });
  try {
    const html = await page.evaluate(() => document.documentElement.outerHTML.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, ''));
    fs.writeFileSync(path.join(pasta, 'modelos', `${n}.html`), html.slice(0, 400_000));
    await page.screenshot({ path: path.join(pasta, 'modelos', `${n}.png`), fullPage: true }).catch(() => {});
    lista.push({ n, url });
  } catch { /* página que não deu para guardar */ }
}

const semHash = (u) => u.split('#')[0];
const padrao = (u) => { try { const x = new URL(u); return x.pathname.replace(/\/\d+(?=\/|$)/g, '/{n}').replace(/[0-9a-f]{8,}/gi, '{id}'); } catch { return u; } };

export async function capturar(context, { inicio, pasta, maxPaginas = 3000, espera = 900, tudo = false, log = console.log } = {}) {
  fs.mkdirSync(path.join(pasta, 'pdfs'), { recursive: true });
  const origem = new URL(inicio).origin;
  const prefixo = tudo ? '/' : `/${new URL(inicio).pathname.split('/').filter(Boolean)[0] || ''}`;
  const permitido = (u) => {
    try {
      const x = new URL(u);
      if (x.origin !== origem || ARQUIVO.test(x.pathname) || PERIGOSO.test(x.pathname + x.search)) return false;
      return tudo || x.pathname.startsWith(prefixo);
    } catch { return false; }
  };
  let page = context.pages().at(-1) || await context.newPage();
  const api = []; let apiBytes = 0; const falhas = [];
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  // Respostas JSON do sistema (com teto de memória: o navegador estourava com "INSUFFICIENT_RESOURCES").
  const ouvir = (pg) => pg.on('response', async (res) => {
    try {
      const ct = res.headers()['content-type'] || '';
      if (!/json/i.test(ct) || res.request().method() !== 'GET' || !res.url().startsWith(origem) || api.length >= 4000 || apiBytes > 250_000_000) return;
      const body = await res.text();
      if (body.length < 3_000_000) { api.push({ url: res.url(), json: JSON.parse(body) }); apiBytes += body.length; }
    } catch { /* resposta sem corpo */ }
  });
  ouvir(page);
  // Troca a aba por uma nova (o login continua) para liberar a memória do navegador.
  const reciclar = async () => { try { const nova = await context.newPage(); ouvir(nova); await page.close().catch(() => {}); page = nova; } catch { /* segue com a aba atual */ } };
  // As páginas do sistema antigo demoram: espera a rede acalmar, sumirem os "carregando" e o conteúdo parar de mudar.
  const aguardar = async (pg, limite = 25000) => {
    const fim = Date.now() + limite;
    await pg.waitForLoadState('networkidle', { timeout: Math.min(limite, 20000) }).catch(() => {});
    let antes = -1; let estavel = 0;
    while (Date.now() < fim && estavel < 3) {
      const e = await pg.evaluate(() => {
        const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const girando = [...document.querySelectorAll('[class*="spinner" i],[class*="loading" i],[class*="skeleton" i],[aria-busy="true"],[role="progressbar"]')].some(vis);
        const txt = /carregando|aguarde|loading/i.test((document.body?.innerText || '').slice(0, 4000));
        return { girando: girando || txt, tam: (document.body?.innerText || '').length };
      }).catch(() => ({ girando: false, tam: 0 }));
      if (!e.girando && e.tam === antes) estavel += 1; else estavel = 0;
      antes = e.tam;
      await new Promise((r) => setTimeout(r, 700));
    }
  };
  const fila = [semHash(inicio)];
  const vistos = new Set(fila);
  const paginas = []; const pdfs = new Map(); const modelos = []; let amostras = 0;
  let reciclou = -1;
  // Segurança contra defeito: se você apertar Ctrl+C ou o navegador fechar, o programa para, salva o que já leu e segue para montar o arquivo.
  let parar = false;
  const aoParar = () => { if (!parar) { parar = true; log('\nParando e guardando o que já foi lido… aguarde alguns segundos.'); } };
  process.once('SIGINT', aoParar); process.once('SIGTERM', aoParar);
  // A cada 40 páginas guarda um arquivo parcial: se o computador desligar, nada se perde (rode de novo e o sistema novo não duplica).
  const guardarParcial = () => { try { fs.writeFileSync(path.join(pasta, 'captura-parcial.json'), JSON.stringify({ feitoEm: new Date().toISOString(), parcial: true, origem, falhas, pages: paginas.map(({ links, ...p }) => p), api: api.slice(0, 1500) })); } catch { /* disco cheio: segue */ } };
  while (fila.length && paginas.length < maxPaginas && !parar) {
    const url = fila.shift();
    if (paginas.length > 0 && paginas.length % 100 === 0 && reciclou !== paginas.length) { reciclou = paginas.length; await reciclar(); }
    try {
      // Até 3 tentativas: se o navegador ficar sem recursos, espera, troca de aba e tenta de novo.
      let ultimo = '';
      let abriu = false;
      for (let t = 0; t < 3 && !abriu; t++) {
        try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }); abriu = true; } catch (e) { ultimo = e.message; await esperar(3000 * (t + 1)); await reciclar(); }
      }
      if (!abriu) throw new Error(ultimo);
      await aguardar(page);
      const d = await page.evaluate(lerPagina);
      // Listas com botão "Próxima": clica (só nele) até acabar, juntando as linhas de cada página.
      for (let cliques = 0; cliques < 400; cliques++) {
        if (!(await page.evaluate(marcarProxima, PERIGOSO.source).catch(() => false))) break;
        await page.locator('[data-migra-prox="1"]').first().click({ timeout: 4000 }).catch(() => {});
        await aguardar(page, 15000);
        const mais = await page.evaluate(lerPagina);
        for (const l of mais.links) d.links.push(l);
        for (const l of mais.pdfs) d.pdfs.push(l);
        if (juntar(d, mais) === 0) break;
      }
      // Modelo de contrato (gerador, modelos, assinatura) e 3 amostras de contratos: HTML + foto da tela.
      if (modelos.length < 12 && /(gerador|modelo|template|minuta|assin)/i.test(url)) await salvarModelo(page, pasta, url, modelos);
      else if (amostras < 3 && /contrat/i.test(url) && /\/\d+/.test(url)) { amostras += 1; await salvarModelo(page, pasta, url, modelos); }
      // Botões que só MOSTRAM informação: sino de notificações, abas (ex.: contratos vencidos) e "carregar mais".
      const feitos = [];
      for (let k = 0; k < 15; k++) {
        const chave = await page.evaluate(marcarSeguro, [PERIGOSO.source, feitos]).catch(() => null);
        if (!chave) break;
        feitos.push(chave);
        await page.locator('[data-migra-seguro="1"]').first().click({ timeout: 3000 }).catch(() => {});
        await aguardar(page, 12000);
        const mais = await page.evaluate(lerPagina);
        for (const l of mais.links) d.links.push(l);
        juntar(d, mais);
      }
      for (const a of d.assinaturas || []) {
        try {
          const dir = path.join(pasta, 'assinaturas'); fs.mkdirSync(dir, { recursive: true });
          const m = /^data:image\/(png|jpe?g|webp|svg\+xml);base64,(.+)$/i.exec(a.src);
          const buf = m ? Buffer.from(m[2], 'base64') : Buffer.from(await (await context.request.get(a.src, { timeout: 20000 })).body());
          const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
          const ext = m ? m[1].replace('jpeg', 'jpg').replace('+xml', '') : (/\.(png|jpe?g|webp|svg)/i.exec(a.src)?.[1] || 'png').toLowerCase();
          const f = path.join(dir, `assinatura-${hash}.${ext}`);
          if (!fs.existsSync(f)) { fs.writeFileSync(f, buf); log(`  assinatura salva: ${path.basename(f)} (${a.rotulo.slice(0, 60)})`); }
        } catch { /* segue */ }
      }
      paginas.push({ url, ...d, assinaturas: undefined, links: undefined, pdfs: d.pdfs });
      for (const l of d.links) { const u = semHash(l); if (!vistos.has(u) && permitido(u)) { vistos.add(u); fila.push(u); } }
      for (const l of [...d.pdfs, ...d.arquivos]) if (l.startsWith(origem) && !PERIGOSO.test(l) && !pdfs.has(l)) pdfs.set(l, null);
    } catch (e) { falhas.push({ url, motivo: e.message.split('\n')[0].slice(0, 160) }); log(`  (pulei ${url}: ${e.message.split('\n')[0]})`); }
    if (paginas.length % 25 === 0) log(`  ${paginas.length} páginas lidas, ${fila.length} na fila…`);
    if (paginas.length > 0 && paginas.length % 40 === 0) guardarParcial();
    await new Promise((r) => setTimeout(r, espera));
  }
  // PDFs, fotos e documentos: baixa com o mesmo login do navegador (sem passar a senha para lugar nenhum).
  let n = 0; let extras = 0;
  const EXTRA = { 'application/zip': 'zip', 'application/x-zip-compressed': 'zip', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
  const EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx' };
  fs.mkdirSync(path.join(pasta, 'arquivos'), { recursive: true });
  const baixados = new Map();
  for (const url of pdfs.keys()) {
    if (n >= 4000) break;
    try {
      const r = await context.request.get(url, { timeout: 60000 });
      const tipo = (r.headers()['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (r.ok() && EXTRA[tipo]) {
        // Arquivos zipados e vídeos: ficam guardados no arquivo único da cópia (não sobem sozinhos para o sistema).
        const buf = await r.body();
        if (buf.length > 1000 && buf.length < 400_000_000) {
          fs.mkdirSync(path.join(pasta, 'extras'), { recursive: true });
          fs.writeFileSync(path.join(pasta, 'extras', `${String(++extras).padStart(4, '0')}.${EXTRA[tipo]}`), buf);
        }
      } else if (r.ok() && EXT[tipo]) {
        const buf = await r.body();
        if ((buf.length >= 2000 || tipo === 'application/pdf') && buf.length < 15_000_000) {
          const nome = `${String(++n).padStart(4, '0')}.${EXT[tipo]}`;
          fs.writeFileSync(path.join(pasta, 'arquivos', nome), buf);
          if (tipo === 'application/pdf') fs.writeFileSync(path.join(pasta, 'pdfs', nome), buf);
          baixados.set(url, { name: nome, kind: tipo === 'application/pdf' ? 'pdf' : tipo.startsWith('image/') ? 'imagem' : 'documento' });
        }
      }
    } catch { /* arquivo que não baixou */ }
  }
  const captura = { feitoEm: new Date().toISOString(), origem, falhas, pages: paginas.map(({ links, ...p }) => { const lista = [...new Set([...p.pdfs, ...p.arquivos])].map((u) => baixados.get(u)).filter(Boolean); return { ...p, pdfs: lista.filter((x) => x.kind === 'pdf').map((x) => x.name), arquivos: lista }; }), api };
  fs.writeFileSync(path.join(pasta, 'captura.json'), JSON.stringify(captura));
  // Lista de conferência: cada arquivo com tamanho e impressão digital, para provar que o arquivo único chegou inteiro.
  try {
    const itens = [];
    const andar = (dir, rel = '') => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, e.name); const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) andar(full, r); else if (!/^(manifesto\.json|captura-parcial\.json)$/.test(e.name)) { const b = fs.readFileSync(full); itens.push({ arquivo: r, bytes: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex') }); } } };
    andar(pasta);
    fs.writeFileSync(path.join(pasta, 'manifesto.json'), JSON.stringify({ feitoEm: new Date().toISOString(), paginas: paginas.length, falhas: falhas.length, interrompido: parar, total: itens.length, itens }));
  } catch { /* sem manifesto: o resto continua valendo */ }
  try { fs.rmSync(path.join(pasta, 'captura-parcial.json'), { force: true }); } catch { /* ok */ }
  // Mapa SEM dados pessoais: só a estrutura (endereços, colunas e rótulos), para eu ajustar o leitor.
  const grupos = new Map();
  for (const p of paginas) {
    const k = padrao(p.url);
    const g = grupos.get(k) || { n: 0, rotulos: new Set(), colunas: new Set() };
    g.n += 1;
    p.fields.forEach((f) => g.rotulos.add(f.label));
    p.tables.forEach((t) => g.colunas.add(t.headers.join(' | ')));
    grupos.set(k, g);
  }
  const videos = new Map();
  for (const p of paginas) for (const m of p.media || []) if (!videos.has(m.src)) videos.set(m.src, m);
  const linhas = [`Sistema: ${origem}`, `Páginas lidas: ${paginas.length} · arquivos baixados (PDFs, fotos, documentos): ${n} · respostas JSON: ${api.length}`, ''];
  for (const [k, g] of grupos) linhas.push(`${k}  (${g.n} páginas)`, ...[...g.colunas].slice(0, 5).map((c) => `   colunas: ${c}`), g.rotulos.size ? `   campos: ${[...g.rotulos].slice(0, 40).join(' | ')}` : '', '');
  if (falhas.length) { linhas.push(`Páginas que não abriram (${falhas.length}):`); for (const f of falhas.slice(0, 60)) linhas.push(`  ${padrao(f.url)}: ${f.motivo}`); linhas.push(''); }
  if (videos.size) { linhas.push('Vídeos encontrados (endereços):'); for (const m of [...videos.values()].slice(0, 60)) linhas.push(`  ${m.title ? `${m.title} | ` : ''}${m.src}`); linhas.push(''); }
  if (modelos.length) { linhas.push('Modelos e amostras de contrato guardados na pasta "modelos" (podem ter dados de clientes: envie só os modelos em branco):'); for (const m of modelos) linhas.push(`  ${m.n}: ${padrao(m.url)}`); linhas.push(''); }
  linhas.push('Respostas JSON (só os nomes dos campos):');
  for (const a of api.slice(0, 40)) { const first = Array.isArray(a.json) ? a.json[0] : a.json; linhas.push(`  ${padrao(a.url)}: ${first && typeof first === 'object' ? Object.keys(first).slice(0, 30).join(', ') : typeof first}`); }
  fs.writeFileSync(path.join(pasta, 'mapa.txt'), linhas.join('\n'));
  return { paginas: paginas.length, pdfs: n, arquivos: baixados.size, api: api.length };
}

/** Manda a cópia (captura.json + arquivos) para o sistema novo, com a chave temporária que veio no programa. */
export async function enviarParaOSistema({ url, token, pasta, log = console.log, espera = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const base = String(url).replace(/\/+$/, '');
  const H = { Authorization: `Bearer ${token}` };
  const post = async (rota, body) => {
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(base + rota, { method: 'POST', headers: H, body });
        const j = await r.json().catch(() => ({}));
        if (r.ok) return j;
        const e = new Error(j.error || `Erro ${r.status}`);
        e.fatal = r.status >= 400 && r.status < 500; // chave vencida ou arquivo recusado: repetir não adianta
        throw e;
      } catch (e) {
        if (e.fatal || i === 2) throw e;
        await espera(1500 * (i + 1));
      }
    }
  };
  log('Enviando a cópia para o sistema novo…');
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(path.join(pasta, 'captura.json'))], { type: 'application/json' }), 'captura.json');
  const primeira = await post('/api/legacy/ingest/captura', fd);
  log(`  contratos e clientes enviados (${primeira.summary?.total ?? 0} contratos).`);
  const dir = path.join(pasta, 'arquivos');
  const nomes = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  let lote = []; let bytes = 0; let enviados = 0;
  const mandar = async () => {
    if (!lote.length) return;
    const f = new FormData();
    for (const n of lote) f.append('files', new Blob([fs.readFileSync(path.join(dir, n))]), n);
    await post('/api/legacy/ingest/arquivos', f);
    enviados += lote.length;
    log(`  ${enviados}/${nomes.length} arquivos enviados`);
    lote = []; bytes = 0;
  };
  for (const n of nomes) {
    const sz = fs.statSync(path.join(dir, n)).size;
    if (lote.length >= 20 || bytes + sz > 40_000_000) await mandar();
    lote.push(n); bytes += sz;
  }
  await mandar();
  return post('/api/legacy/ingest/fim');
}

async function main() {
  console.log('Programa de cópia de contratos iniciado.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  // O endereço é o primeiro argumento que NÃO é uma opção (o .bat passa --saida primeiro, e isso derrubava o programa).
  const args = process.argv.slice(2);
  const iS = args.indexOf('--saida');
  const sobra = args.filter((x, i) => !x.startsWith('--') && !(iS >= 0 && i === iS + 1));
  // Endereço: o da linha de comando, ou o que já vem no programa (MIGRA_SITE), ou o digitado. Enter sem digitar aceita o padrão.
  const padrao = String(process.env.MIGRA_SITE || '').trim();
  let url = (sobra[0] || '').trim();
  for (let tentativa = 0; !url && tentativa < 5; tentativa++) {
    const resp = (await rl.question(padrao ? `Endereço do sistema do Marcos [aperte Enter para usar ${padrao}]: ` : 'Digite o endereço do sistema do Marcos (ex.: migrapyassessoria.com) e aperte Enter: ')).trim();
    url = resp || padrao;
  }
  if (!url) throw new Error('Não recebi o endereço do sistema. Rode de novo e digite, por exemplo: migrapyassessoria.com');
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try { new URL(url); } catch { throw new Error(`O endereço "${url}" não parece certo. Exemplo: migrapyassessoria.com`); }
  console.log(`Sistema antigo: ${url}`);
  let pw;
  try { pw = await import('playwright-core'); } catch { pw = await import('playwright'); }
  let browser;
  for (const channel of ['msedge', 'chrome']) { try { browser = await pw.chromium.launch({ channel, headless: false }); break; } catch { /* tenta o próximo */ } }
  if (!browser) throw new Error('Não achei o Microsoft Edge nem o Google Chrome neste computador.');
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url);
  console.log('\n1) No navegador que abriu, ENTRE NO SISTEMA (digite o login e a senha lá, não aqui).');
  console.log('2) Depois abra a tela que lista os CONTRATOS.');
  await rl.question('3) Volte aqui e aperte ENTER para eu copiar tudo sozinha… ');
  const inicio = page.url();
  const iSaida = process.argv.indexOf('--saida');
  const saida = iSaida > 0 ? process.argv[iSaida + 1] : '.';
  const pasta = path.resolve(saida, `captura-${new URL(inicio).hostname}-${new Date().toISOString().slice(0, 10)}`);
  console.log(`\nCopiando a partir de ${inicio}\nNão mexa no navegador até terminar.\n`);
  let tudo = process.argv.includes('--tudo');
  if (!tudo) {
    const resp = (await rl.question('Copiar o SISTEMA INTEIRO (todas as telas do menu: contratos, clientes, processos, financeiro, leads…)? [S/n] ')).trim().toLowerCase();
    tudo = resp !== 'n' && resp !== 'nao' && resp !== 'não';
  }
  const r = await capturar(context, { inicio, pasta, tudo });
  console.log(`\nCópia pronta: ${r.paginas} páginas, ${r.arquivos ?? r.pdfs} arquivos.\nPasta: ${pasta}`);
  // Um arquivo único com tudo (dados, PDFs, fotos, documentos, zips, vídeos e modelos), para guardar ou enviar.
  try {
    const zip = `${pasta.replace(/[\\/]+$/, '')}.zip`;
    await new Promise((ok, no) => {
      const pr = process.platform === 'win32'
        ? spawn('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${pasta.replace(/'/g, "''")}\\*' -DestinationPath '${zip.replace(/'/g, "''")}' -Force`], { stdio: 'ignore' })
        : spawn('zip', ['-qr', zip, '.'], { cwd: pasta, stdio: 'ignore' });
      pr.on('error', no); pr.on('exit', (c) => (c === 0 ? ok() : no(new Error(`código ${c}`))));
    });
    console.log(`Arquivo único com tudo: ${zip}`);
  } catch (e) { console.log(`(não consegui montar o arquivo único: ${e.message}; a pasta acima tem tudo)`); }
  if (process.env.MIGRA_URL && process.env.MIGRA_TOKEN) {
    try {
      const fim = await enviarParaOSistema({ url: process.env.MIGRA_URL, token: process.env.MIGRA_TOKEN, pasta });
      console.log(`\nPRONTO! Tudo foi enviado para o sistema novo:\n  ${fim.summary.total} contratos, ${fim.summary.clients} clientes, ${fim.files.received} arquivos guardados no contrato ou cliente certo,\n  ${fim.applied.sales} vendas com parcelas e ${fim.applied.clients} clientes no CRM.\nAbra o painel: Contratos antigos e Painel executivo. Depois apague a pasta acima (tem dados de clientes).`);
    } catch (e) {
      console.log(`\nNão consegui enviar sozinho (${e.message}).\nA cópia continua salva na pasta acima. Baixe o programa de novo no painel e rode outra vez, ou envie o captura.json pelo painel (Contratos antigos → Importar).`);
    }
  } else {
    console.log('\nEnvie o arquivo "captura.json" no painel (Contratos antigos → Importar).\nSe algo faltar, me mande só o "mapa.txt" (não tem dados de clientes).');
  }
  await browser.close();
  rl.close();
  if (process.platform === 'win32') spawn('explorer.exe', [pasta], { detached: true, stdio: 'ignore' }).unref();
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main().catch((e) => { console.error(`\nErro: ${e.message}`); process.exit(1); });
