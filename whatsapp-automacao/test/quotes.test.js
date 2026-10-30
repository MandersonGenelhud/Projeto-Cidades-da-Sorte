import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Auth } from '../src/auth.js';
import { Crm } from '../src/crm.js';
import { Quotes } from '../src/quotes.js';
import { chatPreview } from '../src/routing.js';
import { presetSettings } from '../src/agent/presets.js';
import { tempStore } from './helpers.js';

function setup() {
  const store = tempStore();
  store.updateSettings(presetSettings('migra-paraguai'));
  const auth = new Auth({ store, dataDir: store.dataDir });
  const crm = new Crm({ store, auth });
  const quotes = new Quotes({ store, dataDir: store.dataDir, secret: 's', matchPackage: (n) => crm.matchPackage(n) });
  return { store, quotes };
}

test('orçamento ORC: mesmos valores do orçamento da Migra (Ouro + Inicial, 2 adultos), PDF e mensagem', () => {
  const { store, quotes } = setup();
  const q = quotes.create({ items: [{ pacote: 'Ouro', quantidade: 1 }, { pacote: 'Inicial', quantidade: 1 }], adults: 2, client: 'Luiza', consultant: 'Marcos', start: '2026-10-29' });
  assert.equal(q.number, 'ORC-2026-09767', 'continua a numeração da Migra');
  assert.equal(q.validUntil, '2026-11-05');
  assert.equal(q.plan.total, 23994);
  assert.equal(q.plan.entry, 2600);
  assert.deepEqual(q.plan.parcels.map((x) => x.value), [10697, 6418.2, 4278.8]);
  const pdf = fs.readFileSync(quotes.file(q));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const msg = quotes.message(q, 'https://painel/orcamento/x');
  assert.match(msg, /^\*Orçamento ORC-2026-09767\* 🇵🇾/);
  assert.match(msg, /• PACOTE OURO\n• PACOTE INICIAL/);
  assert.match(msg, /\*Total: R\$ 23\.994,00\*/);
  assert.match(msg, /\*Pagamento no PIX\*\n• Entrada: R\$ 2\.600,00/);
  assert.match(msg, /sinal de contratação dos serviços/);
  assert.match(msg, /1ª parcela \(50%\) · 13\/11\/2026: R\$ 10\.697,00/);
  assert.match(msg, /Válido até 05\/11\/2026/);
  assert.match(msg, /\*PDF do orçamento:\* https:\/\/painel/);
  // Sequência e quantidade agrupada.
  const q2 = quotes.create({ items: [{ pacote: 'Ouro', quantidade: 1 }, { pacote: 'ouro', quantidade: 1 }], start: '2026-10-30' });
  assert.equal(q2.number, 'ORC-2026-09768');
  assert.equal(q2.items.length, 1);
  assert.equal(q2.plan.total, 25994);
  assert.match(quotes.message(q2), /• PACOTE OURO × 2/);
  assert.equal(quotes.get(q2.id, quotes.token(q2.id)).id, q2.id);
  assert.equal(quotes.get(q2.id, 'errado'), null);
  assert.throws(() => quotes.create({ items: [{ pacote: 'Diamante', quantidade: 1 }] }), /Pacote não encontrado/);
  assert.equal(store.data.quotes.length, 2);
});

test('prévia da conversa para o atendente: últimas mensagens dos dois lados', () => {
  const conv = { messages: Array.from({ length: 14 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `msg ${i}` })) };
  const p = chatPreview(conv, 10);
  assert.equal(p.split('\n').length, 10);
  assert.match(p, /^👤 msg 4/);
  assert.match(p, /🤖 msg 13$/);
});

test('orçamento com parcelas combinadas pelo vendedor: somam 100% do saldo e ficam no PDF', () => {
  const { quotes } = setup();
  const q = quotes.create({ items: [{ pacote: 'Ouro', quantidade: 2 }], adults: 2, client: 'João', start: '2026-10-30',
    parcels: [{ pct: 40, date: '2026-11-16' }, { pct: 30, date: '2026-12-15' }, { pct: 30, date: '2027-01-15' }], createdBy: { id: 'u1', name: 'Silvane Nunes' } });
  assert.equal(q.plan.custom, true);
  assert.deepEqual(q.plan.parcels.map((x) => x.value), [9357.6, 7018.2, 7018.2]);
  assert.equal(q.createdBy.name, 'Silvane Nunes');
  assert.throws(() => quotes.compute({ items: [{ pacote: 'Ouro', quantidade: 1 }], start: '2026-10-30', parcels: [{ pct: 50, date: '2026-11-16' }] }), /somar 100%/);
  assert.throws(() => quotes.compute({ items: [{ pacote: 'Ouro', quantidade: 1 }], start: '2026-10-30', parcels: [{ pct: 100, date: '2026-10-01' }] }), /Data da 1ª parcela/);
  // Prévia não gasta número.
  const before = quotes.config.nextNumber;
  quotes.compute({ items: [{ pacote: 'Ouro', quantidade: 1 }], start: '2026-10-30' });
  assert.equal(quotes.config.nextNumber, before);
});
