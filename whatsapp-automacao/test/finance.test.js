import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Realty } from '../src/realty.js';
import { Audit, diff } from '../src/audit.js';
import { Proposals, cleanConfig, DEFAULT_FINANCE, simulate, options, schedule, isConfigured } from '../src/finance.js';
import { tempStore } from './helpers.js';

const CFG = cleanConfig({ minEntryPct: 10, bands: [{ upTo: 12, interestPct: 0 }, { upTo: 60, interestPct: 10 }, { upTo: 120, interestPct: 25 }] });

function setup() {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const admin = auth.get(auth.create({ name: 'Marcos', login: 'marcos', password: 'segredo123', role: 'admin' }).id);
  const seller = auth.get(auth.create({ name: 'Gabriel', login: 'gabriel', password: 'segredo123', role: 'seller' }).id);
  const realty = new Realty({ store, dataDir: store.dataDir });
  const audit = new Audit({ store });
  const proposals = new Proposals({ store, realty, audit });
  proposals.saveConfig({ bands: CFG.bands, reserveFee: 500, validDays: 3 });
  const d = realty.saveDevelopment(null, { name: 'Lago Azul', city: 'Santa Rita' });
  const [lot] = realty.generateBlock(d.id, { block: 'A', rows: 1, cols: 2, x: 5, y: 5, w: 30, h: 10, area: 360, price: '50.000' });
  return { store, auth, admin, seller, realty, audit, proposals, d, lot };
}
const client = { name: 'João Silva', doc: '1234567', phone: '+595981000000', address: 'Rua 1, Santa Rita' };

test('padrão começa com 0% de juros e avisa que não foi configurado', () => {
  assert.equal(isConfigured(DEFAULT_FINANCE), false);
  assert.equal(isConfigured(CFG), true);
});

test('juros sobem com mais parcelas e a entrada abate o saldo', () => {
  const a = simulate(CFG, { price: 50000, entry: 10000, installments: 12 });
  const b = simulate(CFG, { price: 50000, entry: 10000, installments: 60 });
  const c = simulate(CFG, { price: 50000, entry: 10000, installments: 120 });
  assert.equal(a.interestPct, 0);
  assert.equal(b.interestPct, 10);
  assert.equal(c.interestPct, 25);
  assert.equal(b.balance, 40000);
  assert.equal(b.financed, 44000);
  assert.ok(a.total < b.total && b.total < c.total);
  // entrada maior reduz o saldo e as parcelas
  const more = simulate(CFG, { price: 50000, entry: 20000, installments: 60 });
  assert.ok(more.installment < b.installment);
  // soma das parcelas fecha com o financiado (centavos na última)
  assert.equal(Math.round((b.installment * 59 + b.lastInstallment) * 100), Math.round(b.financed * 100));
});

test('entrada mínima, parcelas máximas e entrada parcelada', () => {
  assert.throws(() => simulate(CFG, { price: 50000, entry: 1000, installments: 12 }), /entrada mínima/i);
  assert.throws(() => simulate(CFG, { price: 50000, entry: 6000, installments: 500 }), /Parcelas de 1/);
  assert.throws(() => simulate(CFG, { price: 50000, entry: 60000, installments: 12 }), /maior que o valor/);
  const s = simulate(CFG, { price: 50000, entry: 10000, installments: 12, entryParts: 3 });
  assert.equal(Math.round((s.entryPart * 2 + s.entryLastPart) * 100), 1000000);
  const rows = schedule(s, new Date('2026-01-10'));
  assert.equal(rows.filter((r) => r.kind === 'entrada').length, 3);
  assert.equal(rows.filter((r) => r.kind === 'parcela').length, 12);
  assert.equal(rows.at(-1).balance, 0);
  assert.equal(options(CFG, { price: 50000 }).length, 8);
});

test('faixas inválidas são recusadas', () => {
  assert.throws(() => cleanConfig({ bands: [] }), /faixas/);
  assert.throws(() => cleanConfig({ bands: [{ upTo: 12, interestPct: 1 }, { upTo: 12, interestPct: 2 }] }), /mesmo número/);
});

test('reserva exige todos os dados do cliente', () => {
  const { proposals, d, lot, seller } = setup();
  assert.throws(() => proposals.create({ devId: d.id, lotId: lot.id, client: { name: 'João' }, installments: 12, user: seller }), /faltam os dados.*documento.*telefone.*endereço/);
});

