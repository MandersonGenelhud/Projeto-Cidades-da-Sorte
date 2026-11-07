import test from 'node:test';
import assert from 'node:assert/strict';
import { collectStalled, restartStalled } from '../src/restart.js';
import { moveOldCorretorLeads } from '../src/maintenance.js';
import { OWNER_PAUSE, Agent } from '../src/agent/agent.js';
import { Auth } from '../src/auth.js';
import { Crm } from '../src/crm.js';
import { tempStore } from './helpers.js';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const ago = (h) => new Date(NOW - h * 3_600_000).toISOString();
const conv = (key, msgs, extra = {}) => ({ key, phone: key.replace(/\D/g, '').slice(-12), name: key, messages: msgs.map(([role, h]) => ({ role, content: `${role} ${h}`, at: ago(h) })), updatedAt: ago(msgs.at(-1)[1]), ...extra });

test('classifica o que está parado: esperando, silenciou, reagendado, pausas; ignora fechados, velhos, grupos, bloqueados e quem uma pessoa assumiu', () => {
  const lead = (stage, extra = {}) => ({ stage, ...extra });
  const leads = { 'c-fechado@s.whatsapp.net': lead('ganho'), 'c-perdido@s.whatsapp.net': lead('perdido'), 'c-retorno@s.whatsapp.net': lead('em_contato', { followUpAt: '2026-11-09', followUpReason: 'ver orçamento' }) };
  const convs = [
    conv('55119000000001@s.whatsapp.net', [['assistant', 80], ['user', 30]]), // esperando 30 h
    conv('55119000000002@s.whatsapp.net', [['user', 100], ['assistant', 90]]), // silenciou há 90 h
    conv('55119000000003@s.whatsapp.net', [['user', 20], ['assistant', 10]]), // respondido há 10 h: ainda cedo
    conv('c-retorno@s.whatsapp.net', [['user', 50], ['assistant', 49]]), // retorno combinado venceu
    conv('55119000000005@s.whatsapp.net', [['user', 50]], { handoff: true, handoffReason: OWNER_PAUSE, ownerRepliedAt: NOW - 5 * 3_600_000 }), // pausa antiga: destrava
    conv('55119000000006@s.whatsapp.net', [['user', 5]], { handoff: true, handoffReason: OWNER_PAUSE, ownerRepliedAt: NOW - 20 * 60_000 }), // o dono acabou de falar: deixa
    conv('55119000000007@s.whatsapp.net', [['user', 5]], { handoff: true, handoffReason: 'Conversa do Marcos (pessoal): família' }),
    conv('55119000000008@s.whatsapp.net', [['user', 5]], { handoff: true, handoffReason: 'Assumido pelo painel' }), // pessoa assumiu: não mexe
    conv('c-fechado@s.whatsapp.net', [['user', 30]]), conv('c-perdido@s.whatsapp.net', [['user', 30]]),
    conv('55119000000011@s.whatsapp.net', [['user', 24 * 40]]), // 40 dias: fora do prazo
    conv('1203@g.us', [['user', 30]]), conv('55119000000012@s.whatsapp.net', [['user', 30]], { simulation: true }),
    conv('55119000000013@s.whatsapp.net', [['user', 30]]), // bloqueado
    conv('ig:abc', [['user', 100], ['assistant', 90]]), // Instagram só responde em 24 h: silencioso não entra
  ];
  const r = collectStalled({ conversations: convs, now: NOW, days: 30, leadOf: (c) => leads[c.key] || null, isBlocked: (p) => p.endsWith('0013') });
  const by = Object.fromEntries(r.map((x) => [x.key, x]));
  assert.equal(by['55119000000001@s.whatsapp.net'].kind, 'esperando');
  assert.equal(by['55119000000002@s.whatsapp.net'].kind, 'silenciou');
  assert.ok(!by['55119000000003@s.whatsapp.net']);
  assert.equal(by['c-retorno@s.whatsapp.net'].kind, 'reagendado'); assert.equal(by['c-retorno@s.whatsapp.net'].reason, 'ver orçamento');
  assert.equal(by['55119000000005@s.whatsapp.net'].handoff, 'dono');
  assert.ok(!by['55119000000006@s.whatsapp.net'], 'o dono acabou de responder');
  assert.equal(by['55119000000007@s.whatsapp.net'].handoff, 'marcos');
  assert.ok(!by['55119000000008@s.whatsapp.net']);
  for (const k of ['c-fechado@s.whatsapp.net', 'c-perdido@s.whatsapp.net', '55119000000011@s.whatsapp.net', '1203@g.us', '55119000000012@s.whatsapp.net', '55119000000013@s.whatsapp.net', 'ig:abc']) assert.ok(!by[k], k);
  const auto = collectStalled({ conversations: convs, now: NOW, includeSilent: false, includeMarcos: false, leadOf: () => null, isBlocked: () => false });
  assert.ok(auto.every((x) => x.kind === 'esperando') && !auto.some((x) => x.handoff === 'marcos'), 'o modo automático não escreve para quem parou de responder nem reavalia conversa do Marcos');
});

