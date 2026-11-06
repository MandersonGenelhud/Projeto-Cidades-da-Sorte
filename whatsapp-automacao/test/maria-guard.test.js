import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Personal } from '../src/personal.js';
import { Ana } from '../src/ana.js';
import { Maria } from '../src/maria.js';
import { detectChange } from '../src/assistant-guard.js';
import { tempStore } from './helpers.js';

const LINE = 'l1';
const MARCOS = '5545999990001';
const MANDERSON = '5545999990002';
const VENDEDORA = '5545999990004';

function setup({ ownerFails = false } = {}) {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const marcos = auth.create({ name: 'Marcos Miguel', login: 'marcos', password: 'segredo123', role: 'admin' });
  const mand = auth.create({ name: 'Manderson Genel', login: 'manderson', password: 'segredo123', role: 'admin' });
  const ana = auth.create({ name: 'Ana Vendedora', login: 'ana', password: 'segredo123', role: 'seller' });
  auth.update(marcos.id, { whatsapp: MARCOS }); auth.update(mand.id, { whatsapp: MANDERSON }); auth.update(ana.id, { whatsapp: VENDEDORA });
  const sent = []; const audits = []; const calls = [];
  const spy = (name) => (...a) => { calls.push(name); return name === 'listFor' ? [] : { lead: { id: 'L' }, created: false }; };
  const sales = { listFor: spy('listFor'), get: spy('get'), canSee: () => true, view: (s) => s, summary: () => ({}) };
  const contracts = { packages: () => ['Pacote Ouro'], fields: [], required: [], registerLead: spy('registerLead'), createQuote: spy('createQuote'), findQuote: () => null, formLink: spy('formLink'), summary: () => ({}), audit() {} };
  const now = () => new Date(2026, 10, 6, 10, 30);
  const personal = new Personal({ store, now });
  const anaBot = new Ana({ store, auth, personal, now, notify: async () => true });
  const maria = new Maria({
    store, auth, ana: anaBot, sales, customers: { search: () => [] }, cash: {}, contracts, now,
    send: async (j, p) => { if (ownerFails && j.includes(MARCOS)) throw new Error('fora do ar'); sent.push({ j, ...p }); },
    lineName: () => 'Maria', marcosPhone: () => MARCOS, audit: (t) => audits.push(t), log: () => {},
  });
  maria.config.lineId = LINE;
  const say = async (phone, text) => { sent.length = 0; await maria.handle({ line: LINE, jid: `l:${LINE}:${phone}@s.whatsapp.net`, phone, text }); return sent.filter((m) => m.text); };
  const toMarcos = (r) => r.filter((m) => m.j.includes(MARCOS));
  const toWho = (r, phone) => r.filter((m) => m.j.includes(phone));
  return { say, calls, audits, toMarcos, toWho, personal, ids: { marcos, mand, ana } };
}

test('reconhece pedido de EXCLUIR e de ALTERAR; criar, consultar, enviar e perguntas "como faço" passam', () => {
  for (const t of ['apague o cadastro do cliente Carlos Lima', 'exclua o cliente Ana', 'cancele o contrato VD-2026-0001', 'delete a venda do João', 'remova o vendedor Pedro', 'limpe as conversas',
    'altere o telefone do cliente Ana', 'corrija o contrato do Carlos', 'mude o valor do orçamento', 'dê baixa na parcela do cliente', 'marque o contrato como pago', 'transfira o cliente para outro vendedor', 'troque o CPF do cliente', 'atualize o endereço do cliente']) {
    assert.ok(detectChange(t), `deveria bloquear: "${t}"`);
  }
  for (const t of ['cadastre o cliente Ana Souza', 'gere o contrato da Ana', 'me manda o contrato do Carlos', 'orce o pacote Ouro para 2 pessoas', 'relatório dos contratos de hoje', 'envie a ficha para o cliente 45 98888-7777',
    'como excluo um cliente?', 'posso alterar um contrato depois de assinado?', 'quanto custa o pacote Ouro', 'o contrato do Carlos foi alterado?', 'qual o telefone do cliente Ana']) {
    assert.equal(detectChange(t), null, `não deveria bloquear: "${t}"`);
  }
  assert.equal(detectChange('apague o cadastro do cliente Carlos').kind, 'excluir');
  assert.equal(detectChange('altere o telefone do cliente').kind, 'alterar');
  assert.equal(detectChange('cancele o dentista', 'ana'), null, 'agenda pessoal da Ana continua livre');
  assert.equal(detectChange('apague o lembrete do banco', 'ana'), null);
  assert.equal(detectChange('corrija o gasto de ontem', 'ana'), null);
  assert.ok(detectChange('apague o cliente Carlos', 'ana'), 'mas cliente da empresa não, nem pela Ana');
});

