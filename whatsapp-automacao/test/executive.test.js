import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExecutive, periods, dayStr } from '../src/executive.js';

const NOW = Date.parse('2026-11-04T15:00:00Z'); // quarta-feira
const sale = (n, seller, created, parcels, extra = {}) => ({ id: n, number: n, status: 'ativa', client: { nome: `Cliente ${n}`, phone: '5959' }, sellerName: seller, total: parcels.reduce((a, p) => a + p.value, 0), createdAt: created, commission: { status: 'a_pagar', value: 100 }, parcels, ...extra });
const SALES = [
  sale('VD-1', 'Fran', '2026-11-02T10:00:00Z', [
    { label: 'Entrada', value: 1000, due: '2026-11-02', status: 'pago', paidAt: '2026-11-02' },
    { label: 'Parcela 1', value: 500, due: '2026-11-04', status: 'pendente' },
    { label: 'Parcela 2', value: 500, due: '2026-11-20', status: 'pendente' },
    { label: 'Parcela 3', value: 500, due: '2026-12-20', status: 'pendente' },
  ]),
  sale('VD-2', 'Eliezer', '2026-09-10T10:00:00Z', [
    { label: 'Entrada', value: 800, due: '2026-09-10', status: 'pago', paidAt: '2026-09-10' },
    { label: 'Parcela 1', value: 400, due: '2026-10-10', status: 'pendente' },
    { label: 'Parcela 2', value: 400, due: '2026-11-03', status: 'pendente' },
  ]),
  sale('VD-3', 'Fran', '2026-11-01T10:00:00Z', [{ label: 'Entrada', value: 9999, due: '2026-11-01', status: 'pendente' }], { status: 'cancelada' }),
];

test('períodos: semana começa na segunda e mês/ano cobrem o calendário', () => {
  const p = periods('2026-11-04');
  assert.deepEqual([p.semana.from, p.semana.to], ['2026-11-02', '2026-11-08']);
  assert.deepEqual([p.mes.from, p.mes.to], ['2026-11-01', '2026-11-30']);
  assert.deepEqual([p.ano.from, p.ano.to], ['2026-01-01', '2026-12-31']);
  assert.equal(dayStr(NOW), '2026-11-04');
});

test('cobranças e vencimentos por período, atrasos e semanas a receber', () => {
  const e = buildExecutive({ sales: SALES, now: NOW });
  // hoje: vence a parcela 1 da VD-1 (500)
  assert.deepEqual([e.cobrancas.hoje.vence, e.cobrancas.hoje.aReceber, e.cobrancas.hoje.atrasado], [500, 500, 0]);
  // semana (2 a 8/11): entrada paga 1000 + parcela hoje 500 + parcela atrasada de 3/11 (400)
  assert.equal(e.cobrancas.semana.vence, 1900);
  assert.equal(e.cobrancas.semana.recebido, 1000);
  assert.equal(e.cobrancas.semana.atrasado, 400);
  // mês: tudo de novembro menos a venda cancelada
  assert.equal(e.cobrancas.mes.vence, 1000 + 500 + 500 + 400);
  assert.equal(e.cobrancas.mes.entrou, 1000);
  assert.equal(e.kpis.atrasadoTotal, 800, '400 de 10/10 + 400 de 3/11');
  assert.equal(e.kpis.atrasadasQtd, 2);
  assert.equal(e.atrasadas[0].daysLate, 25);
  assert.deepEqual(e.faixas.map((f) => f.quantidade), [1, 1, 0, 0]);
  assert.equal(e.kpis.aReceberTotal, 500 + 500 + 500 + 800);
  assert.equal(e.kpis.contratosAtivos, 2);
  assert.equal(e.semanas.length, 8);
  assert.equal(e.semanas[0].valor, 500, 'esta semana ainda a receber (a de hoje)');
  assert.equal(e.months.length, 12);
  assert.equal(e.months.at(-1).key, '2026-11');
  assert.equal(e.months.at(-1).recebido, 1000);
  assert.equal(e.months.at(-1).vendas, 1);
  assert.equal(e.months.find((m) => m.key === '2026-09').recebido, 800);
  assert.equal(e.vendedores[0].name, 'Fran');
});
