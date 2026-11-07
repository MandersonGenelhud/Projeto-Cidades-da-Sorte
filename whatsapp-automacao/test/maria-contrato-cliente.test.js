import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Maria, quickIntent } from '../src/maria.js';
import { CONTRACT_REQUIRED } from '../src/autocontract.js';
import { tempStore } from './helpers.js';

const LINE = 'l1';
const FRAN = '5545999990005';
const FULL = { nome: 'João Batista Silva', cpf: '529.982.247-25', nacionalidade: 'Brasileiro', estadoCivil: 'Casado', rua: 'Rua das Flores', numero: '10', cidade: 'Foz do Iguaçu', uf: 'PR' }; // sem e-mail

function setup({ cands }) {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const adm = auth.create({ name: 'Marcos Miguel', login: 'marcos', password: 'segredo123', role: 'admin' });
  const fran = auth.create({ name: 'Franciele Souza', login: 'fran', password: 'segredo123', role: 'seller' });
  auth.update(adm.id, { whatsapp: '5545999990001' }); auth.update(fran.id, { whatsapp: FRAN });
  const sent = []; const prepared = []; const quotes = []; const reservas = []; const asked = [];
  const contracts = {
    packages: () => ['Pacote Ouro', 'Pacote Prata'], fields: ['nome', 'cpf', 'nacionalidade', 'estadoCivil', 'rua', 'numero', 'cidade', 'uf', 'email', 'whatsapp'], required: CONTRACT_REQUIRED,
    candidates: (viewer, user, q) => { asked.push({ viewer: viewer.id, ...q }); const ph = String(q.phone || '').replace(/\D/g, ''); return cands.filter((c) => (ph ? c.telefone.endsWith(ph.slice(-8)) : c.nome.toLowerCase().includes(String(q.nome).toLowerCase()))); },
    findQuote: () => null,
    createQuote: ({ pacote, pessoas, nome, telefone }) => { const q = { id: `q${quotes.length + 1}`, number: `ORC-2026-0000${quotes.length + 1}`, client: nome, phone: telefone, items: [{ name: pacote, qty: pessoas }], plan: { total: 12997 * pessoas, entry: 2600, parcels: [1, 2], adults: pessoas, people: pessoas } }; quotes.push(q); return q; },
    clientFor: (q, { nome, dados, formId }) => ({ ...(formId ? FULL : {}), ...dados, nome: dados.nome || (formId ? FULL.nome : nome) }),
    prepare: (q, client) => { prepared.push({ q, client }); return { url: 'https://painel.migra.com/contrato/abc', ct: 'CT-1', buffer: Buffer.from('%PDF'), name: 'c.pdf' }; },
    formLink: () => ({ url: 'https://painel.migra.com/ficha/f1' }),
    reservationLink: (a) => { reservas.push(a); return { url: 'https://painel.migra.com/ficha/res1', leadId: null, formId: 'res1' }; },
    summary: (q) => ({ number: q.number, items: q.items.map((i) => `${i.name} × ${i.qty}`).join(', '), discountPct: 0, subtotal: q.plan.total, total: q.plan.total, entry: q.plan.entry, parcels: 2 }),
    audit() {},
  };
  const maria = new Maria({ store, auth, contracts, sales: { listFor: () => [], canSee: () => true, view: (s) => s, summary: () => ({}) }, customers: { search: () => [] }, cash: {}, now: () => new Date('2026-11-07T15:00:00Z'),
    send: async (j, p) => { sent.push({ j, ...p }); }, lineName: () => 'Maria', marcosPhone: () => '5545999990001', audit: () => {}, log: () => {} });
  maria.config.lineId = LINE;
  const say = async (phone, text) => { sent.length = 0; await maria.handle({ line: LINE, jid: `l:${LINE}:${phone}@s.whatsapp.net`, phone, text }); return sent.filter((m) => m.text).map((m) => m.text).join('\n'); };
  return { say, prepared, quotes, reservas, asked };
}

const hoursAgo = (h) => new Date(new Date('2026-11-07T15:00:00Z').getTime() - h * 3_600_000).toISOString();

