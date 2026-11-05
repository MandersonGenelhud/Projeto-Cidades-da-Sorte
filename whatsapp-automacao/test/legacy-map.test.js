import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScreenMap, compareMap } from '../src/legacy-map.js';

const cap = {
  pages: [
    { url: 'https://velho.com/contratos/123', title: 'Contrato 123', tables: [{ headers: ['Parcela', 'Vencimento', 'Valor'], rows: [['1', '10/11/2026', 'R$ 100']] }], fields: [{ label: 'Cliente', value: 'Maria Souza' }], links: [{ text: 'Financeiro', href: '/financeiro' }] },
    { url: 'https://velho.com/contratos/456', title: 'Contrato 456', tables: [], fields: [{ label: 'Cliente', value: 'João' }] },
    { url: 'https://velho.com/servicos', title: 'Serviços', tables: [{ headers: ['Serviço', 'Preço base', 'Comissão %'], rows: [['RG', '100', '10']] }] },
  ],
  api: [{ url: 'https://velho.com/api/clients/9745bb82-c117-44ea-b342-c6b901196d51', json: { data: [{ id: 1, nome: 'Fulano', cpf: '123' }] } }],
};

test('mapa das telas: agrupa por tipo de endereço e não leva valores de clientes', () => {
  const map = buildScreenMap(cap);
  assert.equal(map.screens.find((s) => s.path === '/contratos/:id').pages, 2);
  assert.deepEqual(map.apis[0].keys, ['id', 'nome', 'cpf']);
  const dump = JSON.stringify(map);
  assert.ok(!/Maria Souza|João|Fulano|R\$ 100/.test(dump), 'sem dados pessoais nem valores');
  assert.ok(map.menu.some((m) => m.text === 'Financeiro'));
});

test('comparação: reconhece o tema, diz o que temos e o que falta', () => {
  const r = compareMap(buildScreenMap(cap));
  const servicos = r.rows.find((x) => x.path === '/servicos');
  assert.equal(servicos.status, 'tem');
  assert.match(servicos.ours, /catálogo com preço, prazo e comissão/);
  assert.equal(r.rows.find((x) => x.path === '/contratos/:id').theme, 'Contratos');
});

test('comparação: endereços em inglês do sistema antigo (contracts, processes, withdrawals) são reconhecidos', () => {
  const cap2 = { pages: ['/contracts/9216d553-058a-4f1e-929e-8e74308026f6', '/processes/9216d553-058a-4f1e-929e-8e74308026f6', '/withdrawals', '/support', '/expenses'].map((u) => ({ url: `https://velho.com${u}`, title: 'MigraParaguai — Assessoria Migratória Premium', tables: [], fields: [] })) };
  const r = compareMap(buildScreenMap(cap2));
  assert.equal(r.byStatus.conferir, undefined, 'nenhuma tela fica sem correspondência');
  assert.deepEqual(r.rows.map((x) => x.theme).sort(), ['Caixa e despesas', 'Contratos', 'Processos', 'Saques de comissão', 'Suporte']);
});
