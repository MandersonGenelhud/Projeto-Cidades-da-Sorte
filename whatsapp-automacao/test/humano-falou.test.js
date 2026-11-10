import test from 'node:test';
import assert from 'node:assert/strict';
import { outreachBlock, humanSpoke } from '../src/outreach-guard.js';
import { humanReplied, collectStalled } from '../src/restart.js';
import { Agent } from '../src/agent/agent.js';
import { PendingInbox } from '../src/pending.js';
import { tempStore } from './helpers.js';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const ago = (h) => new Date(NOW - h * 3_600_000).toISOString();

test('depois que uma pessoa falou, nenhuma iniciativa da IA: retomada, lembrete, encerramento, orçamento', () => {
  const comHumano = { messages: [{ role: 'user', content: 'quero saber', at: ago(200) }, { role: 'assistant', content: '[áudio]', by: 'owner', at: ago(190) }] };
  const semHumano = { messages: [{ role: 'user', content: 'oi', at: ago(100) }, { role: 'assistant', content: 'Olá!', at: ago(99) }] };
  assert.equal(humanSpoke(comHumano), true);
  assert.equal(humanSpoke({ ownerRepliedAt: 1 }), true);
  assert.equal(humanSpoke({ humanSpokeAt: 1 }), true);
  assert.equal(humanSpoke(semHumano), false);
  for (const item of [{ restart: true }, { kind: 'nudge' }, { kind: 'encerramento' }, { kind: 'orcamento' }, { kind: 'retomar' }]) {
    assert.equal(outreachBlock({ conv: comHumano, item, now: NOW }), 'humano', JSON.stringify(item));
    assert.equal(outreachBlock({ conv: semHumano, item, now: NOW }), '', 'sem humano a regra antiga segue');
  }
  // quem escreveu agora continua sendo respondido pela regra normal (pausa do dono), não por esta guarda
  assert.equal(outreachBlock({ conv: comHumano, item: { texts: ['oi'] }, now: NOW }), '');
});

test('a conversa que o humano começou (mesmo antiga e sem resposta do cliente) sai do recomeçar', () => {
  const conv = { key: '5545988887777', phone: '5545988887777', messages: [{ role: 'assistant', content: 'Oi Jéssica', by: 'owner', at: ago(300) }, { role: 'user', content: 'ok', at: ago(299) }, { role: 'assistant', content: 'proposta', at: ago(298) }] };
  assert.equal(humanReplied(conv), true);
  const r = collectStalled({ conversations: [conv], now: NOW, days: 30, minSilentHours: 1 });
  assert.equal(r.length, 0);
});

test('o celular do dono falando (inclusive áudio sem texto) marca a conversa: a IA nunca mais toma a iniciativa, mas responde o cliente que volta a escrever', async () => {
  const store = tempStore();
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  const llm = { configured: true, chat: async () => ({ content: 'Olá!', tool_calls: [] }) };
  const agent = new Agent({ store, llm, calendar: null });
  // áudio do Marcos (sem texto), numa conversa que a IA nunca atendeu
  agent.ownerReplied({ key: 'jess', phone: '595981000111', text: '' });
  const conv = agent.conversation('jess');
  assert.ok(conv.humanSpokeAt > 0);
  assert.equal(humanSpoke(conv), true);
  assert.equal(outreachBlock({ conv, item: { kind: 'encerramento' }, now: Date.now() }), 'humano');
  // dias depois o CLIENTE volta a escrever: é resposta a ele (não iniciativa nossa), então a IA volta a atender
  conv.ownerRepliedAt = Date.now() - 5 * 24 * 3_600_000;
  const sent = [];
  await agent.handleIncoming({ key: 'jess', phone: '595981000111', text: 'oi, voltei' }, async (t) => sent.push(t));
  assert.equal(sent.length, 1, 'cliente que escreve depois de dias sem o dono falar é respondido');
  // mas por iniciativa nossa (lembrete, encerramento...) nunca mais
  assert.equal(outreachBlock({ conv, item: { kind: 'nudge' }, now: Date.now() }), 'humano');
});

test('envio já na fila é cancelado se uma pessoa falou com o cliente antes de a IA enviar', async () => {
  const store = tempStore();
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  const convs = { 'c1@s.whatsapp.net': { key: 'c1@s.whatsapp.net', phone: '5545988887777', messages: [{ role: 'user', content: 'oi', at: ago(50) }, { role: 'assistant', content: 'ligação', by: 'owner', at: ago(49) }] } };
  const sent = [];
  const agent = { config: { enabled: true }, active: true, conversation: (k) => convs[k] || null, handleIncoming: async (m, send) => { sent.push(m); await send('x'); } };
  const wa = { status: 'connected', send: async () => {}, isConnected: () => true };
  const inbox = new PendingInbox({ store, agent, wa, autoReply: { agentAllowed: () => true } });
  inbox.outreachBlock = (jid, item) => outreachBlock({ conv: convs[jid], item: { ...item, jid }, now: NOW });
  inbox.items['c1@s.whatsapp.net'] = { jid: 'c1@s.whatsapp.net', phone: '5545988887777', name: 'Jéssica', texts: [], at: NOW - 3_600_000, kind: 'encerramento', source: 'silêncio' };
  const r = inbox.enqueue(['c1@s.whatsapp.net']);
  assert.equal(r.queued, 0);
  assert.equal(r.reasons.humano, 1);
  assert.equal(inbox.items['c1@s.whatsapp.net'], undefined, 'não fica pendurado');
  assert.equal(sent.length, 0);
});
