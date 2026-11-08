import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Sales } from '../src/sales.js';
import { Maria } from '../src/maria.js';
import { paymentPlan } from '../src/payplan.js';
import { hintsFrom, nameMatches, cpfMatches, findCandidates } from '../src/maria-baixa.js';
import { tempStore } from './helpers.js';

const LINE = 'l1';
const MARCOS = '5545999990001'; const ANA = '5545999990004'; const BIA = '5545999990005';

function setup({ receiverOk = true } = {}) {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const marcos = auth.create({ name: 'Marcos Miguel', login: 'marcos', password: 'segredo123', role: 'admin' });
  const ana = auth.create({ name: 'Ana Vendedora', login: 'ana', password: 'segredo123', role: 'seller' });
  const bia = auth.create({ name: 'Bia Vendedora', login: 'bia', password: 'segredo123', role: 'seller' });
  auth.update(marcos.id, { whatsapp: MARCOS }); auth.update(ana.id, { whatsapp: ANA }); auth.update(bia.id, { whatsapp: BIA });
  store.updateSettings({ sales: { commissionPct: 5 } });
  const sales = new Sales({ store, auth });
  const quote = (id, client, by, total) => ({ id, number: `ORC-2026-0${id}`, client, phone: `55459888877${id}${id}`, items: [{ name: 'Pacote Ouro', qty: 1, price: total, total }], plan: paymentPlan({ total, people: 1, adults: 1, start: '2026-11-01' }), createdBy: { id: by.id, name: by.name } });
  const vAna = sales.fromQuote(quote('1', 'Carlos Lima Souza', auth.get(ana.id), 12997), { by: auth.get(ana.id) });
  const vBia = sales.fromQuote(quote('2', 'Bruno Alves Prado', auth.get(bia.id), 9997), { by: auth.get(bia.id) });
  const state = { rec: null, n: 0 };
  const receiptReader = { maxAuto: 5000, read: async () => state.rec, receiverOk: () => receiverOk };
  const sent = [];
  const maria = new Maria({
    store, auth, sales, receiptReader, customers: {}, cash: {}, now: () => new Date('2026-11-09T12:00:00Z'),
    saleDoc: (s) => (s.id === vAna.id ? '529.982.247-25' : ''),
    downloadAudio: async () => Buffer.from(`arquivo-${++state.n}`),
    send: async (j, p) => { sent.push({ j, ...p }); }, lineName: () => 'Maria', marcosPhone: () => MARCOS, audit: () => {}, log: () => {},
  });
  maria.config.lineId = LINE;
  const say = async (phone, text, extra = {}) => { sent.length = 0; await maria.handle({ line: LINE, jid: `l:${LINE}:${phone}@s.whatsapp.net`, phone, text, ...extra }); return sent.filter((m) => m.text && m.j.includes(phone)); };
  const rec = (over = {}) => ({ comprovante: true, valor: vAna.parcels[0].value, moeda: 'BRL', data: '2026-11-09', situacao: 'concluido', pagador: 'Carlos Lima Souza', documento_pagador: '***.982.247-**', recebedor: 'Migra Asesoria', id_transacao: `E1234567820261109${String(state.n + 1).padStart(6, '0')}ABCD`, banco: 'Nubank', parece_adulterado: false, ...over });
  const toAdmin = () => sent.filter((m) => m.text && m.j.includes(MARCOS));
  return { store, sales, say, state, rec, toAdmin, ids: { vAna, vBia, ana, bia }, sent };
}
const img = { hasImage: true, imageMime: 'image/jpeg' };

test('o vendedor manda o comprovante: a Maria lê, mostra a parcela e só dá a baixa depois do "sim"; avisa a administração e guarda o rastro', async () => {
  const t = setup();
  t.state.rec = t.rec();
  const first = await t.say(ANA, '', img);
  assert.match(first[0].text, /Li o comprovante, Ana/);
  assert.match(first[0].text, /Carlos Lima Souza/);
  assert.match(first[0].text, /Vou dar baixa em/);
  assert.equal(t.sales.list.find((x) => x.id === t.ids.vAna.id).parcels[0].status, 'pendente', 'ainda nada lançado');
  const done = await t.say(ANA, 'Maria, sim');
  assert.match(done[0].text, /Baixa feita, Ana/);
  const sale = t.sales.list.find((x) => x.id === t.ids.vAna.id);
  assert.equal(sale.parcels[0].status, 'pago');
  assert.match(sale.parcels[0].confirmedBy, /Maria .*Ana Vendedora/);
  assert.equal(t.store.data.mariaReceipts.length, 1);
  assert.equal(t.store.data.mariaReceipts[0].status, 'baixa');
  assert.match(t.toAdmin()[0].text, /Baixa feita pela Maria[\s\S]*Carlos Lima Souza[\s\S]*Enviado por Ana Vendedora/, 'a administração foi avisada');
  // O mesmo comprovante (outro arquivo, mesmo número de transação) não conta duas vezes.
  const again = await t.say(ANA, '', img);
  assert.match(again[0].text, /já foi lançado/);
  assert.equal(t.store.data.mariaReceipts.length, 1);
});

