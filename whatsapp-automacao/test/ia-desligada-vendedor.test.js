import test from 'node:test';
import assert from 'node:assert/strict';
import { Agent } from '../src/agent/agent.js';
import { presetSettings } from '../src/agent/presets.js';
import { outreachBlock } from '../src/outreach-guard.js';
import { teamRoutes } from '../src/lines.js';
import { tempStore } from './helpers.js';

function setup() {
  const store = tempStore();
  store.updateSettings(presetSettings('migra-paraguai'));
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  let calls = 0;
  const llm = { configured: true, chat: async () => { calls += 1; return { content: 'Olá!', tool_calls: [] }; } };
  const agent = new Agent({ store, llm, now: () => new Date(2026, 10, 12, 10, 0), wait: async () => {} });
  const off = new Set(['l:giovana:']);
  agent.aiOff = (key) => [...off].some((p) => String(key).startsWith(p));
  return { agent, llm: () => calls };
}

test('IA desligada no número da vendedora: mensagem do cliente não é respondida pela IA', async () => {
  const { agent, llm } = setup();
  const sent = [];
  agent.handleIncoming({ key: 'l:giovana:5545988880001@s.whatsapp.net', phone: '5545988880001', name: 'Cliente', text: 'oi' }, async (t) => sent.push(t));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(sent.length, 0);
  assert.equal(llm(), 0, 'nem chega a pensar');
});

test('IA desligada: nenhum caminho (retomada, fila, lembrete) consegue fazer a IA escrever pelo número', async () => {
  const { agent } = setup();
  const conv = agent.conversation('l:giovana:5545988880002@s.whatsapp.net');
  conv.messages.push({ role: 'user', content: 'oi', at: '2026-11-12T10:00:00Z' });
  await assert.rejects(() => agent.think(conv), /IA desligada neste número/);
  assert.match(agent.whyNot(conv).join(' '), /DESLIGADA neste número de vendedor/);
});

test('com a IA ligada (ou na Central) a IA responde normalmente', async () => {
  const { agent } = setup();
  const conv = agent.conversation('l:central:5545988880003@s.whatsapp.net');
  conv.messages.push({ role: 'user', content: 'oi', at: '2026-11-12T10:00:00Z' });
  const r = await agent.think(conv);
  assert.match(r.text, /Olá/);
});

test('envio automático (retomada, aviso, lembrete) é bloqueado no número com IA desligada', () => {
  assert.equal(outreachBlock({ conv: {}, item: { restart: true }, aiOff: true }), 'ia_desligada');
  assert.equal(outreachBlock({ conv: {}, item: { restart: true }, aiOff: false }), '');
});

test('avisos à equipe nunca saem pelo número de um vendedor', () => {
  const r = teamRoutes({ mainConnected: false, lines: [{ id: 'g', label: 'Giovana', status: 'connected' }] });
  assert.deepEqual(r, []);
});
