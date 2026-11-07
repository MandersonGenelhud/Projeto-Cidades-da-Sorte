import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { isWithinWorkHours, workHourRange, workHoursOf } from '../src/utils.js';
import { profileFor } from '../src/send-profiles.js';
import { AutoReply } from '../src/autoreply.js';
import { Store } from '../src/store.js';
import { tempStore } from './helpers.js';

const at = (day, h, m = 0) => new Date(2026, 10, day, h, m); // 8/11/2026 é domingo

test('horário de trabalho: todos os dias, das 7h às 23h (segunda a segunda)', () => {
  for (const day of [8, 9, 10, 11, 12, 13, 14]) { // domingo a sábado
    assert.equal(isWithinWorkHours(undefined, at(day, 7, 0)), true, `abre às 7h (dia ${day})`);
    assert.equal(isWithinWorkHours(undefined, at(day, 22, 59)), true);
    assert.equal(isWithinWorkHours(undefined, at(day, 23, 0)), false, 'fecha às 23h');
    assert.equal(isWithinWorkHours(undefined, at(day, 6, 59)), false);
    assert.equal(isWithinWorkHours(undefined, at(day, 3, 0)), false);
  }
  assert.equal(isWithinWorkHours({ enabled: false }, at(9, 3, 0)), true, 'desligado = 24 horas');
  assert.deepEqual(workHourRange({}), [7, 23]);
  assert.deepEqual(workHourRange({ workHours: { start: '08:30', end: '22:30' } }), [8, 23]);
  assert.deepEqual(workHoursOf({ days: [] }).days, [0, 1, 2, 3, 4, 5, 6], 'sem dias marcados volta ao padrão');
  assert.equal(isWithinWorkHours({ days: [1, 2, 3, 4, 5] }, at(8, 10, 0)), false, 'quem tira o domingo, perde o domingo');
});

test('fora do horário a IA não responde (a mensagem fica esperando); dentro, responde; aviso opcional uma vez só', async () => {
  const store = tempStore();
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  const sent = [];
  const wa = { send: async (j, p) => { sent.push(p.text); }, isConnected: () => true };
  const agent = { active: true, handleIncoming: async () => {} };
  const ar = new AutoReply({ store, wa, agent });
  const msg = { jid: '5545999990000@s.whatsapp.net', phone: '5545999990000', text: 'Oi, quero morar no Paraguai', name: 'Ana' };
  assert.equal(ar.decide(msg, at(9, 10, 0)).kind, 'agent', 'às 10h responde');
  assert.equal(ar.decide(msg, at(9, 23, 30)).kind, 'workhours', 'às 23h30 não responde');
  assert.equal(ar.decide(msg, at(9, 5, 0)).kind, 'workhours', 'de madrugada também não');
  assert.equal(ar.decide(msg, at(9, 7, 0)).kind, 'agent', 'às 7h volta');
  // Com aviso configurado, avisa uma vez a cada 8 horas.
  store.updateSettings({ agent: { workHours: { message: 'Oi, {primeiro_nome}! Voltamos às 7h.' } } });
  const realNow = Date.now;
  ar.decide = (m) => ({ kind: 'workhours', text: store.settings.agent.workHours.message }); // força o fora do horário no handle
  await ar.handle(msg); await ar.handle(msg);
  assert.equal(sent.length, 1, 'o aviso sai uma vez só');
  assert.match(sent[0], /Voltamos às 7h/);
  Date.now = realNow;
});

test('fila de quem esperou e perfil de envio seguem o horário de trabalho (7h às 23h)', () => {
  const p = profileFor({ agent: {} }, 'principal');
  assert.deepEqual([p.from, p.to], [7, 23]);
  const custom = profileFor({ agent: { workHours: { start: '08:00', end: '20:00' } } }, 'principal');
  assert.deepEqual([custom.from, custom.to], [8, 20]);
});

test('instalação que já rodava (7h às 21h): a migração coloca o horário de 7h às 23h todos os dias, uma vez', () => {
  const store = tempStore();
  store.data.settings.agent.workHours = { enabled: true, days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00' };
  store.data.settings.agent.pendingHours = '7-21';
  store.data.settings.agent.workHours2026 = false;
  store.flush();
  const again = new Store(path.dirname(store.file));
  const a = again.data.settings.agent;
  assert.deepEqual(a.workHours.days, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(a.workHours.start, '07:00'); assert.equal(a.workHours.end, '23:00');
  assert.equal(a.pendingHours, '7-23');
  assert.equal(a.workHours2026, true);
  // Depois disso, o que o painel mudar vale (não volta sozinho).
  a.workHours.end = '22:00'; again.flush();
  assert.equal(new Store(path.dirname(store.file)).data.settings.agent.workHours.end, '22:00');
});
