import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Crm } from '../src/crm.js';
import { Quotes } from '../src/quotes.js';
import { Maria } from '../src/maria.js';
import { parseItems, parseDiscount } from '../src/maria-items.js';
import { tempStore } from './helpers.js';

const LINE = 'l1';
const VEND = '5545999990004';
const NAMES = ['Pacote Inicial', 'Pacote Prata', 'Pacote Ouro', 'Pacote Estudantil'];

function setup() {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const v = auth.create({ name: 'Ana Vendedora', login: 'ana', password: 'segredo123', role: 'seller' });
  auth.update(v.id, { whatsapp: VEND });
  const crm = new Crm({ store, auth });
  store.updateSettings({ crm: { ...store.settings.crm, packages: [{ name: 'Pacote Inicial', price: 10997 }, { name: 'Pacote Prata', price: 11997 }, { name: 'Pacote Ouro', price: 12997 }, { name: 'Pacote Estudantil', price: 5997 }] } });
  const quotes = new Quotes({ store, dataDir: store.dataDir, secret: 'x', matchPackage: (n) => crm.matchPackage(n) });
  const forms = []; const sent = [];
  const contracts = {
    packages: () => NAMES, fields: ['nome', 'cpf'], required: ['nome', 'cpf'], ready: () => false,
    findQuote: () => null,
    createQuote: ({ pacote, pessoas, adultos, itens, desconto, nome, telefone, user }) => quotes.create({
      items: Array.isArray(itens) && itens.length ? itens : [{ pacote, quantidade: pessoas }], adults: adultos, discountPct: desconto, client: nome, phone: telefone || '',
      consultant: user.name, createdBy: { id: user.id, name: user.name },
    }),
    registerLead: () => ({ lead: { id: 'L', phone: '' }, created: true }),
    clientFor: (_q, { nome, dados }) => ({ nome, ...dados }),
    prepare: () => ({ url: 'u', ct: 'CT-1', buffer: Buffer.from('x'), name: 'c.pdf' }),
    formLink: (q) => { forms.push(q); return { url: 'https://painel.migra.com/ficha/f1', filled: false }; },
    summary: (q) => ({ number: q.number, items: q.items.map((r) => `${r.name}${r.qty > 1 ? ` × ${r.qty}` : ''}`).join(', '), discountPct: q.plan.discountPct || 0, subtotal: q.plan.subtotal, total: q.plan.total, entry: q.plan.entry, parcels: q.plan.parcels?.length || 0 }),
    audit() {},
  };
  const maria = new Maria({
    store, auth, crm, contracts, sales: { listFor: () => [], canSee: () => true, view: (s) => s, summary: () => ({}) }, customers: { search: () => [] }, cash: {},
    send: async (j, p) => { sent.push({ j, ...p }); }, lineName: () => 'Maria', marcosPhone: () => '5545999990001', audit: () => {}, log: () => {},
  });
  maria.config.lineId = LINE;
  const say = async (text) => { sent.length = 0; await maria.handle({ line: LINE, jid: `l:${LINE}:${VEND}@s.whatsapp.net`, phone: VEND, text }); return sent.filter((m) => m.text).map((m) => m.text).join('\n'); };
  return { say, quotes, forms };
}

test('lê vários pacotes, quantidades e desconto do texto', () => {
  const it = parseItems('gere 5 pacotes ouro, um infantil estudantil, um inicial e com desconto de 10%', NAMES);
  assert.deepEqual(it.map((i) => [i.pacote, i.qtd]), [['Pacote Ouro', 5], ['Pacote Estudantil', 1], ['Pacote Inicial', 1]]);
  assert.deepEqual(parseItems('ouro x3, prata x 2', NAMES).map((i) => [i.pacote, i.qtd]), [['Pacote Ouro', 3], ['Pacote Prata', 2]]);
  assert.deepEqual(parseItems('um ouro e um inicial', NAMES).map((i) => [i.pacote, i.qtd]), [['Pacote Ouro', 1], ['Pacote Inicial', 1]]);
  assert.equal(parseDiscount('com 5% de desconto').pct, 5);
  assert.equal(parseDiscount('desconto de 15').pct, 15);
  assert.equal(parseDiscount('sem desconto').pct, null);
  assert.match(parseDiscount('com 20% de desconto').erro, /máximo.*15%.*Marcos/);
  assert.match(parseDiscount('desconto de 7,5%').erro, /inteiro/);
});

