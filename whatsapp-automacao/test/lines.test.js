import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { LineManager, lineKey, parseLineKey, MAX_LINES, matchSeller } from '../src/lines.js';
import { samePhone } from '../src/utils.js';
import { ConnectionManager } from '../src/connection.js';
import { Auth } from '../src/auth.js';
import { Crm } from '../src/crm.js';
import { tempStore } from './helpers.js';

/** WhatsApp falso de um número da equipe. */
class FakeLineClient extends EventEmitter {
  constructor() { super(); this.status = 'qr'; this.sent = []; this.started = 0; }
  getState() { return { status: this.status, qr: 'data:qr', me: null }; }
  async start() { this.started++; }
  async restart() { this.started++; }
  async stop() {}
  async logout() {}
  async send(jid, payload) { this.sent.push({ jid, ...payload }); return { id: 'x', jid }; }
}

function setup() {
  const store = tempStore();
  const created = [];
  const lines = new LineManager({ store, dataDir: store.dataDir, createClient: () => { const c = new FakeLineClient(); created.push(c); return c; } });
  const main = new FakeLineClient();
  main.status = 'connected';
  const wa = new ConnectionManager({ store, clients: { qr: main, cloud: new FakeLineClient() }, lines });
  return { store, lines, wa, created, main };
}

test('chave de conversa de número da equipe', () => {
  const k = lineKey('ab12', '5511999990000@s.whatsapp.net');
  assert.equal(k, 'l:ab12:5511999990000@s.whatsapp.net');
  assert.deepEqual(parseLineKey(k), { id: 'ab12', jid: '5511999990000@s.whatsapp.net' });
  assert.equal(parseLineKey('ig:123'), null);
});

test('vários números, mensagens separadas por número e resposta pelo número certo', async () => {
  const { lines, wa, created, main } = setup();
  const a = lines.add({ label: 'WhatsApp da Ana', ownerId: 'u-ana' });
  const b = lines.add({ label: 'WhatsApp do João' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(created.length, 2);
  assert.equal(lines.add({ label: 'de novo', ownerId: 'u-ana' }).id, a.id, 'cada vendedor tem uma conexão só');
  for (let i = 2; i < MAX_LINES; i++) lines.add({ label: `N${i}` });
  assert.throws(() => lines.add({ label: 'sétimo' }), /limite/);

  const got = [];
  wa.on('message', (m) => got.push(m));
  created[0].emit('message', { id: '1', jid: '5511999990000@s.whatsapp.net', phone: '5511999990000', text: 'oi MIG-AB12', isGroup: false });
  assert.equal(got[0].jid, lineKey(a.id, '5511999990000@s.whatsapp.net'));
  assert.equal(got[0].ownerId, 'u-ana');
  assert.equal(got[0].lineLabel, 'WhatsApp da Ana');

  created[0].status = 'connected';
  assert.ok(wa.isConnected(got[0].jid));
  await wa.send(got[0].jid, { text: 'Olá!' });
  assert.equal(created[0].sent[0].jid, '5511999990000@s.whatsapp.net');
  assert.equal(created[1].sent.length, 0);
  assert.equal(main.sent.length, 0);

  // IA desligada só neste número.
  lines.update(b.id, { agent: false });
  created[1].emit('message', { id: '2', jid: '5511888880000@s.whatsapp.net', phone: '5511888880000', text: 'oi', isGroup: false });
  assert.equal(got[1].agentOff, true);
});

test('cliente chega no WhatsApp do vendedor com o código e herda o prospecto do Instagram', () => {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const crm = new Crm({ store, auth });
  const ig = crm.ensureFromConversation({ key: 'ig:777', username: 'carla', name: '@carla', channel: 'instagram' });
  const key = lineKey('ab12', '5511977776666@s.whatsapp.net');
  const linked = crm.linkByCode({ text: `Olá! Meu código de atendimento é ${ig.code.toLowerCase()}.`, key, phone: '5511977776666' });
  assert.equal(linked.id, ig.id);
  assert.equal(linked.phone, '5511977776666');
  const again = crm.ensureFromConversation({ key, phone: '5511977776666', channel: 'whatsapp' });
  assert.equal(again.id, ig.id); // não duplica
  assert.equal(crm.leads.length, 1);
});

test('ao conectar, confere se o WhatsApp é o do vendedor cadastrado', () => {
  const users = [
    { id: 'ana', name: 'Ana Lima', whatsapp: '5511987654321', active: true },
    { id: 'joao', name: 'João Reis', whatsapp: '', active: true },
    { id: 'bia', name: 'Bia Souza', whatsapp: '595981222333', active: true },
  ];
  const opts = { samePhone };
  // Número certo (com ou sem o 9 na frente).
  let r = matchSeller({ ownerId: 'ana' }, '551187654321', users, opts);
  assert.deepEqual(r.patch, { phone: '551187654321', verified: true, label: 'Ana Lima' });
  // Número diferente do cadastro: avisa.
  r = matchSeller({ ownerId: 'ana' }, '5521911112222', users, opts);
  assert.equal(r.patch.verified, false);
  assert.ok(r.mismatch);
  // Vendedor sem WhatsApp no cadastro: o número conectado vira o dele.
  r = matchSeller({ ownerId: 'joao' }, '5547999998888', users, opts);
  assert.equal(r.userWhatsapp, '5547999998888');
  assert.equal(r.patch.label, 'João Reis');
  // Conexão sem dono: descobre o vendedor pelo número.
  r = matchSeller({ ownerId: null }, '595981222333', users, opts);
  assert.equal(r.patch.ownerId, 'bia');
  assert.equal(r.patch.label, 'Bia Souza');
  // Número de ninguém.
  r = matchSeller({ ownerId: null }, '5500000000000', users, opts);
  assert.equal(r.patch.verified, null);
});
