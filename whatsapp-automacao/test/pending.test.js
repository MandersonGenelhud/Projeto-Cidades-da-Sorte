import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPending, PendingInbox } from '../src/pending.js';
import { normalizeMessage } from '../src/transports/whatsapp-web.js';
import { Agent } from '../src/agent/agent.js';
import { AutoReply } from '../src/autoreply.js';
import { FakeWA, tempStore } from './helpers.js';

const NOW = Date.parse('2026-10-27T15:00:00Z');
const msg = (jid, fromMe, text, minutesAgo, extra = {}) => ({ jid, fromMe, text, timestamp: NOW - minutesAgo * 60000, isGroup: false, phone: jid.split('@')[0], name: fromMe ? '' : 'Cliente', ...extra });

test('extractPending: só conversas em que o cliente falou por último, dentro do prazo', () => {
  const list = extractPending([
    msg('a@s.whatsapp.net', false, 'oi', 30),
    msg('a@s.whatsapp.net', false, 'quero morar no Paraguai', 29),
    msg('b@s.whatsapp.net', false, 'oi', 60),
    msg('b@s.whatsapp.net', true, 'Olá!', 50), // já respondido
    msg('c@s.whatsapp.net', false, 'oi', 60 * 24 * 10), // velho demais
    msg('d@g.us', false, 'grupo', 5, { isGroup: true }),
  ], { now: NOW, maxDays: 7 });
  assert.equal(list.length, 1);
  assert.equal(list[0].jid, 'a@s.whatsapp.net');
  assert.deepEqual(list[0].texts, ['oi', 'quero morar no Paraguai']);
});

test('normalizeMessage resolve LID para o número real', () => {
  const m = normalizeMessage(
    { key: { remoteJid: '123@lid', fromMe: false, id: 'X' }, message: { conversation: 'oi' }, messageTimestamp: 1761577200, pushName: 'Ana' },
    new Map([['123@lid', '595981123456@s.whatsapp.net']]),
  );
  assert.equal(m.phone, '595981123456');
  assert.equal(m.text, 'oi');
  assert.equal(m.name, 'Ana');
});

function setup({ audience = 'all', testNumbers = [] } = {}) {
  const store = tempStore();
  store.updateSettings({ agent: { enabled: true, audience, testNumbers } });
  const prompts = [];
  const llm = { configured: true, chat: async ({ messages }) => { prompts.push(messages[0].content); return { content: 'Desculpe a demora! Como posso ajudar?', tool_calls: [] }; } };
  const agent = new Agent({ store, llm, calendar: null });
  const wa = new FakeWA();
  const autoReply = new AutoReply({ store, wa, agent });
  const inbox = new PendingInbox({ store, agent, wa, autoReply, delay: [0, 0], careful: false });
  wa.send = async (to, payload) => { wa.sent.push({ to, ...payload }); inbox.resolve(to); return { jid: to }; };
  return { store, wa, inbox, prompts };
}

const waitFor = async (fn) => { const end = Date.now() + 3000; while (!fn()) { if (Date.now() > end) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)); } };

test('responder pendentes: agente agradece por aguardar (sem pedir desculpas) e a lista esvazia', async () => {
  const { wa, inbox, prompts } = setup();
  inbox.ingestHistory([msg('595981111111@s.whatsapp.net', false, 'Quanto custa?', 120), msg('595982222222@s.whatsapp.net', false, 'oi', 60)].map((m) => ({ ...m, timestamp: Date.now() - 60000 })));
  assert.equal(inbox.list().length, 2);
  const r = inbox.enqueue(inbox.list().map((p) => p.jid));
  assert.equal(r.queued, 2);
  await waitFor(() => !inbox.running && wa.sent.length === 2);
  assert.equal(inbox.list().length, 0);
  assert.ok(prompts.every((p) => /agradeça por aguardar/.test(p) && /Nunca peça desculpas/.test(p)));
});

test('responder pendentes respeita o modo de teste', () => {
  const { inbox } = setup({ audience: 'test', testNumbers: ['+595 981 111111'] });
  inbox.onIncoming({ jid: 'x@s.whatsapp.net', phone: '595981111111', name: 'Eu', text: 'oi' });
  inbox.onIncoming({ jid: 'y@s.whatsapp.net', phone: '595982222222', name: 'Cliente', text: 'oi' });
  const r = inbox.enqueue(['x@s.whatsapp.net', 'y@s.whatsapp.net']);
  assert.deepEqual(r, { queued: 1, blocked: 1 });
  inbox.cancel();
});

test('mensagem respondida (pelo agente ou pelo dono) sai da lista', () => {
  const { inbox } = setup();
  inbox.onIncoming({ jid: 'z@s.whatsapp.net', phone: '5511900000000', text: 'oi' });
  assert.equal(inbox.list().length, 1);
  inbox.resolve('z@s.whatsapp.net');
  assert.equal(inbox.list().length, 0);
});

