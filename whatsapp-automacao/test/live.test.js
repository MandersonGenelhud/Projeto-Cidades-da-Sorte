import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Live } from '../src/live.js';
import { siteAllows } from '../src/site-host.js';
import { totpCode } from '../src/security.js';
import { tempStore } from './helpers.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const J = { 'content-type': 'application/json' };
const ck = (r) => r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const MEET = 'https://meet.google.com/abc-defg-hij';
const GRP = 'https://chat.whatsapp.com/ABCdef1234567890';

test('live: o link do Meet só aparece ao vivo; frases mudam; entradas inválidas são recusadas', () => {
  let now = new Date('2026-11-03T20:00:00Z');
  const l = new Live({ store: tempStore(), now: () => now });
  assert.equal(l.publicView().status, 'off');
  assert.throws(() => l.set({ status: 'live' }), /Meet/);
  l.set({ meetLink: MEET, startsAt: '2026-11-05T19:30', groups: [{ name: 'Grupo 1', url: GRP }], status: 'soon' });
  let v = l.publicView();
  assert.match(v.text, /em breve/i);
  assert.equal(v.meetLink, '', 'em breve: sem link da sala');
  assert.equal(v.startsAt, '2026-11-05T19:30');
  l.set({ status: 'live' });
  v = l.publicView();
  assert.match(v.text, /Estamos ao vivo/);
  assert.match(v.text, /dúvidas ao vivo pelo chat/);
  assert.equal(v.meetLink, MEET);
  assert.match(l.promptInfo('https://x/live'), /AO VIVO/);
  assert.doesNotMatch(l.promptInfo('https://x/live'), /meet\.google/);
  // esquecida ligada: encerra sozinha depois de 8 horas
  now = new Date('2026-11-04T05:00:00Z');
  assert.equal(l.publicView().status, 'ended');
  assert.equal(l.publicView().meetLink, '');
  for (const bad of [{ meetLink: 'https://evil.example/meet.google.com/abc-defg-hij' }, { meetLink: 'javascript:alert(1)' }, { groups: [{ name: 'x', url: 'https://evil.example/x' }] }, { startsAt: 'amanhã' }, { status: 'x' }]) assert.throws(() => l.set(bad), undefined, JSON.stringify(bad));
  assert.equal(l.set({ title: '<script>alert(1)</script>Live' }).title.includes('<'), false);
});

test('live: o domínio do site libera /live e a rota pública; o painel é só do administrador', async (t) => {
  assert.equal(siteAllows('GET', '/live'), true);
  assert.equal(siteAllows('GET', '/api/public/live'), true);
  assert.equal(siteAllows('PUT', '/api/live'), false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-live-'));
  const port = 39300 + Math.floor(Math.random() * 150);
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
  const ana = await login('ana');
  // público, sem login
  assert.equal((await (await fetch(`${base}/api/public/live`)).json()).status, 'off');
  assert.equal((await fetch(`${base}/live`)).status, 200);
  assert.equal((await ana('/api/live')).status, 403);
  assert.equal((await ana('/api/live', 'PUT', { status: 'soon' })).status, 403);
  assert.equal((await admin('/api/live', 'PUT', { meetLink: 'https://evil.example/x' })).status, 400);
  assert.equal((await admin('/api/live', 'PUT', { meetLink: MEET, groups: [{ name: 'G', url: GRP }], startsAt: '2026-11-05T19:30', status: 'soon' })).status, 200);
  let pub = await (await fetch(`${base}/api/public/live`)).json();
  assert.equal(pub.status, 'soon'); assert.equal(pub.meetLink, ''); assert.equal(pub.groups.length, 1);
  await admin('/api/live', 'PUT', { status: 'live' });
  pub = await (await fetch(`${base}/api/public/live`)).json();
  assert.equal(pub.meetLink, MEET);
  assert.match(JSON.stringify(await (await admin('/api/audit')).json()), /live/i);
});

test('link de atendimento: cada clique vai para um vendedor diferente em rodízio, sem criar prospecto, e é liberado no domínio do site', async (t) => {
  assert.equal(siteAllows('GET', '/atendimento'), true);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-lk-'));
  const port = 39800 + Math.floor(Math.random() * 150);
  const base = `http://127.0.0.1:${port}`;
  const proc = spawn(process.execPath, ['src/server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: String(port), TUNNEL: 'off', OPEN_BROWSER: '' }, stdio: 'ignore' });
  t.after(() => proc.kill());
  for (let i = 0; i < 60; i++) { try { await fetch(`${base}/api/auth/state`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const body = JSON.stringify({ name: 'Marcos', login: 'marcos', password: 'segredo123', whatsapp: '595987101567' });
  let cookie = ck(await fetch(`${base}/api/auth/setup`, { method: 'POST', headers: J, body }));
  const call = (u, m = 'GET', b) => fetch(base + u, { method: m, headers: { cookie, ...J }, body: b ? JSON.stringify(b) : undefined, redirect: 'manual' });
  const sec = await (await call('/api/security/2fa/setup')).json();
  cookie = ck(await call('/api/security/2fa/enable', 'POST', { code: totpCode(sec.secret) })) || cookie;
  // sem vendedor: avisa em vez de quebrar
  assert.equal((await fetch(`${base}/atendimento`, { redirect: 'manual' })).status, 503);
  for (const [n, l, w] of [['Diego', 'diego', '595981000001'], ['Ana', 'ana', '595981000002']]) await call('/api/users', 'POST', { name: n, login: l, password: 'segredo123', role: 'seller', whatsapp: w });
  const dest = [];
  for (let i = 0; i < 4; i++) { const r = await fetch(`${base}/atendimento?o=live`, { redirect: 'manual' }); assert.equal(r.status, 302); dest.push(r.headers.get('location')); }
  assert.ok(dest.every((d) => d.startsWith('https://wa.me/5959810000')));
  assert.notEqual(dest[0].slice(0, 30), dest[1].slice(0, 30), 'cliques seguidos vão para vendedores diferentes');
  assert.equal(dest[0].slice(0, 30), dest[2].slice(0, 30));
  assert.match(decodeURIComponent(dest[0]), /pela live da Migra/);
  assert.equal((await (await call('/api/leads')).json()).length, 0, 'não cria prospecto sem telefone');
  const st = await (await call('/api/links/stats')).json();
  assert.equal(st.total, 4);
  assert.deepEqual(st.sellers.map((x) => x.total), [2, 2]);
  // só o administrador vê as estatísticas
  const noCookie = await fetch(`${base}/api/links/stats`);
  assert.equal(noCookie.status, 401);
});
