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

test('conversas separadas por atendente para o administrador; cada vendedor vê só as suas', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-split-'));
  const port = 39200 + Math.floor(Math.random() * 700);
  const base = `http://127.0.0.1:${port}`;
  let proc;
  const start = async () => {
    proc = spawn(process.execPath, ['src/server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: String(port), TUNNEL: 'off', OPEN_BROWSER: '' }, stdio: 'ignore' });
    for (let i = 0; i < 60; i++) { try { await fetch(`${base}/api/auth/state`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  };
  t.after(() => proc?.kill());
  await start();
  const login = async (user, pass, first) => {
    const r = first ? await fetch(`${base}/api/auth/setup`, { method: 'POST', headers: J, body: JSON.stringify({ name: 'Marcos', login: user, password: pass, whatsapp: '595987101567' }) }) : await fetch(`${base}/api/auth/login`, { method: 'POST', headers: J, body: JSON.stringify({ login: user, password: pass }) });
    let cookie = ck(r);
    const call = (u, m = 'GET', b) => fetch(base + u, { method: m, headers: { cookie, ...J }, body: b ? JSON.stringify(b) : undefined });
    const sec = await (await call('/api/security/2fa/setup')).json();
    cookie = ck(await call('/api/security/2fa/enable', 'POST', { code: totpCode(sec.secret) })) || cookie;
    return call;
  };
  const admin = await login('marcos', 'segredo123', true);
  const fran = await (await admin('/api/users', 'POST', { name: 'Fran', login: 'fran', password: 'segredo123', role: 'seller' })).json();
  const eli = await (await admin('/api/users', 'POST', { name: 'Eliezer', login: 'eli', password: 'segredo123', role: 'seller' })).json();
  await admin('/api/leads', 'POST', { name: 'Cliente da Fran', phone: '595981111111', ownerId: fran.id, conversationKey: 'k-fran' });
  await admin('/api/leads', 'POST', { name: 'Cliente do Eliezer', phone: '595982222222', ownerId: eli.id, conversationKey: 'k-eli' });
  await new Promise((r) => setTimeout(r, 800));
  proc.kill(); await new Promise((r) => setTimeout(r, 1500));
  const f = path.join(dir, 'db.json');
  const db = JSON.parse(fs.readFileSync(f, 'utf8'));
  const mk = (key, name) => ({ key, name, phone: key.replace(/\D/g, ''), handoff: false, updatedAt: new Date().toISOString(), messages: [{ role: 'user', content: 'oi', at: new Date().toISOString() }] });
  db.conversations = { 'k-fran': mk('k-fran', 'Cliente da Fran'), 'k-eli': mk('k-eli', 'Cliente do Eliezer'), 'k-novo': mk('k-novo', 'Recém chegou') };
  fs.writeFileSync(f, JSON.stringify(db));
  await start();

  const a = await admin('/api/auth/state').then(() => admin('/api/conversations')).then((r) => r.json());
  const by = Object.fromEntries(a.map((c) => [c.key, c.attendantName]));
  assert.deepEqual(by, { 'k-fran': 'Fran', 'k-eli': 'Eliezer', 'k-novo': 'IA conversando (ainda não direcionada)' });

  const sFran = await login('fran', 'segredo123');
  assert.deepEqual((await (await sFran('/api/conversations')).json()).map((c) => c.key), ['k-fran']);
  assert.equal((await sFran('/api/conversations/k-eli')).status, 403, 'não abre conversa de outro vendedor');
  assert.equal((await sFran('/api/conversations/k-novo')).status, 403);
  assert.equal((await sFran('/api/attendants')).status, 403);
  const sEli = await login('eli', 'segredo123');
  assert.deepEqual((await (await sEli('/api/conversations')).json()).map((c) => c.key), ['k-eli']);
  assert.equal((await sEli('/api/conversations/k-fran/reply', 'POST', { text: 'x' })).status, 403);
});
