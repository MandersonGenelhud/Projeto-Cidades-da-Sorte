import test from 'node:test';
import assert from 'node:assert/strict';
import { applyQualification, qualBlock, qualRank, strategyFor, READ_ANSWERS } from '../src/qualificacao.js';
import { TOOL_DEFINITIONS } from '../src/agent/tools.js';
import { buildPlan } from '../src/atendimento-plano.js';

test('termômetro: "tem condições" só vale com a frase do cliente; a estratégia muda conforme a capacidade', () => {
  const c = { messages: [] };
  const sem = applyQualification(c, { capacidade: 'sim' });
  assert.equal(c.qualificacao.capacidade, 'desconhecida', 'sem evidência não se supõe dinheiro');
  assert.match(sem.instrucao, /NÃO SABEMOS/);
  const sim = applyQualification(c, { capacidade: 'sim', evidencia: 'tenho os mil reais', urgencia: 'agora' });
  assert.match(sim.instrucao, /parta para o fechamento/);
  assert.match(sim.instrucao, /feche hoje/);
  assert.match(applyQualification(c, { capacidade: 'parcial', evidencia: 'só depois do salário' }).instrucao, /agendar_retorno/);
  const nao = applyQualification(c, { capacidade: 'nao', evidencia: 'estou sem dinheiro' }).instrucao;
  assert.match(nao, /não pressione/);
  assert.doesNotMatch(nao, /parta para o fechamento/);
  assert.match(strategyFor({ capacidade: 'sim', decisor: 'conjuge_familia', urgencia: 'este_mes' }), /videochamada com o casal/);
  assert.equal(applyQualification(c, { capacidade: 'valor-inventado' }).qualificacao, 'desconhecida');
});

test('termômetro: dryRun (simulador) não grava; o bloco do prompt mostra o que já se sabe; ferramenta e regras existem', () => {
  const c = {};
  applyQualification(c, { capacidade: 'sim', evidencia: 'posso pagar' }, { dryRun: true });
  assert.equal(c.qualificacao, undefined);
  applyQualification(c, { capacidade: 'parcial', evidencia: 'só dia 10', objecoes: 'prazo' });
  const b = qualBlock(c);
  assert.match(b, /em parte \("só dia 10"\)/);
  assert.match(b, /não pergunte de novo/);
  assert.equal(qualBlock({}), '');
  assert.ok(TOOL_DEFINITIONS.some((t) => t.function.name === 'registrar_qualificacao'));
  assert.match(READ_ANSWERS, /TEM CONDIÇÕES/);
  assert.ok(qualRank({ qualificacao: { capacidade: 'sim' } }) < qualRank({}) && qualRank({}) < qualRank({ qualificacao: { capacidade: 'nao' } }));
});

test('plano: o que será retomado vem separado por condição de fechar', () => {
  const NOW = Date.parse('2026-11-08T15:00:00Z');
  const mk = (n, q) => ({ key: `55119000000${n}`, phone: `55119000000${n}`, qualificacao: q ? { capacidade: q } : undefined, messages: [{ role: 'user', content: 'quero saber', at: new Date(NOW - 30 * 3_600_000).toISOString() }] });
  const convs = [mk(1, 'sim'), mk(2, 'parcial'), mk(3, 'nao'), mk(4, null)];
  const p = buildPlan({ store: { data: { conversations: Object.fromEntries(convs.map((c) => [c.key, c])) } }, now: NOW });
  assert.equal(p.retomar, 4);
  assert.deepEqual(p.retomarPorCondicao, { sim: 1, parcial: 1, nao: 1, desconhecida: 1 });
});

import { Agent } from '../src/agent/agent.js';
import { LocalCalendar } from '../src/agent/calendar.js';
import { presetSettings } from '../src/agent/presets.js';
import { tempStore } from './helpers.js';

test('na Migra (sem agenda) a IA de fechamento recebe de fato as ferramentas do termômetro, do plano em PDF e do retorno', async () => {
  const T = new Date(2026, 10, 10, 10, 0);
  const store = tempStore();
  store.updateSettings(presetSettings('migra-paraguai'));
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  let tools = []; let system = '';
  const llm = { configured: true, async chat({ messages, tools: t }) { system = messages[0].content; tools = t.map((x) => x.function.name); return { content: 'ok', tool_calls: [] }; } };
  const agent = new Agent({ store, llm, calendar: new LocalCalendar({ store, getConfig: () => store.settings.agenda, now: () => T }), now: () => T });
  agent.sendForm = async () => ({}); agent.sendQuote = async () => ({}); agent.closeHandoff = async () => ({}); agent.scheduleReturn = async () => ({}); agent.offerPlanPdf = async () => ({});
  await agent.handleIncoming({ key: 'k', phone: '5511999990001', name: 'Rita', text: 'oi' }, async () => {});
  for (const n of ['registrar_qualificacao', 'oferecer_plano_pdf', 'agendar_retorno', 'gerar_orcamento', 'enviar_ficha_de_dados']) assert.ok(tools.includes(n), `falta a ferramenta ${n}`);
  assert.match(system, /Seu método de vendas/);
  assert.match(system, /Leia cada resposta e saiba o que fazer/);
});
