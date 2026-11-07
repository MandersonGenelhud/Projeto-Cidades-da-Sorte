import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Crm } from '../src/crm.js';
import { Payments } from '../src/payments.js';
import { Closing } from '../src/closing.js';
import { lineKey } from '../src/lines.js';
import { Maria, quickIntent } from '../src/maria.js';
import { makeOutbound } from '../src/maria-outbound.js';
import { tempStore } from './helpers.js';

const LINE = 'linha-maria';

function mariaSetup() {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const marcos = auth.create({ name: 'Marcos Miguel', login: 'marcos', password: 'segredo123', role: 'admin' });
  const silvane = auth.create({ name: 'Silvane Nunes', login: 'silvane', password: 'segredo123', role: 'seller' });
  const ana = auth.create({ name: 'Ana Vendedora', login: 'ana', password: 'segredo123', role: 'seller' });
  auth.update(marcos.id, { whatsapp: '5545999990001' });
  auth.update(silvane.id, { whatsapp: '5545999990003' });
  auth.update(ana.id, { whatsapp: '5545999990004' });
  const sent = []; const calls = []; const blocked = new Set(); const audits = [];
  const outbound = {
    ready: () => true, isBlocked: (p) => blocked.has(p), hasQuote: () => false,
    route: (u) => ({ key: 'k', via: u.role === 'admin' ? 'o WhatsApp principal da Migra' : 'o seu WhatsApp' }),
    sendForm: async (a) => { calls.push({ kind: 'ficha', ...a }); return { kind: 'ficha', via: 'o WhatsApp principal da Migra' }; },
    sendContract: async (a) => { calls.push({ kind: 'contrato', ...a }); return { kind: 'contrato', via: 'o WhatsApp principal da Migra' }; },
  };
  const maria = new Maria({
    store, auth, sales: { listFor: () => [], summary: () => ({ sold: 0, sales: 0, received: 0, toReceive: 0, overdue: 0, commissionOpen: 0, commissionPaid: 0, bySeller: [] }) },
    customers: { search: () => [], duplicates: () => [] }, cash: { entries: () => [], summary: () => ({ byCurrency: {}, spending: [] }) },
    contracts: { packages: () => ['Pacote Ouro', 'Pacote Prata'], fields: [], required: [] }, outbound,
    send: async (jid, p) => { sent.push({ jid, ...p }); }, lineName: (id) => (id === LINE ? 'Maria' : ''), marcosPhone: () => '5545999990001',
    audit: (t) => audits.push(t), log: () => {},
  });
  const say = async (phone, text) => { sent.length = 0; await maria.handle({ line: LINE, jid: `l:${LINE}:${phone}@s.whatsapp.net`, phone, text }); return sent.filter((m) => m.text); };
  return { maria, say, calls, blocked, audits };
}

test('enviar ao cliente: pede confirmação com o número à vista; só o "Maria, sim" envia; nada sai antes', async () => {
  const { say, calls, audits } = mariaSetup();
  const ask = await say('5545999990001', 'Maria, envie a ficha de dados para o cliente Ana Souza, 45 98888-7777');
  assert.match(ask[0].text, /Só para confirmar, Marcos/);
  assert.match(ask[0].text, /\+55 45 98888-7777/);
  assert.match(ask[0].text, /Maria, sim/);
  assert.equal(calls.length, 0, 'ainda não enviou');
  assert.equal((await say('5545999990001', 'sim')).length, 0, 'sem chamar a Maria pelo nome, o "sim" não vale');
  assert.equal(calls.length, 0);
  const ok = await say('5545999990001', 'Maria, sim');
  assert.match(ok[0].text, /Enviei a ficha de dados para Ana Souza/);
  assert.deepEqual(calls.map((c) => [c.kind, c.phone, c.nome]), [['ficha', '5545988887777', 'Ana Souza']]);
  assert.ok(audits.some((a) => /Marcos Miguel mandou a Maria enviar ficha a 5545…7777/.test(a)), 'registrado sem o número inteiro');
});

test('"não" cancela; outro assunto no meio não confirma; confirmação vencida não envia', async () => {
  const { say, calls, maria } = mariaSetup();
  await say('5545999990001', 'Maria, mande a ficha para o cliente 45 98888-7777');
  assert.match((await say('5545999990001', 'Maria, não'))[0].text, /não enviei nada ao cliente/);
  await say('5545999990001', 'Maria, mande a ficha para o cliente 45 98888-7777');
  await say('5545999990001', 'Maria, como está o faturamento do mês?');
  assert.equal(calls.length, 0, 'falar de outra coisa não confirma');
  maria.confirms.get('5545999990001').until = Date.now() - 1;
  await say('5545999990001', 'Maria, sim');
  assert.equal(calls.length, 0, 'depois de 10 minutos a confirmação vence');
});

