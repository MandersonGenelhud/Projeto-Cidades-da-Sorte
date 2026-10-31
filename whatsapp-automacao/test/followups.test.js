import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Crm } from '../src/crm.js';
import { Agent } from '../src/agent/agent.js';
import { AutoFollowUps } from '../src/followups.js';
import { tempStore } from './helpers.js';

function setup(clock) {
  const store = tempStore();
  store.updateSettings({ agent: { enabled: true, audience: 'all', apiKey: 'x' } });
  const auth = new Auth({ store, dataDir: store.dataDir });
  auth.create({ name: 'Marcos', login: 'marcos', password: 'segredo123', role: 'admin' });
  const crm = new Crm({ store, auth, now: () => clock.now });
  const systems = [];
  const llm = { configured: true, chat: async ({ messages }) => { systems.push(messages[0].content); return { content: 'Bom dia, Carla! Hoje é o dia que combinamos. Te mando a ficha para garantir a sua reserva?', tool_calls: [] }; } };
  const agent = new Agent({ store, llm, now: () => clock.now });
  const sent = [];
  const f = new AutoFollowUps({ store, crm, agent, send: async (key, text) => sent.push({ key, text }), now: () => clock.now });
  agent.scheduleReturn = (conv, args, opts) => f.schedule(conv, args, opts);
  return { store, crm, agent, f, sent, systems };
}

test('cliente pede "mais pra frente": vira data marcada e, no dia, a IA retoma sozinha', async () => {
  const clock = { now: new Date(2026, 9, 30, 15, 0) }; // sexta, 30/10
  const { crm, agent, f, sent, systems } = setup(clock);
  const conv = agent.conversation('5521998887777@s.whatsapp.net');
  conv.phone = '5521998887777';
  conv.name = 'Carla';
  agent.remember(conv, 'user', 'Só consigo pagar depois do dia 5, me chama quinta');
  const r = await f.schedule(conv, { data: '2026-11-05', hora: '10:00', motivo: 'recebe o salário dia 5', o_que_falta: 'pagar a entrada' });
  assert.equal(r.ok, true);
  assert.match(r.instrucao, /quinta-feira, dia 05\/11\/2026, às 10h/);
  const lead = crm.findForConversation({ key: conv.key, phone: conv.phone });
  assert.equal(lead.stage, 'aguardando');
  assert.equal(lead.followUpAt, '2026-11-05');
  // Datas inválidas.
  assert.match((await f.schedule(conv, { data: '2026-10-01', motivo: 'x' })).erro, /de hoje em diante/);
  assert.match((await f.schedule(conv, { data: '2028-06-01', motivo: 'x' })).erro, /12 meses/);
  assert.equal((await f.schedule(conv, { data: '2027-03-15', hora: '19:30', motivo: 'daqui a uns meses' })).ok, true, 'até 12 meses vale');
  await f.schedule(conv, { data: '2026-11-05', hora: '10:00', motivo: 'recebe o salário dia 5', o_que_falta: 'pagar a entrada' });
  await f.schedule(conv, { data: '2026-11-05', hora: '10:00', motivo: 'recebe o salário dia 5', o_que_falta: 'pagar a entrada' });

  clock.now = new Date(2026, 10, 5, 9, 30); // antes do horário
  assert.equal(await f.run({ wait: async () => {} }), 0);
  clock.now = new Date(2026, 10, 5, 10, 10);
  assert.equal(await f.run({ wait: async () => {} }), 1);
  assert.equal(sent[0].key, conv.key);
  assert.match(sent[0].text, /ficha/);
  assert.match(systems.at(-1), /Retorno combinado \(é hoje\)/);
  assert.match(systems.at(-1), /pagar a entrada/);
  assert.equal(await f.run({ wait: async () => {} }), 0, 'não manda duas vezes');
});

