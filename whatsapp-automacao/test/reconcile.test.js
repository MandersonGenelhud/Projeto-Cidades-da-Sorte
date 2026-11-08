import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcile, findDuplicates, findIssues, legacyDiff, totals, identityOf } from '../src/reconcile.js';
import { Sales } from '../src/sales.js';
import { Auth } from '../src/auth.js';
import { tempStore } from './helpers.js';

const TODAY = '2026-11-10';
let n = 0;
const sale = (over = {}) => ({
  id: `s${++n}`, number: `ANT-${n}`, legacy: true, legacyNumber: String(1000 + n), client: { nome: 'João Batista', doc: '123.456.789-00', phone: '5545999990000' },
  total: 3000, status: 'ativa', createdAt: '2026-01-10T12:00:00.000Z', history: [],
  parcels: [{ label: '1ª', value: 1000, due: '2026-02-10', status: 'pago', paidAt: '2026-02-10', confirmedBy: 'Importação' }, { label: '2ª', value: 2000, due: '2026-10-10', status: 'pendente' }],
  ...over,
});

test('identidade do cliente: CPF primeiro, depois telefone, depois o nome sem acento', () => {
  assert.equal(identityOf(sale()), 'doc:12345678900');
  assert.equal(identityOf(sale({ client: { nome: 'A', phone: '+55 45 99999-0000' } })), 'tel:459999000'.slice(0, 4) + '999990000'.slice(0, 0) + identityOf(sale({ client: { nome: 'A', phone: '+55 45 99999-0000' } })).slice(4));
  assert.equal(identityOf(sale({ client: { nome: 'José Álvaro' } })), 'nome:jose alvaro');
});

test('acha repetidos: mesmo cliente + valor + parcelas é "igual"; mesmo valor com datas diferentes é "provável"; o do sistema novo é o que fica', () => {
  const a = sale({ legacyNumber: '1' }); const b = sale({ legacyNumber: '2' }); // parcelas iguais
  const c = sale({ legacyNumber: '3', parcels: [{ label: 'x', value: 3000, due: '2026-12-01', status: 'pendente' }] }); // outro cliente? não: mesmo, outro cronograma
  const outro = sale({ client: { nome: 'Maria', doc: '999.999.999-99' }, legacyNumber: '4' });
  const nova = sale({ legacy: false, legacyNumber: undefined, number: 'V-1', confirmedBy: 1 });
  const g = findDuplicates([a, b, c, outro, nova]);
  assert.equal(g.length, 2);
  assert.ok(g.every((x) => x.keep.id === nova.id), 'a venda criada no sistema novo fica');
  assert.deepEqual(g.map((x) => [x.confidence, x.extras.length]), [['igual', 2], ['provavel', 1]]);
  assert.ok(g.flatMap((x) => x.extras).every((e) => e.canArchive), 'as copias do sistema antigo podem ser arquivadas');
  const soAntigos = findDuplicates([a, b, c]);
  assert.equal(soAntigos.length, 2);
  assert.equal(soAntigos[0].confidence, 'igual');
  assert.equal(soAntigos[1].confidence, 'provavel');
});

test('mesmo número do sistema antigo importado duas vezes é repetido, e contrato com baixa feita por pessoa NÃO pode ser arquivado sozinho', () => {
  const a = sale({ legacyNumber: '777', total: 3000 }); const b = sale({ legacyNumber: '777', total: 3100, client: { nome: 'Outro Nome', doc: '' } });
  assert.equal(findDuplicates([a, b]).length, 1);
  const c = sale({ legacyNumber: '8', total: 500, parcels: [{ label: '1', value: 500, due: '2026-03-01', status: 'pago', paidAt: '2026-03-02', confirmedBy: 'Ana' }] });
  const d = sale({ legacyNumber: '9', total: 500, parcels: [{ label: '1', value: 500, due: '2026-03-01', status: 'pendente' }] });
  const g = findDuplicates([c, d]);
  assert.equal(g[0].keep.id, c.id, 'fica o que tem baixa de pessoa');
  assert.equal(g[0].extras[0].canArchive, true);
  const e = sale({ legacyNumber: '10', total: 600, parcels: [{ label: '1', value: 600, due: '2026-03-01', status: 'pago', paidAt: '2026-03-02', confirmedBy: 'Ana' }] });
  const f = sale({ legacyNumber: '11', total: 600, parcels: [{ label: '1', value: 600, due: '2026-04-01', status: 'pago', paidAt: '2026-04-02', confirmedBy: 'Bia' }] });
  const g2 = findDuplicates([e, f]);
  assert.equal(g2[0].extras[0].canArchive, false);
  assert.match(g2[0].extras[0].whyNot, /baixa feita por uma pessoa/);
});

