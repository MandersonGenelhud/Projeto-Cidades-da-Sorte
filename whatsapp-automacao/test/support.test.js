import test from 'node:test';
import assert from 'node:assert/strict';
import { Support } from '../src/support.js';
import { tempStore } from './helpers.js';

const admin = { id: 'a1', role: 'admin', name: 'Marcos' };
const ana = { id: 's1', role: 'seller', name: 'Ana' };
const bia = { id: 's2', role: 'seller', name: 'Bia' };

function setup(start = '2026-11-05T12:00:00Z') {
  let now = new Date(start);
  const sent = [];
  const s = new Support({ store: tempStore(), notify: async (k, p) => sent.push([k, p]), now: () => now });
  return { s, sent, tick: (min) => { now = new Date(now.getTime() + min * 60000); } };
}

test('suporte: abre com número e prazos pela urgência; a administração é avisada', async () => {
  const { s, sent } = setup();
  const t = await s.open(ana, { title: 'Orçamento não abre', description: 'Cliquei e deu erro', urgency: 'alta' });
  assert.equal(t.number, 'SUP-2026-0001');
  assert.equal(t.firstResponseDue, '2026-11-05T12:45:00.000Z');
  assert.equal(t.resolutionDue, '2026-11-05T16:00:00.000Z');
  assert.equal(sent[0][0], 'admins');
  await assert.rejects(s.open(ana, { title: 'x' }), /Descreva/);
  assert.equal((await s.open(ana, { title: 'y', description: 'z' })).number, 'SUP-2026-0002');
});

test('suporte: cada um vê só os próprios chamados; resposta do administrador conta o prazo e avisa quem abriu', async () => {
  const { s, sent, tick } = setup();
  const t = await s.open(ana, { title: 'A', description: 'B', urgency: 'critica' });
  assert.equal(s.list(bia).items.length, 0);
  assert.throws(() => s.get(bia, t.id), /não encontrado/);
  await assert.rejects(s.reply(bia, t.id, { text: 'oi' }), /não encontrado/);
  tick(40);
  assert.equal(s.list(admin).counts.atrasados, 1, '30 min para a primeira resposta na urgência crítica');
  const r = await s.reply(admin, t.id, { text: 'Estou vendo' });
  assert.equal(r.status, 'em_andamento');
  assert.equal(r.sla.firstLate, true, 'respondeu depois do prazo: fica registrado');
  assert.ok(sent.some(([k, p]) => k === 'user' && p.userId === ana.id));
});

test('suporte: só administrador resolve (com a solução); resposta de quem abriu depois reabre', async () => {
  const { s } = setup();
  const t = await s.open(ana, { title: 'A', description: 'B' });
  await assert.rejects(s.resolve(ana, t.id, { solution: 'x' }), /Só o administrador/);
  await assert.rejects(s.resolve(admin, t.id, {}), /solução/);
  const r = await s.resolve(admin, t.id, { solution: 'Atualizei o sistema' });
  assert.equal(r.status, 'resolvido');
  assert.equal(s.list(ana).counts.abertos, 0);
  const again = await s.reply(ana, t.id, { text: 'Voltou a acontecer' });
  assert.equal(again.status, 'aberto');
});

test('suporte: importa os chamados do sistema antigo sem duplicar', () => {
  const { s } = setup();
  const cap = { api: [{ url: 'https://v/api/support/tickets?', json: { tickets: [{ ticket_number: 'SUP-2026-0002', title: 'Erro', description: 'x', urgency: 'high', status: 'resolved', created_at: '2026-08-18T20:00:00Z', resolved_at: '2026-08-18T20:30:00Z', creator: { full_name: 'Jhonata' } }] } }] };
  assert.deepEqual(s.importCapture(cap), { added: 1 });
  assert.deepEqual(s.importCapture(cap), { added: 0 });
  assert.equal(s.list(admin, { status: 'todos' }).items[0].urgency, 'alta');
});
