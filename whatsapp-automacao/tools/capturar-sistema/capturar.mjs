// Ferramenta para copiar os contratos do sistema antigo para o Migra Hub.
// Roda no SEU computador, com o SEU login digitado por você no navegador que ela abre.
// A senha nunca passa por aqui. Ela só LÊ páginas (nunca clica em botões nem envia formulários,
// e evita links de sair, excluir, cancelar e parecidos). O resultado vai para a pasta "captura-..."
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
  const out = { title: document.title, tables: [], fields: [], links: [], pdfs: [] };
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
  return n;
}

const semHash = (u) => u.split('#')[0];
const padrao = (u) => { try { const x = new URL(u); return x.pathname.replace(/\/\d+(?=\/|$)/g, '/{n}').replace(/[0-9a-f]{8,}/gi, '{id}'); } catch { return u; } };

export async function capturar(context, { inicio, pasta, maxPaginas = 3000, espera = 600, tudo = false, log = console.log } = {}) {
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
  const page = context.pages().at(-1) || await context.newPage();
  const api = [];
  page.on('response', async (res) => {
    try {
      const ct = res.headers()['content-type'] || '';
      if (!/json/i.test(ct) || res.request().method() !== 'GET' || !res.url().startsWith(origem)) return;
      const body = await res.text();
      if (body.length < 3_000_000) api.push({ url: res.url(), json: JSON.parse(body) });
    } catch { /* resposta sem corpo */ }
  });
  const fila = [semHash(inicio)];
  const vistos = new Set(fila);
  const paginas = []; const pdfs = new Map();
  while (fila.length && paginas.length < maxPaginas) {
    const url = fila.shift();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      const d = await page.evaluate(lerPagina);
      // Listas com botão "Próxima": clica (só nele) até acabar, juntando as linhas de cada página.
      for (let cliques = 0; cliques < 400; cliques++) {
        if (!(await page.evaluate(marcarProxima, PERIGOSO.source).catch(() => false))) break;
        await page.locator('[data-migra-prox="1"]').first().click({ timeout: 4000 }).catch(() => {});
        await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
        await new Promise((r) => setTimeout(r, Math.max(150, espera / 3)));
        const mais = await page.evaluate(lerPagina);
        for (const l of mais.links) d.links.push(l);
        for (const l of mais.pdfs) d.pdfs.push(l);
        if (juntar(d, mais) === 0) break;
      }
      paginas.push({ url, ...d, links: undefined, pdfs: d.pdfs });
      for (const l of d.links) { const u = semHash(l); if (!vistos.has(u) && permitido(u)) { vistos.add(u); fila.push(u); } }
      for (const l of d.pdfs) if (l.startsWith(origem) && !PERIGOSO.test(l) && !pdfs.has(l)) pdfs.set(l, null);
    } catch (e) { log(`  (pulei ${url}: ${e.message.split('\n')[0]})`); }
    if (paginas.length % 25 === 0) log(`  ${paginas.length} páginas lidas, ${fila.length} na fila…`);
    await new Promise((r) => setTimeout(r, espera));
  }
  // PDFs: baixa com o mesmo login do navegador.
  let n = 0;
  for (const url of pdfs.keys()) {
    try {
      const r = await context.request.get(url, { timeout: 30000 });
      if (r.ok() && /pdf/i.test(r.headers()['content-type'] || '') ) {
        const buf = await r.body();
        if (buf.length < 15_000_000) { const nome = `${String(++n).padStart(4, '0')}.pdf`; fs.writeFileSync(path.join(pasta, 'pdfs', nome), buf); pdfs.set(url, nome); }
      }
    } catch { /* PDF que não baixou */ }
  }
  const captura = { feitoEm: new Date().toISOString(), origem, pages: paginas.map(({ links, ...p }) => ({ ...p, pdfs: p.pdfs.map((u) => pdfs.get(u) || null).filter(Boolean) })), api };
  fs.writeFileSync(path.join(pasta, 'captura.json'), JSON.stringify(captura));
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
  const linhas = [`Sistema: ${origem}`, `Páginas lidas: ${paginas.length} · PDFs baixados: ${n} · respostas JSON: ${api.length}`, ''];
  for (const [k, g] of grupos) linhas.push(`${k}  (${g.n} páginas)`, ...[...g.colunas].slice(0, 5).map((c) => `   colunas: ${c}`), g.rotulos.size ? `   campos: ${[...g.rotulos].slice(0, 40).join(' | ')}` : '', '');
  linhas.push('Respostas JSON (só os nomes dos campos):');
  for (const a of api.slice(0, 40)) { const first = Array.isArray(a.json) ? a.json[0] : a.json; linhas.push(`  ${padrao(a.url)}: ${first && typeof first === 'object' ? Object.keys(first).slice(0, 30).join(', ') : typeof first}`); }
  fs.writeFileSync(path.join(pasta, 'mapa.txt'), linhas.join('\n'));
  return { paginas: paginas.length, pdfs: n, api: api.length };
}

async function main() {
  console.log('Programa de cópia de contratos iniciado.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const url = process.argv[2] || (await rl.question('Endereço do sistema do Marcos (ex.: https://sistema.exemplo.com): ')).trim();
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
  console.log(`\nPronto! ${r.paginas} páginas, ${r.pdfs} PDFs.\nPasta: ${pasta}\nEnvie o arquivo "captura.json" no painel (Contratos antigos → Importar).\nSe algo faltar, me mande só o "mapa.txt" (não tem dados de clientes).`);
  await browser.close();
  rl.close();
  if (process.platform === 'win32') spawn('explorer.exe', [pasta], { detached: true, stdio: 'ignore' }).unref();
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main().catch((e) => { console.error(`\nErro: ${e.message}`); process.exit(1); });
