import test from 'node:test';
import assert from 'node:assert/strict';
import { Visits } from '../src/visits.js';
import { tempStore } from './helpers.js';

function setup({ clients = [] } = {}) {
  const store = tempStore();
  const sent = [];
  const desk = [];
  const leads = { L1: { id: 'L1' }, L2: { id: 'L2' }, L3: { id: 'L3' } };
  const notes = [];
  const crm = { byId: (id) => leads[id] || null, addNote: (_u, id, text) => notes.push({ id, text }) };
  const visits = new Visits({ store, crm, notifyOwner: async (t) => desk.push(t), sendTo: async (key, p) => sent.push({ key, ...p }), isClient: (lead) => clients.includes(lead?.id) });
  return { store, visits, sent, desk, notes };
}

test('taxa padrão de R$ 125 e a equipe só é avisada depois que o Pix da taxa é pago', async () => {
  const { visits, desk, notes } = setup();
  assert.equal(visits.fee, 125);
  const v = await visits.request({ convKey: 'k1', lead: { id: 'L1' }, nome: 'Ana Souza', data_preferida: 'segunda', assunto: 'residência', feePending: true });
  assert.equal(v.status, 'aguardando_taxa');
  assert.equal(desk.length, 0, 'sem o pagamento, ninguém da equipe é incomodado');
  assert.equal(visits.forConversation('k1').length, 1, 'a atendente enxerga o pedido e não cria outro');
  await visits.feePaid(v.id, { id: 'pay1', amount: 125 });
  assert.equal(v.status, 'pendente');
  assert.match(desk[0], /TAXA DE R\$ 125,00 JÁ PAGA/);
  assert.match(notes.at(-1).text, /Estornar se fechar/);
  await visits.feePaid(v.id); // repetido não avisa de novo
  assert.equal(desk.length, 1);
});

test('estorno: quem pagou a taxa e fechou com a Migra aparece para devolver, e some depois de marcado', async () => {
  const clients = [];
  const { visits } = setup({ clients });
  const v = await visits.request({ convKey: 'k1', lead: { id: 'L1' }, nome: 'Ana', data_preferida: 'x', assunto: 'y', feePending: true });
  await visits.feePaid(v.id, { id: 'p', amount: 125 });
  assert.equal(visits.refundsDue().length, 0, 'ainda não fechou');
  clients.push('L1');
  assert.deepEqual(visits.refundsDue().map((x) => x.id), [v.id]);
  visits.markRefunded(v.id, { by: 'Marcos' });
  assert.equal(visits.refundsDue().length, 0);
  assert.throws(() => visits.markRefunded('nao-existe'), /não tem taxa paga/);
});

test('aviso da nova regra: só quem pediu visita, não pagou, não é cliente; uma vez por pessoa e uma mensagem por vez', async () => {
  const { visits, sent, notes } = setup({ clients: ['L3'] });
  const mk = (convKey, lead, phone, extra = {}) => visits.request({ convKey, lead, phone, nome: `Pessoa ${convKey}`, data_preferida: 'x', assunto: 'y', ...extra });
  const a = await mk('k1', { id: 'L1' }, '5511900000001');
  const b = await mk('k2', { id: 'L2' }, '5511900000002');
  await mk('k3', { id: 'L3' }, '5511900000003'); // já é cliente
  await mk('k1b', { id: 'L1' }, '5511900000001'); // mesma pessoa pedindo de novo
  const paid = await mk('k4', { id: 'L2' }, '5511900000004', { feePending: true });
  await visits.feePaid(paid.id);
  await visits.cancel((await mk('k5', null, '5511900000005')).id);
  const targets = visits.noticeTargets();
  assert.deepEqual(targets.map((v) => v.phone).sort(), ['5511900000001', '5511900000002']);
  const text = visits.noticeText(a);
  assert.match(text, /taxa de reserva de horário de R\$ 125,00/);
  assert.match(text, /estornado/);
  assert.match(text, /pessoas sérias e comprometidas/);
  assert.match(text, /me responder aqui que eu já emito o Pix/);
  assert.doesNotMatch(text, /Marcos/, 'o aviso é sobre a assessoria, não sobre o Marcos');
  const run = await visits.sendNotices(null, { delayMs: () => 0, by: 'Manderson' });
  assert.deepEqual([run.total, run.sent, run.failed], [2, 2, 0]);
  assert.deepEqual(sent.map((m) => m.key).sort(), ['k1', 'k2']);
  assert.ok(notes.some((n) => /Avisado da taxa/.test(n.text)));
  assert.equal(visits.noticeTargets().length, 0, 'ninguém recebe duas vezes');
  assert.equal(b.feeNoticeAt !== undefined, true);
});

test('sem taxa (0) não há aviso e cliente da Migra não é cobrado', () => {
  const { visits, store } = setup();
  store.updateSettings({ visits: { consultFee: 0 } });
  assert.equal(visits.fee, 0);
  assert.deepEqual(visits.noticeTargets(), []);
});
