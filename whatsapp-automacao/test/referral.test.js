import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Crm } from '../src/crm.js';
import { Sales } from '../src/sales.js';
import { Affiliates } from '../src/affiliates.js';
import { paymentPlan } from '../src/payplan.js';
import { tempStore } from './helpers.js';

function setup() {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  auth.create({ name: 'Marcos', login: 'marcos', password: 'segredo123', role: 'admin', whatsapp: '5545999990000' });
  const camila = auth.get(auth.create({ name: 'Camila Souza', login: 'camila', password: 'segredo123', role: 'seller', whatsapp: '5545999990001' }).id);
  const diego = auth.get(auth.create({ name: 'Diego Lima', login: 'diego', password: 'segredo123', role: 'seller', whatsapp: '5545999990002' }).id);
  const gabriel = auth.get(auth.create({ name: 'Gabriel', login: 'gabriel', password: 'segredo123', role: 'seller', whatsapp: '5545999990003' }).id);
  const crm = new Crm({ store, auth });
  const affiliates = new Affiliates({ store, crm, auth, secret: 's' });
  const sales = new Sales({
    store,
    auth,
    referral: (leadId) => {
      const l = crm.byId(leadId);
      const a = l?.affiliateId ? affiliates.get(l.affiliateId) : null;
      return a ? { id: a.id, name: a.name, ...affiliates.rate(l.commissionCategory || l.category) } : null;
    },
  });
  return { store, auth, crm, affiliates, sales, camila, diego, gabriel };
}

const ANA = { name: 'Ana Paula', whatsapp: '11 98765-4321', password: 'senha123', pixKey: 'ana@pix.com', acceptTerms: true };

test('cadastro do parceiro: Pix no Brasil ou conta bancária no Paraguai, e senha forte', () => {
  const { affiliates } = setup();
  assert.throws(() => affiliates.signup({ ...ANA, pixKey: '' }), /chave Pix/);
  assert.throws(() => affiliates.signup({ ...ANA, password: 'abcdefgh' }), /letras e números/);
  assert.throws(() => affiliates.signup({ ...ANA, password: 'abc12' }), /8 caracteres/);
  const ana = affiliates.signup(ANA);
  assert.equal(ana.country, 'BR');
  assert.match(affiliates.publicAffiliate(ana).payout, /Pix ana@pix\.com/);
  assert.equal(affiliates.publicAffiliate(ana).passwordHash, undefined);
  // Paraguaio: conta bancária completa, telefone com +595.
  const py = { name: 'Jorge Benítez', whatsapp: '+595 981 123456', password: 'clave1234', country: 'PY', acceptTerms: true };
  assert.throws(() => affiliates.signup({ ...py, bank: 'Ueno' }), /banco, o número da conta/);
  const jorge = affiliates.signup({ ...py, bank: 'Ueno', account: '123-456', holder: 'Jorge Benítez', doc: '4.567.890' });
  assert.equal(jorge.whatsapp, '595981123456');
  assert.match(affiliates.publicAffiliate(jorge).payout, /Ueno · conta 123-456 · titular Jorge Benítez · CI\/RUC 4\.567\.890/);
  // Trocar para Pix exige a chave.
  assert.throws(() => affiliates.update(jorge.id, { country: 'BR' }), /chave Pix/);
  affiliates.update(jorge.id, { country: 'BR', pixKey: '45999990000' });
  assert.equal(affiliates.get(jorge.id).country, 'BR');
});

test('pré-cadastro pelo link: vira prospecto do parceiro e vai só para quem aceita indicações, em rodízio', () => {
  const { affiliates, crm, camila, diego, gabriel } = setup();
  const ana = affiliates.signup(ANA);
  // Ninguém aceita indicações ainda: o prospecto fica sem vendedor (o servidor avisa o Marcos).
  const r0 = affiliates.preRegister({ name: 'Luiza', whatsapp: '45 98888-1111', interest: 'Residência e cédula paraguaia', consent: true }, { affiliate: ana });
  assert.equal(r0.owner, null);
  assert.equal(r0.lead.affiliateId, ana.id);
  assert.ok(r0.lead.precadastroAt);
  // Camila e Diego ligam a chave; Gabriel não quer dividir comissão.
  camila.receivesAffiliateLeads = true;
  diego.receivesAffiliateLeads = true;
  const owners = ['45 98888-2222', '45 98888-3333', '45 98888-4444'].map((w, i) =>
    affiliates.preRegister({ name: `Cliente ${i}`, whatsapp: w, interest: 'Terreno ou loteamento', consent: true }, { affiliate: ana }).owner.id);
  assert.ok(!owners.includes(gabriel.id), 'quem não ligou a chave não recebe');
  assert.deepEqual(new Set(owners), new Set([camila.id, diego.id]), 'rodízio entre quem aceita');
  const lot = crm.leads.find((l) => l.name === 'Cliente 0');
  assert.equal(lot.category, 'imoveis');
  assert.equal(lot.commissionCategory, 'imoveis');
  // Funil do parceiro.
  crm.setStage({ name: 'Camila', role: 'admin' }, lot, { stage: 'em_contato' });
  const st = affiliates.stats(ana);
  assert.equal(st.precadastros, 4);
  assert.equal(st.attending, 1);
  const mine = affiliates.myLeads(ana).find((l) => l.name === 'Cliente 0');
  assert.equal(mine.seller, owners[0] === camila.id ? 'Camila' : 'Diego');
  assert.equal(mine.precadastro, true);
  assert.equal(mine.phone, undefined, 'o parceiro não vê o telefone');
  // Validações do formulário.
  assert.throws(() => affiliates.preRegister({ name: 'X', whatsapp: '123', consent: true }, {}), /nome|WhatsApp/);
  assert.throws(() => affiliates.preRegister({ name: 'Maria', whatsapp: '45 98888-5555' }, {}), /autorização/);
});