test('quem pagou foi OUTRA pessoa: a Maria pede o WhatsApp ou o CPF do cliente e dá a baixa no cliente certo', async () => {
  const t = setup();
  t.state.rec = t.rec({ pagador: 'Maria das Dores Souza', documento_pagador: '***.111.222-**' });
  const ask = await t.say(ANA, '', img);
  assert.match(ask[0].text, /Maria das Dores Souza/);
  assert.match(ask[0].text, /Para qual cliente/);
  assert.match(ask[0].text, /WhatsApp.*CPF do cliente/);
  const conf = await t.say(ANA, 'Maria, é o cliente 45 98888-7711');
  assert.match(conf[0].text, /Vou dar baixa em/); assert.match(conf[0].text, /Carlos Lima Souza/);
  assert.match(conf[0].text, /outra pessoa/, 'avisa que o pagador não é o cliente');
  assert.equal((await t.say(ANA, 'Maria, sim'))[0].text.includes('Baixa feita'), true);
  assert.equal(t.sales.list.find((x) => x.id === t.ids.vAna.id).parcels[0].status, 'pago');
});

test('pelo CPF do cliente também funciona (a legenda do comprovante pode trazer o CPF)', async () => {
  const t = setup();
  t.state.rec = t.rec({ pagador: 'Empresa do Primo LTDA', documento_pagador: '' });
  const r = await t.say(ANA, 'Maria, é do CPF 529.982.247-25', img);
  assert.match(r[0].text, /Carlos Lima Souza/);
  assert.match(r[0].text, /Vou dar baixa/);
});

test('qualquer dúvida na conferência (recebedor, data, transação...) vira "aguardando conferência", nunca baixa direta', async () => {
  const t = setup({ receiverOk: false });
  t.state.rec = t.rec();
  const r = await t.say(ANA, '', img);
  assert.match(r[0].text, /aguardando conferência da administração/);
  assert.match(r[0].text, /recebedor/);
  const done = await t.say(ANA, 'Maria, sim');
  assert.match(done[0].text, /aguardando a conferência/);
  const sale = t.sales.list.find((x) => x.id === t.ids.vAna.id);
  assert.equal(sale.parcels[0].status, 'pendente', 'não foi baixada');
  assert.ok(sale.parcels[0].claim, 'ficou como aviso de pagamento para o administrador confirmar');
  assert.equal(t.store.data.mariaReceipts[0].status, 'conferir');
});

test('o vendedor só enxerga as próprias vendas: o cliente de outro vendedor não recebe baixa pela Maria e a administração é avisada', async () => {
  const t = setup();
  t.state.rec = t.rec({ valor: t.ids.vBia.parcels[0].value, pagador: 'Bruno Alves Prado' });
  const r = await t.say(ANA, 'Maria, é do cliente 45 98888-7722', img);
  assert.match(r[0].text, /Não achei parcela/);
  assert.equal(t.sales.list.find((x) => x.id === t.ids.vBia.id).parcels[0].status, 'pendente');
  assert.equal(t.store.data.mariaReceipts.at(-1).status, 'sem_parcela');
  assert.match(t.toAdmin()[0].text, /Comprovante sem parcela correspondente/);
});

test('foto que não é comprovante: sem o nome dela, silêncio; chamando pelo nome, ela explica', async () => {
  const t = setup();
  t.state.rec = { comprovante: false };
  assert.equal((await t.say(ANA, '', img)).length, 0);
  assert.match((await t.say(ANA, 'Maria, olha isso', img))[0].text, /não parece um comprovante/);
});

test('"não" cancela e nada é lançado; sem comprovante, "o cliente pagou" explica como mandar', async () => {
  const t = setup();
  t.state.rec = t.rec();
  await t.say(ANA, '', img);
  assert.match((await t.say(ANA, 'Maria, não'))[0].text, /não lancei nada/);
  assert.equal(t.store.data.mariaReceipts?.length || 0, 0);
  assert.match((await t.say(ANA, 'Maria, o cliente pagou a entrada'))[0].text, /me mandar o \*comprovante\*/);
});

