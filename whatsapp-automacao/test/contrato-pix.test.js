import test from 'node:test';
import assert from 'node:assert/strict';
import { makeContractPix } from '../src/contract-pix.js';
import { repairMissingLeads, dataHealth } from '../src/lead-repair.js';
import { Crm } from '../src/crm.js';
import { Auth } from '../src/auth.js';
import { tempStore } from './helpers.js';

function setup({ payCfg = { pixKey: 'chave@pix', enabled: true }, connected = true } = {}) {
  const store = tempStore();
  store.updateSettings({ payments: payCfg });
  const sent = [];
  const list = [];
  const payments = {
    list,
    create: async (a) => { const p = { id: `p${list.length + 1}`, status: 'pending', amount: a.amount, convKey: a.convKey, description: a.description, payerName: a.payerName, payerDoc: a.payerDoc, createdAt: new Date().toISOString() }; list.push(p); return p; },
    sendCharge: async (p) => { sent.push(p.id); },
  };
  const conv = { key: '5545999990000@s.whatsapp.net', phone: '5545999990000', messages: [] };
  const agent = { conversation: () => conv, remember: (c, role, text) => c.messages.push({ role, content: text }) };
  const crm = { findForConversation: () => ({ id: 'L1' }) };
  const wa = { isConnected: () => connected };
  const api = makeContractPix({ store, payments, wa, agent, crm });
  const q = { number: 'ORC-2026-00001', convKey: conv.key, phone: conv.phone, plan: { total: 12997, entry: 1800 }, contract: { client: { nome: 'Ana Souza', cpf: '529.982.247-25' } } };
  return { store, payments, sent, api, q, conv };
}

test('regra: o contrato enviado leva junto o Pix da entrada do orçamento, com nome e CPF de quem paga', async () => {
  const { api, q, payments, sent, conv, store } = setup();
  const r = await api.sendContractPix(q, { client: q.contract.client, by: 'Ana' });
  assert.equal(r.sent, true);
  assert.equal(r.amount, 1800);
  assert.equal(payments.list[0].amount, 1800);
  assert.match(payments.list[0].description, /CT-2026-00001/);
  assert.equal(payments.list[0].payerName, 'Ana Souza');
  assert.equal(payments.list[0].payerDoc, '529.982.247-25');
  assert.deepEqual(sent, ['p1']);
  assert.match(conv.messages.at(-1).content, /Pix de 1800 enviado/);
  assert.ok(store.data.logs.some((l) => /Pix de .* enviado junto com o contrato CT-2026-00001/.test(l.message)));
});

test('o valor combinado entre vendedor e cliente vale no lugar da entrada; valor inválido é recusado', async () => {
  const { api, q, payments } = setup();
  api.setAgreedPix(q, '500,00', 'Ana');
  assert.equal(q.agreedPix.amount, 500);
  await api.sendContractPix(q);
  assert.equal(payments.list[0].amount, 500);
  assert.throws(() => api.setAgreedPix(q, 0), /maior que zero/);
  assert.throws(() => api.setAgreedPix(q, -5), /maior que zero/);
  assert.throws(() => api.setAgreedPix(q, 99999), /não pode passar do total/);
  assert.doesNotThrow(() => api.setAgreedPix(q, undefined));
  assert.equal(q.agreedPix.amount, 500, 'sem valor novo, o combinado continua');
});

test('um Pix por combinado: não reenvia enquanto está em aberto nem depois de pago; valor novo gera outro', async () => {
  const { api, q, payments, sent } = setup();
  assert.equal((await api.sendContractPix(q)).sent, true);
  const again = await api.sendContractPix(q);
  assert.equal(again.sent, false);
  assert.match(again.why, /já foi enviado e está em aberto/);
  assert.equal(payments.list.length, 1);
  api.setAgreedPix(q, 900, 'Ana'); // combinaram outro valor
  assert.equal((await api.sendContractPix(q)).sent, true);
  assert.equal(payments.list.length, 2);
  payments.list[1].status = 'paid';
  const paid = await api.sendContractPix(q);
  assert.equal(paid.sent, false);
  assert.match(paid.why, /já foi paga/);
  assert.equal(sent.length, 2);
});

test('o contrato nunca é derrubado: sem Pix configurado, sem conversa, WhatsApp desligado, regra desligada ou erro ao gerar, só volta o motivo', async () => {
  let s = setup({ payCfg: { enabled: true, pixKey: '', mercadopago: { accessToken: '' } } });
  assert.match((await s.api.sendContractPix(s.q)).why, /não está configurado/);
  s = setup({ connected: false });
  assert.match((await s.api.sendContractPix(s.q)).why, /desconectado/);
  s = setup();
  delete s.q.convKey;
  assert.match((await s.api.sendContractPix(s.q)).why, /não está ligado a uma conversa/);
  s = setup({ payCfg: { pixKey: 'x', enabled: true, autoPixOnContract: false } });
  assert.match((await s.api.sendContractPix(s.q)).why, /desligado/);
  assert.equal(s.payments.list.length, 0);
  s = setup();
  s.payments.create = async () => { throw new Error('banco fora do ar'); };
  const r = await s.api.sendContractPix(s.q);
  assert.equal(r.sent, false);
  assert.match(r.why, /banco fora do ar/);
  assert.ok(s.store.data.logs.some((l) => l.type === 'error' && /não saiu/.test(l.message)));
  s = setup();
  s.q.plan.entry = 99999; // acima do total: recusa
  assert.match((await s.api.sendContractPix(s.q)).why, /inválido/);
});

