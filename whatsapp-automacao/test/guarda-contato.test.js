import test from 'node:test';
import assert from 'node:assert/strict';
import { detectDecline, markDecline, scanDeclined, buildClosedIndex, outreachBlock, isProactive } from '../src/outreach-guard.js';
import { buildDirectory } from '../src/directory.js';
import { noticeExpiringQuotes } from '../src/quote-expiry.js';
import { Agent } from '../src/agent/agent.js';
import { Crm } from '../src/crm.js';
import { Auth } from '../src/auth.js';
import { tempStore } from './helpers.js';

test('lê o que o cliente disse: as frases do print (já fechou com um amigo, já fechei) são recusa; negação, pergunta e agradecimento não são', () => {
  const k = (t) => detectDecline(t)?.kind || null;
  assert.equal(k('OK muito obrigado a gente já fechou com um amigo nosso a gente já tá com a documentação'), 'fechou_outro');
  assert.equal(k('Muito obrigado já fechei'), 'fechou_outro');
  assert.equal(k('já fechamos com outra empresa'), 'fechou_outro');
  assert.equal(k('Fechei com o despachante da minha cidade'), 'fechou_outro');
  assert.equal(k('já contratei outra assessoria, obrigado'), 'fechou_outro');
  assert.equal(k('Não tenho mais interesse, obrigado'), 'sem_interesse');
  assert.equal(k('desisti de ir morar aí'), 'sem_interesse');
  assert.equal(k('Por favor não me chame mais'), 'nao_chamar');
  assert.equal(k('pare de me mandar mensagem'), 'nao_chamar');
  assert.equal(k('fechei com vocês ontem, tá tudo certo'), 'fechou_conosco');
  assert.equal(k('ainda não fechei com ninguém'), null, 'negação');
  assert.equal(k('vocês já fecharam o meu contrato?'), null, 'pergunta');
  assert.equal(k('já fechou?'), null);
  assert.equal(k('quero fechar com vocês'), null);
  assert.equal(k('obrigado'), null);
  assert.equal(k('já tenho o valor para começar'), null);
  assert.equal(k('oi'), null);
});

function crmSetup() {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  return { store, crm: new Crm({ store, auth }) };
}

test('marcar recusa: conversa sinalizada, prospecto vai para perdido com o motivo, nota no CRM, "não me chame" entra no bloqueio; só uma vez', () => {
  const { store, crm } = crmSetup();
  const lead = crm.ensureFromConversation({ key: '554199240001@s.whatsapp.net', phone: '554199240001', name: 'Billy', channel: 'whatsapp' });
  const conv = { key: '554199240001@s.whatsapp.net', phone: '554199240001', messages: [] };
  const r = markDecline({ conv, decline: { kind: 'fechou_outro' }, text: 'Muito obrigado já fechei', crm, store });
  assert.equal(r.marked, true);
  assert.equal(conv.declined.kind, 'fechou_outro');
  const l = crm.leads.find((x) => x.id === lead.id);
  assert.equal(l.stage, 'perdido');
  assert.match(l.lostReason, /outra pessoa ou empresa/);
  assert.ok(l.timeline.some((t) => /parou de procurar este cliente/.test(t.text)));
  assert.equal(markDecline({ conv, decline: { kind: 'fechou_outro' }, text: 'x', crm, store }).marked, false, 'não repete');
  const c2 = { key: '554199240002@s.whatsapp.net', phone: '554199240002', messages: [] };
  assert.equal(markDecline({ conv: c2, decline: { kind: 'nao_chamar' }, text: 'não me chame mais', crm, store }).blocked, true);
  assert.equal(store.isBlacklisted('554199240002'), true);
});

