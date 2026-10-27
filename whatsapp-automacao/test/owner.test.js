import test from 'node:test';
import assert from 'node:assert/strict';
import { Agent } from '../src/agent/agent.js';
import { WhatsAppClient } from '../src/transports/whatsapp-web.js';
import { tempStore } from './helpers.js';

test('dono respondeu pelo celular: agente pausa e guarda a resposta na memória', async () => {
  const store = tempStore();
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  const llm = { configured: true, chat: async () => ({ content: 'Olá! Como posso ajudar?', tool_calls: [] }) };
  const agent = new Agent({ store, llm, calendar: null });
  const sent = [];
  await agent.handleIncoming({ key: 'j1', phone: '595981123456', text: 'oi' }, async (t) => sent.push(t));

  agent.ownerReplied({ key: 'j1', phone: '595981123456', text: 'Oi, aqui é o Marcos, pode falar comigo' });
  const conv = agent.conversation('j1');
  assert.equal(conv.handoff, true);
  assert.equal(conv.messages.at(-1).content, 'Oi, aqui é o Marcos, pode falar comigo');

  await agent.handleIncoming({ key: 'j1', phone: '595981123456', text: 'beleza' }, async (t) => sent.push(t));
  assert.deepEqual(sent, ['Olá! Como posso ajudar?']); // agente ficou em silêncio

  assert.equal(agent.ownerReplied({ key: 'outra', text: 'x' }), null); // conversa que o agente nunca atendeu
});

test('com a opção desligada, a resposta do dono não pausa o agente', async () => {
  const store = tempStore();
  store.updateSettings({ agent: { enabled: true, pauseOnOwnerReply: false } });
  const agent = new Agent({ store, llm: { configured: true }, calendar: null });
  agent.conversation('j2');
  agent.ownerReplied({ key: 'j2', text: 'oi' });
  assert.equal(agent.conversation('j2').handoff, false);
});

test('código de conexão: valida o número e formata o código', async () => {
  const wa = new WhatsAppClient({ authDir: '/tmp/nao-usado' });
  await assert.rejects(wa.requestPairingCode('11 98765'), /código do país/);
  await assert.rejects(wa.requestPairingCode('+595 981 123456'), /Aguarde o QR Code/);
  const pedidos = [];
  wa.sock = { requestPairingCode: async (p) => { pedidos.push(p); return 'ABCD1234'; } };
  wa.status = 'qr';
  assert.equal(await wa.requestPairingCode('+595 981 123456'), 'ABCD-1234');
  assert.deepEqual(pedidos, ['595981123456']);
  wa.status = 'connected';
  await assert.rejects(wa.requestPairingCode('+595 981 123456'), /Já existe/);
});