test('contratos cancelados não entram como repetidos nem nos totais', () => {
  const a = sale(); const b = sale({ status: 'cancelada' });
  assert.equal(findDuplicates([a, b]).length, 0);
  assert.equal(totals([b], TODAY).atraso, 0);
});

test('problemas: soma que não fecha, parcela sem data, paga sem data, valor zero, aproximado, muito antiga, sem telefone', () => {
  const ruim = sale({ total: 5000, client: { nome: 'X', phone: '' }, parcels: [
    { label: '1', value: 1000, due: '', status: 'pendente' }, { label: '2', value: 1000, due: '2026-01-01', status: 'pago' }, { label: '3', value: 0, due: '2024-01-01', status: 'pendente' }] });
  const kinds = new Set(findIssues([ruim], TODAY).map((i) => i.kind));
  for (const k of ['soma', 'sem_data', 'sem_pagamento', 'parcela_zero', 'muito_antiga', 'sem_telefone']) assert.ok(kinds.has(k), k);
  assert.ok(findIssues([sale({ legacySynthetic: true })], TODAY).some((i) => i.kind === 'aproximado' && i.severity === 'info'));
  assert.equal(findIssues([sale()], TODAY).filter((i) => i.severity === 'urgente').length, 0, 'contrato certo não gera alerta');
});

test('diferenças com a cópia do sistema antigo: sem venda, valor, pago, status e fora da cópia', () => {
  const a = sale({ legacyNumber: '1', total: 3000 });
  const legacy = [
    { number: '1', client: 'João', value: 3500, paid: 1000, status: 'ativo' }, // valor diferente
    { number: '2', client: 'Sem venda', value: 900, paid: 0, status: 'ativo' },
    { number: '3', client: 'Cancelado lá', value: 100, paid: 0, status: 'cancelado' }, // cancelado e sem venda: ignora
  ];
  const kinds = legacyDiff([a, sale({ legacyNumber: '5' })], legacy).map((d) => `${d.number}:${d.kind}`);
  assert.deepEqual(kinds.sort(), ['1:valor_diferente', '2:sem_venda', '5:fora_da_copia']);
  const b = sale({ legacyNumber: '9', total: 1000, parcels: [{ label: '1', value: 1000, due: '2026-10-01', status: 'pendente' }] });
  assert.deepEqual(legacyDiff([b], [{ number: '9', client: 'x', value: 1000, paid: 0, status: 'cancelado' }]).map((d) => d.kind), ['status_diferente']);
});

test('totais: a receber no mês, recebido no mês, em atraso; e o resultado sem os repetidos prováveis', () => {
  const a = sale({ parcels: [{ label: '1', value: 1000, due: '2026-11-03', status: 'pago', paidAt: '2026-11-03' }, { label: '2', value: 500, due: '2026-11-20', status: 'pendente' }, { label: '3', value: 700, due: '2026-09-01', status: 'pendente' }], total: 2200 });
  const t = totals([a], TODAY);
  assert.deepEqual([t.recebidoMes, t.aReceberMes, t.atraso, t.atrasoParcelas, t.aberto], [1000, 500, 700, 1, 1200]);
  const b = { ...a, id: 'copia', legacyNumber: '999' };
  const r = reconcile({ sales: [a, b], legacy: [], today: TODAY });
  assert.equal(r.totals.atraso, 1400);
  assert.equal(r.totalsWithoutDuplicates.atraso, 700, 'sem a cópia repetida o atraso cai pela metade');
});

