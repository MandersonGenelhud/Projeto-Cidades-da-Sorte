import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Realty } from '../src/realty.js';
import { Proposals } from '../src/finance.js';
import { Motors } from '../src/motors.js';
import { ServiceCatalog } from '../src/services.js';
import { Store } from '../src/store.js';
import { Maria } from '../src/maria.js';
import { groupLiveBrief, financeLines, HUB_OVERVIEW } from '../src/group-brief.js';
import { companyBrief } from '../src/agent/prompt.js';
import { GROUP_KNOWLEDGE, GROUP_BLOCK_V1, presetSettings } from '../src/agent/presets.js';
import { tempStore } from './helpers.js';

function world() {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const marcos = auth.create({ name: 'Marcos Miguel', login: 'marcos', password: 'segredo123', role: 'admin' });
  const gabriel = auth.create({ name: 'Gabriel Souza', login: 'gabriel', password: 'segredo123', role: 'seller' });
  const realty = new Realty({ store, dataDir: store.dataDir });
  const proposals = new Proposals({ store, realty });
  const motors = new Motors({ store });
  const catalog = new ServiceCatalog({ store });
  const dev = realty.saveDevelopment(null, { name: 'Loteamento Novo Brasil', city: 'Hernandarias', address: 'Ruta 7', currency: 'USD', description: 'Lotes residenciais e comerciais.', agentName: 'Gabriel' });
  const sq = (x) => [[x, 0], [x + 10, 0], [x + 10, 10], [x, 10]];
  realty.addLot(dev.id, { block: 'A', number: '1', area: 360, price: 12000, status: 'disponivel', shape: sq(0) });
  realty.addLot(dev.id, { block: 'A', number: '2', area: 450, price: 15500, status: 'disponivel', shape: sq(20) });
  realty.addLot(dev.id, { block: 'A', number: '3', area: 360, price: 12000, status: 'vendido', shape: sq(40) });
  motors.saveVehicle(null, { brand: 'Toyota', model: 'Hilux', year: 2020, price: 38000, currency: 'USD', city: 'Ciudad del Este', plate: 'ABC123', published: true });
  catalog.add(marcos, { name: 'Residência Temporária', category: 'migratorio', price: 1997, durationDays: 60, currency: 'BRL' });
  store.updateSettings({ crm: { sectors: { loteamentos: { label: 'Loteamentos e terrenos (Migra Imobiliária)', people: [gabriel.id] } } } });
  return { store, auth, realty, proposals, motors, catalog, marcos };
}

