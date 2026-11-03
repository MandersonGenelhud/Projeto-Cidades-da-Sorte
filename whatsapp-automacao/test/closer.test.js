import test from 'node:test';
import assert from 'node:assert/strict';
import { Payments } from '../src/payments.js';
import { Agent } from '../src/agent/agent.js';
import { LocalCalendar } from '../src/agent/calendar.js';
import { presetSettings } from '../src/agent/presets.js';
import { TOOL_DEFINITIONS, runTool } from '../src/agent/tools.js';
import { tempStore } from './helpers.js';

function pay({ fetchImpl, mp = true } = {}) {
  const store = tempStore();
  store.updateSettings({ payments: { enabled: true, pixKey: '12345678000190', receiverName: 'Migra', receiverCity: 'Ciudad del Este', provider: mp ? 'mercadopago' : 'pix', reservation: { base: 1000, perAdult: 800 }, card: { fees: { 1: 5, 3: 10, 6: 15, 99: 5, 2: 'abc' } }, mercadopago: mp ? { accessToken: 'TESTE-token' } : {}, company: { name: 'Migra' } } });
  const lead = { id: 'L1', name: 'Carla', phone: '5511999990000', stage: 'em_contato', timeline: [] };
  const crm = { leads: [lead], update() {}, addNote() {}, ownerName: () => '' };
  const sent = [];
  const p = new Payments({ store, crm, dataDir: store.dataDir, secret: 's', fetchImpl, sendTo: async (k, x) => sent.push(x), notifyAdmins: async () => {}, notify() {} });
  return { p, sent };
}

test('cartão: cria o link do Mercado Pago só para cartão, envia ao cliente e confirma quando aprovado', async () => {
  const calls = [];
  let approved = false;
  const fetchImpl = async (url, opts) => {
    calls.push({ url, body: opts.body ? JSON.parse(opts.body) : null, method: opts.method });
    if (url.endsWith('/checkout/preferences')) return { ok: true, json: async () => ({ id: 'PREF1', init_point: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=PREF1' }) };
    if (url.includes('/v1/payments/search')) return { ok: true, json: async () => ({ results: approved ? [{ status: 'approved' }] : [{ status: 'pending' }] }) };
    throw new Error(`chamada inesperada ${url}`);
  };
  const { p: payments, sent } = pay({ fetchImpl });
  assert.equal(payments.cardAvailable, true);
  // taxas: só as válidas (1 a 12 parcelas e número); quem paga a taxa é o cliente: total = valor / (1 - taxa)
  assert.deepEqual(Object.keys(payments.cardFees), ['1', '3', '6']);
  const opts = payments.cardOptions(1800);
  assert.deepEqual(opts.map((o) => [o.parcelas, o.total, o.parcela]), [[1, 1894.74, 1894.74], [3, 2000, 666.67], [6, 2117.65, 352.94]]);
  assert.equal(opts[1].taxaEmReais, 200);
  await assert.rejects(payments.createCard({ amount: 1800, installments: 4, description: 'x' }), /Não há taxa cadastrada para 4x/);
  const c = await payments.createCard({ convKey: '5511999990000@s.whatsapp.net', leadId: 'L1', amount: 1800, installments: 3, description: 'reserva - 2 adulto(s)', payerName: 'Carla' });
  const body = calls[0].body;
  assert.equal(body.items[0].unit_price, 2000, 'o cliente paga a taxa: cobra o total da opção');
  assert.equal(c.baseAmount, 1800);
  assert.equal(body.payment_methods.installments, 3);
  assert.equal(body.external_reference, c.txid);
  assert.deepEqual(body.payment_methods.excluded_payment_types.map((x) => x.id).sort(), ['atm', 'bank_transfer', 'ticket'], 'só cartão');
  await payments.sendCardLink(c);
  assert.match(sent[0].text, /mercadopago\.com\.br\/checkout/);
  assert.match(sent[0].text, /3x \(já com a taxa da maquininha\)/);
  assert.match(sent[0].text, /página segura do Mercado Pago/);
  assert.equal(await payments.checkPending(), 0, 'pendente: não confirma');
  approved = true;
  assert.equal(await payments.checkPending(), 1);
  assert.equal(c.status, 'paid');
  assert.equal(c.method, 'cartao');
});

test('cartão: sem Mercado Pago ligado não cria link e link estranho do provedor é recusado', async () => {
  const off = pay({ mp: false });
  assert.equal(off.p.cardAvailable, false);
  await assert.rejects(off.p.createCard({ amount: 100, description: 'x' }), /Mercado Pago ligado/);
  const bad = pay({ fetchImpl: async () => ({ ok: true, json: async () => ({ id: 'P', init_point: 'https://evil.example/pagar' }) }) });
  await assert.rejects(bad.p.createCard({ amount: 100, installments: 1, description: 'x' }), /não devolveu o link/);
});

test('IA de fechamento: no WhatsApp do vendedor segue o roteiro direto e tem a ferramenta do cartão', async () => {
  assert.ok(TOOL_DEFINITIONS.some((t) => t.function.name === 'gerar_link_cartao'));
  assert.match((await runTool('gerar_link_cartao', {}, {})).erro, /indispon/i);
  const store = tempStore();
  store.updateSettings(presetSettings('clinica-sorriso'));
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  const T = new Date(2026, 9, 26, 9, 5);
  let system = ''; let tools = [];
  const llm = { configured: true, async chat({ messages, tools: t }) { system = messages[0].content; tools = t.map((x) => x.function.name); return { content: 'ok', tool_calls: [] }; } };
  const agent = new Agent({ store, llm, calendar: new LocalCalendar({ store, getConfig: () => store.settings.agenda, now: () => T }), now: () => T });
  agent.createCardLink = async () => ({ ok: true });
  // número principal: não é a IA de fechamento
  await agent.handleIncoming({ key: 'k1', phone: '5511999990001', name: 'Rita', text: 'oi' }, async () => {});
  assert.doesNotMatch(system, /IA de FECHAMENTO/);
  // WhatsApp de um vendedor: é
  agent.channelNote = () => 'Você atende pelo WhatsApp de Diego, consultor(a) da equipe.';
  agent.contextFor = () => 'Nome: Rita · código MIG-1\nConversa anterior (até as últimas 40 mensagens; outro canal):\nCliente: oi';
  await agent.handleIncoming({ key: 'k2', phone: '5511999990002', name: 'Rita', text: 'oi' }, async () => {});
  assert.match(system, /IA de FECHAMENTO/);
  assert.match(system, /Vi que você já começou um atendimento com o nosso atendente pelo número anterior/);
  assert.match(system, /iniciarmos o processo migratório/);
  assert.match(system, /no Pix ou, se ele mora longe.*cartão de crédito/);
  assert.match(system, /me envie o comprovante, por favor, para eu dar baixa no sistema e te enviar o recibo/);
  assert.match(system, /passar_fechamento_para_humano/);
  assert.match(system, /nunca peça número de cartão/);
  assert.match(system, /Vou gerar o link de pagamento no valor que você desejar/);
  assert.match(system, /taxa de juros da maquininha do cartão, que é paga pelo cliente, não pela Migra/);
  assert.ok(TOOL_DEFINITIONS.some((t) => t.function.name === 'opcoes_cartao'));
  assert.match(system, /Conversa anterior/);
});
