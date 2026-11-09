import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Auth } from '../src/auth.js';
import { Sales } from '../src/sales.js';
import { Payments } from '../src/payments.js';
import { SaleReceipts } from '../src/sale-receipts.js';
import { paymentPlan } from '../src/payplan.js';
import { tempStore } from './helpers.js';

function setup({ canSend = true } = {}) {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const marcos = auth.create({ name: 'Marcos Miguel', login: 'marcos', password: 'segredo123', role: 'admin' });
  store.updateSettings({ sales: { commissionPct: 5 } });
  const sales = new Sales({ store, auth });
  const payments = new Payments({ store, crm: { byId: () => null }, dataDir: store.dataDir, secret: 's', sendTo: async () => {}, notifyAdmins: async () => {}, notify() {} });
  const sent = []; const admins = [];
  const rec = new SaleReceipts({
    store, sales, payments, docOf: () => '529.982.247-25',
    sendToClient: async (sale, payload) => { if (!canSend) return false; sent.push({ sale: sale.id, ...payload }); return true; },
    notifyAdmins: async (t) => { admins.push(t); },
    now: () => new Date('2026-11-09T12:00:00Z'),
  });
  sales.onParcelPaid = (sale, i, user) => rec.issueAndSend(sale.id, i, { by: user?.name });
  sales.onParcelVoided = (sale, i, user) => rec.void(sale.id, i, user?.name);
  const quote = { id: '1', number: 'ORC-2026-01', client: 'Carlos Lima Souza', phone: '5545988887711', items: [{ name: 'Pacote Ouro', qty: 1, price: 6000, total: 6000 }], plan: paymentPlan({ total: 6000, people: 1, adults: 1, start: '2026-11-01' }), createdBy: { id: marcos.id, name: marcos.name } };
  const sale = sales.fromQuote(quote, { by: auth.get(marcos.id) });
  return { store, auth, sales, payments, rec, sent, admins, sale, admin: auth.get(marcos.id) };
}
const tick = () => new Promise((r) => setTimeout(r, 20));

test('parcela recebida gera recibo da Migra e envia ao cliente', async () => {
  const { sales, sale, admin, sent } = setup();
  sales.setParcel(admin, sale.id, 1, { paid: true, date: '2026-11-09', method: 'Pix' });
  await tick();
  const p = sales.get(sale.id).parcels[1];
  assert.ok(p.receipt?.no > 0 && p.receipt.sentAt);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /recibo nº \d{4}/);
  assert.equal(sent[0].media.mimetype, 'application/pdf');
});

test('o PDF é válido e fica guardado com permissão restrita', async () => {
  const { sales, sale, admin, rec } = setup();
  sales.setParcel(admin, sale.id, 1, { paid: true, date: '2026-11-09', method: 'Pix' });
  await tick();
  const f = rec.pdf(sale.id, 1);
  assert.equal(f.buffer.slice(0, 5).toString(), '%PDF-');
  const mode = fs.statSync(path.join(rec.dir, sales.get(sale.id).parcels[1].receipt.file)).mode & 0o777;
  assert.equal(mode, 0o600);
});

test('um recibo por recebimento: emitir de novo devolve o mesmo número', async () => {
  const { sales, sale, admin, rec } = setup();
  sales.setParcel(admin, sale.id, 1, { paid: true, date: '2026-11-09', method: 'Pix' });
  await tick();
  const a = sales.get(sale.id).parcels[1].receipt.no;
  assert.equal(rec.issue(sale.id, 1).no, a);
});

test('numeração compartilhada e sequencial entre parcelas', async () => {
  const { sales, sale, admin, store } = setup();
  sales.setParcel(admin, sale.id, 0, { paid: true, date: '2026-11-09', method: 'Pix' });
  sales.setParcel(admin, sale.id, 1, { paid: true, date: '2026-11-09', method: 'Pix' });
  await tick();
  const s = sales.get(sale.id);
  assert.equal(s.parcels[1].receipt.no, s.parcels[0].receipt.no + 1);
  assert.equal(store.data.receiptSeq, s.parcels[1].receipt.no);
});

test('parcela não recebida não tem recibo', () => {
  const { rec, sale } = setup();
  assert.throws(() => rec.issue(sale.id, 1), /ainda não foi recebida/);
});

test('desfazer o recebimento anula o recibo e o número não é reaproveitado', async () => {
  const { sales, sale, admin } = setup();
  sales.setParcel(admin, sale.id, 1, { paid: true, date: '2026-11-09', method: 'Pix' });
  await tick();
  const n1 = sales.get(sale.id).parcels[1].receipt.no;
  sales.setParcel(admin, sale.id, 1, { paid: false });
  const p = sales.get(sale.id).parcels[1];
  assert.equal(p.receipt, null);
  assert.equal(p.receiptsVoided[0].no, n1);
  assert.ok(p.receiptsVoided[0].voidedAt);
  sales.setParcel(admin, sale.id, 1, { paid: true, date: '2026-11-09', method: 'Pix' });
  await tick();
  assert.ok(sales.get(sale.id).parcels[1].receipt.no > n1);
});

test('sem WhatsApp do cliente: recibo guardado, motivo registrado e administrador avisado', async () => {
  const { sales, sale, admin, admins } = setup({ canSend: false });
  sales.setParcel(admin, sale.id, 1, { paid: true, date: '2026-11-09', method: 'Pix' });
  await tick();
  const r = sales.get(sale.id).parcels[1].receipt;
  assert.ok(r.no > 0);
  assert.equal(r.sentAt, null);
  assert.ok(r.sentError);
  assert.equal(admins.length, 1);
  assert.match(admins[0], /NÃO foi enviado/);
});

test('receipt:false (entrada paga pelo Pix, que já tem recibo próprio) não gera segundo recibo', async () => {
  const { sales, sale, admin, sent } = setup();
  sales.setParcel(admin, sale.id, 0, { paid: true, method: 'Pix', receipt: false });
  await tick();
  assert.equal(sales.get(sale.id).parcels[0].receipt || null, null);
  assert.equal(sent.length, 0);
});
