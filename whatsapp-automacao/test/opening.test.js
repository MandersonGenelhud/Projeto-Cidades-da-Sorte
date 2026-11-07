import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpening, wantsOpening, greetingOf, DEFAULT_OPENING } from '../src/opening.js';
import { PendingInbox } from '../src/pending.js';
import { Agent } from '../src/agent/agent.js';
import { AutoReply } from '../src/autoreply.js';
import { FakeWA, tempStore } from './helpers.js';

const at = (h, m = 0) => new Date(2026, 10, 9, h, m);

test('mensagem de retorno: saudação do horário, nome, agradece, demanda alta, imprevistos, continuidade e Migra; NUNCA pede desculpas', () => {
  const t = buildOpening({ name: 'Adriano Souza', date: '2026-11-06', now: at(8) });
  assert.match(t, /^Bom dia, Adriano!/);
  assert.match(t, /Agradecemos muito por aguardar/);
  assert.match(t, /demanda está alta, mas estamos atendendo todos os clientes/);
  assert.match(t, /Ficou combinado de falarmos no dia 06\/11\/2026, mas acabaram ocorrendo alguns imprevistos/);
  assert.match(t, /dar continuidade ao seu atendimento/);
  assert.match(t, /melhor assessoria que hoje existe na fronteira: a Migra/);
  assert.doesNotMatch(t, /desculp|perd[aã]o|lament/i);
  assert.match(buildOpening({ name: 'Ana', now: at(15) }), /^Boa tarde, Ana!/);
  assert.match(buildOpening({ name: 'Ana', now: at(21) }), /^Boa noite, Ana!/);
  assert.equal(greetingOf(at(11, 59)), 'Bom dia');
});

test('sem data combinada não afirma que "ficou combinado"; nome que é número ou @ some; texto da direção pode ser trocado', () => {
  const t = buildOpening({ name: '+5545999990000', now: at(8) });
  assert.match(t, /^Bom dia! Agradecemos/);
  assert.doesNotMatch(t, /Ficou combinado/);
  assert.match(t, /retorno acabou ficando pendente por alguns imprevistos/);
  const custom = buildOpening({ name: 'Bia', date: '2026-11-06', now: at(8), cfg: { template: '{saudacao}, {nome}! Voltamos no dia {data}.' } });
  assert.equal(custom, 'Bom dia, Bia! Voltamos no dia 06/11/2026.');
  assert.ok(DEFAULT_OPENING.length < 600);
});

test('quando enviar: quem esperou 6 horas ou mais, ou veio do "recomeçar"; não repete em 7 dias; pode desligar', () => {
  const now = Date.now();
  assert.equal(wantsOpening({ item: { at: now - 7 * 3_600_000 }, now }), true);
  assert.equal(wantsOpening({ item: { at: now - 2 * 3_600_000 }, now }), false, 'quem acabou de escrever é respondido direto, sem o texto de retorno');
  assert.equal(wantsOpening({ item: { at: now - 60_000, restart: true }, now }), true);
  assert.equal(wantsOpening({ item: { at: now - 9 * 3_600_000 }, conv: { openingSentAt: now - 2 * 86_400_000 }, now }), false);
  assert.equal(wantsOpening({ item: { at: now - 9 * 3_600_000 }, conv: { openingSentAt: now - 8 * 86_400_000 }, now }), true);
  assert.equal(wantsOpening({ item: { at: now - 9 * 3_600_000 }, now, cfg: { enabled: false } }), false);
});

test('na fila: quem esperou recebe PRIMEIRO a mensagem de retorno (texto fixo) e depois a IA responde sem repetir agradecimento; um só retorno por conversa', async () => {
  const store = tempStore();
  store.updateSettings({ agent: { enabled: true, audience: 'all', triagePending: false, autoAnswerPending: false, humanize: { enabled: false } } });
  const prompts = [];
  const llm = { configured: true, chat: async ({ messages }) => { prompts.push(messages[0].content); return { content: 'Claro! Para a residência, você pretende morar ou investir?', tool_calls: [] }; } };
  const agent = new Agent({ store, llm, calendar: null });
  agent.wait = async () => {};
  const wa = new FakeWA();
  wa.isConnected = () => true;
  const autoReply = new AutoReply({ store, wa, agent });
  const inbox = new PendingInbox({ store, agent, wa, autoReply, delay: [0, 0], careful: false });
  wa.send = async (to, p) => { wa.sent.push({ to, ...p }); inbox.resolve(to); return { jid: to }; };
  const jid = '595981000001@s.whatsapp.net';
  inbox.items[jid] = { jid, phone: '595981000001', name: 'Adriano', texts: ['Bom dia, quero saber da residência'], at: Date.now() - 10 * 3_600_000, channel: 'whatsapp', scheduledFor: '2026-11-06' };
  inbox.enqueue([jid]);
  const end = Date.now() + 4000;
  while ((inbox.running || wa.sent.length < 2) && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  assert.equal(wa.sent.length >= 2, true);
  assert.match(wa.sent[0].text, /Agradecemos muito por aguardar/);
  assert.match(wa.sent[0].text, /Ficou combinado de falarmos no dia 06\/11\/2026/);
  assert.doesNotMatch(wa.sent[1].text, /Agradecemos|desculp/i, 'a IA segue direto ao assunto');
  assert.ok(prompts.some((p) => /RETORNO JÁ ENVIADO/.test(p)));
  assert.ok(!prompts.some((p) => /Comece com a saudação de agora e agradeça/.test(p)), 'e o aviso antigo de "agradeça por aguardar" não entra junto');
  const c = agent.conversation(jid, { create: false });
  assert.ok(c.openingSentAt, 'ficou marcado: não manda de novo');
  // Segundo pedido na mesma semana: sem novo retorno.
  inbox.items[jid] = { jid, phone: '595981000001', name: 'Adriano', texts: ['e então?'], at: Date.now() - 10 * 3_600_000, channel: 'whatsapp' };
  const before = wa.sent.length;
  inbox.enqueue([jid]);
  const end2 = Date.now() + 3000;
  while ((inbox.running || wa.sent.length === before) && Date.now() < end2) await new Promise((r) => setTimeout(r, 20));
  assert.ok(!wa.sent.slice(before).some((m) => /Agradecemos muito/.test(m.text)));
});
