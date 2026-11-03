import test from 'node:test';
import assert from 'node:assert/strict';
import { Usage, cleanPricing, priceModel, DEFAULT_PRICING } from '../src/usage.js';
import { LLMClient } from '../src/agent/llm.js';
import { tempStore } from './helpers.js';

test('mede tokens por escritório e soma o mês', () => {
  const u = new Usage({ store: tempStore() });
  u.record({ usage: { prompt_tokens: 10000, completion_tokens: 300 }, meta: { kind: 'atendimento', office: 'pr' } });
  u.record({ usage: { prompt_tokens: 2000, completion_tokens: 100 }, meta: { kind: 'resumo', office: 'pr' } });
  u.record({ usage: { prompt_tokens: 9000, completion_tokens: 200 }, meta: { kind: 'atendimento', office: 'py' } });
  u.record({ usage: null, meta: {} });
  u.reply('pr'); u.reply('py');
  const month = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
  const pr = u.month(month, 'pr');
  assert.deepEqual([pr.atendimento.inTok, pr.atendimento.outTok, pr.outros.inTok, pr.replies], [10000, 300, 2000, 1]);
  assert.equal(u.month(month).replies, 2);
  assert.equal(u.month('1999-01').replies, 0);
});

test('a LLM avisa o consumo de cada chamada, sem nunca derrubar o atendimento', async () => {
  const seen = [];
  const fakeFetch = async () => ({ ok: true, status: 200, headers: new Map(), json: async () => ({ choices: [{ message: { content: 'oi' } }], usage: { prompt_tokens: 123, completion_tokens: 7 } }) });
  const llm = new LLMClient({ getConfig: () => ({ provider: 'gemini', apiKey: 'k', model: 'm' }), fetchImpl: fakeFetch });
  llm.onUsage = (x) => seen.push(x);
  await llm.chat({ messages: [{ role: 'user', content: 'x' }], meta: { kind: 'atendimento', office: 'pr' } });
  assert.deepEqual([seen[0].usage.prompt_tokens, seen[0].meta.office], [123, 'pr']);
  llm.onUsage = () => { throw new Error('falha na medição'); };
  assert.equal((await llm.chat({ messages: [{ role: 'user', content: 'x' }] })).content, 'oi');
});

test('preço: custo por resposta, rateio, suporte, margem e excedente', () => {
  const cfg = cleanPricing({ inPerM: 0.5, outPerM: 3, usdBrl: 5, fixedBrl: 300, clients: 3, supportHours: 2, hourBrl: 50, markupPct: 200, setupBrl: 1500 });
  const measured = { atendimento: { calls: 100, inTok: 1_800_000, outTok: 40_000 }, outros: { calls: 0, inTok: 0, outTok: 0 }, replies: 100 };
  const m = priceModel(measured, cfg, { tiers: [1000] });
  assert.equal(m.measuredData, true);
  assert.deepEqual([m.inPerReply, m.outPerReply], [18000, 400]);
  // (18000*0,5 + 400*3)/1e6 = 0,0102 US$ → R$ 0,051 por resposta
  assert.equal(m.usdPerReply, 0.0102);
  assert.equal(m.brlPerReply, 0.051);
  const p = m.plans[0];
  assert.equal(p.variable, 51);
  assert.equal(p.fixed, 100);
  assert.equal(p.support, 100);
  assert.equal(p.cost, 251);
  assert.equal(p.price, 760, 'custo x 3, arredondado para cima de 10 em 10');
  assert.equal(p.marginPct, 67);
  assert.equal(m.overagePer100, 15.3);
  assert.equal(m.configured, true);
  // sem preços do Google digitados: avisa e não inventa
  const empty = priceModel({ atendimento: { calls: 0, inTok: 0, outTok: 0 }, outros: { calls: 0, inTok: 0, outTok: 0 }, replies: 0 }, DEFAULT_PRICING);
  assert.equal(empty.configured, false);
  assert.equal(empty.brlPerReply, 0);
  assert.equal(empty.measuredData, false);
  assert.deepEqual(cleanPricing({ inPerM: -5, markupPct: 'abc', clients: 0 }), { ...DEFAULT_PRICING, inPerM: 0, markupPct: 0, clients: 1 });
});

