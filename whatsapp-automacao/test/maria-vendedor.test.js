import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Crm } from '../src/crm.js';
import { Payments } from '../src/payments.js';
import { Closing } from '../src/closing.js';
import { lineKey } from '../src/lines.js';
import { Maria, quickIntent } from '../src/maria.js';
import { makeOutbound, findRecentQuote, filledNotice } from '../src/maria-outbound.js';
import { samePhone, normalizePhone } from '../src/utils.js';
import { tempStore } from './helpers.js';

const LINE = 'linha-maria';
const DATA = { nome: 'Ana Souza', cpf: '52998224725', rg: '1234567', nascimento: '1990-01-01', nacionalidade: 'Brasileira', estadoCivil: 'Casada', rua: 'Rua A', numero: '1', bairro: 'Centro', cidade: 'Foz', uf: 'PR', cep: '85850-000', whatsapp: '+5545988887777', adultos: '2' };

function mariaSetup({ lineUp = true } = {}) {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const marcos = auth.create({ name: 'Marcos Miguel', login: 'marcos', password: 'segredo123', role: 'admin' });
  const ana = auth.create({ name: 'Ana Vendedora', login: 'ana', password: 'segredo123', role: 'seller' });
  const sil = auth.create({ name: 'Silvane Nunes', login: 'silvane', password: 'segredo123', role: 'seller' });
  auth.update(marcos.id, { whatsapp: '5545999990001' });
  auth.update(ana.id, { whatsapp: '5545999990004' });
  auth.update(sil.id, { whatsapp: '5545999990003' });
  const sent = []; const leads = []; const quotes = []; const forms = []; const audits = [];
  const contracts = {
    packages: () => ['Pacote Ouro', 'Pacote Prata'], fields: [], required: [],
    registerLead: (a) => { if (a.nome === 'Cliente do Outro') throw new Error('esse cliente já é de outro vendedor. Fale com o administrador.'); const lead = { id: `L${leads.length + 1}`, name: a.nome, phone: a.telefone }; leads.push({ ...a, lead }); return { lead, created: true }; },
    createQuote: (a) => { if (!/Ouro|Prata/.test(a.pacote)) throw new Error('Pacote não encontrado'); const q = { id: `q${quotes.length + 1}`, number: `ORC-2026-000${quotes.length + 1}`, items: [{ name: a.pacote, qty: a.pessoas }], plan: { total: 12997 * a.pessoas, entry: 2600, parcels: [1, 2, 3] }, leadId: a.leadId, by: a.user.name }; quotes.push(q); return q; },
    findQuote: () => null,
    formLink: (q, a) => { forms.push({ q, lead: a.lead, by: a.user.name }); return { url: 'https://painel.migra.com/ficha/f1?t=tok' }; },
    summary: (q) => ({ number: q.number, items: q.items.map((i) => `${i.name} × ${i.qty}`).join(', '), total: q.plan.total, entry: q.plan.entry, parcels: 3 }),
    quoteFile: (q) => ({ buffer: Buffer.from(`%PDF ${q.number}`), name: `${q.number}.pdf` }),
    audit: (t) => audits.push(t),
  };
  const maria = new Maria({
    store, auth, sales: { listFor: () => [], summary: () => ({}) }, customers: { search: () => [], duplicates: () => [] }, cash: { entries: () => [], summary: () => ({ byCurrency: {}, spending: [] }) },
    contracts, send: async (jid, p) => { sent.push({ jid, ...p }); }, lineName: (id) => (id === LINE ? 'Maria' : ''), lineIdByName: (n) => (n === 'Maria' ? LINE : ''),
    isConnected: (k) => (k.startsWith('l:') ? lineUp : true), marcosPhone: () => '5545999990001', audit: () => {}, log: () => {},
  });
  const say = async (phone, text) => { sent.length = 0; await maria.handle({ line: LINE, jid: `l:${LINE}:${phone}@s.whatsapp.net`, phone, text }); return sent.filter((m) => m.text || m.media); };
  return { maria, say, sent, leads, quotes, forms, audits, ids: { marcos, ana, sil } };
}

test('cadastrar cliente: entra no CRM no nome de quem pediu; pede o nome se faltar; cliente de outro vendedor é recusado', async () => {
  const { say, leads } = mariaSetup();
  assert.equal(quickIntent('cadastre o cliente Ana Souza, 45 98888-7777').acao, 'cadastrar_cliente');
  const r = await say('5545999990004', 'Maria, cadastre o cliente Ana Souza, 45 98888-7777');
  assert.match(r[0].text, /Cadastrei \*Ana Souza\* \(\+55 45 98888-7777\) no CRM, no seu nome, Ana/);
  assert.equal(leads[0].user.name, 'Ana Vendedora');
  assert.equal(leads[0].telefone, '5545988887777');
  const ask = await say('5545999990004', 'Maria, cadastre um cliente novo');
  assert.match(ask[0].text, /qual é o \*nome\* do cliente/);
  const dup = await say('5545999990004', 'Maria, cadastre o cliente Cliente do Outro, 45 91111-2222');
  assert.match(dup[0].text, /já é de outro vendedor/);
});

