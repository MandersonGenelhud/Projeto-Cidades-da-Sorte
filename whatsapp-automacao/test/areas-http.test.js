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

async function boot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-areas-'));
  const port = 39100 + Math.floor(Math.random() * 800);
  const proc = spawn(process.execPath, ['src/server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: String(port), TUNNEL: 'off', OPEN_BROWSER: '' }, stdio: 'ignore' });
  t.after(() => proc.kill());
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) { try { await fetch(`${base}/api/auth/state`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  return base;
}
/** Entra com a senha, liga as duas etapas (obrigatórias) e devolve uma função de chamada já autenticada. */
async function session(base, login, password) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: J, body: JSON.stringify({ login, password }) });
  let cookie = ck(r);
  const call = (u, method = 'GET', body) => fetch(base + u, { method, headers: { cookie, ...J }, body: body === undefined ? undefined : JSON.stringify(body) });
  const sec = await (await call('/api/security/2fa/setup')).json();
  const en = await call('/api/security/2fa/enable', 'POST', { code: totpCode(sec.secret) });
  cookie = ck(en) || cookie;
  return call;
}

test('perfis na prática: vendedor não exclui, gerente cadastra mas não exclui, só o administrador audita e muda juros', async (t) => {
  const base = await boot(t);
  const setup = await fetch(`${base}/api/auth/setup`, { method: 'POST', headers: J, body: JSON.stringify({ name: 'Marcos', login: 'marcos', password: 'segredo123', whatsapp: '595987101567' }) });
  let cookie = ck(setup);
  const adminRaw = (u, method = 'GET', body) => fetch(base + u, { method, headers: { cookie, ...J }, body: body === undefined ? undefined : JSON.stringify(body) });
  const sec = await (await adminRaw('/api/security/2fa/setup')).json();
  cookie = ck(await adminRaw('/api/security/2fa/enable', 'POST', { code: totpCode(sec.secret) })) || cookie;
  const admin = adminRaw;

  const g = await (await admin('/api/users', 'POST', { name: 'Gabriel', login: 'gabriel', password: 'segredo123', role: 'seller' })).json();
  const m = await (await admin('/api/users', 'POST', { name: 'Gerente Ana', login: 'ana', password: 'segredo123', role: 'seller' })).json();
  assert.equal((await admin(`/api/users/${m.id}`, 'PATCH', { manager: true })).status, 200);

  const dev = await (await admin('/api/realty/developments', 'POST', { name: 'Lago Azul', city: 'Santa Rita' })).json();
  const lots = await (await admin(`/api/realty/developments/${dev.id}/block`, 'POST', { block: 'A', rows: 1, cols: 3, x: 5, y: 5, w: 30, h: 10, area: 360, price: '50.000' })).json();
  assert.equal((await admin('/api/finance/config', 'PUT', { bands: [{ upTo: 12, interestPct: 0 }, { upTo: 60, interestPct: 10 }] })).status, 200);

  const seller = await session(base, 'gabriel', 'segredo123');
  const manager = await session(base, 'ana', 'segredo123');

  // Vendedor: reserva o lote (preço enviado por ele é ignorado), mas não exclui, não mexe em juros, não vê auditoria nem a escola.
  assert.equal((await seller(`/api/realty/developments/${dev.id}/lots/${lots[0].id}`, 'PATCH', { status: 'reservado', price: '1' })).status, 200);
  assert.equal((await manager(`/api/realty/developments/${dev.id}/lots/${lots[1].id}`, 'PATCH', { price: '48.000' })).status, 200);
  assert.equal((await seller(`/api/realty/developments/${dev.id}/lots/${lots[0].id}`, 'DELETE')).status, 403);
  assert.equal((await seller('/api/finance/config', 'PUT', { minEntryPct: 1 })).status, 403);
  assert.equal((await seller('/api/audit')).status, 403);
  assert.equal((await seller('/api/school/summary')).status, 403);
  assert.equal((await seller('/api/attendants')).status, 403);
  for (const u of ['/api/resumes', '/api/resumes/export.csv', '/api/legacy/audit']) assert.equal((await seller(u)).status, 403, u);
  assert.equal((await admin('/api/resumes')).status, 200);
  assert.equal((await manager('/api/attendants')).status, 403);
  assert.equal((await admin('/api/attendants')).status, 200);
  // painel executivo: só administrador; módulos em standby: vendedor só lê
  assert.equal((await seller('/api/executive')).status, 403);
  const ex = await (await admin('/api/executive')).json();
  assert.deepEqual(Object.keys(ex.cobrancas), ['hoje', 'semana', 'mes', 'ano']);
  assert.equal(ex.months.length, 12);
  assert.equal((await seller('/api/site')).status, 403);
  assert.equal((await manager('/api/site', 'PUT', { heroTitle: 'x' })).status, 403);
  assert.equal((await admin('/api/site', 'PUT', { videos: [{ title: 'v', url: 'http://x.com/a.mp4' }] })).status, 400);
  assert.equal((await (await admin('/api/site', 'PUT', { heroTitle: 'Título do site', stats: [{ value: '10', label: 'testes' }] })).json()).heroTitle, 'Título do site');
  assert.equal((await seller('/api/pricing')).status, 403);
  assert.equal((await manager('/api/pricing', 'PUT', { markupPct: 1 })).status, 403);
  assert.equal((await admin('/api/pricing', 'PUT', { inPerM: 0.5, outPerM: 3, usdBrl: 5, markupPct: 250 })).status, 200);
  assert.equal((await (await admin('/api/pricing')).json()).model.configured, true);
  assert.equal((await seller('/api/modules')).status, 200);
  assert.equal((await seller('/api/modules', 'PUT', { standby: ['motors'] })).status, 403);
  const mods = await (await admin('/api/modules', 'PUT', { standby: ['motors', 'school', 'executive', 'team', 'x y', 'audit'] })).json();
  assert.deepEqual(mods.standby, ['motors', 'school'], 'telas essenciais e nomes inválidos são ignorados');
  assert.deepEqual((await (await seller('/api/modules')).json()).standby, ['motors', 'school']);
  await admin('/api/modules', 'PUT', { standby: [] });
  assert.equal((await seller('/api/realty/developments', 'POST', { name: 'Invasão' })).status, 403);

  // Reserva: faltando dados → 400; completa → 200; vendedor não confirma o próprio pagamento.
  const body = { devId: dev.id, lotId: lots[1].id, entry: 10000, installments: 60, client: { name: 'João' } };
  assert.equal((await seller('/api/finance/proposals', 'POST', body)).status, 400);
  const ok = await seller('/api/finance/proposals', 'POST', { ...body, client: { name: 'João', doc: '123', phone: '+595981', address: 'Rua 1' } });
  assert.equal(ok.status, 200);
  const prop = await ok.json();
  assert.equal((await seller(`/api/finance/proposals/${prop.id}/paid`, 'POST')).status, 403);
  assert.equal((await seller(`/api/finance/proposals/${prop.id}/pdf`)).status, 200);
  assert.equal((await manager(`/api/finance/proposals/${prop.id}/paid`, 'POST')).status, 200);

  // Gerente: cadastra loteamento/veículo/aluno, mas não exclui nem mexe nos juros.
  assert.equal((await manager('/api/realty/developments', 'POST', { name: 'Novo Mapa' })).status, 200);
  assert.equal((await manager('/api/motors/vehicles', 'POST', { brand: 'Toyota', model: 'Hilux', price: 30000 })).status, 200);
  assert.equal((await manager('/api/school/students', 'POST', { name: 'Maria' })).status, 200);
  assert.equal((await manager(`/api/realty/developments/${dev.id}/lots/${lots[0].id}`, 'DELETE')).status, 403);
  assert.equal((await manager('/api/finance/config', 'PUT', { minEntryPct: 1 })).status, 403);
  assert.equal((await manager('/api/audit')).status, 403);

  // Administrador exclui e a auditoria mostra tudo, com quem fez.
  assert.equal((await admin(`/api/realty/developments/${dev.id}/lots/${lots[2].id}`, 'DELETE')).status, 200);
  const { items } = await (await admin('/api/audit')).json();
  const res = items.find((e) => e.user === 'Gabriel' && e.entity === 'lote' && e.action === 'alterou');
  assert.deepEqual(res.changes.map((c) => [c.field, c.from, c.to]), [['status', 'disponivel', 'reservado']]);
  const price = items.find((e) => e.user === 'Gerente Ana' && e.entity === 'lote' && e.action === 'alterou');
  assert.deepEqual(price.changes.map((c) => [c.field, c.from, c.to]), [['price', '50000', '48000']]);
  assert.equal(price.sensitive, true);
  assert.ok(items.some((e) => e.user === 'Marcos' && e.action === 'excluiu' && e.entity === 'lote'));
  assert.ok(items.some((e) => e.user === 'Gerente Ana' && e.action === 'criou' && e.entity === 'veículo'));
  assert.ok(items.some((e) => e.entity === 'juros e regras' && e.user === 'Marcos'));
  assert.ok(items.some((e) => e.entity === 'módulos'), 'standby fica na auditoria');
  assert.ok(items.some((e) => e.entity === 'usuário' && e.changes.some((c) => c.field === 'manager')));
  assert.ok(!JSON.stringify(items).includes('segredo123'), 'senha nunca vai para o registro');
});
