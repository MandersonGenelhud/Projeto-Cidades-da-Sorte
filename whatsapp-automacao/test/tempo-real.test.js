import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SseHub, allowEvent, slimMessage } from '../src/sse-hub.js';
import { Agent } from '../src/agent/agent.js';
import { tempStore } from './helpers.js';

test('tempo real filtrado: vendedor só recebe mensagens das conversas dele; nunca os registros; tráfego só a conexão', () => {
  const seen = { admin: [], gio: [], trafego: [] };
  const res = (who) => ({ write: (p) => seen[who].push(p) });
  const hub = new SseHub({ canSeeConv: (u, key) => key.startsWith(`l:${u.id}:`) });
  hub.add(res('admin'), { id: 'adm', role: 'admin' });
  hub.add(res('gio'), { id: 'gio', role: 'seller' });
  hub.add(res('trafego'), { id: 't', role: 'seller', trafficOnly: true });
  hub.notify('message', { jid: 'l:gio:5511999990000@s.whatsapp.net', name: 'Cliente da Gio', text: 'oi', _raw: { segredo: 1 } });
  hub.notify('message', { jid: 'l:mand:5511988880000@s.whatsapp.net', name: 'Cliente do Manderson', text: 'oi' });
  hub.notify('log', { type: 'received', message: 'texto de cliente' });
  hub.notify('status', { status: 'connected' });
  hub.notify('message', { jid: 'l:gio:120363@g.us', isGroup: true, text: 'grupo' });
  assert.equal(seen.admin.length, 5, 'administrador recebe tudo');
  assert.equal(seen.gio.length, 2, 'vendedora: a mensagem do cliente dela e o estado da conexão');
  assert.ok(seen.gio.join('').includes('Cliente da Gio'));
  assert.ok(!seen.gio.join('').includes('Cliente do Manderson'), 'não recebe cliente de outro vendedor');
  assert.ok(!seen.gio.join('').includes('texto de cliente'), 'não recebe registros do sistema');
  assert.deepEqual(seen.trafego.map((p) => p.split('\n')[0]), ['event: status']);
  assert.ok(!seen.admin.join('').includes('segredo'), 'a mensagem vai resumida, sem o conteúdo bruto do WhatsApp');
});

test('allowEvent e slimMessage', () => {
  assert.equal(allowEvent(null, 'status', {}), false);
  assert.equal(allowEvent({ role: 'seller' }, 'crm', { id: 1 }), true);
  assert.equal(allowEvent({ role: 'seller' }, 'campaign', {}), false);
  assert.equal(slimMessage({ jid: 'x', text: 'a'.repeat(1000) }).text.length, 300);
});

function agentWith() {
  const store = tempStore();
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  const events = [];
  const agent = new Agent({ store, llm: { configured: true, chat: async () => ({ content: 'Olá! Como posso ajudar?', tool_calls: [] }) }, wait: async () => {}, notify: (e, d) => events.push([e, d]) });
  return { store, agent, events };
}

test('a mensagem aparece na conversa NA HORA; quando a IA responde, entra uma vez só e na ordem certa', async () => {
  const { agent, events } = agentWith();
  const key = 'l:mand:5511977770000@s.whatsapp.net';
  agent.recordInbound({ key, phone: '5511977770000', name: 'Ana', text: 'quanto custa?', id: 'm1' });
  agent.recordInbound({ key, phone: '5511977770000', text: 'para 2 pessoas', id: 'm2' });
  const c = agent.conversation(key);
  assert.equal(c.messages.length, 0, 'a IA ainda não leu: fica na caixa de entrada');
  assert.equal(c.inbox.length, 2);
  assert.ok(events.some(([e, d]) => e === 'conversation' && d.key === key), 'avisa o painel na hora');
  assert.equal(agent.listConversations().find((x) => x.key === key).last.content, 'para 2 pessoas');
  await Promise.all([
    agent.handleIncoming({ key, phone: '5511977770000', text: 'quanto custa?', id: 'm1' }, async () => {}),
    agent.handleIncoming({ key, phone: '5511977770000', text: 'para 2 pessoas', id: 'm2' }, async () => {}),
  ]);
  const users = c.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
  assert.equal(users, 'quanto custa?\npara 2 pessoas', 'as duas mensagens, uma vez cada, na ordem');
  assert.equal(c.messages.at(-1).role, 'assistant');
  assert.ok(!c.inbox);
});

test('número com a IA desligada: a mensagem entra direto na conversa (o vendedor vê no painel)', () => {
  const { agent } = agentWith();
  const key = 'l:gio:5511966660000@s.whatsapp.net';
  agent.recordInbound({ key, text: 'oi Giovana', id: 'x1' }, { direct: true });
  assert.equal(agent.conversation(key).messages[0].content, 'oi Giovana');
});

test('a pessoa respondeu pelo celular: o que o cliente mandou entra antes da resposta dela', () => {
  const { agent } = agentWith();
  const key = 'l:mand:5511955550000@s.whatsapp.net';
  agent.recordInbound({ key, text: 'pode me ligar?', id: 'y1' });
  agent.ownerReplied({ key, phone: '5511955550000', text: 'Claro, ligo em 5 min' });
  const m = agent.conversation(key).messages;
  assert.deepEqual(m.map((x) => [x.role, x.content]), [['user', 'pode me ligar?'], ['assistant', 'Claro, ligo em 5 min']]);
});

test('mensagem que chega enquanto a IA responde a anterior: cada uma no seu lugar, sem duplicar', async () => {
  const { agent } = agentWith();
  const key = 'l:mand:5511944440000@s.whatsapp.net';
  agent.recordInbound({ key, text: 'oi', id: 'a1' });
  await agent.handleIncoming({ key, phone: '5511944440000', text: 'oi', id: 'a1' }, async () => { agent.recordInbound({ key, text: 'tudo bem?', id: 'a2' }); });
  await agent.handleIncoming({ key, phone: '5511944440000', text: 'tudo bem?', id: 'a2' }, async () => {});
  const m = agent.conversation(key).messages.map((x) => [x.role, x.content]);
  assert.deepEqual(m.filter(([r]) => r === 'user'), [['user', 'oi'], ['user', 'tudo bem?']]);
  assert.equal(m[0][1], 'oi');
  assert.equal(m[1][0], 'assistant', 'a resposta ao "oi" vem antes do "tudo bem?"');
});
