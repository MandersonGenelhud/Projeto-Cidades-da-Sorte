import test from 'node:test';
import assert from 'node:assert/strict';
import { Collections, messageFor, tier } from '../src/collections.js';
import { tempStore } from './helpers.js';

const mkSales = () => ({ list: [
  { id: 's1', number: 'ANT-1', legacyNumber: '2026-000215', status: 'ativa', client: { nome: 'ANA PAULA PAMPLONA', doc: '055.206.419-43' }, parcels: [
    { label: 'Parcela 1', value: 3400, due: '2026-10-25', status: 'pendente' }, // 9 dias
    { label: 'Parcela 2', value: 5160, due: '2026-08-01', status: 'pendente' }, // 94 dias
    { label: 'Parcela 3', value: 1000, due: '2026-12-10', status: 'pendente' },
    { label: 'Entrada', value: 1800, due: '2026-05-01', status: 'pago', paidAt: '2026-05-02' } ] },
  { id: 's2', number: 'V-2', status: 'ativa', client: { nome: 'Carlos', doc: '' }, parcels: [{ label: 'Parcela 1', value: 500, due: '2026-10-01', status: 'pendente' }] },
  { id: 's3', number: 'V-3', status: 'cancelada', client: { nome: 'X' }, parcels: [{ label: 'P', value: 99, due: '2026-01-01', status: 'pendente' }] },
] });

function setup(now = new Date('2026-11-03T10:00:00')) {
  const store = tempStore(); const sent = []; let clock = now; let connected = true;
  const sales = mkSales();
  const c = new Collections({ store, sales, resolvePhone: (s) => (s.id === 's1' ? '595981000111' : ''), send: async (p, t) => sent.push({ p, t }), canSend: () => connected, now: () => clock });
  return { c, sent, sales, setNow: (d) => { clock = d; }, setConnected: (v) => { connected = v; } };
}

test('cobrança: lista só o vencido e não cancelado, com faixa de atraso e total', () => {
  const { c } = setup();
  const rows = c.overdue();
  assert.deepEqual(rows.map((r) => [r.number, r.label, r.daysLate, r.tier]), [['2026-000215', 'Parcela 2', 94, 'firme'], ['V-2', 'Parcela 1', 33, 'medio'], ['2026-000215', 'Parcela 1', 9, 'leve']]);
  const s = c.summary(rows);
  assert.equal(s.valor, 9060);
  assert.equal(s.semTelefone, 1);
  assert.deepEqual([tier(15), tier(16), tier(60), tier(61)], ['leve', 'medio', 'medio', 'firme']);
});

test('cobrança: o texto muda com o atraso, é educado e oferece Pix ou cartão', () => {
  const base = { client: 'ANA PAULA PAMPLONA', number: '2026-000215', label: 'Parcela 1', value: 3400, due: '2026-10-25' };
  const leve = messageFor({ ...base, daysLate: 9 }); const firme = messageFor({ ...base, daysLate: 94 });
  assert.match(leve, /Olá, Ana!/); assert.match(leve, /lembrar com carinho/); assert.match(leve, /R\$ 3\.400,00/); assert.match(leve, /25\/10\/2026/);
  assert.match(firme, /há 94 dias/); assert.match(firme, /Pix ou no cartão/); assert.match(firme, /comprovante/);
  assert.doesNotMatch(`${leve}${firme}`, /ação judicial|protesto|SPC|Serasa|polícia/i, 'sem ameaça');
});

test('cobrança: só envia depois de aprovar, respeita limite, horário, intervalo e não repete aviso recente', async () => {
  const { c, sent, setNow, setConnected } = setup();
  assert.equal(await c.tick(), null, 'sem aprovação nada sai');
  const out = c.enqueue(['s1:0', 's1:1', 's2:0', 's9:0', 's1:2'], 'Marcos');
  assert.equal(out.queued, 2);
  assert.deepEqual(out.skipped.map((x) => x.motivo).sort(), ['parcela não está mais vencida', 'parcela não está mais vencida', 'sem telefone']);
  c.setConfig({ perDay: 1, minGapSec: 20, maxGapSec: 20 });
  setConnected(false); assert.equal(await c.tick(), null, 'WhatsApp desligado');
  setConnected(true);
  setNow(new Date('2026-11-03T22:00:00')); assert.equal(await c.tick(), null, 'fora do horário');
  setNow(new Date('2026-11-08T10:00:00')); assert.equal(await c.tick(), null, 'domingo');
  setNow(new Date('2026-11-09T10:00:00'));
  const first = await c.tick();
  assert.equal(first.ok, true);
  assert.equal(sent[0].p, '595981000111');
  assert.equal(await c.tick(), null, 'limite de 1 por dia');
  assert.equal(c.status().queued, 1);
  // mesma parcela já avisada: não entra de novo por 7 dias
  setNow(new Date('2026-11-10T10:00:00'));
  assert.equal(c.enqueue(['s1:0'], 'M').skipped[0].motivo, 'já avisado há menos de 7 dias');
  assert.throws(() => c.setConfig({ perDay: 500 }), /1 a 40/);
  assert.throws(() => c.setConfig({ fromHour: 20, toHour: 10 }), /depois do inicial/);
});

test('cobrança: se o vendedor avisou o pagamento ou a parcela foi paga depois de aprovar, não manda', async () => {
  const { c, sales, sent, setNow } = setup(new Date('2026-11-04T10:00:00'));
  c.enqueue(['s1:0', 's1:1'], 'M');
  sales.list[0].parcels[0].status = 'pago';
  sales.list[0].parcels[1].claim = { by: 'Diego' };
  c.setConfig({ minGapSec: 20, maxGapSec: 20 });
  const a = await c.tick();
  assert.match(a.skip, /não precisa mais/);
  setNow(new Date('2026-11-04T10:05:00'));
  assert.match((await c.tick()).skip, /não precisa mais/);
  assert.equal(sent.length, 0);
  assert.equal(c.enqueue(['s1:1'], 'M').skipped[0].motivo.includes('vendedor avisou'), true);
});

test('previsão: soma o que vence em cada mês, o atrasado e o recebido', () => {
  const { c } = setup();
  const f = c.forecast();
  assert.equal(f.overdue, 9060);
  assert.equal(f.overdueCount, 3);
  assert.equal(f.totalOpen, 10060);
  assert.deepEqual(f.months.find((m) => m.month === '2026-12'), { month: '2026-12', toReceive: 1000, received: 0, count: 1 });
  assert.equal(f.months.find((m) => m.month === '2026-05').received, 1800);
});
