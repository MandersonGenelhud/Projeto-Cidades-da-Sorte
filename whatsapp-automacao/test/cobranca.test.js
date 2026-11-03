import test from 'node:test';
import assert from 'node:assert/strict';
import { LegacyContracts, extractRecords, openInstallments, cashRowsFromCapture, isCobrancaTable } from '../src/legacy-import.js';
import { Cash } from '../src/cash.js';
import { Sales } from '../src/sales.js';
import { tempStore } from './helpers.js';

// Tela "Cobrança / Vencimentos" do sistema antigo: uma linha por parcela em aberto.
const COBRANCA = { headers: ['VENCIMENTO', 'CONTRATO', 'CLIENTE', 'PARCELA', 'VALOR', 'STATUS', 'AÇÕES'], rows: [
  ['14/05/2024', '2026-000215', 'Ana Paula Pamplona Glinski 055.206.419-43', '#1 Parcela 1', 'R$ 3.400,00', 'Vencido', 'Baixa'],
  ['14/06/2024', '2026-000215', 'Ana Paula Pamplona Glinski 055.206.419-43', '#2 Parcela 2', 'R$ 5.160,00', 'Vencido', 'Baixa'],
  ['27/03/2026', '2026-000111', 'Carlos —', '#2 Restante da parcela 1', 'R$ 10.100,00', 'Vencido', 'Baixa'],
  ['14/06/2024', '2026-000215', 'Ana Paula Pamplona Glinski 055.206.419-43', '#2 Parcela 2', 'R$ 5.160,00', 'Vencido', 'Baixa'],
] };
const PROCESSOS = { headers: ['N° CONTRATO', 'CLIENTE', 'CPF/DOC', 'VALOR TOTAL', 'PAGO', 'STATUS', 'PRÓXIMO PRAZO'], rows: [
  ['2026-000215', 'Ana Paula Pamplona Glinski', '055.206.419-43', 'R$ 20.997,00', 'R$ 1.000,00', 'Iniciado', '14/05/2024'],
] };

test('cobrança: lê as parcelas em aberto por contrato, sem confundir parcela com valor do contrato', () => {
  assert.equal(isCobrancaTable(COBRANCA), true);
  assert.equal(isCobrancaTable(PROCESSOS), false);
  const cap = { pages: [{ url: 'https://x.com/cobranca', tables: [COBRANCA] }, { url: 'https://x.com/processes', tables: [PROCESSOS] }] };
  const open = openInstallments(cap);
  assert.equal(open.size, 2);
  const a = open.get('2026-000215');
  assert.equal(a.parcels.length, 2, 'linha repetida (da paginação) não duplica');
  assert.deepEqual([a.client, a.doc], ['Ana Paula Pamplona Glinski', '055.206.419-43']);
  assert.deepEqual(a.parcels.map((p) => [p.label, p.due, p.value]), [['Parcela 1', '2024-05-14', 3400], ['Parcela 2', '2024-06-14', 5160]]);
  assert.equal(open.get('2026-000111').client, 'Carlos');
  const recs = extractRecords(cap);
  const r215 = recs.find((r) => r.number === '2026-000215');
  assert.equal(r215.value, 20997, 'o total do contrato vem da lista de Processos, não da parcela');
  assert.equal(r215.openParcels.length, 2);
  const r111 = recs.find((r) => r.number === '2026-000111');
  assert.equal(r111.value, null, 'contrato só visto na Cobrança não inventa total');
});

test('cobrança: "Levar para Vendas" usa as datas reais, o já pago vira parcela paga e a venda antiga é atualizada', () => {
  const store = tempStore();
  const legacy = new LegacyContracts({ store });
  // primeira cópia: só a lista de Processos → parcelas "pago + saldo"
  legacy.import({ pages: [{ url: 'https://x.com/processes', tables: [PROCESSOS] }] }, { name: 'Marcos' });
  const sales = { list: [] }; const crm = { leads: [], create: () => ({ id: 'x' }), byId: () => ({}) };
  assert.equal(legacy.apply({ sales, crm, user: {}, doClients: false }).synthetic, 1);
  assert.deepEqual(sales.list[0].parcels.map((p) => [p.value, p.status, p.due]), [[1000, 'pago', ''], [19997, 'pendente', '2024-05-14']]);
  // segunda cópia, já com a Cobrança → troca pelas parcelas reais
  legacy.import({ pages: [{ url: 'https://x.com/processes', tables: [PROCESSOS] }, { url: 'https://x.com/cobranca', tables: [COBRANCA] }] }, { name: 'Marcos' });
  const out = legacy.apply({ sales, crm, user: {}, doClients: false });
  assert.equal(out.upgraded, 1);
  assert.deepEqual(sales.list[0].parcels.map((p) => [p.value, p.status, p.due]), [[1000, 'pago', ''], [3400, 'pendente', '2024-05-14'], [5160, 'pendente', '2024-06-14']]);
  // a venda só com a Cobrança (sem total) também entra, com as parcelas
  const s111 = sales.list.find((s) => s.legacyNumber === '2026-000111');
  assert.deepEqual(s111.parcels.map((p) => [p.value, p.status]), [[10100, 'pendente']]);
  assert.equal(s111.total, 10100);
  // repetir não duplica nem desfaz baixa dada no sistema novo
  sales.list[0].parcels[1] = { ...sales.list[0].parcels[1], status: 'pago', confirmedBy: 'Marcos', paidAt: '2026-11-03' };
  assert.equal(legacy.apply({ sales, crm, user: {}, doClients: false }).upgraded, 0);
});

