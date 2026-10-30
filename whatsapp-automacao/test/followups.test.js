import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Crm } from '../src/crm.js';
import { Agent } from '../src/agent/agent.js';
import { AutoFollowUps } from '../src/followups.js';
import { tempStore } from './helpers.js';

function setup(clock) {
  const store = tempStore();
  store.updateSettings({ agent: { enabled: true, audience: 'all', apiKey: 'x' } });
  const auth = new Auth({ store, dataDir: store.dataDir });
  auth.create({ name: 'Marcos', login: 'marcos', password: 'segredo123', role: 'admin' });
  const crm = new Crm({ store, auth });
  const systems = [];
  const llm = { configured: true, chat: async ({ messages }) => { systems.push(messages[0].content); return { content: 'Bom dia, Carla! Hoje é o dia que combinamos. Te mando a ficha para garantir a sua reserva?', tool_calls: [] }; } };
  const agent = new Agent({ store, llm, now: () => clock.now });
  const sent = [];
  const f = new AutoFollowUps({ store, crm, agent, send: async (key, text) => sent.push({ key, text }), now: () => clock.now });
  agent.scheduleReturn = (conv, args, opts) => f.schedule(conv, args, opts);
  return { store, crm, agent, f, sent, systems };
}

test('cliente pede "mais pra frente": vira data marcada e, no dia, a IA retoma sozinha', async () => {
  const clock = { now: new Date(2026, 9, 30, 15, 0) }; // sexta, 30/10
  const { crm, agent, f, sent, systems } = setup(clock);
  const conv = agent.conversation('5521998887777@s.whatsapp.net');
  conv.phone = '5521998887777';
  conv.name = 'Carla';
  agent.remember(conv, 'user', 'Só consigo pagar depois do dia 5, me chama quinta');
  const r = await f.schedule(conv, { data: '2026-11-05', hora: '10:00', motivo: 'recebe o salário dia 5', o_que_falta: 'pagar a entrada' });
  assert.equal(r.ok, true);
  assert.match(r.instrucao, /quinta-feira, dia 05\/11\/2026, às 10h/);
  const lead = crm.findForConversation({ key: conv.key, phone: conv.phone });
  assert.equal(lead.stage, 'aguardando');
  assert.equal(lead.followUpAt, '2026-11-05');
  // Datas inválidas.
  assert.match((await f.schedule(conv, { data: '2026-10-01', motivo: 'x' })).erro, /de hoje em diante/);
  assert.match((await f.schedule(conv, { data: '2027-06-01', motivo: 'x' })).erro, /90 dias/);
  await f.schedule(conv, { data: '2026-11-05', hora: '10:00', motivo: 'recebe o salário dia 5', o_que_falta: 'pagar a entrada' });

  clock.now = new Date(2026, 10, 5, 9, 30); // antes do horário
  assert.equal(await f.run({ wait: async () => {} }), 0);
  clock.now = new Date(2026, 10, 5, 10, 10);
  assert.equal(await f.run({ wait: async () => {} }), 1);
  assert.equal(sent[0].key, conv.key);
  assert.match(sent[0].text, /ficha/);
  assert.match(systems.at(-1), /Retorno combinado \(é hoje\)/);
  assert.match(systems.at(-1), /pagar a entrada/);
  assert.equal(await f.run({ wait: async () => {} }), 0, 'não manda duas vezes');
});

test('cliente voltou a falar antes da data: não retoma; prompt proíbe encerrar o atendimento', async () => {
  const clock = { now: new Date(2026, 9, 30, 15, 0) };
  const { agent, f, sent, systems } = setup(clock);
  const conv = agent.conversation('5521911112222@s.whatsapp.net');
  conv.phone = '5521911112222';
  agent.remember(conv, 'user', 'Vou pensar');
  await f.schedule(conv, { data: '2026-11-02', hora: '14:00', motivo: 'vai pensar' });
  clock.now = new Date(2026, 9, 31, 11, 0);
  agent.remember(conv, 'user', 'Pensei, quero fechar!');
  await agent.think(conv);
  assert.match(systems[0], /Nunca encerre o atendimento/);
  assert.match(systems[0], /Nunca deixe a data em aberto/);
  clock.now = new Date(2026, 10, 2, 15, 0);
  assert.equal(await f.run({ wait: async () => {} }), 0);
  assert.equal(sent.length, 0);
});
