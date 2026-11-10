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

import { extractClients, openInstallments, auditCapture } from '../src/legacy-import.js';
import { varrerPaginas } from '../tools/capturar-sistema/capturar.mjs';

const capApi = {
  pages: [],
  api: [
    { url: 'https://velho.com/api/contracts', json: { count: 2, data: [
      { id: 'a1b2c3d4-0000-4000-8000-000000000001', contract_number: '2026-000215', status: 'signed', final_value: 8000, installments: 4, created_at: '2026-06-01T10:00:00Z', customer: { full_name: 'Maria Souza', cpf: '111.222.333-44', phone: '+5511999990000', email: 'm@x.com' }, service: { name: 'Pacote Inicial' }, seller: { full_name: 'Ana' } },
      { id: 'a1b2c3d4-0000-4000-8000-000000000002', contract_number: '2026-000216', status: 'draft', total_value: 500, customer: { full_name: 'João Lima' }, service: { name: 'Cédula' } },
    ] } },
    { url: 'https://velho.com/api/processes', json: { data: [{ id: 'p1', contract_number: '2026-000215', customer_name: 'Maria Souza', total_value: 8000, paid_amount: 3000, next_deadline: '2026-12-10', board_status_name: 'Em análise' }] } },
    { url: 'https://velho.com/api/financial/collections?filter=all', json: { rows: [
      { id: 'c1', contract_number: '2026-000215', customer_name: 'Maria Souza', cpf: '111.222.333-44', installment_number: 2, label: 'Parcela 2', due_date: '2026-09-10', amount: 1000, status: 'overdue' },
      { id: 'c2', contract_number: '2026-000215', customer_name: 'Maria Souza', cpf: '111.222.333-44', installment_number: 3, label: 'Parcela 3', due_date: '2027-01-10', amount: 1000, status: 'pending' },
    ] } },
    { url: 'https://velho.com/api/customers?pageSize=500', json: { count: 2, data: [{ id: 'u1', full_name: 'Maria Souza', cpf: '111.222.333-44', phone: '+5511999990000', email: 'm@x.com' }, { id: 'u2', full_name: 'Pedro Alves', phone: '5511988887777' }] } },
    { url: 'https://velho.com/api/proposals', json: { count: 5, data: [{ id: 'q1' }, { id: 'q2' }] } },
  ],
};

test('importação do sistema antigo: lê contratos, andamento, clientes e parcelas em aberto direto das listas', () => {
  const recs = extractRecords(capApi);
  const r = recs.find((x) => x.number === '2026-000215');
  assert.equal(r.client, 'Maria Souza');
  assert.equal(r.value, 8000);
  assert.equal(r.paid, 3000, 'o andamento (pago) entra no mesmo contrato');
  assert.equal(r.service, 'Pacote Inicial');
  assert.equal(r.status, 'assinado');
  const open = openInstallments(capApi).get('2026-000215');
  assert.equal(open.parcels.length, 2);
  assert.equal(open.parcels[0].due, '2026-09-10');
  const cl = extractClients(capApi, recs);
  assert.ok(cl.find((c) => c.name === 'Pedro Alves'), 'cliente sem contrato também entra');
  assert.equal(cl.filter((c) => c.name === 'Maria Souza').length, 1, 'sem duplicar');
});

test('auditoria: usa o total de cada lista (count) e acusa o que a captura não trouxe', () => {
  const a = auditCapture(capApi, { contracts: extractRecords(capApi), clients: extractClients(capApi) });
  const orc = a.items.find((i) => i.entity === 'orcamentos');
  assert.equal(orc.esperado, 5); assert.equal(orc.copiado, 2); assert.equal(orc.status, 'faltam'); assert.equal(orc.faltam, 3);
  assert.equal(a.items.find((i) => i.entity === 'clientes').status, 'ok');
});

test('captura: busca as páginas seguintes de listas "200 de N" e para quando a lista ignora a página', async () => {
  const mk = (from, n) => Array.from({ length: n }, (_, i) => ({ id: `id${from + i}` }));
  const api = [{ url: 'https://velho.com/api/proposals', json: { count: 5, data: mk(0, 2) } }];
  const pedidos = [];
  const get = async (u) => { pedidos.push(u); const p = Number(new URL(u).searchParams.get('page')); return { count: 5, data: p === 2 ? mk(2, 2) : p === 3 ? mk(4, 1) : [] }; };
  assert.equal(await varrerPaginas(get, api), 2);
  assert.equal(api.length, 3);
  assert.equal(pedidos.length, 2, 'parou ao completar o total');
  // Lista que devolve sempre a mesma página: não entra em laço.
  const api2 = [{ url: 'https://velho.com/api/x', json: { count: 100, data: mk(0, 2) } }];
  assert.equal(await varrerPaginas(async () => ({ count: 100, data: mk(0, 2) }), api2), 0);
  // Endereço de um item (com UUID) não é lista.
  const api3 = [{ url: 'https://velho.com/api/contracts/9216d553-058a-4f1e-929e-8e74308026f6', json: { count: 9, data: mk(0, 1) } }];
  assert.equal(await varrerPaginas(async () => ({ data: mk(5, 1) }), api3), 0);
});

import { LegacyContracts, isNoiseApi } from '../src/legacy-import.js';
import { tempStore } from './helpers.js';

test('leads, clientes e suporte do sistema antigo não viram contratos (5.884 leads inflaram a cópia para 9.585 "contratos")', () => {
  const leads = Array.from({ length: 300 }, (_, i) => ({ id: 1000 + i, name: `Lead ${i}`, phone: '5511999990000', origin: 'quiz', value: 100, created_at: '2026-08-12T10:00:00Z' }));
  const cap = { pages: [], api: [
    { url: 'https://velho.com/api/leads?page=1', json: { count: 300, data: leads } },
    { url: 'https://velho.com/api/customers?page=1', json: { count: 1, data: [{ id: 77, full_name: 'Maria', cpf: '111.222.333-44', phone: '5511999990000' }] } },
    { url: 'https://velho.com/api/contracts', json: { count: 1, data: [{ id: 'a1b2c3d4-0000-4000-8000-000000000001', contract_number: '2026-000215', status: 'signed', final_value: 8000, created_at: '2026-06-01T10:00:00Z', customer: { full_name: 'Maria Souza' } }] } },
  ] };
  const recs = extractRecords(cap);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].number, '2026-000215');
  assert.equal(isNoiseApi('https://x.com/api/leads?page=2'), true);
  assert.equal(isNoiseApi('https://x.com/api/contracts'), false);
});

test('limpeza dos falsos contratos já importados: tira só os que vieram de listas que não são contratos', () => {
  const store = tempStore();
  const lc = new LegacyContracts({ store });
  lc.list.push({ id: 'a', number: '1001', client: 'Lead 1', source: 'https://x.com/api/leads?page=1', raw: {} }, { id: 'b', number: '2026-000215', client: 'Maria', source: 'sistema antigo (lista)', raw: {} });
  const r = lc.purgeNoise();
  assert.deepEqual([r.before, r.removed, r.after], [2, 1, 1]);
  assert.equal(lc.list[0].number, '2026-000215');
});
