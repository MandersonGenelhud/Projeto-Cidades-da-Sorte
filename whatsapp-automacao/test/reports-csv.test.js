import test from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, csvCell } from '../src/csv.js';
import { reportCsv, auditCsv } from '../src/reports-csv.js';

const sales = [
  { number: 'VD-1', createdAt: '2026-10-05T10:00:00Z', client: { nome: '=HYPERLINK("http://x")', phone: '5511' }, sellerId: 's1', sellerName: 'Ana', status: 'ativa', items: [{ name: 'Cédula', qty: 2 }], total: 2000, commission: { value: 100, status: 'a_pagar' }, parcels: [{ label: 'Entrada', value: 500, due: '2026-10-05', status: 'pago' }, { label: 'Parcela 1', value: 1500, due: '2026-10-20', status: 'pendente' }], history: [] },
  { number: 'VD-2', createdAt: '2026-11-02T10:00:00Z', client: { nome: 'João' }, sellerId: 's2', sellerName: 'Bia', status: 'cancelada', items: [], total: 900, commission: { value: 0 }, parcels: [{ label: 'Entrada', value: 100, due: '2026-11-02', status: 'pago' }], history: [{ at: '2026-11-04T09:00:00Z', by: 'Marcos', text: 'Venda cancelada: cliente desistiu' }] },
];

test('planilha: ponto e vírgula, acentos (BOM), aspas e proteção contra fórmula', () => {
  assert.equal(csvCell('=1+1'), `"'=1+1"`);
  assert.equal(csvCell('a "b"'), '"a ""b"""');
  assert.ok(toCsv([{ a: 1 }], [{ label: 'Nº', key: 'a' }]).startsWith('﻿"Nº"\r\n"1"'));
});

test('relatório de vendas: período, vendedor, recebido e em aberto; cancelada fica de fora', () => {
  const csv = reportCsv('vendas', sales, { from: '2026-10-01', to: '2026-10-31' });
  const lines = csv.split('\r\n');
  assert.equal(lines.length, 2);
  assert.match(lines[1], /"VD-1";"05\/10\/2026";"'=HYPERLINK/);
  assert.match(lines[1], /"2000,00";"500,00";"1500,00";"100,00";"não";"ativa"/);
  assert.equal(reportCsv('vendas', sales, { seller: 'Bia' }).split('\r\n').length, 1, 'cancelada não entra em vendas');
});

test('parcelas em aberto com dias de atraso e contratos cancelados com o motivo', () => {
  const p = reportCsv('parcelas', sales, { today: '2026-11-04' }).split('\r\n');
  assert.equal(p.length, 2);
  assert.match(p[1], /"20\/10\/2026";"VD-1".*"Parcela 1";"1500,00";"15";"Ana"/);
  const c = reportCsv('cancelados', sales).split('\r\n');
  assert.match(c[1], /"VD-2";"João";"Bia";"900,00";"100,00";"04\/11\/2026";"Marcos";"cliente desistiu"/);
  assert.equal(reportCsv('inexistente', sales), null);
});

test('auditoria em planilha', () => {
  const csv = auditCsv([{ at: '2026-11-04T12:00:00Z', user: 'Marcos', role: 'admin', action: 'alterou', entity: 'serviço', label: 'RG', changes: [{ label: 'Preço', from: '100', to: '120' }], sensitive: true, ip: '1.2.3.4' }]);
  assert.match(csv, /"Marcos";"admin";"alterou";"serviço";"RG";"Preço: 100 -> 120";"sim";"1.2.3.4"/);
});
