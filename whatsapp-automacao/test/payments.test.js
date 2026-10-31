import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Auth } from '../src/auth.js';
import { Crm } from '../src/crm.js';
import { Payments } from '../src/payments.js';
import { crc16, pixBrCode, valorPorExtenso, normalizePixKey } from '../src/pix.js';
import { tempStore } from './helpers.js';

test('Pix copia e cola no padrão do Banco Central', () => {
  // Exemplo oficial do manual do BR Code (CRC 1D3D).
  assert.equal(crc16('00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304'), '1D3D');
  const code = pixBrCode({ key: '12.345.678/0001-90', name: 'Migra Paraguai Assessoria Ltda', city: 'Ciudad del Este', amount: 1800, txid: 'MIG-AB12' });
  assert.match(code, /^000201/);
  assert.ok(code.includes('0014br.gov.bcb.pix011412345678000190'));
  assert.ok(code.includes('54071800.00'));
  assert.ok(code.includes('62110507MIGAB12'));
  assert.equal(code.slice(-4), crc16(code.slice(0, -4)));
  assert.equal(normalizePixKey('(45) 99999-8888'), '+5545999998888');
  assert.equal(valorPorExtenso(2600), 'dois mil e seiscentos reais');
  assert.equal(valorPorExtenso(10997.5), 'dez mil, novecentos e noventa e sete reais e cinquenta centavos');
});

function setup({ fetchImpl } = {}) {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const admin = auth.get(auth.create({ name: 'Marcos', login: 'marcos', password: 'segredo123', role: 'admin', whatsapp: '595981111222' }).id);
  const crm = new Crm({ store, auth });
  store.updateSettings({ payments: { pixKey: '12345678000190', receiverName: 'Migra Paraguai', receiverCity: 'Ciudad del Este', company: { name: 'Migra Paraguai Assessoria', document: '12.345.678/0001-90' } } });
  const sent = [];
  const admins = [];
  const payments = new Payments({
    store, crm, dataDir: store.dataDir, secret: 'x', fetchImpl,
    sendTo: async (key, payload) => sent.push({ key, ...payload }),
    notifyAdmins: async (t) => admins.push(t),
  });
  return { store, crm, admin, payments, sent, admins };
}

test('fechamento: gera o Pix, envia QR + copia e cola, confirma, fecha a venda, manda recibo e avisa o dono', async () => {
  const { crm, payments, sent, admins } = setup();
  const lead = crm.ensureFromConversation({ key: '5511999990000@s.whatsapp.net', phone: '5511999990000', name: 'Carla', channel: 'whatsapp' });
  lead.interest = 'Pacote Ouro';
  lead.value = 25994;
  assert.equal(payments.reservationAmount(2), 2600);
  const p = await payments.create({ convKey: lead.conversationKey, leadId: lead.id, amount: payments.reservationAmount(2), description: 'reserva - 2 adultos', payerName: 'Carla Souza', payerDoc: '123.456.789-09' });
  await payments.sendCharge(p);
  assert.equal(sent[0].media.mimetype, 'image/png');
  assert.ok(fs.existsSync(sent[0].media.path));
  assert.equal(sent[1].text, p.brcode); // código sozinho, fácil de copiar

  const claim = await payments.clientClaimsPaid(lead.conversationKey, 'paguei agora');
  assert.ok(claim.ok);
  assert.match(admins[0], /Cliente avisou que pagou/);

  await payments.confirm(p.id, { by: 'Marcos' });
  assert.equal(p.status, 'paid');
  assert.equal(p.receiptNo, 1);
  const receipt = sent.at(-1);
  assert.equal(receipt.media.mimetype, 'application/pdf');
  assert.ok(fs.readFileSync(receipt.media.path).subarray(0, 5).toString() === '%PDF-');
  const l = crm.leads.find((x) => x.id === lead.id);
  assert.equal(l.stage, 'ganho');
  assert.equal(l.closedConfirmed, true);
  assert.match(admins.at(-1), /Venda fechada! Pix confirmado/);
  assert.match(admins.at(-1), /R\$ 2\.600,00/);
  assert.match(admins.at(-1), /Pacote Ouro/);
  // Confirmar de novo não duplica.
  await payments.confirm(p.id);
  assert.equal(admins.filter((t) => /Venda fechada/.test(t)).length, 1);
});

test('Mercado Pago: cria a cobrança e confirma sozinho quando o Pix cai', async () => {
  let status = 'action_required';
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (opts.method === 'POST') {
      return { ok: true, json: async () => ({ id: 'ORD1', status, transactions: { payments: [{ payment_method: { qr_code: '000201PIXMP', qr_code_base64: Buffer.from('png').toString('base64') } }] } }) };
    }
    return { ok: true, json: async () => ({ id: 'ORD1', status, transactions: { payments: [{ status, status_detail: status === 'processed' ? 'accredited' : 'waiting_transfer' }] } }) };
  };
  const { store, payments, admins } = setup({ fetchImpl });
  store.updateSettings({ payments: { provider: 'mercadopago', mercadopago: { accessToken: 'APP_USR-x' } } });
  const p = await payments.create({ amount: 1800, description: 'reserva' });
  assert.equal(p.provider, 'mercadopago');
  assert.equal(p.brcode, '000201PIXMP');
  assert.ok(calls[0].opts.headers['X-Idempotency-Key']);
  assert.equal(JSON.parse(calls[0].opts.body).transactions.payments[0].payment_method.id, 'pix');
  assert.equal(await payments.checkPending(), 0);
  status = 'processed';
  assert.equal(await payments.checkPending(), 1);
  assert.equal(p.status, 'paid');
  assert.match(p.confirmedBy, /Mercado Pago/);
  assert.match(admins.at(-1), /Pix confirmado/);
});

test('mentoria paga não fecha o prospecto como venda de pacote', async () => {
  const { Payments } = await import('../src/payments.js');
  const store = tempStore();
  store.updateSettings({ payments: { pixKey: '12345678000190', receiverName: 'Migra Paraguai', receiverCity: 'Ciudad del Este', company: { name: 'Migra Paraguai Assessoria', document: '12.345.678/0001-90' } } });
  const lead = { id: 'L1', name: 'Carla', phone: '5511999990000', stage: 'em_contato', timeline: [] };
  const updates = [];
  const crm = { leads: [lead], update: (_u, id, patch) => updates.push(patch), addNote() {}, ownerName: () => '' };
  const pay = new Payments({ store, crm, dataDir: store.dataDir, secret: 's', sendTo: async () => {}, notifyAdmins: async () => {}, notify() {} });
  const p = await pay.create({ leadId: 'L1', amount: 1375, description: 'Mentoria com Marcos Miguel (60 min, online)' });
  p.purpose = 'mentoria';
  const paid = [];
  pay.onPaid = (x) => paid.push(x.purpose);
  await pay.confirm(p.id, { by: 'teste' });
  assert.equal(p.status, 'paid');
  assert.deepEqual(updates, [], 'o prospecto não vira Fechado');
  assert.deepEqual(paid, ['mentoria']);
});