test('lê TODAS as conversas antigas: marca quem recusou, ignora quem voltou com interesse; dryRun só conta', () => {
  const { store, crm } = crmSetup();
  const t = (d) => new Date(Date.now() - d * 86_400_000).toISOString();
  const c = (key, msgs) => { store.data.conversations[key] = { key, phone: key.replace(/\D/g, ''), messages: msgs.map(([role, content, d]) => ({ role, content, at: t(d) })) }; };
  c('5541900000001@s.whatsapp.net', [['assistant', 'oi', 9], ['user', 'já fechamos com um amigo nosso', 8], ['assistant', 'ok', 8], ['user', 'obrigado', 7]]); // recusou e só agradeceu
  c('5541900000002@s.whatsapp.net', [['user', 'já fechei com outro', 9], ['assistant', 'ok', 9], ['user', 'na verdade quero fazer com vocês, qual o valor?', 2]]); // voltou
  c('5541900000003@s.whatsapp.net', [['user', 'quero saber o preço', 3], ['assistant', 'R$ 12.997', 3]]); // nunca recusou
  c('5541900000004@s.whatsapp.net', [['user', 'não tenho mais interesse', 400]]); // antiga demais
  const dry = scanDeclined({ store, crm, dryRun: true });
  assert.deepEqual([dry.found, dry.marked], [1, 0]);
  assert.equal(store.data.conversations['5541900000001@s.whatsapp.net'].declined, undefined);
  const r = scanDeclined({ store, crm });
  assert.equal(r.marked, 1);
  assert.equal(store.data.conversations['5541900000001@s.whatsapp.net'].declined.kind, 'fechou_outro');
  assert.equal(store.data.conversations['5541900000002@s.whatsapp.net'].declined, undefined);
  assert.equal(scanDeclined({ store, crm }).marked, 0, 'rodar de novo não repete');
});

const people = () => buildDirectory({
  quotes: [
    { id: 'q1', number: 'ORC-1', client: 'Ana', phone: '5545988887711', validUntil: '2099-01-01', plan: { total: 100 }, contract: { status: 'assinado', client: { nome: 'Ana Souza', cpf: '529.982.247-25' } } },
    { id: 'q2', number: 'ORC-2', client: 'Bia', phone: '5545988887722', validUntil: '2099-01-01', plan: { total: 100 }, contract: { status: 'enviado', client: { nome: 'Bia Lima' } } },
  ],
  sales: [{ id: 's1', number: 'V-1', client: { nome: 'Caio', phone: '5545988887733' }, status: 'ativa', total: 10, parcels: [] }, { id: 's2', number: 'V-2', client: { nome: 'Davi', phone: '5545988887744' }, status: 'cancelada', total: 10, parcels: [] }],
  payments: [{ id: 'p1', status: 'paid', amount: 5, payerName: 'Edu', payerPhone: '5545988887755' }, { id: 'p2', status: 'pending', amount: 5, payerName: 'Fabi', payerPhone: '5545988887766' }],
  leads: [{ id: 'L1', name: 'Gil', phone: '5545988887777', stage: 'ganho' }, { id: 'L2', name: 'Hugo', phone: '5545988887788', stage: 'novo' }],
});

test('já fechou conosco (lido do banco): contrato assinado, venda, Pix pago e cliente ganho; só orçamento, contrato sem assinar, venda cancelada e Pix em aberto NÃO contam', () => {
  const idx = buildClosedIndex(people());
  for (const ph of ['5545988887711', '5545988887733', '5545988887755', '5545988887777']) assert.ok(idx.closedFor({ phone: ph }), ph);
  for (const ph of ['5545988887722', '5545988887744', '5545988887766', '5545988887788', '5599900000000']) assert.equal(idx.closedFor({ phone: ph }), '', ph);
  assert.equal(idx.closedFor({ phone: '45988887711' }), 'contrato assinado', 'sem o 55 também acha');
  assert.ok(idx.closedFor({ cpf: '529.982.247-25' }), 'pelo CPF');
});

