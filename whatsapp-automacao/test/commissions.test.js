import test from 'node:test';
import assert from 'node:assert/strict';
import { Commissions } from '../src/commissions.js';
import { Sales } from '../src/sales.js';
import { Auth } from '../src/auth.js';
import { tempStore } from './helpers.js';

function setup() {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const admin = auth.create({ name: 'Marcos', login: 'marcos', password: 'segredo123', role: 'admin' });
  const ana = auth.create({ name: 'Ana', login: 'ana', password: 'segredo123', role: 'seller' });
  const sales = new Sales({ store, auth });
  const sent = [];
  const c = new Commissions({ store, sales, auth, notify: async (k, p) => sent.push([k, p]), now: () => new Date('2026-11-05T12:00:00Z') });
  sales.levelPct = (id) => c.levelPct(id);
  const sale = (total, paid = 0) => {
    const s = { id: Math.random().toString(16).slice(2, 10), sellerId: ana.id, status: 'ativa', total, createdAt: '2026-11-03T10:00:00Z', parcels: [{ value: paid, status: 'pago' }, { value: total - paid, status: 'pendente' }].filter((p) => p.value > 0), commission: { pct: 10, value: total * 0.1, manual: false, status: 'a_pagar' }, history: [] };
    store.data.sales.push(s); return s;
  };
  return { store, auth, admin: auth.get(admin.id), ana: auth.get(ana.id), sales, c, sale, sent };
}

test('nível do mês: pela soma das vendas, com quanto falta para o próximo; liga e desliga no painel', () => {
  const { c, ana, admin, sale, sales } = setup();
  sale(60000);
  const l = c.levelOf(ana.id);
  assert.equal(l.level.label, 'Ponte'); assert.equal(l.next.label, 'Horizonte'); assert.equal(l.next.missing, 140000);
  assert.equal(sales.commissionPct(ana.id), 0, 'desligado: vale o padrão do painel');
  c.setLevels(admin, { enabled: true });
  assert.equal(sales.commissionPct(ana.id), 3, 'ligado: vale o nível');
  ana.commissionPct = 7;
  assert.equal(sales.commissionPct(ana.id), 7, 'comissão definida para a pessoa vale mais');
  assert.throws(() => c.setLevels(ana, { enabled: false }), /Só o administrador/);
  assert.throws(() => c.setLevels(admin, { plans: [{ label: 'X', pct: 150, goal: 0 }] }), /Comissão inválida/);
});

test('saque: só o que já foi liberado (proporcional ao que o cliente pagou), sem pedir duas vezes o mesmo dinheiro', async () => {
  const { c, ana, sale, sent } = setup();
  sale(10000, 5000); // comissão 1000, cliente pagou metade → 500 liberados
  assert.deepEqual(c.balance(ana.id), { total: 1000, released: 500, pending: 0, paid: 0, available: 500, waiting: 500 });
  await assert.rejects(c.request(ana, { amount: 600, pixKey: 'ana@pix' }), /maior que o disponível/);
  await assert.rejects(c.request(ana, { amount: 100 }), /chave Pix/);
  const w = await c.request(ana, { amount: '300,00', pixKey: 'ana@pix' });
  assert.equal(w.amount, 300);
  assert.equal(c.balance(ana.id).available, 200, 'o pedido em análise já sai do disponível');
  await assert.rejects(c.request(ana, { amount: 201, pixKey: 'ana@pix' }), /maior que o disponível/);
  assert.equal(sent[0][0], 'admins');
});

test('saque: só administrador aprova, paga ou recusa (com motivo); recusado volta para o disponível', async () => {
  const { c, ana, admin, sale, sent } = setup();
  sale(10000, 10000);
  const w = await c.request(ana, { amount: 400, pixKey: 'x' });
  await assert.rejects(c.decide(ana, w.id, 'pay'), /Só o administrador/);
  await assert.rejects(c.decide(admin, w.id, 'reject', {}), /motivo/);
  await c.decide(admin, w.id, 'approve');
  await c.decide(admin, w.id, 'pay', { paidAt: '2026-11-06' });
  assert.equal(c.balance(ana.id).paid, 400);
  await assert.rejects(c.decide(admin, w.id, 'reject', { reason: 'x' }), /já está pago/);
  const w2 = await c.request(ana, { amount: 100, pixKey: 'x' });
  await c.decide(admin, w2.id, 'reject', { reason: 'Conferir parcelas' });
  assert.equal(c.balance(ana.id).available, 600);
  assert.ok(sent.some(([k, p]) => k === 'seller' && /não foi aprovado: Conferir parcelas/.test(p.text)));
});

test('recalcular o mês aplica o nível às vendas não pagas e sem comissão manual; importa os níveis da cópia', () => {
  const { c, admin, sale, store } = setup();
  const s1 = sale(250000); const s2 = sale(1000); s2.commission.manual = true;
  assert.throws(() => c.recalcMonth(admin), /Ligue os níveis/);
  c.setLevels(admin, { enabled: true });
  assert.equal(c.recalcMonth(admin).changed, 1);
  assert.equal(s1.commission.pct, 3.5); assert.equal(s1.commission.value, 8750);
  assert.equal(s2.commission.pct, 10, 'manual não muda');
  const fresh = setup();
  const r = fresh.c.importCapture({ api: [
    { url: 'https://v/api/seller-level-plans', json: { data: { plans: [{ id: 'bronze', label: 'Bronze', commission_rate: 2, goal_amount: null, color: '#b45309', is_active: true }, { id: 'diamond', label: 'Diamond', commission_rate: 5, goal_amount: 500000, color: '#7c3aed', is_active: true }] } } },
    { url: 'https://v/api/withdrawals?status=all', json: { sellers: [{ seller_name: 'Thiago', total_commission: 1000, released: 800, pending: 0, available: 300, withdrawn: 500 }], requests: [] } },
  ] });
  assert.deepEqual(r, { levels: 2, legacySellers: 1 });
  assert.equal(fresh.c.config.plans[1].pct, 5);
  assert.deepEqual(fresh.c.config.plans.map((p) => p.label), ['Raiz', 'Legado'], 'nomes do sistema antigo viram a jornada Migra, com o mesmo percentual');
  assert.equal(fresh.store.data.legacyWithdrawals.sellers[0].withdrawn, 500);
  assert.equal(store.settings.commissionLevels.enabled, true);
});

test('jornada Migra: níveis já salvos com nomes de pedras aparecem como Raiz, Ponte, Horizonte e Legado', () => {
  const { c, store } = setup();
  store.settings.commissionLevels = { enabled: true, plans: [{ id: 'bronze', label: 'Bronze', pct: 2, goal: 0 }, { id: 'safira', label: 'Safira', pct: 4, goal: 100 }] };
  assert.deepEqual(c.config.plans.map((p) => [p.label, p.pct]), [['Raiz', 2], ['Horizonte', 4]]);
  assert.ok(!JSON.stringify(c.config).match(/Bronze|Esmeralda|Safira|Diamond/));
});
