import test from 'node:test';
import assert from 'node:assert/strict';
import { Customer360 } from '../src/customer360.js';

function make() {
  const sales = [
    { id: 's1', number: 'ANT-1', legacyNumber: '2026-000215', legacy: true, status: 'ativa', total: 20997, createdAt: '2026-03-01T12:00:00Z', sellerName: 'Diego', client: { nome: 'Ana Paula Pamplona Glinski', doc: '055.206.419-43', phone: '' },
      parcels: [{ label: 'Entrada', value: 1800, due: '2026-03-01', status: 'pago', paidAt: '2026-03-02', method: 'Pix' }, { label: 'Parcela 1', value: 3400, due: '2026-10-01', status: 'pendente' }, { label: 'Parcela 2', value: 1000, due: '2026-12-01', status: 'pendente' }] },
    { id: 's2', number: 'V-2', status: 'ativa', total: 500, createdAt: '2026-05-01T12:00:00Z', client: { nome: 'Outra Pessoa', doc: '111.111.111-11', phone: '595981999999' }, parcels: [{ label: 'P', value: 500, due: '2026-06-01', status: 'pendente' }] },
    { id: 's3', number: 'V-3', status: 'cancelada', total: 9999, client: { nome: 'Ana Paula Pamplona Glinski', doc: '055.206.419-43' }, parcels: [{ label: 'P', value: 9999, due: '2026-01-01', status: 'pendente' }] },
  ];
  return new Customer360({
    sales: () => sales, today: () => '2026-11-03',
    quotes: () => [{ number: 'ORC-1', phone: '595981000111', client: 'Ana', plan: { total: 20997 }, validUntil: '2026-03-08', issued: '2026-03-01', createdAt: '2026-03-01T10:00:00Z' }],
    leads: () => [{ id: 'l1', name: 'Ana Paula Pamplona Glinski', phone: '595981000111', stage: 'ganho', code: 'MIG-1', createdAt: '2026-02-20T10:00:00Z', timeline: [{ at: '2026-02-21T10:00:00Z', text: 'Falou no WhatsApp' }] }],
    conversations: () => [{ key: 'k', phone: '595981000111', messages: [{ role: 'user', content: 'oi', at: '2026-02-20T10:00:00Z' }, { role: 'assistant', content: 'olá', at: '2026-02-20T10:01:00Z' }] }],
    documents: () => [{ clientName: 'Ana Paula Pamplona Glinski', type: 'cedula_identidade', number: '9536971', status: 'entregue', issuedAt: '2026-06-01', deliveredAt: '2026-06-10', renewalAt: '2027-02-01', deletedAt: null }],
    legacyClients: () => [{ name: 'ANA PAULA PAMPLONA GLINSKI', doc: '055.206.419-43', phone: '595981000111', email: 'ana@x.com' }],
    legacyContracts: () => [{ number: '2026-000215', client: 'Ana Paula Pamplona Glinski', doc: '055.206.419-43', value: 20997, status: 'Iniciado', files: [1, 2] }],
    collectionsLog: () => [{ ok: true, saleId: 's1', at: '2026-10-20T10:00:00Z' }],
  });
}

test('ficha 360: junta venda, parcelas, orçamento, documento, CRM e conversa da mesma pessoa e ignora os outros', () => {
  const c = make();
  const r = c.build({ doc: '055.206.419-43' });
  assert.equal(r.person.name, 'Ana Paula Pamplona Glinski');
  assert.equal(r.person.phone, '595981000111', 'telefone vem do cadastro antigo');
  assert.equal(r.person.email, 'ana@x.com');
  assert.deepEqual([r.money.sold, r.money.received, r.money.open, r.money.overdue, r.money.overdueParcels], [20997, 1800, 4400, 3400, 1], 'venda cancelada fica fora das contas');
  assert.equal(r.sales.length, 2);
  assert.equal(r.quotes.length, 1); assert.equal(r.documents.length, 1); assert.equal(r.leads.length, 1); assert.equal(r.contracts[0].files, 2);
  assert.equal(r.conversations[0].messages.length, 2);
  assert.ok(!JSON.stringify(r).includes('Outra Pessoa'), 'não mistura com outra pessoa');
  const kinds = new Set(r.timeline.map((e) => e.kind));
  for (const k of ['venda', 'pagamento', 'orçamento', 'documento', 'crm', 'conversa', 'cobrança']) assert.ok(kinds.has(k), k);
  assert.deepEqual(r.timeline.map((e) => e.date), [...r.timeline.map((e) => e.date)].sort().reverse(), 'mais recente primeiro');
});

