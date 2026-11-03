import test from 'node:test';
import assert from 'node:assert/strict';
import { Tasks } from '../src/tasks.js';
import { tempStore } from './helpers.js';

const users = [{ id: 'm', name: 'Marcos', role: 'admin', whatsapp: '595987101567', active: true }, { id: 'd', name: 'Diego', role: 'seller', whatsapp: '595981000001', active: true }, { id: 'a', name: 'Ana', role: 'seller', whatsapp: '', active: true }];
const auth = { users, get: (id) => users.find((u) => u.id === id) };

test('tarefas: vendedor só cria para si e só vê as dele; administrador atribui e vê tudo', () => {
  let now = new Date('2026-11-03T10:00:00Z');
  const t = new Tasks({ store: tempStore(), auth, now: () => now });
  const [admin, diego, ana] = users;
  const mine = t.add(diego, { title: 'Ligar para a Carla', due: '2026-11-03', assigneeId: 'a' });
  assert.equal(mine.assigneeId, 'd', 'vendedor não manda tarefa para outra pessoa');
  const forAna = t.add(admin, { title: 'Conferir caixa', due: '2026-11-05', assigneeId: 'a' });
  assert.equal(forAna.assigneeId, 'a');
  assert.deepEqual(t.list(diego).map((x) => x.title), ['Ligar para a Carla']);
  assert.deepEqual(t.list(ana).map((x) => x.title), ['Conferir caixa']);
  assert.equal(t.list(admin).length, 2);
  assert.throws(() => t.update(diego, forAna.id, { done: true }), /não encontrada/);
  assert.throws(() => t.add(diego, { title: '' }), /Escreva/);
  assert.throws(() => t.add(diego, { title: 'x', due: '03/11' }), /Data inválida/);
  assert.throws(() => t.add(admin, { title: 'x', assigneeId: 'zzz' }), /Pessoa/);
  assert.equal(t.counts(diego).today, 1);
  now = new Date('2026-11-04T10:00:00Z');
  assert.equal(t.list(diego)[0].late, true);
  assert.throws(() => t.remove(ana, forAna.id), /Só quem criou/);
  t.update(diego, mine.id, { done: true });
  assert.equal(t.list(diego).length, 0);
  assert.equal(t.list(diego, { status: 'done' }).length, 1);
});

test('tarefas: lembrete uma vez só, no prazo, para quem tem WhatsApp', async () => {
  let now = new Date('2026-11-03T09:00:00Z');
  const t = new Tasks({ store: tempStore(), auth, now: () => now });
  const [admin, diego] = users;
  t.add(diego, { title: 'Conferir pagamento', due: '2026-11-03', clientName: 'Carla' });
  t.add(admin, { title: 'Sem WhatsApp', due: '2026-11-03', assigneeId: 'a' });
  t.add(admin, { title: 'Futura', due: '2026-11-20', assigneeId: 'd' });
  const sent = [];
  assert.equal(await t.remind(async (p, x) => sent.push({ p, x })), 1);
  assert.equal(sent[0].p, '595981000001');
  assert.match(sent[0].x, /Conferir pagamento/); assert.match(sent[0].x, /vence hoje/); assert.match(sent[0].x, /Carla/);
  assert.equal(await t.remind(async () => sent.push({})), 0, 'não repete');
  now = new Date('2026-11-21T09:00:00Z');
  assert.equal(await t.remind(async (p, x) => sent.push({ p, x })), 1);
  assert.match(sent.at(-1).x, /venceu em 20\/11\/2026/);
  // falha de envio: tenta de novo na próxima
  const t2 = new Tasks({ store: tempStore(), auth, now: () => now });
  t2.add(diego, { title: 'Falhou', due: '2026-11-21' });
  assert.equal(await t2.remind(async () => { throw new Error('off'); }), 0);
  assert.equal(await t2.remind(async () => {}), 1);
});
