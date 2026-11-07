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

test('envio por número e auditoria: só administrador; perfil validado e salvo por número; vendedor não vê', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-envio-'));
  const port = 39700 + Math.floor(Math.random() * 150);
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
  await marcos('/api/users', 'POST', { name: 'Ana', login: 'ana', password: 'segredo123', role: 'seller' });
  const ana = await login('ana');
  assert.equal((await ana('/api/send-profiles')).status, 403);
  assert.equal((await ana('/api/audit/messaging')).status, 403);
  const list = await (await marcos('/api/send-profiles')).json();
  assert.ok(list.senders.some((s) => s.key === 'principal'));
  assert.equal(list.senders.find((s) => s.key === 'principal').effective.perHour, 30);
  const put = await marcos('/api/send-profiles/principal', 'PUT', { perHour: 12, dailyLimit: 80, minGapSec: 20, maxGapSec: 50, typingCharsPerSecond: 4 });
  assert.equal(put.status, 200);
  const after = await (await marcos('/api/send-profiles')).json();
  assert.equal(after.senders.find((s) => s.key === 'principal').effective.perHour, 12);
  assert.equal(after.senders.find((s) => s.key === 'instagram').effective.perHour, 30, 'o outro número segue o padrão');
  assert.equal((await marcos('/api/send-profiles/principal', 'PUT', { from: 20, to: 8 })).status, 400);
  assert.equal((await marcos('/api/send-profiles/inventado', 'PUT', { perHour: 5 })).status, 404);
  assert.equal((await marcos('/api/send-profiles/principal', 'PUT', {})).status, 200, 'vazio volta ao padrão');
  assert.equal((await (await marcos('/api/send-profiles')).json()).senders.find((s) => s.key === 'principal').effective.perHour, 30);
  const audit = await (await marcos('/api/audit/messaging?days=7')).json();
  assert.ok(Array.isArray(audit.findings) && audit.senders.some((s) => s.key === 'principal'));
  assert.equal(audit.days.length, 7);
});
