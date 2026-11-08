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
  assert.match(msg, /1ª parcela \(50%\): R\$ 10\.697,00\n   Com vencimento ou data de pagamento na 1ª vinda ao Paraguai/);
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

test('orçamento: Assessoria Prime (R$ 2.750 e R$ 1.560), desconto de 1 a 15% e entrada nunca maior que o total', () => {
  const store = tempStore();
  store.updateSettings(presetSettings('migra-paraguai'));
  const auth = new Auth({ store, dataDir: store.dataDir });
  const crm = new Crm({ store, auth });
  const quotes = new Quotes({ store, dataDir: store.dataDir, secret: 's', matchPackage: (n) => crm.matchPackage(n) });
  const a = quotes.compute({ items: [{ pacote: 'Assessoria Prime R$ 2.750', quantidade: 1 }], adults: 1 });
  assert.equal(a.plan.total, 2750);
  const b = quotes.compute({ items: [{ pacote: 'Assessoria Prime R$ 1.560', quantidade: 1 }], adults: 1 });
  assert.equal(b.plan.total, 1560);
  assert.ok(b.plan.entry <= b.plan.total, 'a entrada não passa do total');
  assert.ok(b.plan.parcels.every((x) => x.value >= 0));
  const c = quotes.compute({ items: [{ pacote: 'Assessoria Prime R$ 2.750', quantidade: 1 }], adults: 1, discountPct: 10 });
  assert.deepEqual([c.plan.subtotal, c.plan.discount, c.plan.total, c.plan.discountPct], [2750, 275, 2475, 10]);
  assert.throws(() => quotes.compute({ items: [{ pacote: 'Assessoria Prime R$ 2.750' }], discountPct: 20 }), /0 a 15%/);
  const q = quotes.create({ items: [{ pacote: 'Assessoria Prime R$ 2.750', quantidade: 1 }], adults: 1, client: 'Ana', discountPct: 15 });
  assert.equal(q.plan.total, 2337.5);
  assert.match(quotes.message(q), /Desconto de 15%/);
});

test('memória da atendente: quem vai morar precisa da licença paraguaia (Ouro), mesmo achando que a CNH basta', async () => {
  const { buildSystemPrompt } = await import('../src/agent/prompt.js');
  const fsm = await import('node:fs');
  const pathm = await import('node:path');
  const { Store } = await import('../src/store.js');
  const store = tempStore();
  store.updateSettings(presetSettings('migra-paraguai'));
  assert.match(buildSystemPrompt(store.settings), /CNH brasileira serve para dirigir/);
  // Sistema que já estava rodando (FAQ sem essa memória): recebe uma vez só ao reiniciar.
  store.settings.business.faq = 'Pergunta antiga? Resposta antiga.';
  delete store.settings.agent.cnhMemory2026;
  store.flush();
  const again = new Store(store.dataDir);
  assert.match(again.settings.business.faq, /Pergunta antiga\?[\s\S]*CNH brasileira serve/);
  const once = new Store(store.dataDir);
  assert.equal((once.settings.business.faq.match(/CNH brasileira serve/g) || []).length, 1, 'não repete');
  assert.ok(fsm && pathm);
});

