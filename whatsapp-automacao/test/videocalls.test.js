import test from 'node:test';
import assert from 'node:assert/strict';
import { VideoCalls, priceSeen } from '../src/videocalls.js';
import { Agent } from '../src/agent/agent.js';
import { LocalCalendar } from '../src/agent/calendar.js';
import { presetSettings } from '../src/agent/presets.js';
import { TOOL_DEFINITIONS, runTool } from '../src/agent/tools.js';
import { tempStore } from './helpers.js';

// Segunda-feira, 26/10/2026, 20:00 (depois do expediente: "amanhã" é terça, 27/10)
const NOW = new Date(2026, 9, 26, 20, 0);
function setup() {
  const store = tempStore();
  const users = [{ id: 'eli1', name: 'Eliezer Souza', role: 'seller', active: true }, { id: 'ana1', name: 'Ana', role: 'seller', active: true }];
  const auth = { users, get: (id) => users.find((u) => u.id === id) };
  const vc = new VideoCalls({ store, auth, now: () => NOW });
  return { store, auth, vc };
}

test('videochamadas: o Eliezer já nasce como quem atende; domingo fechado e sábado só de manhã', () => {
  const { vc } = setup();
  assert.deepEqual(vc.hosts().map((h) => h.name), ['Eliezer Souza']);
  assert.equal(vc.slots('2026-11-01').closed, true, 'domingo');
  assert.deepEqual(vc.slots('2026-10-31').slots, ['09:00', '10:00', '11:00'], 'sábado só até o meio-dia');
  assert.ok(vc.slots('2026-10-27').slots.includes('14:00'));
});

test('videochamadas: horários espaçados, nunca dois juntos e remarcar troca a anterior', () => {
  const { vc } = setup();
  vc.setConfig({ gapMin: 90, durationMin: 40 });
  const day = '2026-10-27';
  const before = vc.slots(day).slots;
  assert.deepEqual(before.slice(0, 3), ['09:00', '10:30', '14:00']);
  vc.book({ date: day, time: '09:00', name: 'A', phone: '1' });
  assert.ok(!vc.slots(day).slots.includes('09:00'));
  assert.throws(() => vc.book({ date: day, time: '09:00', name: 'B', phone: '2' }), /não está livre/);
  const b1 = vc.book({ date: day, time: '10:30', name: 'C', phone: '3' });
  assert.equal(b1.hostName, 'Eliezer Souza');
  const b2 = vc.book({ date: day, time: '14:00', name: 'C', phone: '3' });
  assert.equal(vc.forPhone('3').length, 1);
  assert.equal(vc.forPhone('3')[0].id, b2.id, 'a nova substitui a anterior');
  // simulação não grava
  const sim = vc.book({ date: '2026-10-28', time: '09:00', name: 'S', phone: '9' }, { dryRun: true });
  assert.equal(sim.dryRun, true);
  assert.equal(vc.forPhone('9').length, 0);
});

test('videochamadas: quem atende avisa que amanhã não dá e a IA não marca; os próximos dias seguem livres', () => {
  const { vc } = setup();
  vc.book({ date: '2026-10-27', time: '09:00', name: 'A', phone: '1' });
  vc.setMine('eli1', { tomorrowOff: true });
  assert.equal(vc.slots('2026-10-27').closed, true);
  assert.equal(vc.needsReschedule().length, 1, 'quem já estava marcado precisa remarcar');
  const n = vc.nextDays();
  assert.equal(n.dias[0].data, '2026-10-28');
  assert.match(n.primeiroDiaSemAtendimento.motivo, /ninguém disponível/);
  vc.setMine('eli1', { clearDate: '2026-10-27' });
  assert.ok(vc.slots('2026-10-27').slots.length);
  vc.setMine('eli1', { active: false });
  assert.equal(vc.slots('2026-10-28').closed, true, 'desligado: nada é marcado');
  assert.throws(() => vc.setMine('ana1', { active: true }), /lista/);
});

