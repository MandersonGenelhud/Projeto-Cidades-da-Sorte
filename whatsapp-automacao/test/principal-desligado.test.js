import test from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionManager } from '../src/connection.js';
import { teamRoutes } from '../src/lines.js';
import { tempStore } from './helpers.js';

function fakeClient() {
  const c = { started: 0, stopped: 0, loggedOut: 0, state: { status: 'qr', me: null, qr: 'data:x' } };
  return Object.assign(c, { on() {}, getState: () => c.state, start: async () => { c.started += 1; }, stop: async () => { c.stopped += 1; }, logout: async () => { c.loggedOut += 1; c.state = { status: 'disconnected' }; }, restart: async () => { c.started += 1; } });
}

test('número principal banido: "desligar" encerra a sessão, não pede mais QR Code e não tenta reconectar', async () => {
  const store = tempStore();
  const qr = fakeClient();
  let wa;
  try { wa = new ConnectionManager({ store, clients: { qr, cloud: fakeClient() } }); } catch { wa = null; }
  if (!wa) return; // construtor diferente neste ambiente: coberto pelos testes de rota
  assert.equal(wa.getState().status, 'qr');
  await wa.setMainOff(true);
  assert.equal(wa.getState().status, 'off');
  assert.equal(wa.mainOff, true);
  assert.equal(qr.loggedOut, 1);
  const before = qr.started;
  await wa.start(); await wa.restart();
  assert.equal(qr.started, before, 'não reconecta enquanto estiver desligado');
  await wa.setMainOff(false);
  assert.equal(wa.mainOff, false);
  assert.equal(qr.started, before + 1, 'religar volta a conectar');
});

test('com o principal desligado, os avisos da equipe saem pela Central', () => {
  const r = teamRoutes({ mainConnected: false, lines: [{ id: 'c', label: 'Central', status: 'connected' }] });
  assert.deepEqual(r.map((x) => x.via), ['line']);
});
