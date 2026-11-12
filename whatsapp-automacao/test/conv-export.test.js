import test from 'node:test';
import assert from 'node:assert/strict';
import { pickConversations, conversationsToHtml, conversationsToText } from '../src/conv-export.js';

const all = {
  a: { key: '5545988880001@s.whatsapp.net', phone: '5545988880001', name: 'Edval', updatedAt: '2026-11-10T12:00:00Z', messages: [{ role: 'user', content: 'Quero a residência <b>', at: '2026-11-10T11:00:00Z' }, { role: 'assistant', content: 'Claro!', at: '2026-11-10T11:01:00Z' }, { role: 'assistant', content: 'Marcos aqui', by: 'owner', at: '2026-11-10T11:05:00Z' }] },
  b: { key: 'l:abc:5545988880002@s.whatsapp.net', phone: '5545988880002', name: 'Da linha', updatedAt: '2026-11-10T12:00:00Z', messages: [{ role: 'user', content: 'oi', at: '2026-11-10T11:00:00Z' }] },
  c: { key: '1203@g.us', name: 'Grupo', updatedAt: '2026-11-10T12:00:00Z', messages: [{ role: 'user', content: 'oi' }] },
  d: { key: 'ig:xyz', name: 'Insta', updatedAt: '2026-11-10T12:00:00Z', messages: [{ role: 'user', content: 'oi' }] },
  e: { key: 'sim:1', simulation: true, updatedAt: '2026-11-10T12:00:00Z', messages: [{ role: 'user', content: 'oi' }] },
  f: { key: '5545988880009@s.whatsapp.net', name: 'Antiga', updatedAt: '2026-01-01T12:00:00Z', messages: [{ role: 'user', content: 'oi' }] },
  g: { key: '5545988880010@s.whatsapp.net', name: 'Vazia', updatedAt: '2026-11-10T12:00:00Z', messages: [] },
};

test('exportar: número principal sem linhas, grupos, Instagram, simulação nem conversa vazia', () => {
  assert.deepEqual(pickConversations(all, { scope: 'main' }).map((c) => c.name), ['Edval', 'Antiga']);
  assert.deepEqual(pickConversations(all, { scope: 'main', days: 30, now: new Date('2026-11-12T00:00:00Z') }).map((c) => c.name), ['Edval']);
  assert.deepEqual(pickConversations(all, { scope: 'line:abc' }).map((c) => c.name), ['Da linha']);
  assert.equal(pickConversations(all, { scope: 'all' }).length, 3);
});

test('exportar: texto e HTML mostram quem falou; HTML protege contra código no texto do cliente', () => {
  const list = pickConversations(all, { scope: 'main', days: 30, now: new Date('2026-11-12T00:00:00Z') });
  const t = conversationsToText(list, { ownerName: 'Marcos' });
  assert.match(t, /=== Edval · \+5545988880001 ===/);
  assert.match(t, /Cliente: Quero a residência <b>/);
  assert.match(t, /Atendente \(IA\): Claro!/);
  assert.match(t, /Marcos: Marcos aqui/);
  const h = conversationsToHtml(list);
  assert.match(h, /Quero a residência &lt;b&gt;/);
  assert.doesNotMatch(h, /<b>Quero/);
  assert.match(h, /apague depois de usar/);
});