test('vendedora pede para EXCLUIR um cadastro: nada é feito, ela é informada e o Marcos recebe quem pediu, o número e o cliente', async () => {
  const t = setup();
  const r = await t.say(VENDEDORA, 'Maria, apague o cadastro do cliente Carlos Lima');
  const own = t.toWho(r, VENDEDORA);
  assert.match(own[0].text, /não excluo nem altero nada no sistema.*Avisei o Marcos do seu pedido \(excluir o cadastro de Carlos Lima\)/);
  const m = t.toMarcos(r);
  assert.equal(m.length, 1);
  assert.match(m[0].text, /Pedido de EXCLUSÃO feito pela Maria/);
  assert.match(m[0].text, /Quem pediu: \*Ana Vendedora\* \(vendedor\) · \+55 45 99999-0004/);
  assert.match(m[0].text, /O que pediu: excluir o cadastro de \*Carlos Lima\*/);
  assert.match(m[0].text, /Mensagem: "apague o cadastro do cliente Carlos Lima"/);
  assert.match(m[0].text, /06\/11\/2026 10:30/);
  assert.match(m[0].text, /Eu não fiz nada/);
  assert.deepEqual(t.calls, [], 'nenhuma função do sistema foi chamada');
  assert.ok(t.audits.some((a) => /BLOQUEADO · Ana Vendedora pediu à Maria para excluir cadastro de Carlos Lima/.test(a)), 'fica no registro de segurança');
});

test('pedido de ALTERAÇÃO (cadastro, contrato por número, telefone): o Marcos é avisado do alvo certo', async () => {
  const t = setup();
  let r = await t.say(VENDEDORA, 'Maria, altere o telefone do cliente Ana Souza para 45 91111-2222');
  assert.match(t.toMarcos(r)[0].text, /Pedido de ALTERAÇÃO feito pela Maria/);
  assert.match(t.toMarcos(r)[0].text, /alterar o telefone de \*Ana Souza\*/);
  r = await t.say(MANDERSON, 'Maria, cancele o contrato VD-2026-0001');
  assert.match(t.toMarcos(r)[0].text, /Quem pediu: \*Manderson Genel\* \(acesso completo\) · \+55 45 99999-0002/);
  assert.match(t.toMarcos(r)[0].text, /excluir o contrato de \(VD-2026-0001\)/);
  r = await t.say(VENDEDORA, 'Maria, mude o valor do orçamento ORC-2026-0007 para 1000');
  assert.match(t.toMarcos(r)[0].text, /ORC-2026-0007/);
  assert.deepEqual(t.calls, []);
});

test('o próprio Marcos pedindo: nada é feito e ninguém é avisado; mesmo pedido repetido não enche o Marcos de avisos', async () => {
  const t = setup();
  const r = await t.say(MARCOS, 'Maria, exclua o cliente Carlos Lima');
  assert.match(r[0].text, /não excluo nem altero nada no sistema por aqui, nem a pedido seu/);
  assert.equal(r.length, 1);
  const a = await t.say(VENDEDORA, 'Maria, apague o cliente Pedro Alves');
  assert.equal(t.toMarcos(a).length, 1);
  const b = await t.say(VENDEDORA, 'Maria, apague o cliente Pedro Alves');
  assert.equal(t.toMarcos(b).length, 0, 'não repete o aviso em 10 minutos');
  assert.match(t.toWho(b, VENDEDORA)[0].text, /Avisei o Marcos/);
  const c = await t.say(VENDEDORA, 'Maria, apague o cliente Outra Pessoa');
  assert.equal(t.toMarcos(c).length, 1, 'outro pedido é outro aviso');
});

test('a Ana também não exclui nem altera dado da empresa (e o Marcos é avisado), mas a agenda pessoal segue livre', async () => {
  const t = setup();
  const r = await t.say(MANDERSON, 'Ana, apague o cliente Carlos Lima do sistema');
  assert.match(t.toMarcos(r)[0].text, /Pedido de EXCLUSÃO feito pela Ana/);
  assert.match(t.toWho(r, MANDERSON)[0].text, /não excluo nem altero nada no sistema/);
  await t.say(MANDERSON, 'Ana, me lembre de ligar para o dentista amanhã às 9h');
  const c = await t.say(MANDERSON, 'Ana, cancele o dentista');
  assert.match(c[0].text, /Cancelei, Manderson/);
  assert.equal(t.personal.agenda(t.ids.mand.id, '2026-11-01', '2026-12-31').length, 0);
});

test('"esse cliente" usa o cliente em foco como alvo, avisando que foi o último citado', async () => {
  const t = setup();
  t.calls.length = 0;
  const maria = (await import('../src/maria.js')).Maria;
  void maria;
  // foca o Carlos por uma consulta (a busca é simulada sem resultado, então o foco vem de um pedido de cadastro)
  await t.say(VENDEDORA, 'Maria, cadastre o cliente Carlos Lima, 45 91111-2222');
  const r = await t.say(VENDEDORA, 'Maria, exclua esse cliente');
  assert.match(t.toMarcos(r)[0].text, /excluir o cliente de \*Carlos Lima\* \(o último cliente que ele citou\)/);
});

test('se o Marcos não puder ser avisado, a pessoa é avisada disso e nada é feito; sem chamar pelo nome não há aviso nenhum', async () => {
  const t = setup({ ownerFails: true });
  const r = await t.say(VENDEDORA, 'Maria, apague o cliente Carlos Lima');
  assert.match(t.toWho(r, VENDEDORA)[0].text, /não consegui avisar o Marcos agora\. Fale diretamente com ele/);
  const n = await t.say(VENDEDORA, 'apague o cliente Carlos Lima');
  assert.equal(n.length, 0, 'sem "Maria,", ela nem responde');
});

test('cadastrar cliente que JÁ existe não altera nada e diz isso', async () => {
  const t = setup();
  const r = await t.say(VENDEDORA, 'Maria, cadastre o cliente Carlos Lima, 45 91111-2222');
  assert.match(t.toWho(r, VENDEDORA)[0].text, /já estava cadastrado, então não mudei nada \(eu não altero cadastros\)/);
});
