import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Crm } from '../src/crm.js';
import { Maria, quickIntent } from '../src/maria.js';
import { SALES_COACH } from '../src/sales-coach.js';
import { tempStore } from './helpers.js';

const LINE = 'l1';
const MARCOS = '5545999990001';
const VEND = '5545999990004';
const OUTRA = '5545999990005';

function setup({ llm = null } = {}) {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const marcos = auth.create({ name: 'Marcos Miguel', login: 'marcos', password: 'segredo123', role: 'admin' });
  const v1 = auth.create({ name: 'Ana Vendedora', login: 'ana', password: 'segredo123', role: 'seller' });
  const v2 = auth.create({ name: 'Pedro Vendedor', login: 'pedro', password: 'segredo123', role: 'seller' });
  auth.update(marcos.id, { whatsapp: MARCOS }); auth.update(v1.id, { whatsapp: VEND }); auth.update(v2.id, { whatsapp: OUTRA });
  const crm = new Crm({ store, auth });
  const mk = (owner, name, phone, extra = {}) => { const l = crm.create(owner, { name, phone, ownerId: owner.id, ...extra }); return l; };
  const sent = []; const prompts = [];
  const now = () => new Date(2026, 10, 6, 10, 30);
  const maria = new Maria({
    store, auth, crm, sales: { listFor: () => [], canSee: () => true, view: (s) => s, summary: () => ({}) }, customers: { search: () => [] }, cash: {}, now, llm,
    knowledge: () => 'BASE: pacote Ouro.',
    send: async (j, p) => { sent.push({ j, ...p }); }, lineName: () => 'Maria', marcosPhone: () => MARCOS, audit: () => {}, log: () => {},
  });
  maria.config.lineId = LINE;
  const say = async (phone, text) => { sent.length = 0; await maria.handle({ line: LINE, jid: `l:${LINE}:${phone}@s.whatsapp.net`, phone, text }); return sent.filter((m) => m.text).map((m) => m.text).join('\n'); };
  return { say, crm, mk, ids: { marcos, v1, v2 }, sent, prompts };
}

test('reconhece pedidos de vendas sem IA', () => {
  assert.equal(quickIntent('Maria, quais são as minhas prioridades de hoje?').acao, 'prioridades');
  assert.equal(quickIntent('quem eu devo ligar hoje').acao, 'prioridades');
  assert.equal(quickIntent('meus retornos de hoje').acao, 'prioridades');
  const c = quickIntent('como eu fecho o cliente Carlos Lima');
  assert.equal(c.acao, 'coach_cliente'); assert.equal(c.termo, 'carlos lima');
  assert.equal(quickIntent('o que eu falo pro Carlos Lima').acao, 'coach_cliente');
  assert.notEqual(quickIntent('gere o contrato do Carlos').acao, 'coach_cliente');
});

test('o roteiro de venda proíbe inventar e deixa a cortesia só com o Marcos', () => {
  assert.match(SALES_COACH, /nunca invente preço/i);
  assert.match(SALES_COACH, /exclusiva do Marcos/);
  assert.match(SALES_COACH, /não chama cliente por conta própria/);
});

test('prioridades: vendedora vê só os prospectos dela; administrador vê todos', async () => {
  const t = setup();
  const a = t.mk(t.ids.v1, 'Carlos Lima', '5545988880001');
  const b = t.mk(t.ids.v2, 'Bruno Alves', '5545988880002');
  t.crm.setStage(t.ids.v1, t.crm.byId(a.id), { stage: 'aguardando', followUpAt: '2026-11-03', followUpReason: 'ver orçamento' });
  t.crm.setStage(t.ids.v2, t.crm.byId(b.id), { stage: 'aguardando', followUpAt: '2026-11-06', followUpReason: 'retorno' });
  const ela = await t.say(VEND, 'Maria, quais são minhas prioridades de hoje?');
  assert.match(ela, /Carlos Lima/); assert.match(ela, /Atrasados/); assert.doesNotMatch(ela, /Bruno/);
  const adm = await t.say(MARCOS, 'Maria, meus retornos de hoje');
  assert.match(adm, /Carlos Lima/); assert.match(adm, /Bruno Alves/);
});

test('coach sem IA: dá o próximo passo e a mensagem pronta, sem inventar desconto nem enviar nada', async () => {
  const t = setup();
  const a = t.mk(t.ids.v1, 'Carlos Lima', '5545988880001', { interest: 'residência' });
  t.crm.setStage(t.ids.v1, t.crm.byId(a.id), { stage: 'proposta' });
  const r = await t.say(VEND, 'Maria, como eu fecho o cliente Carlos Lima');
  assert.match(r, /Carlos Lima/); assert.match(r, /Orçamento|orçamento/); assert.match(r, /Sugestão de mensagem/);
  assert.match(r, /só oriento|só o Marcos autoriza/);
  assert.doesNotMatch(r, /\d+% de desconto/);
  assert.ok(t.sent.every((m) => m.j.includes(VEND)), 'nada saiu para o cliente');
});

test('coach: vendedora não enxerga cliente de outro vendedor', async () => {
  const t = setup();
  t.mk(t.ids.v2, 'Bruno Alves', '5545988880002');
  const r = await t.say(VEND, 'Maria, como eu fecho o cliente Bruno Alves');
  assert.match(r, /não achei/);
  assert.doesNotMatch(r, /Sugestão de mensagem/);
});

test('coach com IA: usa o roteiro e só os dados de venda do prospecto (sem CPF)', async () => {
  const seen = [];
  const llm = { configured: true, chat: async ({ messages }) => { seen.push(messages); return { content: '1) Leitura. 2) Retome hoje. 3) "Oi Carlos!"' }; } };
  const t = setup({ llm });
  const a = t.mk(t.ids.v1, 'Carlos Lima', '5545988880001', { interest: 'residência' });
  t.crm.setStage(t.ids.v1, t.crm.byId(a.id), { stage: 'proposta' });
  const r = await t.say(VEND, 'Maria, como eu fecho o cliente Carlos Lima');
  const coach = seen.find((m) => m[0].content.includes('DADOS DO PROSPECTO'));
  assert.ok(coach, 'chamou o coach com os dados do prospecto');
  assert.match(coach[0].content, /nunca invente preço/i);
  assert.match(coach[0].content, /Carlos Lima/);
  assert.match(r, /Retome hoje/);
});

test('bate-papo da Maria agora carrega o roteiro de venda', async () => {
  const seen = [];
  const llm = { configured: true, chat: async ({ messages }) => { seen.push(messages[0].content); return { content: 'Claro!' }; } };
  const t = setup({ llm });
  await t.say(MARCOS, 'Maria, a pessoa disse que está caro, e agora?');
  assert.ok(seen.some((s) => s.includes('VOCÊ TAMBÉM É VENDEDORA')));
});
