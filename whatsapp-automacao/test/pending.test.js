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
  const inbox = new PendingInbox({ store, agent, wa, autoReply, delay: [0, 0] });
  wa.send = async (to, payload) => { wa.sent.push({ to, ...payload }); inbox.resolve(to); return { jid: to }; };
  return { store, wa, inbox, prompts };
}

const waitFor = async (fn) => { const end = Date.now() + 3000; while (!fn()) { if (Date.now() > end) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)); } };

test('responder pendentes: agente pede desculpas pela demora e a lista esvazia', async () => {
  const { wa, inbox, prompts } = setup();
  inbox.ingestHistory([msg('595981111111@s.whatsapp.net', false, 'Quanto custa?', 120), msg('595982222222@s.whatsapp.net', false, 'oi', 60)].map((m) => ({ ...m, timestamp: Date.now() - 60000 })));
  assert.equal(inbox.list().length, 2);
  const r = inbox.enqueue(inbox.list().map((p) => p.jid));
  assert.equal(r.queued, 2);
  await waitFor(() => !inbox.running && wa.sent.length === 2);
  assert.equal(inbox.list().length, 0);
  assert.ok(prompts.every((p) => /pedindo desculpas pela demora/.test(p)));
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
  const inbox = new PendingInbox({ store, agent, wa, autoReply, delay: [0, 0] });
  wa.send = async (to, payload) => { wa.sent.push({ to, ...payload }); inbox.resolve(to); return { jid: to }; };
  for (const n of ['1', '2', '3']) inbox.onIncoming({ jid: `${n}@s.whatsapp.net`, phone: `55119000000${n}0`, text: 'oi' });
  inbox.enqueue(inbox.list().map((p) => p.jid));
  await waitFor(() => !inbox.running);
  assert.equal(wa.sent.length, 1); // só o primeiro, antes do limite
  assert.equal(inbox.list().length, 2); // os outros continuam esperando
  assert.ok(store.data.logs.some((l) => /fila de clientes esperando foi pausada/.test(l.message)));
});

test('responde sozinho quem ficou esperando, até 7 dias, sem atropelar quem acabou de escrever', async () => {
  const { store, wa, inbox } = setup();
  const now = Date.now();
  inbox.items['a@s.whatsapp.net'] = { jid: 'a@s.whatsapp.net', phone: '595981111111', name: 'A', texts: ['oi'], at: now - 10 * 60000, channel: 'whatsapp' };
  inbox.items['b@s.whatsapp.net'] = { jid: 'b@s.whatsapp.net', phone: '595982222222', name: 'B', texts: ['oi'], at: now - 30000, channel: 'whatsapp' }; // acabou de escrever
  inbox.items['c@s.whatsapp.net'] = { jid: 'c@s.whatsapp.net', phone: '595983333333', name: 'C', texts: ['oi'], at: now - 8 * 86_400_000, channel: 'whatsapp' }; // mais de 7 dias
  store.updateSettings({ agent: { autoAnswerPending: false } });
  assert.deepEqual(inbox.autoAnswer(), { queued: 0, blocked: 0 });
  store.updateSettings({ agent: { autoAnswerPending: true } });
  const r = inbox.autoAnswer();
  assert.equal(r.queued, 1);
  await waitFor(() => !inbox.running && wa.sent.length === 1);
  assert.equal(wa.sent[0].to, 'a@s.whatsapp.net');
});
