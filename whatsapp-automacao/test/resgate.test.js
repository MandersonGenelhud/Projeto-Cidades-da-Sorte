import test from 'node:test';
import assert from 'node:assert/strict';
import { listRescue, rescueThread, seedRescued } from '../src/rescue.js';

const mk = () => ({
  '5545988880001@s.whatsapp.net': { key: '5545988880001@s.whatsapp.net', phone: '5545988880001', name: 'Edval', updatedAt: '2026-11-10T12:00:00Z', messages: [{ role: 'user', content: 'Quero residência', at: '2026-11-10T11:00:00Z' }, { role: 'assistant', content: 'Claro!', at: '2026-11-10T11:01:00Z' }, { role: 'user', content: 'Quanto custa?', at: '2026-11-10T12:00:00Z' }] },
  '5545988880002@s.whatsapp.net': { key: '5545988880002@s.whatsapp.net', phone: '5545988880002', name: 'Ana', updatedAt: '2026-11-11T12:00:00Z', messages: [{ role: 'user', content: 'Preciso de um terreno', at: '2026-11-11T12:00:00Z' }] },
  'l:abc:5545988880003@s.whatsapp.net': { key: 'l:abc:5545988880003@s.whatsapp.net', name: 'Linha', messages: [{ role: 'user', content: 'oi' }] },
  'ig:x': { key: 'ig:x', messages: [{ role: 'user', content: 'oi' }] },
  '1203@g.us': { key: '1203@g.us', messages: [{ role: 'user', content: 'oi' }] },
  'sim:1': { key: 'sim:1', simulation: true, messages: [{ role: 'user', content: 'oi' }] },
});

test('resgate: lista só as conversas do número principal, mais recentes primeiro, com busca por nome, telefone e assunto', () => {
  const all = mk();
  assert.deepEqual(listRescue(all).map((c) => c.name), ['Ana', 'Edval']);
  assert.deepEqual(listRescue(all, { q: 'terreno' }).map((c) => c.name), ['Ana']);
  assert.deepEqual(listRescue(all, { q: 'EDVAL' }).map((c) => c.name), ['Edval']);
  assert.deepEqual(listRescue(all, { q: '988880002' }).map((c) => c.name), ['Ana']);
});

test('resgate: ao responder por outro número o histórico vem junto, o dono assume e o cliente que responde aparece como "respondeu"', () => {
  const all = mk();
  const old = all['5545988880001@s.whatsapp.net'];
  const key = 'l:central:5545988880001@s.whatsapp.net';
  const nova = { key, messages: [] };
  all[key] = nova;
  seedRescued(old, nova, { now: new Date('2026-11-12T15:00:00Z') });
  nova.messages.push({ role: 'assistant', content: 'Oi, aqui é o Marcos', by: 'owner', at: '2026-11-12T15:00:00Z' });
  assert.equal(nova.messages.length, 4, 'histórico copiado + resposta');
  assert.equal(nova.rescuedFrom, old.key); assert.equal(old.rescuedKey, key);
  assert.ok(nova.humanSpokeAt, 'a IA não puxa conversa por cima');
  let l = listRescue(all).find((c) => c.name === 'Edval');
  assert.equal(l.rescued, true); assert.equal(l.answered, false);
  assert.equal(listRescue(all).filter((c) => c.name === 'Edval').length, 1, 'a conversa da linha não aparece duplicada');
  nova.messages.push({ role: 'user', content: 'Ótimo, pode me explicar?', at: '2026-11-12T16:00:00Z' });
  l = listRescue(all).find((c) => c.name === 'Edval');
  assert.equal(l.answered, true);
  const t = rescueThread(all, old.key);
  assert.equal(t.rescuedKey, key);
  assert.equal(t.messages.at(-1).text, 'Ótimo, pode me explicar?');
  assert.equal(t.messages.find((m) => m.by === 'owner').text, 'Oi, aqui é o Marcos');
});

test('resgate: não duplica o histórico se a conversa nova já existia', () => {
  const all = mk();
  const old = all['5545988880002@s.whatsapp.net'];
  const nova = { key: 'l:c:5545988880002@s.whatsapp.net', messages: [{ role: 'user', content: 'já tinha', at: '2026-11-12T10:00:00Z' }] };
  seedRescued(old, nova);
  assert.equal(nova.messages.length, 1);
  assert.equal(rescueThread(all, 'nao-existe'), null);
});
