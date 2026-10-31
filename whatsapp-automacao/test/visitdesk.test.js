import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { totpCode } from '../src/security.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Cliente HTTP com cookie (uma pessoa logada). */
function client(base) {
  let cookie = '';
  return async (url, { method = 'GET', body } = {}) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.getSetCookie?.() || [];
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
}
async function login(base, login, password) {
  const c = client(base);
  const r = await c('/api/auth/login', { method: 'POST', body: { login, password } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s = await c('/api/security/2fa/setup');
  assert.equal((await c('/api/security/2fa/enable', { method: 'POST', body: { code: totpCode(s.body.secret) } })).status, 200);
  return c;
}

test('quem cuida das visitas (Silvani) usa a aba Visitas; outro vendedor não; nenhum dos dois vê as configurações', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-desk-'));
  const port = 39000 + Math.floor(Math.random() * 900);
  const proc = spawn(process.execPath, ['src/server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: String(port), TUNNEL: 'off', OPEN_BROWSER: '' }, stdio: 'ignore' });
  t.after(() => proc.kill());
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try { await fetch(`${base}/api/auth/state`); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  const admin = client(base);
  assert.equal((await admin('/api/auth/setup', { method: 'POST', body: { name: 'Manderson', login: 'manderson', password: 'teste1234' } })).status, 200);
  const s = await admin('/api/security/2fa/setup');
  await admin('/api/security/2fa/enable', { method: 'POST', body: { code: totpCode(s.body.secret) } });
  await admin('/api/users', { method: 'POST', body: { name: 'Silvani Nunes', login: 'silvani', password: 'silvani123', role: 'seller', whatsapp: '+55 45 99999-0002' } });
  await admin('/api/users', { method: 'POST', body: { name: 'Gabriel', login: 'gabriel', password: 'gabriel123', role: 'seller', whatsapp: '+55 45 99999-0003' } });

  const silvani = await login(base, 'silvani', 'silvani123');
  const gabriel = await login(base, 'gabriel', 'gabriel123');
  assert.equal((await silvani('/api/auth/state')).body.user.visitDesk, true);
  assert.equal((await gabriel('/api/auth/state')).body.user.visitDesk, false);
  assert.equal((await silvani('/api/visits')).status, 200);
  assert.equal((await silvani('/api/visits/abc123/confirm', { method: 'POST', body: {} })).status, 404, 'passa da permissão (pedido inexistente)');
  assert.equal((await gabriel('/api/visits')).status, 403);
  assert.equal((await silvani('/api/settings')).status, 403, 'configurações continuam só do administrador');
  assert.equal((await silvani('/api/visits/abc123/forward', { method: 'POST', body: {} })).status, 403);
});
