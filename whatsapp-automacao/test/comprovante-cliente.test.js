import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Crm } from '../src/crm.js';
import { Sales } from '../src/sales.js';
import { paymentPlan } from '../src/payplan.js';
import { ClientProofs } from '../src/client-proof.js';
import { FunnelSync } from '../src/funnel-sync.js';
import { tempStore } from './helpers.js';

const KEY = 'l:central1:5545988887711@s.whatsapp.net';
function setup({ reading, humanSpoke = false, contractStatus = 'enviado' } = {}) {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const marcos = auth.get(auth.create({ name: 'Marcos Miguel', login: 'marcos', password: 'segredo123', role: 'admin', whatsapp: '595982222222' }).id);
  const geo = auth.get(auth.create({ name: 'Geovana', login: 'geo', password: 'segredo123', role: 'seller', whatsapp: '595981000001' }).id);
  const crm = new Crm({ store, auth });
  const sales = new Sales({ store, auth });
  const lead = crm.ensureFromConversation({ key: KEY, phone: '5545988887711', name: 'Jackson Luiz Fabres', channel: 'whatsapp' });
  lead.ownerId = geo.id;
  const plan = paymentPlan({ total: 6000, people: 1, adults: 1, start: '2026-11-01' });
  const quote = { id: 'q1', number: 'ORC-2026-01', client: 'Jackson Luiz Fabres', phone: '5545988887711', convKey: KEY, leadId: lead.id, items: [{ name: 'Pacote Ouro', qty: 1, price: 6000, total: 6000 }], plan, createdAt: '2026-11-05T10:00:00Z', contract: { status: contractStatus, client: { nome: 'Jackson Luiz Fabres' } }, createdBy: { id: marcos.id, name: marcos.name } };
  const quotes = { list: [quote] };
  const out = { closing: [], admins: [], team: [], said: [], hooks: [], audit: [] };
  sales.onParcelPaid = (sale, i) => out.hooks.push(i);
  const base = { comprovante: true, valor: plan.entry, moeda: 'BRL', situacao: 'concluido', data: '2026-11-10', id_transacao: 'E12345678920261110ABCDEF', recebedor: 'Migra Paraguai', pagador: 'Jackson', banco: 'Nubank', parece_adulterado: false };
  const proofs = new ClientProofs({
    store, sales, crm, quotes, auth, dataDir: store.dataDir,
    reader: { read: async () => ({ ...base, ...(reading || {}) }), receiverOk: (r) => /migra/i.test(r.recebedor || ''), maxAuto: 5000 },
    download: async () => Buffer.from('imagem'),
    notifyClosing: async (t) => out.closing.push(t), notifyAdmins: async (t) => out.admins.push(t), notifyTeam: async (p, t) => out.team.push({ p, t }),
    say: async (m, t) => out.said.push(t), humanSpoke: () => humanSpoke, audit: (t) => out.audit.push(t),
    now: () => new Date('2026-11-10T15:00:00Z'),
  });
  const msg = { jid: KEY, phone: '5545988887711', hasImage: true, imageMime: 'image/jpeg' };
  return { store, crm, sales, lead, quote, quotes, proofs, msg, out, plan, auth, geo };
}

test('comprovante da entrada enviado ao vendedor: baixa, recibo, prospecto Fechado e aviso "fechado e pago"', async () => {
  const { proofs, msg, sales, lead, out, crm } = setup();
  assert.equal(proofs.wants(msg), true);
  assert.equal(await proofs.handle(msg), true);
  const sale = sales.list[0];
  assert.equal(sale.parcels[0].status, 'pago');
  assert.equal(sale.parcels[0].proof.ref, 'E12345678920261110ABCDEF');
  assert.deepEqual(out.hooks, [0], 'o recibo da parcela é emitido (gancho do recibo)');
  assert.equal(crm.byId(lead.id).stage, 'ganho');
  assert.match(out.closing[0], /FECHADO E PAGO/);
  assert.match(out.closing[0], /Jackson Luiz Fabres/);
  assert.equal(out.admins.length, 0);
});

