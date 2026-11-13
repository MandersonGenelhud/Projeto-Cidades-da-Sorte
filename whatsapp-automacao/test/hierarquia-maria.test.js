import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Maria, maskMoney, PROFILES } from '../src/maria.js';
import { Family } from '../src/ana-family.js';
import { tempStore } from './helpers.js';

function setup() {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const mk = (name, login, role, whatsapp) => auth.get(auth.create({ name, login, password: 'segredo123', role, whatsapp }).id);
  const marcos = mk('Marcos Miguel', 'marcos', 'admin', '595982543275');
  const silvani = mk('Silvani Miguel', 'silvani', 'seller', '595986192588');
  auth.update(silvani.id, { aliases: 'Nina' });
  const bianca = mk('Bianca Souza', 'bianca', 'seller', '595981111111');
  const geo = mk('Geovana', 'geo', 'seller', '595981222222');
  const sent = [];
  const maria = new Maria({ store, auth, sales: {}, customers: {}, cash: {}, send: async (j, p) => sent.push({ j, ...p }), lineName: () => 'Maria', marcosPhone: () => '595982543275', audit() {}, log() {} });
  return { store, auth, maria, marcos, silvani: auth.get(silvani.id), bianca, geo, sent };
}

test('hierarquia: administrador e Nina = diretoria; Bianca = secretária; vendedores = só o dele', () => {
  const { maria, marcos, silvani, bianca, geo } = setup();
  assert.equal(maria.profileOf(marcos), 'full');
  assert.equal(maria.profileOf(silvani), 'full');
  assert.equal(maria.profileOf(bianca), 'secretaria');
  assert.equal(maria.profileOf(geo), 'own');
  assert.ok(PROFILES.off && PROFILES.secretaria);
});

test('o botão da Equipe manda: perfil escolhido vale acima do padrão pelo nome', () => {
  const { maria, store, geo, bianca } = setup();
  store.updateSettings({ maria: { profiles: { [geo.id]: 'secretaria', [bianca.id]: 'off' } } });
  assert.equal(maria.profileOf(geo), 'secretaria');
  assert.equal(maria.profileOf(bianca), 'off');
});

test('secretária nunca vê valores: R$, US$, guaranis e comissão ficam escondidos', () => {
  const t = maskMoney('Contrato ORC-1: total R$ 6.000,00, entrada R$1.200 e 5x de US$ 100; Gs. 1.500.000 em aberto; 5% de comissão');
  assert.doesNotMatch(t, /6\.000|1\.200|100|1\.500\.000|5%/);
  assert.match(t, /R\$ •••/);
  assert.match(t, /ORC-1/, 'os dados que não são dinheiro continuam');
});

test('Maria desligada para a pessoa: não responde nada', async () => {
  const { maria, store, geo, sent } = setup();
  store.updateSettings({ maria: { profiles: { [geo.id]: 'off' } } });
  await maria.handle({ jid: 'l:maria:595981222222@s.whatsapp.net', phone: '595981222222', text: 'Maria, oi' });
  assert.equal(sent.length, 0);
});

test('"para a Nina" encontra a Silvani pelo apelido; "para o Marcos" pelo nome; "para mim" não', () => {
  const { maria, marcos, silvani } = setup();
  assert.equal(maria.teamTarget('Maria, envie o contrato do João para a Nina', marcos)?.id, silvani.id);
  assert.equal(maria.teamTarget('manda pro Marcos', silvani)?.id, marcos.id);
  assert.equal(maria.teamTarget('manda para mim', marcos), null);
});

test('Ana: "lembre a Nina" funciona para o casal que divide a mesma pasta', () => {
  const { store, auth, marcos, silvani } = setup();
  const family = new Family({ store, auth });
  family.addJoint({ userId: silvani.id, withUserId: marcos.id });
  const r = family.crossTarget(marcos.id, 'lembre a Nina de buscar o Pedro às 17h');
  assert.equal(r?.partner.id, silvani.id);
  assert.match(r.rest, /buscar o Pedro/);
});