test('resumo ao vivo: imóveis do catálogo, loteamento com lotes e faixa de preço, veículos sem a placa, serviços e quem cuida de cada setor', () => {
  const w = world();
  const t = groupLiveBrief({ realty: w.realty, finance: w.proposals.config, motors: w.motors, catalog: w.catalog, crm: w.store.settings.crm, auth: w.auth });
  assert.match(t, /^# DADOS ATUAIS DO GRUPO MIGRA/);
  assert.match(t, /Imóveis avulsos publicados: \d+/);
  assert.match(t, /Apartamento Locação - Santa Rita/, 'imóvel real do catálogo');
  assert.match(t, /Loteamento Loteamento Novo Brasil \(Hernandarias — Ruta 7\): 3 lotes, 2 disponíveis, 0 reservados, 1 vendidos; lotes disponíveis de US\$ 12\.000,00 a US\$ 15\.500,00, de 360 a 450 m²; responsável: Gabriel/);
  assert.match(t, /Toyota Hilux 2020.*US\$ 38\.000,00.*Ciudad del Este/);
  assert.doesNotMatch(t, /ABC123/, 'a placa nunca aparece');
  assert.match(t, /Residência Temporária — R\$ 1\.997,00 \(prazo 60 dias\)/);
  assert.match(t, /Loteamentos e terrenos \(Migra Imobiliária\): Gabriel Souza/);
});

test('planos de financiamento de lotes: sem juros definidos ela avisa para NÃO dizer "sem juros"; com juros definidos mostra as faixas', () => {
  const w = world();
  const padrao = financeLines(w.proposals.config).join('\n');
  assert.match(padrao, /entrada mínima de 10% do valor do lote/);
  assert.match(padrao, /até 120 parcelas/);
  assert.match(padrao, /AINDA NÃO foram definidos pelo Marcos.*Não diga "sem juros"/);
  w.proposals.saveConfig({ minEntryPct: 20, reserveFee: 500, bands: [{ upTo: 12, interestPct: 0 }, { upTo: 60, interestPct: 18 }, { upTo: 120, interestPct: 35 }] });
  const def = financeLines(w.proposals.config).join('\n');
  assert.match(def, /entrada mínima de 20%/);
  assert.match(def, /taxa de reserva de R\$ 500,00/);
  assert.match(def, /1 a 12 parcelas: 0%; 13 a 60 parcelas: 18%; 61 a 120 parcelas: 35%/);
  assert.doesNotMatch(def, /AINDA NÃO/);
});

test('o texto fixo do grupo traz tudo que você descreveu, separando o que opera do que está em desenvolvimento, sem inventar preço', () => {
  const g = GROUP_KNOWLEDGE;
  for (const t of [/Em operação hoje/, /Em desenvolvimento \(ainda sem preço nem data, exceto a Migra School, que tem preço de tabela\)/, /Migra Paraguai Assessoria/, /Migra Imobiliária/, /Financiamento próprio de lotes/, /Migra Contábil Paraguay/, /RUC/, /networking e a experiência do Marcos/,
    /Migra Motors \(também chamada de Migra Veículos\)/, /importação de veículos do exterior/, /levar o veículo do Paraguai para o Brasil/, /Migra School/, /inglês \(a partir do espanhol e a partir do português\)/, /situações do cotidiano/, /Migra Exchange/, /câmbio de moedas/, /criptomoedas/]) assert.match(g, t);
  assert.match(g, /não dê recomendação de investimento nem prometa ganho/);
  assert.match(g, /Não prometa ganhos financeiros, economia de impostos nem prazos/);
  assert.match(g, /Nunca invente valor, prazo, rendimento, taxa ou disponibilidade/);
  assert.doesNotMatch(g, /R\$ \d|US\$ \d/, 'nenhum preço inventado no texto fixo');
  const novo = presetSettings('migra-paraguai').business.knowledge;
  assert.match(novo, /visão completa das empresas e projetos/);
  assert.doesNotMatch(novo, /# Grupo Migra: as empresas do grupo/, 'instalação nova não tem o bloco antigo');
});

function reload(store, mutate) {
  mutate(store);
  store.flush();
  return new Store(store.dataDir);
}

test('instalações que já existem: bloco antigo NÃO editado é trocado; editado pelo Marcos é preservado (o novo entra antes); sem bloco, é acrescentado; não duplica', () => {
  const a = tempStore();
  a.updateSettings(presetSettings('migra-paraguai'));
  const antigoIntacto = reload(a, (s) => { s.settings.business.knowledge = `# Outro\nTexto.\n\n${GROUP_BLOCK_V1}\n\n# Moradia\nFim.`; delete s.settings.agent.groupMemory2026; });
  const ka = antigoIntacto.settings.business.knowledge;
  assert.match(ka, /visão completa das empresas e projetos/);
  assert.doesNotMatch(ka, /# Grupo Migra: as empresas do grupo/, 'o antigo foi trocado');
  assert.match(ka, /# Outro\nTexto\./);
  assert.match(ka, /# Moradia\nFim\./, 'o resto do conhecimento fica');
  assert.equal((ka.match(/visão completa das empresas/g) || []).length, 1);

  const b = tempStore();
  b.updateSettings(presetSettings('migra-paraguai'));
  const editado = reload(b, (s) => { s.settings.business.knowledge = `${GROUP_BLOCK_V1}\n- Linha que o Marcos acrescentou.\n\n# Moradia\nFim.`; delete s.settings.agent.groupMemory2026; });
  const kb = editado.settings.business.knowledge;
  assert.match(kb, /visão completa das empresas e projetos/);
  assert.match(kb, /Linha que o Marcos acrescentou\./, 'a edição dele não se perde');
  assert.match(kb, /vale o de cima, que é mais recente/);
  assert.ok(kb.indexOf('visão completa') < kb.indexOf('as empresas do grupo'), 'o novo vem antes');

  const c = tempStore();
  c.updateSettings(presetSettings('migra-paraguai'));
  const semBloco = reload(c, (s) => { s.settings.business.knowledge = '# Só isto\nTexto.'; delete s.settings.agent.groupMemory2026; });
  assert.match(semBloco.settings.business.knowledge, /# Só isto\nTexto\.\n\n# Grupo Migra: visão completa/);
  const de = new Store(semBloco.dataDir);
  assert.equal((de.settings.business.knowledge.match(/visão completa das empresas/g) || []).length, 1, 'rodar de novo não duplica');
});

test('a Maria usa o grupo inteiro: texto fixo + dados ao vivo + visão do Migra Hub, e diz que o que está em desenvolvimento não tem preço', async () => {
  const w = world();
  w.store.updateSettings(presetSettings('migra-paraguai'));
  const seen = [];
  const llm = { configured: true, chat: async ({ messages }) => { if (/classifica pedidos/.test(messages[0].content)) return { content: JSON.stringify({ acao: 'conversa' }) }; seen.push(messages[0].content); return { content: 'Claro, Marcos!' }; } };
  const marcos = w.auth.users.find((u) => u.login === 'marcos');
  w.auth.update(marcos.id, { whatsapp: '5545999990001' });
  const sent = [];
  const knowledge = () => `${groupLiveBrief({ realty: w.realty, finance: w.proposals.config, motors: w.motors, catalog: w.catalog, crm: w.store.settings.crm, auth: w.auth })}\n\n${HUB_OVERVIEW}\n\n${companyBrief(w.store.settings)}`;
  const maria = new Maria({ store: w.store, auth: w.auth, llm, knowledge, sales: {}, customers: {}, cash: {}, send: async (j, p) => sent.push(p), lineName: () => 'Maria', marcosPhone: () => '', audit() {}, log() {} });
  maria.config.lineId = 'l1';
  await maria.handle({ line: 'l1', jid: 'l:l1:5545999990001@s.whatsapp.net', phone: '5545999990001', text: 'Maria, o que a Migra Imobiliária oferece e como funcionam os planos dos lotes?' });
  const sys = seen.at(-1);
  assert.match(sys, /Migra Exchange/);
  assert.match(sys, /DADOS ATUAIS DO GRUPO MIGRA/);
  assert.match(sys, /Loteamento Loteamento Novo Brasil/);
  assert.match(sys, /Financiamento próprio de lotes/);
  assert.match(sys, /MIGRA HUB \(o sistema interno da equipe\)/);
  assert.match(sys, /Exchange, criptomoedas, School, Motors\/Veículos e a assessoria de veículos Paraguai-Brasil\) ainda NÃO tem preço nem data/);
  assert.match(sys, /não dê recomendação de investimento nem prometa ganho/);
});
