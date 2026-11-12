import test from 'node:test';
import assert from 'node:assert/strict';
import { teamRoutes } from '../src/lines.js';

const L = (id, label, status = 'connected', extra = {}) => ({ id, label, status, ...extra });

test('aviso à equipe sai pela Central, depois pelo número principal; NUNCA pelo número de um vendedor', () => {
  const lines = [L('a', 'Eliezer'), L('c', 'Central Atendimento'), L('d', 'Diego', 'disconnected')];
  const r = teamRoutes({ mainConnected: true, lines });
  assert.deepEqual(r.map((x) => (x.via === 'main' ? 'main' : x.line.id)), ['c', 'main']);
});

test('Central fora do ar: usa o principal; nada conectado: lista vazia (o chamador registra o erro)', () => {
  assert.deepEqual(teamRoutes({ mainConnected: true, lines: [L('c', 'Central', 'disconnected')] }).map((x) => x.via), ['main']);
  assert.deepEqual(teamRoutes({ mainConnected: false, lines: [L('c', 'Central', 'disconnected')] }), []);
});

test('Central reconhecida pela marca "central" ou pelo dono chamado Central', () => {
  const r1 = teamRoutes({ mainConnected: true, lines: [L('x', 'Linha 2', 'connected', { central: true })] });
  assert.equal(r1[0].line.id, 'x');
  const r2 = teamRoutes({ mainConnected: true, lines: [L('y', 'Linha 3', 'connected', { ownerId: 'u1' })], ownerOf: () => ({ name: 'Central Atendimento' }) });
  assert.equal(r2[0].line.id, 'y');
});
