import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { totpCode } from '../src/security.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const J = { 'content-type': 'application/json' };
const ck = (r) => r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

test('contratos antigos: só o administrador importa, vê e baixa; a importação fica na auditoria', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-legacy-'));
  const port = 39500 + Math.floor(Math.random() * 400);
  const base = `http://127.0.0.1:${port}`;
  const proc = spawn(process.execPath, ['src/server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: String(port), TUNNEL: 'off', OPEN_BROWSER: '' }, stdio: 'ignore' });
  t.after(() => proc.kill());
  for (let i = 0; i < 60; i++) { try { await fetch(`${base}/api/auth/state`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const s = await fetch(`${base}/api/auth/setup`, { method: 'POST', headers: J, body: JSON.stringify({ name: 'Marcos', login: 'marcos', password: 'segredo123', whatsapp: '595987101567' }) });
  let cookie = ck(s);
  const call = (u, init = {}) => fetch(base + u, { ...init, headers: { cookie, ...(init.headers || {}) } });
  const sec = await (await call('/api/security/2fa/setup')).json();
  cookie = ck(await call('/api/security/2fa/enable', { method: 'POST', headers: J, body: JSON.stringify({ code: totpCode(sec.secret) }) })) || cookie;
  const cap = { pages: [{ url: 'a', tables: [{ headers: ['Número', 'Cliente', 'Valor'], rows: [['500', 'Ana', '1.000,00'], ['501', 'Beto', '2.000,00']] }], fields: [] }], api: [] };
  const form = () => { const f = new FormData(); f.append('file', new Blob([JSON.stringify(cap)], { type: 'application/json' }), 'captura.json'); return f; };

  assert.equal((await call('/api/legacy/preview', { method: 'POST', body: form() })).status, 200);
  const imp = await (await call('/api/legacy/import', { method: 'POST', body: form() })).json();
  assert.deepEqual([imp.added, imp.ultimoNumero], [2, 501]);
  const list = await (await call('/api/legacy?q=beto')).json();
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].value, 2000);
  assert.equal((await call('/api/legacy/export.csv')).status, 200);
  const bat = await call('/api/legacy/ferramenta.bat');
  assert.equal(bat.status, 200);
  assert.match(bat.headers.get('content-disposition'), /CAPTURAR-CONTRATOS\.bat/);
  const body = await bat.text();
  assert.equal(body.split('::MIGRA_JS_INICIO').length, 2, 'o marcador aparece uma única vez (o comando usa o texto quebrado em dois)');
  const js = body.slice(body.indexOf('\n', body.indexOf('::MIGRA_JS_INICIO')) + 1).replace(/\r\n/g, '\n');
  assert.equal(js, fs.readFileSync(path.join(ROOT, 'tools/capturar-sistema/capturar.mjs'), 'utf8').replace(/\r\n/g, '\n'), 'o programa embutido é exatamente a ferramenta testada');
  assert.ok(body.startsWith('@echo off\r\n'), 'arquivo em formato do Windows (CRLF)');
  assert.ok(!/senha|password/i.test(body.split('::MIGRA_JS_INICIO')[0]), 'a parte do .bat não pede nem grava senha');
  const bad = new FormData(); bad.append('file', new Blob(['não é json']), 'x.json');
  assert.equal((await call('/api/legacy/preview', { method: 'POST', body: bad })).status, 400);
  const audit = await (await call('/api/audit')).json();
  assert.ok(audit.items.some((e) => e.entity === 'contratos antigos' && /Importação/.test(e.label)));

  await call('/api/users', { method: 'POST', headers: J, body: JSON.stringify({ name: 'Fran', login: 'fran', password: 'segredo123', role: 'seller' }) });
  const lg = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: J, body: JSON.stringify({ login: 'fran', password: 'segredo123' }) });
  let c2 = ck(lg);
  const sc = (u, init = {}) => fetch(base + u, { ...init, headers: { cookie: c2, ...(init.headers || {}) } });
  const s2 = await (await sc('/api/security/2fa/setup')).json();
  c2 = ck(await sc('/api/security/2fa/enable', { method: 'POST', headers: J, body: JSON.stringify({ code: totpCode(s2.secret) }) })) || c2;
  for (const u of ['/api/legacy', '/api/legacy/export.csv', '/api/legacy/ferramenta.bat']) assert.equal((await sc(u)).status, 403, u);
  assert.equal((await sc('/api/legacy/import', { method: 'POST', body: form() })).status, 403);
});
