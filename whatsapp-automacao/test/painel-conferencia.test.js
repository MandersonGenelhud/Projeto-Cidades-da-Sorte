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