test('proposta só vale depois da reserva paga; lote fica reservado e não duplica', () => {
  const { proposals, realty, d, lot, seller, admin } = setup();
  const p = proposals.create({ devId: d.id, lotId: lot.id, client, entry: 10000, installments: 60, user: seller });
  assert.equal(p.status, 'aberta');
  assert.equal(p.number, 'PRP-0001');
  assert.equal(realty.development(d.id).lots[0].status, 'disponivel');
  assert.throws(() => proposals.create({ devId: d.id, lotId: lot.id, client, installments: 12, user: seller }), /proposta aberta/);
  const pdfOpen = proposals.pdf(p, 'Migra').toString('latin1');
  assert.match(pdfOpen, /SEM VALOR ATE A RESERVA|SEM VALOR AT/);
  proposals.markPaid(p.id, admin);
  assert.equal(realty.development(d.id).lots[0].status, 'reservado');
  assert.equal(proposals.get(p.id).status, 'reservada');
  assert.doesNotMatch(proposals.pdf(proposals.get(p.id), 'Migra').toString('latin1'), /SEM VALOR/);
  assert.equal(proposals.report().reservadas, 1);
  proposals.cancel(p.id, admin);
  assert.equal(realty.development(d.id).lots[0].status, 'disponivel');
});

test('proposta vence depois da validade', () => {
  const { proposals, store, d, lot, seller } = setup();
  const p = proposals.create({ devId: d.id, lotId: lot.id, client, installments: 12, user: seller });
  store.data.finance.proposals[0].validUntil = '2020-01-01';
  assert.equal(proposals.get(p.id).status, 'vencida');
  assert.throws(() => proposals.markPaid(p.id, seller), /vencida/);
});

test('auditoria: quem alterou, o que mudou (antes/depois) e destaque de preço', () => {
  const { audit, admin, seller } = setup();
  const ch = diff({ price: 50000, status: 'disponivel', note: '' }, { price: 45000, status: 'reservado', note: '' });
  assert.deepEqual(ch.map((c) => c.field).sort(), ['price', 'status']);
  assert.equal(ch.find((c) => c.field === 'price').sensitive, true);
  audit.record({ user: seller, action: 'alterou', entity: 'lote', label: 'Lago Azul · QA-L1', changes: ch });
  audit.record({ user: admin, action: 'excluiu', entity: 'lote', label: 'Lago Azul · QA-L2' });
  const all = audit.list();
  assert.equal(all[0].action, 'excluiu');
  assert.equal(all[0].sensitive, true);
  assert.equal(audit.list({ user: 'Gabriel' }).length, 1);
  assert.equal(audit.list({ q: '45000' }).length, 1);
  assert.equal(audit.list({ sensitive: true }).length, 2);
});

test('auditoria: middleware registra alteração de preço e ignora falhas', async () => {
  const { audit, realty, d, lot, seller } = setup();
  const rules = [{ methods: ['PATCH'], re: /^\/lots\/([^/]+)$/, entity: 'lote', get: (m) => realty.development(d.id).lots.find((l) => l.id === m[1]), label: (m, o) => o.code }];
  const mw = audit.middleware(rules);
  const run = (status, mutate) => new Promise((resolve) => {
    const handlers = {};
    const res = { statusCode: status, json(b) { return b; }, on(ev, fn) { handlers[ev] = fn; } };
    const req = { method: 'PATCH', path: `/lots/${lot.id}`, user: seller, ip: '1.2.3.4', body: {} };
    mw(req, res, () => { mutate(); res.json({}); handlers.finish(); resolve(); });
  });
  await run(400, () => {});
  assert.equal(audit.list().length, 0);
  await run(200, () => realty.updateLot(d.id, lot.id, { price: '48.000' }));
  const [e] = audit.list();
  assert.equal(e.user, 'Gabriel');
  assert.equal(e.action, 'alterou');
  assert.equal(e.changes[0].field, 'price');
  assert.equal(e.changes[0].from, '50000');
  assert.equal(e.changes[0].to, '48000');
});

test('gerente é só marcação de vendedor; administrador nunca é gerente', () => {
  const { auth, admin, seller } = setup();
  assert.equal(auth.update(seller.id, { manager: true }).manager, true);
  assert.equal(auth.update(admin.id, { manager: true }).manager, false);
});