test('pré-cadastro: indicar a si mesmo não gera comissão; primeiro indicador continua valendo', () => {
  const { affiliates } = setup();
  const ana = affiliates.signup(ANA);
  const beto = affiliates.signup({ ...ANA, name: 'Beto', whatsapp: '11 91234-5678' });
  const self = affiliates.preRegister({ name: 'Ana Paula', whatsapp: '11 98765-4321', consent: true }, { affiliate: ana });
  assert.equal(self.selfReferral, true);
  assert.equal(self.lead.affiliateId, undefined);
  const first = affiliates.preRegister({ name: 'Carla', whatsapp: '45 97777-1111', consent: true }, { affiliate: ana });
  const again = affiliates.preRegister({ name: 'Carla', whatsapp: '45 97777-1111', consent: true }, { affiliate: beto });
  assert.equal(again.lead.id, first.lead.id, 'mesmo prospecto, sem duplicar');
  assert.equal(again.lead.affiliateId, ana.id);
});

test('link do vendedor: código próprio, clique contado e pré-cadastro cai direto na carteira dele', () => {
  const { affiliates, gabriel, store } = setup();
  const code = affiliates.sellerCode(gabriel);
  assert.match(code, /^gabriel\d{3}$/);
  assert.equal(affiliates.sellerCode(gabriel), code, 'o código não muda');
  const r = affiliates.recordClick({ headers: {} }, code);
  assert.equal(r.seller.id, gabriel.id);
  assert.ok(r.cookies.some((c) => c.startsWith(`migra_ref=${code}`)));
  assert.equal(store.data.affiliates.clicks.filter((c) => c.sellerId === gabriel.id).length, 1);
  const ref = affiliates.referrer({ headers: { cookie: `migra_ref=${code}` } });
  assert.equal(ref.seller.id, gabriel.id);
  const pre = affiliates.preRegister({ name: 'Rafael', whatsapp: '45 96666-1111', interest: 'Veículos (Migra Motors)', consent: true }, ref);
  assert.equal(pre.owner.id, gabriel.id);
  assert.equal(pre.lead.affiliateId, undefined, 'link do vendedor não gera comissão de parceiro');
  assert.equal(pre.lead.commissionCategory, 'veiculos');
  // Código do endereço vale quando o navegador não guarda o cookie; cookie (primeiro indicador) vale antes.
  const ana = affiliates.signup(ANA);
  assert.equal(affiliates.referrer({ headers: {} }, ana.code).affiliate.id, ana.id);
  assert.equal(affiliates.referrer({ headers: { cookie: `migra_ref=${code}` } }, ana.code).seller.id, gabriel.id);
});

test('venda indicada: vendedor recebe o percentual "com indicação" e a venda mostra o parceiro', () => {
  const { store, affiliates, sales, camila, crm, auth } = setup();
  store.updateSettings({ sales: { commissionPct: 5, affiliateSellerPct: 3 }, affiliates: { rates: { migracao: { percent: 2, fixed: 0 } } } });
  const ana = affiliates.signup(ANA);
  camila.receivesAffiliateLeads = true;
  const { lead } = affiliates.preRegister({ name: 'Luiza', whatsapp: '45 98888-1111', consent: true }, { affiliate: ana });
  const plan = paymentPlan({ total: 20000, people: 1, adults: 1, start: '2026-10-30' });
  const q = (id, leadId) => ({ id, number: `ORC-${id}`, client: 'Luiza', phone: '', leadId, items: [{ name: 'Pacote', qty: 1, price: 20000, total: 20000 }], plan, createdBy: { id: camila.id, name: camila.name } });
  const s = sales.fromQuote(q('1', lead.id), { by: camila });
  assert.equal(s.commission.pct, 3);
  assert.equal(s.commission.value, 600);
  assert.equal(s.affiliate.name, 'Ana Paula');
  assert.equal(s.affiliate.value, 400);
  // Venda tradicional continua no percentual normal; percentual próprio "com indicação" do vendedor tem prioridade.
  const other = crm.byId(crm.create({ name: 'X', role: 'admin' }, { name: 'Pedro', phone: '45 95555-1111' }).id);
  assert.equal(sales.fromQuote(q('2', other.id), { by: camila }).commission.pct, 5);
  auth.get(camila.id).affiliateCommissionPct = 4;
  assert.equal(sales.pctFor(camila.id, true), 4);
});

test('serviços indicáveis e categorias de comissão vêm das regras do painel', () => {
  const { store, affiliates } = setup();
  assert.ok(affiliates.services.some((s) => s.category === 'veiculos'));
  store.updateSettings({ affiliates: { services: [{ label: 'Migra School', category: 'escola' }], rates: { escola: { percent: 10, fixed: 0 } } } });
  assert.deepEqual(affiliates.services, [{ label: 'Migra School', category: 'escola' }]);
  const cat = affiliates.categories().find((c) => c.key === 'escola');
  assert.equal(cat.percent, 10);
  assert.equal(cat.label, 'Escola');
});
