import test from 'node:test';
import assert from 'node:assert/strict';
import { Agent } from '../src/agent/agent.js';
import { readingTimeMs, splitIntoBubbles, typingTimeMs } from '../src/humanize.js';
import { tempStore } from './helpers.js';

test('tempos de leitura e digitação crescem com o texto e têm limites', () => {
  assert.equal(readingTimeMs('oi'), 1500);
  assert.equal(readingTimeMs('x'.repeat(10_000)), 8000);
  const curto = typingTimeMs('Claro!', { typingCharsPerSecond: 7 });
  const longo = typingTimeMs('x'.repeat(140), { typingCharsPerSecond: 7 });
  assert.ok(curto >= 1500 && curto < 3000);
  assert.ok(longo > 15_000 && longo <= 25_000);
  assert.equal(typingTimeMs('x'.repeat(5000)), 25_000);
});

test('resposta com parágrafos vira mensagens separadas (no máximo 3)', () => {
  assert.deepEqual(splitIntoBubbles('Oi! Tudo bem?\n\nSou a assistente da Migra.'), ['Oi! Tudo bem?', 'Sou a assistente da Migra.']);
  assert.deepEqual(splitIntoBubbles('a\n\nb\n\nc\n\nd'), ['a', 'b', 'c\n\nd']);
  assert.deepEqual(splitIntoBubbles('uma linha só'), ['uma linha só']);
});

test('sequência humana: percebe, marca como lida, lê, digita e manda em partes', async () => {
  const store = tempStore();
  store.updateSettings({ agent: { enabled: true, audience: 'all', humanize: { enabled: true, noticeMin: 5, noticeMax: 5, quietSeconds: 0 } } });
  const timeline = [];
  const wait = async (ms) => { timeline.push(`espera ${ms}`); };
  const llm = { configured: true, chat: async () => ({ content: 'Oi! Tudo bem por aí?\n\nMe conta: você pretende morar ou abrir empresa no Paraguai?', tool_calls: [] }) };
  const agent = new Agent({ store, llm, calendar: null, wait });
  const sent = [];
  await agent.handleIncoming(
    { key: 'k', phone: '5511900000000', text: 'Oi, quero morar no Paraguai', id: 'MSG1' },
    async (text, { typingMs }) => { timeline.push('enviou'); sent.push({ text, typingMs }); },
    { markRead: async (ids) => timeline.push(`leu ${ids.join(',')}`) },
  );
  assert.equal(timeline[0], 'espera 5000'); // percebeu a mensagem
  assert.equal(timeline[1], 'leu MSG1'); // tracinhos azuis
  assert.match(timeline[2], /^espera \d+$/); // tempo lendo
  assert.equal(sent.length, 2); // duas mensagens curtas
  assert.ok(sent.every((s) => s.typingMs >= 1200)); // "digitando…" em cada uma
  assert.equal(agent.conversation('k').messages.at(-1).content, 'Oi! Tudo bem por aí?\n\nMe conta: você pretende morar ou abrir empresa no Paraguai?');
});

test('espera o cliente terminar de escrever e responde tudo de uma vez', async () => {
  const store = tempStore();
  store.updateSettings({ agent: { enabled: true, audience: 'all', humanize: { enabled: true, noticeMin: 0, noticeMax: 0, quietSeconds: 6 } } });
  let chamadas = 0;
  const llm = { configured: true, chat: async ({ messages }) => { chamadas++; return { content: `vi: ${messages.at(-1).content}`, tool_calls: [] }; } };
  let agent;
  let tick = 0;
  // Enquanto o agente "espera", o cliente manda mais duas mensagens.
  const wait = async () => {
    tick++;
    if (tick === 1) agent.handleIncoming({ key: 'k', phone: '1', text: 'tudo bem?' }, send);
    if (tick === 2) agent.handleIncoming({ key: 'k', phone: '1', text: 'quero saber da cédula' }, send);
    if (tick === 3) agent.queues.get('k').lastAt = Date.now() - 10_000; // cliente parou de escrever
  };
  const sent = [];
  const send = async (t) => sent.push(t);
  agent = new Agent({ store, llm, calendar: null, wait });
  await agent.handleIncoming({ key: 'k', phone: '1', text: 'oi' }, send);
  assert.equal(chamadas, 1);
  assert.deepEqual(sent, ['vi: oi\ntudo bem?\nquero saber da cédula']);
});