test('guarda de contato: iniciativa nossa é barrada para quem recusou, quem já fechou conosco e quem acabou de ser chamado; resposta a cliente que escreveu só é barrada se ele recusou', () => {
  const idx = buildClosedIndex(people());
  const getClosed = () => idx;
  const proativo = { restart: true, kind: 'retomar' };
  const reativo = { texts: ['oi'] };
  assert.equal(isProactive(proativo), true);
  assert.equal(isProactive(reativo), false);
  const base = { key: 'k', phone: '5545988887788', messages: [] };
  assert.equal(outreachBlock({ conv: base, item: proativo, getClosed }), '', 'cliente aberto pode ser chamado');
  assert.equal(outreachBlock({ conv: { ...base, declined: { kind: 'fechou_outro' } }, item: proativo, getClosed }), 'recusou');
  assert.equal(outreachBlock({ conv: { ...base, declined: { kind: 'fechou_outro' } }, item: reativo, getClosed }), 'recusou', 'recusou: nem a fila de espera');
  assert.equal(outreachBlock({ conv: { ...base, phone: '5545988887711' }, item: proativo, getClosed }), 'fechou_conosco');
  assert.equal(outreachBlock({ conv: { ...base, phone: '5545988887711' }, item: reativo, getClosed }), '', 'cliente nosso que escreve é atendido');
  assert.equal(outreachBlock({ conv: { ...base, lastProactiveAt: Date.now() - 3_600_000 }, item: proativo, getClosed }), 'recente');
  assert.equal(outreachBlock({ conv: { ...base, lastProactiveAt: Date.now() - 13 * 3_600_000 }, item: proativo, getClosed }), '');
});

test('lembrete de orçamento a vencer não vai para quem já fechou com outro ou conosco, e a tentativa não se repete', () => {
  const store = tempStore();
  const conv = { key: '554199240001@s.whatsapp.net', phone: '554199240001', name: 'Billy', messages: [{ role: 'assistant', content: 'oi', at: new Date().toISOString() }] };
  store.data.conversations[conv.key] = conv;
  const agent = { conversation: (k) => store.data.conversations[k] || null };
  const pending = { queue: [], items: {}, enqueue: () => ({ queued: 1 }) };
  const hoje = new Date().toISOString().slice(0, 10);
  const quotes = [{ id: 'q1', number: 'ORC-1', client: 'Billy', phone: '554199240001', validUntil: hoje, plan: { total: 12997 } }];
  const r = noticeExpiringQuotes({ store, agent, pending, quotes, outreachBlock: () => 'recusou' });
  assert.equal(r.queued, 0);
  assert.equal(r.bloqueados, 1);
  assert.match(r.skipped[0].motivo, /fechou com outro ou não quer mais/);
  assert.ok(quotes[0].expiryNoticeAt, 'marcado como visto: não tenta de novo');
  assert.equal(Object.keys(pending.items).length, 0);
});

test('atendente: depois da recusa a próxima resposta é uma despedida simpática sem vender (uma vez); se o cliente volta a conversar, a recusa deixa de valer', async () => {
  const store = tempStore();
  store.updateSettings({ agent: { enabled: true, audience: 'all', triagePending: false, workHours: { enabled: false } } });
  const seen = [];
  const llm = { configured: true, chat: async ({ messages }) => { seen.push(messages[0].content); return { content: 'Parabéns, desejo muito sucesso!', tool_calls: [] }; } };
  const agent = new Agent({ store, llm, calendar: null });
  const key = '554199240001@s.whatsapp.net';
  const conv = agent.conversation(key);
  conv.declined = { kind: 'fechou_outro', at: Date.now(), text: 'já fechei', noteDue: true };
  await agent.handleIncoming({ key, phone: '554199240001', name: 'Billy', text: 'Muito obrigado já fechei' }, async () => {});
  assert.match(seen.at(-1), /CLIENTE JÁ RESOLVEU OU NÃO QUER MAIS/);
  assert.match(seen.at(-1), /NÃO tente vender/);
  assert.equal(conv.declined.noteDue, false, 'a nota vale uma vez só');
  await agent.handleIncoming({ key, phone: '554199240001', name: 'Billy', text: 'obrigado' }, async () => {});
  assert.ok(conv.declined, 'só agradecer não cancela a recusa');
  await agent.handleIncoming({ key, phone: '554199240001', name: 'Billy', text: 'na verdade o outro não deu certo, quanto custa o pacote ouro?' }, async () => {});
  assert.equal(conv.declined, undefined, 'voltou a conversar de verdade');
  assert.doesNotMatch(seen.at(-1), /CLIENTE JÁ RESOLVEU/);
});

