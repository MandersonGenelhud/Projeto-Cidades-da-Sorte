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

test('videochamadas na prática: só o administrador muda regras; quem atende cuida só da própria disponibilidade', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-vc-'));
  const port = 39100 + Math.floor(Math.random() * 150);
  const base = `http://127.0.0.1:${port}`;
  const proc = spawn(process.execPath, ['src/server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: String(port), TUNNEL: 'off', OPEN_BROWSER: '' }, stdio: 'ignore' });
  t.after(() => proc.kill());
  for (let i = 0; i < 60; i++) { try { await fetch(`${base}/api/auth/state`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const login = async (user, first) => {
    const body = JSON.stringify({ name: 'Marcos', login: user, password: 'segredo123', whatsapp: '595987101567' });
    const r = first ? await fetch(`${base}/api/auth/setup`, { method: 'POST', headers: J, body }) : await fetch(`${base}/api/auth/login`, { method: 'POST', headers: J, body: JSON.stringify({ login: user, password: 'segredo123' }) });
    let cookie = ck(r);
    const call = (u, m = 'GET', b) => fetch(base + u, { method: m, headers: { cookie, ...J }, body: b ? JSON.stringify(b) : undefined });
    const sec = await (await call('/api/security/2fa/setup')).json();
    cookie = ck(await call('/api/security/2fa/enable', 'POST', { code: totpCode(sec.secret) })) || cookie;
    return call;
  };
  const admin = await login('marcos', true);
  const mk = async (name, lg) => (await admin('/api/users', 'POST', { name, login: lg, password: 'segredo123', role: 'seller' })).json();
  const eli = await mk('Eliezer Souza', 'eliezer');
  const ana = await mk('Ana', 'ana');
  const sEli = await login('eliezer'); const sAna = await login('ana');

  // o administrador vê tudo e cadastra regras
  const v = await (await admin('/api/videocall')).json();
  assert.equal(v.config.durationMin, 40);
  assert.equal((await admin('/api/videocall/config', 'PUT', { gapMin: 10 })).status, 400);
  assert.equal((await admin('/api/videocall/config', 'PUT', { meetLink: 'https://meet.google.com/abc-defg-hij' })).status, 200);
  // vendedor comum: sem acesso às regras, à lista geral nem a se cadastrar como atendente
  for (const [u, m, b] of [['/api/videocall', 'GET'], ['/api/videocall/config', 'PUT', { gapMin: 15 }], ['/api/videocall/hosts', 'POST', { userId: ana.id, on: true }]]) {
    assert.equal((await sAna(u, m, b)).status, 403, `${m} ${u}`);
  }
  assert.equal((await sAna('/api/videocall/me', 'POST', { active: true })).status, 400, 'quem não está na lista não liga nada');
  // quem atende: liga/desliga e avisa o dia sem atendimento
  assert.equal((await admin('/api/videocall/hosts', 'POST', { userId: eli.id, on: true })).status, 200);
  const me = await (await sEli('/api/videocall/me')).json();
  assert.equal(me.host, true);
  const off = await (await sEli('/api/videocall/me', 'POST', { tomorrowOff: true })).json();
  assert.equal(off.offDates.length, 1);
  assert.equal((await (await sEli('/api/videocall/me', 'POST', { active: false })).json()).active, false);
  // a Ana não vê a disponibilidade do Eliezer
  assert.equal((await (await sAna('/api/videocall/me')).json()).host, false);
  // auditoria registrou
  const log = JSON.stringify(await (await admin('/api/audit')).json());
  assert.match(log, /videochamadas/);
});
