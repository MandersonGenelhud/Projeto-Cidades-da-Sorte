import test from 'node:test';
import assert from 'node:assert/strict';
import { QuoteRequests } from '../src/quote-request.js';
import { LineManager } from '../src/lines.js';
import { tempStore } from './helpers.js';

function setup() {
  const store = tempStore();
  const filled = [];
  const qr = new QuoteRequests({ store, secret: 'segredo', baseUrl: () => 'https://app.migra.com', onFilled: async (r) => { filled.push(r); } });
  return { store, qr, filled };
}
const dados = { nome: 'Ana Souza', whatsapp: '45 99999-0000', adultos: 2, email: '' };

test('dados do orçamento: o link tem token, pré-preenche o que já sabemos e não deixa abrir com token errado', () => {
  const { qr } = setup();
  const rec = qr.create({ convKey: 'c1', items: [{ pacote: 'Ouro', quantidade: 2 }], adults: 2, name: 'Ana Souza', phone: '5545999990000' });
  assert.match(qr.url(rec), /^https:\/\/app\.migra\.com\/orcamento-dados\/[0-9a-f]+\?t=/);
  const t = qr.token(rec.id);
  const v = qr.view(rec.id, t);
  assert.equal(v.data.nome, 'Ana Souza');
  assert.equal(v.data.whatsapp, '+5545999990000');
  assert.throws(() => qr.view(rec.id, 'errado'), (e) => e.status === 404);
  assert.throws(() => qr.view('naoexiste', t), (e) => e.status === 404);
  // reenviar não cria outro pedido
  assert.equal(qr.create({ convKey: 'c1', items: [{ pacote: 'Prata', quantidade: 1 }] }).id, rec.id);
  assert.equal(qr.list.length, 1);
});

test('dados do orçamento: valida nome, WhatsApp, adultos e e-mail; o envio vale uma vez só e elabora um único orçamento', async () => {
  const { qr, filled } = setup();
  const rec = qr.create({ convKey: 'c1', items: [{ pacote: 'Ouro', quantidade: 1 }] });
  const t = qr.token(rec.id);
  for (const ruim of [{ ...dados, nome: 'Ana' }, { ...dados, whatsapp: '123' }, { ...dados, adultos: 0 }, { ...dados, adultos: 99 }, { ...dados, email: 'x@' }]) {
    await assert.rejects(() => qr.submit(rec.id, t, ruim), (e) => e.status === 400);
  }
  assert.equal(filled.length, 0);
  const ok = await qr.submit(rec.id, t, dados);
  assert.equal(ok.nome, 'Ana');
  const de_novo = await qr.submit(rec.id, t, dados);
  assert.equal(de_novo.already, true);
  await new Promise((r) => setImmediate(r));
  assert.equal(filled.length, 1, 'só um orçamento por pedido (clique duplo não duplica)');
  assert.equal(filled[0].data.whatsapp, '+5545999990000');
  assert.equal(qr.openFor('c1'), null, 'depois de preenchido não está mais em aberto');
});

test('dados do orçamento: erro ao elaborar não vira erro para o cliente e fica no registro', async () => {
  const store = tempStore();
  const qr = new QuoteRequests({ store, secret: 's', baseUrl: () => 'https://x', onFilled: async () => { throw new Error('falhou'); } });
  const rec = qr.create({ convKey: 'c1', items: [] });
  const r = await qr.submit(rec.id, qr.token(rec.id), dados);
  assert.equal(r.ok, true);
  await new Promise((res) => setImmediate(res));
  assert.equal(qr.list[0].status, 'preenchido', 'o pedido continua guardado para a equipe');
});

test('voz por perfil: padrão em espera; só aceita voz da lista; ligar e trocar a voz de cada WhatsApp', () => {
  const store = tempStore();
  store.updateSettings({ lines: [{ id: 'a1', label: 'Camila' }] });
  const lm = new LineManager({ store, dataDir: store.dataDir, createClient: () => ({}) });
  assert.equal(lm.get('a1').voiceOn, undefined, 'em espera por padrão');
  lm.update('a1', { voiceOn: true, voice: 'Leda' });
  assert.equal(lm.get('a1').voiceOn, true);
  assert.equal(lm.get('a1').voice, 'Leda');
  lm.update('a1', { voice: 'VozInventada' });
  assert.equal(lm.get('a1').voice, '', 'voz fora da lista é descartada');
  lm.update('a1', { voiceOn: false });
  assert.equal(lm.get('a1').voiceOn, false);
});
