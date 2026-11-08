import test from 'node:test';
import assert from 'node:assert/strict';
import { detectClosedByMessages } from '../src/closed-signals.js';
import { outreachBlock } from '../src/outreach-guard.js';
import { collectStalled } from '../src/restart.js';
import { buildPlan } from '../src/atendimento-plano.js';

const NOW = Date.parse('2026-11-08T15:00:00Z');
const h = (n) => new Date(NOW - n * 3_600_000).toISOString();
const conv = (key, msgs, extra = {}) => ({ key, phone: key.replace(/\D/g, ''), messages: msgs.map(([role, content, ago]) => ({ role, content, at: h(ago) })), ...extra });

test('últimas 20 mensagens: pagamento confirmado, comprovante recebido ou "vamos dar continuidade ao seu processo" = já é cliente', () => {
  assert.ok(detectClosedByMessages(conv('5511900000001', [['user', 'Oi', 50], ['assistant', 'Pagamento confirmado! Obrigado pela confiança.', 49]])));
  assert.ok(detectClosedByMessages(conv('5511900000002', [['user', '[áudio] Paguei a entrada ontem, obrigado', 30]])));
  assert.ok(detectClosedByMessages(conv('5511900000003', [['assistant', 'Agora vamos dar continuidade ao seu processo.', 5]])));
  assert.ok(detectClosedByMessages(conv('5511900000004', [['assistant', 'Mande o comprovante', 9], ['user', 'ok, vou juntar os documentos', 8]])), 'dois sinais fracos juntos');
  assert.equal(detectClosedByMessages(conv('5511900000005', [['user', 'Quanto custa o RG paraguaio?', 4], ['assistant', 'Custa X, posso fazer o orçamento', 3]])), '');
  assert.equal(detectClosedByMessages(conv('5511900000006', [['user', 'mande o comprovante?', 4]])), '', 'um sinal fraco sozinho não basta');
  // só as últimas 20 contam
  const old = [['assistant', 'Pagamento confirmado!', 100], ...Array.from({ length: 20 }, (_, i) => ['user', `oi ${i}`, 90 - i])];
  assert.equal(detectClosedByMessages(conv('5511900000007', old)), '');
});

test('guarda de contato: cliente com pagamento na conversa e pausa geral bloqueiam chamada de iniciativa, mas não a resposta a quem escreveu', () => {
  const fechado = conv('5511911110000', [['assistant', 'Recebemos o seu pagamento, seja bem-vindo à Migra', 20]]);
  assert.equal(outreachBlock({ conv: fechado, item: { restart: true }, now: NOW }), 'fechou_conosco');
  assert.equal(outreachBlock({ conv: fechado, item: { kind: 'nudge' }, now: NOW }), 'fechou_conosco');
  assert.equal(outreachBlock({ conv: fechado, item: { texts: ['oi'] }, now: NOW }), '', 'resposta a quem escreveu agora segue normal');
  const novo = conv('5511922220000', [['user', 'oi', 30]]);
  assert.equal(outreachBlock({ conv: novo, item: { restart: true }, now: NOW, paused: true }), 'pausado');
  assert.equal(outreachBlock({ conv: novo, item: { texts: ['oi'] }, now: NOW, paused: true }), '', 'pausa geral não impede atender quem escreve');
  assert.equal(outreachBlock({ conv: novo, item: { restart: true }, now: NOW }), '');
});

test('recomeçar e plano: quem já é cliente ou recusou fica de fora; só o que ficou sem continuidade é retomado', () => {
  const convs = [
    conv('5511900000010', [['user', 'quero saber do RG', 30]]),                                           // retomar (esperando)
    conv('5511900000011', [['user', 'preciso', 100], ['assistant', 'claro, como posso ajudar', 99]]),     // retomar (sumiu)
    conv('5511900000012', [['user', 'oi', 40], ['assistant', 'Pagamento confirmado, vamos dar continuidade ao seu processo', 39]]), // fechado
    conv('5511900000013', [['user', 'já fechei com outro', 40]], { declined: { kind: 'fechou_outro' } }),   // recusou
    conv('5511900000014', [['user', 'fim de semana?', 30]], { handoff: true, handoffReason: 'Conversa do Marcos (pessoal): família' }),
    conv('5511900000015', [['user', 'oi', 2], ['assistant', 'olá!', 1]]),                                   // em dia
    conv('5511900000016', [['user', 'oi', 30]], { handoff: true, handoffReason: 'Atendimento da Camila' }),
  ];
  const stalled = collectStalled({ conversations: convs, now: NOW, days: 30 }).map((x) => x.key);
  assert.ok(stalled.includes('5511900000010') && stalled.includes('5511900000011'));
  assert.ok(!stalled.includes('5511900000015') && !stalled.includes('5511900000016'));
  assert.ok(!stalled.includes('5511900000012') && !stalled.includes('5511900000013'));
  const store = { data: { conversations: Object.fromEntries(convs.map((c) => [c.key, c])) } };
  const p = buildPlan({ store, now: NOW, days: 30 });
  assert.equal(p.total, 7);
  assert.equal(p.fechados, 1);
  assert.equal(p.recusaram, 1);
  assert.equal(p.marcos, 1);
  assert.equal(p.comHumano, 1);
  assert.equal(p.retomar, 2);
  assert.equal(p.emDia, 1);
  // quem o banco diz que já fechou também sai do plano
  const p2 = buildPlan({ store, now: NOW, days: 30, closedFor: ({ phone }) => (phone === '5511900000010' ? 'Pix pago' : '') });
  assert.equal(p2.fechados, 2);
  assert.equal(p2.retomar, 1);
});