test('falta o número: pergunta e continua o mesmo pedido; número incompleto é recusado', async () => {
  const { say, calls } = mariaSetup();
  assert.match((await say('5545999990001', 'Maria, envie a ficha para o cliente'))[0].text, /qual é o \*número de WhatsApp do cliente\*/);
  assert.match((await say('5545999990001', 'Maria, é 4598'))[0].text, /qual é o \*número|não parece completo|número de WhatsApp/);
  const conf = await say('5545999990001', 'Maria, é 45 98888-7777');
  assert.match(conf[0].text, /\+55 45 98888-7777/);
  await say('5545999990001', 'Maria, sim');
  assert.equal(calls.length, 1);
});

test('contrato ao cliente: sem orçamento pede o pacote; com o pacote confirma e envia', async () => {
  const { say, calls } = mariaSetup();
  const ask = await say('5545999990001', 'Maria, envie o contrato para o cliente Carlos Lima, 45 97777-6666');
  assert.match(ask[0].text, /Qual é o \*pacote\*/);
  const conf = await say('5545999990001', 'Maria, pacote Ouro para 2 pessoas');
  assert.match(conf[0].text, /o contrato\* \(2 × Pacote Ouro\)/);
  assert.match(conf[0].text, /Carlos Lima/);
  await say('5545999990001', 'Maria, sim');
  assert.deepEqual(calls.map((c) => [c.kind, c.phone, c.pacote, c.pessoas]), [['contrato', '5545977776666', 'Pacote Ouro', 2]]);
});

test('travas: número na lista de bloqueio não recebe; não repete o mesmo envio em 10 minutos; limite por hora; só administrador e vendedor enviam', async () => {
  const { say, calls, blocked } = mariaSetup();
  blocked.add('5545966665555');
  assert.match((await say('5545999990001', 'Maria, envie a ficha para o cliente 45 96666-5555'))[0].text, /pediu para não receber mensagens|lista de quem pediu/);
  assert.equal(calls.length, 0);
  await say('5545999990001', 'Maria, envie a ficha para o cliente 45 98888-7777');
  await say('5545999990001', 'Maria, sim');
  assert.match((await say('5545999990001', 'Maria, envie a ficha para o cliente 45 98888-7777'))[0].text, /já foi feito para esse número há poucos minutos/);
  for (let i = 0; i < 9; i++) { await say('5545999990001', `Maria, envie a ficha para o cliente 45 9${1000 + i}-${2000 + i}`); await say('5545999990001', 'Maria, sim'); }
  assert.equal(calls.length, 10);
  assert.match((await say('5545999990001', 'Maria, envie a ficha para o cliente 45 95555-4444'))[0].text, /10 envios a clientes na última hora/);
  const sil = await say('5545999990003', 'Maria, envie a ficha para o cliente 45 93333-2222');
  assert.match(sil[0].text, /não está liberado/, 'Silvane só consulta');
  const ven = await say('5545999990004', 'Maria, envie a ficha para o cliente 45 93333-2222');
  assert.match(ven[0].text, /Só para confirmar, Ana/, 'vendedora pode, com confirmação');
});

test('reconhece o pedido sem confundir com "me manda" (que é para a própria pessoa)', () => {
  assert.equal(quickIntent('envie a ficha para o cliente 45 98888-7777').acao, 'enviar_cliente');
  assert.equal(quickIntent('mande o contrato pro cliente 45988887777').o_que, 'contrato');
  assert.equal(quickIntent('manda o link da ficha para o número 45 98888-7777').o_que, 'ficha');
  assert.notEqual(quickIntent('me manda o link da ficha de dados')?.acao, 'enviar_cliente');
  assert.notEqual(quickIntent('me manda o contrato da Ana')?.acao, 'enviar_cliente');
  assert.equal(quickIntent('gere o contrato da Ana Souza, pacote Ouro').acao, 'gerar_contrato');
});

// ---- o "como enviar" (src/maria-outbound.js), com CRM e ficha de verdade ----
function outSetup({ sellerLine = false, connected = true } = {}) {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const marcos = auth.get(auth.create({ name: 'Marcos', login: 'marcos', password: 'segredo123', role: 'admin' }).id);
  const ana = auth.get(auth.create({ name: 'Ana', login: 'ana', password: 'segredo123', role: 'seller' }).id);
  const bia = auth.get(auth.create({ name: 'Bia', login: 'bia', password: 'segredo123', role: 'seller' }).id);
  const crm = new Crm({ store, auth });
  store.updateSettings({ payments: { pixKey: '12345678000190', receiverName: 'Migra', receiverCity: 'CDE' }, crm: { panelUrl: 'https://painel.migra.com' } });
  const sent = []; const notes = []; const memory = [];
  const sendTo = async (key, p) => sent.push({ key, ...p });
  const payments = new Payments({ store, crm, dataDir: store.dataDir, secret: 'x', sendTo, notifyAdmins: async () => {} });
  const closing = new Closing({ store, crm, payments, secret: 'x', dataDir: store.dataDir, sendTo, notifyAdmins: async () => {}, remember: () => {}, baseUrl: () => 'https://painel.migra.com' });
  const convs = new Map();
  const agent = { conversation: (k) => { if (!convs.has(k)) convs.set(k, { key: k }); return convs.get(k); }, remember: (c, r, t) => memory.push({ key: c.key, r, t }) };
  const up = new Set([`${'5545988887777'}@s.whatsapp.net`, lineKey('L1', '5545988887777@s.whatsapp.net')].filter(() => connected));
  const wa = { isConnected: (k) => up.has(k), send: async (k, p) => { sent.push({ key: k, ...p }); } };
  const lines = { byOwner: (id) => (sellerLine && id === ana.id ? { id: 'L1' } : null) };
  const contractFlow = { sendContract: async () => ({ precisaDados: true, link: 'https://painel.migra.com/ficha/x?t=y' }) };
  const out = makeOutbound({ publicBase: () => 'https://painel.migra.com', store, quotes: () => [], samePhone: (a, b) => String(a).slice(-9) === String(b).slice(-9), lines, lineKey, wa, agent, crm, closing, contractFlow, fichaMessage: (n, url) => `Oi${n ? `, ${n.split(' ')[0]}` : ''}! Preencha: ${url}` });
  return { out, sent, memory, crm, closing, marcos, ana, bia, store };
}