test('videochamadas: o administrador cadastra outra pessoa e as regras são validadas', () => {
  const { vc } = setup();
  vc.setHost('ana1', true);
  vc.setMine('eli1', { tomorrowOff: true });
  assert.ok(vc.slots('2026-10-27').slots.length, 'com outra pessoa disponível, o dia segue aberto');
  assert.equal(vc.book({ date: '2026-10-27', time: '09:00', name: 'X', phone: '5' }).hostName, 'Ana');
  assert.throws(() => vc.setConfig({ gapMin: 30, durationMin: 40 }), /menor/);
  assert.throws(() => vc.setConfig({ meetLink: 'javascript:alert(1)' }), /https/);
  assert.throws(() => vc.setConfig({ hours: { 1: 'qualquer coisa' } }), /inválido/);
  assert.equal(vc.setConfig({ meetLink: 'https://meet.google.com/abc-defg-hij' }).meetLink, 'https://meet.google.com/abc-defg-hij');
  assert.throws(() => vc.setHost('naoexiste', true), /não encontrado/);
});

test('IA: regra do marido/esposa no texto, ferramentas só com a agenda ligada', async () => {
  assert.ok(TOOL_DEFINITIONS.some((t) => t.function.name === 'horarios_videochamada'));
  assert.ok(TOOL_DEFINITIONS.some((t) => t.function.name === 'agendar_videochamada'));
  assert.match((await runTool('agendar_videochamada', {}, {})).erro, /indispon/i);
  let got;
  await runTool('horarios_videochamada', { a_partir_de: '2026-10-27' }, { onVideoSlots: async (a) => { got = a; return { ok: true }; } });
  assert.equal(got.a_partir_de, '2026-10-27');

  const store = tempStore();
  store.updateSettings(presetSettings('clinica-sorriso'));
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  const T = new Date(2026, 9, 26, 9, 5);
  let system = ''; let tools = [];
  const llm = { configured: true, async chat({ messages, tools: t }) { system = messages[0].content; tools = t.map((x) => x.function.name); return { content: 'ok', tool_calls: [] }; } };
  const agent = new Agent({ store, llm, calendar: new LocalCalendar({ store, getConfig: () => store.settings.agenda, now: () => T }), now: () => T });
  await agent.handleIncoming({ key: 'k1', phone: '5511999990001', name: 'Rita', text: 'oi' }, async () => {});
  assert.doesNotMatch(system, /Videochamada quando o cliente/);
  assert.ok(!tools.includes('agendar_videochamada'));
  agent.videoSlots = async () => ({ ok: true });
  agent.videoBook = async () => ({ ok: true });
  agent.videoInfo = () => 'Quem faz as videochamadas: Eliezer.';
  await agent.handleIncoming({ key: 'k2', phone: '5511999990002', name: 'Rita', text: 'eu e meu marido queremos' }, async () => {});
  assert.match(system, /Videochamada quando o cliente precisa falar com marido, esposa ou família/);
  assert.match(system, /se for UMA pessoa só, NÃO faça a pergunta/);
  assert.match(system, /40 minutos/);
  assert.match(system, /de manhã ou de tarde/);
  assert.match(system, /nunca o Marcos/);
  assert.ok(tools.includes('horarios_videochamada') && tools.includes('agendar_videochamada'));
});

test('videochamada só para quem tem condições: regra no texto, campos obrigatórios e trava de valor', () => {
  const tool = TOOL_DEFINITIONS.find((t) => t.function.name === 'agendar_videochamada').function;
  assert.deepEqual(tool.parameters.required.slice(-2), ['valor_apresentado', 'tem_condicoes']);
  assert.equal(priceSeen({ messages: [{ role: 'user', content: 'quanto custa?' }] }), false);
  assert.equal(priceSeen({ messages: [{ role: 'assistant', content: 'Olá! Posso te ajudar?' }] }), false);
  assert.equal(priceSeen({ messages: [{ role: 'assistant', content: 'O pacote Ouro é R$ 12.997,00.' }] }), true);
  assert.equal(priceSeen({ messages: [{ role: 'assistant', content: 'Fica em 2 mil dólares.' }] }), true);
  assert.equal(priceSeen({ messages: [{ role: 'user', content: 'tenho R$ 5.000' }] }), false, 'valor dito só pelo cliente não conta');
});

