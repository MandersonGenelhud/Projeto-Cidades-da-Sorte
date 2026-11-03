import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Crm } from '../src/crm.js';
import { Agent } from '../src/agent/agent.js';
import { AutoFollowUps, isAck } from '../src/followups.js';
import { Commitments } from '../src/commitments.js';
import { tempStore } from './helpers.js';

function setup(clock) {
  const store = tempStore();
  store.updateSettings({ agent: { enabled: true, audience: 'all', apiKey: 'x' } });
  const auth = new Auth({ store, dataDir: store.dataDir });
  auth.create({ name: 'Marcos', login: 'marcos', password: 'segredo123', role: 'admin' });
  const crm = new Crm({ store, auth, now: () => clock.now });
  const systems = [];
  const llm = { configured: true, chat: async ({ messages }) => { systems.push(messages[0].content); return { content: 'Oi, Lígia! Peço perdão pelo atraso. Podemos continuar?', tool_calls: [] }; } };
  const agent = new Agent({ store, llm, now: () => clock.now });
  const sent = [];
  const f = new AutoFollowUps({ store, crm, agent, send: async (key, text) => sent.push({ key, text }), now: () => clock.now });
  const c = new Commitments({ store, agent, send: async (key, text) => sent.push({ key, text }), now: () => clock.now });
  agent.scheduleReturn = (conv, args, opts) => f.schedule(conv, args, opts);
  return { store, crm, agent, f, c, sent, systems };
}

test('"ok, até terça às 14h" não cancela o retorno: no horário a atendente chama o cliente', async () => {
  assert.equal(isAck('Ok!\' Obrigada e até terça às 14;00 horas'), true);
  assert.equal(isAck('Amém! Boa noite'), true);
  assert.equal(isAck('Pensei melhor e quero fechar hoje mesmo o pacote Ouro para minha família'), false);
  const clock = { now: new Date(2026, 10, 2, 22, 40) }; // segunda à noite
  const { agent, f, sent, systems } = setup(clock);
  const conv = agent.conversation('5547999000111@s.whatsapp.net');
  conv.phone = '5547999000111'; conv.name = 'Lígia';
  agent.remember(conv, 'user', 'Posso responder na terça?');
  assert.equal((await f.schedule(conv, { data: '2026-11-03', hora: '14:00', motivo: 'pediu para falar na terça' })).ok, true);
  agent.remember(conv, 'assistant', 'Perfeito, Lígia! Já está marcadinho. Até terça às 14h!');
  agent.remember(conv, 'user', 'Ok!! Boa noite!! Deus te abençoe 🙏');
  agent.remember(conv, 'user', "Ok! Obrigada e até terça às 14;00 horas");
  clock.now = new Date(2026, 10, 3, 14, 5);
  assert.equal(await f.run({ wait: async () => {} }), 1, 'mandou mesmo com o cliente tendo respondido depois');
  assert.match(sent[0].text, /Lígia/);
  assert.doesNotMatch(systems.at(-1), /NÃO retornou na hora/, 'só 5 minutos depois: sem desculpas');
});

test('atrasou o retorno: a atendente pede perdão em uma frase e continua o atendimento', async () => {
  const clock = { now: new Date(2026, 10, 2, 22, 40) };
  const { agent, f, sent, systems } = setup(clock);
  const conv = agent.conversation('5547999000111@s.whatsapp.net');
  conv.phone = '5547999000111'; conv.name = 'Lígia';
  agent.remember(conv, 'user', 'Terça às 14h?');
  await f.schedule(conv, { data: '2026-11-03', hora: '14:00', motivo: 'x' });
  clock.now = new Date(2026, 10, 3, 16, 30); // 2h30 depois
  assert.equal(await f.run({ wait: async () => {} }), 1);
  assert.match(systems.at(-1), /NÃO retornou na hora: peça desculpas com humildade/);
  assert.match(systems.at(-1), /dê continuidade ao atendimento/);
  assert.equal(sent.length, 1);
});

test('cliente muda de assunto depois de marcar: a conversa seguiu e o retorno não é feito', async () => {
  const clock = { now: new Date(2026, 10, 2, 22, 40) };
  const { agent, f, sent } = setup(clock);
  const conv = agent.conversation('5547999000111@s.whatsapp.net');
  conv.phone = '5547999000111';
  agent.remember(conv, 'user', 'Terça?');
  await f.schedule(conv, { data: '2026-11-03', hora: '14:00', motivo: 'x' });
  agent.remember(conv, 'user', 'Na verdade resolvi fechar agora, qual a chave Pix para pagar a entrada do pacote Ouro?');
  clock.now = new Date(2026, 10, 3, 14, 10);
  assert.equal(await f.run({ wait: async () => {} }), 0);
  assert.equal(sent.length, 0);
});

