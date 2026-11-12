import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Crm } from '../src/crm.js';
import { BulkHandoff, BULK_MESSAGE, segmentOf } from '../src/bulk-handoff.js';
import { centralNote } from '../src/agent/central.js';
import { tempStore } from './helpers.js';

function setup(over = {}) {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const crm = new Crm({ store, auth });
  const convs = [];
  const mk = (n, content, extra = {}) => {
    const key = `5545988${n}@s.whatsapp.net`;
    const conv = { key, phone: `5545988${n}`, name: `Cliente ${n}`, messages: [{ role: 'user', content, at: '2026-11-11T10:00:00Z' }, { role: 'assistant', content: 'oi', at: '2026-11-11T10:01:00Z' }], updatedAt: '2026-11-11T10:01:00Z', ...extra };
    convs.push(conv);
    const lead = crm.ensureFromConversation({ key, phone: conv.phone, name: conv.name, channel: 'whatsapp' });
    return { conv, lead };
  };
  const sent = []; const forwarded = []; const remembered = [];
  const bulk = new BulkHandoff({
    store, crm, conversations: () => convs,
    isClient: (l) => l.name === 'Cliente Antigo', humanSpoke: (c) => Boolean(c.humanSpokeAt), isTeamPhone: (p) => p === '5545988999',
    canSend: () => true, send: async (k, t) => sent.push({ k, t }), forward: async (a) => forwarded.push(a), remember: (c, r, t) => remembered.push(t),
    now: () => new Date('2026-11-12T12:00:00Z'), sleep: async () => {}, delay: () => 0, ...over,
  });
  return { bulk, mk, sent, forwarded, store, crm, convs, remembered };
}
const done = async (bulk) => { for (let i = 0; i < 50 && bulk.running; i++) await new Promise((r) => setTimeout(r, 5)); };

test('segmento: imóvel, veículo ou documentação (padrão), só pelo que a pessoa disse', () => {
  assert.equal(segmentOf({}, { messages: [{ role: 'user', content: 'quero comprar um terreno' }] }), 'loteamentos');
  assert.equal(segmentOf({}, { messages: [{ role: 'user', content: 'quero importar um carro' }] }), 'veiculos');
  assert.equal(segmentOf({}, { messages: [{ role: 'user', content: 'quero a residência no Paraguai' }] }), 'documentacao');
  assert.equal(segmentOf({}, { messages: [{ role: 'assistant', content: 'temos terreno e carro' }, { role: 'user', content: 'preciso de documentos' }] }), 'documentacao', 'o que a IA disse não conta');
});

test('prévia: só entra quem a IA está atendendo; fora pessoa que falou, recusa, cliente, equipe, grupo, Instagram e já encaminhado', () => {
  const { bulk, mk, convs } = setup();
  mk('0001', 'quero residência');
  mk('0002', 'quero um lote');
  mk('0003', 'quero um carro');
  mk('0004', 'oi', { humanSpokeAt: '2026-11-11T11:00:00Z' });
  mk('0005', 'oi', { declined: { kind: 'sem_interesse' } });
  mk('0006', 'oi', { handoff: true });
  const antigo = mk('0007', 'oi'); antigo.lead.name = 'Cliente Antigo';
  mk('999', 'oi'); // número da equipe (5545988999)
  convs.push({ key: 'ig:abc', messages: [{ role: 'user', content: 'oi' }], updatedAt: '2026-11-11T10:00:00Z' });
  convs.push({ key: '1203@g.us', messages: [{ role: 'user', content: 'oi' }], updatedAt: '2026-11-11T10:00:00Z' });
  const jaEnc = mk('0008', 'oi'); jaEnc.lead.handoff = { at: '2026-11-10T10:00:00Z' };
  const velha = mk('0009', 'oi', { updatedAt: '2026-08-01T10:00:00Z' });
  void velha;
  const p = bulk.preview();
  assert.equal(p.total, 3);
  assert.deepEqual(p.porSegmento, { documentacao: 1, loteamentos: 1, veiculos: 1 });
});

test('início: cada pessoa recebe a mensagem e o vendedor do segmento é acionado; marca como feito e não repete', async () => {
  const { bulk, mk, sent, forwarded, remembered, store } = setup();
  mk('0001', 'quero residência'); mk('0002', 'quero um lote');
  assert.deepEqual(bulk.start(), { total: 2 });
  await done(bulk);
  assert.equal(sent.length, 2);
  assert.ok(sent.every((s) => s.t === BULK_MESSAGE));
  assert.match(BULK_MESSAGE, /encaminhar para um de nossos vendedores para dar continuidade ao seu atendimento/);
  assert.deepEqual(forwarded.map((f) => f.segment).sort(), ['documentacao', 'loteamentos']);
  assert.equal(remembered.length, 2, 'a IA lembra que avisou o cliente');
  assert.equal(store.data.bulkHandoff.last.enviados, 2);
  assert.equal(bulk.preview().total, 0, 'quem já foi não entra de novo');
  assert.deepEqual(bulk.start(), { total: 0 });
});

test('se uma pessoa falou com o cliente enquanto a fila andava, ele é pulado (nada é enviado)', async () => {
  const { bulk, mk, sent, convs } = setup({ delay: () => 0 });
  const a = mk('0001', 'quero residência'); mk('0002', 'quero residência');
  const orig = bulk.send;
  bulk.send = async (k, t) => { await orig(k, t); convs[1].humanSpokeAt = '2026-11-12T12:00:00Z'; }; // depois do 1º envio, uma pessoa assume o 2º
  bulk.start();
  await done(bulk);
  assert.equal(sent.length, 1);
  assert.equal(bulk.state.last.pulados, 1);
  void a;
});

test('falha em um envio não derruba o lote; "parar" interrompe', async () => {
  const f = setup();
  f.mk('0001', 'quero residência'); f.mk('0002', 'quero residência'); f.mk('0003', 'quero residência');
  let n = 0;
  f.bulk.send = async () => { n += 1; if (n === 1) throw new Error('sem conexão'); };
  f.bulk.start();
  await done(f.bulk);
  assert.equal(f.bulk.state.last.falhas, 1); assert.equal(f.bulk.state.last.enviados, 2);
  const g = setup();
  g.mk('0001', 'oi'); g.mk('0002', 'oi');
  g.bulk.sleep = async () => { g.bulk.stop(); };
  g.bulk.start(); await done(g.bulk);
  assert.equal(g.bulk.state.last.enviados, 1); assert.equal(g.bulk.state.last.interrompido, true);
});

test('o número principal usa a mesma orientação da Central (uma pergunta e encaminha)', () => {
  assert.match(centralNote({}), /UMA ÚNICA pergunta/);
});
