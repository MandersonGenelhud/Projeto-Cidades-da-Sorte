import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Crm } from '../src/crm.js';
import { Realty } from '../src/realty.js';
import { Affiliates } from '../src/affiliates.js';
import { tempStore } from './helpers.js';

function setup() {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const admin = auth.get(auth.create({ name: 'Marcos', login: 'marcos', password: 'segredo123', role: 'admin' }).id);
  const crm = new Crm({ store, auth });
  const realty = new Realty({ store, dataDir: store.dataDir });
  const sent = [];
  const affiliates = new Affiliates({ store, crm, secret: 's', notifyAffiliate: async (phone, text) => sent.push({ phone, text }) });
  crm.onWon = (lead) => affiliates.onLeadWon(lead);
  return { store, crm, realty, affiliates, admin, sent };
}

test('importa os anúncios do site antigo e cadastra imóveis', () => {
  const { realty } = setup();
  const list = realty.listProperties();
  assert.equal(list.length, 14);
  assert.ok(list.every((p) => p.slug && p.images.length && p.price > 0));
  const p = realty.saveProperty(null, { title: 'Casa em Santa Rita', type: 'casa', price: '120.000', images: 'a.jpg\nb.jpg' });
  assert.equal(p.price, 120000);
  assert.deepEqual(p.images, ['a.jpg', 'b.jpg']);
  assert.equal(realty.property('casa-em-santa-rita').id, p.id);
});

test('loteamento: gera quadra em grade, muda situação e esconde preço do vendido', () => {
  const { realty } = setup();
  const d = realty.saveDevelopment(null, { name: 'Residencial Lago Azul', city: 'Santa Rita' });
  const lots = realty.generateBlock(d.id, { block: 'A', rows: 2, cols: 5, x: 10, y: 10, w: 50, h: 20, area: 360, price: '15.000' });
  assert.equal(lots.length, 10);
  assert.equal(lots[0].code, 'QA-L1');
  assert.equal(lots[9].code, 'QA-L10');
  assert.equal(lots[0].shape.length, 4);
  assert.ok(lots[0].shape.every(([x, y]) => x >= 0 && x <= 100 && y >= 0 && y <= 100));
  realty.updateLot(d.id, lots[0].id, { status: 'reservado' });
  realty.updateLot(d.id, lots[1].id, { status: 'vendido' });
  assert.throws(() => realty.updateLot(d.id, lots[2].id, { status: 'qualquer' }), /inválida/);
  const pub = realty.publicDevelopment(realty.development('residencial-lago-azul'));
  assert.deepEqual([pub.summary.disponivel, pub.summary.reservado, pub.summary.vendido], [8, 1, 1]);
  assert.equal(pub.lots.find((l) => l.status === 'vendido').price, null);
  assert.equal(pub.summary.minPrice, 15000);
});

test('indicação: primeiro indicador vale, comissão só na venda confirmada e aviso ao indicador', async () => {
  const { store, crm, affiliates, admin, sent } = setup();
  store.updateSettings({ affiliates: { rates: { imoveis: { percent: 2, fixed: 0 }, migracao: { percent: 5, fixed: 100 } } } });
  const ana = affiliates.signup({ name: 'Ana Paula', whatsapp: '11 98765-4321', password: 'senha123', acceptTerms: true });
  const beto = affiliates.signup({ name: 'Beto', whatsapp: '11 91234-5678', password: 'senha123', acceptTerms: true });
  assert.match(ana.code, /^anapaula\d{3}$/);
  assert.throws(() => affiliates.signup({ name: 'Ana Paula', whatsapp: '11 98765-4321', password: 'senha123', acceptTerms: true }), /já está cadastrado/);
  assert.throws(() => affiliates.login('11 98765-4321', 'errada'), /incorretos/);

  // Link: cookie de indicação só é gravado na primeira vez.
  const r1 = affiliates.recordClick({ headers: {} }, ana.code);
  assert.ok(r1.cookies.some((c) => c.startsWith(`migra_ref=${ana.code}`)));
  const r2 = affiliates.recordClick({ headers: { cookie: `migra_ref=${ana.code}; migra_v=x` } }, beto.code);
  assert.ok(!r2.cookies.some((c) => c.startsWith('migra_ref')));

  const lead = crm.create(admin, { name: 'Cliente Terreno', phone: '5511977776666', category: 'imoveis', value: 50000 });
  const l = crm.leads.find((x) => x.id === lead.id);
  assert.ok(affiliates.attach(l, ana, 'link'));
  assert.equal(affiliates.attach(l, beto, 'WhatsApp'), false); // primeiro indicador vale
  assert.equal(l.affiliateId, ana.id);
  assert.equal(affiliates.codeInText(`Olá! Vim pela indicação de Ana (código de indicação: ${ana.code}).`)?.id, ana.id);

  // Vendedor marca "fechado" → ainda não gera comissão (espera confirmação).
  crm.update({ name: 'Vend', role: 'seller', id: 'x' }, l.id, { stage: 'ganho', closedValue: 50000 });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(affiliates.data.commissions.length, 0);
  crm.confirmSale(admin, l.id);
  await new Promise((r) => setTimeout(r, 5));
  const [c] = affiliates.data.commissions;
  assert.equal(c.amount, 1000); // 2% de 50 mil
  assert.equal(c.status, 'a_pagar');
  assert.match(sent[0].text, /Parabéns, Ana/);
  // Confirmar de novo não duplica a comissão.
  crm.confirmSale(admin, l.id);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(affiliates.data.commissions.length, 1);

  const st = affiliates.stats(ana);
  assert.deepEqual([st.clicks, st.leads, st.won, st.toReceive], [1, 1, 1, 'R$ 1.000,00']);
  assert.equal(affiliates.myLeads(ana)[0].status, 'Fechou negócio 🎉');
  affiliates.markPaid(c.id, { by: 'Marcos' });
  assert.equal(affiliates.stats(ana).paid, 'R$ 1.000,00');
  assert.match(sent.at(-1).text, /Comissão paga/);
});