test('ajudantes: nome, CPF mascarado, pistas e candidatos por valor', () => {
  assert.equal(nameMatches('Carlos Lima', 'Carlos Lima Souza'), true);
  assert.equal(nameMatches('Maria das Dores', 'Carlos Lima Souza'), false);
  assert.equal(cpfMatches('***.982.247-**', '529.982.247-25'), true);
  assert.equal(cpfMatches('***.111.222-**', '529.982.247-25'), false);
  assert.deepEqual(hintsFrom('é do cliente 45 98888-7711, CPF 529.982.247-25'), { cpf: '52998224725', phone: '45988887711' });
  const sales = [{ status: 'ativa', client: { nome: 'Carlos Lima', phone: '5545988887711' }, parcels: [{ status: 'pendente', value: 100, label: 'Entrada' }, { status: 'pago', value: 100, label: 'Outra' }] }];
  assert.equal(findCandidates({ sales, amount: 100, payer: 'Carlos Lima' })[0].pts, 2);
  assert.equal(findCandidates({ sales, amount: 100, payer: 'Outro Nome' })[0].pts, 0);
  assert.equal(findCandidates({ sales, amount: 100, hints: { phone: '45999990000' } }).length, 0, 'com telefone informado, só vale quem bate');
});

test('telefone e CPF digitados de qualquer jeito: com +55, só DDD, com 11 dígitos colados, com 9 separado; 11 dígitos de CPF válido valem como CPF', () => {
  for (const t of ['+55 44 99999-1111', '5544999991111', '44 99999-1111', '44999991111', '(44) 99999-1111', 'Maria, é +55 (44) 9 9999-1111', 'o telefone é 044 99999 1111', 'Maria, +55 44 99999-1111.']) {
    const h = hintsFrom(t);
    assert.ok(h.phone.endsWith('44999991111'), `telefone de: ${t} → ${JSON.stringify(h)}`);
    assert.equal(h.cpf, '', `não é CPF: ${t}`);
  }
  assert.deepEqual(hintsFrom('529.982.247-25'), { cpf: '52998224725', phone: '' });
  assert.deepEqual(hintsFrom('52998224725'), { cpf: '52998224725', phone: '' }, 'DDD 52 não existe: só CPF');
  assert.deepEqual(hintsFrom('+5544999991111 e cpf 529.982.247-25'), { cpf: '52998224725', phone: '5544999991111' });
  assert.deepEqual(hintsFrom('bom dia, tudo bem'), { cpf: '', phone: '' });
});

test('Pix em aberto de cliente sem prospecto com telefone (Instagram): é achado pelo telefone gravado no Pix, pelo telefone da conversa e pelo CPF', () => {
  const base = { status: 'pending', amount: 1800, description: 'Reserva · contrato CT-1' };
  const ig = { ...base, id: 'p1', convKey: 'ig:77', payerName: 'Tatiane Costa', payerDoc: '529.982.247-25', payerPhone: '5544999991111' };
  const wa = { ...base, id: 'p2', convKey: '5545988887777@s.whatsapp.net', payerName: 'Bruno' };
  const semLead = () => null;
  const q = (hints, payments) => findCandidates({ payments, leadOf: semLead, amount: 1800, hints, payer: 'Outra Pessoa' });
  assert.equal(q({ phone: '44999991111' }, [ig, wa])[0].payment.id, 'p1', 'pelo telefone gravado no Pix');
  assert.equal(q({ phone: '5544999991111' }, [ig, wa])[0].payment.id, 'p1', 'com +55 também');
  assert.equal(q({ cpf: '52998224725' }, [ig, wa])[0].payment.id, 'p1', 'pelo CPF do Pix');
  assert.equal(q({ phone: '45 98888-7777'.replace(/\D/g, '') }, [ig, wa])[0].payment.id, 'p2', 'pelo telefone da própria conversa do WhatsApp');
  assert.equal(q({ phone: '11900000000' }, [ig, wa]).length, 0, 'telefone de outro cliente não acha nada');
});

