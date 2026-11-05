import test from 'node:test';
import assert from 'node:assert/strict';
import { ContractCards } from '../src/contract-cards.js';
import { Alerts } from '../src/alerts.js';
import { Collections } from '../src/collections.js';
import { runTool, TOOL_DEFINITIONS } from '../src/agent/tools.js';
import { tempStore } from './helpers.js';

const TODAY = '2026-11-04';
function make() {
  const sales = [
    { id: 's1', number: 'ANT-1', legacyNumber: '2026-000215', legacy: true, status: 'ativa', total: 20997, createdAt: '2026-03-01T12:00:00Z', sellerName: 'Diego', client: { nome: 'Ana Paula Pamplona', doc: '055.206.419-43', phone: '' }, items: [{ name: 'Pacote Ouro' }], parcels: [
      { label: 'Entrada', value: 1800, due: '2026-03-01', status: 'pago', paidAt: '2026-03-02' }, { label: 'Parcela 1', value: 3400, due: '2026-10-01', status: 'pendente' }, { label: 'Parcela 2', value: 1000, due: '2026-11-06', status: 'pendente' }] },
    { id: 's2', number: 'V-2', status: 'ativa', total: 500, createdAt: '2026-10-20T12:00:00Z', quoteId: 'q2', client: { nome: 'Carlos Souza', phone: '595981222333' }, items: [{ name: 'Inicial' }], parcels: [{ label: 'P', value: 500, due: '2026-12-01', status: 'pago', paidAt: '2026-10-21' }] },
    { id: 's3', number: 'V-3', status: 'cancelada', total: 99, client: { nome: 'Cancelado' }, items: [], parcels: [] },
  ];
  const legacyList = [{ id: 'l1', number: '2026-000215', client: 'Ana Paula Pamplona', value: 20997, paid: 1800 }, { id: 'l2', number: '2026-000300', client: 'Sem Parcela Silva', doc: '999.111.222-33', value: 5000, paid: 0, nextDue: '2026-11-20', status: 'Iniciado' }];
  const quotes = [{ id: 'q2', contract: { status: 'enviado' }, client: 'Carlos Souza', validUntil: '2026-11-04' }];
  const documents = [{ clientName: 'Ana Paula Pamplona', type: 'cedula_identidade', number: '1', renewalAt: '2026-11-20', noticeAt: '2026-11-01', deletedAt: null }];
  const legacyClients = [{ name: 'ANA PAULA PAMPLONA', doc: '055.206.419-43', phone: '595981000111' }];
  const cards = new ContractCards({ sales: () => sales, legacy: () => legacyList, quotes: () => quotes, documents: () => documents, legacyClients: () => legacyClients, today: () => TODAY });
  return { cards, sales, quotes };
}

test('quadros: um por contrato, sem repetir o antigo que já virou venda, com atraso, renovação e assinatura', () => {
  const { cards } = make();
  const all = cards.all();
  assert.equal(all.filter((c) => c.number === '2026-000215').length, 1, 'não repete');
  assert.ok(all.some((c) => c.number === '2026-000300' && c.kind === 'antigo'), 'o antigo sem parcelas também aparece');
  const ana = all.find((c) => c.number === '2026-000215');
  assert.deepEqual([ana.status, ana.paid, ana.open, ana.pct, ana.overdueParcels, ana.overdueValue, ana.overdueDays], ['em_atraso', 1800, 19197, 9, 1, 3400, 34]);
  assert.equal(ana.phone, '595981000111', 'telefone vem do cadastro antigo');
  assert.equal(ana.renewal.state, 'renovar');
  assert.equal(all.find((c) => c.number === 'V-2').signature, 'aguardando');
  assert.equal(all.find((c) => c.number === 'V-2').status, 'quitado');
  assert.equal(all.find((c) => c.number === 'V-3').status, 'cancelado');
});

test('quadros: busca por nome, número, CPF e telefone; filtros e contagens', () => {
  const { cards } = make();
  assert.deepEqual(cards.search({ q: 'ana paula' }).items.map((c) => c.number), ['2026-000215']);
  assert.deepEqual(cards.search({ q: '000300' }).items.map((c) => c.client), ['Sem Parcela Silva']);
  assert.equal(cards.search({ q: '055.206.419' }).total, 1);
  assert.equal(cards.search({ q: '595981222333' }).items[0].client, 'Carlos Souza');
  const r = cards.search({});
  assert.equal(r.counts.em_atraso, 1); assert.equal(r.counts.a_renovar, 1); assert.equal(r.counts.aguardando, 1); assert.equal(r.counts.cancelado, 1);
  assert.deepEqual(cards.search({ filter: 'em_atraso' }).items.map((c) => c.number), ['2026-000215']);
  assert.equal(cards.search({ filter: 'a_renovar' }).total, 1);
  assert.equal(cards.search({ filter: 'antigo' }).total, 2);
  assert.equal(cards.search({ per: 2 }).items.length, 2);
  // vendedor só vê o que pode
  assert.deepEqual(cards.search({ canSee: (c) => c.seller === 'Diego' }).items.map((c) => c.number), ['2026-000215']);
});