test('caixa antigo: importa entradas e saídas sem duplicar e não conta de novo as vendas copiadas', () => {
  const MIGRA = { headers: ['DATA', 'TIPO', 'CATEGORIA', 'DESCRIÇÃO', 'VALOR'], rows: [
    ['02/11/2026', 'Saída', 'Estorno', 'Estorno contrato · parcela 1', '-R$ 1,00'],
    ['02/11/2026', 'Entrada', 'Recebimento', 'Contrato 2026-000461 · parcela 2', '+R$ 5.598,50'],
    ['02/11/2026', 'Entrada', 'Recebimento', 'Contrato 2026-000461 · parcela 2', '+R$ 5.598,50'],
  ] };
  const CONT = { headers: ['DATA', 'TIPO', 'DESCRIÇÃO', 'VALOR'], rows: [['02/11/2026', 'Entrada', 'Contrato 2026-000396 · parcela 3 Recebimento', '+R$ 650,00']] };
  const cap = { pages: [{ url: 'https://x.com/expenses', tables: [MIGRA] }, { url: 'https://x.com/contabilidade', tables: [CONT] }] };
  const rows = cashRowsFromCapture(cap);
  assert.deepEqual(rows.map((r) => [r.kind, r.amount, r.contabil]), [['saida', 1, false], ['entrada', 5598.5, false], ['entrada', 650, true]]);
  const store = tempStore();
  const sales = { list: [{ id: 's1', number: 'ANT-1', legacy: true, status: 'ativa', client: { nome: 'X' }, parcels: [{ label: 'P', value: 500, status: 'pago', paidAt: '2026-01-01', confirmedBy: 'Importação' }] }] };
  const cash = new Cash({ store, auth: { users: [] }, payments: { list: [] }, sales, affiliates: null });
  assert.deepEqual(cash.importLegacy(rows), { found: 3, added: 3 });
  assert.deepEqual(cash.importLegacy(rows), { found: 3, added: 0 });
  assert.equal(cash.entries().filter((e) => e.source === 'sistema').length, 0, 'vendas copiadas não geram entrada automática duplicada');
  assert.equal(cash.entries().length, 3);
});

test('vendedor avisa o pagamento: a parcela NÃO vira recebida; o administrador confirma', () => {
  const store = tempStore();
  const events = [];
  const sales = new Sales({ store, auth: { users: [], get: () => null }, crm: null, notify: (e) => events.push(e) });
  const sale = { id: 'a1', number: 'VEN-1', status: 'ativa', sellerId: 'u1', client: { nome: 'Carla' }, total: 3000, parcels: [{ label: 'Entrada', value: 1000, due: '2026-11-05', status: 'pendente' }], history: [], commission: {} };
  sales.list.push(sale);
  const seller = { id: 'u1', name: 'Diego', role: 'seller' }; const other = { id: 'u2', name: 'Ana', role: 'seller' }; const admin = { id: 'm', name: 'Marcos', role: 'admin' };
  assert.throws(() => sales.claimParcel(other, 'a1', 0, {}), /não encontrada|Só o vendedor/);
  sales.claimParcel(seller, 'a1', 0, { date: '2026-11-03', method: 'Pix' });
  assert.equal(sale.parcels[0].status, 'pendente', 'só o aviso: ainda não é recebido');
  assert.equal(sale.parcels[0].claim.by, 'Diego');
  assert.throws(() => sales.setParcel(seller, 'a1', 0, { paid: true }), /Só o administrador/);
  sales.setParcel(admin, 'a1', 0, { paid: true, date: '2026-11-03' });
  assert.equal(sale.parcels[0].status, 'pago');
  assert.equal(sale.parcels[0].claim, null);
  assert.throws(() => sales.claimParcel(seller, 'a1', 0, {}), /já está recebida/);
});
