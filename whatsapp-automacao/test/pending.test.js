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
  const llm = { configured: true, chat: async ({ messages }) => {
    if (/Você analisa conversas antigas/.test(messages[0].content)) return { content: '{"tipo":"cliente_novo","responder":true,"motivo":"cliente esperando","continuidade":"pediu informações"}', tool_calls: [] };
    prompts.push(messages[0].content);
    return { content: 'Oi! Agradeço por aguardar. Como posso ajudar?', tool_calls: [] };
  } };
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
  store.updateSettings({ agent: { enabled: true, audience: 'all', triagePending: false } });
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

test('histórico do celular: a IA recebe as 20 mensagens anteriores da conversa como contexto', async () => {
  const { store, inbox } = setup();
  store.updateSettings({ agent: { autoAnswerPending: false } });
  const jid = '595983333333@s.whatsapp.net';
  const old = [];
  for (let i = 0; i < 24; i++) old.push(msg(jid, i % 2 === 1, `mensagem ${i}`, 300 - i * 10));
  old.push(msg(jid, false, 'e aí, como faço para começar?', 20));
  inbox.ingestHistory(old.map((m) => ({ ...m, timestamp: Date.now() - (NOW - m.timestamp) })));
  const conv = store.data.conversations[jid];
  assert.equal(conv.messages.length, 20);
  assert.equal(conv.messages[0].content, 'mensagem 4');
  assert.equal(conv.messages.at(-1).content, 'mensagem 23');
  assert.equal(conv.messages.at(-1).role, 'assistant');
  assert.deepEqual(inbox.list()[0].texts, ['e aí, como faço para começar?']);
  assert.equal(inbox.list()[0].context, undefined);
});

test('modo cuidadoso: no máximo N respostas por hora e só no horário permitido', async () => {
  const { store, wa } = setup();
  store.updateSettings({ agent: { triagePending: false } });
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

test('antes de responder a fila antiga: conversa pessoal/negociação do Marcos fica com ele; cliente recebe continuidade', async () => {
  const store = tempStore();
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  const systems = [];
  const llm = { configured: true, chat: async ({ messages }) => {
    const sys = messages[0].content;
    if (/Você analisa conversas antigas/.test(sys)) {
      const chat = messages[1].content;
      if (/churrasco/.test(chat)) return { content: '{"tipo":"pessoal","responder":false,"motivo":"amigo combinando churrasco","continuidade":""}', tool_calls: [] };
      return { content: 'Análise: {"tipo":"cliente_em_atendimento","responder":true,"motivo":"cliente esperando","continuidade":"Marcos explicou o Ouro; falta mandar o orçamento para 2 pessoas"}', tool_calls: [] };
    }
    systems.push(sys);
    return { content: 'Oi! Agradeço por aguardar. Vou te mandar o orçamento para 2 pessoas.', tool_calls: [] };
  } };
  const agent = new Agent({ store, llm, calendar: null });
  const wa = new FakeWA();
  const autoReply = new AutoReply({ store, wa, agent });
  const inbox = new PendingInbox({ store, agent, wa, autoReply, delay: [0, 0], careful: false });
  wa.send = async (to, payload) => { wa.sent.push({ to, ...payload }); inbox.resolve(to); return { jid: to }; };
  store.updateSettings({ agent: { autoAnswerPending: false } });
  const t = Date.now();
  const at = (min) => t - min * 60000;
  inbox.ingestHistory([
    { ...msg('595981000010@s.whatsapp.net', true, 'Fala irmão, sábado tem churrasco?', 0), timestamp: at(90) },
    { ...msg('595981000010@s.whatsapp.net', false, 'Tem sim, leva a carne', 0), timestamp: at(80) },
    { ...msg('595981000020@s.whatsapp.net', false, 'Quero saber do pacote Ouro', 0), timestamp: at(90) },
    { ...msg('595981000020@s.whatsapp.net', true, 'O Ouro inclui cédula, RUC e licença', 0), timestamp: at(85) },
    { ...msg('595981000020@s.whatsapp.net', false, 'Somos 2, quanto fica?', 0), timestamp: at(80) },
  ]);
  inbox.enqueue(inbox.list().map((p) => p.jid));
  await waitFor(() => !inbox.running);
  assert.deepEqual(wa.sent.map((m) => m.to), ['595981000020@s.whatsapp.net'], 'só o cliente recebeu');
  const friend = store.data.conversations['595981000010@s.whatsapp.net'];
  assert.equal(friend.handoff, true);
  assert.match(friend.handoffReason, /Conversa do Marcos \(pessoal\)/);
  assert.match(systems[0], /Continuidade desta conversa/);
  assert.match(systems[0], /falta mandar o orçamento para 2 pessoas/);
  assert.equal(store.data.conversations['595981000020@s.whatsapp.net'].continuity, undefined, 'a análise vale só para a primeira resposta');
});

test('Instagram: conversas que esfriaram (a última mensagem foi nossa) entram para retomar, sem contar só botões', async () => {
  const { extractStalled } = await import('../src/pending.js');
  const now = Date.parse('2026-10-31T12:00:00Z');
  const h = (n) => now - n * 3_600_000;
  const m = (jid, fromMe, text, hoursAgo) => ({ jid, fromMe, text, timestamp: h(hoursAgo), username: jid.replace('ig:', 'u') });
  const msgs = [
    // Josemar: só clicou no botão e o robô perguntou o plano: não é conversa de verdade ainda
    m('ig:1', false, 'Quero saber o valor', 60), m('ig:1', true, 'Qual plano você gostaria?', 59),
    // Magda: escreveu de próprio punho e o robô respondeu mal; parou há 2 dias
    m('ig:2', false, 'Quero saber o valor', 70), m('ig:2', true, 'Qual plano?', 69),
    m('ig:2', false, 'Eu só queria saber como está a situação para montar restaurante lá', 52), m('ig:2', true, 'Desculpe, não tenho informações', 51),
    // Silver: cliente falou por último (é "sem resposta", outro fluxo)
    m('ig:3', true, 'Quantos adultos?', 30), m('ig:3', false, 'Dois', 29),
    // Recente demais (menos de 24h)
    m('ig:4', false, 'Quero morar aí', 6), m('ig:4', true, 'Que bom, me conta mais', 5),
    // Antiga demais (mais de 15 dias)
    m('ig:5', false, 'Oi quero saber', 24 * 20), m('ig:5', true, 'Olá', 24 * 20 - 1),
  ];
  const r = extractStalled(msgs, { now, maxDays: 15 });
  assert.deepEqual(r.map((x) => x.jid), ['ig:2']);
  assert.equal(r[0].texts.at(-1), 'Eu só queria saber como está a situação para montar restaurante lá');
  assert.equal(r[0].context.at(-1).role, 'assistant');
  assert.equal(r[0].at, h(52));
});

test('foto ou documento sem legenda chega como aviso para a atendente (foto do RG, meio corpo)', () => {
  const base = (message) => ({ key: { remoteJid: '5511999990000@s.whatsapp.net', id: 'A1', fromMe: false }, message, messageTimestamp: 1700000000, pushName: 'Ana' });
  assert.equal(normalizeMessage(base({ imageMessage: { mimetype: 'image/jpeg' } })).text, '[foto enviada]');
  assert.equal(normalizeMessage(base({ imageMessage: { caption: 'meu RG' } })).text, 'meu RG', 'com legenda vale a legenda');
  assert.equal(normalizeMessage(base({ documentMessage: { fileName: 'rg.pdf' } })).text, '[documento enviado]');
  assert.equal(normalizeMessage(base({ conversation: 'oi' })).text, 'oi');
});
