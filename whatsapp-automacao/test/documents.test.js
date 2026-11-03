import test from 'node:test';
import assert from 'node:assert/strict';
import { Documents, parseDocumentPages, addMonths } from '../src/documents.js';
import { LegacyContracts, extractRecords } from '../src/legacy-import.js';
import { tempStore } from './helpers.js';

// Texto no formato da tela de Documentos do sistema antigo (cartões com Editar / Avisar no fim de cada um).
const TEXTO = `Documentos Solicitação, chegada Arquivar por imagem Cadastrar documento Todos 142 registros Admissão Temporária 46 registros
Emissão dd/mm/aaaa até dd/mm/aaaa Todos os responsáveis
Keyla Michelle Costa da Silveira Cédula Paraguaia Entregue Com renovação
Cédula Paraguaia · Nº 9536971 · 2026-000134 · Resp.: Adriane
Emissão 22/09/2029 · 1º aviso 22/12/2030 · Renovação 22/05/2031 · Entregue 23/10/2026
Editar Avisar
SONIA RAMOS FLORIANO FERIGOLLI Dependente · contrato de Tadeu Laerte Mattioli Ferigolli Entregue Com renovação Admissão Temporária (Residência Temporária)
Admissão Temporária (Residência Temporária) · Nº 00171902 · 2026-000213 · Resp.: Adriane
Emissão 09/09/2026 · 1º aviso 09/12/2027 · Renovação 09/05/2028 · Entregue 11/03/2026
Editar Avisar
Tadeu Laerte Mattioli Ferigolli Entregue Licença de Condução
Licença de Condução · 2026-000213 · Resp.: Adriane
Emissão 27/10/2026 · Entregue 03/11/2026
Editar Avisar`;

test('documentos: lê os cartões do sistema antigo, sem duplicar, com a regra de 15 e 20 meses', () => {
  const cap = { pages: [{ url: 'https://x.com/documentos', texto: TEXTO }, { url: 'https://x.com/contratos', texto: 'Emissão 01/01/2026' }] };
  const found = parseDocumentPages(cap);
  assert.equal(found.length, 3);
  const [k, s, t] = found;
  assert.deepEqual([k.clientName, k.type, k.number, k.contractNumber, k.responsible, k.status, k.issuedAt, k.deliveredAt], ['Keyla Michelle Costa da Silveira', 'cedula_identidade', '9536971', '2026-000134', 'Adriane', 'entregue', '2029-09-22', '2026-10-23']);
  assert.equal(s.type, 'admissao_temporaria');
  assert.equal(s.dependentOf, 'Tadeu Laerte Mattioli Ferigolli');
  assert.equal(s.clientName, 'SONIA RAMOS FLORIANO FERIGOLLI');
  assert.equal(t.type, 'licenca_conducao');
  const docs = new Documents({ store: tempStore(), today: () => '2026-11-03' });
  assert.deepEqual(docs.importCapture(cap), { found: 3, added: 3 });
  assert.deepEqual(docs.importCapture(cap), { found: 3, added: 0 });
  assert.equal(docs.counts().total, 3);
  assert.equal(docs.counts().byType.cedula_identidade, 1);
});

