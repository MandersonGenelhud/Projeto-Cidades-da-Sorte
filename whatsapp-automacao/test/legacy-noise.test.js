import test from 'node:test';
import assert from 'node:assert/strict';
import { extractRecords, normalizeRecord } from '../src/legacy-import.js';

test('importação: identificadores técnicos das telas (UUID, summary-...) não viram contrato', () => {
  const api = [{ url: '/api/x', json: { data: Array.from({ length: 50 }, (_, i) => ({ id: `9745bb82-c117-44ea-b342-c6b901196d${String(i).padStart(2, '0')}`, type: 'summary-overdue', count: i, flag: true })) } }];
  assert.equal(extractRecords({ api, pages: [] }).length, 0);
  assert.equal(normalizeRecord({ id: 'f98c8ab0-5e26-4254-814d-9d20d333109a', status: 'ok' }), null);
});

test('importação: contrato de verdade continua entrando (número com cliente, valor ou data)', () => {
  const r = normalizeRecord({ Contrato: '2026-000215', Cliente: 'Maria Souza', Valor: 'R$ 3.500,00' });
  assert.equal(r.number, '2026-000215');
  assert.ok(normalizeRecord({ id: '4821', cliente: 'João', valor: 1200 }), 'id numérico curto com cliente vale');
  assert.equal(normalizeRecord({ Contrato: '123' }), null, 'número sozinho, sem nenhum outro dado, não basta');
});
