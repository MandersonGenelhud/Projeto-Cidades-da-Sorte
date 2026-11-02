import test from 'node:test';
import assert from 'node:assert/strict';
import { Motors } from '../src/motors.js';
import { School } from '../src/school.js';
import { tempStore } from './helpers.js';

test('veículos: cadastro, título automático, publicação e venda', () => {
  const m = new Motors({ store: tempStore() });
  assert.throws(() => m.saveVehicle(null, { brand: 'Toyota' }), /marca e o modelo/);
  const v = m.saveVehicle(null, { brand: 'Toyota', model: 'Hilux', year: 2020, price: '32.000,5', published: true });
  assert.equal(v.title, 'Toyota Hilux 2020');
  assert.equal(m.vehicles({ publicOnly: true }).length, 1);
  m.saveVehicle(v.id, { status: 'vendido' });
  assert.equal(m.vehicles({ publicOnly: true }).length, 0);
  assert.throws(() => m.saveVehicle(v.id, { status: 'xx' }), /inválida/);
});

test('financiamento (tabela Price) e consórcio comparados; quem não atende sai com o motivo', () => {
  const m = new Motors({ store: tempStore() });
  m.saveLender(null, { name: 'Banco A', type: 'banco', ratePctMonth: 1.5, minEntryPct: 30, maxMonths: 60 });
  m.saveLender(null, { name: 'Financeira B', type: 'financeira', ratePctMonth: 0, minEntryPct: 20, maxMonths: 36 });
  m.saveLender(null, { name: 'Consórcio C', type: 'consorcio', adminFeePct: 15, maxMonths: 80 });
  m.saveLender(null, { name: 'Antiga D', type: 'banco', ratePctMonth: 1, maxVehicleAgeYears: 3, active: true });
  const r = m.compare({ price: 30000, entry: 9000, months: 48, vehicleYear: new Date().getFullYear() - 1 });
  const a = r.results.find((x) => x.lender === 'Banco A');
  assert.equal(a.financed, 21000);
  assert.ok(a.installment > 21000 / 48);
  assert.equal(r.skipped.find((x) => x.lender === 'Financeira B').reason.includes('prazo de 1 a 36'), true);
  const c = r.results.find((x) => x.lender === 'Consórcio C');
  assert.equal(c.total, 34500);
  assert.equal(c.installment, 718.75);
  assert.equal(r.results[0].total <= r.results.at(-1).total, true);
  const old = m.compare({ price: 30000, entry: 9000, months: 12, vehicleYear: 2010 });
  assert.ok(old.skipped.some((x) => x.lender === 'Antiga D' && /até 3 anos/.test(x.reason)));
  assert.throws(() => m.simulate(m.lenders()[0], { price: 30000, entry: 1000, months: 12 }), /entrada mínima/);
});

test('sem taxas cadastradas, o comparador avisa que não está configurado', () => {
  const m = new Motors({ store: tempStore() });
  m.saveLender(null, { name: 'Banco X', type: 'banco' });
  assert.equal(m.compare({ price: 10000, months: 12 }).configured, false);
});

test('school: etapa, acessos, frequência e alunos sumidos', () => {
  const s = new School({ store: tempStore() });
  const a = s.save(null, { name: 'Maria', language: 'Inglês' });
  const b = s.save(null, { name: 'Pedro' });
  assert.equal(b.language, 'Espanhol');
  assert.throws(() => s.save(null, { name: '' }), /nome/);
  const now = Date.now();
  for (let i = 0; i < 8; i++) s.access(a.id, new Date(now - i * 3 * 86400000));
  assert.equal(s.student(a.id).stage, 'ativo');
  const sum = s.summary(now);
  assert.equal(sum.total, 2);
  assert.equal(sum.byStage.ativo, 1);
  assert.equal(sum.byStage.matriculado, 1);
  assert.equal(s.list({}, now).find((x) => x.name === 'Maria').perWeek, 2);
  // Pedro nunca acessou e foi matriculado há 20 dias → em risco
  s.student(b.id).enrolledAt = new Date(now - 20 * 86400000).toISOString();
  assert.deepEqual(s.list({ inactiveDays: 14 }, now).map((x) => x.name), ['Pedro']);
  assert.throws(() => s.save(a.id, { stage: 'zzz' }), /Etapa/);
  assert.throws(() => s.access('nope'), /não encontrado/);
});
