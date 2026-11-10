import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Crm } from '../src/crm.js';
import { Sales } from '../src/sales.js';
import { LegacyContracts, extractRecords, parcelsFromTables, extractClients, summarize } from '../src/legacy-import.js';
import { buildExecutive } from '../src/executive.js';
import { tempStore } from './helpers.js';

const CAPTURA = {
  pages: [
    { url: '/contratos', tables: [{ headers: ['Nº', 'Cliente', 'Valor', 'Data', 'Status'], rows: [['500', 'Ana Souza', 'R$ 3.000,00', '10/01/2026', 'Assinado'], ['501', 'Beto Lima', 'R$ 2.000,00', '15/02/2026', 'Aguardando assinatura']] }], fields: [], texto: 'Dashboard' },
    { url: '/contratos/ver/500', title: 'Contrato 500', fields: [{ label: 'Número do contrato', value: '500' }, { label: 'Contratante', value: 'Ana Souza' }, { label: 'CPF', value: '111.222.333-44' }, { label: 'Telefone', value: '+55 11 98765-4321' }, { label: 'Valor', value: 'R$ 3.000,00' }, { label: 'Serviço', value: 'Residência' }],
      tables: [{ headers: ['Parcela', 'Vencimento', 'Valor', 'Situação', 'Pago em'], rows: [['Entrada', '10/01/2026', 'R$ 1.000,00', 'Pago', '10/01/2026'], ['Parcela 1', '10/02/2026', 'R$ 1.000,00', 'Pendente', ''], ['Parcela 2', '10/12/2099', 'R$ 1.000,00', 'Pendente', '']] }] },
    { url: '/clientes', tables: [{ headers: ['Nome', 'WhatsApp', 'E-mail', 'Cidade'], rows: [['Carlos Dias', '+55 21 99999-1111', 'c@x.com', 'Rio'], ['Ana Souza', '+55 11 98765-4321', '', '']] }], fields: [] },
  ],
  api: [],
};

test('parcelas: lê vencimento, valor e situação das tabelas e liga ao contrato certo', () => {
  const p = parcelsFromTables(CAPTURA.pages[1].tables);
  assert.deepEqual(p.map((x) => [x.label, x.due, x.value, x.paid]), [['Entrada', '2026-01-10', 1000, true], ['Parcela 1', '2026-02-10', 1000, false], ['Parcela 2', '2099-12-10', 1000, false]]);
  const recs = extractRecords(CAPTURA);
  const a = recs.find((r) => r.number === '500');
  assert.equal(a.parcels.length, 3);
  assert.equal(a.doc, '111.222.333-44');
  assert.equal(recs.find((r) => r.number === '501').parcels, undefined);
  const s = summarize(recs);
  assert.deepEqual([s.parcelas, s.parcelasAtrasadas, s.valorAtrasado, s.comParcelas], [3, 1, 1000, 1]);
});

test('clientes: da lista de clientes e dos contratos, sem repetir', () => {
  const clients = extractClients(CAPTURA, extractRecords(CAPTURA));
  const names = clients.map((c) => c.name).sort();
  assert.ok(names.includes('Ana Souza') && names.includes('Carlos Dias'));
  assert.equal(names.filter((n) => n === 'Ana Souza').length, 1, 'Ana aparece na lista de clientes e no contrato, mas vale uma vez');
  assert.equal(clients.find((c) => c.name === 'Carlos Dias').extra.Cidade, 'Rio');
});

test('levar para o sistema novo: vendas com parcelas (vencimentos e atrasos no painel) e clientes no CRM, sem duplicar nem gerar comissão', () => {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const admin = auth.get(auth.create({ name: 'Marcos', login: 'marcos', password: 'segredo123', role: 'admin' }).id);
  const crm = new Crm({ store, auth });
  const sales = new Sales({ store, auth });
  const lc = new LegacyContracts({ store });
  const imp = lc.import(CAPTURA, admin);
  assert.equal(imp.added, 2);
  assert.equal(imp.newClients, 3, 'Ana, Beto e Carlos');
  const r = lc.apply({ sales, crm, user: admin });
  assert.deepEqual([r.sales, r.noParcels, r.clients], [1, 1, 3]);
  const sale = sales.list.find((s) => s.legacyNumber === '500');
  assert.equal(sale.number, 'ANT-500');
  assert.equal(sale.commission.status, 'paga', 'sem comissão pelo sistema novo');
  assert.equal(sale.parcels.filter((p) => p.status === 'pago').length, 1);
  assert.equal(sales.view(sale).overdue, 1000, 'a parcela de 10/02/2026 está atrasada');
  // clientes: quem tem contrato entra como fechado; os outros como novos; telefone normalizado
  const ana = crm.leads.find((l) => l.name === 'Ana Souza');
  assert.equal(ana.stage, 'ganho');
  assert.equal(ana.phone, '5511987654321');
  assert.equal(crm.leads.find((l) => l.name === 'Carlos Dias').stage, 'novo');
  assert.equal(ana.createdAt.slice(0, 10), '2026-01-10');
  // repetir não duplica
  const again = lc.apply({ sales, crm, user: admin });
  assert.deepEqual([again.sales, again.salesSkipped, again.clients], [0, 1, 0]);
  // o painel executivo enxerga os vencimentos e atrasos importados
  const ex = buildExecutive({ sales: sales.list, now: Date.parse('2026-03-01T15:00:00Z') });
  assert.equal(ex.kpis.atrasadoTotal, 1000);
  assert.equal(ex.kpis.contratosAtivos, 1);
});