test('cliente voltou a falar antes da data: não retoma; prompt proíbe encerrar o atendimento', async () => {
  const clock = { now: new Date(2026, 9, 30, 15, 0) };
  const { agent, f, sent, systems } = setup(clock);
  const conv = agent.conversation('5521911112222@s.whatsapp.net');
  conv.phone = '5521911112222';
  agent.remember(conv, 'user', 'Vou pensar');
  await f.schedule(conv, { data: '2026-11-02', hora: '14:00', motivo: 'vai pensar' });
  clock.now = new Date(2026, 9, 31, 11, 0);
  agent.remember(conv, 'user', 'Pensei, quero fechar!');
  await agent.think(conv);
  assert.match(systems[0], /Nunca encerre o atendimento/);
  assert.match(systems[0], /Nunca deixe a data em aberto/);
  clock.now = new Date(2026, 10, 2, 15, 0);
  assert.equal(await f.run({ wait: async () => {} }), 0);
  assert.equal(sent.length, 0);
});

test('retomada antecipada: a IA chama quem marcou para o futuro, uma vez por data, e pula quem não dá', async () => {
  const clock = { now: new Date(2026, 9, 31, 10, 0) }; // sábado, 31/10, 10h
  const { crm, agent, f, sent, systems } = setup(clock);
  const admin = { name: 'Marcos', role: 'admin' };
  const mk = (name, phone, date) => {
    const l = crm.byId(crm.create(admin, { name, phone }).id);
    crm.followUp(admin, l.id, { date, reason: 'quer começar ano que vem' });
    return l;
  };
  const carla = mk('Carla', '5521998887777', '2027-02-10');
  const conv = agent.conversation('5521998887777@s.whatsapp.net');
  conv.phone = '5521998887777';
  carla.conversationKey = conv.key;
  const joao = mk('João', '5545988881111', '2026-12-15'); // sem conversa ainda: cria pelo telefone
  const ana = mk('Ana', '5545988882222', '2027-01-20');
  const anaConv = agent.conversation('5545988882222@s.whatsapp.net');
  anaConv.handoff = true; // um atendente assumiu
  ana.conversationKey = anaConv.key;
  mk('Hoje', '5545988883333', '2026-10-31'); // retorno é hoje: fica com a rotina do dia
  const sem = crm.byId(crm.create(admin, { name: 'Sem telefone', instagram: 'semtel' }).id);
  crm.followUp(admin, sem.id, { date: '2027-03-01', reason: 'x' });

  assert.equal(f.futureList({ minDays: 31 }).length, 4, 'mais de 30 dias: Carla, Ana, João e o do Instagram');
  const out = await f.reconfirm({ wait: async () => {} });
  assert.deepEqual(out.sent.map((x) => x.name).sort(), ['Carla', 'João']);
  assert.deepEqual(out.skipped.map((x) => x.reason).sort(), ['sem WhatsApp cadastrado', 'um atendente assumiu a conversa']);
  assert.equal(sent.length, 2);
  assert.match(systems.at(-1), /Retomada antecipada/);
  assert.match(systems.find((s) => s.includes('10/02/2027')), /confirmar o que ficou combinado para 10\/02\/2027/);
  assert.equal(carla.reconfirmedFor, '2027-02-10');
  assert.match(carla.timeline.at(-1).text, /Retomada antecipada pela IA/);
  // Não repete para a mesma data; o retorno do dia combinado continua marcado.
  assert.equal((await f.reconfirm({ wait: async () => {} })).sent.length, 0);
  assert.equal(carla.followUpAt, '2027-02-10');
  // Fora do horário comercial, nada sai.
  clock.now = new Date(2026, 9, 31, 22, 0);
  carla.reconfirmedFor = null;
  assert.match((await f.reconfirm({ wait: async () => {} })).erro, /Fora do horário/);
});

