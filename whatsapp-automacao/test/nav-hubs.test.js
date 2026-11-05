import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('menu enxuto: toda tela do painel está em uma seção, sem repetir, e o script exige login', () => {
  const html = read('public/index.html');
  const js = read('public/nav-hubs.js');
  const tabs = [...html.matchAll(/<button data-tab="([a-z0-9]+)"/g)].map((m) => m[1]);
  assert.ok(tabs.length > 40);
  const hubBlock = js.slice(js.indexOf('const HUBS = ['), js.indexOf('];', js.indexOf('const HUBS = [')));
  const inHubs = [...hubBlock.matchAll(/tabs: \[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/'([a-z0-9]+)'/g)].map((x) => x[1]));
  assert.equal(new Set(inHubs).size, inHubs.length, 'nenhuma tela aparece em duas seções');
  const missing = tabs.filter((t) => !inHubs.includes(t));
  assert.deepEqual(missing, [], 'toda tela tem seção (as que faltarem iriam para "Outros")');
  // A página da tela existe no HTML ou é criada por um dos scripts do painel.
  const scripts = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.js')).map((f) => read(`public/${f}`)).join('\n');
  for (const t of tabs) assert.ok(html.includes(`id="tab-${t}"`) || scripts.includes(`'tab-${t}'`) || scripts.includes(`section('${t}'`), `a tela ${t} existe`);
  assert.ok(html.indexOf('nav-hubs.js') > html.indexOf('app.js'), 'carrega depois do app.js');
  assert.match(read('src/server.js'), /PANEL_FILES = new Set\(\[[^\]]*'\/nav-hubs\.js'[^\]]*'\/empresas-apps\.js'/, 'arquivos do painel só abrem com login');
  // A regra de quem vê cada tela é a mesma do showTab.
  assert.match(js, /data-admin'\) && u\.role !== 'admin' && !\(b\.hasAttribute\('data-officeadmin'\) && u\.officeAdmin\)/);
});

test('busca de telas: o navegador não preenche sozinho e chave colada por engano é apagada', () => {
  const js = read('public/nav-hubs.js');
  assert.match(js, /find\.readOnly = true/, 'só libera ao clicar');
  assert.match(js, /setAttribute\('autocomplete', 'off'\)/);
  const m = js.match(/const looksLikeKey = \(v\) => (.+);\n/);
  const looksLikeKey = new Function('v', `return ${m[1]}`);
  for (const k of ['github_pat_11ARJTXHY0lapX1K', 'ghp_abcdefghijklmnop', 'AIzaSyD-xxxx', 'EAAGxxxxx']) assert.equal(looksLikeKey(k), true, k);
  for (const ok of ['cobr', 'Contratos', 'ficha do cliente', 'retornos']) assert.equal(looksLikeKey(ok), false, ok);
  const html = read('public/index.html');
  assert.ok(!/id="updateToken" type="password"/.test(html), 'a chave do GitHub não é campo de senha (o navegador não salva)');
});