test('recomeçar: põe cada conversa na fila com o tipo certo, destrava a pausa antiga e o ensaio (dryRun) só conta', () => {
  const store = tempStore();
  const c1 = conv('55119000000001@s.whatsapp.net', [['user', 10], ['assistant', 9], ['user', 8]]);
  const c2 = conv('55119000000002@s.whatsapp.net', [['user', 100], ['assistant', 90]]);
  const c5 = conv('55119000000005@s.whatsapp.net', [['user', 50]], { handoff: true, handoffReason: OWNER_PAUSE, ownerRepliedAt: NOW - 5 * 3_600_000 });
  const c7 = conv('55119000000007@s.whatsapp.net', [['user', 5]], { handoff: true, handoffReason: 'Conversa do Marcos (negociação): combinou valor' });
  store.data.conversations = Object.fromEntries([c1, c2, c5, c7].map((c) => [c.key, c]));
  const calls = [];
  const pending = { queue: [], items: {}, enqueue: (keys) => { calls.push(keys); return { queued: keys.length, blocked: 0, reasons: {} }; } };
  const dry = restartStalled({ store, agent: {}, pending, leadOf: () => null, isBlocked: () => false, now: NOW, dryRun: true });
  assert.equal(dry.total, 4); assert.deepEqual(Object.keys(pending.items), []); assert.equal(calls.length, 0);
  assert.equal(c5.handoff, true, 'o ensaio não mexe em nada');
  const r = restartStalled({ store, agent: {}, pending, leadOf: () => null, isBlocked: () => false, now: NOW });
  assert.deepEqual([r.esperando, r.silenciou, r.pausadasDono, r.pausadasMarcos, r.queued], [3, 1, 1, 1, 4]);
  assert.deepEqual(pending.items['55119000000001@s.whatsapp.net'].texts, ['user 8'], 'só a mensagem que ficou sem resposta');
  assert.equal(pending.items['55119000000002@s.whatsapp.net'].kind, 'retomar');
  assert.ok(pending.items['55119000000002@s.whatsapp.net'].silentDays >= 3);
  assert.equal(c5.handoff, false, 'a pausa antiga do "respondi pelo celular" foi destravada');
  assert.equal(pending.items['55119000000007@s.whatsapp.net'].reTriage, true, 'conversa do Marcos será reavaliada com a regra de venda');
  assert.equal(c7.handoff, true, 'e continua pausada até a IA decidir');
  assert.equal(calls[0].length, 4);
});

test('a IA retoma uma conversa em que o cliente parou: nenhuma mensagem nova "dele" entra na memória e a instrução de retomada vai no prompt', async () => {
  const store = tempStore();
  store.updateSettings({ agent: { enabled: true, audience: 'all', humanize: { enabled: false } } });
  const prompts = [];
  const llm = { configured: true, chat: async ({ messages }) => { prompts.push(messages[0].content); return { content: 'Oi, Ana! Passando para saber se ainda quer seguir com o processo da residência.', tool_calls: [] }; } };
  const agent = new Agent({ store, llm, calendar: null });
  agent.wait = async () => {};
  const c = agent.conversation('5511900000001@s.whatsapp.net');
  agent.remember(c, 'user', 'Quero saber da residência no Paraguai');
  agent.remember(c, 'assistant', 'Claro! Você pretende morar ou investir?');
  const sent = [];
  await agent.handleIncoming({ key: c.key, phone: '5511900000001', name: 'Ana', text: '', resume: '# RETOMADA DO ATENDIMENTO (regra da direção)\nRETOME com UMA mensagem' }, async (t) => { sent.push(t); });
  assert.equal(sent.length >= 1, true);
  assert.match(sent.join(' '), /Passando para saber/);
  assert.equal(c.messages.filter((m) => m.role === 'user').length, 1, 'não inventa mensagem do cliente');
  assert.ok(prompts.some((p) => /RETOMADA DO ATENDIMENTO/.test(p)));
});

test('triagem no modo recomeçar: qualquer serviço da Migra volta para a IA, mesmo com negociação pessoal do Marcos', async () => {
  const store = tempStore();
  const seen = [];
  const llm = { configured: true, chat: async ({ messages }) => { seen.push(messages[0].content); return { content: '{"tipo":"cliente_em_atendimento","responder":true,"motivo":"quer residência","continuidade":"parou no orçamento"}', tool_calls: [] }; } };
  const agent = new Agent({ store, llm, calendar: null });
  const c = agent.conversation('5511900000002@s.whatsapp.net');
  agent.remember(c, 'user', 'e a residência?');
  await agent.triageBacklog(c, ['e a residência?']);
  await agent.triageBacklog(c, ['e a residência?'], { restart: true });
  assert.doesNotMatch(seen[0], /MODO RECOMEÇAR/);
  assert.match(seen[1], /MODO RECOMEÇAR[\s\S]*mesmo que ele já tenha falado pessoalmente/);
});

test('Gabriel → Diego: os atendimentos em aberto passam para o Diego, uma vez, só quando o Diego existe', () => {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const adm = auth.create({ name: 'Marcos', login: 'marcos', password: 'segredo123', role: 'admin' });
  const gab = auth.create({ name: 'Gabriel Souza', login: 'gabriel', password: 'segredo123', role: 'seller', whatsapp: '5545999990003' });
  const crm = new Crm({ store, auth });
  const a = crm.create(adm, { name: 'Cliente A', phone: '5545988880001', ownerId: gab.id });
  const b = crm.create(adm, { name: 'Cliente B', phone: '5545988880002', ownerId: gab.id });
  crm.setStage(adm, crm.byId(b.id), { stage: 'ganho', closedValue: 1000 });
  assert.deepEqual(moveOldCorretorLeads({ store, auth, crm }), { done: false, transferred: 0 }, 'sem o Diego, não faz e tenta depois');
  const diego = auth.create({ name: 'Diego Lima', login: 'diego', password: 'segredo123', role: 'seller', whatsapp: '5545999990004' });
  const r = moveOldCorretorLeads({ store, auth, crm });
  assert.equal(r.done, true); assert.equal(r.transferred, 1);
  assert.equal(crm.byId(a.id).ownerId, diego.id);
  assert.equal(crm.byId(b.id).ownerId, gab.id, 'a venda já fechada continua no nome de quem fechou');
  assert.equal(moveOldCorretorLeads({ store, auth, crm }), null, 'só uma vez');
});
