import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Crm } from '../src/crm.js';
import { Sectors, parsePeople } from '../src/sectors.js';
import { Agent } from '../src/agent/agent.js';
import { presetSettings } from '../src/agent/presets.js';
import { tempStore } from './helpers.js';

test('setores: loteamento vai para os atendentes do setor, um de cada vez, com o resumo', async () => {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  auth.create({ name: 'Marcos', login: 'marcos', password: 'segredo123', role: 'admin' });
  const robson = auth.create({ name: 'Robson Lima', login: 'robson', password: 'segredo123', role: 'seller', whatsapp: '595981000001' });
  const crm = new Crm({ store, auth });
  store.updateSettings({ crm: { sectors: { loteamentos: { people: parsePeople('Robson = +595 981 000001\nJulia = +595 982 000002') } } } });
  const sent = [];
  const admins = [];
  const sectors = new Sectors({ store, crm, auth, send: async (phone, text) => sent.push({ phone, text }), notifyAdmins: async (t) => admins.push(t) });
  const conv = { key: '5511911112222@s.whatsapp.net', phone: '5511911112222', name: 'Paula', messages: [{ role: 'user', content: 'Quero falar com o dono do loteamento Novo Brasil' }] };
  const r = await sectors.route(conv, { setor: 'loteamentos', resumo: 'Quer um lote no Novo Brasil', detalhes: 'até R$ 80 mil, à vista' });
  assert.equal(r.ok, true);
  assert.match(r.instrucao, /vai entrar em contato/);
  assert.equal(sent[0].phone, '595981000001');
  assert.match(sent[0].text, /Loteamentos e terrenos \(Migra Imobiliária\)/);
  assert.match(sent[0].text, /https:\/\/wa\.me\/5511911112222/);
  assert.match(sent[0].text, /até R\$ 80 mil/);
  assert.match(sent[0].text, /dono do loteamento Novo Brasil/);
  const lead = crm.findForConversation({ key: conv.key, phone: conv.phone });
  assert.equal(lead.ownerId, robson.id, 'atendente que também é usuário do painel vira o responsável');
  // Rodízio: o próximo vai para a Julia.
  await sectors.route({ ...conv, key: '5511933334444@s.whatsapp.net', phone: '5511933334444' }, { setor: 'loteamentos', resumo: 'terreno' });
  assert.equal(sent[1].phone, '595982000002');
  // Setor sem atendente: avisa o Marcos.
  await sectors.route({ ...conv, key: '5511955556666@s.whatsapp.net', phone: '5511955556666' }, { setor: 'veiculos', resumo: 'quer importar uma Hilux' });
  assert.match(admins[0], /ainda não tem atendente cadastrado/);
});

test('setores no prompt: Migra Imobiliária resolve por aqui e a IA direciona', async () => {
  const store = tempStore();
  store.updateSettings(presetSettings('migra-paraguai'));
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  const seen = [];
  const llm = { configured: true, chat: async ({ messages, tools }) => { seen.push({ system: messages[0].content, tools: tools.map((t) => t.function.name) }); return { content: 'Claro!', tool_calls: [] }; } };
  const agent = new Agent({ store, llm });
  agent.routeSector = async () => ({ ok: true });
  agent.routeSpecialist = async () => ({ ok: true });
  const conv = agent.conversation('5511900001111@s.whatsapp.net');
  agent.remember(conv, 'user', 'Quero falar com o dono do loteamento');
  await agent.think(conv);
  assert.ok(seen[0].tools.includes('direcionar_para_setor'));
  assert.ok(!seen[0].tools.includes('encaminhar_para_especialista'));
  assert.match(seen[0].system, /Migra Imobiliária é a responsável pelos investimentos e pela venda dos lotes/);
  assert.match(seen[0].system, /Para um melhor atendimento, vou direcionar você para o correspondente referente ao seu interesse/);
});
