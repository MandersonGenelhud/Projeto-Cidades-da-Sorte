import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Personal } from '../src/personal.js';
import { Ana } from '../src/ana.js';
import { Family } from '../src/ana-family.js';
import { tempStore } from './helpers.js';

function setup() {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const now = () => new Date(2026, 10, 11, 10, 0, 0);
  const mk = (name, login, n, role) => auth.get(auth.create({ name, login, password: 'segredo123', role, whatsapp: `59598100000${n}` }).id);
  const marcos = mk('Marcos Miguel', 'marcos', 1, 'admin'); const silvani = mk('Silvani Miguel', 'silvani', 2, 'seller');
  const manderson = mk('Manderson G', 'manderson', 3, 'admin'); const eliezer = mk('Eliezer Silvestre', 'eliezer', 4, 'seller');
  const personal = new Personal({ store, now });
  const family = new Family({ store, auth });
  const sent = [];
  const ana = new Ana({ store, auth, personal, family, now, notify: async (id, t) => { sent.push({ id, t }); return true; } });
  return { ana, personal, family, marcos, silvani, manderson, eliezer, sent, store, auth };
}
const txt = (r) => String(r.text || r);

test('Marcos e Silvani: mesma Ana, mesma pasta (agenda e anotações dos dois no mesmo lugar)', async () => {
  const { ana, family, marcos, silvani, manderson } = setup();
  family.addJoint({ userId: silvani.id, withUserId: marcos.id });
  assert.equal(ana.allowed(silvani), true, 'quem divide a pasta pode usar a Ana');
  await ana.process(silvani, 'anote que o dentista do Pedro é a Dra. Flávia', {});
  const r = await ana.process(marcos, 'o que eu anotei sobre dentista?', {});
  assert.match(txt(r), /Dra\. Flávia/, 'o Marcos enxerga o que a Silvani anotou');
  const m = await ana.process(manderson, 'o que eu anotei sobre dentista?', {});
  assert.doesNotMatch(txt(m), /Flávia/, 'o Manderson tem pasta separada');
});

test('ao dividir, o que a Silvani já tinha é juntado na pasta comum e nada se perde', async () => {
  const { ana, family, personal, marcos, silvani } = setup();
  await ana.process(silvani, 'anote que o aniversário da vó é em 3 de maio', {});
  await ana.process(marcos, 'anote que o contador é o Sr. Paulo', {});
  family.addJoint({ userId: silvani.id, withUserId: marcos.id }, (a, b) => personal.mergeBox(a, b));
  const r = await ana.process(marcos, 'minhas anotações', {});
  assert.match(txt(r), /aniversário da vó/); assert.match(txt(r), /Sr\. Paulo/);
});

test('regras da divisão: sem WhatsApp, repetida ou em cadeia é recusada', () => {
  const { family, marcos, silvani, manderson, store, auth } = setup();
  const sem = auth.get(auth.create({ name: 'Sem Zap', login: 'semzap', password: 'segredo123', role: 'seller' }).id);
  assert.throws(() => family.addJoint({ userId: sem.id, withUserId: marcos.id }), /sem WhatsApp/);
  family.addJoint({ userId: silvani.id, withUserId: marcos.id });
  assert.throws(() => family.addJoint({ userId: silvani.id, withUserId: manderson.id }), /já divide/);
  assert.throws(() => family.addJoint({ userId: manderson.id, withUserId: silvani.id }), /já usa a pasta de outra/);
  assert.throws(() => family.addJoint({ userId: marcos.id, withUserId: manderson.id }), /já é dona/);
  family.removeJoint(silvani.id);
  assert.equal(family.ownerOf(silvani.id), silvani.id);
  void store;
});

test('lembrete e resumo da manhã chegam aos dois, uma vez cada', async () => {
  const { ana, family, personal, marcos, silvani, sent } = setup();
  family.addJoint({ userId: silvani.id, withUserId: marcos.id });
  personal.addItem(marcos.id, { kind: 'lembrete', title: 'Buscar o Pedro na escola', date: '2026-11-11', time: '10:00' });
  await ana.tick(new Date(2026, 10, 11, 10, 0, 0));
  const lembretes = sent.filter((s) => /lembrete: \*Buscar o Pedro/.test(s.t));
  assert.deepEqual(lembretes.map((s) => s.id).sort(), [marcos.id, silvani.id].sort());
  await ana.tick(new Date(2026, 10, 11, 10, 1, 0));
  assert.equal(sent.filter((s) => /lembrete: \*Buscar o Pedro/.test(s.t)).length, 2, 'não repete');
});

test('Ana do Eliezer: com ele na lista, ele tem pasta própria, separada da dos outros', async () => {
  const { ana, store, eliezer, marcos } = setup();
  assert.equal(ana.allowed(eliezer), false, 'vendedor sem liberação não usa a Ana');
  store.updateSettings({ ana: { users: [marcos.id, eliezer.id] } });
  assert.equal(ana.allowed(eliezer), true);
  await ana.process(eliezer, 'anote que a reunião de metas é toda segunda', {});
  const r = await ana.process(marcos, 'o que eu anotei sobre reunião?', {});
  assert.doesNotMatch(txt(r), /metas/);
  const e = await ana.process(eliezer, 'o que eu anotei sobre reunião?', {});
  assert.match(txt(e), /toda segunda/);
});
