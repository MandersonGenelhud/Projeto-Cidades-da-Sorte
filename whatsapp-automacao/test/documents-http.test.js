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

test('documentos na prática: só administrador e quem é do setor de documentação entram; regras só do administrador', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-doc-'));
  const port = 39500 + Math.floor(Math.random() * 150);
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
  await admin('/api/users', 'POST', { name: 'Ana', login: 'ana', password: 'segredo123', role: 'seller' });
  await admin('/api/users', 'POST', { name: 'Adriane', login: 'adriane', password: 'segredo123', role: 'seller', sectors: ['documentacao'] });
  const ana = await login('ana'); const adriane = await login('adriane');
  assert.equal((await ana('/api/documents')).status, 403, 'vendedor comum não vê documentos');
  assert.equal((await ana('/api/documents', 'POST', { clientName: 'X' })).status, 403);
  assert.equal((await ana('/api/groups/123@g.us/coverage')).status, 403, 'cruzamento dos grupos é só do administrador');
  assert.equal((await adriane('/api/groups/123@g.us/coverage')).status, 403);
  assert.equal((await adriane('/api/documents')).status, 200);
  const c = await adriane('/api/documents', 'POST', { clientName: 'Keyla Silveira', type: 'cedula_identidade', issuedAt: '2026-10-26', responsible: 'Adriane' });
  assert.equal(c.status, 200);
  const doc = await c.json();
  assert.equal(doc.noticeAt, '2028-01-26');
  assert.equal((await adriane('/api/documents/rules', 'PUT', { cedula_identidade: { notice: 12, renewal: 18 } })).status, 403, 'regras só do administrador');
  assert.equal((await admin('/api/documents/rules', 'PUT', { cedula_identidade: { notice: 12, renewal: 18 } })).status, 200);
  assert.equal((await adriane(`/api/documents/${doc.id}`, 'PATCH', { status: 'entregue' })).status, 200);
  assert.equal((await adriane(`/api/documents/${doc.id}/notify`, 'POST', {})).status, 400, 'sem telefone/WhatsApp: não envia');
  const list = await (await admin('/api/documents')).json();
  assert.equal(list.counts.entregue, 1);
  assert.match(JSON.stringify(await (await admin('/api/audit')).json()), /documento/);
});
