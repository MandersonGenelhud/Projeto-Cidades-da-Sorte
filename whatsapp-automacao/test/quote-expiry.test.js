import test from 'node:test';
import assert from 'node:assert/strict';
import { expiringQuotes, noticeExpiringQuotes, quoteNote } from '../src/quote-expiry.js';
import { OWNER_PAUSE } from '../src/agent/agent.js';

const NOW = Date.parse('2026-11-10T15:00:00Z');
const jid = (n) => `${n}@s.whatsapp.net`;
const q = (id, over = {}) => ({ id, number: `ORC-2026-${id}`, client: `Cliente ${id}`, phone: `5511900000${id}`, validUntil: '2026-11-11', ...over });
const conv = (n, extra = {}) => ({ key: jid(`5511900000${n}`), phone: `5511900000${n}`, name: `Cliente ${n}`, messages: [{ role: 'assistant', content: 'oi', at: new Date(NOW - 3 * 86_400_000).toISOString() }], ...extra });

function setup(convs) {
  const store = { data: { conversations: Object.fromEntries(convs.map((c) => [c.key, c])) }, save() {} };
  const agent = { conversation: (k) => store.data.conversations[k] || null };
  const pending = { queue: [], items: {}, enqueue(keys) { for (const k of keys) if (!this.queue.includes(k)) this.queue.push(k); return { queued: keys.length }; } };
  return { store, agent, pending };
}

test('só entram orçamentos que vencem hoje ou amanhã, sem contrato e sem venda', () => {
  const quotes = [q('01'), q('02', { validUntil: '2026-11-10' }), q('03', { validUntil: '2026-11-15' }), q('04', { validUntil: '2026-11-09' }), q('05', { contract: { id: 'c' } }), q('06')];
  const r = expiringQuotes({ quotes, sales: [{ quoteId: '06' }], now: NOW });
  assert.deepEqual(r.map((x) => x.id), ['01', '02']);
});

test('avisa pela conversa existente, uma vez só, com o prazo real na instrução da IA', () => {
  const { store, agent, pending } = setup([conv('01')]);
  const quotes = [q('01')];
  const r = noticeExpiringQuotes({ store, agent, pending, quotes, now: NOW });
  assert.equal(r.queued, 1);
  const item = pending.items[jid('551190000001')];
  assert.equal(item.kind, 'orcamento');
  assert.equal(item.noOpening, true);
  assert.equal(item.quote.daysLeft, 1);
  assert.match(quoteNote(item), /AMANHÃ/);
  assert.match(quoteNote(item), /11\/11\/2026/);
  assert.match(quoteNote(item), /PROIBIDO: inventar desconto/);
  assert.ok(quotes[0].expiryNoticeAt);
  pending.queue = []; // a fila andou
  const again = noticeExpiringQuotes({ store, agent, pending, quotes, now: NOW + 3_600_000 });
  assert.equal(again.queued, 0);
  assert.equal(again.jaAvisados, 1);
});

test('não incomoda: bloqueado, fechado, atendente humano, sem conversa, sem telefone', () => {
  const convs = [conv('01'), conv('02'), conv('03', { handoff: true, handoffReason: 'Assumido pelo painel' }), conv('04', { handoff: true, handoffReason: OWNER_PAUSE, ownerRepliedAt: NOW - 10 * 60_000 })];
  const { store, agent, pending } = setup(convs);
  const quotes = [q('01'), q('02'), q('03'), q('04'), q('05'), q('06', { phone: '' })];
  const r = noticeExpiringQuotes({
    store, agent, pending, quotes, now: NOW,
    isBlocked: (p) => p === '551190000001',
    leadOf: (c) => (c.phone === '551190000002' ? { stage: 'ganho' } : null),
  });
  assert.equal(r.queued, 0);
  assert.equal(r.bloqueados, 1);
  assert.equal(r.fechados, 1);
  assert.equal(r.comAtendente, 2); // atendente do painel e o dono que acabou de falar
  assert.equal(r.semConversa, 2); // sem conversa guardada e sem telefone: ninguém recebe mensagem "do nada"
  assert.ok(r.skipped.every((s) => s.motivo));
  assert.equal(Object.keys(pending.items).length, 0);
  assert.ok(quotes.every((x) => !x.expiryNoticeAt));
});

test('pausa antiga do "respondi pelo celular" é destravada; dryRun só conta e não altera nada', () => {
  const c = conv('01', { handoff: true, handoffReason: OWNER_PAUSE, ownerRepliedAt: NOW - 5 * 3_600_000 });
  const { store, agent, pending } = setup([c]);
  const quotes = [q('01')];
  const dry = noticeExpiringQuotes({ store, agent, pending, quotes, now: NOW, dryRun: true });
  assert.equal(dry.queued, 1);
  assert.equal(c.handoff, true);
  assert.equal(quotes[0].expiryNoticeAt, undefined);
  assert.equal(pending.queue.length, 0);
  const r = noticeExpiringQuotes({ store, agent, pending, quotes, now: NOW });
  assert.equal(r.queued, 1);
  assert.equal(c.handoff, false);
});

test('se a fila recusar (número desconectado, modo de teste), o orçamento NÃO é marcado como avisado', () => {
  const { store, agent, pending } = setup([conv('01')]);
  pending.enqueue = () => ({ queued: 0 }); // nada entrou
  const quotes = [q('01')];
  const r = noticeExpiringQuotes({ store, agent, pending, quotes, now: NOW });
  assert.equal(r.queued, 0);
  assert.equal(quotes[0].expiryNoticeAt, undefined);
  assert.equal(pending.items[jid('551190000001')], undefined);
});
