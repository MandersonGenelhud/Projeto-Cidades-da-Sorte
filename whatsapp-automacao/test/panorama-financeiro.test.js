import { test } from 'node:test';
import assert from 'node:assert/strict';
import { financialPanorama } from '../src/reconcile.js';

const P = (value, due, paid = false) => ({ value, due, status: paid ? 'pago' : 'aberta', ...(paid ? { paidAt: due } : {}) });
const TODAY = '2026-11-13';
const sales = [
  // veio do sistema antigo: última parcela já passou e falta receber (vencido com saldo)
  { id: 'a', legacy: true, legacyNumber: '100', status: 'ativa', total: 3000, client: { nome: 'Ana' }, parcels: [P(1000, '2026-08-01', true), P(1000, '2026-09-01'), P(1000, '2026-10-01')], commission: { status: 'paga', value: 150 } },
  // veio do sistema antigo e está quitado
  { id: 'b', legacy: true, legacyNumber: '101', status: 'ativa', total: 2000, client: { nome: 'Bruno' }, parcels: [P(2000, '2026-05-01', true)], commission: { status: 'paga', value: 100 } },
  // nasceu no Hub: vencendo (última parcela em 20 dias) e comissão a pagar
  { id: 'c', status: 'ativa', total: 5000, client: { nome: 'Carla' }, parcels: [P(2500, '2026-11-20'), P(2500, '2026-12-03')], commission: { status: 'a_pagar', value: 250 } },
  // cancelado
  { id: 'd', status: 'cancelada', total: 9000, client: { nome: 'Davi' }, parcels: [P(9000, '2026-12-01')] },
];
const legacy = [
  { number: '100', value: 3000, paid: 1000, status: 'ativo' },
  { number: '101', value: 2000, paid: 2000, status: 'quitado' },
  { number: '102', value: 800, paid: 0, status: 'cancelado' },
];

test('panorama: vencidos, vencendo, parcelas, a receber, recebido e comissões, por origem', () => {
  const p = financialPanorama({ sales, legacy, today: TODAY });
  const t = p.hub.todos;
  assert.equal(t.contratos, 4);
  assert.equal(t.cancelados, 1);
  assert.equal(t.ativos, 2);
  assert.equal(t.quitados, 1);
  assert.equal(t.vencidosComSaldo, 1);
  assert.equal(t.vencendo30, 1);
  assert.equal(t.parcelasVencidas, 2);
  assert.equal(t.valorVencido, 2000);
  assert.equal(t.parcelasAVencer30, 2, 'as duas da Carla vencem até 13/12');
  assert.equal(t.aReceber, 7000);
  assert.equal(t.recebido, 3000);
  assert.equal(t.comissoesAPagar, 250);
  assert.equal(p.hub.antigo.contratos, 2);
  assert.equal(p.hub.novo.aReceber, 5000);
  assert.deepEqual(p.listas.vencidosComSaldo.map((x) => x.number), ['100']);
  assert.deepEqual(p.listas.vencendo30.map((x) => x.client), ['Carla']);
});

test('bate com o sistema antigo: compara só o que veio de lá com a cópia (sem cancelados)', () => {
  const p = financialPanorama({ sales, legacy, today: TODAY });
  const by = Object.fromEntries(p.comparacao.map((c) => [c.item, c]));
  assert.equal(by['Contratos (sem cancelados)'].antigo, 2);
  assert.equal(by['Contratos (sem cancelados)'].bate, true);
  assert.equal(by['Valor dos contratos'].bate, true);
  assert.equal(by['Pago / recebido'].bate, true);
  assert.equal(by['Saldo a receber'].bate, true);
  // Uma baixa a mais no Hub: o pago deixa de bater e mostra a diferença.
  const s2 = structuredClone(sales); s2[0].parcels[1].status = 'pago';
  const p2 = financialPanorama({ sales: s2, legacy, today: TODAY });
  const pago = p2.comparacao.find((c) => c.item === 'Pago / recebido');
  assert.equal(pago.bate, false);
  assert.equal(pago.diferenca, 1000);
  assert.equal(financialPanorama({ sales, legacy: [], today: TODAY }).temCopia, false);
});