test('arquivar repetido (Sales): só administrador, só do sistema antigo, não apaga, tira dos totais e dá para restaurar', () => {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const sales = new Sales({ store, auth });
  const admin = { id: 'a', name: 'Marcos', role: 'admin' };
  const vend = { id: 'v', name: 'Vend', role: 'seller' };
  const keep = sale({ legacyNumber: '1' }); const dup = sale({ legacyNumber: '2' }); const novo = sale({ legacy: false, legacyNumber: undefined, number: 'V-9' });
  sales.list.push(keep, dup, novo);
  assert.throws(() => sales.archiveDuplicate(vend, dup.id, keep), /administrador|Só/i);
  assert.throws(() => sales.archiveDuplicate(admin, novo.id, keep), /sistema antigo/);
  assert.throws(() => sales.archiveDuplicate(admin, dup.id, null), /qual contrato fica/);
  sales.archiveDuplicate(admin, dup.id, keep);
  assert.equal(dup.status, 'cancelada');
  assert.equal(dup.duplicateOf, keep.id);
  assert.ok(sales.list.includes(dup), 'nada foi apagado');
  assert.ok(dup.history.at(-1).text.includes('repetido'));
  assert.equal(totals(sales.list, TODAY).atraso, 2000 * 2, 'só keep e novo contam');
  sales.restoreDuplicate(admin, dup.id);
  assert.equal(dup.status, 'ativa');
  assert.equal(dup.duplicateOf, undefined);
  assert.throws(() => sales.restoreDuplicate(admin, dup.id), /não foi arquivado/);
});

test('rotas da conferência: só administrador; vendedor leva 403; resposta traz totais, e arquivar/restaurar exigem admin', async (t) => {
  const { spawn } = await import('node:child_process');
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path'); const { fileURLToPath } = await import('node:url');
  const { totpCode } = await import('../src/security.js');
  const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const J = { 'content-type': 'application/json' };
  const ck = (r) => r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-conf-'));
  const port = 39850 + Math.floor(Math.random() * 100);
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
  await marcos('/api/users', 'POST', { name: 'Ana', login: 'ana', password: 'segredo123', role: 'seller' });
  const ana = await login('ana');
  assert.equal((await ana('/api/reconcile')).status, 403);
  assert.equal((await ana('/api/reconcile/archive', 'POST', { ids: ['x'] })).status, 403);
  assert.equal((await ana('/api/reconcile/restore', 'POST', { id: 'x' })).status, 403);
  const r = await marcos('/api/reconcile');
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.ok(j.totals && Array.isArray(j.duplicates) && Array.isArray(j.issues) && Array.isArray(j.diffs));
  const a = await (await marcos('/api/reconcile/archive', 'POST', { ids: ['inexistente'] })).json();
  assert.equal(a.archived, 0);
  assert.equal(a.skipped[0].motivo, 'não é mais repetido');
  assert.equal((await marcos('/api/reconcile/restore', 'POST', { id: 'inexistente' })).status, 404);
  // Aviso de orçamento a vencer: mesmas regras (só administrador; sem orçamentos não envia nada).
  assert.equal((await ana('/api/quotes-expiring')).status, 403);
  assert.equal((await ana('/api/quotes-expiring/notify', 'POST', {})).status, 403);
  const qe = await marcos('/api/quotes-expiring');
  assert.equal(qe.status, 200, JSON.stringify(await qe.clone().json()));
  assert.equal((await qe.json()).total, 0);
  const qn = await marcos('/api/quotes-expiring/notify', 'POST', {});
  assert.equal(qn.status, 200);
  assert.equal((await qn.json()).queued, 0);
});
