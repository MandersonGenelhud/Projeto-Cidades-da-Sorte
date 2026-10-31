import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Cash } from '../src/cash.js';
import { totpCode } from '../src/security.js';
import { tempStore } from './helpers.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const admin = { id: 'a1', name: 'Marcos', role: 'admin' };

test('caixa: lançamentos validados, totais por moeda, "a pagar" separado e histórico de cada alteração', () => {
  const store = tempStore();
  const cash = new Cash({ store, auth: null });
  assert.throws(() => cash.add(admin, { kind: 'saida', amount: 0, description: 'x' }), /maior que zero/);
  assert.throws(() => cash.add(admin, { kind: 'saida', amount: 10, description: '' }), /Escreva o que foi/);
  assert.throws(() => cash.add(admin, { kind: 'x', amount: 10, description: 'a' }), /entrada ou saída/);
  assert.throws(() => cash.add(admin, { kind: 'saida', amount: 10, description: 'a', currency: 'EUR' }), /Moeda/);
  const aluguel = cash.add(admin, { kind: 'saida', amount: 2500, date: '2026-11-03', description: 'Aluguel do escritório', category: 'Aluguel e contas do escritório', method: 'Pix' });
  cash.add(admin, { kind: 'saida', amount: 800.5, date: '2026-11-05', description: 'Anúncios', category: 'Marketing e anúncios' });
  cash.add(admin, { kind: 'saida', amount: 300, date: '2026-11-06', description: 'Hospedagem em Hernandarias', currency: 'USD', category: 'Viagens e hospedagem' });
  cash.add(admin, { kind: 'saida', amount: 1000, description: 'Contador', status: 'a_pagar', dueDate: '2026-11-20', date: '2026-11-07' });
  cash.add(admin, { kind: 'entrada', amount: 5000, date: '2026-11-08', description: 'Consultoria avulsa' });
  const s = cash.summary(cash.entries({}));
  assert.deepEqual(s.byCurrency.BRL, { entradas: 5000, saidas: 3300.5, aPagar: 1000, aReceber: 0, saldo: 1699.5 }, 'o que ainda não foi pago não entra nas saídas');
  assert.equal(s.byCurrency.USD.saidas, 300, 'moedas nunca se misturam');
  assert.equal(s.spending[0].category, 'Aluguel e contas do escritório');
  assert.equal(cash.entries({ kind: 'entrada' }).length, 1);
  assert.equal(cash.entries({ q: 'hospedagem' })[0].currency, 'USD');
  assert.equal(cash.entries({ from: '2026-11-06', to: '2026-11-07' }).length, 2);
  // Alterar e apagar: o histórico guarda quem fez e o que mudou.
  cash.update({ name: 'Manderson' }, aluguel.id, { amount: 2600 });
  assert.match(cash.list.find((e) => e.id === aluguel.id).history.at(-1).text, /amount: 2500 → 2600/);
  assert.throws(() => cash.remove(admin, aluguel.id, ''), /motivo/);
  cash.remove(admin, aluguel.id, 'lançado em duplicidade');
  assert.equal(cash.entries({ category: 'Aluguel e contas do escritório' }).length, 0, 'apagado sai das contas');
  assert.equal(cash.list.find((e) => e.id === aluguel.id).deleted.reason, 'lançado em duplicidade', 'mas fica guardado');
  assert.throws(() => cash.update(admin, aluguel.id, { amount: 1 }), /não encontrado/);
});