test('retornos perdidos (cliente já fechado ou não) são recolocados na fila com desculpas', async () => {
  const clock = { now: new Date(2026, 10, 3, 9, 0) };
  const { crm, f, sent, systems, agent } = setup(clock);
  const admin = { name: 'Marcos', role: 'admin' };
  const mk = (name, phone, stage) => { const l = crm.byId(crm.create(admin, { name, phone }).id); crm.followUp({ name: 'IA', role: 'admin' }, l.id, { date: '2026-11-03', reason: 'combinou terça' }); l.followUpTime = '14:00'; l.stage = stage; return l; };
  const lost = mk('Lígia Cliente', '5547999000111', 'ganho');
  const humano = crm.byId(crm.create(admin, { name: 'Humano', phone: '5547999000222' }).id);
  crm.followUp({ name: 'Camila', role: 'seller' }, humano.id, { date: '2026-11-03', reason: 'eu ligo' });
  humano.followUpAt = null; // se perdeu, mas foi uma pessoa que marcou
  // o retorno se perdeu (limpo sem enviar):
  lost.followUpAt = null; lost.followUpAuto = false;
  assert.equal(f.recoverMissed(), 1, 'só o marcado pela IA volta');
  assert.equal(lost.followUpAt, '2026-11-03');
  assert.equal(lost.followUpAuto, true);
  assert.equal(f.recoverMissed(), 0, 'não recupera duas vezes');
  const conv = agent.conversation('5547999000111@s.whatsapp.net'); conv.phone = '5547999000111';
  lost.followUpKey = conv.key;
  clock.now = new Date(2026, 10, 3, 16, 0);
  assert.equal(await f.run({ wait: async () => {} }), 1, 'cliente (ganho) também recebe');
  assert.match(systems.at(-1), /NÃO retornou na hora: peça desculpas/);
  assert.equal(sent.length, 1);
});

test('horário do calendário: lembra na véspera, chama na hora e pede perdão se atrasou; só no horário comercial', async () => {
  const clock = { now: new Date(2026, 10, 2, 15, 0) };
  const { store, c, sent, systems, agent } = setup(clock);
  store.data.appointments.push({ id: 'a1', status: 'confirmed', date: '2026-11-03', time: '14:00', name: 'Lígia Silva', phone: '5547999000111', service: 'Consultoria' });
  store.data.appointments.push({ id: 'a2', status: 'canceled', date: '2026-11-03', time: '10:00', name: 'X', phone: '5547999000333' });
  assert.equal(await c.tickAppointments(), 1, 'véspera');
  assert.match(sent[0].text, /lembrar do nosso horário amanhã, às 14h/);
  assert.equal(await c.tickAppointments(), 0, 'lembrete uma vez só');
  clock.now = new Date(2026, 10, 3, 7, 0); assert.equal(await c.tickAppointments(), 0, 'fora do horário comercial');
  clock.now = new Date(2026, 10, 3, 14, 2);
  assert.equal(await c.tickAppointments(), 1);
  assert.match(systems.at(-1), /Horário marcado com o cliente \(é agora\)/);
  assert.doesNotMatch(systems.at(-1), /NÃO chamou na hora/);
  assert.equal(await c.tickAppointments(), 0, 'chamado uma vez só');
  // atrasado: sistema ficou fora do ar
  store.data.appointments.push({ id: 'a3', status: 'confirmed', date: '2026-11-03', time: '10:00', name: 'Ana', phone: '5547999000444' });
  clock.now = new Date(2026, 10, 3, 15, 0);
  assert.equal(await c.tickAppointments(), 1);
  assert.match(systems.at(-1), /NÃO chamou na hora combinada: peça desculpas/);
  // antigo demais (mais de 14 dias): não chama
  store.data.appointments.push({ id: 'a4', status: 'confirmed', date: '2026-10-01', time: '10:00', name: 'Velho', phone: '5547999000555' });
  assert.equal(await c.tickAppointments(), 0);
  assert.equal(store.data.appointments.find((a) => a.id === 'a4').contactedAt, 'ignorado');
});
