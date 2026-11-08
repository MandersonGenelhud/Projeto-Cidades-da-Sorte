import test from 'node:test';
import assert from 'node:assert/strict';
import { Agent } from '../src/agent/agent.js';
import { LocalCalendar } from '../src/agent/calendar.js';
import { presetSettings } from '../src/agent/presets.js';
import { answeredOurOutreach, detectDocsSent, apologyText } from '../src/outreach-apology.js';
import { detectClosedByMessages } from '../src/closed-signals.js';
import { tempStore } from './helpers.js';

const T = new Date(2026, 10, 9, 10, 0);
const iso = (h) => new Date(T.getTime() - h * 3_600_000).toISOString();

function setup(closedWhy = '') {
  const store = tempStore();
  store.updateSettings(presetSettings('clinica-sorriso'));
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  const calls = [];
  const llm = { configured: true, async chat({ messages }) { calls.push(messages.map((m) => m.content).join('\n')); return { content: 'Olá!', tool_calls: [] }; } };
  const agent = new Agent({ store, llm, calendar: new LocalCalendar({ store, getConfig: () => store.settings.agenda, now: () => T }), now: () => T });
  agent.closedClientWhy = () => closedWhy;
  const sent = [];
  const reply = (key, text, name = 'Carlos Souza') => agent.handleIncoming({ key, phone: '5511988887777', name, text }, async (t) => { sent.push(t); });
  return { store, agent, calls, sent, reply };
}
const nudge = (h) => ({ role: 'assistant', content: 'Bom dia, Carlos! Estou entrando em contato para dar continuidade ao seu atendimento.', at: iso(h) });

test('cliente antigo (banco de dados) responde à chamada automática: pedido de desculpas fixo, IA de vendas não fala e a equipe assume', async () => {
  const { agent, calls, sent, reply, store } = setup('contrato assinado');
  const conv = agent.conversation('k1');
  conv.messages.push({ role: 'user', content: 'Oi', at: iso(80) }, nudge(2));
  let told = '';
  agent.onClosedClientReply = (c, why) => { told = why; };
  await reply('k1', 'Como assim? Eu já sou cliente');
  assert.equal(calls.length, 0, 'a IA de vendas nem foi chamada');
  const apology = sent.join(' ');
  assert.ok(sent.length >= 2 && sent.every((b) => b.length <= 330), 'pedido de desculpas em mensagens curtas');
  assert.match(apology, /^Olá, Carlos! Peço perdão pela mensagem que você recebeu/);
  assert.match(apology, /você já é um dos nossos clientes/);
  assert.match(apology, /desconsidere essa mensagem/);
  assert.doesNotMatch(apology, /orçamento|contrato|R\$/i);
  const n = sent.length;
  const c = agent.conversation('k1', { create: false });
  assert.equal(c.handoff, true);
  assert.match(c.handoffReason, /Cliente da Migra respondeu/);
  assert.equal(told, 'contrato assinado');
  // próxima fala do cliente: continua com a equipe, a IA não responde e não pede desculpas de novo
  await reply('k1', 'Preciso de uma informação sobre o meu processo');
  assert.equal(sent.length, n);
  assert.equal(calls.length, 0);
  store.flush?.();
});

test('pagamento confirmado ou documentos enviados nas últimas mensagens também valem, mesmo sem contrato lançado', async () => {
  const a = setup('');
  const c = a.agent.conversation('k2');
  c.messages.push({ role: 'assistant', content: 'Pagamento confirmado! Recebemos o seu pix.', at: iso(200) }, nudge(1));
  await a.reply('k2', 'oi?');
  assert.equal(a.calls.length, 0);
  assert.match(a.sent.join(' '), /Peço perdão/);
  const b = setup('');
  const d = b.agent.conversation('k3');
  d.messages.push({ role: 'assistant', content: 'Para o contrato preciso do seu RG e da foto de meio corpo', at: iso(120) }, { role: 'user', content: '[foto enviada]', at: iso(119) }, nudge(1));
  assert.ok(detectDocsSent(d));
  assert.ok(detectClosedByMessages(d), 'documentos também travam chamadas de iniciativa');
  await b.reply('k3', 'já mandei meus documentos');
  assert.equal(b.calls.length, 0);
  assert.match(b.sent.join(' '), /Peço perdão/);
});

test('não é cliente comprovado: a IA responde, mas recebe a ordem de ler as 20 mensagens e pedir perdão se for cliente; quem não respondeu a chamada nossa segue normal', async () => {
  const a = setup('');
  const c = a.agent.conversation('k4');
  c.messages.push({ role: 'user', content: 'quanto custa?', at: iso(90) }, nudge(2));
  await a.reply('k4', 'oi');
  assert.equal(a.calls.length, 1);
  assert.match(a.calls[0], /RESPONDEU A UMA CHAMADA AUTOMÁTICA NOSSA/);
  assert.match(a.calls[0], /LEIA as últimas 20 mensagens/);
  const b = setup('contrato assinado'); // é cliente, mas escreveu por conta própria (não respondeu a nenhuma chamada nossa): atendimento normal
  const d = b.agent.conversation('k5');
  d.messages.push({ role: 'assistant', content: 'Segue o seu recibo.', at: iso(300) });
  await b.reply('k5', 'queria saber do meu processo');
  assert.equal(b.calls.length, 1);
  assert.doesNotMatch(b.sent.join(' '), /Peço perdão/);
});

test('detecção da resposta a uma chamada nossa e o texto do pedido de desculpas', () => {
  const NOW = T.getTime();
  assert.equal(answeredOurOutreach({ lastProactiveAt: NOW - 3_600_000, messages: [] }, { now: NOW }), true);
  assert.equal(answeredOurOutreach({ messages: [nudge(5)] }, { now: NOW }), true);
  assert.equal(answeredOurOutreach({ messages: [nudge(5 * 24 + 100)] }, { now: NOW }), false, 'chamada antiga demais');
  assert.equal(answeredOurOutreach({ messages: [{ role: 'assistant', content: 'Segue o recibo', at: iso(2) }] }, { now: NOW }), false);
  assert.match(apologyText('@fulano'), /^Olá! /);
  assert.match(apologyText('Ana Maria'), /^Olá, Ana!/);
});