test('cliente do site vira um único prospecto de imóveis, com o indicador do link', async () => {
  const { store, crm, admin } = setup();
  // Já existe outro prospecto: garante que nada é criado em dobro.
  crm.create(admin, { name: 'Outro', phone: '5511900000001' });
  const before = crm.leads.length;
  const created = crm.byId(crm.create({ name: 'Site', role: 'admin' }, { name: 'Carlos', phone: '11 97777-6666', source: 'site', category: 'imoveis' }).id);
  assert.equal(crm.leads.length, before + 1);
  assert.equal(created.category, 'imoveis');
  assert.equal(created.source, 'site');
  assert.ok(store.data.leads.includes(created));
});

test('comissão de imóvel em dólar sai em dólar', async () => {
  const { store, crm, affiliates, admin } = setup();
  store.updateSettings({ affiliates: { rates: { imoveis: { percent: 3, fixed: 0 } } } });
  const ana = affiliates.signup({ name: 'Ana', whatsapp: '11 98765-4321', password: 'senha123', acceptTerms: true });
  const lead = crm.byId(crm.create(admin, { name: 'Carlos', phone: '5511977776666', category: 'imoveis', value: 18000 }).id);
  lead.currency = 'USD';
  affiliates.attach(lead, ana);
  crm.update(admin, lead.id, { stage: 'ganho', closedValue: 18000 });
  await new Promise((r) => setTimeout(r, 5));
  const [c] = affiliates.data.commissions;
  assert.equal(c.currency, 'USD');
  assert.equal(c.amount, 540);
  assert.equal(affiliates.stats(ana).toReceive, 'US$ 540,00');
});

test('mapa: quadra em curva acompanha os lados e numera em U', async () => {
  await import('../public/site/lotgeo.js');
  const { stripLots, polyInfo, roundedPath } = globalThis.LotGeo;
  // Lado A em arco (3 pontos) e lado B paralelo, mais abaixo.
  const lots = stripLots({ sideA: [[10, 20], [50, 10], [90, 20]], sideB: [[10, 40], [50, 30], [90, 40]], perRow: 4, rows: 2, start: 1, numbering: 'u' });
  assert.equal(lots.length, 8);
  assert.deepEqual(lots.map((l) => l.number), ['1', '2', '3', '4', '5', '6', '7', '8']);
  // 1ª fileira encosta no lado A; a 2ª volta (o lote 5 fica atrás do lote 4).
  assert.deepEqual(lots[0].shape[0], [10, 20]);
  assert.deepEqual(lots[3].shape[1], [90, 20]);
  assert.deepEqual(lots[4].shape[2], [90, 40]);
  // Lotes vizinhos dividem o mesmo canto (sem buracos entre eles).
  assert.deepEqual(lots[0].shape[1], lots[1].shape[0]);
  assert.ok(lots.every((l) => polyInfo(l.shape).area > 0));
  assert.match(roundedPath(lots[0].shape), /^M[\d. ]+ Q/);
});

test('loteadora: lotes cinza fora da venda e criação de vários lotes de uma vez', () => {
  const { realty } = setup();
  const d = realty.saveDevelopment(null, { name: 'Jardim Oval' });
  const lots = realty.addLots(d.id, [
    { block: 'B', number: '1', price: '9.000', status: 'loteadora', shape: [[0, 0], [5, 0], [5, 5], [0, 5]] },
    { block: 'B', number: '2', price: '9.000', shape: [[5, 0], [10, 0], [10, 5], [5, 5]] },
  ]);
  assert.equal(lots.length, 2);
  assert.equal(lots[0].code, 'QB-L1');
  const pub = realty.publicDevelopment(realty.development(d.id));
  assert.equal(pub.summary.loteadora, 1);
  assert.equal(pub.summary.disponivel, 1);
  assert.equal(pub.lots[0].price, null, 'preço da reserva da loteadora não aparece no site');
  assert.equal(pub.lots[1].price, 9000);
  assert.throws(() => realty.addLots(d.id, [{ number: '3' }]), /desenho/);
});
