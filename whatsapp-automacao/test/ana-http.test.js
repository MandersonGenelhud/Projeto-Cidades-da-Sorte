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

test('/api/ana: só administrador vê e muda; horário válido; devolve só quem pode usar (nunca agenda nem financeiro)', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-ana-'));
  const port = 39650 + Math.floor(Math.random() * 150);
  const base = `http://127.0.0.1:${port}`;
  const proc = spawn(process.execPath, ['src/server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: String(port), TUNNEL: 'off', OPEN_BROWSER: '' }, stdio: 'ignore' });
  t.after(() => proc.kill());
  for (let i = 0; i < 60; i++) { try { await fetch(`${base}/api/auth/state`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const login = async (user, first) => {
    const body = JSON.stringify({ name: user, login: user, password: 'segredo123', whatsapp: '595987101567' });
    const r = first ? await fetch(`${base}/api/auth/setup`, { method: 'POST', headers: J, body }) : await fetch(`${base}/api/auth/login`, { method: 'POST', headers: J, body });
    let cookie = ck(r);
    const call = (u, m = 'GET', b) => fetch(base + u, { method: m, headers: { cookie, ...J }, body: b ? JSON.stringify(b) : undefined });
    const sec = await (await call('/api/security/2fa/setup')).json();
    cookie = ck(await call('/api/security/2fa/enable', 'POST', { code: totpCode(sec.secret) })) || cookie;
    return call;
  };
  const marcos = await login('marcos', true);
  const ana = (await (await marcos('/api/users', 'POST', { name: 'Ana', login: 'ana', password: 'segredo123', role: 'seller' })).json());
  const anaCall = await login('ana');
  assert.equal((await anaCall('/api/ana')).status, 403);
  assert.equal((await anaCall('/api/ana', 'PUT', { enabled: false })).status, 403);
  const get = await (await marcos('/api/ana')).json();
  assert.equal(get.briefingTime, '04:30');
  assert.equal(get.people.find((p) => p.name === 'marcos').allowed, true);
  assert.equal(get.people.find((p) => p.id === ana.id).allowed, false, 'vendedor não tem a Ana por padrão');
  assert.deepEqual(Object.keys(get).sort(), ['briefingTime', 'enabled', 'people', 'users'], 'nada de agenda ou finanças na resposta');
  assert.equal((await marcos('/api/ana', 'PUT', { briefingTime: '25:99' })).status, 400);
  assert.equal((await marcos('/api/ana', 'PUT', { briefingTime: '05:15', users: [ana.id, 'inventado'] })).status, 200);
  const after = await (await marcos('/api/ana')).json();
  assert.equal(after.briefingTime, '05:15');
  assert.deepEqual(after.users, [ana.id], 'id inventado é ignorado');
  assert.equal(after.people.find((p) => p.id === ana.id).allowed, true);
});