test('ficha 360: a busca acha por nome, telefone e CPF e junta quem é a mesma pessoa', () => {
  const c = make();
  assert.equal(c.search('x').length, 0);
  const byName = c.search('ana paula');
  assert.equal(byName.length, 1, 'cliente antigo, CRM, venda e documento viram uma pessoa só');
  assert.ok(byName[0].sources.length >= 3);
  assert.match(c.search('05520641943')[0].name, /ana paula/i, 'CPF digitado sem pontos também acha');
  assert.equal(c.search('595981999999')[0].name, 'Outra Pessoa');
  assert.equal(c.search('111.111')[0].name, 'Outra Pessoa');
});

test('duplicados: acha a mesma pessoa repetida por documento, telefone ou nome e só junta clientes antigos com confirmação', async () => {
  const { LegacyContracts } = await import('../src/legacy-import.js');
  const { tempStore } = await import('./helpers.js');
  const store = tempStore();
  const legacy = new LegacyContracts({ store });
  store.data.legacyClients.push(
    { id: 'a', name: 'João da Silva', phone: '595981000222', doc: '123.456.789-00', email: '', extra: {} },
    { id: 'b', name: 'JOAO DA SILVA', phone: '', doc: '12345678900', email: 'joao@x.com', extra: {} },
    { id: 'c', name: 'Maria Souza', phone: '595981333444', doc: '', email: '', extra: {} },
    { id: 'd', name: 'Mariana Souza', phone: '+595 981 333 444', doc: '', email: '', extra: {} },
    { id: 'e', name: 'Pedro', phone: '595981555666', doc: '', email: '', extra: {} },
  );
  const c = new Customer360({ sales: () => [], quotes: () => [], leads: () => [], conversations: () => [], documents: () => [], legacyClients: () => legacy.clients, legacyContracts: () => [] });
  const d = c.duplicates();
  assert.equal(d.length, 2);
  assert.deepEqual(d.map((g) => g.members.map((m) => m.id).sort()).sort(), [['a', 'b'], ['c', 'd']]);
  assert.throws(() => legacy.mergeClients(['a']), /pelo menos dois/);
  assert.deepEqual(legacy.mergeClients(['a', 'b']), { kept: 'a', removed: 1 });
  assert.equal(legacy.clients.find((x) => x.id === 'a').email, 'joao@x.com', 'completa o que faltava');
  assert.equal(legacy.clients.some((x) => x.id === 'b'), false);
  assert.equal(c.duplicates().length, 1);
});

test('ficha 360: cada dado da pessoa e cada item da linha do tempo diz de onde veio', () => {
  const c = make();
  const r = c.build({ doc: '055.206.419-43' });
  assert.match(r.person.sources.doc, /contrato 2026-000215/, 'o documento está no contrato');
  assert.equal(r.person.sources.phone, 'cadastro do sistema antigo', 'telefone veio do cadastro antigo');
  assert.equal(r.person.sources.email, 'cadastro do sistema antigo');
  assert.match(r.person.sources.name, /contrato 2026-000215/);
  assert.ok(r.timeline.every((e) => e.source), 'nenhum item sem origem');
  assert.ok(r.timeline.some((e) => e.kind === 'venda' && e.source === 'Sistema antigo' && e.by === 'Diego'));
  assert.ok(r.timeline.some((e) => e.kind === 'conversa' && e.source === 'WhatsApp'));
  assert.ok(r.timeline.some((e) => e.kind === 'cobrança' && /Cobrança/.test(e.source)));
  // Dado sem origem conhecida fica vazio, não é inventado.
  const s = c.build({ name: 'Outra Pessoa' });
  assert.equal(s.person.email, '');
  assert.equal(s.person.sources.email, '');
});
