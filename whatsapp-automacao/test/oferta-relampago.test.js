import test from 'node:test';
import assert from 'node:assert/strict';
import { Agent } from '../src/agent/agent.js';
import { LocalCalendar } from '../src/agent/calendar.js';
import { presetSettings } from '../src/agent/presets.js';
import { SALES_PLAYBOOK } from '../src/agent/vendas-playbook.js';
import { applyQualification, strategyFor } from '../src/qualificacao.js';
import { tempStore } from './helpers.js';

async function promptAt(T) {
  const store = tempStore();
  store.updateSettings(presetSettings('clinica-sorriso'));
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  let system = '';
  const llm = { configured: true, async chat({ messages }) { system = messages[0].content; return { content: 'ok', tool_calls: [] }; } };
  const agent = new Agent({ store, llm, calendar: new LocalCalendar({ store, getConfig: () => store.settings.agenda, now: () => T }), now: () => T });
  await agent.handleIncoming({ key: 'k1', phone: '5511999990001', name: 'Rita', text: 'oi' }, async () => {});
  return system;
}

test('oferta relâmpago: entra no prompt até 12/11 com a condição "à vista" e some depois da data', async () => {
  const dentro = await promptAt(new Date(2026, 10, 12, 20, 0)); // quinta, 12/11
  assert.match(dentro, /OFERTA RELÂMPAGO EM VIGOR/);
  assert.match(dentro, /vale até 12\/11\/2026/);
  assert.match(dentro, /pagar à vista/);
  assert.match(dentro, /NÃO tem direito ao brinde/);
  assert.match(dentro, /não diga que o aplicativo equivale a esse valor/);
  assert.match(dentro, /depois de 12\/11\/2026, não fale mais da oferta/);
  const fora = await promptAt(new Date(2026, 10, 13, 9, 0));
  assert.doesNotMatch(fora, /OFERTA RELÂMPAGO EM VIGOR/);
});

test('sem condições agora: a IA pergunta a previsão, agenda o retorno e não desmerece; o plano em PDF vem depois', () => {
  assert.match(SALES_PLAYBOOK, /nunca desmereça ninguém/i);
  assert.match(SALES_PLAYBOOK, /previsão de quando consegue ter esse valor/);
  assert.match(SALES_PLAYBOOK, /agendar_retorno/);
  const c = {};
  const r = applyQualification(c, { capacidade: 'nao', evidencia: 'agora não tenho', previsao: 'quando vender o carro, mais ou menos em março' });
  assert.equal(c.qualificacao.previsao, 'quando vender o carro, mais ou menos em março');
  assert.match(r.instrucao, /previsão de quando consegue ter esse valor/);
  assert.match(r.instrucao, /não pressione/);
  assert.match(r.instrucao, /Plano em PDF/);
  assert.match(strategyFor(c.qualificacao), /Previsão dele: quando vender o carro/);
  applyQualification(c, { capacidade: 'sim', evidencia: 'posso à vista', oferta_relampago: 'vai_a_vista' });
  assert.equal(c.qualificacao.oferta, 'vai_a_vista');
  assert.equal(applyQualification(c, { capacidade: 'sim', evidencia: 'x', oferta_relampago: 'invalida' }).ok, true);
  assert.equal(c.qualificacao.oferta, 'vai_a_vista', 'valor inválido não apaga o que já estava');
});

import { FlashOffer } from '../src/flash-offer.js';

test('vagas reais da oferta: conta as 20 vagas, uma por conversa, expira reserva sem pagamento, confirma e libera', () => {
  const store = tempStore();
  let t = Date.parse('2026-11-09T12:00:00Z');
  const f = new FlashOffer({ store, now: () => t });
  assert.deepEqual([f.status().total, f.status().left, f.status().open], [20, 20, true]);
  const a = f.claim({ convKey: 'c1', name: 'Ana', phone: '5511900000001' });
  assert.equal(a.ok, true); assert.equal(a.left, 19);
  assert.equal(f.claim({ convKey: 'c1' }).ja, true, 'a mesma conversa não ocupa duas vagas');
  assert.equal(f.status().left, 19);
  for (let i = 2; i <= 20; i++) f.claim({ convKey: `c${i}` });
  assert.equal(f.status().left, 0);
  assert.deepEqual(f.claim({ convKey: 'c99' }), { ok: false, motivo: 'esgotada', left: 0 });
  f.confirm(a.id, 'Marcos');
  assert.throws(() => f.release(a.id), /já foi confirmada/);
  t += 49 * 3_600_000; // as reservas sem pagamento expiram em 48 h e as vagas voltam (a confirmada fica)
  assert.equal(f.status().left, 19);
  assert.equal(f.status().confirmed, 1);
  const rel = f.list().find((c) => c.status === 'expirada');
  assert.ok(rel);
  t = Date.parse('2026-11-13T09:00:00Z'); // depois do dia 12 a oferta encerra
  assert.equal(f.status().open, false);
  assert.deepEqual(f.claim({ convKey: 'novo' }), { ok: false, motivo: 'encerrada', left: 0 });
});

