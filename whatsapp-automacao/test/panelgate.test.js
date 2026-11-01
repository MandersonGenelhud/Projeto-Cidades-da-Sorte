import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { totpCode } from '../src/security.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

async function boot(t, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-gate-'));
  const port = 39000 + Math.floor(Math.random() * 900);
  const proc = spawn(process.execPath, ['src/server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: String(port), TUNNEL: 'off', OPEN_BROWSER: '', ...env }, stdio: 'ignore' });
  t.after(() => proc.kill());
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try { await fetch(`${base}/api/auth/state`); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  return base;
}

test('o painel e seus programas só são entregues a quem está logado; o login continua aberto', async (t) => {
  const base = await boot(t);
  for (const p of ['/', '/index.html']) {
    const r = await fetch(base + p, { redirect: 'manual' });
    assert.equal(r.status, 302, p);
    assert.equal(r.headers.get('location'), '/login.html');
  }
  for (const p of ['/app.js', '/crm.js', '/ui.js']) assert.equal((await fetch(base + p)).status, 401, p);
  assert.equal((await fetch(`${base}/login.html`)).status, 200);
  assert.equal((await fetch(`${base}/style.css`)).status, 200);
  // Depois do login, o painel abre.
  const setup = await fetch(`${base}/api/auth/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Dono', login: 'dono', password: 'segredo123', whatsapp: '595987101567' }) });
  assert.equal(setup.status, 200);
  const cookie = setup.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  assert.equal((await fetch(`${base}/`, { headers: { cookie } })).status, 200);
  assert.equal((await fetch(`${base}/app.js`, { headers: { cookie } })).status, 200);
});

test('com código de instalação, só quem tem o código cria o primeiro administrador', async (t) => {
  const base = await boot(t, { SETUP_CODE: 'abc123def456' });
  const state = await (await fetch(`${base}/api/auth/state`)).json();
  assert.equal(state.needsSetup, true);
  assert.equal(state.setupCodeRequired, true);
  const post = (extra) => fetch(`${base}/api/auth/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Intruso', login: 'intruso', password: 'segredo123', whatsapp: '5511900000000', ...extra }) });
  assert.equal((await post({})).status, 403, 'sem código');
  assert.equal((await post({ setupCode: 'errado' })).status, 403, 'código errado');
  assert.equal((await (await fetch(`${base}/api/auth/state`)).json()).needsSetup, true, 'nada foi criado');
  assert.equal((await post({ setupCode: 'abc123def456' })).status, 200, 'código certo');
  assert.equal((await post({ setupCode: 'abc123def456', login: 'outro' })).status, 403, 'depois do primeiro, fecha');
});

test('saúde do sistema: só o administrador vê, diz o que está errado em português e o teste de envio avisa quando o WhatsApp não está conectado', async (t) => {
  const base = await boot(t);
  const setup = await fetch(`${base}/api/auth/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Dono', login: 'dono', password: 'segredo123', whatsapp: '595987101567' }) });
  let cookie = setup.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const get = (u, init = {}) => fetch(base + u, { ...init, headers: { cookie, 'content-type': 'application/json', ...(init.headers || {}) } });
  assert.equal((await fetch(`${base}/api/health/detail`)).status, 401, 'sem login não vê');
  // O painel exige a verificação em duas etapas: liga antes de olhar a saúde.
  const sec = await (await get('/api/security/2fa/setup')).json();
  const en = await get('/api/security/2fa/enable', { method: 'POST', body: JSON.stringify({ code: totpCode(sec.secret) }) });
  assert.equal(en.status, 200);
  const fresh = en.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  if (fresh) cookie = fresh;
  const r = await get('/api/health/detail');
  assert.equal(r.status, 200);
  const h = await r.json();
  assert.equal(h.ok, false);
  assert.ok(h.tips.some((x) => x.level === 'bad' && /WhatsApp/.test(x.text)), 'avisa que o WhatsApp não está conectado');
  assert.ok(h.tips.some((x) => x.level === 'bad' && /IA não está configurada/.test(x.text)), 'avisa que falta a IA');
  const t2 = await get('/api/health/test-send', { method: 'POST' });
  assert.equal(t2.status, 400);
  assert.match((await t2.json()).error, /não está conectado/);
});
