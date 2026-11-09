import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth, accessExpired } from '../src/auth.js';
import { Maria } from '../src/maria.js';
import { tempStore } from './helpers.js';

function setup() {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const adm = auth.create({ name: 'Marcos Miguel', login: 'marcos', password: 'segredo123', role: 'admin', whatsapp: '5545999990001' });
  const temp = auth.create({ name: 'Teste Temporario', login: 'teste', password: 'segredo123', role: 'seller', whatsapp: '556984761664', expiresAt: '2099-12-31' });
  return { store, auth, adm, temp };
}

test('acesso temporário: vale até o fim do dia combinado e depois a pessoa é desativada sozinha', () => {
  const { auth, temp } = setup();
  const u = () => auth.get(temp.id);
  assert.ok(u().expiresAt, 'o prazo ficou gravado');
  assert.ok(auth.login('teste', 'segredo123'), 'antes do prazo entra');
  auth.update(temp.id, { expiresAt: '2026-11-08' }); // prazo fixo para a conferência por horários (não depende do dia de hoje)
  const before = Date.parse('2026-11-08T22:00:00-03:00');
  assert.equal(accessExpired(u(), before), false, 'ainda dentro do dia');
  assert.deepEqual(auth.sweepExpired(before), []);
  const after = Date.parse('2026-11-09T00:00:01-03:00');
  assert.equal(accessExpired(u(), after), true);
  const out = auth.sweepExpired(after);
  assert.deepEqual(out.map((x) => x.login), ['teste']);
  assert.equal(u().active, false);
  assert.equal(u().expiresAt, undefined);
  assert.ok(u().expiredAt);
  assert.equal(auth.login('teste', 'segredo123'), null, 'depois do prazo não entra');
  assert.deepEqual(auth.sweepExpired(after), [], 'não desativa duas vezes');
});

test('acesso vencido já não entra mesmo antes da varredura rodar', () => {
  const { auth, temp } = setup();
  auth.update(temp.id, { expiresAt: '2020-01-01' });
  assert.equal(auth.login('teste', 'segredo123'), null);
});

test('administrador nunca tem acesso temporário; novo prazo reabre quem venceu; prazo vazio remove', () => {
  const { auth, adm, temp } = setup();
  assert.throws(() => auth.update(adm.id, { expiresAt: '2026-12-01' }), /Administrador/);
  assert.equal(auth.create({ name: 'Outro Admin', login: 'outro', password: 'segredo123', role: 'admin', expiresAt: '2026-12-01' }).expiresAt, null);
  auth.update(temp.id, { expiresAt: '2026-11-08' });
  auth.sweepExpired(Date.parse('2026-11-10T12:00:00-03:00'));
  assert.equal(auth.get(temp.id).active, false);
  auth.update(temp.id, { expiresAt: '2099-01-01' });
  assert.equal(auth.get(temp.id).active, true);
  auth.update(temp.id, { expiresAt: '' });
  assert.equal(auth.get(temp.id).expiresAt, undefined);
  assert.throws(() => auth.update(temp.id, { expiresAt: 'lixo' }), /inválida/);
});

test('a Maria não atende o número de um acesso temporário vencido', () => {
  const { store, auth, temp } = setup();
  const maria = new Maria({ store, auth, sales: {}, customers: {}, cash: {}, send: async () => {}, lineName: () => 'Maria', log: () => {}, audit: () => {} });
  assert.ok(maria.personFor({ phone: '556984761664' }));
  auth.update(temp.id, { expiresAt: '2020-01-01' });
  assert.equal(maria.personFor({ phone: '556984761664' }), null);
});
