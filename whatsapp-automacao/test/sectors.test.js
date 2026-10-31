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

test('nova divisão da equipe: setores só com o nome usam o WhatsApp da Equipe e o Marcos não recebe vendas', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { Store } = await import('../src/store.js');
  const { resolvePeople, isOwner } = await import('../src/sectors.js');
  // Instalação existente (antes da mudança): Marcos no rodízio e setores vazios.
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const marcos = auth.create({ name: 'Marcos Miguel', login: 'marcos', password: 'segredo123', role: 'admin', whatsapp: '595981000000', receivesLeads: true });
  auth.create({ name: 'Camila Souza', login: 'camila', password: 'segredo123', role: 'seller', whatsapp: '5545999990001' });
  auth.create({ name: 'Silvani Nunes', login: 'silvani', password: 'segredo123', role: 'seller', whatsapp: '5545999990002' });
  auth.create({ name: 'Gabriel', login: 'gabriel', password: 'segredo123', role: 'seller', whatsapp: '5545999990003' });
  store.data.settings.crm.teamRouting2026 = false;
  store.flush();
  // Ao reabrir, a divisão nova é aplicada uma vez.
  const again = new Store(path.dirname(store.file));
  const s = again.data.settings;
  assert.deepEqual(s.crm.sectors.documentacao.people.map((p) => p.name), ['Camila', 'Fran']);
  assert.deepEqual(s.crm.sectors.loteamentos.people.map((p) => p.name), ['Gabriel', 'Diego']);
  assert.deepEqual(s.crm.sectors.veiculos.people.map((p) => p.name), ['Eliezer']);
  assert.deepEqual(s.visits.people.map((p) => p.name), ['Silvani']);
  assert.equal(again.data.users.find((u) => u.id === marcos.id).receivesLeads, false, 'Marcos sai do rodízio');
  // Só quem está na Equipe com WhatsApp entra (Fran e Diego ainda não estão cadastrados).
  const users = again.data.users;
  assert.deepEqual(resolvePeople(s.crm.sectors.documentacao.people, users), [{ name: 'Camila', whatsapp: '5545999990001' }]);
  assert.deepEqual(resolvePeople(s.visits.people, users), [{ name: 'Silvani', whatsapp: '5545999990002' }]);
  assert.equal(resolvePeople([{ name: 'Fran', whatsapp: '5545999990009' }], users)[0].whatsapp, '5545999990009', 'com número escrito, vale o número');
  assert.equal(isOwner({ name: 'Marcos Miguel' }), true);
  assert.equal(isOwner({ name: 'Camila', whatsapp: '595981000000' }, '+595 981 000000'), true, 'pelo WhatsApp do dono');
  assert.equal(isOwner({ name: 'Camila Souza', whatsapp: '5545999990001' }, '+595 981 000000'), false);
  // Mexeu no painel depois: não volta a sobrescrever.
  again.updateSettings({ crm: { sectors: { veiculos: { people: [{ name: 'Outro', whatsapp: '5545999990005' }] } } } });
  again.flush();
  assert.equal(new Store(path.dirname(store.file)).data.settings.crm.sectors.veiculos.people[0].name, 'Outro');
  assert.ok(fs.existsSync(store.file));
});

test('quem quer trabalhar na Migra vai para o Gabriel; parceria imobiliária vai para Gabriel e Diego, outras parcerias com o Marcos', async () => {
  const { Agent } = await import('../src/agent/agent.js');
  const store = tempStore();
  store.updateSettings(presetSettings('migra-paraguai'));
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  assert.deepEqual(store.settings.crm.jobsContact, [{ name: 'Gabriel', whatsapp: '' }]);
  let system = '';
  const llm = { configured: true, chat: async ({ messages }) => { system = messages[0].content; return { content: 'Que bom!', tool_calls: [] }; } };
  const agent = new Agent({ store, llm, now: () => new Date(2026, 9, 26, 9, 5) });
  agent.notifyOwner = async () => ({ ok: true });
  const conv = agent.conversation('5511999990000@s.whatsapp.net');
  agent.remember(conv, 'user', 'Tenho interesse em trabalhar no Paraguai com vocês');
  await agent.think(conv);
  assert.match(system, /assunto "contratação": o contato vai para o Gabriel/);
  assert.match(system, /Outras parcerias de negócio, fornecedores, imprensa ou investidores: use avisar_marcos/);
  assert.match(system, /Parceria com corretor, imobiliária, terreno ou loteamento NÃO vai para o Marcos/);
});

