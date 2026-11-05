import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Migratech } from '../src/migratech.js';
import { AppSignups, maskEmail, maskPhone } from '../src/app-signups.js';
import { Cash } from '../src/cash.js';
import { totpCode } from '../src/security.js';
import { tempStore } from './helpers.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const marcos = { id: 'm', name: 'Marcos', role: 'admin' };
const NOW = new Date('2026-11-05T12:00:00Z');

test('migratech: clientes, contratos e serviços validados; receita mensal por moeda; serviço pago entra sozinho no Caixa Migratech', () => {
  const store = tempStore();
  const mt = new Migratech({ store, now: () => NOW });
  const cash = new Cash({ store, auth: null, extraAutomatic: () => mt.cashEntries() });
  assert.throws(() => mt.addClient(marcos, {}), /nome do cliente/);
  const c = mt.addClient(marcos, { name: 'Clínica Sorriso', email: 'contato@sorriso.com' });
  assert.throws(() => mt.addContract(marcos, { clientId: 'x', title: 'a', value: 10 }), /Cliente não encontrado/);
  mt.addContract(marcos, { clientId: c.id, title: 'Sistema de atendimento', value: '1.500,00', recurrence: 'mensal' });
  mt.addContract(marcos, { clientId: c.id, title: 'Hospedagem', value: 1200, recurrence: 'anual' });
  const usd = mt.addContract(marcos, { clientId: c.id, title: 'Suporte', value: 100, currency: 'USD', recurrence: 'mensal', status: 'pausado' });
  assert.equal(usd.number, 'MT-0003');
  const s = mt.addService(marcos, { clientId: c.id, description: 'Configuração inicial', value: 800, date: '2026-11-02' });
  mt.addService(marcos, { clientId: c.id, description: 'Treinamento', value: 300, status: 'faturado' });
  const o = mt.overview();
  assert.deepEqual(o.totals.mrr, { BRL: 1600 }, 'mensal inteiro + anual ÷ 12; pausado não conta; moedas separadas');
  assert.deepEqual([o.totals.toBill.BRL, o.totals.toReceive.BRL], [800, 300]);
  assert.equal(cash.entries({ book: 'migratech' }).length, 0, 'a faturar ainda não é dinheiro no caixa');
  mt.updateService(marcos, s.id, { status: 'pago' });
  const entries = cash.entries({ book: 'migratech' });
  assert.equal(entries.length, 1);
  assert.deepEqual([entries[0].kind, entries[0].amount, entries[0].category, entries[0].date], ['entrada', 800, 'Serviços prestados', '2026-11-05']);
  assert.equal(cash.entries({}).length, 0, 'nada da Migratech aparece no Caixa Migra');
  assert.throws(() => mt.remove(marcos, 'clients', c.id, 'teste'), /tem contratos ou serviços/);
  assert.throws(() => mt.remove(marcos, 'services', s.id, ''), /motivo/);
  mt.remove(marcos, 'services', s.id, 'lançado errado');
  assert.equal(cash.entries({ book: 'migratech' }).length, 0, 'serviço apagado sai do caixa');
});

test('saques dos sócios: precisa dizer qual sócio (Marcos ou Manderson) e soma por sócio e moeda', () => {
  const store = tempStore();
  const cash = new Cash({ store, auth: null });
  assert.equal(cash.add(marcos, { kind: 'saida', amount: 1, description: 'Retirada antiga', category: 'Retirada de sócio', book: 'migra' }).partner, '', 'sem nome (Nina, importação) continua aceito, só não entra na soma por sócio');
  assert.throws(() => cash.add(marcos, { kind: 'saida', amount: 100, description: 'Saque', category: 'Retirada de sócio', partner: 'Fulano' }), /Marcos ou Manderson/);
  cash.add(marcos, { kind: 'saida', amount: 1000, description: 'Saque', category: 'Retirada de sócio', partner: 'marcos', book: 'migratech' });
  cash.add(marcos, { kind: 'saida', amount: 700, description: 'Saque', category: 'Retirada de sócio', partner: 'Manderson', book: 'migratech' });
  cash.add(marcos, { kind: 'saida', amount: 50, currency: 'USD', description: 'Saque', category: 'Retirada de sócio', partner: 'Manderson', book: 'migratech' });
  const aluguel = cash.add(marcos, { kind: 'saida', amount: 300, description: 'Aluguel', category: 'Outros', partner: 'Marcos', book: 'migratech' });
  assert.equal(aluguel.partner, '', 'sócio só é guardado em saque');
  assert.deepEqual(cash.partnerTotals(cash.entries({ book: 'migratech' })), { Marcos: { BRL: 1000 }, Manderson: { BRL: 700, USD: 50 } });
});

