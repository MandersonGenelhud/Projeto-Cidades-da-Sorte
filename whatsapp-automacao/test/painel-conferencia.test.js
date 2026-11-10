import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Sales } from '../src/sales.js';
import { tempStore } from './helpers.js';

// Os 15 contratos de novembro/2026 do Dashboard Executivo do sistema antigo (conferido com o Manderson em 09/11/2026), sem dados de clientes.
const CONTRATOS = [
  ['2026-000515', 10997, 1800], ['2026-000514', 12997, 0], ['2026-000513', 29991, 2600], ['2026-000512', 33994, 0], ['2026-000511', 20997, 1800],
  ['2026-000510', 12997, 0], ['2026-000508', 29794, 2600], ['2026-000506', 12997, 0], ['2026-000505', 25994, 0], ['2026-000504', 12997, 1800],
  ['2026-000503', 12997, 1800], ['2026-000502', 13557, 1800], ['2026-000501', 25994, 0], ['2026-000499', 12997, 0], ['2026-000498', 39502, 0],
];

function venda(number, total, pago, createdAt, paidAt) {
  const parcels = [];
  if (pago > 0) parcels.push({ label: 'Entrada', value: pago, due: createdAt.slice(0, 10), status: 'pago', paidAt, method: 'Pix', confirmedBy: 'teste' });
  if (total - pago > 0) parcels.push({ label: 'Saldo', value: Math.round((total - pago) * 100) / 100, due: '2027-01-10', status: 'pendente' });
  return { id: number, number, total, parcels, status: 'ativa', createdAt, sellerId: null, sellerName: '', client: { nome: 'x' }, items: [], commission: { pct: 0, value: 0, status: 'paga' }, office: 'py', history: [] };
}

test('painel de vendas fecha com o Dashboard Executivo do sistema antigo (nov/2026: R$ 308.802 vendidos, R$ 42.848,60 recebidos no mês, R$ 294.602 em aberto)', () => {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const admin = auth.get(auth.create({ name: 'Marcos', login: 'marcos', password: 'segredo123', role: 'admin' }).id);
  const sales = new Sales({ store, auth });
  for (const [n, t, p] of CONTRATOS) sales.list.push(venda(n, t, p, '2026-11-05T12:00:00.000Z', '2026-11-05T12:00:00.000Z'));
  // Pagamentos de novembro em contratos mais antigos (entram no "recebido no mês", mas não no saldo dos contratos novos).
  sales.list.push(venda('2026-000400', 40000, 28648.6, '2026-08-01T12:00:00.000Z', '2026-11-03T12:00:00.000Z'));
  const r = sales.summary(admin, { from: '2026-11-01', to: '2026-11-09' });
  assert.equal(r.periodo.contratos, 15);
  assert.equal(r.periodo.faturamento, 308802);
  assert.equal(r.periodo.recebidoDosContratos, 14200);
  assert.equal(r.periodo.emAberto, 294602);
  assert.equal(r.periodo.recebidoNoPeriodo, 42848.6);
  assert.equal(r.sales, 15);
});

test('sistema novo × antigo: separa as vendas copiadas das que nasceram aqui, tem filtro e data de corte', () => {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const admin = auth.get(auth.create({ name: 'Marcos', login: 'marcos', password: 'segredo123', role: 'admin' }).id);
  const sales = new Sales({ store, auth });
  sales.list.push({ ...venda('ANT-1', 10000, 2000, '2026-03-10T12:00:00.000Z', '2026-03-10T12:00:00.000Z'), legacy: true });
  sales.list.push(venda('MH-1', 5000, 1000, '2026-11-05T12:00:00.000Z', '2026-11-05T12:00:00.000Z'));
  assert.equal(sales.cutoff().date, '2026-11-05', 'automático: a primeira venda do sistema novo');
  assert.equal(sales.cutoff().source, 'primeira venda do sistema novo');
  store.updateSettings({ sales: { novoSistemaDesde: '2026-11-01' } });
  assert.deepEqual([sales.cutoff().date, sales.cutoff().source], ['2026-11-01', 'definida']);
  const todo = sales.summary(admin, { from: '2026-01-01', to: '2026-12-31' });
  assert.equal(todo.porOrigem.antigo.vendido, 10000);
  assert.equal(todo.porOrigem.novo.vendido, 5000);
  assert.equal(todo.sold, 15000);
  assert.equal(sales.summary(admin, { from: '2026-01-01', to: '2026-12-31', origem: 'novo' }).sold, 5000);
  assert.deepEqual(sales.listFor(admin, { origem: 'antigo' }).map((v) => [v.number, v.origem]), [['ANT-1', 'antigo']]);
  assert.equal(sales.listFor(admin, {}).length, 2);
});