test('pedido grande: 5 Ouro + 1 Estudantil + 1 Inicial com 10%: gera UM orçamento com os três pacotes e o desconto', async () => {
  const t = setup();
  const r = await t.say('Maria, gere o contrato do cliente Carlos Lima, 5 pacotes ouro, um infantil estudantil e um inicial, com desconto de 10%');
  assert.equal(t.quotes.list.length, 1);
  const q = t.quotes.list[0];
  assert.deepEqual(q.items.map((i) => [i.name, i.qty]), [['Pacote Ouro', 5], ['Pacote Estudantil', 1], ['Pacote Inicial', 1]]);
  assert.equal(q.plan.discountPct, 10);
  const subtotal = 5 * 12997 + 5997 + 10997;
  assert.equal(q.plan.subtotal, subtotal);
  assert.equal(q.plan.total, Math.round(subtotal * 90) / 100);
  assert.equal(q.plan.people, 7);
  assert.match(r, /5 × Pacote Ouro|Pacote Ouro × 5/);
  assert.match(r, /Pacote Estudantil/); assert.match(r, /Pacote Inicial/);
  assert.match(r, /10% de desconto/);
  assert.match(r, /adultos nas certidões: 7/);
});

test('o orçamento também aceita vários pacotes (Ouro + Inicial, sem desconto)', async () => {
  const t = setup();
  const r = await t.say('Maria, orce um pacote ouro e um pacote inicial para a Ana Souza');
  const q = t.quotes.list[0];
  assert.deepEqual(q.items.map((i) => [i.name, i.qty]), [['Pacote Ouro', 1], ['Pacote Inicial', 1]]);
  assert.equal(q.plan.discountPct || 0, 0);
  assert.match(r, /Orçamento/); assert.match(r, /Pacote Inicial/);
});

test('"são 6 adultos" vira a quantidade de adultos das certidões', async () => {
  const t = setup();
  await t.say('Maria, gere o contrato do cliente Carlos Lima, 5 pacotes ouro e um estudantil, 6 adultos');
  assert.equal(t.quotes.list[0].plan.adults, 6);
  assert.equal(t.quotes.list[0].plan.people, 6);
});

test('desconto acima de 15% é recusado e nada é criado; o vendedor ajusta e segue', async () => {
  const t = setup();
  const r = await t.say('Maria, gere o contrato do cliente Carlos Lima, 2 pacotes ouro com 20% de desconto');
  assert.match(r, /15%/); assert.match(r, /Marcos/);
  assert.equal(t.quotes.list.length, 0, 'nenhum orçamento com desconto indevido');
  const ok = await t.say('Maria, 15% de desconto');
  assert.equal(t.quotes.list.length, 1);
  assert.equal(t.quotes.list[0].plan.discountPct, 15);
  assert.match(ok, /15% de desconto/);
});

test('o caso antigo continua igual: "pacote Ouro para 2 pessoas" = 2 × Ouro', async () => {
  const t = setup();
  await t.say('Maria, gere o contrato da Ana Souza, pacote Ouro para 2 pessoas');
  assert.deepEqual(t.quotes.list[0].items.map((i) => [i.name, i.qty]), [['Pacote Ouro', 2]]);
});


test('enviar o contrato ao cliente com vários pacotes: a confirmação mostra tudo e o envio leva a lista e o desconto', async () => {
  const calls = [];
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const adm = auth.create({ name: 'Marcos Miguel', login: 'marcos', password: 'segredo123', role: 'admin' });
  auth.update(adm.id, { whatsapp: '5545999990001' });
  const sent = [];
  const outbound = { ready: () => true, isBlocked: () => false, hasQuote: () => false, route: () => ({ via: 'o WhatsApp principal da Migra' }), sendContract: async (a) => { calls.push(a); return { kind: 'contrato', via: 'o WhatsApp principal da Migra' }; }, sendForm: async () => ({ kind: 'ficha', via: 'x' }) };
  const maria = new Maria({ store, auth, outbound, contracts: { packages: () => NAMES, fields: [], required: [] }, sales: { listFor: () => [] }, customers: { search: () => [] }, cash: {}, send: async (j, p) => { sent.push(p); }, lineName: () => 'Maria', marcosPhone: () => '5545999990001', audit: () => {}, log: () => {} });
  maria.config.lineId = LINE;
  const say = async (t) => { sent.length = 0; await maria.handle({ line: LINE, jid: `l:${LINE}:5545999990001@s.whatsapp.net`, phone: '5545999990001', text: t }); return sent.map((m) => m.text).join('\n'); };
  const conf = await say('Maria, envie o contrato para o cliente Carlos Lima 45 97777-6666, 5 pacotes ouro e um estudantil com 10% de desconto');
  assert.match(conf, /5 × Pacote Ouro, Pacote Estudantil · desconto de 10%/);
  await say('Maria, sim');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].itens, [{ pacote: 'Pacote Ouro', quantidade: 5 }, { pacote: 'Pacote Estudantil', quantidade: 1 }]);
  assert.equal(calls[0].desconto, 10);
});
