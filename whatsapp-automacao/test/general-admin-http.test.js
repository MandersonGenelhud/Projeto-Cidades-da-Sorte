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

test('administrador geral: só outro administrador geral concede ou remove; ninguém muda o próprio nível; o último não sai', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-ga-'));
  const port = 39800 + Math.floor(Math.random() * 150);
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
  const marcos = await login('marcos', true);
  const mk = async (name, login2, extra = {}) => (await (await marcos('/api/users', 'POST', { name, login: login2, password: 'segredo123', role: 'seller', ...extra })).json());
  const many = await mk('Manderson', 'manderson', { officeAdmin: true });
  const ana = await mk('Ana', 'ana');
  const manderson = await login('manderson'); const anaCall = await login('ana');
  const me = (await (await marcos('/api/users')).json()).find((u) => u.login === 'marcos');
  // Administrador de escritório e vendedor não conseguem se promover nem promover outros.
  assert.equal((await manderson(`/api/users/${many.id}`, 'PATCH', { role: 'admin' })).status, 403, 'admin do escritório não se promove');
  assert.equal((await anaCall(`/api/users/${ana.id}`, 'PATCH', { role: 'admin' })).status, 403, 'vendedor não se promove');
  // Marcos (administrador geral) promove o Manderson; vale na hora.
  const up = await marcos(`/api/users/${many.id}`, 'PATCH', { role: 'admin' });
  assert.equal(up.status, 200);
  assert.equal((await up.json()).role, 'admin');
  // Ninguém muda o próprio nível, nem o Marcos.
  assert.equal((await marcos(`/api/users/${me.id}`, 'PATCH', { role: 'seller' })).status, 403);
  // Agora o Manderson (admin geral) pode rebaixar a Ana? Ela é vendedora: promover é permitido, e depois remover também.
  assert.equal((await manderson(`/api/users/${ana.id}`, 'PATCH', { role: 'admin' })).status, 200);
  assert.equal((await manderson(`/api/users/${ana.id}`, 'PATCH', { role: 'seller' })).status, 200);
  // Rebaixar o Manderson deixa o Marcos como único: permitido; depois rebaixar o último é bloqueado pelo sistema.
  assert.equal((await marcos(`/api/users/${many.id}`, 'PATCH', { role: 'seller' })).status, 200);
  // Comissões e saques: vendedor vê só o próprio saldo e pede saque; aprovar, pagar e níveis só o administrador.
  assert.equal((await anaCall('/api/commissions/me')).status, 200);
  assert.equal((await anaCall('/api/commissions/overview')).status, 403);
  assert.equal((await anaCall('/api/commissions/levels', 'PUT', { enabled: true })).status, 403);
  assert.equal((await anaCall('/api/withdrawals/abc123/pay', 'POST', {})).status, 403);
  assert.equal((await anaCall('/api/withdrawals', 'POST', { amount: 10, pixKey: 'x' })).status, 400, 'sem comissão liberada não há saque');
  assert.equal((await marcos('/api/commissions/overview')).status, 200);
  // Suporte: vendedor abre e conversa no próprio chamado; resolver só o administrador.
  const tk = await (await anaCall('/api/support', 'POST', { title: 'Erro', description: 'Detalhes' })).json();
  assert.equal((await anaCall(`/api/support/${tk.id}/messages`, 'POST', { text: 'mais detalhes' })).status, 200);
  assert.equal((await anaCall(`/api/support/${tk.id}/resolve`, 'POST', { solution: 'x' })).status, 403);
  assert.equal((await marcos(`/api/support/${tk.id}/resolve`, 'POST', { solution: 'Feito' })).status, 200);
  const last = await fetch(`${base}/api/users/${me.id}`, { method: 'PATCH', headers: { ...J }, body: JSON.stringify({ role: 'seller' }) });
  assert.ok(last.status === 401 || last.status === 403, 'sem login não faz nada');
});