test('retorno pedido pelo cliente e lido pela IA (à noite, mês que vem): a atendente retoma sozinha e a equipe não é incomodada', async () => {
  const clock = { now: new Date(2026, 9, 31, 7, 19) }; // sábado, 07:19
  const { crm, agent, f, sent } = setup(clock);
  const key = '554491433691@s.whatsapp.net';
  const conv = agent.conversation(key);
  conv.phone = '554491433691';
  conv.name = 'Vinicius Figueiredo';
  agent.remember(conv, 'user', 'Sou adventista, posso responder à noite?');
  const lead = crm.byId(crm.ensureFromConversation({ key, phone: conv.phone, name: conv.name, channel: 'whatsapp' }).id);
  // A IA leu a conversa: "hoje à noite" (mesmo dia, horário que ainda não passou).
  crm.applyAi(lead, { retorno_data: '2026-10-31', retorno_hora: '19:30', motivo_espera: 'Cliente é adventista e pediu para responder à noite' });
  const today = crm.today();
  assert.equal(lead.followUpAuto, true, 'marcado pela IA: a atendente retoma');
  assert.equal(lead.followUpTime, '19:30');
  assert.equal(lead.followUpAt, today === '2026-10-31' ? '2026-10-31' : lead.followUpAt);
  // Fora de hora ou antes das 19:30: nada sai. O aviso para a equipe também não.
  lead.followUpAt = '2026-10-31';
  assert.equal(crm.dueToNotify().filter((l) => l.id === lead.id).length, 0, 'a equipe não é avisada: a atendente cuida');
  assert.equal(await f.run({ wait: async () => {} }), 0);
  // 19:40: a atendente retoma, e o retorno sai da agenda.
  clock.now = new Date(2026, 9, 31, 19, 40);
  assert.equal(await f.run({ wait: async () => {} }), 1);
  assert.equal(sent[0].key, key);
  assert.equal(lead.followUpAt, null);
  assert.equal(lead.stage, 'em_contato');
  assert.equal(await f.run({ wait: async () => {} }), 0, 'uma vez só');
  // Retorno para daqui 5 meses também vale, e retorno marcado por uma pessoa continua com a pessoa.
  const far = crm.byId(crm.create({ name: 'Marcos', role: 'admin' }, { name: 'Longe', phone: '5545988880000' }).id);
  crm.followUp({ name: 'IA', role: 'admin' }, far.id, { date: '2027-03-31', reason: 'só daqui 5 meses' });
  assert.equal(far.followUpAuto, true);
  const human = crm.byId(crm.create({ name: 'Marcos', role: 'admin' }, { name: 'Humano', phone: '5545988881111' }).id);
  crm.followUp({ name: 'Camila', role: 'seller' }, human.id, { date: '2026-10-31', reason: 'eu ligo' });
  assert.equal(human.followUpAuto, false);
  assert.equal(crm.dueToNotify().some((l) => l.id === human.id), true, 'a equipe segue sendo avisada nos retornos que ela mesma marcou');
});

test('retomada automática que não dá certo (um atendente assumiu ou não há WhatsApp) avisa a equipe', async () => {
  const clock = { now: new Date(2026, 10, 5, 11, 0) };
  const { crm, agent, f, sent } = setup(clock);
  const mkAuto = (name, phone) => {
    const l = crm.byId(crm.create({ name: 'Marcos', role: 'admin' }, { name, phone }).id);
    crm.followUp({ name: 'IA', role: 'admin' }, l.id, { date: '2026-11-05', reason: 'à noite' });
    l.followUpTime = '10:00';
    return l;
  };
  const taken = mkAuto('Assumido', '5545988882222');
  agent.conversation('5545988882222@s.whatsapp.net').handoff = true;
  taken.conversationKey = '5545988882222@s.whatsapp.net';
  const noPhone = crm.byId(crm.create({ name: 'Marcos', role: 'admin' }, { name: 'Só Instagram', instagram: 'so.insta' }).id);
  crm.followUp({ name: 'IA', role: 'admin' }, noPhone.id, { date: '2026-11-05', reason: 'x' });
  noPhone.followUpTime = '10:00';
  await f.run({ wait: async () => {} });
  assert.equal(sent.length, 0);
  const notify = crm.dueToNotify().map((l) => l.name).sort();
  assert.deepEqual(notify, ['Assumido', 'Só Instagram'], 'quem a atendente não conseguiu retomar volta para a equipe');
});