test('e-mail NÃO é obrigatório no contrato: com os demais dados, o contrato sai sem pedir e-mail', async () => {
  assert.ok(!CONTRACT_REQUIRED.includes('email'));
  const t = setup({ cands: [{ nome: 'João Batista Silva', telefone: '5545988880001', lastAt: hoursAgo(2), formId: 'f1' }] });
  const r = await t.say(FRAN, 'Maria, gere o contrato do João Batista, 1 pacote ouro');
  assert.match(r, /Contrato CT-1/);
  assert.doesNotMatch(r, /e-?mail/i);
  assert.equal(t.prepared.length, 1);
  assert.equal(t.prepared[0].client.email, undefined);
});

test('um cliente só com esse nome: usa o nome completo e o telefone dele, sem perguntar nada', async () => {
  const t = setup({ cands: [{ nome: 'João Batista Silva', telefone: '5545988880001', lastAt: hoursAgo(200), formId: 'f1' }] });
  const r = await t.say(FRAN, 'Maria, gere o contrato do João Batista, pacote ouro');
  assert.match(r, /Contrato CT-1/);
  assert.equal(t.quotes[0].client, 'João Batista Silva');
  assert.equal(t.quotes[0].phone, '5545988880001');
});

test('dois João Batista atendidos há dias: a Maria pede o TELEFONE e, com ele, gera o do cliente certo', async () => {
  const cands = [
    { nome: 'João Batista Silva', telefone: '5545988880001', lastAt: hoursAgo(100), formId: 'f1' },
    { nome: 'João Batista Prado', telefone: '5545977772222', lastAt: hoursAgo(120), leadId: 'L2' },
  ];
  const t = setup({ cands });
  const ask = await t.say(FRAN, 'Maria, gere o contrato do João Batista, pacote ouro');
  assert.match(ask, /mais de um cliente/);
  assert.match(ask, /final 0001/); assert.match(ask, /final 2222/);
  assert.match(ask, /telefone/);
  assert.equal(t.quotes.length, 0, 'nada foi gerado no palpite');
  const r = await t.say(FRAN, 'Maria, é o 45 98888-0001');
  assert.match(r, /Contrato CT-1/);
  assert.equal(t.quotes[0].phone, '5545988880001');
});

test('dois com o mesmo nome, mas só um atendido nas últimas 48 horas: é o do último atendimento', async () => {
  const cands = [
    { nome: 'João Batista Silva', telefone: '5545988880001', lastAt: hoursAgo(3), formId: 'f1' },
    { nome: 'João Batista Prado', telefone: '5545977772222', lastAt: hoursAgo(300), leadId: 'L2' },
  ];
  const t = setup({ cands });
  const r = await t.say(FRAN, 'Maria, gere o contrato do João Batista, pacote ouro');
  assert.match(r, /Contrato CT-1/);
  assert.equal(t.quotes[0].client, 'João Batista Silva');
  assert.match(r, /João Batista Silva/, 'a resposta mostra de quem é, para ela conferir');
});

test('a vendedora consulta só o que ela enxerga (o viewer dela é ela mesma)', async () => {
  const t = setup({ cands: [] });
  await t.say(FRAN, 'Maria, gere o contrato do João Batista, pacote ouro');
  assert.ok(t.asked.length >= 1);
  assert.notEqual(t.asked[0].viewer, undefined);
});

test('link de preenchimento para RESERVA: volta para quem pediu, não envia nada ao cliente', async () => {
  assert.equal(quickIntent('Maria, me envie o link de preenchimento para registrar uma reserva').acao, 'link_reserva');
  assert.equal(quickIntent('Maria, preciso do link da ficha para a reserva do cliente').acao, 'link_reserva');
  assert.notEqual(quickIntent('Maria, gere o contrato da reserva do João').acao, 'link_reserva');
  const t = setup({ cands: [] });
  const r = await t.say('5545999990001', 'Maria, eu preciso que você me envie o link de preenchimento para registrar uma reserva');
  assert.match(r, /ficha\/res1/);
  assert.match(r, /Não enviei nada ao cliente/);
  assert.match(r, /e-mail é opcional/);
  assert.equal(t.reservas.length, 1);
});
