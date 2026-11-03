import test from 'node:test';
import assert from 'node:assert/strict';
import { Recordings } from '../src/recordings.js';
import { tempStore } from './helpers.js';

test('reuniões gravadas: guarda só o endereço, recusa link perigoso e limpa o texto', () => {
  const r = new Recordings({ store: tempStore() });
  const a = r.add({ title: 'Live de residência', date: '2026-11-05', topic: 'residência', link: 'https://drive.google.com/file/d/abc/view', notes: '<b>oi</b>' }, 'Marcos');
  assert.equal(a.notes.includes('<'), false);
  for (const bad of [{ title: 'x', link: 'javascript:alert(1)' }, { title: 'x', link: 'http://sem-https.com/a' }, { title: '', link: 'https://a.com/x' }, { title: 'x', link: 'https://a.com/x', date: 'ontem' }]) assert.throws(() => r.add(bad));
  r.add({ title: 'Aula terrenos', date: '2026-11-07', link: 'https://youtu.be/xyz' });
  assert.deepEqual(r.list().map((x) => x.title), ['Aula terrenos', 'Live de residência'], 'mais nova primeiro');
  assert.equal(r.list({ q: 'resid' }).length, 1);
  assert.equal(r.update(a.id, { title: 'Live nova' }).title, 'Live nova');
  r.remove(a.id);
  assert.equal(r.list().length, 1);
  assert.throws(() => r.remove('nao'), /não encontrada/);
});
