import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { copiarSite } from '../tools/capturar-sistema/capturar-site.mjs';
import { buildSiteBat } from '../src/legacy-tool.js';

let chromium = null;
try { chromium = createRequire(import.meta.url)('playwright').chromium; } catch { /* sem navegador: o teste do navegador é pulado */ }

const HOME = `<!doctype html><html><head><title>Migra</title><meta name="description" content="Seu projeto no Paraguai"><link rel="stylesheet" href="/estilo.css"></head><body>
<h1 class="entra">Bem-vindo</h1><video src="/boas-vindas.mp4" autoplay muted loop></video><div data-aos="fade-up">Bloco</div><a href="/sobre">Sobre</a><a href="/painel/entrar">Painel</a><a href="https://outro.site/x">Fora</a><script src="/app.js"></script></body></html>`;
const CSS = '@keyframes sobe{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:none}} .entra{animation:sobe 1.2s ease-out both;font-family:Georgia,serif;color:#0a5c3a} a{transition:color .3s}';

test('copiar o visual do site: baixa HTML, CSS e JS, acha a animação e o vídeo, pula o painel e gera relatório', { skip: !chromium }, async (t) => {
  const server = http.createServer((req, res) => {
    const send = (b, type = 'text/html; charset=utf-8') => { res.writeHead(200, { 'content-type': type }); res.end(b); };
    if (req.url === '/') return send(HOME);
    if (req.url === '/sobre') return send('<h1>Sobre</h1><p>Texto</p>');
    if (req.url === '/estilo.css') return send(CSS, 'text/css');
    if (req.url === '/app.js') return send('window.AOS={init(){}};', 'text/javascript');
    if (req.url === '/boas-vindas.mp4') return send(Buffer.from('fakevideo'.repeat(300)), 'video/mp4');
    if (req.url.startsWith('/painel')) { server.hitPainel = true; return send('painel'); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-site-'));
  const r = await copiarSite({ url: `http://127.0.0.1:${server.address().port}/`, pasta, log: () => {}, abrir: (op) => browser.newContext(op) });
  assert.equal(r.paginas, 2, 'início e sobre; o painel e o link de fora ficam de fora');
  assert.ok(!server.hitPainel, 'não entra no painel');
  const a = JSON.parse(fs.readFileSync(path.join(pasta, 'codigo', 'analise.json'), 'utf8'));
  assert.ok(a.resumo.keyframes.some((k) => k.nome === 'sobe'), 'achou a animação de entrada');
  assert.ok(a.resumo.bibliotecas.includes('AOS'));
  assert.ok(a.resumo.videos.some((v) => v.src.endsWith('/boas-vindas.mp4') && v.autoplay && v.loop));
  assert.ok(a.paginas[0].animados.some((x) => x.tipo === 'animation' && x.nome === 'sobe'));
  assert.ok(a.resumo.fontes.some((f) => /georgia/i.test(f)));
  const arquivos = JSON.parse(fs.readFileSync(path.join(pasta, 'codigo', 'arquivos.json'), 'utf8'));
  assert.ok(arquivos.some((x) => x.url.endsWith('/estilo.css') && fs.existsSync(path.join(pasta, x.arquivo))));
  assert.ok(arquivos.some((x) => x.url.endsWith('/boas-vindas.mp4') && x.arquivo.startsWith('midia/')));
  assert.ok(fs.existsSync(path.join(pasta, 'codigo', 'paginas', 'inicio.html')));
  assert.ok(fs.existsSync(path.join(pasta, 'codigo', 'telas', 'inicio-celular.png')));
  assert.ok(fs.existsSync(path.join(pasta, 'codigo', 'telas', 'inicio-computador.png')));
  assert.ok(fs.existsSync(path.join(pasta, 'midia', 'gravacao-entrada.webm')), 'gravou a animação de entrada');
});

test('programa do visual do site: .bat próprio, sem chave de envio e com o endereço padrão', () => {
  const bat = buildSiteBat({ site: 'https://migraparaguay.com' });
  assert.match(bat, /node capturar-site\.mjs/);
  assert.match(bat, /capturar-site\.mjs',\$js/);
  assert.match(bat, /MIGRA_SITE_PUBLICO=https:\/\/migraparaguay\.com/);
  assert.doesNotMatch(bat, /MIGRA_TOKEN|MIGRA_URL/);
  assert.match(bat, /copiarSite/);
});