test('caixa: recebimentos dos clientes e comissões pagas entram sozinhos, sem contar duas vezes', () => {
  const store = tempStore();
  const payments = { list: [
    { id: 'p1', status: 'paid', paidAt: '2026-11-02T12:00:00Z', amount: 2600, description: 'reserva - 2 adulto(s)', payerName: 'Luiza' },
    { id: 'p2', status: 'pending', amount: 999, description: 'não pago' },
  ] };
  const sales = { list: [{ id: 's1', number: 'VD-2026-0001', status: 'ativa', sellerName: 'Camila', client: { nome: 'Luiza' },
    parcels: [
      { label: 'Entrada', value: 2600, status: 'pago', paidAt: '2026-11-02', confirmedBy: 'Sistema (Pix confirmado)' },
      { label: '1ª parcela (50%)', value: 10000, status: 'pago', paidAt: '2026-11-10', method: 'Transferência', confirmedBy: 'Marcos' },
      { label: '2ª parcela (30%)', value: 6000, status: 'pendente' },
    ],
    commission: { status: 'paga', paidAt: '2026-11-12', value: 1200 } }] };
  const affiliates = { data: { commissions: [{ id: 'c1', status: 'paga', paidAt: '2026-11-13T10:00:00Z', amount: 300, currency: 'BRL', clientName: 'Luiza', affId: 'x' }, { id: 'c2', status: 'a_pagar', amount: 50 }] }, get: () => ({ name: 'Ana Paula' }) };
  const cash = new Cash({ store, auth: null, payments, sales, affiliates });
  const all = cash.entries({});
  assert.equal(all.filter((e) => e.kind === 'entrada').length, 2, 'Pix e 1ª parcela; a entrada confirmada pelo Pix não duplica');
  assert.equal(all.filter((e) => e.kind === 'saida').length, 2, 'comissão do vendedor e do parceiro');
  const s = cash.summary(all);
  assert.equal(s.byCurrency.BRL.entradas, 12600);
  assert.equal(s.byCurrency.BRL.saidas, 1500);
  assert.ok(all.every((e) => e.source === 'sistema'));
  assert.equal(cash.update.length >= 0, true);
  assert.throws(() => cash.update(admin, 'pay:p1', { amount: 1 }), /não encontrado/, 'o que vem do sistema não se edita aqui');
});