test('documentos: datas pela regra, renovação, aviso só quando clica e lixeira', () => {
  assert.equal(addMonths('2026-10-09', 15), '2028-01-09');
  assert.equal(addMonths('2026-10-09', 20), '2028-06-09');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  let today = '2026-11-03';
  const docs = new Documents({ store: tempStore(), today: () => today });
  const d = docs.add({ clientName: 'Humberto Rezende dos Passos', type: 'admissao_temporaria', number: '00171933', issuedAt: '2026-10-09', phone: '+595981000111' }, 'Marcos');
  assert.deepEqual([d.noticeAt, d.renewalAt], ['2028-01-09', '2028-06-09']);
  assert.equal(docs.list({ status: 'renovacao' }).length, 0);
  today = '2028-01-10';
  assert.equal(docs.list({ status: 'renovacao' }).length, 1);
  assert.equal(docs.toNotify().length, 1);
  assert.match(docs.noticeText(d), /Olá, Humberto!.*Admissão Temporária.*09\/06\/2028/);
  docs.markNoticed(d.id);
  assert.equal(docs.toNotify().length, 0);
  // data digitada à mão vale mais que a regra
  assert.equal(docs.update(d.id, { renewalAt: '2028-08-01' }).renewalAt, '2028-08-01');
  assert.throws(() => docs.add({ clientName: '', type: 'outros' }), /nome/);
  assert.throws(() => docs.add({ clientName: 'A', type: 'foo' }), /Tipo/);
  assert.throws(() => docs.add({ clientName: 'A', issuedAt: '31/12/2026' }), /Data/);
  assert.equal(docs.update(d.id, { status: 'entregue' }).deliveredAt, '2028-01-10');
  docs.remove(d.id);
  assert.equal(docs.list().length, 0);
  assert.equal(docs.list({ trash: true }).length, 1);
  docs.restore(d.id);
  assert.equal(docs.list().length, 1);
  assert.throws(() => docs.setRules({ cedula_identidade: { notice: 20, renewal: 10 } }), /antes da renovação/);
  assert.deepEqual(docs.setRules({ cedula_identidade: { notice: 12, renewal: 18 } }).cedula_identidade, { notice: 12, renewal: 18 });
});

test('contratos: a lista de Processos (valor total, pago, próximo prazo) vira venda sem inventar data', () => {
  const store = tempStore();
  const legacy = new LegacyContracts({ store });
  const cap = { pages: [{ url: 'https://x.com/processes', tables: [{ headers: ['N° CONTRATO', 'CLIENTE', 'CPF/DOC', 'VALOR TOTAL', 'PAGO', 'STATUS', 'PRÓXIMO PRAZO', 'ATUALIZADO'], rows: [
    ['2026-000461', 'MAURÍCIO SILVA', '625.258.929-53', 'R$ 12.997,00', 'R$ 5.598,50', 'Iniciado', '12/12/2026', '02/11 15:56'],
    ['2026-000375', 'GLAUCO ALEXANDRE DE SOUZA', '015.441.119-16', 'R$ 17.997,00', 'R$ 0,00', 'Iniciado', '02/11/2026', '02/11 15:56'],
    ['2026-000207', 'Rodrigo Ferreira Alves Lameiro', '220.891.278-05', 'R$ 32.450,00', 'R$ 0,00', 'Cancelado', '—', '02/11 23:17'],
  ] }] }] };
  const [a, b] = extractRecords(cap);
  assert.deepEqual([a.number, a.doc, a.value, a.paid, a.nextDue], ['2026-000461', '625.258.929-53', 12997, 5598.5, '2026-12-12']);
  assert.equal(b.paid, 0);
  legacy.import(cap, { name: 'Marcos' });
  const sales = { list: [] };
  const crm = { leads: [], create: () => ({ id: 'x' }), byId: () => ({}) };
  const out = legacy.apply({ sales, crm, user: { name: 'Marcos' }, doClients: false });
  assert.equal(out.sales, 3);
  assert.equal(out.synthetic, 3);
  const s1 = sales.list.find((s) => s.legacyNumber === '2026-000461');
  assert.deepEqual(s1.parcels.map((p) => [p.value, p.status, p.due]), [[5598.5, 'pago', ''], [7398.5, 'pendente', '2026-12-12']]);
  assert.equal(s1.total, 12997);
  const s2 = sales.list.find((s) => s.legacyNumber === '2026-000375');
  assert.deepEqual(s2.parcels.map((p) => [p.value, p.status]), [[17997, 'pendente']]);
  assert.equal(sales.list.find((s) => s.legacyNumber === '2026-000207').status, 'cancelada');
  // repetir não duplica
  assert.equal(legacy.apply({ sales, crm, user: {}, doClients: false }).sales, 0);
});
