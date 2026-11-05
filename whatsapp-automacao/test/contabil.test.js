import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contabil } from '../src/contabil.js';
import { Cash } from '../src/cash.js';
import { totpCode } from '../src/security.js';
import { tempStore } from './helpers.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const man = { id: 'm', name: 'Manderson', role: 'admin' };
let NOW = new Date('2026-11-05T12:00:00Z');

test('contábil: empresa com regime já traz as obrigações; vencimento pelo último número do RUC; sem duplicar; anual só no mês dele', () => {
  const store = tempStore();
  const ct = new Contabil({ store, now: () => NOW });
  assert.ok(ct.data.obligations.length >= 5, 'catálogo inicial');
  assert.throws(() => ct.addCompany(man, {}), /razão social/);
  assert.throws(() => ct.addCompany(man, { name: 'X', ruc: 'abc' }), /RUC inválido/);
  const a = ct.addCompany(man, { name: 'Ferreteria Sol SA', ruc: '80012345-6', regime: 'ire_general', monthlyFee: '1.500.000', currency: 'PYG', feeDay: 10, responsible: 'Manderson' });
  assert.throws(() => ct.addCompany(man, { name: 'Outra', ruc: '80012345-6' }), /mesmo RUC|Já existe/);
  const iva = ct.data.obligations.find((o) => o.key === 'iva');
  assert.ok(a.obligationIds.includes(iva.id), 'IVA vem marcado para IRE geral');
  assert.equal(ct.rucDigit('80012345-6'), 5, 'último número antes do dígito verificador');
  ct.generate('2026-11');
  const t = ct.data.tasks.filter((x) => x.companyId === a.id);
  const ivaTask = t.find((x) => x.obligationId === iva.id);
  assert.deepEqual([ivaTask.dueDate, ivaTask.reference], ['2026-11-17', '2026-10'], 'final 5 → dia 17; referência é o mês anterior');
  assert.ok(!t.some((x) => /anual/.test(x.name)), 'anual não aparece fora do mês dele');
  const n = ct.data.tasks.length;
  ct.generate('2026-11');
  assert.equal(ct.data.tasks.length, n, 'gerar de novo não duplica');
  ct.generate('2026-04');
  assert.ok(ct.data.tasks.some((x) => x.companyId === a.id && x.dueMonth === '2026-04' && /IRE anual/.test(x.name) && x.reference === '2025'));
  // Dias editáveis.
  assert.throws(() => ct.setRucDays({ 0: 40 }), /Dia inválido/);
  ct.setRucDays({ 0: 7, 1: 9, 2: 11, 3: 13, 4: 15, 5: 20, 6: 19, 7: 21, 8: 23, 9: 25 });
  ct.generate('2026-12');
  assert.equal(ct.data.tasks.find((x) => x.companyId === a.id && x.obligationId === iva.id && x.dueMonth === '2026-12').dueDate, '2026-12-20');
  // Empresa suspensa não gera nada novo.
  ct.updateCompany(man, a.id, { status: 'suspenso' });
  const before = ct.data.tasks.length; ct.generate('2027-01');
  assert.equal(ct.data.tasks.length, before);
});

test('contábil: entrega com protocolo, atrasadas, documentos pedidos e honorário pago entra no Caixa Contábil', () => {
  const store = tempStore();
  NOW = new Date('2026-11-20T12:00:00Z');
  const ct = new Contabil({ store, now: () => NOW });
  const cash = new Cash({ store, auth: null, extraAutomatic: () => ct.cashEntries() });
  const a = ct.addCompany(man, { name: 'Loja Uno', ruc: '4567890-1', regime: 'ire_simple', monthlyFee: 800000 });
  const o = ct.overview('2026-11');
  assert.ok(o.tasks.length >= 1);
  assert.ok(o.tasks.every((x) => x.late), 'final 0 venceu dia 7: tudo atrasado em 20/11');
  assert.equal(o.totals.lateTasks, o.tasks.length);
  const done = ct.updateTask(man, o.tasks[0].id, { status: 'entregue', protocol: 'ABC123' });
  assert.deepEqual([done.deliveredAt, done.protocol, done.deliveredBy], ['2026-11-20', 'ABC123', 'Manderson']);
  assert.throws(() => ct.updateTask(man, o.tasks[0].id, { status: 'xyz' }), /inválida/);
  const r = ct.addRequest(man, { companyId: a.id, title: 'Extrato bancário' });
  assert.equal(ct.overview('2026-11').totals.docsPending, 1);
  ct.updateRequest(man, r.id, { status: 'recebido' });
  assert.equal(ct.overview('2026-11').totals.docsPending, 0);
  const fee = ct.overview('2026-11').fees[0];
  assert.deepEqual([fee.amount, fee.currency, fee.dueDate, fee.late], [800000, 'PYG', '2026-11-10', true]);
  assert.equal(cash.entries({ book: 'contabil' }).length, 0);
  ct.updateFee(man, fee.id, { status: 'pago', method: 'Transferência' });
  const e = cash.entries({ book: 'contabil' });
  assert.deepEqual([e.length, e[0].amount, e[0].currency, e[0].category], [1, 800000, 'PYG', 'Honorários contábeis']);
  assert.equal(cash.entries({}).length, 0, 'nada no Caixa Migra');
  assert.equal(ct.overview('2026-11').totals.feesPaid.PYG, 800000);
});

