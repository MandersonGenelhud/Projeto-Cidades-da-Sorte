import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Sales } from '../src/sales.js';
import { paymentPlan } from '../src/payplan.js';
import { tempStore } from './helpers.js';

function setup() {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const marcos = auth.create({ name: 'Marcos', login: 'marcos', password: 'segredo123', role: 'admin' });
  const ana = auth.create({ name: 'Ana', login: 'ana', password: 'segredo123', role: 'seller' });
  const bia = auth.create({ name: 'Bia', login: 'bia', password: 'segredo123', role: 'seller' });
  store.updateSettings({ sales: { commissionPct: 5 } });
  const sales = new Sales({ store, auth });
  const quote = (id, by) => ({ id, number: `ORC-2026-0${id}`, client: 'Luiza', phone: '5545988887777', items: [{ name: 'Pacote Ouro', qty: 2, price: 12997, total: 25994 }],
    plan: paymentPlan({ total: 25994, people: 2, adults: 2, start: '2026-10-30' }), createdBy: { id: by.id, name: by.name } });
  return { store, auth, sales, marcos: auth.get(marcos.id), ana: auth.get(ana.id), bia: auth.get(bia.id), quote };
}

test('venda lançada do orçamento: parcelas (entrada + 3), comissão padrão e uma venda por orçamento', () => {
  const { sales, ana, quote } = setup();
  const s = sales.fromQuote(quote('1', ana), { by: ana });
  assert.match(s.number, /^VD-\d{4}-0001$/);
  assert.equal(s.parcels.length, 4);
  assert.equal(s.parcels[0].label, 'Entrada');
  assert.equal(s.parcels[0].value, 2600);
  assert.equal(Math.round(s.parcels.reduce((x, p) => x + p.value, 0) * 100), 2599400);
  assert.equal(s.commission.pct, 5);
  assert.equal(s.commission.value, 1299.7);
  assert.equal(sales.fromQuote(quote('1', ana), { by: ana }).id, s.id, 'não duplica');
});

test('vendedor vê só as dele; só o Marcos confirma parcelas e mexe na comissão; tudo no histórico', () => {
  const { sales, marcos, ana, bia, quote, auth } = setup();
  auth.get(bia.id).commissionPct = 8;
  const a = sales.fromQuote(quote('1', ana), { by: ana });
  const b = sales.fromQuote(quote('2', bia), { by: bia });
  assert.equal(b.commission.pct, 8, 'percentual próprio da vendedora');
  assert.deepEqual(sales.listFor(ana).map((x) => x.id), [a.id]);
  assert.equal(sales.listFor(marcos).length, 2);
  assert.throws(() => sales.setParcel(ana, a.id, 0, { paid: true }), /Só o administrador/);
  assert.throws(() => sales.setCommission(ana, a.id, { pct: 50 }), /Só o administrador/);
  sales.setParcel(marcos, a.id, 0, { paid: true, date: '2026-10-30', method: 'Pix' });
  const v = sales.view(sales.get(a.id));
  assert.equal(v.received, 2600);
  assert.equal(v.next.label, '1ª parcela');
  sales.setCommission(marcos, a.id, { value: 1500 });
  sales.setCommission(marcos, a.id, { status: 'paga', paidAt: '2026-11-05' });
  const c = sales.get(a.id).commission;
  assert.equal(c.value, 1500);
  assert.equal(c.status, 'paga');
  assert.ok(sales.get(a.id).history.some((h) => h.by === 'Marcos' && /Comissão/.test(h.text)));
  const sum = sales.summary(marcos, { from: '2026-10-01', to: '2026-11-30' });
  assert.equal(sum.received, 2600);
  assert.equal(sum.commissionPaid, 1500);
  assert.equal(sum.bySeller.length, 2);
  assert.equal(sales.summary(ana).bySeller.length, 1, 'vendedor só vê os números dele');
  // Quitação e cancelamento
  for (const i of [1, 2, 3]) sales.setParcel(marcos, a.id, i, { paid: true, date: '2026-12-01' });
  assert.equal(sales.get(a.id).status, 'concluida');
  assert.throws(() => sales.cancel(marcos, b.id, ''), /motivo/);
  sales.cancel(marcos, b.id, 'cliente desistiu antes do início');
  assert.equal(sales.get(b.id).status, 'cancelada');
});

test('parcela vencida conta como atraso', () => {
  const { sales, marcos, ana, quote } = setup();
  const q = quote('3', ana);
  q.plan = paymentPlan({ total: 25994, people: 2, adults: 2, start: '2020-01-10' });
  const s = sales.fromQuote(q, { by: ana, entryPaid: true });
  assert.equal(s.parcels[0].status, 'pago');
  const v = sales.view(s);
  assert.ok(v.overdue > 0);
  assert.equal(v.next.late, true);
  assert.ok(sales.summary(marcos).overdue > 0);
});