test('Maria: contrato recém-enviado com Pix em aberto (cliente do Instagram, sem venda): o vendedor passa o telefone com 11 dígitos colados e a baixa sai', async () => {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const marcos = auth.create({ name: 'Marcos Miguel', login: 'marcos', password: 'segredo123', role: 'admin' });
  auth.update(marcos.id, { whatsapp: MARCOS });
  const sales = new Sales({ store, auth });
  const confirmed = [];
  const payments = {
    list: [
      { id: 'px1', status: 'pending', amount: 1800, description: 'Reserva · contrato CT-2026-00001', convKey: 'ig:77', leadId: 'lead-que-sumiu', payerName: 'Tatiane Costa', payerDoc: '529.982.247-25', payerPhone: '5544999991111' },
      { id: 'px2', status: 'pending', amount: 1800, description: 'Reserva · contrato CT-2026-00002', convKey: '5545988887777@s.whatsapp.net', payerName: 'Bruno Alves' },
    ],
    confirm: async (id) => { confirmed.push(id); payments.list.find((p) => p.id === id).status = 'paid'; },
  };
  const state = { rec: null, n: 0 };
  const receiptReader = { maxAuto: 5000, read: async () => state.rec, receiverOk: () => true };
  const sent = [];
  const maria = new Maria({
    store, auth, sales, payments, receiptReader, customers: {}, cash: {}, now: () => new Date('2026-11-09T12:00:00Z'),
    crm: { byId: () => null, canSee: () => true }, // o prospecto do Pix sumiu do CRM: o administrador continua enxergando o Pix
    saleDoc: () => '', downloadAudio: async () => Buffer.from(`arquivo-${++state.n}`),
    send: async (j, p) => { sent.push({ j, ...p }); }, lineName: () => 'Maria', marcosPhone: () => MARCOS, audit: () => {}, log: () => {},
  });
  maria.config.lineId = LINE;
  const say = async (text, extra = {}) => { sent.length = 0; await maria.handle({ line: LINE, jid: `l:${LINE}:${MARCOS}@s.whatsapp.net`, phone: MARCOS, text, ...extra }); return sent.filter((m) => m.text).map((m) => m.text).join('\n'); };
  state.rec = { comprovante: true, valor: 1800, moeda: 'BRL', data: '2026-11-09', situacao: 'concluido', pagador: 'Outra Pessoa da Família', documento_pagador: '***.000.111-**', recebedor: 'Migra', id_transacao: 'E123456789012345678', banco: 'Banco X' };
  const ask = await say('', { hasImage: true, imageMime: 'image/jpeg' });
  assert.match(ask, /Para qual cliente/);
  const conf = await say('Maria, 44999991111'); // 11 dígitos colados: antes isso era lido como CPF e nada era achado
  assert.match(conf, /Vou dar baixa em/);
  assert.match(conf, /Reserva · contrato CT-2026-00001/);
  assert.match(conf, /Tatiane Costa/);
  assert.match(await say('Maria, sim'), /Baixa feita/);
  assert.deepEqual(confirmed, ['px1']);
});

test('Maria: telefone sem nada em aberto explica o que o cliente tem e que o valor é diferente; número ilegível pede de novo', async () => {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const marcos = auth.create({ name: 'Marcos Miguel', login: 'marcos', password: 'segredo123', role: 'admin' });
  auth.update(marcos.id, { whatsapp: MARCOS });
  const sales = new Sales({ store, auth });
  const payments = { list: [{ id: 'px1', status: 'pending', amount: 1800, description: 'Reserva · contrato CT-2026-00001', convKey: 'ig:77', payerName: 'Tatiane Costa', payerPhone: '5544999991111' }], confirm: async () => {} };
  const state = { rec: null, n: 0 };
  const sent = [];
  const maria = new Maria({
    store, auth, sales, payments, receiptReader: { maxAuto: 5000, read: async () => state.rec, receiverOk: () => true }, customers: {}, cash: {}, now: () => new Date('2026-11-09T12:00:00Z'),
    saleDoc: () => '', downloadAudio: async () => Buffer.from(`arquivo-${++state.n}`), send: async (j, p) => { sent.push({ j, ...p }); }, lineName: () => 'Maria', marcosPhone: () => MARCOS, audit: () => {}, log: () => {},
  });
  maria.config.lineId = LINE;
  const say = async (text, extra = {}) => { sent.length = 0; await maria.handle({ line: LINE, jid: `l:${LINE}:${MARCOS}@s.whatsapp.net`, phone: MARCOS, text, ...extra }); return sent.filter((m) => m.text).map((m) => m.text).join('\n'); };
  state.rec = { comprovante: true, valor: 1000, moeda: 'BRL', data: '2026-11-09', situacao: 'concluido', pagador: 'Alguém', documento_pagador: '', recebedor: 'Migra', id_transacao: 'E999999999999999999', banco: 'Banco X' };
  await say('', { hasImage: true, imageMime: 'image/jpeg' });
  const bad = await say('Maria, 4499 99');
  assert.ok(!/Vou dar baixa/.test(bad));
  const diff = await say('Maria, +55 44 99999-1111');
  assert.match(diff, /Pix: Reserva · contrato CT-2026-00001 de R\$ 1\.800,00/);
  assert.match(diff, /valor do comprovante é diferente/);
  assert.match(diff, /avisei a administração/);
});