test('videochamada: o texto da IA exige apresentar o valor e checar condições antes de convidar', async () => {
  const store = tempStore();
  store.updateSettings(presetSettings('clinica-sorriso'));
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  const T = new Date(2026, 9, 26, 9, 5);
  let system = '';
  const llm = { configured: true, async chat({ messages }) { system = messages[0].content; return { content: 'ok', tool_calls: [] }; } };
  const agent = new Agent({ store, llm, calendar: new LocalCalendar({ store, getConfig: () => store.settings.agenda, now: () => T }), now: () => T });
  agent.videoSlots = async () => ({ ok: true }); agent.videoBook = async () => ({ ok: true });
  await agent.handleIncoming({ key: 'k3', phone: '5511999990003', name: 'Rita', text: 'oi' }, async () => {});
  assert.match(system, /NÃO é para todo mundo/);
  assert.match(system, /TEM CONDIÇÕES FINANCEIRAS/);
  assert.match(system, /Como a nossa demanda está alta/);
  assert.match(system, /Faz sentido para você investir agora, ou prefere não agendar e tirar as dúvidas por aqui mesmo/);
  assert.match(system, /Mais alguma dúvida\?/);
  assert.match(system, /sem tentar prolongar a conversa/);
  assert.match(system, /NÃO ofereça videochamada, NÃO use horarios_videochamada/);
  assert.match(system, /nunca humilhe/);
});

test('videochamada paga: o horário fica reservado esperando o pagamento, libera se não pagar e só confirma depois de pago', () => {
  let now = new Date(2026, 9, 26, 20, 0);
  const store = tempStore();
  const users = [{ id: 'eli1', name: 'Eliezer Souza', role: 'seller', active: true }];
  const vc = new VideoCalls({ store, auth: { users, get: (id) => users.find((u) => u.id === id) }, now: () => now });
  assert.equal(vc.config.fee, 200, 'padrão R$ 200');
  assert.equal(vc.setConfig({ fee: 300, holdMin: 60 }).fee, 300);
  assert.throws(() => vc.setConfig({ fee: 99999 }), /fee/);
  vc.setConfig({ fee: 200 });
  const day = '2026-10-27';
  const b = vc.book({ date: day, time: '09:00', name: 'Carla', phone: '55119', pending: true });
  assert.equal(b.status, 'aguardando_pagamento');
  assert.ok(!vc.slots(day).slots.includes('09:00'), 'reservado enquanto espera o pagamento');
  assert.equal(vc.upcoming().length, 0, 'ainda não é uma videochamada confirmada');
  // prazo passou sem pagar: o horário volta
  now = new Date(2026, 9, 26, 23, 30);
  assert.ok(vc.slots(day).slots.includes('09:00'));
  assert.equal(vc.expirePending(), 1);
  // pagou dentro do prazo
  now = new Date(2026, 9, 26, 20, 0);
  const c = vc.book({ date: day, time: '10:00', name: 'Rita', phone: '55120', pending: true });
  const ok = vc.confirmPaid(c.id);
  assert.equal(ok.status, 'confirmed');
  assert.equal(vc.upcoming().length, 1);
  // pagou depois de expirar e outra pessoa já ocupou: não confirma sozinho
  const d = vc.book({ date: day, time: '14:00', name: 'Ana', phone: '55121', pending: true });
  now = new Date(2026, 9, 27, 0, 30); vc.expirePending();
  now = new Date(2026, 9, 26, 20, 0);
  vc.book({ date: day, time: '14:00', name: 'Outro', phone: '55122' });
  assert.equal(vc.confirmPaid(d.id).status, 'pago_sem_horario');
});

test('regra de pagamento antes: a IA explica com educação, sem aceitar pagar no dia, e traz os valores novos', async () => {
  const store = tempStore();
  store.updateSettings(presetSettings('clinica-sorriso'));
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  const T = new Date(2026, 9, 26, 9, 5);
  let system = '';
  const llm = { configured: true, async chat({ messages }) { system = messages[0].content; return { content: 'ok', tool_calls: [] }; } };
  const agent = new Agent({ store, llm, calendar: new LocalCalendar({ store, getConfig: () => store.settings.agenda, now: () => T }), now: () => T });
  agent.pricingInfo = () => 'Valores vigentes: visita R$ 250,00; Marcos 400; videochamada R$ 200,00.';
  await agent.handleIncoming({ key: 'k9', phone: '5511999990009', name: 'Rita', text: 'oi' }, async () => {});
  assert.match(system, /Atendimento presencial, com o Marcos e videochamada/);
  assert.match(system, /SEMPRE pagos ANTES/);
  assert.match(system, /só é confirmado depois do pagamento e do envio do comprovante/);
  assert.match(system, /Não conseguimos receber no dia/);
  assert.match(system, /sem fazer o cliente se sentir ofendido/);
  assert.match(system, /Nunca aceite "pago no dia"/);
  assert.match(system, /videochamada R\$ 200,00/);
});
