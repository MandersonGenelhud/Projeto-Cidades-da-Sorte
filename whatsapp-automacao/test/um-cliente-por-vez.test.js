import test from 'node:test';
import assert from 'node:assert/strict';
import { Agent } from '../src/agent/agent.js';
import { tempStore } from './helpers.js';

function setup() {
  const store = tempStore();
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  const events = [];
  const llm = { configured: true, chat: async ({ messages }) => { const who = messages.at(-1).content; events.push(`pensa ${who}`); await new Promise((r) => setTimeout(r, 30)); return { content: `resposta ${who}`, tool_calls: [] }; } };
  const agent = new Agent({ store, llm, wait: async () => {} });
  return { agent, events };
}

test('um cliente por vez no mesmo número: o segundo só começa depois que o primeiro recebeu a resposta', async () => {
  const { agent, events } = setup();
  const send = (who) => async (t) => { events.push(`envia ${who}`); void t; };
  await Promise.all([
    agent.handleIncoming({ key: '5545988880001@s.whatsapp.net', phone: '5545988880001', text: 'A' }, send('A')),
    agent.handleIncoming({ key: '5545988880002@s.whatsapp.net', phone: '5545988880002', text: 'B' }, send('B')),
  ]);
  assert.deepEqual(events, ['pensa A', 'envia A', 'pensa B', 'envia B']);
});

test('números diferentes continuam em paralelo (um número não segura o outro)', async () => {
  const { agent, events } = setup();
  const send = (who) => async () => { events.push(`envia ${who}`); };
  await Promise.all([
    agent.handleIncoming({ key: 'l:central:5545988880001@s.whatsapp.net', phone: '5545988880001', text: 'A' }, send('A')),
    agent.handleIncoming({ key: 'l:outra:5545988880002@s.whatsapp.net', phone: '5545988880002', text: 'B' }, send('B')),
  ]);
  assert.deepEqual(events.slice(0, 2).sort(), ['pensa A', 'pensa B'], 'os dois pensam ao mesmo tempo');
});

test('pessoa da equipe usando o número pelo celular: a IA espera ela parar antes de responder', async () => {
  const { agent, events } = setup();
  let busy = 3;
  agent.humanBusy = () => (busy-- > 0 ? 1000 : 0);
  agent.wait = async () => { events.push('espera'); };
  await agent.handleIncoming({ key: '5545988880001@s.whatsapp.net', phone: '5545988880001', text: 'A' }, async () => events.push('envia A'));
  assert.deepEqual(events.slice(0, 3), ['espera', 'espera', 'espera']);
  assert.equal(events.at(-1), 'envia A');
});

test('conversa em pausa porque a pessoa está digitando nela NÃO segura os outros clientes do mesmo número', async () => {
  const { agent, events } = setup();
  const KA = 'l:mand:5545988880001@s.whatsapp.net';
  const KB = 'l:mand:5545988880002@s.whatsapp.net';
  let busyA = true;
  agent.humanBusy = (key) => (key === KA && busyA ? 1000 : 0);
  agent.wait = async () => { await new Promise((r) => setTimeout(r, 5)); };
  const a = agent.handleIncoming({ key: KA, phone: '5545988880001', text: 'A' }, async () => events.push('envia A'));
  await new Promise((r) => setTimeout(r, 20));
  await agent.handleIncoming({ key: KB, phone: '5545988880002', text: 'B' }, async () => events.push('envia B'));
  assert.ok(events.includes('envia B'), 'B foi respondido enquanto A esperava');
  assert.ok(!events.includes('envia A'));
  busyA = false;
  await a;
  assert.ok(events.includes('envia A'));
});