/** Cliente HTTP com cookie. */
function client(base) {
  let cookie = '';
  return async (url, { method = 'GET', body } = {}) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.getSetCookie?.() || [];
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
}
async function enter(base, login, password) {
  const c = client(base);
  const r = await c('/api/auth/login', { method: 'POST', body: { login, password } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s = await c('/api/security/2fa/setup');
  assert.equal((await c('/api/security/2fa/enable', { method: 'POST', body: { code: totpCode(s.body.secret) } })).status, 200);
  return c;
}

test('caixa: vendedor nunca vê; administrador fora da lista também não; quem foi liberado vê e tudo fica no registro de acessos', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-cash-'));
  const port = 39100 + Math.floor(Math.random() * 800);
  const proc = spawn(process.execPath, ['src/server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: String(port), TUNNEL: 'off', OPEN_BROWSER: '' }, stdio: 'ignore' });
  t.after(() => proc.kill());
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) { try { await fetch(`${base}/api/auth/state`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const owner = client(base);
  assert.equal((await owner('/api/auth/setup', { method: 'POST', body: { name: 'Manderson', login: 'manderson', password: 'teste1234' } })).status, 200);
  const s = await owner('/api/security/2fa/setup');
  await owner('/api/security/2fa/enable', { method: 'POST', body: { code: totpCode(s.body.secret) } });
  const marcos = await owner('/api/users', { method: 'POST', body: { name: 'Marcos Miguel', login: 'marcos', password: 'marcos1234', role: 'admin' } });
  await owner('/api/users', { method: 'POST', body: { name: 'Camila', login: 'camila', password: 'camila123', role: 'seller', whatsapp: '+55 45 99999-0001' } });
  const camila = await enter(base, 'camila', 'camila123');
  const marcosC = await enter(base, 'marcos', 'marcos1234');

  // Padrão: todos os administradores veem; vendedor nunca.
  assert.equal((await camila('/api/cash')).status, 403);
  assert.equal((await camila('/api/cash', { method: 'POST', body: { kind: 'saida', amount: 10, description: 'x' } })).status, 403);
  assert.equal((await camila('/api/auth/state')).body.user.cashAccess, false);
  assert.equal((await owner('/api/auth/state')).body.user.cashAccess, true);
  const made = await owner('/api/cash', { method: 'POST', body: { kind: 'saida', amount: 1500, date: '2026-11-03', description: 'Aluguel', category: 'Aluguel e contas do escritório', method: 'Pix' } });
  assert.equal(made.status, 200);
  assert.equal((await marcosC('/api/cash?period=all')).body.entries.length, 1);

  // Só o Marcos: o outro administrador (Manderson) deixa de ver, e o próprio Marcos não consegue se tirar.
  assert.equal((await marcosC('/api/cash/settings', { method: 'PUT', body: { categories: [], allowedUserIds: [] } })).status, 200);
  const only = await marcosC('/api/cash/settings', { method: 'PUT', body: { categories: ['Aluguel', 'Marketing'], allowedUserIds: [marcos.body.id] } });
  assert.equal(only.status, 200);
  assert.equal((await owner('/api/cash')).status, 403, 'administrador fora da lista não vê');
  assert.equal((await owner('/api/auth/state')).body.user.cashAccess, false);
  assert.equal((await owner('/api/cash/settings', { method: 'PUT', body: { categories: [], allowedUserIds: [] } })).status, 403, 'nem libera a si mesmo');
  const list = await marcosC('/api/cash?period=all');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.categories, ['Aluguel', 'Marketing']);
  assert.equal((await marcosC('/api/cash/settings', { method: 'PUT', body: { categories: [], allowedUserIds: [] } })).status, 200);
  const [entry] = (await marcosC('/api/cash?period=all')).body.entries;
  assert.equal((await marcosC(`/api/cash/${entry.id}`, { method: 'DELETE', body: {} })).status, 400, 'apagar exige o motivo');
  assert.equal((await marcosC(`/api/cash/${entry.id}`, { method: 'DELETE', body: { reason: 'teste' } })).status, 200);
  const log = (await marcosC('/api/security/log')).body;
  const types = (Array.isArray(log) ? log : log.events || []).map((e) => e.type);
  for (const k of ['caixa_lancamento', 'caixa_acesso', 'caixa_apagado']) assert.ok(types.includes(k), `registro de acessos tem ${k}`);
});

test('caixa: escopo empresa/pessoal/dízimo separa os totais e a busca ignora acento', async () => {
  const { toCsv } = await import('../src/cash.js');
  const store = tempStore();
  const cash = new Cash({ store, auth: null });
  assert.throws(() => cash.add(admin, { kind: 'saida', amount: 1, description: 'x', scope: 'outro' }), /empresa, pessoal ou dízimo/);
  cash.add(admin, { kind: 'saida', amount: 100, description: 'Combustível do carro', category: 'Combustível', date: '2026-11-03' });
  cash.add(admin, { kind: 'saida', amount: 40, description: 'Farmácia', scope: 'pessoal', date: '2026-11-03' });
  cash.add(admin, { kind: 'saida', amount: 60, description: 'Dízimo', scope: 'Dízimo', date: '2026-11-03' });
  assert.equal(cash.entries({ q: 'combustivel' }).length, 1, 'sem acento acha com acento');
  assert.deepEqual(cash.entries({ scope: 'pessoal' }).map((e) => e.description), ['Farmácia']);
  const s = cash.summary(cash.entries({}));
  assert.deepEqual([s.byScope.empresa.BRL.saidas, s.byScope.pessoal.BRL.saidas, s.byScope.dizimo.BRL.saidas, s.byCurrency.BRL.saidas], [100, 40, 60, 200]);
  assert.match(toCsv(cash.entries({})), /Escopo;Categoria/);
  // Lançamento antigo, sem escopo, conta como empresa.
  store.data.cash.push({ id: 'old', kind: 'saida', amount: 5, currency: 'BRL', date: '2026-11-01', description: 'Antigo', category: 'Outros', status: 'pago', history: [] });
  assert.equal(cash.entries({ scope: 'empresa' }).some((e) => e.id === 'old'), true);
});
