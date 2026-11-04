import test from 'node:test';
import assert from 'node:assert/strict';
import { Agent } from '../src/agent/agent.js';
import { LLMClient } from '../src/agent/llm.js';
import { presetSettings } from '../src/agent/presets.js';
import { tempStore } from './helpers.js';

const setup = () => {
  const store = tempStore();
  store.updateSettings(presetSettings('migra-paraguai'));
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  const seen = [];
  const llm = { configured: true, chat: async ({ messages }) => { seen.push(messages[0]); return { content: 'ok', tool_calls: [] }; } };
  return { agent: new Agent({ store, llm, contextFor: (c) => (c.name === 'Paula' ? 'Interesse: cédula' : '') }), seen };
};

test('custo: o começo do prompt é igual para todos os clientes; hora, nome e CRM vão para o final', async () => {
  const { agent, seen } = setup();
  for (const [key, name] of [['5511900001111@s.whatsapp.net', 'Paula'], ['5511900002222@s.whatsapp.net', 'Carlos']]) {
    const c = agent.conversation(key); c.name = name; agent.remember(c, 'user', 'Oi'); await agent.think(c);
  }
  const [a, b] = seen;
  assert.ok(a._cacheLen > 20000, 'parte fixa grande');
  assert.equal(a.content.slice(0, a._cacheLen), b.content.slice(0, b._cacheLen), 'começo idêntico entre clientes');
  assert.match(a.content.slice(a._cacheLen), /Agora são/);
  assert.match(a.content.slice(a._cacheLen), /"Paula"/);
  assert.match(a.content.slice(a._cacheLen), /Interesse: cédula/);
  assert.doesNotMatch(b.content.slice(b._cacheLen), /Interesse: cédula/);
  assert.doesNotMatch(a.content.slice(0, a._cacheLen), /Agora são|Paula/);
});

test('custo: Claude pela OpenRouter marca o começo para cache; outros modelos recebem texto simples', async () => {
  const bodies = [];
  const fetchImpl = async (_u, o) => { bodies.push(JSON.parse(o.body)); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { role: 'assistant', content: 'oi' } }] }), text: async () => '' }; };
  const msg = { role: 'system', content: `${'A'.repeat(3000)}FIM-FIXO${'B'.repeat(50)}`, _cacheLen: 3008 };
  for (const model of ['~anthropic/claude-sonnet-latest', 'openai/gpt-5-mini']) {
    const llm = new LLMClient({ getConfig: () => ({ provider: 'openrouter', apiKey: 'k', model }), fetchImpl });
    await llm.chat({ messages: [msg, { role: 'user', content: 'oi' }], tools: [] });
  }
  assert.equal(bodies[0].messages[0].content[0].cache_control.type, 'ephemeral');
  assert.equal(bodies[0].messages[0].content[1].text, 'B'.repeat(50));
  assert.equal(typeof bodies[1].messages[0].content, 'string');
  assert.ok(!('_cacheLen' in bodies[0].messages[0]) && !('_cacheLen' in bodies[1].messages[0]));
});
