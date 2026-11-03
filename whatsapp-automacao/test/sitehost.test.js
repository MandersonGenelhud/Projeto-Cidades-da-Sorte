import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteAllows, siteHostsFrom } from '../src/site-host.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('domínio do site: lista de hosts e o que é permitido', () => {
  assert.deepEqual([...siteHostsFrom({ SITE_HOSTS: 'Site.com, https://www.site.com/ ,x.com:443' })], ['site.com', 'www.site.com', 'x.com']);
  for (const [m, p] of [['GET', '/'], ['GET', '/imoveis/l/lago-azul'], ['GET', '/site/site.css'], ['GET', '/img/migra-logo.png'], ['GET', '/r/ABC123'], ['POST', '/api/public/lead'], ['POST', '/api/affiliate/signup'], ['GET', '/sitemap.xml']]) assert.equal(siteAllows(m, p), true, `${m} ${p}`);
  for (const [m, p] of [['GET', '/login.html'], ['GET', '/app.js'], ['GET', '/index.html'], ['GET', '/api/auth/state'], ['POST', '/api/auth/login'], ['GET', '/api/leads'], ['GET', '/api/executive'], ['POST', '/imoveis'], ['GET', '/api/public/../leads'], ['GET', '/data/db.json']]) assert.equal(siteAllows(m, p), false, `${m} ${p}`);
});