import { PendingInbox } from '../src/pending.js';
import { AutoReply } from '../src/autoreply.js';
import { FakeWA } from './helpers.js';

function filaSetup() {
  const store = tempStore();
  store.updateSettings({ agent: { enabled: true, audience: 'all', triagePending: false, workHours: { enabled: false } } });
  const llm = { configured: true, chat: async () => ({ content: 'Oi! Tudo bem?', tool_calls: [] }) };
  const agent = new Agent({ store, llm, calendar: null });
  const wa = new FakeWA();
  const autoReply = new AutoReply({ store, wa, agent });
  const inbox = new PendingInbox({ store, agent, wa, autoReply, delay: [0, 0], careful: false });
  wa.send = async (to, payload) => { wa.sent.push({ to, ...payload }); inbox.resolve(to); return { jid: to }; };
  return { store, agent, wa, inbox, autoReply };
}

test('fila de envio: iniciativa nossa para quem recusou, quem já fechou conosco ou foi chamado agora não entra; o resto entra', () => {
  const { agent, inbox } = filaSetup();
  const idx = buildClosedIndex(people());
  inbox.outreachBlock = (jid, item) => outreachBlock({ conv: agent.conversation(jid, { create: false }), item: { ...item, jid }, getClosed: () => idx });
  const item = (phone) => ({ jid: `${phone}@s.whatsapp.net`, channel: 'whatsapp', phone, name: 'X', texts: [], at: Date.now(), restart: true, kind: 'retomar' });
  const add = (phone, conv = {}) => { inbox.items[`${phone}@s.whatsapp.net`] = item(phone); Object.assign(agent.conversation(`${phone}@s.whatsapp.net`), { phone, ...conv }); };
  add('5545988887788'); // aberto
  add('5545988887711'); // já fechou conosco (contrato assinado)
  add('5545900000001', { declined: { kind: 'fechou_outro' } });
  add('5545900000002', { lastProactiveAt: Date.now() - 3_600_000 });
  const r = inbox.enqueue(Object.keys(inbox.items));
  assert.equal(r.queued, 1);
  assert.deepEqual([r.reasons.fechouConosco, r.reasons.recusou, r.reasons.recente], [1, 1, 1]);
  assert.deepEqual(Object.keys(inbox.items), ['5545988887788@s.whatsapp.net'], 'os barrados não ficam pendurados em "esperando resposta"');
  inbox.cancel();
});

test('mensagem do cliente "já fechei com outro": o sistema marca, o prospecto vira perdido e o aviso do orçamento não sai mais; "não me chame mais" bloqueia e confirma', async () => {
  const { store, agent, wa, autoReply } = filaSetup();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const crm = new Crm({ store, auth });
  autoReply.onDecline = (msg, dc) => {
    const conv = agent.conversation(msg.jid); conv.phone ||= msg.phone;
    markDecline({ conv, decline: dc, text: msg.text, crm, store });
    if (dc.kind === 'nao_chamar') { wa.send(msg.jid, { text: 'Tudo bem, não vou mais te enviar mensagens.' }); return 'handled'; }
    return '';
  };
  const lead = crm.ensureFromConversation({ key: '554199240001@s.whatsapp.net', phone: '554199240001', name: 'Billy', channel: 'whatsapp' });
  await autoReply.handle({ jid: '554199240001@s.whatsapp.net', phone: '554199240001', name: 'Billy', text: 'Muito obrigado já fechei' });
  assert.equal(agent.conversation('554199240001@s.whatsapp.net').declined.kind, 'fechou_outro');
  assert.equal(crm.leads.find((l) => l.id === lead.id).stage, 'perdido');
  const antes = wa.sent.length;
  await autoReply.handle({ jid: '554199240002@s.whatsapp.net', phone: '554199240002', name: 'Caio', text: 'por favor não me chame mais' });
  assert.equal(store.isBlacklisted('554199240002'), true);
  assert.equal(wa.sent.length, antes + 1, 'só a confirmação educada, a IA não continua vendendo');
  assert.match(wa.sent.at(-1).text, /não vou mais/i);
});
