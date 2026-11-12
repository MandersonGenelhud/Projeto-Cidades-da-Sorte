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
  assert.equal(isStuck({ conv: c, lead: { handoff: { at: '2026-11-12' } } }), false);
  assert.equal(isStuck({ conv: c, lead: {}, humanSpoke: true }), false);
  assert.equal(isStuck({ conv: conv([['user', 'oi'], ['assistant', 'Olá! Qual seu interesse?']]), lead: {} }), false);
});

test('frases comuns de "encaminhei" são reconhecidas', () => {
  for (const t of ['Já encaminhei seu contato', 'Vou te encaminhar para um vendedor', 'Passei para o Eliezer', 'O consultor vai entrar em contato', 'Um vendedor irá te chamar', 'A equipe vai te chamar', 'Repassei o atendimento', 'Estou direcionando você']) assert.ok(HANDOFF_CLAIM.test(t), t);
  assert.ok(!HANDOFF_CLAIM.test('Olá! Qual é o seu interesse?'));
});
