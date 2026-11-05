import test from 'node:test';
import assert from 'node:assert/strict';
import { ContractTemplates, renderTemplate, importLessons, importTeamContacts } from '../src/legacy-extras.js';
import { leadRowsFromApi, rowsFrom } from '../src/reengage.js';
import { Tutorials } from '../src/tutorials.js';
import { tempStore } from './helpers.js';

const cap = { api: [
  { url: 'https://v/api/contract-templates', json: { data: [{ id: 'migra-med', nome: 'Contrato Migra Med', categoria: 'migramed', versao: 'v1', conteudo: 'CONTRATANTE: {{nome_completo}}, CPF {{cpf}}. Valor {{valor_total}}.', variaveis: [{ key: 'nome_completo', label: 'Nome completo' }, { key: 'cpf', label: 'CPF' }, { key: 'valor_total', label: 'Valor' }] }], service_template_map: { 'Pacote Inicial': ['migra-paraguai'] } } },
  { url: 'https://v/api/curso', json: { course: { title: 'Curso Migra' }, lessons: [{ id: 'l1', title: 'Aula 01', description: 'Boas-vindas', video_url: 'https://drive/1', sort_order: 1 }, { id: 'l2', title: 'Rascunho', is_published: false }] } },
  { url: 'https://v/api/team-contacts', json: { data: [{ full_name: 'Ana', role_label: 'Vendedor', department: 'Comercial', phone: '+55', email: 'a@x', is_active: true }] } },
  { url: 'https://v/api/leads?pageSize=1000&page=1&lane=distribution', json: { count: 4, data: [
    { id: 'a', full_name: 'Lia', whatsapp: '+55 11 99999-0001', status: 'in_progress', raw_payload: { platform: 'ig' }, source: 'meta_lead_ads' },
    { id: 'b', full_name: 'Rui', phone: '+55 11 99999-0002', status: 'won', raw_payload: { platform: 'fb' } },
    { id: 'c', full_name: 'Edu', phone: '+55 11 99999-0003', status: 'lost', raw_payload: { platform: 'fb' } },
    { id: 'a', full_name: 'Lia', whatsapp: '+55 11 99999-0001', status: 'in_progress' },
  ] } },
  { url: 'https://v/api/leads?pageSize=1000&page=1&lane=site', json: { data: [{ id: 'd', full_name: 'Sol', phone: '5511999990004', status: 'assigned' }] } },
  { url: 'https://v/api/customers', json: { data: [{ id: 'x', full_name: 'Cliente', phone: '5511999990009' }] } },
] };

test('modelos de contrato: importa o texto, preenche as variáveis e aponta o que faltou', () => {
  const store = tempStore();
  const t = new ContractTemplates({ store });
  assert.deepEqual(t.importCapture(cap), { added: 1, updated: 0 });
  assert.deepEqual(t.importCapture(cap), { added: 0, updated: 0 });
  const r = t.render('migra-med', { nome_completo: 'Maria Souza', cpf: '111' });
  assert.equal(r.text, 'CONTRATANTE: Maria Souza, CPF 111. Valor [VALOR TOTAL].');
  assert.deepEqual(r.missing, ['valor_total']);
  assert.deepEqual(store.data.contractTemplateMap['Pacote Inicial'], ['migra-paraguai']);
  assert.equal(renderTemplate('{{ x }}', { x: '<b>' }).text, '<b>', 'o texto é escapado na tela, não aqui');
  assert.throws(() => t.render('nao-existe', {}), /não encontrado/);
});

test('aulas viram tutoriais dos vendedores (só as publicadas, sem duplicar); contatos da equipe', () => {
  const store = tempStore();
  const tut = new Tutorials({ store });
  assert.deepEqual(importLessons(tut, cap), { added: 1, total: 2 });
  assert.deepEqual(importLessons(tut, cap), { added: 0, total: 2 });
  const a = tut.all.find((x) => x.seedKey === 'legacy-lesson-l1');
  assert.equal(a.audience, 'seller'); assert.match(a.body, /https:\/\/drive\/1/);
  assert.deepEqual(importTeamContacts(store, cap), { total: 1 });
});

test('leads do sistema antigo: origem certa, sem duplicar, sem quem já virou cliente e sem misturar a lista de clientes', () => {
  const rows = leadRowsFromApi(cap);
  assert.deepEqual(rows.map((r) => [r.name, r.source]), [['Lia', 'instagram'], ['Edu', 'facebook'], ['Sol', 'site']]);
  assert.equal(rows.find((r) => r.name === 'Edu').legacyStatus, 'lost');
  assert.equal(rows[0].phone, '5511999990001');
  assert.ok(!rowsFrom(cap).some((r) => r.phone === '5511999990009'), 'cliente da lista de clientes não vira lead');
});
