import test from 'node:test';
import assert from 'node:assert/strict';
import { Campaigns } from '../src/campanhas.js';
import { campaignReport } from '../src/campanhas-funil.js';
import { Agent } from '../src/agent/agent.js';
import { tempStore } from './helpers.js';

const T = Date.parse('2026-11-10T15:00:00Z');

function setup() {
  const store = tempStore();
  const c = new Campaigns({ store, now: () => T });
  return { store, c, camp: c.list[0] };
}

test('campanha padrão da oferta de idiomas; cada pessoa conta uma vez; o código do link define a variante; palavras também contam', () => {
  const { c, camp } = setup();
  assert.equal(camp.code, 'IDI'); assert.deepEqual(camp.variants, ['A', 'B']);
  const a = c.observe({ convKey: 'k1', text: 'Oi! Vi a oferta relâmpago no grupo e quero garantir o meu brinde. (ref IDI-A)', name: 'Ana', phone: '5511900000001', at: T });
  assert.equal(a.created, true); assert.equal(a.hit.variant, 'A'); assert.equal(a.hit.via, 'link');
  assert.equal(c.observe({ convKey: 'k1', text: 'quero o curso de idiomas', at: T }).created, false, 'a mesma pessoa não conta duas vezes');
  const b = c.observe({ convKey: 'k2', text: 'quanto custa o curso de idiomas de 12 meses?', at: T });
  assert.equal(b.hit.via, 'palavra'); assert.equal(b.hit.variant, '');
  assert.equal(c.observe({ convKey: 'k3', text: 'Bom dia, quero saber da cédula', at: T }), null, 'assunto comum não é da campanha');
  assert.equal(c.observe({ convKey: '1203@g.us', text: 'oferta relâmpago', at: T }), null, 'grupos não contam');
  // quem veio por palavras e depois por link ganha a variante
  c.observe({ convKey: 'k2', text: 'oi (ref IDI-B)', at: T });
  assert.equal(c.hits.find((h) => h.convKey === 'k2').variant, 'B');
  assert.equal(c.hits.length, 2);
});

test('campanha pausada, encerrada ou fora das datas não conta; recomeça ao ativar; criar campanha nova com código único', () => {
  const { c, camp } = setup();
  c.setStatus(camp.id, 'pausada', 'testando outra arte');
  assert.equal(c.observe({ convKey: 'k1', text: 'oferta relâmpago', at: T }), null);
  c.setStatus(camp.id, 'ativa');
  assert.ok(c.observe({ convKey: 'k1', text: 'oferta relâmpago', at: T }));
  assert.equal(c.observe({ convKey: 'k9', text: 'oferta relâmpago', at: Date.parse('2026-11-20T10:00:00Z') }), null, 'depois do último dia');
  const n = c.create({ name: 'Promoção de dezembro', code: 'dez', variants: ['a', 'b'], keywords: ['promoção de dezembro'] });
  assert.equal(n.code, 'DEZ'); assert.deepEqual(n.variants, ['A', 'B']);
  assert.throws(() => c.create({ name: 'Outra', code: 'DEZ' }), /Já existe/);
  assert.throws(() => c.setStatus(camp.id, 'xis'), /inválida/);
  assert.match(c.refText(camp, 'a'), /\(ref IDI-A\)/);
});

test('procurar quem já veio: acha nas conversas guardadas, sem duplicar', () => {
  const { c, camp } = setup();
  const conv = (key, text, at) => ({ key, name: key, phone: '5511', messages: [{ role: 'user', content: text, at }] });
  const convs = { a: conv('a', 'Vi a oferta relâmpago no grupo (ref IDI-B)', '2026-11-09T10:00:00Z'), b: conv('b', 'oi tudo bem?', '2026-11-09T10:00:00Z'), c: conv('c', 'quero o brinde', '2026-10-01T10:00:00Z') };
  assert.equal(c.scan(camp, convs, { days: 7 }), 1);
  assert.equal(c.scan(camp, convs, { days: 7 }), 0, 'não duplica');
  assert.equal(c.hits[0].variant, 'B');
});

