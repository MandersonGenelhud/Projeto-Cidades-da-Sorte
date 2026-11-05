import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ServiceCatalog } from '../src/services.js';
import { totpCode } from '../src/security.js';
import { tempStore } from './helpers.js';

const admin = { role: 'admin', name: 'Marcos' }; const seller = { role: 'seller', name: 'Ana' };
const cap = { api: [{ url: 'https://velho.com/api/services', json: { count: 3, data: [
  { id: 's1', name: 'Abertura de empresa EAS', category: 'empresarial', base_price: 8000, duration_days: null, commission_rate: 0, is_active: true },
  { id: 's2', name: 'Adicional Licença para condução', category: 'adicional', base_price: 1500, duration_days: 30, commission_rate: 10, is_active: true },
  { id: 's3', name: 'Serviço antigo', category: 'x', base_price: 100, is_active: false },
] } }] };

test('catálogo: importa da cópia sem duplicar, respeita o que o administrador editou e acha o serviço pelo nome', () => {
  const c = new ServiceCatalog({ store: tempStore() });
  assert.deepEqual(c.importCapture(cap), { added: 3, updated: 0, total: 3 });
  assert.deepEqual(c.importCapture(cap), { added: 0, updated: 3, total: 3 }, 'importar de novo não duplica');
  const lic = c.list({ q: 'licenca' })[0];
  assert.equal(lic.price, 1500); assert.equal(lic.durationDays, 30); assert.equal(lic.commissionPct, 10); assert.equal(lic.category, 'adicional');
  c.update(admin, lic.id, { price: 1800 });
  c.importCapture(cap);
  assert.equal(c.get(lic.id).price, 1800, 'a edição do administrador não é apagada pela cópia');
  assert.deepEqual(c.match('adicional licenca PARA conducao'), { name: 'Adicional Licença para condução', price: 1800, serviceId: lic.id });
  assert.equal(c.match('Serviço antigo'), null, 'inativo não entra no orçamento');
  assert.equal(c.list({ active: 'true' }).length, 2);
});

test('catálogo: só administrador cadastra e altera; dados validados', () => {
  const c = new ServiceCatalog({ store: tempStore() });
  assert.throws(() => c.add(seller, { name: 'X', price: 10 }), /Só o administrador/);
  const s = c.add(admin, { name: 'Tradução juramentada', category: 'documentos', price: '350,50', commissionPct: 5 });
  assert.equal(s.price, 350.5); assert.equal(s.category, 'documentos');
  assert.throws(() => c.add(admin, { name: 'tradução JURAMENTADA' }), /Já existe/);
  assert.throws(() => c.update(admin, s.id, { commissionPct: 150 }), /0 a 100/);
  assert.throws(() => c.update(seller, s.id, { price: 1 }), /Só o administrador/);
});

test('catálogo pelo painel: vendedor consulta (só ativos), não altera; orçamento aceita serviço do catálogo', async (t) => {
  const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const J = { 'content-type': 'application/json' };
  const ck = (r) => r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-sv-'));
  const port = 39950 + Math.floor(Math.random() * 40);
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
  await marcos('/api/users', 'POST', { name: 'Ana', login: 'ana', password: 'segredo123', role: 'seller' });
  const ana = await login('ana');
  const s = await (await marcos('/api/services', 'POST', { name: 'Tradução juramentada', price: 350, category: 'documentos' })).json();
  const off = await (await marcos('/api/services', 'POST', { name: 'Serviço parado', price: 10 })).json();
  await marcos(`/api/services/${off.id}`, 'PATCH', { active: false });
  assert.equal((await ana('/api/services', 'POST', { name: 'Y', price: 1 })).status, 403);
  assert.equal((await ana(`/api/services/${s.id}`, 'PATCH', { price: 1 })).status, 403);
  const list = await (await ana('/api/services')).json();
  assert.deepEqual(list.items.map((x) => x.name), ['Tradução juramentada'], 'vendedor vê só os ativos');
  const q = await (await ana('/api/quotes/preview', 'POST', { items: [{ pacote: 'traducao juramentada', quantidade: 2 }] })).json();
  assert.equal(q.items[0].name, 'Tradução juramentada');
  assert.equal(q.items[0].total, 700, 'preço do catálogo × quantidade');
  const bad = await ana('/api/quotes/preview', 'POST', { items: [{ pacote: 'Serviço parado', quantidade: 1 }] });
  assert.equal(bad.status, 400, 'serviço inativo não entra no orçamento');
});