test('sendForm: sai pelo número principal (administrador) ou pelo do vendedor, cria o prospecto no nome dele e guarda na memória da atendente', async () => {
  const a = outSetup();
  const r = await a.out.sendForm({ user: a.marcos, viewer: a.marcos, phone: '5545988887777', nome: 'Ana Souza', adultos: 2 });
  assert.equal(r.kind, 'ficha');
  assert.equal(a.sent.at(-1).key, '5545988887777@s.whatsapp.net');
  assert.match(a.sent.at(-1).text, /^https:\/\/painel\.migra\.com\/ficha\//, 'o link vai sozinho, na segunda mensagem');
  assert.match(a.sent.at(-2).text, /Oi, Ana! Para gerar a sua reserva, preencha estes dados[\s\S]*DADOS PARA O CONTRATO[\s\S]*Dependentes/, 'antes, o pedido por escrito para quem tem medo de link');
  assert.equal(a.memory.length, 1, 'a atendente lembra do que foi enviado');
  assert.equal(a.closing.list.at(-1).convKey, '5545988887777@s.whatsapp.net', 'a ficha segue o fluxo normal (conversa real do cliente)');
  assert.equal(a.closing.list.at(-1).noAuto, true, 'sem Pix nem termo automáticos: o vendedor decide');
  assert.equal(a.closing.list.at(-1).requesterId, a.marcos.id, 'e quem pediu é avisado quando o cliente preencher');
  const b = outSetup({ sellerLine: true });
  const r2 = await b.out.sendForm({ user: b.ana, viewer: b.ana, phone: '5545988887777', nome: 'Ana Souza' });
  assert.equal(r2.via, 'o seu WhatsApp');
  assert.equal(b.sent.at(-1).key, lineKey('L1', '5545988887777@s.whatsapp.net'));
  assert.equal(b.crm.leads.find((l) => l.phone === '5545988887777').ownerId, b.ana.id, 'o cliente fica com quem pediu');
});

test('sendForm: cliente de outro vendedor é recusado; WhatsApp desconectado e sistema sem endereço dão erro claro', async () => {
  const a = outSetup();
  await a.out.sendForm({ user: a.ana, viewer: a.ana, phone: '5545988887777', nome: 'Ana Souza' });
  await assert.rejects(a.out.sendForm({ user: a.bia, viewer: a.bia, phone: '5545988887777', nome: 'Ana Souza' }), /de outro vendedor/);
  const off = outSetup({ connected: false });
  await assert.rejects(off.out.sendForm({ user: off.marcos, viewer: off.marcos, phone: '5545988887777' }), /não está conectado/);
  const noUrl = makeOutbound({ publicBase: () => '', store: a.store, quotes: () => [], samePhone: () => false, lines: { byOwner: () => null }, lineKey, wa: {}, agent: {}, crm: {}, closing: {}, contractFlow: {}, fichaMessage: () => '' });
  assert.equal(noUrl.ready(), false);
  await assert.rejects(noUrl.sendForm({ user: a.marcos, viewer: a.marcos, phone: '5545988887777' }), /endereço na internet/);
});

test('sendContract: sem dados do cliente manda a ficha (o contrato sai quando ele preencher); bloqueio da lista de descadastrados', async () => {
  const a = outSetup();
  const r = await a.out.sendContract({ user: a.marcos, viewer: a.marcos, phone: '5545988887777', nome: 'Ana Souza', pacote: 'Pacote Ouro', pessoas: 2 });
  assert.equal(r.kind, 'ficha_para_contrato');
  assert.match(a.sent.at(-2).text, /Para gerar o seu contrato, preencha estes dados[\s\S]*DADOS PARA O CONTRATO/);
  assert.match(a.sent.at(-1).text, /^https:\/\//, 'e o link sozinho logo depois');
  a.store.addToBlacklist('5545911112222');
  assert.equal(a.out.isBlocked('5545911112222'), true);
  assert.equal(a.out.isBlocked('5545988887777'), false);
});