function crmSetup() {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const crm = new Crm({ store, auth });
  return { store, crm };
}
const msg = (role, content, ago = 1000) => ({ role, content, at: new Date(Date.now() - ago).toISOString() });

test('reparo: conversa que a IA respondeu e ficou sem prospecto ganha registro; ignora grupo, simulação, bloqueado, pessoal do Marcos, sem resposta da IA e antigas', () => {
  const { store, crm } = crmSetup();
  const c = (key, extra = {}) => { store.data.conversations[key] = { key, phone: key.replace(/\D/g, '') || null, name: 'N', messages: [msg('user', 'oi'), msg('assistant', 'olá')], updatedAt: new Date().toISOString(), ...extra }; };
  c('5545900000001@s.whatsapp.net'); // falta prospecto
  c('ig:77', { phone: null, username: 'tati.costa' }); // Instagram
  c('120363@g.us'); c('sim:x', { simulation: true });
  c('5545900000002@s.whatsapp.net'); // bloqueado
  c('5545900000003@s.whatsapp.net', { handoff: true, handoffReason: 'Conversa do Marcos (pessoal): família' });
  c('5545900000004@s.whatsapp.net', { messages: [msg('user', 'oi')] }); // IA não respondeu
  c('5545900000005@s.whatsapp.net', { updatedAt: new Date(Date.now() - 10 * 86_400_000).toISOString() }); // antiga
  const dry = repairMissingLeads({ store, crm, dryRun: true, isBlocked: (p) => p === '5545900000002' });
  assert.equal(dry.missing, 2);
  assert.equal(crm.leads.length, 0, 'dryRun não cria nada');
  const r = repairMissingLeads({ store, crm, isBlocked: (p) => p === '5545900000002' });
  assert.equal(r.created, 2);
  assert.ok(crm.leads.some((l) => l.instagram === 'tati.costa'));
  assert.equal(repairMissingLeads({ store, crm, isBlocked: (p) => p === '5545900000002' }).created, 0, 'rodar de novo não duplica');
  const h = dataHealth({ store, crm, instance: { id: 'x' } });
  assert.equal(h.conversationsAnsweredWithoutLead, 3, 'o bloqueado, o pessoal do Marcos e a conversa antiga continuam sem prospecto (não entram no reparo automático)');
});

test('prospecto: abre pelo id, pelo código ou pelo @; prospecto apagado deixa registro de quem apagou', () => {
  const { store, crm } = crmSetup();
  const lead = crm.ensureFromConversation({ key: 'ig:9', username: 'Tati.Costa', name: 'Tatiane Costa', channel: 'instagram' });
  assert.equal(crm.resolveRef(lead.id).id, lead.id);
  assert.equal(crm.resolveRef(lead.code.toLowerCase()).id, lead.id);
  assert.equal(crm.resolveRef('@tati.costa').id, lead.id);
  assert.equal(crm.resolveRef('ig:9').id, lead.id);
  assert.equal(crm.resolveRef('inexistente'), null);
  crm.remove({ name: 'Marcos', role: 'admin' }, lead.id);
  assert.equal(crm.resolveRef(lead.id), null);
  const t = crm.tombstoneFor(lead.id);
  assert.equal(t.by, 'Marcos');
  assert.equal(crm.tombstoneFor(lead.code).name, 'Tatiane Costa');
  assert.throws(() => crm.remove({ name: 'Ana', role: 'seller' }, 'x'), /administrador/);
  assert.equal(store.data.leadTombstones.length, 1);
});

test('diagnóstico por número: mostra quantas conversas cada WhatsApp (principal, vendedor, Instagram) gravou e quando chegou a mensagem mais nova', () => {
  const { store, crm } = crmSetup();
  const t = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
  store.data.conversations['5545900000001@s.whatsapp.net'] = { key: '5545900000001@s.whatsapp.net', messages: [msg('user', 'oi', 2 * 3_600_000)], updatedAt: t(2) };
  store.data.conversations['ig:5'] = { key: 'ig:5', messages: [msg('user', 'oi', 50 * 3_600_000)], updatedAt: t(50) };
  const h = dataHealth({ store, crm, instance: { id: 'x' } });
  assert.equal(h.byNumber.principal.conversations, 1);
  assert.equal(h.byNumber.principal.last24h, 1);
  assert.equal(h.byNumber.instagram.last24h, 0);
  assert.ok(h.byNumber.instagram.newestClientMessageAt);
});
