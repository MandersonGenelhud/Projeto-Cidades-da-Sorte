import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Crm } from '../src/crm.js';
import { collectHandoffs, digestMessage } from '../src/digest.js';
import { tempStore } from './helpers.js';

function conv(store, key, phone, name, messages, extra = {}) {
  store.data.conversations[key] = { key, phone, name, messages, handoff: false, updatedAt: new Date().toISOString(), ...extra };
  return store.data.conversations[key];
}

test('reenvio dos encaminhados: vendedor dono recebe; prometido ao Marcos ou sem vendedor vai para o Marcos', () => {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const admin = auth.create({ name: 'Marcos Miguel', login: 'marcos', password: 'segredo123', role: 'admin' });
  const ana = auth.create({ name: 'Ana Souza', login: 'ana', password: 'segredo123', role: 'seller', whatsapp: '5545999990001' });
  const crm = new Crm({ store, auth });
  // 1) IA prometeu atendente; cliente é da Ana → Ana.
  conv(store, '5511900000001@s.whatsapp.net', '5511900000001', 'Carla', [
    { role: 'user', content: 'Quero o Ouro para 2, mas tenho receio' },
    { role: 'assistant', content: 'Estou enviando seu contato tudo certinho para um atendente dentro do escritório para continuar seu atendimento.' },
  ]);
  const l1 = crm.create(admin, { name: 'Carla', phone: '5511900000001', interest: 'Pacote Ouro', people: 2 });
  crm.update(admin, l1.id, { ownerId: ana.id });
  crm.byId(l1.id).conversationKey = '5511900000001@s.whatsapp.net';
  crm.byId(l1.id).closingBrief = { objecao: 'medo de pagar e não receber' };
  // 2) IA disse que o Marcos vai finalizar; sem vendedor → Marcos.
  conv(store, '5511900000002@s.whatsapp.net', '5511900000002', 'João', [
    { role: 'user', content: 'Prefiro falar com o dono' },
    { role: 'assistant', content: 'Perfeito! O Marcos vai finalizar com você por aqui em instantes.' },
  ]);
  // 3) Conversa normal, sem encaminhamento → fica de fora.
  conv(store, '5511900000003@s.whatsapp.net', '5511900000003', 'Bia', [{ role: 'user', content: 'oi' }, { role: 'assistant', content: 'Oi! Como posso ajudar?' }]);
  // 4) O próprio Marcos respondeu pelo celular → não é encaminhamento da IA.
  conv(store, '5511900000004@s.whatsapp.net', '5511900000004', 'Lia', [{ role: 'user', content: 'oi' }], { handoff: true, handoffReason: 'Você respondeu pelo celular' });
  // 5) Simulação → fora.
  conv(store, 'sim:teste', null, 'Teste', [{ role: 'assistant', content: 'Vou encaminhar para um consultor' }]);

  const items = collectHandoffs({ store, crm, auth });
  assert.deepEqual(items.map((i) => i.name).sort(), ['Carla', 'João']);
  const carla = items.find((i) => i.name === 'Carla');
  const joao = items.find((i) => i.name === 'João');
  assert.equal(carla.to.kind, 'vendedor');
  assert.equal(carla.to.user.name, 'Ana Souza');
  assert.equal(joao.to.kind, 'marcos');

  const text = digestMessage(carla, { index: 1, total: 3, senderName: 'Ana Souza' });
  assert.match(text, /Cliente para você chamar\* \(1\/3\)/);
  assert.match(text, /https:\/\/wa\.me\/5511900000001/);
  assert.match(text, /Pacote Ouro · 2 pessoas/);
  assert.match(text, /medo de pagar e não receber/);
  assert.match(text, /O que a IA disse a ele/);
  assert.match(text, /Oi, Carla! Aqui é Ana, da Migra Paraguai/);

  // Depois de enviado não repete (a não ser pedindo "todos").
  carla.conv.digestSentAt = new Date().toISOString();
  assert.equal(collectHandoffs({ store, crm, auth }).length, 1);
  assert.equal(collectHandoffs({ store, crm, auth, includeSent: true }).length, 2);
});