test('relatório por variante: vieram, orçamento, ficha, contrato, fecharam e brinde; a nota só compara com 5 pessoas ou mais', () => {
  const { c, camp } = setup();
  for (let i = 1; i <= 6; i++) c.observe({ convKey: `a${i}`, text: 'oi (ref IDI-A)', name: `A${i}`, at: T });
  for (let i = 1; i <= 6; i++) c.observe({ convKey: `b${i}`, text: 'oi (ref IDI-B)', name: `B${i}`, at: T });
  c.observe({ convKey: 'p1', text: 'quero o curso de idiomas', at: T });
  const quotes = [...[1, 2, 3, 4].map((i) => ({ id: `qa${i}`, number: `ORC-A${i}`, convKey: `a${i}`, createdAt: '2026-11-10T10:00:00Z' })), { id: 'qb1', number: 'ORC-B1', convKey: 'b1', createdAt: '2026-11-10T10:00:00Z' }];
  const payments = [{ status: 'paid', convKey: 'a1' }, { status: 'paid', convKey: 'a2' }, { status: 'paid', convKey: 'b1' }];
  const claims = [{ convKey: 'a1', status: 'confirmada' }, { convKey: 'a2', status: 'reservada' }];
  const r = campaignReport({ camp, hits: c.hits, quotes, payments, claims, forms: [], now: T });
  const A = r.byVariant.find((v) => v.variant === 'A'); const B = r.byVariant.find((v) => v.variant === 'B'); const S = r.byVariant.find((v) => v.variant === '');
  assert.deepEqual([A.vieram, A.orcamento, A.fecharam, A.taxaFechamento, A.brinde, A.brindeConfirmado], [6, 4, 2, 33.3, 2, 1]);
  assert.deepEqual([B.vieram, B.orcamento, B.fecharam, B.taxaFechamento], [6, 1, 1, 16.7]);
  assert.equal(S.vieram, 1);
  assert.equal(r.total.vieram, 13); assert.equal(r.total.fecharam, 3);
  assert.match(r.nota, /variante A é a que mais fecha/);
  const pouco = campaignReport({ camp, hits: c.hits.slice(0, 3), quotes: [], payments: [], claims: [], forms: [] });
  assert.match(pouco.nota, /poucas pessoas/);
  assert.equal(r.rows.find((x) => x.name === 'A1').stage, 'fechou');
});

test('a IA avisa a contagem a cada mensagem de cliente (onInbound) sem derrubar o atendimento se der erro', async () => {
  const store = tempStore();
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  const agent = new Agent({ store, llm: { configured: true, chat: async () => ({ content: 'Oi!', tool_calls: [] }) }, calendar: null });
  const seen = [];
  agent.onInbound = (conv, text) => { seen.push(text); throw new Error('falha na contagem'); };
  const sent = [];
  await agent.handleIncoming({ key: 'k1', phone: '5511900000001', name: 'Ana', text: 'Vi a oferta relâmpago (ref IDI-A)' }, async (t) => sent.push(t));
  assert.deepEqual(seen, ['Vi a oferta relâmpago (ref IDI-A)']);
  assert.ok(sent.length >= 1, 'o cliente foi respondido mesmo assim');
});

test('quem chegou agora e recebeu a oferta da IA é guardado como "apresentada", separado de quem veio pedir; se depois pedir, vira "veio"', () => {
  const { c } = setup();
  const a = c.markPresented({ convKey: 'n1', name: 'Novo', phone: '5511900000009', at: T });
  assert.equal(a.created, true); assert.equal(a.hit.via, 'ia');
  assert.equal(c.markPresented({ convKey: 'n1', at: T }), null, 'uma vez só');
  assert.equal(c.markPresented({ convKey: '1203@g.us', at: T }), null);
  const r1 = campaignReport({ camp: c.list[0], hits: c.hits, quotes: [], payments: [], claims: [], forms: [] });
  assert.deepEqual([r1.total.vieram, r1.total.apresentadas], [0, 1]);
  c.observe({ convKey: 'n1', text: 'quero o brinde do curso de idiomas', at: T });
  const r2 = campaignReport({ camp: c.list[0], hits: c.hits, quotes: [], payments: [], claims: [], forms: [] });
  assert.deepEqual([r2.total.vieram, r2.total.apresentadas], [1, 0]);
  c.setStatus(c.list[0].id, 'pausada');
  assert.equal(c.markPresented({ convKey: 'n2', at: T }), null, 'campanha pausada não conta');
});

import { buildCaption } from '../src/flash-offer.js';
test('legenda com limite real fala das primeiras N pessoas; sem limite, de todos', () => {
  assert.match(buildCaption({ people: 1500, link: 'x', spots: 20 }), /\*as 20 primeiras pessoas\* que fecharem com a Migra e derem a entrada até quinta-feira ganham/);
  assert.match(buildCaption({ people: 1500, link: 'x', spots: 0 }), /\*quem fechar com a Migra e der a entrada até quinta-feira\* ganha/);
});
