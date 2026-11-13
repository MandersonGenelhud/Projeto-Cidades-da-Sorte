import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Maria } from '../src/maria.js';
import { tempStore } from './helpers.js';

test('Maria: aviso ao Marcos vai também, como cópia, para o Manderson', async () => {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  auth.create({ name: 'Marcos Miguel', login: 'marcos', password: 'segredo123', role: 'admin', whatsapp: '5545999990001' });
  const sent = [];
  const maria = new Maria({ store, auth, sales: {}, customers: {}, cash: {}, send: async (j, p) => sent.push({ j, t: p.text }), lineName: () => 'Maria', marcosPhone: () => '5545999990001', copyPhones: () => ['5569993051671'], audit() {}, log() {} });
  await maria.notifyOwner('Fulano pediu para excluir um contrato');
  await new Promise((r) => setTimeout(r, 10));
  const copia = sent.find((x) => x.j.startsWith('5569993051671'));
  assert.ok(copia, 'o Manderson recebeu');
  assert.match(copia.t, /Cópia do aviso ao Marcos[\s\S]*excluir um contrato/);
});

test('sem número de cópia, só o Marcos recebe (e a cópia nunca repete o próprio Marcos)', async () => {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const sent = [];
  const maria = new Maria({ store, auth, sales: {}, customers: {}, cash: {}, send: async (j) => sent.push(j), lineName: () => 'Maria', marcosPhone: () => '5545999990001', copyPhones: () => ['5545999990001'], audit() {}, log() {} });
  await maria.notifyOwner('teste');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(sent.length, 1);
});
