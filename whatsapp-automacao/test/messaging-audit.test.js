import test from 'node:test';
import assert from 'node:assert/strict';
import { auditMessaging } from '../src/messaging-audit.js';

const now = new Date('2026-11-07T15:00:00Z');
const msg = (role, minAgo, content = 'x') => ({ role, content, at: new Date(now.getTime() - minAgo * 60_000).toISOString() });
const conv = (key, messages, extra = {}) => ({ key, name: key, phone: key.replace(/\D/g, '').slice(-12), updatedAt: messages.at(-1).at, messages, ...extra });

function run(settings, conversations, extra = {}) {
  return auditMessaging({ conversations, settings: { autoReplyEnabled: true, ...settings }, lines: [{ id: 'fran', label: 'Franciele' }], now, days: 3, senderLabel: (k) => k, ...extra });
}

test('modo de teste ligado: aponta o motivo e conta os clientes sem resposta só por causa disso', () => {
  const r = run({ agent: { enabled: true, audience: 'test', testNumbers: ['595981999999'] } }, [
    conv('595981000001@s.whatsapp.net', [msg('user', 30)]),
    conv('595981000002@s.whatsapp.net', [msg('user', 20)]),
    conv('595981999999@s.whatsapp.net', [msg('user', 10)]),
  ]);
  assert.ok(r.findings.some((f) => f.level === 'critico' && /TESTE/.test(f.text)));
  const p = r.senders.find((s) => s.key === 'principal');
  assert.equal(p.unanswered, 3);
  assert.equal(p.reasons.modo_teste, 2, 'os dois clientes fora da lista de teste');
  assert.equal(p.reasons.na_fila, 1, 'o número de teste não tem bloqueio');
  assert.equal(r.byReason.modo_teste, 2);
});

test('conversa pausada, IA desligada no número e bloqueio aparecem como motivos diferentes', () => {
  const r = run({ agent: { enabled: true, audience: 'all' } }, [
    conv('595981000001@s.whatsapp.net', [msg('user', 30)], { handoff: true, handoffReason: 'Você respondeu pelo celular' }),
    conv('l:fran:595981000002@s.whatsapp.net', [msg('user', 30)]),
    conv('595981000003@s.whatsapp.net', [msg('user', 30)]),
  ], { blacklisted: (p) => p?.endsWith('0003'), lines: [{ id: 'fran', label: 'Franciele', agent: false }] });
  const by = Object.fromEntries(r.map.map((m) => [m.whyCode, m]));
  assert.match(by.pausada.why, /respondeu pelo celular/);
  assert.ok(by.ia_desligada_numero);
  assert.ok(by.bloqueado);
  assert.ok(r.findings.some((f) => /PAUSADA/.test(f.text)));
});

test('mapa por cliente e por dia: mensagens recebidas e enviadas, fechamento e responsável', () => {
  const d0 = (minAgo, role) => msg(role, minAgo);
  const c = conv('595981000001@s.whatsapp.net', [d0(60 * 30, 'user'), d0(60 * 30 - 1, 'assistant'), d0(60, 'user'), d0(59, 'assistant'), d0(58, 'assistant')], { name: 'Carlos' });
  const r = run({ agent: { enabled: true, audience: 'all' } }, [c], { findLead: () => ({ ownerId: 'f', stage: 'ganho', stageLabel: 'Fechado', closedValue: 12997 }), ownerName: () => 'Franciele' });
  const row = r.map[0];
  assert.equal(row.in, 2); assert.equal(row.out, 3);
  assert.deepEqual(row.perDay.reduce((a, d) => [a[0] + d.in, a[1] + d.out], [0, 0]), [2, 3]);
  assert.equal(row.closed, true); assert.equal(row.value, 12997); assert.equal(row.owner, 'Franciele');
  assert.equal(row.waiting, false, 'foi respondido: não está esperando');
  const p = r.senders.find((s) => s.key === 'principal');
  assert.equal(p.inbound, 2); assert.equal(p.outbound, 3);
  assert.ok(r.findings.some((f) => f.level === 'ok'));
});

test('cada número mostra o próprio perfil de envio (e o número principal sempre aparece)', () => {
  const r = run({ agent: { enabled: true, audience: 'all', pendingPerHour: 30 }, sendProfiles: { principal: { perHour: 12 } } }, []);
  const p = r.senders.find((s) => s.key === 'principal');
  assert.equal(p.profile.perHour, 12); assert.equal(p.profile.custom, true);
  assert.equal(r.senders.find((s) => s.key === 'linha:fran').profile.perHour, 30);
});