test('valor que não bate com nenhuma parcela: NADA é baixado; administradores e vendedor são avisados', async () => {
  const { proofs, msg, sales, lead, out, crm } = setup({ reading: { valor: 123.45 } });
  assert.equal(await proofs.handle(msg), true);
  assert.equal(sales.list.length, 0, 'não lançou venda');
  assert.notEqual(crm.byId(lead.id).stage, 'ganho');
  assert.match(out.admins[0], /precisa de conferência/);
  assert.match(out.admins[0], /não bate com nenhuma parcela/);
  assert.equal(out.team.length, 1, 'o vendedor também recebe');
  assert.equal(out.closing.length, 0);
  assert.equal(out.said.length, 1);
});

test('recebedor diferente da Migra, comprovante não concluído, imagem editada ou valor alto: sem baixa', async () => {
  for (const reading of [{ recebedor: 'Fulano de Tal' }, { situacao: 'agendado' }, { parece_adulterado: true }, { id_transacao: '' }, { moeda: 'USD' }]) {
    const { proofs, msg, sales, out } = setup({ reading });
    await proofs.handle(msg);
    assert.equal(sales.list.length, 0, JSON.stringify(reading));
    assert.equal(out.closing.length, 0);
    assert.equal(out.admins.length, 1);
  }
});

test('reenviar o mesmo comprovante não repete baixa, recibo nem aviso', async () => {
  const { proofs, msg, sales, out } = setup();
  await proofs.handle(msg);
  const hooks = out.hooks.length; const closing = out.closing.length;
  assert.equal(await proofs.handle(msg), true);
  assert.equal(out.hooks.length, hooks); assert.equal(out.closing.length, closing);
  assert.equal(sales.list.length, 1);
});

test('mesma transação usada em outra venda é recusada (golpe do comprovante repetido)', async () => {
  const a = setup();
  await a.proofs.handle(a.msg);
  // outro cliente, outra venda, o MESMO número de transação
  const b = setup();
  b.quote.id = 'qb'; b.quote.number = 'ORC-2026-02';
  b.store.data.sales = [...a.store.data.sales]; // a base já tem a venda do primeiro cliente
  await b.proofs.handle(b.msg);
  assert.match(b.out.admins.join(' '), /já foi usado em outro pagamento/);
});

test('conversa sem contrato nem venda, ou foto que não é comprovante: segue o atendimento normal', async () => {
  const x = setup();
  x.quotes.list.length = 0;
  assert.equal(x.proofs.wants(x.msg), false);
  const y = setup({ reading: { comprovante: false } });
  assert.equal(await y.proofs.handle(y.msg), false);
  assert.equal(y.sales.list.length, 0);
});

test('se uma pessoa já falou com o cliente, a IA não puxa conversa ao pedir conferência', async () => {
  const { proofs, msg, out } = setup({ reading: { valor: 1.23 }, humanSpoke: true });
  await proofs.handle(msg);
  assert.equal(out.said.length, 0);
  assert.equal(out.admins.length, 1);
});

// ---------- funil automático ----------
test('funil: contrato enviado ou assinado leva de "Em contato" a "Proposta enviada"; assinado sem pagamento NÃO fecha', () => {
  const { store, crm, sales, quotes, lead, auth } = setup({ contractStatus: 'assinado' });
  crm.update({ role: 'admin', name: 'x' }, lead.id, { stage: 'em_contato' });
  const f = new FunnelSync({ store, crm, sales, quotes, payments: { list: [] }, auth });
  const r = f.reconcile();
  assert.equal(r.changed, 1);
  assert.equal(crm.byId(lead.id).stage, 'proposta');
  assert.equal(f.reconcile().changed, 0, 'segunda conferência não muda nada');
});