test('Migra Devocional: chave guardada só como resumo, cadastros sem duplicar, contagens e dados mascarados', () => {
  const store = tempStore();
  const apps = new AppSignups({ store, now: () => NOW });
  assert.equal(apps.checkKey('devocional', 'qualquer'), false, 'sem chave gerada nada entra');
  const key = apps.newKey('devocional', marcos);
  assert.match(key, /^mhub_devocional_/);
  assert.ok(!JSON.stringify(store.data).includes(key), 'a chave em si não fica guardada');
  assert.equal(apps.checkKey('devocional', key), true);
  assert.equal(apps.checkKey('devocional', `${key}x`), false);
  assert.equal(apps.checkKey('outroapp', key), false);
  const r = apps.ingest('devocional', { users: [
    { id: 'u1', name: 'Ana', email: 'ana.souza@gmail.com', plan: 'familia', createdAt: '2026-11-05T09:00:00Z' },
    { id: 'u2', name: 'Beto', phone: '+55 45 99999-1234', createdAt: '2026-10-20T09:00:00Z' },
    { email: 'invalido' }, {},
  ] });
  assert.deepEqual([r.added, r.skipped, r.total], [2, 2, 2]);
  assert.equal(apps.ingest('devocional', { id: 'u1', plan: 'premium' }).updated, 1, 'mesmo id atualiza');
  apps.ingest('devocional', { id: 'u2', deleted: true });
  const s = apps.stats('devocional');
  assert.deepEqual([s.total, s.left, s.today, s.last7, s.last30], [1, 1, 1, 1, 1]);
  assert.equal(s.byDay.length, 30);
  assert.equal(s.recent[0].email, maskEmail('ana.souza@gmail.com'));
  assert.ok(!JSON.stringify(s).includes('ana.souza@'), 'o painel não mostra o e-mail inteiro');
  assert.match(maskPhone('5545999991234'), /^\+5545•••34$/);
  assert.throws(() => apps.ingest('devocional', { users: Array.from({ length: 501 }, (_, i) => ({ id: `x${i}` })) }), /500/);
  const old = key; apps.newKey('devocional', marcos);
  assert.equal(apps.checkKey('devocional', old), false, 'chave nova derruba a antiga');
});

function client(base) {
  let cookie = '';
  return async (url, { method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.getSetCookie?.() || [];
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
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

test('Migratech e Devocional (servidor): só quem pode vê; o aplicativo entra só com a chave certa', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-mt-'));
  const port = 38100 + Math.floor(Math.random() * 300);
  const proc = spawn(process.execPath, ['src/server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: String(port), TUNNEL: 'off', OPEN_BROWSER: '' }, stdio: 'ignore' });
  t.after(() => proc.kill());
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) { try { await fetch(`${base}/api/auth/state`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const owner = client(base);
  await owner('/api/auth/setup', { method: 'POST', body: { name: 'Marcos', login: 'marcos', password: 'teste1234' } });
  const s = await owner('/api/security/2fa/setup');
  await owner('/api/security/2fa/enable', { method: 'POST', body: { code: totpCode(s.body.secret) } });
  const me = (await owner('/api/auth/state')).body.user;
  await owner('/api/users', { method: 'POST', body: { name: 'Camila', login: 'camila', password: 'camila123', role: 'seller' } });
  const other = await owner('/api/users', { method: 'POST', body: { name: 'Outro Admin', login: 'outro', password: 'outro1234', role: 'admin' } });
  const camila = await enter(base, 'camila', 'camila123');
  const outro = await enter(base, 'outro', 'outro1234');

  // Migratech: vendedor nunca; administrador fora da lista do Caixa Migratech também não.
  assert.equal((await camila('/api/migratech')).status, 403);
  const cl = await owner('/api/migratech/clients', { method: 'POST', body: { name: 'Clínica Sorriso' } });
  assert.equal(cl.status, 200);
  assert.equal((await owner('/api/migratech/contracts', { method: 'POST', body: { clientId: cl.body.id, title: 'Sistema', value: 1500 } })).status, 200);
  assert.equal((await owner('/api/migratech-withdrawals', { method: 'POST', body: { amount: 400 } })).status, 400, 'saque pela Migratech exige o sócio');
  assert.equal((await owner('/api/migratech-withdrawals', { method: 'POST', body: { partner: 'Manderson', amount: 400 } })).status, 200);
  const ov = await owner('/api/migratech');
  assert.equal(ov.status, 200);
  assert.deepEqual(ov.body.partnerTotals.Manderson, { BRL: 400 });
  assert.equal((await owner('/api/cash/settings', { method: 'PUT', body: { categories: [], allowedUserIds: [], migratechUserIds: [me.id] } })).status, 200);
  assert.equal((await outro('/api/migratech')).status, 403, 'fora da lista da Migratech');
  assert.equal((await outro('/api/migratech-withdrawals', { method: 'POST', body: { partner: 'Marcos', amount: 1 } })).status, 403);
  assert.equal((await outro('/api/cash?book=migratech')).status, 403);
  assert.equal((await outro('/api/cash')).status, 200, 'o Caixa Migra continua liberado para ele');
  assert.ok(other.body.id);

  // Devocional: chave só administrador; o aplicativo precisa da chave certa.
  assert.equal((await camila('/api/app-signups/devocional/key', { method: 'POST', body: {} })).status, 403);
  const hook = (key, body) => fetch(`${base}/api/integrations/devocional/users`, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body) });
  assert.equal((await hook('', { id: 'u1' })).status, 401, 'sem chave não entra');
  const key = (await owner('/api/app-signups/devocional/key', { method: 'POST', body: {} })).body.key;
  assert.equal((await hook(`${key}x`, { id: 'u1' })).status, 401, 'chave errada não entra');
  const ok = await hook(key, { users: [{ id: 'u1', name: 'Ana', email: 'ana@x.com' }, { id: 'u2', name: 'Beto' }] });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).added, 2);
  const st = await owner('/api/app-signups/devocional');
  assert.deepEqual([st.body.total, st.body.connected], [2, true]);
  assert.equal((await camila('/api/app-signups/devocional')).status, 403, 'vendedor não vê os cadastros');
  assert.equal((await owner('/api/app-signups/devocional/key', { method: 'DELETE', body: {} })).status, 200);
  assert.equal((await hook(key, { id: 'u3' })).status, 401, 'desligado: a chave para de valer');
  const log = (await owner('/api/security/log')).body;
  const types = (Array.isArray(log) ? log : log.events || []).map((e) => e.type);
  for (const k of ['app_chave_criada', 'app_chave_invalida', 'app_chave_revogada']) assert.ok(types.includes(k), k);
});
