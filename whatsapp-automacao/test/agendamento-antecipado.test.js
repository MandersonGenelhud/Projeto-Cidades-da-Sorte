import test from 'node:test';
import assert from 'node:assert/strict';
import { Agent } from '../src/agent/agent.js';
import { Visits } from '../src/visits.js';
import { presetSettings } from '../src/agent/presets.js';
import { tempStore } from './helpers.js';

async function systemFor(settings, { isClient = false } = {}) {
  const store = tempStore();
  store.updateSettings(presetSettings('migra-paraguai'));
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  store.updateSettings(settings);
  let system = '';
  const llm = { configured: true, chat: async ({ messages }) => { system = messages[0].content; return { content: 'ok', tool_calls: [] }; } };
  const agent = new Agent({ store, llm, now: () => new Date(2026, 9, 26, 9, 5) });
  agent.requestVisit = async () => ({ ok: true });
  agent.notifyOwner = async () => ({ ok: true });
  agent.bookMentoring = async () => ({ ok: true });
  agent.isClient = () => isClient;
  const conv = agent.conversation('5511999990000@s.whatsapp.net');
  agent.remember(conv, 'user', 'Quero ir até o escritório');
  await agent.think(conv);
  return system;
}

test('quem fala em vir ao escritório ouve que o atendimento é por horário agendado e os dois valores: Marcos e equipe, em dólares', async () => {
  const system = await systemFor({ visits: { consultFeeUsd: 50 }, crm: { mentoring: { enabled: true, price: 400 } } });
  assert.match(system, /# Agendamento antecipado/);
  assert.match(system, /ATENDIMENTO POR HORÁRIO AGENDADO/);
  assert.match(system, /RESERVAR COM ANTECEDÊNCIA/);
  assert.match(system, /Falar diretamente com o Marcos Miguel: é a mentoria, 400 dólares americanos \(US\$ 400\) por hora/);
  assert.match(system, /Falar com a equipe de assessoria[^\n]*50 dólares americanos \(US\$ 50\)[^\n]*ESTORNADO/);
});

test('sem o valor em dólares da equipe, usa o valor em reais; cliente da Migra não ouve valores', async () => {
  const sem = await systemFor({ visits: { consultFeeUsd: 0, consultFee: 250 } });
  assert.match(sem, /Falar com a equipe de assessoria[^\n]*R\$ 250,00/);
  const cliente = await systemFor({ visits: { consultFeeUsd: 50 } }, { isClient: true });
  assert.doesNotMatch(cliente, /# Agendamento antecipado/);
});

test('taxa da visita em dólares: o Pix sai em reais pela cotação do painel', () => {
  const store = tempStore();
  store.updateSettings({ visits: { consultFeeUsd: 50 }, crm: { fx: { USD: 5.5 } } });
  const v = new Visits({ store, crm: { byId: () => null, addNote() {} } });
  assert.equal(v.feeUsd, 50);
  assert.equal(v.fee, 275);
  assert.match(v.feeLabel, /50 dólares americanos \(US\$ 50\)/);
  store.updateSettings({ visits: { consultFeeUsd: 0, consultFee: 250 } });
  assert.equal(v.fee, 250);
  assert.match(v.feeLabel, /R\$ 250,00/);
});