test('funil: parcela recebida fecha o prospecto (o caso do cliente fechado pela Central que ficou "Em contato")', () => {
  const { store, crm, sales, quotes, lead, quote, auth } = setup();
  crm.update({ role: 'admin', name: 'x' }, lead.id, { stage: 'em_contato' });
  const sale = sales.fromQuote(quote, { by: 'Sistema' });
  sales.setParcel({ role: 'admin', name: 'Marcos' }, sale.id, 0, { paid: true, receipt: false });
  const f = new FunnelSync({ store, crm, sales, quotes, payments: { list: [] }, auth });
  assert.deepEqual(f.reconcile({ dryRun: true }).changes.map((c) => c.to), ['ganho']);
  assert.equal(crm.byId(lead.id).stage, 'em_contato', 'dryRun não altera');
  f.reconcile();
  assert.equal(crm.byId(lead.id).stage, 'ganho');
});

test('funil: perdido não é mexido e venda copiada do sistema antigo não fecha prospecto', () => {
  const { store, crm, sales, quotes, lead, auth } = setup();
  crm.update({ role: 'admin', name: 'x' }, lead.id, { stage: 'perdido', lostReason: 'sem condições' });
  const f = new FunnelSync({ store, crm, sales, quotes, payments: { list: [] }, auth });
  assert.equal(f.reconcile().changed, 0);
  const g = setup();
  g.store.data.sales = [{ id: 's', legacy: true, leadId: g.lead.id, status: 'ativa', parcels: [{ status: 'pago', value: 1 }], number: 'ANT-1' }];
  const f2 = new FunnelSync({ store: g.store, crm: g.crm, sales: g.sales, quotes: { list: [] }, payments: { list: [] }, auth: g.auth });
  assert.equal(f2.reconcile().changed, 0);
});

test('funil: aviso de atendimentos parados vai ao vendedor uma vez por dia', async () => {
  const { store, crm, sales, quotes, lead, auth, geo } = setup();
  crm.update({ role: 'admin', name: 'x' }, lead.id, { stage: 'em_contato' });
  crm.byId(lead.id).updatedAt = '2026-11-01T10:00:00Z';
  const sent = []; const admins = [];
  const f = new FunnelSync({ store, crm, sales, quotes, payments: { list: [] }, auth, notifyTeam: async (p, t) => sent.push({ p, t }), notifyAdmins: async (t) => admins.push(t), now: () => new Date('2026-11-10T12:00:00Z') });
  const r = await f.digest({ days: 3 });
  assert.equal(r.sent, 1);
  assert.equal(sent[0].p, geo.whatsapp);
  assert.match(sent[0].t, /Jackson Luiz Fabres/);
  assert.equal(admins.length, 1);
  assert.equal((await f.digest({ days: 3 })).sent, 0, 'só uma vez por dia');
});

test('fluxo das indicações: etapas, paradas e quadro por indicador (sem telefone de cliente)', async () => {
  const { Affiliates } = await import('../src/affiliates.js');
  const { store, crm, auth } = setup();
  const aff = new Affiliates({ store, crm, auth, secret: 's', notifyAffiliate: async () => {} });
  const a = aff.data.list[0] || (aff.data.list.push({ id: 'a1', name: 'Parceira Ana', code: 'ANA1', status: 'ativo' }), aff.data.list[0]);
  const mk = (n, stage, upd) => { const l = crm.ensureFromConversation({ key: `55459${n}`, phone: `55459888${n}`, name: `Cliente ${n}`, channel: 'whatsapp' }); Object.assign(l, { affiliateId: a.id, affiliateAt: '2026-11-01T10:00:00Z', stage, updatedAt: upd }); return l; };
  mk('1001', 'em_contato', '2026-10-01T10:00:00Z'); mk('1002', 'ganho', '2026-11-05T10:00:00Z'); mk('1003', 'novo', '2026-11-09T10:00:00Z');
  const f = aff.flow({ now: new Date('2026-11-10T12:00:00Z') });
  assert.equal(f.totais.indicacoes, 3); assert.equal(f.totais.fechadas, 1); assert.equal(f.totais.paradas, 1);
  assert.equal(f.porIndicador[0].conversao, 33);
  assert.ok(!JSON.stringify(f).includes('55459888'), 'nenhum telefone de cliente no painel');
});