test('no domínio do site só há páginas públicas; no endereço do sistema o painel continua fechado', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-site-'));
  const port = 39700 + Math.floor(Math.random() * 200);
  const proc = spawn(process.execPath, ['src/server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: String(port), TUNNEL: 'off', OPEN_BROWSER: '', SITE_HOSTS: 'meusite.test,www.meusite.test' }, stdio: 'ignore' });
  t.after(() => proc.kill());
  const get = (host, p, method = 'GET') => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: { Host: host } }, (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: b, loc: res.headers.location })); });
    req.on('error', reject); req.end();
  });
  for (let i = 0; i < 60; i++) { try { await get('x', '/api/public/site'); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const home = await get('meusite.test', '/');
  assert.equal(home.status, 200);
  assert.match(home.body, /Sua nova vida no Paraguai/);
  assert.match(home.body, /href="\/atendimento\?o=site"/, 'botão que leva ao atendimento em rodízio');
  assert.ok(!/fbevents|fbq\(/.test(home.body), 'sem pixel de terceiros');
  assert.ok(!/100% de aprova/i.test(home.body), 'não afirma o que não tem prova');
  assert.match(home.body, /1\.500\+/);
  assert.match(home.body, /<link rel="canonical" href="https:\/\/meusite\.test\/"/);
  assert.ok(!home.body.includes('{{ORIGIN}}'));
  assert.equal((await get('meusite.test', '/site/premium.css')).status, 200);
  assert.equal((await get('meusite.test', '/site/premium.js')).status, 200);
  for (const p of ['/login.html', '/app.js', '/index.html', '/api/auth/state', '/api/leads', '/api/executive', '/data/db.json']) assert.equal((await get('www.meusite.test', p)).status, 404, p);
  assert.equal((await get('meusite.test', '/api/public/catalog')).status, 200);
  assert.equal((await get('meusite.test', '/site/home.css')).status, 200);
  assert.equal((await get('meusite.test', '/migra')).status, 200);
  const sm = await get('meusite.test', '/sitemap.xml');
  assert.match(sm.body, /<loc>https:\/\/meusite\.test\/migra<\/loc>/);
  assert.match((await get('meusite.test', '/robots.txt')).body, /Sitemap: https:\/\/meusite\.test\/sitemap\.xml/);
  assert.deepEqual(JSON.parse((await get('meusite.test', '/api/public/site')).body), { home: true });
  // endereço do sistema: painel fechado, robôs de busca bloqueados e sem página inicial do site
  const panel = await get('sistema.test', '/');
  assert.equal(panel.status, 302);
  assert.equal(panel.loc, '/login.html');
  assert.match((await get('sistema.test', '/robots.txt')).body, /Disallow: \/\n/);
  assert.equal((await get('sistema.test', '/sitemap.xml')).status === 200 && /<urlset/.test((await get('sistema.test', '/sitemap.xml')).body), false);
  assert.deepEqual(JSON.parse((await get('sistema.test', '/api/public/site')).body), { home: false });
});

import { mergeContent, sanitizeContent, renderHome, videoKind } from '../src/site-content.js';

test('conteúdo do site: padrão sem números inventados, validação e desenho no servidor', () => {
  const c = mergeContent({});
  assert.deepEqual(c.stats, [{ value: '1.500+', label: 'clientes atendidos' }], 'só o número confirmado pela direção');
  assert.ok(!JSON.stringify(c).includes('satisfa'), 'nenhum índice de satisfação sem pesquisa');
  assert.deepEqual(c.videos, []);
  assert.match(c.faq[0].a, /RG, emitido de 10 anos para cá/);
  assert.throws(() => sanitizeContent({ videos: [{ title: 'x', url: 'http://inseguro.com/a.mp4' }] }), /https/);
  assert.throws(() => sanitizeContent({ videos: [{ title: 'x', url: 'javascript:alert(1)' }] }), /https/);
  const ok = sanitizeContent({ heroTitle: '  Título novo  ', stats: [{ value: '1.500+', label: 'clientes' }, { value: '', label: 'vazio' }], videos: [{ title: 'Maria', url: 'https://youtu.be/abcDEF12345' }], faq: [{ q: 'P?', a: 'R.' }, { q: '', a: 'sem pergunta' }] });
  assert.equal(ok.heroTitle, 'Título novo');
  assert.equal(ok.stats.length, 1);
  assert.equal(ok.faq.length, 1);
  assert.deepEqual(videoKind('https://youtu.be/abcDEF12345'), { kind: 'youtube', id: 'abcDEF12345' });
  assert.deepEqual(videoKind('https://www.youtube.com/shorts/abcDEF12345'), { kind: 'youtube', id: 'abcDEF12345' });
  assert.equal(videoKind('https://x.com/a.mp4').kind, 'file');
  const html = renderHome('<h1>{{HERO_TITLE}}</h1>{{STATS}}{{VIDEOS}}{{FAQ}}<script>{{FAQ_LD}}</script>', mergeContent({ heroTitle: 'A <b>b</b>', stats: ok.stats, videos: ok.videos, faq: [{ q: 'Q</script>', a: 'R' }] }), 'https://x.com');
  assert.ok(html.includes('A &lt;b&gt;b&lt;/b&gt;'), 'texto sai escapado');
  assert.ok(html.includes('1.500+') && html.includes('data-yt="abcDEF12345"'));
  assert.ok(!html.includes('Q</script>'), 'nada fecha o script do JSON-LD');
});

test('mídia do site original: usa o arquivo nosso quando já foi copiado e o endereço antigo enquanto não foi', async () => {
  const { localizeMedia } = await import('../src/site-content.js');
  const html = '<video src="https://migrapyassessoria.com/assets/hero.mp4" poster="https://migrapyassessoria.com/assets/img/hero-poster.jpg"></video><img src="https://migrapyassessoria.com/assets/img/logo-migra-motors.jpg">';
  const out = localizeMedia(html, '/x', (f) => f.endsWith('m-hero.mp4') || f.endsWith('m-logo-migra-motors.jpg'));
  assert.match(out, /src="\/site\/m-hero\.mp4"/);
  assert.match(out, /poster="https:\/\/migrapyassessoria\.com\/assets\/img\/hero-poster\.jpg"/, 'o que não foi copiado segue no endereço antigo');
  assert.match(out, /src="\/site\/m-logo-migra-motors\.jpg"/);
});