test('limite gratuito da IA: a fila pausa e ninguém recebe desculpa genérica', async () => {
  const store = tempStore();
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  let calls = 0;
  const llm = {
    configured: true,
    chat: async () => {
      calls++;
      if (calls === 1) return { content: 'Desculpe a demora! Como posso ajudar?', tool_calls: [] };
      const err = new Error('Google Gemini: limite de uso atingido');
      err.quota = true;
      throw err;
    },
  };
  const agent = new Agent({ store, llm, calendar: null });
  const wa = new FakeWA();
  const autoReply = new AutoReply({ store, wa, agent });
  const inbox = new PendingInbox({ store, agent, wa, autoReply, delay: [0, 0], careful: false });
  wa.send = async (to, payload) => { wa.sent.push({ to, ...payload }); inbox.resolve(to); return { jid: to }; };
  for (const n of ['1', '2', '3']) inbox.onIncoming({ jid: `${n}@s.whatsapp.net`, phone: `55119000000${n}0`, text: 'oi' });
  inbox.enqueue(inbox.list().map((p) => p.jid));
  await waitFor(() => !inbox.running);
  assert.equal(wa.sent.length, 1); // só o primeiro, antes do limite
  assert.equal(inbox.list().length, 2); // os outros continuam esperando
  assert.ok(store.data.logs.some((l) => /fila de clientes esperando foi pausada/.test(l.message)));
});

test('responde sozinho quem ficou esperando, até 15 dias (padrão), sem atropelar quem acabou de escrever', async () => {
  const { store, wa, inbox } = setup();
  const now = Date.now();
  inbox.items['a@s.whatsapp.net'] = { jid: 'a@s.whatsapp.net', phone: '595981111111', name: 'A', texts: ['oi'], at: now - 10 * 60000, channel: 'whatsapp' };
  inbox.items['b@s.whatsapp.net'] = { jid: 'b@s.whatsapp.net', phone: '595982222222', name: 'B', texts: ['oi'], at: now - 30000, channel: 'whatsapp' }; // acabou de escrever
  inbox.items['c@s.whatsapp.net'] = { jid: 'c@s.whatsapp.net', phone: '595983333333', name: 'C', texts: ['oi'], at: now - 16 * 86_400_000, channel: 'whatsapp' }; // mais de 15 dias
  inbox.items['d@s.whatsapp.net'] = { jid: 'd@s.whatsapp.net', phone: '595984444444', name: 'D', texts: ['oi'], at: now - 12 * 86_400_000, channel: 'whatsapp' }; // 12 dias: entra
  store.updateSettings({ agent: { autoAnswerPending: false } });
  assert.deepEqual(inbox.autoAnswer(), { queued: 0, blocked: 0 });
  store.updateSettings({ agent: { autoAnswerPending: true } });
  const r = inbox.autoAnswer();
  assert.equal(store.settings.agent.pendingMaxDays, 15);
  assert.equal(r.queued, 2);
  await waitFor(() => !inbox.running && wa.sent.length === 2);
  assert.deepEqual(wa.sent.map((m) => m.to).sort(), ['a@s.whatsapp.net', 'd@s.whatsapp.net']);
});

test('histórico do celular: a IA recebe as 10 mensagens anteriores da conversa como contexto', async () => {
  const { store, inbox } = setup();
  store.updateSettings({ agent: { autoAnswerPending: false } });
  const jid = '595983333333@s.whatsapp.net';
  const old = [];
  for (let i = 0; i < 14; i++) old.push(msg(jid, i % 2 === 1, `mensagem ${i}`, 300 - i * 10));
  old.push(msg(jid, false, 'e aí, como faço para começar?', 20));
  inbox.ingestHistory(old.map((m) => ({ ...m, timestamp: Date.now() - (NOW - m.timestamp) })));
  const conv = store.data.conversations[jid];
  assert.equal(conv.messages.length, 10);
  assert.equal(conv.messages[0].content, 'mensagem 4');
  assert.equal(conv.messages.at(-1).content, 'mensagem 13');
  assert.equal(conv.messages.at(-1).role, 'assistant');
  assert.deepEqual(inbox.list()[0].texts, ['e aí, como faço para começar?']);
  assert.equal(inbox.list()[0].context, undefined);
});

test('modo cuidadoso: no máximo N respostas por hora e só no horário permitido', async () => {
  const { store, wa } = setup();
  const agent = new Agent({ store, llm: { configured: true, chat: async () => ({ content: 'Oi! Agradeço por aguardar.', tool_calls: [] }) }, calendar: null });
  const autoReply = new AutoReply({ store, wa, agent });
  let clock = new Date(2026, 9, 30, 3, 0); // 3h da manhã
  const inbox = new PendingInbox({ store, agent, wa, autoReply, delay: [0, 0], careful: true, now: () => clock });
  wa.send = async (to, payload) => { wa.sent.push({ to, ...payload }); inbox.resolve(to); return { jid: to }; };
  store.updateSettings({ agent: { pendingPerHour: 2, autoAnswerPending: false } });
  for (const n of [1, 2, 3]) inbox.items[`59598100000${n}@s.whatsapp.net`] = { jid: `59598100000${n}@s.whatsapp.net`, phone: `59598100000${n}`, name: `C${n}`, texts: ['oi'], at: Date.now() - 3600_000, channel: 'whatsapp' };
  inbox.enqueue(Object.keys(inbox.items));
  await waitFor(() => /fora do horário/.test(inbox.status().waiting));
  assert.equal(wa.sent.length, 0, 'de madrugada não responde a fila antiga');
  inbox.cancel();
  await waitFor(() => !inbox.running);

  clock = new Date(2026, 9, 30, 10, 0);
  for (const n of [1, 2, 3]) inbox.items[`59598100000${n}@s.whatsapp.net`] ||= { jid: `59598100000${n}@s.whatsapp.net`, phone: `59598100000${n}`, name: `C${n}`, texts: ['oi'], at: Date.now() - 3600_000, channel: 'whatsapp' };
  inbox.enqueue(Object.keys(inbox.items));
  await waitFor(() => /limite de 2 respostas por hora/.test(inbox.status().waiting));
  assert.equal(wa.sent.length, 2);
  inbox.cancel();
  await waitFor(() => !inbox.running);
});