test('memória da atendente: crise do Paraguai (nov/2026) com cautela, sem afirmar fatos que mudam e sem conselho de banco', async () => {
  const { buildSystemPrompt } = await import('../src/agent/prompt.js');
  const { Store } = await import('../src/store.js');
  const store = tempStore();
  store.updateSettings(presetSettings('migra-paraguai'));
  const p = buildSystemPrompt(store.settings);
  assert.match(p, /Momento político e bancário do Paraguai/);
  assert.match(p, /NÃO afirme quem é o presidente hoje/);
  assert.match(p, /venha com planejamento e estratégia/);
  assert.match(p, /Ueno Bank, que é uma fintech/);
  assert.match(p, /Continental, Familiar e Itaú/);
  assert.match(p, /nunca afirme que alguém é culpado/);
  assert.doesNotMatch(p, /falta de dinheiro nos bancos/);
  store.settings.business.knowledge = 'Conhecimento antigo.';
  delete store.settings.agent.crisisMemory2026b;
  store.flush();
  const again = new Store(store.dataDir);
  assert.match(again.settings.business.knowledge, /Momento político[\s\S]*Conhecimento antigo/);
  assert.equal((new Store(store.dataDir).settings.business.knowledge.match(/Momento político e bancário/g) || []).length, 1, 'não repete');
  // Quem já tinha a versão 1 no painel recebe a 2 no lugar dela (sem duplicar e sem perder o resto do conhecimento).
  const v1 = '# Momento político e bancário do Paraguai (novembro de 2026): como responder\n- texto antigo: falta de dinheiro nos bancos\n';
  const s2 = tempStore();
  s2.updateSettings(presetSettings('migra-paraguai'));
  s2.settings.business.knowledge = `${v1}\n# Outro assunto\nConteúdo que precisa ficar.`;
  delete s2.settings.agent.crisisMemory2026b;
  s2.flush();
  const up = new Store(s2.dataDir).settings.business.knowledge;
  assert.match(up, /Ueno Bank, que é uma fintech/);
  assert.doesNotMatch(up, /texto antigo/);
  assert.match(up, /# Outro assunto\nConteúdo que precisa ficar\./);
  assert.equal((up.match(/Momento político e bancário/g) || []).length, 1);
});

test('orçamento, plano padrão: valores iguais, e o vencimento acompanha a 1ª vinda ao Paraguai e o pagamento anterior (sem data fixa)', async () => {
  const { execFileSync } = await import('node:child_process');
  const { store, quotes } = setup();
  const q = quotes.create({ items: [{ pacote: 'Ouro', quantidade: 1 }], adults: 1, client: 'Ana', consultant: 'Marcos', start: '2026-10-29' });
  assert.deepEqual(q.plan.parcels.map((x) => x.value).reduce((a, b) => a + b, q.plan.entry), q.plan.total, 'os valores seguem fechando o total');
  const msg = quotes.message(q);
  assert.match(msg, /Com vencimento ou data de pagamento na 1ª vinda ao Paraguai/);
  assert.match(msg, /Vencimento previsto entre 60 e 90 dias após a 1ª vinda ao Paraguai/);
  assert.match(msg, /Vencimento 30 dias após o pagamento da 2ª parcela/);
  for (const x of q.plan.parcels) assert.ok(msg.includes(`R$ ${x.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`), 'cada valor continua na mensagem');
  for (const x of q.plan.parcels) assert.ok(!msg.includes(`· ${x.date.split('-').reverse().join('/')}:`), 'sem data fixa nas parcelas');
  let text;
  try { text = execFileSync('pdftotext', ['-layout', quotes.file(q), '-'], { encoding: 'utf8' }).replace(/\s+/g, ' '); } catch { return; }
  assert.match(text, /na 1ª vinda ao Paraguai/);
  assert.match(text, /de 60 a 90 dias após a 1ª vinda/);
  assert.match(text, /30 dias após pagar a 2ª parcela/);
});

test('orçamento com parcelas combinadas pelo vendedor continua com data fixa', () => {
  const { quotes } = setup();
  const q = quotes.create({ items: [{ pacote: 'Ouro', quantidade: 1 }], adults: 1, client: 'Ana', start: '2026-10-29', parcels: [{ pct: 50, date: '2026-12-10' }, { pct: 50, date: '2027-01-10' }] });
  const msg = quotes.message(q);
  assert.match(msg, /10\/12\/2026/);
  assert.doesNotMatch(msg, /1ª vinda ao Paraguai/);
});

test('orçamento vai em PDF: a frase que acompanha o arquivo é curta, sem valores escritos, e o Instagram recebe o link do PDF', () => {
  const { quotes } = setup();
  const q = quotes.create({ items: [{ pacote: 'Ouro', quantidade: 1 }], adults: 1, client: 'ana souza', start: '2026-10-29' });
  const c = quotes.caption(q, { name: 'ana souza' });
  assert.match(c, /^Olá, Ana! Segue o seu orçamento ORC-\d{4}-\d+ em PDF, preparado pela Migra Paraguai\. Ele vale até 05\/11\/2026\./);
  assert.doesNotMatch(c, /R\$|Entrada|parcela|Total/i, 'os valores ficam só no PDF');
  assert.ok(c.split('\n').length === 1 && c.length < 220);
  const ig = quotes.caption(q, { name: 'Ana', link: 'https://painel/orcamento/x?t=y' });
  assert.match(ig, /\nAbra o PDF aqui: https:\/\/painel\/orcamento\/x\?t=y$/);
  assert.match(quotes.caption({ ...q, client: 'Cliente' }, { name: '' }), /^Olá! Segue/, 'sem nome conhecido, sem inventar');
  assert.match(quotes.caption({ ...q, client: '@tati.costa' }, { name: '@tati.costa' }), /^Olá! Segue/);
  const memo = quotes.memo(q);
  assert.match(memo, /^\[PDF do orçamento ORC-.* enviado: PACOTE OURO|\[PDF do orçamento .* Pacote Ouro/i);
  assert.match(memo, /total R\$ 12\.997,00/);
  assert.match(memo, /entrada R\$ 1\.800,00/);
  assert.ok(fs.readFileSync(quotes.file(q)).subarray(0, 5).toString() === '%PDF-', 'o PDF existe');
});
