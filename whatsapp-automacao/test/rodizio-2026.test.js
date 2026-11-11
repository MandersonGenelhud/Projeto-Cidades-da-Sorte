import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Auth } from '../src/auth.js';
import { Crm } from '../src/crm.js';
import { Sectors } from '../src/sectors.js';
import { tempStore } from './helpers.js';

function antigo() {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const mk = (name, login, n, role = 'seller') => auth.get(auth.create({ name, login, password: 'segredo123', role, whatsapp: `59598100000${n}` }).id);
  mk('Marcos Miguel', 'marcos', 1, 'admin'); mk('Diego Corretor', 'diego', 2); mk('Eliezer Silvestre', 'eliezer', 3);
  mk('Gabriel Souza', 'gabriel', 4); mk('Camila Alves', 'camila', 5); mk('Fran Lima', 'fran', 6); mk('Manderson', 'manderson', 7, 'admin');
  store.data.users.find((u) => u.login === 'manderson').receivesLeads = true; // era quem recebia lead sem querer
  store.settings.crm.sectors = { loteamentos: { people: [{ name: 'Diego', whatsapp: '' }] }, documentacao: { people: [{ name: 'Camila', whatsapp: '' }, { name: 'Fran', whatsapp: '' }] }, veiculos: { people: [{ name: 'Eliezer', whatsapp: '' }, { name: 'Marcos', whatsapp: '' }] } };
  store.data.rodizio2026 = false;
  return store;
}
function reabrir(store) {
  store.flush();
  const s2 = new Store(store.dataDir);
  return { store: s2, auth: new Auth({ store: s2, dataDir: s2.dataDir }) };
}

test('rodízio da direção: todos desligados, menos Diego (imóveis) e Eliezer (documentação); Marcos e Gabriel sem área', () => {
  const { store, auth } = reabrir(antigo());
  const u = (l) => auth.users.find((x) => x.login === l);
  assert.equal(u('diego').receivesLeads, true); assert.deepEqual(u('diego').sectors, ['loteamentos']);
  assert.equal(u('eliezer').receivesLeads, true); assert.deepEqual(u('eliezer').sectors, ['documentacao']);
  for (const l of ['marcos', 'gabriel', 'manderson', 'camila', 'fran']) assert.equal(u(l).receivesLeads, false, `${l} fora do rodízio`);
  assert.deepEqual(u('marcos').sectors, []); assert.deepEqual(u('gabriel').sectors, []);
  assert.deepEqual(u('camila').sectors, ['documentacao'], 'quem ligar depois já tem a área de antes');
  const crm = new Crm({ store, auth });
  assert.deepEqual(crm.rotation().map((x) => x.login), ['eliezer'], 'rodízio de documentação: só o Eliezer');
});

test('"Pausar rodízio" também tira a pessoa dos setores; ao ligar, ela volta', () => {
  const { store, auth } = reabrir(antigo());
  const crm = new Crm({ store, auth });
  const sec = new Sectors({ store, crm, auth });
  assert.deepEqual(sec.people('documentacao').map((p) => p.name), ['Eliezer Silvestre']);
  assert.deepEqual(sec.people('loteamentos').map((p) => p.name), ['Diego Corretor']);
  assert.deepEqual(sec.people('veiculos'), [], 'ninguém ligado para veículos ainda');
  auth.update(auth.users.find((x) => x.login === 'camila').id, { receivesLeads: true });
  assert.deepEqual(sec.people('documentacao').map((p) => p.name).sort(), ['Camila Alves', 'Eliezer Silvestre']);
});

test('a migração roda uma vez só: o que a direção ligar depois não é desfeito', () => {
  const a = reabrir(antigo());
  a.auth.update(a.auth.users.find((x) => x.login === 'fran').id, { receivesLeads: true });
  const b = reabrir(a.store);
  assert.equal(b.auth.users.find((x) => x.login === 'fran').receivesLeads, true);
});
