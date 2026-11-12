import test from 'node:test';
import assert from 'node:assert/strict';
import { Agent } from '../src/agent/agent.js';
import { readingTimeMs, splitIntoBubbles, typingTimeMs, humanizeConfig } from '../src/humanize.js';
import { tempStore } from './helpers.js';

test('tempos de leitura e digitação crescem com o texto e têm limites', () => {
  assert.equal(readingTimeMs('oi'), 2000);
  assert.equal(readingTimeMs('x'.repeat(10_000)), 9000);
  const curto = typingTimeMs('Claro!', { typingCharsPerSecond: 7 });
  const longo = typingTimeMs('x'.repeat(140), { typingCharsPerSecond: 7 });
  assert.ok(curto >= 1500 && curto < 3000);
  assert.ok(longo > 25_000 && longo <= 40_000, 'o piso de segurança limita a 4 letras por segundo, mesmo pedindo 7');
  assert.equal(typingTimeMs('x'.repeat(5000)), 40_000);
});

test('resposta com parágrafos vira mensagens separadas (até 6)', () => {
  assert.deepEqual(splitIntoBubbles('Oi! Tudo bem?\n\nSou a assistente da Migra.'), ['Oi! Tudo bem?', 'Sou a assistente da Migra.']);
  assert.deepEqual(splitIntoBubbles('a\n\nb\n\nc\n\nd\n\ne'), ['a', 'b', 'c', 'd', 'e']);
  // Parágrafo comprido vira duas mensagens, quebrando no fim de uma frase.
  const long = 'Entendo totalmente, é uma decisão importante e faz sentido pensar com calma. Quem tenta sozinho costuma perder viagens por causa de um documento errado, e cada ida ao Paraguai custa passagem, hotel e dias de trabalho. Com a gente você vai só duas vezes.';
  const parts = splitIntoBubbles(long);
  assert.equal(parts.length, 2);
  assert.ok(parts.every((p) => /[.!?]$/.test(p)));
  assert.equal(parts.join(' '), long);
  assert.deepEqual(splitIntoBubbles('uma linha só'), ['uma linha só']);
});

test('sequência humana: percebe, marca como lida, lê, digita e manda em partes', async () => {
  const store = tempStore();
  store.updateSettings({ agent: { enabled: true, audience: 'all', humanize: { enabled: true, safeFloor: false, noticeMin: 5, noticeMax: 5, quietSeconds: 0 } } });
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
  store.updateSettings({ agent: { enabled: true, audience: 'all', humanize: { enabled: true, safeFloor: false, noticeMin: 0, noticeMax: 0, quietSeconds: 6 } } });
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

test('piso de segurança: configuração rápida antiga não deixa a IA responder rápido demais', () => {
  const c = humanizeConfig({ noticeMin: 1, noticeMax: 3, quietSeconds: 2, typingCharsPerSecond: 12, maxTypingSeconds: 8 });
  assert.equal(c.noticeMin, 20); assert.equal(c.noticeMax, 60); assert.equal(c.quietSeconds, 10);
  assert.equal(c.typingCharsPerSecond, 4); assert.equal(c.maxTypingSeconds, 40);
  const mais = humanizeConfig({ noticeMin: 40, noticeMax: 120 });
  assert.equal(mais.noticeMin, 40, 'mais lento que o piso é respeitado');
  assert.equal(humanizeConfig({ safeFloor: false, noticeMin: 1 }).noticeMin, 1, 'só desliga com decisão explícita');
});
