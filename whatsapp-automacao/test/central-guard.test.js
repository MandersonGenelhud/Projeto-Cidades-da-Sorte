import test from 'node:test';
import assert from 'node:assert/strict';
import { needsAutoForward, isStuck, HANDOFF_CLAIM } from '../src/central-guard.js';

const conv = (msgs) => ({ key: 'l:c:5545988880001@s.whatsapp.net', messages: msgs.map(([role, content]) => ({ role, content })) });

test('a IA disse que encaminhou mas não chamou a ferramenta: o sistema encaminha e NÃO manda aviso repetido ao cliente', () => {
  const c = conv([['user', 'quero residência'], ['assistant', 'Já passei o seu atendimento para o Eliezer, ele vai chamar você.']]);
  const d = needsAutoForward({ conv: c, text: c.messages.at(-1).content, actions: [], lead: {} });
  assert.deepEqual([d.should, d.tellClient, d.claims], [true, false, true]);
});

test('a IA chamou a ferramenta com sucesso: nada a fazer; ferramenta com erro: o sistema encaminha', () => {
  const c = conv([['user', 'oi'], ['assistant', 'Encaminhei para a equipe.']]);
  assert.equal(needsAutoForward({ conv: c, text: 'Encaminhei', actions: [{ tool: 'passar_fechamento_para_humano', result: { ok: true } }], lead: {} }).should, false);
  assert.equal(needsAutoForward({ conv: c, text: 'Encaminhei', actions: [{ tool: 'passar_fechamento_para_humano', result: { erro: 'falhou' } }], lead: {} }).should, true);
});

test('ainda perguntando o interesse (1ª mensagem do cliente, sem promessa): espera; na 2ª mensagem do cliente o sistema encaminha e avisa', () => {
  const um = conv([['user', 'oi'], ['assistant', 'Olá! Seu interesse é documentação, imóveis ou veículos?']]);
  assert.equal(needsAutoForward({ conv: um, text: um.messages.at(-1).content, actions: [], lead: {} }).should, false);
  const dois = conv([['user', 'oi'], ['assistant', 'Qual seu interesse?'], ['user', 'quero a residência'], ['assistant', 'Que ótimo! Me conta mais sobre você.']]);
  const d = needsAutoForward({ conv: dois, text: dois.messages.at(-1).content, actions: [], lead: {} });
  assert.deepEqual([d.should, d.tellClient], [true, true]);
});

test('não encaminha de novo, nem por cima de pessoa, recusa, cliente fechado ou perdido', () => {
  const c = conv([['user', 'a'], ['assistant', 'Encaminhei'], ['user', 'b']]);
  const base = { conv: c, text: 'Encaminhei', actions: [] };
  assert.equal(needsAutoForward({ ...base, lead: { handoff: { at: 'x' } } }).should, false);
  assert.equal(needsAutoForward({ ...base, lead: {}, humanSpoke: true }).should, false);
  assert.equal(needsAutoForward({ ...base, lead: { stage: 'ganho' } }).should, false);
  assert.equal(needsAutoForward({ ...base, lead: { stage: 'perdido' } }).should, false);
  assert.equal(needsAutoForward({ conv: { ...c, declined: { kind: 'sem_interesse' } }, text: 'Encaminhei', actions: [], lead: {} }).should, false);
});

test('conversa "presa": disse que encaminhou, sem registro de encaminhamento', () => {
  const c = conv([['user', 'quero um terreno'], ['assistant', 'Vou te passar para o corretor, ele entra em contato.']]);
  assert.equal(isStuck({ conv: c, lead: {} }), true);
  const now = new Date('2026-11-12T18:00:00Z').getTime();
  assert.equal(isStuck({ conv: c, lead: { handoff: { at: '2026-11-12T10:00:00Z', notifiedAt: '2026-11-12T10:00:05Z' } }, now }), false, 'aviso entregue ao vendedor');
  assert.equal(isStuck({ conv: c, lead: { handoff: { at: '2026-11-12T10:00:00Z' } }, now }), true, 'encaminhado hoje, mas o aviso não chegou ao vendedor: reenviar');
  assert.equal(isStuck({ conv: c, lead: { handoff: { at: '2026-11-01T10:00:00Z' } }, now }), false, 'antigo: não mexe');
  assert.equal(isStuck({ conv: c, lead: {}, humanSpoke: true }), false);
  assert.equal(isStuck({ conv: conv([['user', 'oi'], ['assistant', 'Olá! Qual seu interesse?']]), lead: {} }), false);
});