function client(base) {
  let cookie = '';
  return async (url, { method = 'GET', body } = {}) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.getSetCookie?.() || [];
    if (set.length) cookie = set.filter((c) => c.startsWith('zapauto_sessao=')).map((c) => c.split(';')[0]).join('; ') || cookie;
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
}
async function enter(base, login, password) {
  const c = client(base);
  assert.equal((await c('/api/auth/login', { method: 'POST', body: { login, password } })).status, 200);
  const s = await c('/api/security/2fa/setup');
  await c('/api/security/2fa/enable', { method: 'POST', body: { code: totpCode(s.body.secret) } });
  return c;
}

test('contábil (servidor): só quem vê o Caixa Contábil abre o painel; vendedor e administrador fora da lista não', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-ct-'));
  const port = 38850 + Math.floor(Math.random() * 100);
  const proc = spawn(process.execPath, ['src/server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: String(port), TUNNEL: 'off', OPEN_BROWSER: '' }, stdio: 'ignore' });
  t.after(() => proc.kill());
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) { try { await fetch(`${base}/api/auth/state`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const owner = client(base);
  await owner('/api/auth/setup', { method: 'POST', body: { name: 'Manderson', login: 'manderson', password: 'teste1234' } });
  const s = await owner('/api/security/2fa/setup');
  await owner('/api/security/2fa/enable', { method: 'POST', body: { code: totpCode(s.body.secret) } });
  const me = (await owner('/api/auth/state')).body.user;
  await owner('/api/users', { method: 'POST', body: { name: 'Camila', login: 'camila', password: 'camila123', role: 'seller' } });
  await owner('/api/users', { method: 'POST', body: { name: 'Marcos', login: 'marcos', password: 'marcos1234', role: 'admin' } });
  const camila = await enter(base, 'camila', 'camila123');
  const marcos = await enter(base, 'marcos', 'marcos1234');

  const c = await owner('/api/contabil/companies', { method: 'POST', body: { name: 'Ferreteria Sol', ruc: '80012345-6', regime: 'ire_general', monthlyFee: 1000000 } });
  assert.equal(c.status, 200);
  const ov = await owner('/api/contabil');
  assert.equal(ov.status, 200);
  assert.ok(ov.body.tasks.length >= 1 && ov.body.fees.length === 1);
  assert.equal((await owner(`/api/contabil/tasks/${ov.body.tasks[0].id}`, { method: 'PATCH', body: { status: 'entregue' } })).status, 200);
  assert.equal((await camila('/api/contabil')).status, 403, 'vendedor não');
  assert.equal((await camila('/api/contabil/companies', { method: 'POST', body: { name: 'X' } })).status, 403);
  // Só o Manderson na lista da Contábil: o Marcos deixa de ver este painel (e o caixa dela).
  assert.equal((await owner('/api/cash/settings', { method: 'PUT', body: { categories: [], allowedUserIds: [], contabilUserIds: [me.id] } })).status, 200);
  assert.equal((await marcos('/api/contabil')).status, 403);
  assert.equal((await marcos('/api/contabil-ruc-days', { method: 'PUT', body: { days: {} } })).status, 403);
  assert.equal((await owner('/api/contabil')).status, 200);
  const audit = await owner('/api/audit');
  assert.ok(JSON.stringify(audit.body).includes('contábil empresa'), 'fica na Auditoria');
});
