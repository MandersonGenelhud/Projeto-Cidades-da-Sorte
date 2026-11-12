import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Crm } from '../src/crm.js';
import { LeadRouter } from '../src/routing.js';
import { centralNote } from '../src/agent/central.js';
import { tempStore } from './helpers.js';

function setup() {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const mk = (name, login, whatsapp) => auth.get(auth.create({ name, login, password: 'segredo123', role: 'seller', whatsapp }).id);
  const geo = mk('GEOVANA', 'geo', '595981000001'); const fran = mk('Fran', 'fran', '595981000002'); const outro = mk('Carlos Outro', 'carlos', '595981000003');
  const crm = new Crm({ store, auth });
  const pool = (u) => ['geovana', 'fran'].some((x) => { const n = u.name.toLowerCase(); return n === x || n.startsWith(`${x} `); });
  return { store, auth, crm, geo, fran, outro, pool };
}

test('a Central direciona só para a Geovana e a Fran, em rodízio, mesmo que o cliente já tenha sido dado a outro vendedor', () => {
  const { crm, outro, pool, geo, fran } = setup();
  const l1 = crm.ensureFromConversation({ key: '5545988880001', phone: '5545988880001', name: 'Ana', channel: 'whatsapp' });
  const l2 = crm.ensureFromConversation({ key: '5545988880002', phone: '5545988880002', name: 'Bia', channel: 'whatsapp' });
  l1.ownerId = outro.id; // rodízio comum já tinha dado a outro vendedor
  const a = crm.routeLead(l1, { pool }); const b = crm.routeLead(l2, { pool });
  assert.ok([geo.id, fran.id].includes(a.id), 'o cliente que estava com outro vendedor vai para a Geovana ou a Fran');
  assert.ok([geo.id, fran.id].includes(b.id));
  assert.notEqual(a.id, b.id, 'rodízio entre as duas');
  // mesma conversa de novo: continua com quem já está
  assert.equal(crm.routeLead(l1, { pool }).id, a.id);
});

test('se ninguém da lista da Central estiver disponível, cai no rodízio comum (o cliente não fica sem destino)', () => {
  const { crm } = setup();
  const l = crm.ensureFromConversation({ key: '5545988880009', phone: '5545988880009', name: 'Caio', channel: 'whatsapp' });
  const s = crm.routeLead(l, { pool: () => false, fallback: true });
  assert.equal(crm.routeLead(crm.ensureFromConversation({ key: '5545988880010', phone: '5545988880010', name: 'Duda', channel: 'whatsapp' }), { pool: () => false }), null, 'sem fallback (parceiros) continua sem destino para o próximo filtro tentar');
  assert.ok(s, 'algum vendedor recebe');
});

test('orientação da Central: UMA pergunta (interesse) e encaminha na hora; não faz triagem nem fecha', () => {
  const t = centralNote({ agentName: 'Luana' });
  assert.match(t, /UMA ÚNICA pergunta/);
  assert.match(t, /documentação e residência no Paraguai, imóveis[\s\S]*veículos/);
  assert.match(t, /NÃO faz triagem longa/);
  assert.match(t, /Não pergunte nome, cidade/);
  assert.match(t, /passar_fechamento_para_humano/);
  assert.match(t, /todos os vendedores ativos no rodízio/);
  assert.match(t, /NÃO monta orçamento, NÃO envia contrato/);
  assert.match(t, /acima de qualquer outra orientação/);
  assert.match(centralNote({ agentName: 'Luana', sellers: ['Geovana', 'Fran'] }), /Geovana e Fran/);
});

test('vendedor novo cadastrado entra no rodízio da Central sem mexer em lista', () => {
  const { auth, crm, geo, fran } = setup();
  const novo = auth.get(auth.create({ name: 'Paulo Novo', login: 'paulo', password: 'segredo123', role: 'seller', whatsapp: '595981000009' }).id);
  const todos = (u) => u.active !== false;
  const ids = new Set();
  for (let i = 0; i < 12; i++) ids.add(crm.routeLead(crm.ensureFromConversation({ key: `554598880${String(i).padStart(3, "0")}`, phone: `554598880${String(i).padStart(3, "0")}`, name: `C${i}`, channel: 'whatsapp' }), { pool: todos }).id);
  assert.ok(ids.has(novo.id) && ids.has(geo.id) && ids.has(fran.id), 'todos os vendedores recebem, inclusive o recém-cadastrado');
});

test('a Central direciona por papel: só vendedoras do rodízio; nunca a própria Central nem o dono', () => {
  const { auth, crm } = setup();
  const central = auth.get(auth.create({ name: 'Central Atendimento', login: 'central', password: 'segredo123', role: 'seller', whatsapp: '595984453784' }).id);
  const rot = crm.rotation().map((u) => u.name);
  assert.ok(!rot.includes('Central Atendimento'), 'a Central não entra no rodízio como se fosse vendedora');
  assert.ok(rot.includes('GEOVANA') && rot.includes('Fran'));
  void central;
});

test('orientação da Central: imóvel vai ao corretor (loteamentos), veículo ao setor de veículos', () => {
  const t = centralNote({ agentName: 'Luana' });
  assert.match(t, /direcionar_para_setor com setor "loteamentos"/);
  assert.match(t, /setor "veiculos"/);
});