test('vagas no prompt: a IA recebe o número real e, esgotado, é mandada parar de falar da oferta', async () => {
  const T = new Date(2026, 10, 10, 10, 0);
  const store = tempStore();
  store.updateSettings(presetSettings('clinica-sorriso'));
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  let system = '';
  const llm = { configured: true, async chat({ messages }) { system = messages.map((m) => m.content).join('\n'); return { content: 'ok', tool_calls: [] }; } };
  const agent = new Agent({ store, llm, calendar: new LocalCalendar({ store, getConfig: () => store.settings.agenda, now: () => T }), now: () => T });
  agent.flashStatus = () => ({ open: true, total: 20, left: 7 });
  await agent.handleIncoming({ key: 'k1', phone: '5511999990001', name: 'Rita', text: 'oi' }, async () => {});
  assert.match(system, /Restam 7 de 20 vagas/);
  assert.match(system, /próximas 20 pessoas/);
  assert.match(system, /nunca invente número/);
  agent.flashStatus = () => ({ open: true, total: 20, left: 0 });
  await agent.handleIncoming({ key: 'k2', phone: '5511999990002', name: 'Rita', text: 'oi' }, async () => {});
  assert.match(system, /vagas ESGOTARAM/);
});

import { roundedPeople, peopleLabel, buildCaption } from '../src/flash-offer.js';
import { pickNext, isFresh } from '../src/queue-priority.js';

test('"mais de X pessoas": arredonda para baixo na centena, como o Manderson pediu', () => {
  const casos = [[2050, 2000], [1500, 1500], [1000, 1000], [999, 900], [990, 900], [1001, 1000], [1099, 1000], [1101, 1100], [1100, 1100], [87, 0]];
  for (const [n, esperado] of casos) assert.equal(roundedPeople(n), esperado, `${n} → ${esperado}`);
  assert.equal(peopleLabel(1101), 'mais de 1.100 pessoas');
  assert.equal(peopleLabel(999), 'mais de 900 pessoas');
  assert.equal(peopleLabel(50), '', 'sem número redondo confiável, não cita');
});

test('legenda dos grupos: curta, com destaques do WhatsApp, o número arredondado, "à vista ou até 3x" e o link', () => {
  const link = 'https://wa.me/5959871015670?text=Oi';
  const t = buildCaption({ people: 1101, link });
  assert.match(t, /^\*OFERTA RELÂMPAGO ATÉ QUINTA-FEIRA, 12\/11\*/);
  assert.match(t, /Entre mais de 1\.100 pessoas dos nossos grupos, \*só 20\*/);
  assert.match(t, /\*1 ano de curso de idiomas\*/);
  assert.match(t, /de R\$ 3 mil a R\$ 10 mil/);
  assert.match(t, /\*À vista\* ou em até \*3x no cartão\*/);
  assert.match(t, /Quer garantir a sua vaga\? Clique aqui:\*\nhttps:\/\/wa\.me\//);
  assert.ok(t.length < 700, 'texto curto');
  assert.doesNotMatch(buildCaption({ people: 0, link }), /mais de/);
});

test('fila: cliente novo passa na frente, mas os antigos saem aos poucos (1 a cada 4)', () => {
  const NOW = Date.parse('2026-11-09T12:00:00Z');
  const h = (n) => NOW - n * 3_600_000;
  const items = { n1: { at: h(0.2) }, n2: { at: h(0.5) }, n3: { at: h(1) }, n4: { at: h(2) }, n5: { at: h(2.5) }, v1: { at: h(100), kind: 'retomar', restart: true }, v2: { at: h(200) } };
  assert.equal(isFresh(items.n1, NOW), true);
  assert.equal(isFresh(items.v1, NOW), false);
  assert.equal(isFresh(items.v2, NOW), false);
  const q = Object.keys(items); const state = { n: 0 }; const order = [];
  while (q.length) { const j = pickNext(q, items, { now: NOW, state }); order.push(j); q.splice(q.indexOf(j), 1); }
  assert.deepEqual(order.slice(0, 4), ['n5', 'n4', 'n3', 'v2'], 'novos primeiro; o 4º atendimento é um antigo (o mais antigo)');
  assert.equal(order[4], 'n2');
  assert.deepEqual(pickNext(['v1'], items, { now: NOW }), 'v1', 'sem novos, atende os antigos');
  assert.equal(pickNext([], items), null);
});
