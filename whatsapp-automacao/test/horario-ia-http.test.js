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


test('painel: o administrador salva o horário de trabalho da IA e ele volta igual; padrão de fábrica é 7h às 23h todos os dias', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-horario-'));
  const port = 39990 + Math.floor(Math.random() * 9);
  const base = `http://127.0.0.1:${port}`;
  const proc = spawn(process.execPath, ['src/server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: String(port), TUNNEL: 'off', OPEN_BROWSER: '' }, stdio: 'ignore' });
  t.after(() => proc.kill());
  for (let i = 0; i < 60; i++) { try { await fetch(`${base}/api/auth/state`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const body = JSON.stringify({ name: 'marcos', login: 'marcos', password: 'segredo123', whatsapp: '595987101567' });
  const r = await fetch(`${base}/api/auth/setup`, { method: 'POST', headers: J, body });
  let cookie = ck(r);
  const call = (u, m = 'GET', b) => fetch(base + u, { method: m, headers: { cookie, ...J }, body: b ? JSON.stringify(b) : undefined });
  const sec = await (await call('/api/security/2fa/setup')).json();
  cookie = ck(await call('/api/security/2fa/enable', 'POST', { code: totpCode(sec.secret) })) || cookie;
  const s0 = await (await call('/api/settings')).json();
  assert.deepEqual(s0.agent.workHours.days, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(s0.agent.workHours.start, '07:00'); assert.equal(s0.agent.workHours.end, '23:00'); assert.equal(s0.agent.pendingHours, '7-23');
  assert.equal((await call('/api/settings', 'PUT', { agent: { workHours: { enabled: true, days: [1, 2, 3], start: '08:00', end: '22:00', message: 'Voltamos às 8h' }, pendingHours: '8-22' } })).status, 200);
  const s1 = await (await call('/api/settings')).json();
  assert.deepEqual(s1.agent.workHours.days, [1, 2, 3]);
  assert.equal(s1.agent.workHours.end, '22:00'); assert.equal(s1.agent.workHours.message, 'Voltamos às 8h');
});