import { historyReport } from '../src/usage.js';
test('calibra com o gasto real: mensagens do período, custo por mensagem e projeção de 30 dias', () => {
  const at = (d) => `${d}T15:00:00Z`;
  const conv = (msgs) => ({ key: 'k', messages: msgs.map(([role, d]) => ({ role, content: 'x', at: at(d) })) });
  const convs = [
    conv([['user', '2026-10-01'], ['assistant', '2026-10-01'], ['assistant', '2026-10-01'], ['assistant', '2026-10-10']]),
    conv([['assistant', '2026-10-10'], ['assistant', '2026-10-10'], ['assistant', '2026-10-20']]),
    { ...conv([['assistant', '2026-10-05']]), simulation: true },
  ];
  const r = historyReport(convs, { totalCostBrl: 415.83, markupPct: 200, extraMonthlyBrl: 100 });
  assert.equal(r.messages, 6, 'simulações não contam');
  assert.deepEqual([r.start, r.end, r.periodDays], ['2026-10-01', '2026-10-20', 20]);
  assert.equal(r.costPerMessage, 69.305);
  assert.equal(r.monthlyMessages, 9);
  assert.equal(r.monthlyCost, 623.75, '415,83 ÷ 20 dias × 30');
  assert.equal(r.totalMonthlyCost, 723.75);
  assert.equal(r.price, 2180, 'custo total × 3, arredondado para cima de 10 em 10');
  assert.equal(r.marginPct, 67);
  const only = historyReport(convs, { totalCostBrl: 100, from: '2026-10-10', to: '2026-10-10' });
  assert.deepEqual([only.messages, only.periodDays], [3, 1]);
  assert.equal(historyReport([], { totalCostBrl: 1 }).empty, true);
});

test('memória das conversas vira contagem estimada uma vez só; medição exata soma por cima; resumo por mês e custo por resposta', () => {
  const store = tempStore();
  const u = new Usage({ store });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  store.data.usage.since = today; // a medição exata começou hoje
  const at = (d) => `${d}T15:00:00Z`;
  const convs = [
    { key: 'a', messages: [{ role: 'user', content: 'x', at: at('2026-10-30') }, { role: 'assistant', content: 'x', at: at('2026-10-30') }, { role: 'assistant', content: 'x', at: at('2026-10-31') }, { role: 'assistant', content: 'x', at: `${today}T15:00:00Z` }] },
    { key: 'b', messages: [{ role: 'assistant', content: 'x', at: at('2026-10-31') }] },
    { key: 'sim', simulation: true, messages: [{ role: 'assistant', content: 'x', at: at('2026-10-31') }] },
  ];
  const b = u.backfill(convs, (c) => (c.key === 'b' ? 'pr' : 'py'));
  assert.deepEqual([b.messages, b.from, b.to], [3, '2026-10-30', '2026-10-31'], 'só antes da medição exata; simulação não conta');
  assert.equal(u.backfill(convs).messages, 3, 'não conta de novo');
  u.reply('py'); u.reply('pr');
  const now = new Date();
  const all = u.summary('', now);
  assert.deepEqual([all.estimatedReplies, all.measuredReplies, all.total], [3, 2, 5]);
  assert.equal(u.summary('pr', now).total, 2, '1 estimada + 1 medida do Paraná');
  assert.deepEqual(all.byMonth.map((m) => [m.month, m.estimated, m.replies]), [['2026-10', 3, 0], [today.slice(0, 7), 0, 2]]);
  assert.equal(all.first, '2026-10-30');
  // estimadas não entram na média de tokens por resposta
  assert.equal(u.month('2026-10').replies, 0);
});
