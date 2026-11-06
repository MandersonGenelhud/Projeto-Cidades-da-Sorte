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

test('/api/maria: só administrador vê e muda; perfil do administrador não muda; id inventado e perfil inválido são recusados', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-maria-'));
  const port = 39500 + Math.floor(Math.random() * 150);
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
  assert.equal((await anaCall('/api/maria')).status, 403, 'vendedor não vê');
  assert.equal((await anaCall('/api/maria', 'PUT', { enabled: false })).status, 403, 'vendedor não muda');
  const get = await (await marcos('/api/maria')).json();
  assert.equal(get.name, 'Maria');
  assert.equal(get.people.find((p) => p.name === 'marcos').profile, 'full');
  assert.equal(get.people.find((p) => p.id === ana.id).profile, 'own', 'vendedor comum começa só com o que é dele');
  assert.equal((await marcos('/api/maria', 'PUT', { profiles: { [ana.id]: 'basic' } })).status, 200);
  assert.equal((await (await marcos('/api/maria')).json()).people.find((p) => p.id === ana.id).profile, 'basic');
  assert.equal((await marcos('/api/maria', 'PUT', { profiles: { [ana.id]: 'deus' } })).status, 400, 'perfil inválido');
  assert.equal((await marcos('/api/maria', 'PUT', { lineId: 'nao-existe' })).status, 400, 'número inexistente');
  const me = get.people.find((p) => p.name === 'marcos');
  await marcos('/api/maria', 'PUT', { profiles: { [me.id]: 'own' } });
  assert.equal((await (await marcos('/api/maria')).json()).people.find((p) => p.name === 'marcos').profile, 'full', 'administrador sempre vê tudo');
  await marcos('/api/maria', 'PUT', { profiles: { inventado: 'full' } });
  assert.equal((await marcos('/api/maria', 'PUT', { enabled: false })).status, 200);
  assert.equal((await (await marcos('/api/maria')).json()).enabled, false);
});
