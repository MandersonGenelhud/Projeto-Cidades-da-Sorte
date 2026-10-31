import test from 'node:test';
import assert from 'node:assert/strict';
import { AutoReply, ruleMatches } from '../src/autoreply.js';
import { FakeWA, tempStore } from './helpers.js';

test('ruleMatches por tipo', () => {
  const r = (matchType, keywords) => ({ enabled: true, matchType, keywords });
  assert.ok(ruleMatches(r('contains', ['preço']), 'Qual o PRECO?'));
  assert.ok(!ruleMatches(r('contains', ['oi']), 'boi bonito'));
  assert.ok(ruleMatches(r('exact', ['1']), ' 1 '));
  assert.ok(!ruleMatches(r('exact', ['1']), '10'));
  assert.ok(ruleMatches(r('startsWith', ['pedido']), 'Pedido 123'));
  assert.ok(ruleMatches(r('regex', ['^\\d{3}$']), '123'));
  assert.ok(!ruleMatches(r('regex', ['(']), 'x'));
  assert.ok(ruleMatches(r('any', []), 'qualquer coisa'));
  assert.ok(!ruleMatches({ ...r('any', []), enabled: false }, 'x'));
});

test('responde pela regra de maior prioridade, salva contato e etiqueta', async () => {
  const store = tempStore();
  const wa = new FakeWA();
  const bot = new AutoReply({ store, wa });
  bot.save({ name: 'padrão', matchType: 'any', response: 'Padrão', priority: 99 });
  bot.save({ name: 'preço', matchType: 'contains', keywords: 'preço, valor', response: 'Oi {primeiro_nome}, custa R$10', addTag: 'lead', priority: 1 });

  await bot.handle({ jid: '5521987654321@s.whatsapp.net', phone: '5521987654321', name: 'Ana Souza', text: 'qual o valor?' });
  assert.equal(wa.sent.length, 1);
  assert.equal(wa.sent[0].text, 'Oi Ana, custa R$10');
  const contact = store.data.contacts.find((c) => c.phone === '5521987654321');
  assert.deepEqual(contact.tags, ['whatsapp', 'lead']);
});

test('descadastro (SAIR) adiciona à lista e bloqueia novas respostas; VOLTAR reativa', async () => {
  const store = tempStore();
  const wa = new FakeWA();
  const bot = new AutoReply({ store, wa });
  bot.save({ name: 'tudo', matchType: 'any', response: 'Olá' });
  const msg = (text) => ({ jid: '5511912345678@s.whatsapp.net', phone: '5511912345678', name: 'Bia', text });

  await bot.handle(msg('Sair'));
  assert.ok(store.isBlacklisted('5511912345678'));
  await bot.handle(msg('oi'));
  assert.equal(wa.sent.length, 1); // só a confirmação do descadastro
  await bot.handle(msg('voltar'));
  assert.ok(!store.isBlacklisted('5511912345678'));
  assert.equal(wa.sent.length, 2);
});

test('ignora grupos e respeita o intervalo entre respostas', async () => {
  const store = tempStore();
  store.updateSettings({ replyCooldownMinutes: 10 });
  const wa = new FakeWA();
  const bot = new AutoReply({ store, wa });
  bot.save({ name: 'tudo', matchType: 'any', response: 'Olá' });

  await bot.handle({ jid: '123@g.us', isGroup: true, phone: '5521999999999', text: 'oi' });
  assert.equal(wa.sent.length, 0);
  const m = { jid: '5521987654321@s.whatsapp.net', phone: '5521987654321', text: 'oi' };
  await bot.handle(m);
  await bot.handle(m);
  assert.equal(wa.sent.length, 1);
});

test('fora do horário de atendimento envia o aviso', () => {
  const store = tempStore();
  store.updateSettings({ businessHours: { enabled: true, days: [1], start: '08:00', end: '09:00', message: 'Fechado' } });
  const bot = new AutoReply({ store, wa: new FakeWA() });
  const d = bot.decide({ text: 'oi', phone: '5521987654321' }, new Date(2026, 9, 25, 12, 0));
  assert.equal(d.kind, 'offhours');
  assert.equal(d.text, 'Fechado');
});

test('Instagram: perfis do Grupo Migra (menções em story) não recebem resposta da atendente', async () => {
  const { AutoReply } = await import('../src/autoreply.js');
  const { tempStore: ts } = await import('./helpers.js');
  const store = ts();
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  const ar = new AutoReply({ store, wa: { on() {} }, notify() {}, agent: { active: true } });
  assert.equal(ar.ignoredInstagram('migra_motors'), true);
  assert.equal(ar.ignoredInstagram('@MigraImobiliaria'), true);
  assert.equal(ar.agentAllowed({ username: 'migracontabilidade', channel: 'instagram' }), false);
  assert.equal(ar.agentAllowed({ username: 'ana.maria', channel: 'instagram' }), true);
  assert.equal(ar.decide({ username: 'migraparaguai.londrina', text: 'Mencionou você', jid: 'ig:1' }), null);
});
