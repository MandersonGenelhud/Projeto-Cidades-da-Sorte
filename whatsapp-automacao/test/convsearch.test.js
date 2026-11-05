import test from 'node:test';
import assert from 'node:assert/strict';
import { searchConversations } from '../src/convsearch.js';

const NOW = Date.parse('2026-11-05T12:00:00Z');
const day = 86_400_000;
const m = (role, content, ago) => ({ role, content, at: new Date(NOW - ago * day).toISOString() });
const convs = [
  { key: '5511900001111@s.whatsapp.net', name: 'Paula', phone: '5511900001111', messages: [m('user', 'Quanto custa a CÉDULA de identidade?', 0.1), m('assistant', 'A cédula custa X', 0.1)] },
  { key: 'ig:77', name: 'Carlos', username: 'carlos', messages: [m('user', 'quero um terreno parcelado', 20)] },
  { key: 'sim:teste', simulation: true, messages: [m('user', 'cedula', 0)] },
  { key: '5511900002222@s.whatsapp.net', name: 'Outro Escritório', messages: [m('user', 'cedula também', 1)] },
];

test('busca: ignora acentos e maiúsculas, acha WhatsApp e Instagram, pula simulador', () => {
  const r = searchConversations(convs, { q: 'cedula', now: NOW });
  assert.equal(r.total, 2);
  assert.deepEqual(r.items.map((i) => i.name), ['Paula', 'Outro Escritório']);
  assert.match(r.items[0].hits[0].snippet, /CÉDULA/);
  assert.equal(r.items[0].matches, 2);
  assert.equal(searchConversations(convs, { q: 'terreno', now: NOW }).items[0].key, 'ig:77');
});

test('busca: período, várias palavras em qualquer ordem e escopo (escritório)', () => {
  assert.equal(searchConversations(convs, { q: 'terreno', days: 7, now: NOW }).total, 0, 'conversa de 20 dias fica fora de 7 dias');
  assert.equal(searchConversations(convs, { q: 'terreno', days: 30, now: NOW }).total, 1);
  assert.equal(searchConversations(convs, { q: 'parcelado terreno', now: NOW }).total, 1);
  assert.equal(searchConversations(convs, { q: 'cedula', now: NOW, canSee: (c) => c.name !== 'Outro Escritório' }).total, 1);
  assert.equal(searchConversations(convs, { q: 'x', now: NOW }).total, 0, 'uma letra só não busca');
  assert.equal(searchConversations(convs, { q: 'Paula', now: NOW }).total, 1, 'acha pelo nome');
});
