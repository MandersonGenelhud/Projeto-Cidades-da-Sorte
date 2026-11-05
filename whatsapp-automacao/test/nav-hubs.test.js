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
  assert.match(read('src/server.js'), /'\/nav-hubs\.js'\]\)/, 'arquivo do painel só abre com login');
  // A regra de quem vê cada tela é a mesma do showTab.
  assert.match(js, /data-admin'\) && u\.role !== 'admin' && !\(b\.hasAttribute\('data-officeadmin'\) && u\.officeAdmin\)/);
});
