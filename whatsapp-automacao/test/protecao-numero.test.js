import test from 'node:test';
import assert from 'node:assert/strict';
import { SendGuard } from '../src/send-guard.js';
import { ConnectionManager } from '../src/connection.js';
import { tempStore } from './helpers.js';

const clock = () => { let t = 1_000_000; return { now: () => t, add: (ms) => { t += ms; } }; };

test('intervalo mínimo variável entre mensagens do mesmo número; números diferentes não esperam um pelo outro', () => {
  const c = clock();
  const g = new SendGuard({ now: c.now, random: () => 0.5, config: () => ({ minGapMs: 1500, jitterMs: 2000, perMinute: 12, newPerHour: 30 }) });
  g.noteInbound('linha:central', '5545999990001');
  assert.equal(g.plan('linha:central', '5545999990001'), 0);
  g.record('linha:central', '5545999990001');
  assert.equal(g.plan('linha:central', '5545999990001'), 2500, '1,5 s + metade de 2 s');
  assert.equal(g.plan('linha:outra', '5545999990001', { team: true }), 0);
});

test('teto por minuto: a 13ª mensagem espera a janela abrir', () => {
  const c = clock();
  const g = new SendGuard({ now: c.now, random: () => 0, config: () => ({ minGapMs: 0, jitterMs: 0, perMinute: 12, newPerHour: 999 }) });
  for (let i = 0; i < 12; i++) { g.record('principal', `55459999900${String(i).padStart(2, '0')}`, { team: true }); c.add(1000); }
  const w = g.plan('principal', '5545999990099', { team: true });
  assert.ok(w > 0 && w <= 60_000, `espera ${w}`);
});

test('contatos novos por hora: além do teto, recusa (não arrisca o número); quem já escreveu não conta', () => {
  const c = clock();
  const g = new SendGuard({ now: c.now, random: () => 0, config: () => ({ minGapMs: 0, jitterMs: 0, perMinute: 999, newPerHour: 3 }), isKnown: (a, d) => d === '5545000000999' });
  for (let i = 0; i < 3; i++) { g.plan('linha:central', `554500000000${i}`); g.record('linha:central', `554500000000${i}`); }
  assert.throws(() => g.plan('linha:central', '5545000000077'), /limite de 3 contatos novos por hora/);
  assert.equal(g.plan('linha:central', '5545000000999'), 0, 'já escreveu para este número (guardado nas conversas)');
  assert.equal(g.plan('linha:central', '5545000000001'), 0, 'já recebeu deste número hoje');
  assert.equal(g.plan('linha:central', '5545000000088', { team: true }), 0, 'aviso para alguém da equipe');
  c.add(61 * 60_000);
  assert.equal(g.plan('linha:central', '5545000000077'), 0, 'na hora seguinte libera');
});

test('desligada: não espera nem limita', () => {
  const g = new SendGuard({ config: () => ({ enabled: false }) });
  g.record('principal', '1'); assert.equal(g.plan('principal', '2'), 0);
});

test('o gerenciador de conexão aplica a proteção antes de cada envio e registra depois', async () => {
  const store = tempStore();
  const sent = [];
  const client = { on() {}, getState: () => ({ status: 'connected' }), send: async (to) => { sent.push(to); return { jid: to }; }, start: async () => {}, stop: async () => {} };
  const calls = [];
  const guard = { plan: (a, d, o) => { calls.push(['plan', a, d, o.team]); return 0; }, record: (a, d) => calls.push(['record', a, d]), noteInbound() {} };
  const wa = new ConnectionManager({ store, clients: { qr: client, cloud: client }, guard });
  await wa.send('5545999990001@s.whatsapp.net', { text: 'oi', team: true });
  assert.deepEqual(calls, [['plan', 'principal', '5545999990001', true], ['record', 'principal', '5545999990001']]);
  assert.equal(sent.length, 1);
});