import { auditCapture } from '../src/legacy-import.js';
test('auditoria da cópia: compara o que o sistema antigo diz ter com o que foi copiado, e lista páginas que não abriram', () => {
  const cap = {
    falhas: [{ url: 'https://x.com/processes', motivo: 'ERR_INSUFFICIENT_RESOURCES' }],
    pages: [
      { url: 'https://x.com/clients', texto: 'Clientes\nMostrando 1 a 10 de 371 clientes', tables: [{ headers: ['Nome', 'Telefone'], rows: [['A', '1'], ['B', '2'], ['C', '3']] }], arquivos: [{ name: '0001.pdf', kind: 'pdf' }] },
      { url: 'https://x.com/contracts', texto: '2 contratos no período', tables: [{ headers: ['Nº'], rows: [['1'], ['2']] }] },
    ],
    api: [{}],
  };
  const a = auditCapture(cap, { contracts: [{ number: '1', client: 'A', parcels: [{}] }, { number: '2', client: '' }], clients: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] });
  const by = Object.fromEntries(a.items.map((i) => [i.entity, i]));
  assert.deepEqual([by.clientes.esperado, by.clientes.copiado, by.clientes.status, by.clientes.faltam], [371, 3, 'faltam', 368]);
  assert.equal(by.contratos.status, 'ok');
  assert.deepEqual([a.paginas, a.arquivos, a.falhas.length, a.contratosSemParcelas, a.contratosSemCliente, a.ok], [2, 1, 1, 1, 1, false]);
});

test('nova cópia do mesmo contrato: o pago e o saldo acompanham o sistema antigo; baixa feita à mão aqui não é sobrescrita', () => {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const admin = auth.get(auth.create({ name: 'Marcos', login: 'marcos', password: 'segredo123', role: 'admin' }).id);
  const crm = new Crm({ store, auth });
  const sales = new Sales({ store, auth });
  const lc = new LegacyContracts({ store });
  lc.import(CAPTURA, admin); lc.apply({ sales, crm, user: admin });
  const sale = sales.list.find((s) => s.legacyNumber === '500');
  assert.equal(sale.parcels.filter((p) => p.status === 'pago').length, 1);
  // o cliente pagou a parcela 1 depois da primeira cópia: a cópia nova traz "Pago"
  const nova = JSON.parse(JSON.stringify(CAPTURA));
  nova.pages[1].tables[0].rows[1] = ['Parcela 1', '10/02/2026', 'R$ 1.000,00', 'Pago', '12/02/2026'];
  lc.import(nova, admin);
  const r = lc.apply({ sales, crm, user: admin });
  assert.equal(r.refreshed, 1);
  assert.equal(sales.list.find((s) => s.legacyNumber === '500').parcels.filter((p) => p.status === 'pago').length, 2);
  assert.equal(sales.list.filter((s) => s.legacyNumber === '500').length, 1, 'sem duplicar');
  // repetir a mesma cópia não muda nada
  assert.equal(lc.apply({ sales, crm, user: admin }).refreshed, 0);
  // alguém deu baixa na parcela 2 aqui no sistema novo: a cópia seguinte não mexe mais na venda
  sales.list.find((s) => s.legacyNumber === '500').parcels[2].confirmedBy = 'Maria';
  sales.list.find((s) => s.legacyNumber === '500').parcels[2].status = 'pago';
  const nova2 = JSON.parse(JSON.stringify(nova)); nova2.pages[1].tables[0].rows[0] = ['Entrada', '10/01/2026', 'R$ 1.000,00', 'Pendente', ''];
  lc.import(nova2, admin);
  assert.equal(lc.apply({ sales, crm, user: admin }).refreshed, 0);
});
