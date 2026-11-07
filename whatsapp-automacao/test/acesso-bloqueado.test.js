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

test('acesso bloqueado por tentativas: o administrador libera pelo botão ou trocando a senha; vendedor não libera; o painel mostra quem está travado', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-unlock-'));
  const port = 39950 + Math.floor(Math.random() * 40);
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
  const ana = await (await marcos('/api/users', 'POST', { name: 'Ana Vendedora', login: 'ana', password: 'segredo123', role: 'seller' })).json();
  const bia = await (await marcos('/api/users', 'POST', { name: 'Bia Vendedora', login: 'bia', password: 'segredo123', role: 'seller' })).json();
  await marcos('/api/users', 'POST', { name: 'Caio Vendedor', login: 'caio', password: 'segredo123', role: 'seller' });
  const caio = await login('caio');
  const tryLogin = (who, password) => fetch(`${base}/api/auth/login`, { method: 'POST', headers: J, body: JSON.stringify({ login: who, password }) });
  const lock = async (who) => { for (let i = 0; i < 5; i++) await tryLogin(who, 'errada'); };
  await lock('ana');
  assert.equal((await tryLogin('ana', 'errada')).status, 429, 'bloqueada por tentativas');
  const listed = await (await marcos('/api/users')).json();
  assert.ok(listed.find((u) => u.id === ana.id).lockedMin > 0, 'o painel mostra que ela está travada');
  assert.equal(listed.find((u) => u.id === bia.id).lockedMin, 0);
  // Trocar a senha também libera, na hora (sem esperar os 15 minutos).
  assert.equal((await marcos(`/api/users/${ana.id}`, 'PATCH', { password: 'novasenha123' })).status, 200);
  const ok = await tryLogin('ana', 'novasenha123');
  assert.notEqual(ok.status, 429, 'liberada pela troca de senha');
  assert.equal(ok.status, 200);
  // O botão "Liberar acesso" libera sem trocar a senha.
  await lock('bia');
  assert.equal((await tryLogin('bia', 'segredo123')).status, 429);
  assert.equal((await caio(`/api/users/${bia.id}/unlock`, 'POST')).status, 403, 'vendedor não libera ninguém');
  assert.equal((await marcos(`/api/users/${bia.id}/unlock`, 'POST')).status, 200);
  assert.equal((await tryLogin('bia', 'segredo123')).status, 200, 'liberada pelo botão, com a mesma senha');
  assert.equal((await marcos('/api/users/inexistente/unlock', 'POST')).status, 404);
});
