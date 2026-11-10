import test from 'node:test';
import assert from 'node:assert/strict';
import { dropLogDecision } from '../src/transports/whatsapp-web.js';

test('queda repetida do WhatsApp: o mesmo motivo vira um aviso a cada 30 minutos, com a contagem', () => {
  const msg = 'sem resposta do WhatsApp (código 408)';
  let st = null; const logs = [];
  const t0 = Date.parse('2026-11-10T08:00:00Z');
  for (let i = 0; i < 100; i++) { const d = dropLogDecision(st, msg, t0 + i * 60_000); st = d.state; if (d.log) logs.push(d.text); }
  assert.ok(logs.length <= 4, `100 tentativas em 100 minutos deveriam virar poucos avisos, vieram ${logs.length}`);
  assert.equal(logs[0], msg);
  assert.match(logs[1], /repetiu \d+x/);
  // motivo diferente sempre aparece na hora
  const outro = dropLogDecision(st, 'sessão encerrada no celular (código 401)', t0 + 101 * 60_000);
  assert.equal(outro.log, true);
  assert.equal(outro.text, 'sessão encerrada no celular (código 401)');
});

import { isTeamPhone } from '../src/sectors.js';
test('número da equipe falando com o número central não é tratado como cliente', () => {
  const users = [{ name: 'Marcos', whatsapp: '595991234567', active: true }, { name: 'Ex', whatsapp: '595981111111', active: false }, { name: 'Pend', whatsapp: '595982222222', pending: true }];
  assert.equal(isTeamPhone(users, '+595 991 234567'), true);
  assert.equal(isTeamPhone(users, '595981111111'), false, 'usuário inativo não conta');
  assert.equal(isTeamPhone(users, '595982222222'), false, 'cadastro pendente não conta');
  assert.equal(isTeamPhone(users, '5545999990000'), false, 'cliente');
  assert.equal(isTeamPhone(users, ''), false);
});
