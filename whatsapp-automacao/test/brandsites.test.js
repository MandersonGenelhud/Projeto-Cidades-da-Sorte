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

test('sites das marcas: páginas abrem, veículos públicos sem placa e interesse vira prospecto do atendente da área', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-brands-'));
  const port = 39300 + Math.floor(Math.random() * 600);
  const base = `http://127.0.0.1:${port}`;
  const proc = spawn(process.execPath, ['src/server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: String(port), TUNNEL: 'off', OPEN_BROWSER: '' }, stdio: 'ignore' });
  t.after(() => proc.kill());
  for (let i = 0; i < 60; i++) { try { await fetch(`${base}/api/auth/state`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  for (const p of ['/marcas', '/migra', '/motors', '/school', '/imoveis']) assert.equal((await fetch(base + p)).status, 200, p);

  const s = await fetch(`${base}/api/auth/setup`, { method: 'POST', headers: J, body: JSON.stringify({ name: 'Marcos', login: 'marcos', password: 'segredo123', whatsapp: '595987101567' }) });
  let cookie = ck(s);
  const admin = (u, m = 'GET', b) => fetch(base + u, { method: m, headers: { cookie, ...J }, body: b ? JSON.stringify(b) : undefined });
  const sec = await (await admin('/api/security/2fa/setup')).json();
  cookie = ck(await admin('/api/security/2fa/enable', 'POST', { code: totpCode(sec.secret) })) || cookie;
  const seller = await (await admin('/api/users', 'POST', { name: 'Paulo Motors', login: 'paulo', password: 'segredo123', role: 'seller', whatsapp: '595981555555', sectors: ['veiculos'] })).json();
  await admin('/api/motors/vehicles', 'POST', { brand: 'Toyota', model: 'Hilux', year: 2020, price: 30000, plate: 'ABC123', published: true });
  await admin('/api/motors/vehicles', 'POST', { brand: 'Fiat', model: 'Uno', price: 5000 });

  const pub = await (await fetch(`${base}/api/public/vehicles`)).json();
  assert.equal(pub.vehicles.length, 1);
  assert.ok(!JSON.stringify(pub).includes('ABC123'), 'placa não vai para o público');

  const post = (b) => fetch(`${base}/api/public/lead`, { method: 'POST', headers: J, body: JSON.stringify(b) });
  assert.equal((await post({ brand: 'x', name: 'Ana', whatsapp: '+595981111111' })).status, 400);
  assert.equal((await post({ brand: 'veiculos', name: 'A', whatsapp: '+595981111111' })).status, 400);
  assert.equal((await post({ brand: 'veiculos', name: 'Ana', whatsapp: '12' })).status, 400);
  const ok = await post({ brand: 'veiculos', name: 'Ana Souza', whatsapp: '+595981111111', item: 'Toyota Hilux 2020', message: 'Quero financiar' });
  assert.equal(ok.status, 200);
  const r = await ok.json();
  assert.match(r.whatsappUrl, /wa\.me\/595981555555/, 'leva ao WhatsApp do atendente da área');
  const leads = await (await admin('/api/leads')).json();
  const lead = (leads.leads || leads).find((l) => l.code === r.code);
  assert.equal(lead.ownerId, seller.id);
  assert.equal(lead.source, 'site');
  // limite de pedidos por endereço
  let last;
  for (let i = 0; i < 9; i++) last = await post({ brand: 'school', name: 'Teste', whatsapp: `+59598100000${i}` });
  assert.equal(last.status, 429);
});
