import test from 'node:test';
import assert from 'node:assert/strict';
import { PartnerProjects } from '../src/partner-projects.js';
import { Commissions } from '../src/commissions.js';
import { Sales } from '../src/sales.js';
import { Auth } from '../src/auth.js';
import { tempStore } from './helpers.js';

function setup(nowIso = '2027-12-10T12:00:00Z') {
  let now = new Date(nowIso);
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const admin = auth.get(auth.create({ name: 'Marcos', login: 'marcos', password: 'segredo123', role: 'admin' }).id);
  const ana = auth.get(auth.create({ name: 'Ana', login: 'ana', password: 'segredo123', role: 'seller' }).id);
  ana.createdAt = '2026-01-01T00:00:00Z';
  const sales = new Sales({ store, auth });
  const commissions = new Commissions({ store, sales, auth, now: () => now });
  const sent = [];
  const pp = new PartnerProjects({ store, auth, sales, levels: (id, m) => commissions.levelOf(id, m), notify: async (k, p) => sent.push([k, p]), now: () => now });
  const sale = (total, paid, createdAt) => store.data.sales.push({ id: Math.random().toString(16).slice(2), sellerId: ana.id, status: 'ativa', total, createdAt, parcels: [{ value: paid, status: 'pago' }], commission: { pct: 5, value: 0, status: 'a_pagar' }, history: [] });
  return { store, admin, ana, pp, sale, sent, setNow: (d) => { now = new Date(d); } };
}
const idea = { title: 'Migra Seguros', problem: 'Quem chega não tem seguro', audience: 'Famílias', plan: 'Parceria com seguradora', startCost: '20.000,00', revenuePotential: 50000 };

test('elegibilidade: plano fechado, meta de vendas confirmadas, tempo de casa e nível Legado (ou convite da diretoria)', async () => {
  const { pp, admin, ana, sale } = setup();
  await assert.rejects(pp.submit(ana, idea), /ainda não foi aberto/);
  pp.setConfig(admin, { enabled: true, minSales: 1000000, minMonths: 12 });
  sale(600000, 400000, '2027-03-05T10:00:00Z');
  let e = pp.eligibility(ana);
  assert.equal(e.ok, false); assert.equal(e.missingSales, 600000); assert.equal(e.reachedLevel, true, 'R$ 600 mil num mês = Legado');
  await assert.rejects(pp.submit(ana, idea), /faltam R\$/);
  sale(700000, 700000, '2027-05-05T10:00:00Z');
  e = pp.eligibility(ana);
  assert.equal(e.ok, true);
  assert.throws(() => pp.setConfig(ana, { enabled: false }), /Só o administrador/);
  // Convite: libera antes da meta.
  const fresh = setup();
  fresh.pp.setConfig(fresh.admin, { enabled: true });
  assert.equal(fresh.pp.eligibility(fresh.ana).ok, false);
  fresh.pp.setInvite(fresh.admin, fresh.ana.id, true);
  assert.equal(fresh.pp.eligibility(fresh.ana).ok, true);
});

test('caminho: ideia → ajustes → reenviada → piloto → oficial; cada um vê só o seu; só a diretoria decide', async () => {
  const { pp, admin, ana, sent } = setup();
  pp.setConfig(admin, { enabled: true }); pp.setInvite(admin, ana.id, true);
  const p = await pp.submit(ana, idea);
  assert.equal(p.stage, 'ideia'); assert.equal(p.startCost, 20000);
  assert.equal(sent[0][0], 'admins');
  await assert.rejects(pp.decide(ana, p.id, 'piloto', {}), /Só a diretoria/);
  await assert.rejects(pp.decide(admin, p.id, 'ajustes', {}), /motivo/);
  await pp.decide(admin, p.id, 'ajustes', { note: 'Detalhe os custos' });
  const again = pp.edit(ana, p.id, { startCost: 25000 });
  assert.equal(again.stage, 'ideia', 'ajustado volta para a diretoria');
  await assert.rejects(pp.decide(admin, p.id, 'oficial', { sharePct: 10 }), /essa ação não vale agora/);
  const pil = await pp.decide(admin, p.id, 'piloto', { pilotMonths: 3, pilotSharePct: 5, goals: [{ label: '20 clientes', target: '20' }] });
  assert.equal(pil.stage, 'piloto'); assert.equal(pil.goals.length, 1);
  assert.throws(() => pp.edit(ana, p.id, { title: 'outro' }), /só a diretoria altera/);
  await assert.rejects(pp.decide(admin, p.id, 'oficial', { sharePct: 40 }), /até 20%/);
  const off = await pp.decide(admin, p.id, 'oficial', { sharePct: 12, vestingYears: 3 });
  assert.equal(off.stage, 'oficial');
  assert.ok(sent.some(([k, x]) => k === 'owner' && /Projeto oficial: 12%/.test(x.text)));
  assert.equal(pp.list({ id: 'outra', role: 'seller' }).items.length, 0);
  assert.throws(() => pp.get({ id: 'outra', role: 'seller' }, p.id), /não encontrado/);
});

test('lucro: piloto paga o % do piloto; oficial paga o % adquirido até o mês; pagamento não passa do devido', async () => {
  const { pp, admin, ana, setNow } = setup('2027-01-10T12:00:00Z');
  pp.setConfig(admin, { enabled: true }); pp.setInvite(admin, ana.id, true);
  const p = await pp.submit(ana, idea);
  await pp.decide(admin, p.id, 'piloto', { pilotMonths: 3, pilotSharePct: 5 });
  pp.addResult(admin, p.id, { month: '2027-01', revenue: 30000, costs: 10000 });
  setNow('2027-04-01T12:00:00Z');
  await pp.decide(admin, p.id, 'oficial', { sharePct: 12, vestingYears: 1 });
  pp.addResult(admin, p.id, { month: '2027-04', revenue: 50000, costs: 20000 }); // 1º mês: 1/12 de 12% = 1%
  const r = pp.addResult(admin, p.id, { month: '2027-05', revenue: 10000, costs: 15000 }); // prejuízo: nada
  const rows = r.statement.rows;
  assert.deepEqual(rows.map((x) => [x.month, x.pct, x.share]), [['2027-01', 5, 1000], ['2027-04', 1, 300], ['2027-05', 2, 0]]);
  assert.equal(r.statement.due, 1300);
  assert.throws(() => pp.addResult(ana, p.id, { month: '2027-06', revenue: 1, costs: 0 }), /Só a diretoria/);
  await assert.rejects(pp.addPayment(admin, p.id, { amount: 2000 }), /Maior que o valor a pagar/);
  const paid = await pp.addPayment(admin, p.id, { amount: '1.000,00' });
  assert.equal(paid.statement.due, 300);
  setNow('2028-06-01T12:00:00Z');
  assert.equal(pp.get(admin, p.id).vestedPct, 12, 'depois do prazo, a participação inteira');
});
