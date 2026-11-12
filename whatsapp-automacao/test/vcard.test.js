import test from 'node:test';
import assert from 'node:assert/strict';
import { contactsToVcf } from '../src/vcard.js';

test('vCard: nome, telefone internacional e etiquetas; telefone inválido é ignorado', () => {
  const v = contactsToVcf([{ name: 'Edval', phone: '5514997666559', tags: ['whatsapp', 'lista-outubro'] }, { name: 'Sem número', phone: '12' }, { name: '', phone: '595986192588' }]);
  assert.equal((v.match(/BEGIN:VCARD/g) || []).length, 2);
  assert.match(v, /FN:Edval/); assert.match(v, /TEL;TYPE=CELL:\+5514997666559/);
  assert.match(v, /CATEGORIES:whatsapp,lista-outubro/);
  assert.match(v, /FN:\+595986192588/, 'sem nome, usa o número');
  assert.doesNotMatch(v, /Sem número/);
});

test('vCard: quebra de linha e símbolos no nome não criam campos falsos', () => {
  const v = contactsToVcf([{ name: 'João\r\nTEL:+1\r\nEND:VCARD; X', phone: '5545999990000' }]);
  assert.equal((v.match(/^END:VCARD/gm) || []).length, 1);
  assert.equal((v.match(/^TEL/gm) || []).length, 1);
  assert.match(v, /FN:João TEL:\+1 END:VCARD\; X/);
});
