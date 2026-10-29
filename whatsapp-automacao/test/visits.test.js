import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Crm } from '../src/crm.js';
import { Visits } from '../src/visits.js';
import { paymentPlan, planMessage, dueDate } from '../src/payplan.js';
import { tempStore } from './helpers.js';

test('etapas de pagamento batem com o material da Migra (2 pessoas no Prata)', () => {
  const p = paymentPlan({ price: 11997, people: 2, adults: 2 });
  assert.equal(p.total, 23994);
  assert.equal(p.entry, 2600);
  assert.deepEqual(p.parcels.map((x) => x.value), [10697, 6418.2, 4278.8]);
  assert.equal(p.entry + p.parcels.reduce((s, x) => s + x.value, 0), p.total);
  const msg = planMessage(p, { packageName: 'Pacote Prata' });
  assert.match(msg, /Entrada: R\$ 2\.600,00/);
  assert.match(msg, /1ª parcela: R\$ 10\.697,00/);
  assert.match(msg, /Valor total: R\$ 23\.994,00/);
  // Centavos: as parcelas sempre somam o saldo exato.
  const q = paymentPlan({ price: 12997, people: 3, adults: 2 });
  assert.equal(Math.round((q.entry + q.parcels.reduce((s, x) => s + x.value, 0)) * 100), Math.round(q.total * 100));
  assert.equal(q.entry, 2600);
});

test('visita ao escritório: avisa o Marcos e só o painel confirma, mandando ao cliente', async () => {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  auth.create({ name: 'Marcos', login: 'marcos', password: 'segredo123', role: 'admin' });
  const crm = new Crm({ store, auth });
  store.updateSettings({ visits: { address: 'Av. Central 100, Santa Rita', bring: 'RG, foto e o valor da entrada' } });
  const owner = [];
  const sent = [];
  const visits = new Visits({ store, crm, notifyOwner: async (t) => owner.push(t), sendTo: async (k, p) => sent.push({ k, ...p }) });
  const lead = crm.ensureFromConversation({ key: '5511987654321@s.whatsapp.net', phone: '5511987654321', name: 'Ana', channel: 'whatsapp' });
  const v = await visits.request({ convKey: lead.conversationKey, lead, nome: 'Ana Souza', data_preferida: 'segunda que vem', periodo: 'manhã', pessoas: 2, assunto: 'iniciar o Ouro', preparado: 'vem com documentos e entrada' });
  assert.equal(v.status, 'pendente');
  assert.match(owner[0], /Pedido de visita/);
  assert.match(owner[0], /Ana Souza · \+5511987654321/);
  assert.equal(sent.length, 0, 'a IA não confirma sozinha');
  assert.equal(visits.forConversation(lead.conversationKey).length, 1);
  await assert.rejects(visits.confirm(v.id, { date: '2026-11-10' }), /horário/);
  await visits.confirm(v.id, { date: '2026-11-10', time: '09:30', note: 'Te espero!' });
  assert.match(sent[0].text, /Visita confirmada, Ana!/);
  assert.match(sent[0].text, /10\/11\/2026 às 09:30/);
  assert.match(sent[0].text, /Av\. Central 100/);
  assert.match(sent[0].text, /RG, foto e o valor da entrada/);
  assert.ok(crm.byId(lead.id).timeline.some((h) => /Visita confirmada/.test(h.text)));
});

test('calculadora: datas das parcelas, e sábado ou domingo passam para segunda', () => {
  assert.deepEqual(dueDate('2026-10-30', 15), { date: '2026-11-16', weekday: 'segunda-feira', moved: true }); // caiu no sábado 14/11
  assert.deepEqual(dueDate('2026-10-31', 15), { date: '2026-11-16', weekday: 'segunda-feira', moved: true }); // caiu no domingo 15/11
  assert.equal(dueDate('2026-10-29', 15).date, '2026-11-13'); // sexta, fica
  // Ouro, 4 pessoas, assinando na sexta 30/10/2026.
  const p = paymentPlan({ price: 12997, people: 4, adults: 4, start: '2026-10-30' });
  assert.equal(p.total, 51988);
  assert.equal(p.entry, 4200);
  assert.deepEqual(p.parcels.map((x) => [x.date, x.weekday, x.value]), [
    ['2026-11-16', 'segunda-feira', 23894],
    ['2026-01-28'.replace('2026', '2027'), 'quinta-feira', 14336.4],
    ['2027-03-01', 'segunda-feira', 9557.6],
  ]);
  assert.match(planMessage(p, { packageName: 'Pacote Ouro' }), /segunda, 16\/11\/2026 · com 15 dias/);
});