test('orçar: cadastra o cliente, faz o orçamento no nome do vendedor e devolve PDF + resumo + link da ficha; nada vai ao cliente', async () => {
  const { say, leads, quotes, forms, audits } = mariaSetup();
  assert.equal(quickIntent('orce o pacote Ouro para 2 pessoas para a Ana Souza').acao, 'orcar');
  assert.equal(quickIntent('faça o orçamento do pacote ouro').acao, 'orcar');
  const r = await say('5545999990004', 'Maria, orce o pacote Ouro para 2 pessoas para a cliente Ana Souza, 45 98888-7777');
  assert.equal(r.length, 1);
  assert.equal(r[0].jid, 'l:linha-maria:5545999990004@s.whatsapp.net', 'só para o vendedor');
  assert.equal(r[0].media.mimetype, 'application/pdf');
  assert.match(r[0].text, /Orçamento ORC-2026-0001/);
  assert.match(r[0].text, /Pacote Ouro × 2 · total \*R\$ 25\.994,00\*/);
  assert.match(r[0].text, /ficha\/f1/);
  assert.match(r[0].text, /Quando ele preencher, eu te aviso/);
  assert.match(r[0].text, /Não enviei nada ao cliente/);
  assert.equal(leads.length, 1, 'cadastrou o cliente');
  assert.equal(quotes[0].leadId, 'L1', 'o orçamento fica ligado ao cadastro');
  assert.equal(forms[0].lead.id, 'L1', 'e a ficha também (os dados dele vão para o cadastro)');
  assert.ok(audits.some((a) => /Ana Vendedora pediu o orçamento ORC-2026-0001/.test(a)));
});

test('orçar: pergunta o que falta (cliente, pacote) e continua; pacote inexistente não vira orçamento; Silvane (só consulta) não orça', async () => {
  const { say, quotes } = mariaSetup();
  assert.match((await say('5545999990004', 'Maria, faça um orçamento'))[0].text, /para qual \*cliente\*/);
  assert.match((await say('5545999990004', 'Maria, é para o cliente Carlos Lima'))[0].text, /Qual é o \*pacote\*/);
  assert.equal(quotes.length, 0);
  const ok = await say('5545999990004', 'Maria, pacote Prata para 1 pessoa');
  assert.match(ok[0].text, /Orçamento ORC-2026-0001/);
  assert.match(ok[0].text, /Carlos Lima/);
  assert.match((await say('5545999990003', 'Maria, orce o pacote Ouro para a Ana Souza'))[0].text, /não está liberado/);
});

test('aviso pelo número da Maria: sai pela linha dela quando está no ar; senão pelo número principal; sem WhatsApp cadastrado não envia', async () => {
  const on = mariaSetup({ lineUp: true });
  assert.equal(await on.maria.notifyUser(on.ids.ana.id, 'oi'), true);
  assert.equal(on.sent.at(-1).jid, 'l:linha-maria:5545999990004@s.whatsapp.net');
  const off = mariaSetup({ lineUp: false });
  await off.maria.notifyUser(off.ids.ana.id, 'oi');
  assert.equal(off.sent.at(-1).jid, '5545999990004@s.whatsapp.net');
  off.maria.auth.update(off.ids.ana.id, { whatsapp: '' });
  assert.equal(await off.maria.notifyUser(off.ids.ana.id, 'oi'), false);
});

test('prévia: o aviso traz o orçamento (pacote, total, entrada, parcelas) e o próximo passo com o nome do cliente', () => {
  const q = { number: 'ORC-2026-0007', items: [{ name: 'Pacote Ouro', qty: 2 }], plan: { total: 25994, entry: 2600, parcels: [1, 2, 3] } };
  const t = filledNotice({ nome: 'Ana Souza', quote: q, requesterName: 'Ana Vendedora', mariaName: 'Maria' });
  assert.match(t, /^📝 Ana, o cliente \*Ana Souza\* já preencheu a ficha de dados!/);
  assert.match(t, /Prévia do orçamento ORC-2026-0007\*\nPacote Ouro × 2\nTotal R\$ 25\.994,00 · entrada R\$ 2\.600,00 \+ 3 parcelas/);
  assert.match(t, /Maria, gere o contrato de Ana Souza/);
  assert.doesNotMatch(filledNotice({ nome: 'X' }), /Prévia/, 'sem orçamento, sem prévia inventada');
});

test('achar o orçamento do cliente: por telefone, nome inteiro ou parte do nome; ambíguo pede o nome completo', () => {
  const list = [
    { id: 1, client: 'Ana Souza', phone: '5545988887777' }, { id: 2, client: 'Carlos Lima', phone: '' }, { id: 3, client: 'Ana Paula Dias', phone: '' }, { id: 4, client: 'Beto Alves', phone: '' },
  ];
  const f = (a) => findRecentQuote(list, { samePhone, normalizePhone, ...a });
  assert.equal(f({ phone: '45 98888-7777' }).id, 1, 'pelo telefone');
  assert.equal(f({ nome: 'carlos lima' }).id, 2, 'nome inteiro, sem acento nem maiúscula');
  assert.equal(f({ nome: 'Beto' }).id, 4, 'parte do nome, quando só um combina');
  assert.throws(() => f({ nome: 'Ana' }), /mais de um cliente.*Ana Souza.*Ana Paula Dias.*nome completo/);
  assert.equal(f({ nome: 'Zeca' }), null);
});