test('frases comuns de "encaminhei" são reconhecidas', () => {
  for (const t of ['Já encaminhei seu contato', 'Vou te encaminhar para um vendedor', 'Passei para o Eliezer', 'O consultor vai entrar em contato', 'Um vendedor irá te chamar', 'A equipe vai te chamar', 'Repassei o atendimento', 'Estou direcionando você']) assert.ok(HANDOFF_CLAIM.test(t), t);
  assert.ok(!HANDOFF_CLAIM.test('Olá! Qual é o seu interesse?'));
});

import { needsDelivery, rotationReasons } from '../src/central-guard.js';

test('pendentes da Central: tudo que não chegou a um VENDEDOR entra; o resto fica de fora', () => {
  const now = new Date('2026-11-12T18:00:00Z').getTime();
  const c = (extra = {}) => ({ key: 'l:c:1@s.whatsapp.net', updatedAt: '2026-11-12T15:00:00Z', messages: [{ role: 'user', content: 'oi' }], ...extra });
  assert.equal(needsDelivery({ conv: c(), lead: {}, now }), true, 'nunca encaminhado');
  assert.equal(needsDelivery({ conv: c(), lead: { handoff: { at: 'x', toId: null, notifiedAt: 'y' } }, now }), true, 'foi só aos administradores (sem vendedor)');
  assert.equal(needsDelivery({ conv: c(), lead: { handoff: { at: 'x', toId: 'geo' } }, now }), true, 'aviso ao vendedor não chegou');
  assert.equal(needsDelivery({ conv: c(), lead: { handoff: { at: 'x', toId: 'geo', notifiedAt: 'y' } }, now }), false, 'chegou ao vendedor');
  assert.equal(needsDelivery({ conv: c(), lead: {}, humanSpoke: true, now }), false, 'pessoa já falou');
  assert.equal(needsDelivery({ conv: c({ declined: { kind: 'sem_interesse' } }), lead: {}, now }), false, 'recusou');
  assert.equal(needsDelivery({ conv: c(), lead: { stage: 'ganho' }, now }), false, 'já fechou');
  assert.equal(needsDelivery({ conv: c({ updatedAt: '2026-11-12T17:59:00Z' }), lead: {}, now }), false, 'conversa acontecendo agora: espera a Central terminar');
  assert.equal(needsDelivery({ conv: c({ updatedAt: '2026-10-01T10:00:00Z' }), lead: {}, now }), false, 'mais de 7 dias');
  assert.equal(needsDelivery({ conv: c({ messages: [] }), lead: {}, now }), false, 'cliente não escreveu');
});

test('rodízio: diz exatamente por que alguém está fora', () => {
  assert.deepEqual(rotationReasons({ role: 'seller', whatsapp: '5545', receivesLeads: true }), []);
  assert.deepEqual(rotationReasons({ role: 'seller', whatsapp: '', receivesLeads: true }), ['sem WhatsApp no cadastro']);
  assert.deepEqual(rotationReasons({ role: 'seller', whatsapp: '5545', receivesLeads: false }), ['rodízio desligado']);
  assert.deepEqual(rotationReasons({ role: 'seller', whatsapp: '5545', receivesLeads: true, sectors: ['loteamentos'] }), ['só atende imóveis']);
  assert.deepEqual(rotationReasons({ role: 'seller', whatsapp: '5545', receivesLeads: true, active: false }), ['desativado']);
  assert.ok(rotationReasons({ role: 'seller', whatsapp: '5545', receivesLeads: true }, { isCentral: true }).includes('é o usuário da Central'));
});