test('IA: só enxerga contrato do PRÓPRIO número; outro número ou CPF digitado não revela nada', async () => {
  const { cards } = make();
  assert.equal(cards.forPhone('595981000111').length, 1);
  assert.equal(cards.forPhone('+595 981 000 111').length, 1);
  assert.equal(cards.forPhone('595981999999').length, 0, 'outro número: nada');
  assert.equal(cards.forPhone('').length, 0);
  const txt = cards.summarizeFor('595981000111');
  assert.match(txt, /Contrato 2026-000215/); assert.match(txt, /EM ATRASO: 1 parcela/); assert.match(txt, /documento a renovar até 20\/11\/2026/);
  assert.ok(!/Carlos|222333/.test(txt), 'não mistura outro cliente');
  assert.ok(TOOL_DEFINITIONS.some((t) => t.function.name === 'consultar_meu_contrato'));
  assert.deepEqual(Object.keys(TOOL_DEFINITIONS.find((t) => t.function.name === 'consultar_meu_contrato').function.parameters.properties), [], 'a ferramenta não aceita nome nem CPF');
  assert.match((await runTool('consultar_meu_contrato', {}, {})).erro, /indispon/i);
  let called;
  await runTool('consultar_meu_contrato', { cpf: '1' }, { onMyContracts: async (a) => { called = a; return { ok: true }; } });
  assert.deepEqual(Object.keys(called), ['cpf'], 'o servidor ignora qualquer argumento (usa só o número da conversa)');
});

test('avisos: vencidas, vencem em 3 dias, renovar, assinatura e orçamentos; resumo do dia no WhatsApp', () => {
  const { cards, sales, quotes } = make();
  const store = tempStore();
  const collections = new Collections({ store, sales: { list: sales }, resolvePhone: () => '', send: async () => {}, now: () => new Date(`${TODAY}T10:00:00`) });
  const a = new Alerts({ cards, collections, documents: {}, quotes: () => quotes, today: () => TODAY, now: () => new Date(`${TODAY}T10:00:00`) });
  const items = a.build({ user: { role: 'admin' } });
  const titles = items.map((i) => i.title).join(' | ');
  assert.match(titles, /1 parcela\(s\) vencida\(s\)/);
  assert.match(titles, /1 parcela\(s\) vencem em até 3 dias/);
  assert.match(titles, /1 documento\(s\) para renovar/);
  assert.match(titles, /1 contrato\(s\) aguardando assinatura/);
  assert.equal(items[0].level, 'urgente', 'o mais grave primeiro');
  // Cada aviso leva para a tela onde se resolve, já filtrada, com o texto do botão.
  const by = Object.fromEntries(items.map((i) => [i.id.split(':')[0], i]));
  assert.deepEqual([by.atraso.tab, by.atraso.action], ['collections', 'Ver os atrasados']);
  assert.deepEqual([by.vence3.tab, by.vence3.filter], ['contractcards', 'vencendo']);
  assert.deepEqual([by.assinar.tab, by.assinar.filter], ['contractcards', 'aguardando']);
  assert.equal(by.renovar.tab, 'documents');
  assert.match(a.digestText(items), /Resumo do dia da Migra/);
  assert.equal(a.build({ user: { role: 'seller', id: 'x' } }).length, 0, 'vendedor não recebe os avisos financeiros do administrador');
});

test('quadros: filtro "vencem em 7 dias" pega só a próxima parcela entre hoje e 7 dias, e ordena por vencimento', () => {
  const { cards } = make();
  const r = cards.search({ filter: 'vencendo', sort: 'vencimento' });
  assert.ok(r.total >= 1, 'há parcela vencendo');
  assert.equal(r.counts.vencendo, r.total);
  for (const c of r.items) { assert.ok(c.next.due >= TODAY && c.next.due <= '2026-11-11', c.number); assert.notEqual(c.status, 'cancelado'); }
  assert.ok(!r.items.some((c) => c.number === '2026-000300'), 'quem vence dia 20 fica fora');
});
