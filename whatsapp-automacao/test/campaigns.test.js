import test from 'node:test';
import assert from 'node:assert/strict';
import { CampaignRunner } from '../src/campaigns.js';
import { Scheduler, nextRun } from '../src/scheduler.js';
import { FakeWA, tempStore } from './helpers.js';

function setup() {
  const store = tempStore();
  store.data.contacts.push(
    { id: 'a', phone: '5521900000001', name: 'Ana Lima', tags: ['vip'] },
    { id: 'b', phone: '5521900000002', name: 'Bruno', tags: [] },
    { id: 'c', phone: '5521900000003', name: 'Carla', tags: ['vip'] },
  );
  const wa = new FakeWA();
  const runner = new CampaignRunner({ store, wa });
  return { store, wa, runner };
}

const waitFor = async (fn, ms = 5000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
};

test('filtra por etiqueta, personaliza, ignora descadastrados e registra falhas', async () => {
  const { store, wa, runner } = setup();
  store.data.contacts.push({ id: 'd', phone: '5521900000004', name: 'Duda', tags: ['vip'] });
  store.addToBlacklist('5521900000003');
  wa.failFor.add('5521900000004');

  const c = runner.create({ name: 'VIP', message: 'Oi {primeiro_nome}', target: { type: 'tags', tags: ['VIP'] }, delayMin: 0, delayMax: 0, pauseEvery: 0 });
  assert.equal(c.recipients.length, 3);
  c.delayMin = 0; c.delayMax = 0; // sem espera no teste
  runner.start(c.id);
  await waitFor(() => c.status === 'done');

  assert.deepEqual(wa.sent.map((s) => s.text), ['Oi Ana']);
  const byPhone = Object.fromEntries(c.recipients.map((r) => [r.phone, r.status]));
  assert.deepEqual(byPhone, { '5521900000001': 'sent', '5521900000003': 'skipped', '5521900000004': 'failed' });
});

test('pausar interrompe e retomar continua de onde parou', async () => {
  const { wa, runner } = setup();
  const c = runner.create({ message: 'x', target: { type: 'all' }, pauseEvery: 0 });
  c.delayMin = 0.3; c.delayMax = 0.3;
  runner.start(c.id);
  await waitFor(() => wa.sent.length === 1);
  runner.pause(c.id);
  await waitFor(() => runner.activeId === null);
  assert.equal(c.status, 'paused');
  assert.equal(wa.sent.length, 1);

  c.delayMin = 0; c.delayMax = 0;
  runner.start(c.id);
  await waitFor(() => c.status === 'done');
  assert.equal(wa.sent.length, 3);
});

test('não permite duas campanhas ao mesmo tempo e exige destinatários', () => {
  const { runner } = setup();
  const a = runner.create({ message: 'a', target: { type: 'all' } });
  const b = runner.create({ message: 'b', target: { type: 'all' } });
  runner.start(a.id);
  assert.throws(() => runner.start(b.id), /em andamento/);
  runner.cancel(a.id);
  assert.throws(() => runner.create({ message: 'x', target: { type: 'tags', tags: ['nada'] } }), /Nenhum destinatário/);
});

test('agendamento único envia e desativa; recorrente avança a data', async () => {
  const { store, wa, runner } = setup();
  const scheduler = new Scheduler({ store, wa, campaigns: runner });
  const past = new Date(Date.now() - 60_000).toISOString();
  const once = scheduler.save({ name: 'único', message: 'Olá {nome}', runAt: past, target: { type: 'manual', phones: ['21900000002'] } });
  const daily = scheduler.save({ name: 'diário', message: 'Bom dia', runAt: past, repeat: 'daily', target: { type: 'manual', phones: ['21900000001'] } });

  await scheduler.tick();
  assert.deepEqual(wa.sent.map((s) => [s.to, s.text]), [['5521900000002', 'Olá Bruno'], ['5521900000001', 'Bom dia']]);
  assert.equal(store.data.schedules.find((s) => s.id === once.id).enabled, false);
  const d = store.data.schedules.find((s) => s.id === daily.id);
  assert.equal(d.enabled, true);
  assert.ok(new Date(d.runAt) > new Date());
});

test('nextRun', () => {
  const base = new Date(2026, 0, 31, 9, 0);
  assert.equal(nextRun(base, 'daily').getDate(), 1);
  assert.equal(nextRun(base, 'weekly').getDate(), 7);
  assert.equal(nextRun(base, 'none'), null);
});
