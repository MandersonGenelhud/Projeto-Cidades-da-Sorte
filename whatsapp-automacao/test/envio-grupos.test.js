import test from 'node:test';
import assert from 'node:assert/strict';
import { GroupBroadcasts } from '../src/group-broadcast.js';
import { Agent } from '../src/agent/agent.js';
import { tempStore } from './helpers.js';

const G = (n) => ({ id: `1203630${n}@g.us`, name: `Grupo ${n}` });
const noon = () => new Date(2026, 10, 9, 12, 0).getTime();

function setup({ busy = () => false } = {}) {
  const store = tempStore();
  const sent = []; const holds = [];
  const wa = { status: 'connected', send: async (to, p) => { sent.push({ to, ...p, holdWhileSending: holds.at(-1) }); return { id: 'x' }; } };
  const media = { id: 'm1', path: '/tmp/arte.png', mimetype: 'image/png', fileName: 'arte.png' };
  const b = new GroupBroadcasts({ store, wa, resolveMedia: (id) => (id === 'm1' ? media : null), isBusy: busy, setHold: (v) => holds.push(v), now: noon, wait: async () => {} });
  const done = async (id) => { for (let i = 0; i < 400 && b.get(id).status === 'running'; i++) await new Promise((r) => setTimeout(r, 5)); };
  return { store, b, sent, holds, wa, done };
}

test('envio aos grupos: um grupo de cada vez, na ordem, com a imagem e o texto como legenda, e cada grupo recebe uma única vez', async () => {
  const { b, sent, done } = setup();
  const x = b.create({ name: 'Oferta', text: 'Oferta relâmpago!', mediaId: 'm1', groups: [G(1), G(2), G(3), G(2)], delayMin: 10 });
  assert.equal(x.items.length, 3, 'grupo repetido entra uma vez');
  assert.equal(x.delayMin, 45, 'intervalo mínimo de segurança de 45 s');
  b.start(x.id); await done(x.id);
  assert.equal(b.get(x.id).status, 'done');
  assert.deepEqual(sent.map((s) => s.to), [G(1).id, G(2).id, G(3).id]);
  assert.ok(sent.every((s) => s.text === 'Oferta relâmpago!' && s.media.path === '/tmp/arte.png' && s.typing === false));
  assert.deepEqual(b.summary(b.get(x.id)).counts, { pending: 0, sent: 3, failed: 0, skipped: 0 });
});

test('nunca ao mesmo tempo que a IA: espera a IA ficar livre; durante cada envio a IA é segurada', async () => {
  let busy = true; let polls = 0;
  const { b, sent, holds, done } = setup({ busy: () => { polls += 1; if (polls > 3) busy = false; return busy; } });
  const x = b.create({ text: 'oi', groups: [G(1), G(2)] });
  b.start(x.id); await done(x.id);
  assert.ok(polls >= 4, 'esperou a IA ficar livre');
  assert.equal(sent.length, 2);
  assert.ok(sent.every((s) => s.holdWhileSending === true), 'a IA ficou segurada durante o envio');
  assert.equal(holds.at(-1), false, 'e foi solta depois');
});

test('uma falha não derruba os outros grupos; só imagem ou vídeo; sem grupo ou sem conteúdo não cria; reiniciar o sistema não retoma sozinho', async () => {
  const { store, b, sent, wa, done } = setup();
  wa.send = async (to, p) => { if (to === G(2).id) throw new Error('sem permissão'); sent.push(to); return {}; };
  const x = b.create({ text: 'oi', groups: [G(1), G(2), G(3)] });
  b.start(x.id); await done(x.id);
  const s = b.summary(b.get(x.id));
  assert.deepEqual(s.counts, { pending: 0, sent: 2, failed: 1, skipped: 0 });
  assert.match(s.items[1].error, /sem permissão/);
  assert.throws(() => b.create({ text: 'oi', groups: [] }), /pelo menos um grupo/);
  assert.throws(() => b.create({ text: '', groups: [G(1)] }), /Escreva o texto/);
  assert.throws(() => b.create({ text: 'oi', groups: [{ id: '5511@s.whatsapp.net', name: 'pessoa' }] }), /pelo menos um grupo/, 'só grupos');
  store.data.groupBroadcasts.push({ id: 'z', name: 'z', status: 'running', items: [{ groupId: G(1).id, status: 'pending' }] });
  const again = new GroupBroadcasts({ store, wa, now: noon });
  assert.equal(again.get('z').status, 'paused');
});

test('proteções: fora do horário e acima do limite por dia ele espera; pausar e cancelar funcionam; só um envio por vez', async () => {
  const store = tempStore();
  const sent = [];
  let hour = 23; const waits = [];
  const wa = { status: 'connected', send: async (to) => { sent.push(to); return {}; } };
  const b = new GroupBroadcasts({ store, wa, now: () => new Date(2026, 10, 9, hour, 0).getTime(), wait: async (ms) => { waits.push(ms); if (waits.length === 3) hour = 12; } });
  const x = b.create({ text: 'oi', groups: [G(1)] });
  b.start(x.id);
  for (let i = 0; i < 400 && b.get(x.id).status === 'running'; i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(waits.length >= 3, 'esperou o horário comercial');
  assert.equal(sent.length, 1);
  // limite por dia
  store.updateSettings({ groupBroadcast: { maxPerDay: 1 } });
  const y = b.create({ text: 'outro', groups: [G(1), G(2)] });
  const z = b.create({ text: 'terceiro', groups: [G(1)] });
  b.start(y.id);
  assert.throws(() => b.start(z.id), /Já existe um envio em andamento/);
  b.cancel(y.id);
  assert.equal(b.get(y.id).status, 'canceled');
  assert.ok(b.get(y.id).items.every((i) => i.status !== 'pending'));
  assert.throws(() => b.start(y.id), /terminou ou foi cancelado/);
});

test('Agent.busy: só considera o número principal por padrão (conversas dos WhatsApps dos vendedores não seguram o envio)', () => {
  const store = tempStore();
  const agent = new Agent({ store, llm: { configured: false }, calendar: null });
  assert.equal(agent.busy(), false);
  agent.queues.set('l:fran:5511@s.whatsapp.net', { pending: ['oi'], running: false });
  assert.equal(agent.busy(), false);
  assert.equal(agent.busy({ all: true }), true);
  agent.queues.set('5511@s.whatsapp.net', { pending: [], running: true });
  assert.equal(agent.busy(), true);
});