test('corretor/parceria imobiliária nunca vai para o Marcos nem para os administradores: segue para o setor de loteamentos', async () => {
  const { Sectors } = await import('../src/sectors.js');
  const store = tempStore();
  store.updateSettings({ crm: { sectors: { loteamentos: { people: [] } } } });
  const adminMsgs = [];
  const crm = { findForConversation: () => null, ensureFromConversation: () => null, update() {}, addNote() {} };
  const sectors = new Sectors({ store, crm, auth: { users: [] }, send: async () => {}, notifyAdmins: async (t) => adminMsgs.push(t) });
  const r = await sectors.route({ key: '5511942969570@s.whatsapp.net', phone: '5511942969570', name: 'Carrera' }, { setor: 'loteamentos', resumo: 'corretor quer parceria' });
  assert.equal(r.ok, true);
  assert.equal(adminMsgs.length, 0, 'sem Gabriel/Diego cadastrados, ninguém da diretoria recebe');
  assert.ok(store.data.logs.some((l) => /ninguém com WhatsApp cadastrado/.test(l.message)));
});

test('o mesmo cliente não é avisado duas vezes ao mesmo setor nem ao mesmo vendedor', async () => {
  const { Sectors } = await import('../src/sectors.js');
  const store = tempStore();
  const sent = [];
  const lead = { id: 'L1', code: 'MIG-1', name: 'Adriano', phone: '5527999343066' };
  const crm = { findForConversation: () => lead, ensureFromConversation: () => lead, update() {}, addNote() {} };
  const auth = { users: [{ id: 'g', name: 'Gabriel', whatsapp: '5545999990002', active: true }] };
  store.updateSettings({ crm: { sectors: { loteamentos: { people: [{ name: 'Gabriel', whatsapp: '5545999990002' }] } } } });
  const sectors = new Sectors({ store, crm, auth, send: async (p, t) => sent.push({ p, t }) });
  const conv = { key: '5527999343066@s.whatsapp.net', phone: '5527999343066', name: 'Adriano' };
  const r1 = await sectors.route(conv, { setor: 'loteamentos', resumo: 'corretor quer parceria' });
  const r2 = await sectors.route(conv, { setor: 'loteamentos', resumo: 'corretor de novo, com outro texto' });
  const r3 = await sectors.route(conv, { setor: 'loteamentos', resumo: 'e mais uma vez' });
  assert.equal(sent.length, 1, 'uma única mensagem para o Gabriel');
  assert.equal(r1.jaEncaminhado, undefined);
  assert.equal(r2.jaEncaminhado && r3.jaEncaminhado, true);
  assert.match(r2.instrucao, /NÃO chame esta ferramenta de novo/);
});

test('área por pessoa: botões da Equipe definem quem recebe cada setor, migra a lista antiga e vale para rodízio e indicações', async () => {
  const { Sectors } = await import('../src/sectors.js');
  const { Auth } = await import('../src/auth.js');
  const { Crm } = await import('../src/crm.js');
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const mk = (name, whatsapp, extra = {}) => auth.get(auth.create({ name, login: name.toLowerCase(), password: 'segredo123', role: 'seller', whatsapp, ...extra }).id);
  const gabriel = mk('Gabriel', '5545999990011');
  const camila = mk('Camila', '5545999990012');
  const eliezer = mk('Eliezer', '5545999990013', { sectors: ['veiculos'] });
  assert.deepEqual(auth.list().find((u) => u.name === 'Eliezer').sectors, ['veiculos']);
  // Lista antiga de Regras → marcação por pessoa (uma vez), e nomes sem cadastro ficam como estavam.
  store.updateSettings({ crm: { sectors: { loteamentos: { people: [{ name: 'Gabriel', whatsapp: '' }, { name: 'Fulano sem cadastro', whatsapp: '595981000000' }] }, documentacao: { people: [{ name: 'Camila', whatsapp: '' }] } } } });
  const sectors = new Sectors({ store, crm: {}, auth });
  sectors.migrate();
  assert.deepEqual(gabriel.sectors, ['loteamentos']);
  assert.deepEqual(camila.sectors, ['documentacao']);
  assert.deepEqual(sectors.people('loteamentos').map((p) => p.name), ['Gabriel', 'Fulano sem cadastro']);
  // Mudou de área pelo botão: Gabriel passa a vender veículos e sai de terrenos.
  auth.update(gabriel.id, { sectors: ['veiculos'] });
  assert.deepEqual(sectors.people('loteamentos').map((p) => p.name), ['Fulano sem cadastro']);
  assert.deepEqual(sectors.people('veiculos').map((p) => p.name).sort(), ['Eliezer', 'Gabriel']);
  auth.update(gabriel.id, { sectors: 'x' });
  assert.deepEqual(auth.get(gabriel.id).sectors, [], 'valor inválido não vira área');
  // Rodízio da migração só com quem atende documentação (ou ainda sem área marcada).
  auth.update(gabriel.id, { sectors: ['veiculos'] });
  const crm = new Crm({ store, auth });
  assert.deepEqual(crm.rotation().map((u) => u.name), ['Camila']);
});