// ---- ficha pedida pela Maria: o vendedor é avisado nos dois fluxos ----
function closingSetup() {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  auth.create({ name: 'Marcos', login: 'marcos', password: 'segredo123', role: 'admin' });
  const crm = new Crm({ store, auth });
  store.updateSettings({ payments: { pixKey: '12345678000190', receiverName: 'Migra', receiverCity: 'CDE', enabled: true }, crm: { panelUrl: 'https://painel.migra.com' } });
  const sent = []; const warned = [];
  const sendTo = async (key, p) => sent.push({ key, ...p });
  const payments = new Payments({ store, crm, dataDir: store.dataDir, secret: 'x', sendTo, notifyAdmins: async () => {} });
  const closing = new Closing({ store, crm, payments, secret: 'x', dataDir: store.dataDir, sendTo, notifyAdmins: async () => {}, remember: () => {}, baseUrl: () => 'https://painel.migra.com' });
  closing.onManualFilled = async (f) => warned.push(f.data.nome);
  return { closing, crm, sent, warned, payments };
}

test('ficha da Maria enviada ao cliente (noAuto): o cliente recebe só a confirmação, sem Pix nem termo; o vendedor é avisado', async () => {
  const { closing, crm, sent, warned, payments } = closingSetup();
  const lead = crm.ensureFromConversation({ key: '5545988887777@s.whatsapp.net', phone: '5545988887777', name: 'Ana', channel: 'whatsapp' });
  const f = closing.createForm({ convKey: '5545988887777@s.whatsapp.net', lead, servico: 'Pacote Ouro', adultos: 2 });
  Object.assign(f, { noAuto: true, requesterId: 'u1' });
  await closing.submitForm(f.id, closing.token(f.id), DATA);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(warned, ['Ana Souza']);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Recebi seus dados, Ana! ✅.*seu consultor dá continuidade/);
  assert.equal(payments.list?.length || 0, 0, 'nenhum Pix de reserva');
  assert.equal(crm.leads[0].name, 'Ana Souza', 'os dados do cliente foram para o cadastro');
});

test('ficha enviada pela Maria para gerar o contrato (fluxo automático): segue como sempre E o vendedor que pediu também é avisado', async () => {
  const { closing, crm, sent, warned } = closingSetup();
  const lead = crm.ensureFromConversation({ key: '5545988887777@s.whatsapp.net', phone: '5545988887777', name: 'Ana', channel: 'whatsapp' });
  const f = closing.createForm({ convKey: '5545988887777@s.whatsapp.net', lead, servico: 'Pacote Ouro', adultos: 2 });
  f.requesterId = 'u1';
  await closing.submitForm(f.id, closing.token(f.id), DATA);
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(sent.some((m) => /Recebi seus dados/.test(m.text || '')), 'fluxo normal com o cliente continua');
  assert.deepEqual(warned, ['Ana Souza'], 'e o vendedor é avisado uma vez');
});

test('contrato enviado ao cliente leva o PDF além do link de assinatura', async () => {
  const sentTo = []; const notes = [];
  const lead = { id: 'L1', name: 'Ana' };
  const out = makeOutbound({
    publicBase: () => 'https://painel.migra.com', store: { isBlacklisted: () => false, save() {} }, quotes: () => [{ id: 'q1', number: 'ORC-2026-0001', leadId: 'L1', phone: '5545988887777' }], samePhone,
    lines: { byOwner: () => null }, lineKey, wa: { isConnected: () => true, send: async (k, p) => sentTo.push({ k, ...p }) }, agent: { conversation: () => ({}), remember() {} },
    crm: { findForConversation: () => lead, ensureFromConversation: () => lead, canSee: () => true, assign() {}, addNote: (u, id, t) => notes.push(t) },
    closing: { forLead: () => null }, contractFlow: { sendContract: async () => ({ enviado: true }) }, fichaMessage: () => '',
    contractFile: (q) => ({ buffer: Buffer.from('%PDF contrato'), name: `Contrato ${q.number}.pdf` }),
  });
  const admin = { id: 'u1', name: 'Marcos', role: 'admin' };
  const r = await out.sendContract({ user: admin, viewer: admin, phone: '5545988887777', nome: 'Ana Souza', pacote: 'Pacote Ouro', pessoas: 2 });
  assert.equal(r.kind, 'contrato');
  assert.equal(r.pdf, true);
  assert.equal(sentTo[0].media.mimetype, 'application/pdf');
  assert.match(sentTo[0].text, /contrato em PDF/);
  assert.ok(notes.some((n) => /PDF e link de assinatura/.test(n)));
});
