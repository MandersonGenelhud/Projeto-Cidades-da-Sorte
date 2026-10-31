import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ReceiptReader } from '../src/receipts.js';
import { Payments } from '../src/payments.js';
import { tempStore } from './helpers.js';

const NOW = new Date('2026-11-04T15:00:00Z');
const GOOD = { comprovante: true, valor: 125, moeda: 'BRL', data: '2026-11-04', situacao: 'concluido', pagador: 'Ana Souza', recebedor: 'MIGRA SOLUCOES LTDA', chave_ou_documento_recebedor: '***.123.456/****', id_transacao: 'E10573521202611041500ABCDEF12345', banco: 'Nubank', parece_adulterado: false };

async function setup(read = GOOD, { config = {} } = {}) {
  const store = tempStore();
  store.updateSettings({ payments: { enabled: true, provider: 'pix', pixKey: '12345678000199', receiverName: 'Migra Solucoes', receiverCity: 'Santa Rita', ...config } });
  const sent = [];
  const admins = [];
  const leads = [{ id: 'L1', name: 'Ana Souza', phone: '5511900000001' }];
  const crm = { leads, byId: (id) => leads.find((l) => l.id === id), addNote() {}, update() {}, ownerName: () => '' };
  const payments = new Payments({ store, crm, dataDir: store.dataDir, secret: 'x', sendTo: async (k, p) => sent.push({ key: k, ...p }), notifyAdmins: async (t) => admins.push(t), notify() {}, baseUrl: () => '', remember() {} });
  const p = await payments.create({ convKey: 'k1', leadId: 'L1', amount: 125, description: 'Taxa de assessoria', payerName: 'Ana Souza' });
  const llm = { configured: true, chat: async () => ({ content: JSON.stringify(typeof read === 'function' ? read() : read) }) };
  const reader = new ReceiptReader({ store, payments, llm, download: async () => Buffer.from('imagem'), send: async (jid, payload) => sent.push({ jid, ...payload }), notifyAdmins: async (t) => admins.push(t), now: () => NOW });
  return { reader, payments, p, sent, admins, store };
}
const msg = (extra = {}) => ({ jid: 'k1', phone: '5511900000001', hasImage: true, imageMime: 'image/jpeg', text: '[foto enviada]', ...extra });

test('comprovante confere em tudo: a IA lê o arquivo, dá baixa como pago, manda o recibo e avisa o dono', async () => {
  const { reader, payments, p, sent, admins } = await setup();
  assert.equal(reader.wants(msg()), true);
  assert.equal(await reader.handle(msg()), true);
  assert.equal(payments.get(p.id).status, 'paid');
  assert.equal(payments.get(p.id).confirmedBy, 'Leitura do comprovante (IA)');
  assert.ok(sent.some((m) => /Pagamento confirmado/.test(m.text || '')), 'o cliente recebe a confirmação e o recibo');
  assert.match(admins.at(-1), /LEITURA DO COMPROVANTE/, 'o dono é avisado e sabe que não foi pelo extrato');
  assert.ok(fs.existsSync(`${payments.dir}/comprovante-${p.id}.jpg`), 'o comprovante fica guardado para conferência');
});

test('qualquer dúvida vai para uma pessoa conferir: nada é confirmado sozinho', async () => {
  const cases = [
    ['valor diferente', { ...GOOD, valor: 100 }],
    ['recebedor de outra pessoa', { ...GOOD, recebedor: 'João da Silva' }],
    ['agendado e ainda não pago', { ...GOOD, situacao: 'agendado' }],
    ['data antiga', { ...GOOD, data: '2026-10-01' }],
    ['sem número de transação', { ...GOOD, id_transacao: null }],
    ['imagem com sinais de edição', { ...GOOD, parece_adulterado: true }],
  ];
  for (const [name, read] of cases) {
    const { reader, payments, p, sent, admins } = await setup(read);
    assert.equal(await reader.handle(msg()), true, name);
    assert.equal(payments.get(p.id).status, 'pending', `${name}: continua pendente`);
    assert.match(admins.at(-1), /precisa de conferência/, name);
    assert.match(sent.at(-1).text, /equipe conferir/, `${name}: o cliente é avisado sem ver o motivo`);
    assert.doesNotMatch(sent.at(-1).text, /valor|recebedor|editad|data/i);
  }
});

test('o mesmo comprovante não paga duas cobranças e valores acima do limite vão para conferência', async () => {
  const { reader, payments, p } = await setup();
  await reader.handle(msg());
  assert.equal(payments.get(p.id).status, 'paid');
  const p2 = await payments.create({ convKey: 'k1', leadId: 'L1', amount: 125, description: 'Outra taxa' });
  await reader.handle(msg());
  assert.equal(payments.get(p2.id).status, 'pending', 'mesma transação reaproveitada: não confirma');
  assert.match(payments.get(p2.id).receiptReview.problems.join(';'), /já foi usado/);
  const big = await setup({ ...GOOD, valor: 125 }, { config: {} });
  big.p.amount = 9000;
  const r = { ...GOOD, valor: 9000 };
  big.reader.llm.chat = async () => ({ content: JSON.stringify(r) });
  await big.reader.handle(msg());
  assert.equal(big.payments.get(big.p.id).status, 'pending');
  assert.match(big.payments.get(big.p.id).receiptReview.problems.join(';'), /acima do limite/);
});

test('foto que não é comprovante (ex.: RG) segue para a atendente; sem cobrança em aberto ou com Mercado Pago, nem entra', async () => {
  const { reader, payments, p } = await setup({ comprovante: false });
  assert.equal(await reader.handle(msg()), false);
  assert.equal(payments.get(p.id).status, 'pending');
  assert.equal(reader.wants(msg({ jid: 'outra-conversa' })), false, 'sem cobrança em aberto');
  assert.equal(reader.wants(msg({ isGroup: true })), false);
  p.provider = 'mercadopago';
  assert.equal(reader.wants(msg()), false, 'o Mercado Pago confirma sozinho');
  p.provider = 'pix';
  reader.store.updateSettings({ payments: { autoReceipt: false } });
  assert.equal(reader.wants(msg()), false, 'recurso desligado no painel');
});

test('PDF só é lido com o Gemini; sem ele pede foto ou print', async () => {
  const { reader, sent } = await setup();
  assert.equal(await reader.handle({ jid: 'k1', phone: '5511900000001', hasImage: false, documentMime: 'application/pdf' }), true);
  assert.match(sent.at(-1).text, /foto ou print/);
});

test('cobrança por Pix pede o comprovante na conversa', async () => {
  const { payments, p, sent } = await setup();
  await payments.sendCharge(p);
  assert.match(sent[0].text, /me envie o comprovante aqui na conversa/);
});
