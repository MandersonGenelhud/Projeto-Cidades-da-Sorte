import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyTermsToSettings, applyTermsToPlan, REPLACEMENTS } from '../src/payment-terms.js';
import { paymentPlan, planMessage, DEFAULT_STEPS } from '../src/payplan.js';
import { PRESETS } from '../src/agent/presets.js';
import { Store } from '../src/store.js';

const OLD_NOTES = ['Na sua primeira vinda ao Paraguai', 'Na sua segunda vinda ao Paraguai', 'Quando retirar os documentos'];

test('plano padrão: valores iguais (50/30/20), prazos novos e sem data fixa na mensagem de pagamento', () => {
  const plan = paymentPlan({ price: 12997, people: 1, adults: 1, start: '2026-11-10' });
  assert.deepEqual(plan.parcels.map((x) => x.pct), [50, 30, 20]);
  assert.equal(plan.parcels.reduce((a, x) => a + x.value, plan.entry), plan.total);
  assert.ok(plan.parcels.every((x) => x.trip));
  const msg = planMessage(plan, { packageName: 'Ouro' });
  assert.match(msg, /Na 1ª vinda ao Paraguai/);
  assert.match(msg, /De 60 a 90 dias após a 1ª vinda/);
  assert.match(msg, /30 dias após pagar a 2ª parcela/i);
  assert.doesNotMatch(msg, /Com 15 dias|segunda vinda|retirar os documentos/i);
  assert.doesNotMatch(msg, /\d{2}\/\d{2}\/\d{4}.*parcela/, 'sem data fixa nas parcelas');
});

test('conhecimento da IA nas instalações novas usa a regra nova (nada de "cerca de 15/90/120 dias")', () => {
  const all = JSON.stringify(PRESETS['migra-paraguai']);
  assert.doesNotMatch(all, /cerca de 15 dias|cerca de 90 dias|cerca de 120 dias/);
  assert.match(all, /entre 60 e 90 dias após a primeira vinda/);
});

test('troca dos textos antigos já guardados: só o texto exato antigo; o que foi editado fica; plano personalizado não é mexido', () => {
  const [oldKnow] = REPLACEMENTS[0];
  const settings = { business: { knowledge: `Início. ${oldKnow} Fim editado pelo Marcos.` }, agent: { instructions: 'Texto totalmente diferente do Marcos.' } };
  assert.equal(applyTermsToSettings(settings), 1);
  assert.match(settings.business.knowledge, /^Início\. 1ª parcela \(50%\) com vencimento ou data de pagamento na primeira vinda ao Paraguai/);
  assert.match(settings.business.knowledge, /Fim editado pelo Marcos\.$/);
  assert.equal(settings.agent.instructions, 'Texto totalmente diferente do Marcos.');
  assert.equal(applyTermsToSettings(settings), 0, 'rodar de novo não muda nada');

  const plano = { parcels: [50, 30, 20].map((pct, i) => ({ pct, value: 100, note: OLD_NOTES[i], when: 'Com X dias' })) };
  assert.equal(applyTermsToPlan(plano), true);
  assert.ok(plano.parcels.every((x) => x.trip));
  assert.equal(plano.parcels[1].note, 'Vencimento previsto entre 60 e 90 dias após a primeira vinda ao Paraguai');
  assert.equal(plano.parcels[0].value, 100, 'valores intactos');
  assert.equal(applyTermsToPlan({ custom: true, parcels: plano.parcels.map((x) => ({ ...x, trip: false, note: OLD_NOTES[0] })) }), false, 'combinado pelo vendedor não muda');
  assert.equal(applyTermsToPlan({ parcels: [{ note: 'Combinado' }, { note: 'x' }, { note: 'y' }] }), false);
});

test('ao iniciar: o Store troca os textos antigos uma vez e não mexe em valores nem em plano combinado', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-prazos-'));
  const a = new Store(dir);
  a.data.termsMigration2026 = false; // simula instalação antiga
  const antigo = { total: 1000, parcels: [50, 30, 20].map((pct, i) => ({ pct, value: pct * 10, note: OLD_NOTES[i], when: 'Com 15 dias' })) };
  const combinado = { total: 1000, custom: true, parcels: [{ pct: 100, value: 1000, note: 'Conforme combinado', when: 'Com 30 dias' }] };
  a.data.quotes = [{ id: 'q1', plan: antigo }, { id: 'q2', plan: combinado }];
  a.data.payplans = [{ id: 'p1', plan: JSON.parse(JSON.stringify(antigo)) }];
  a.updateSettings({ business: { knowledge: `Pagamento: ${REPLACEMENTS[1][0]}.` } });
  a.flush();
  const b = new Store(dir);
  assert.equal(b.data.termsMigration2026, true);
  assert.ok(b.data.quotes[0].plan.parcels.every((x) => x.trip));
  assert.deepEqual(b.data.quotes[0].plan.parcels.map((x) => x.value), [500, 300, 200]);
  assert.equal(b.data.quotes[1].plan.parcels[0].note, 'Conforme combinado');
  assert.ok(b.data.payplans[0].plan.parcels.every((x) => x.trip));
  assert.match(b.settings.business.knowledge, /entre 60 e 90 dias após a primeira vinda/);
  assert.equal(DEFAULT_STEPS.length, 3);
});
