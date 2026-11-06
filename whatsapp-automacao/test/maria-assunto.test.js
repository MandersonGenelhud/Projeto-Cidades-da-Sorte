import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Maria } from '../src/maria.js';
import { tempStore } from './helpers.js';

const LINE = 'l1';
const fold = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function setup() {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const m = auth.create({ name: 'Marcos Miguel', login: 'marcos', password: 'segredo123', role: 'admin' });
  auth.update(m.id, { whatsapp: '5545999990001' });
  const sent = []; const quotes = []; const leads = []; const forms = []; const prepared = [];
  const book = [
    { id: 's1', number: 'VD-2026-0001', client: { nome: 'Carlos Lima', phone: '5545911112222' }, total: 1000, received: 0, open: 1000, overdue: 0, status: 'ativa', items: [], parcels: [], next: null, createdAt: '2026-11-01T00:00:00Z', sellerName: 'Marcos' },
    { id: 's2', number: 'VD-2026-0002', client: { nome: 'João Alves', phone: '5545922223333' }, total: 2000, received: 0, open: 2000, overdue: 0, status: 'ativa', items: [], parcels: [], next: null, createdAt: '2026-11-02T00:00:00Z', sellerName: 'Marcos' },
  ];
  const sales = { listFor: (v, { q }) => book.filter((s) => !q || fold(s.client.nome).includes(fold(q))), get: (id) => book.find((s) => s.id === id), canSee: () => true, view: (s) => s, summary: () => ({}) };
  const contracts = {
    packages: () => ['Pacote Ouro', 'Pacote Prata'], fields: ['nome', 'cpf', 'email', 'cep', 'whatsapp'], required: ['nome', 'cpf'], ready: (c) => Boolean(c.nome && c.cpf), findQuote: () => null,
    registerLead: (a) => { leads.push(a); return { lead: { id: `L${leads.length}`, name: a.nome, phone: a.telefone }, created: true }; },
    createQuote: (a) => { const q = { id: `q${quotes.length + 1}`, number: `ORC-${quotes.length + 1}`, client: a.nome, phone: a.telefone, items: [{ name: a.pacote, qty: a.pessoas }], plan: { total: 1, entry: 1, parcels: [] } }; quotes.push(q); return q; },
    clientFor: (q, a) => ({ nome: a.nome, ...a.dados }), formLink: (q, a) => { forms.push({ nome: a.nome, telefone: a.telefone, dados: a.dados }); return { url: 'https://painel/ficha/x' }; },
    prepare: (q, c) => { prepared.push(c); return { url: 'https://painel/c', ct: 'CT-1', buffer: Buffer.from('x'), name: 'c.pdf' }; },
    summary: () => ({ number: 'ORC-1', items: 'Pacote', total: 1, entry: 1, parcels: 0 }), audit() {},
  };
  const maria = new Maria({ store, auth, sales, customers: { search: () => [] }, cash: {}, contracts, contractFile: () => ({ buffer: Buffer.from('%PDF'), name: 'c.pdf', signed: false }), send: async (j, p) => sent.push(p), lineName: () => 'Maria', marcosPhone: () => '', audit() {}, log() {} });
  maria.config.lineId = LINE;
  const say = async (t) => { sent.length = 0; await maria.handle({ line: LINE, jid: `l:${LINE}:5545999990001@s.whatsapp.net`, phone: '5545999990001', text: t }); return sent.map((x) => x.text || '').join('\n'); };
  return { maria, say, quotes, leads, forms, prepared };
}

test('NUNCA vaza dado de um cliente para outro: contrato incompleto do Carlos não contamina o da Ana (CPF, nome, telefone)', async () => {
  const { say, prepared, forms } = setup();
  await say('Maria, gere o contrato do cliente Carlos Lima, CPF 529.982.247-25, 45 91111-2222');
  await say('Maria, gere o contrato do cliente Ana Souza, pacote Ouro para 1 pessoa');
  assert.equal(prepared.length, 0, 'sem os dados da Ana, não gera contrato (não usa os do Carlos)');
  const f = forms.at(-1);
  assert.equal(f.nome, 'Ana Souza');
  assert.equal(f.dados.cpf, undefined, 'o CPF do Carlos não vai para a Ana');
  assert.notEqual(f.telefone, '5545911112222', 'nem o telefone');
});

test('mesma coisa no orçamento: o telefone e o pacote do rascunho do Carlos não passam para a Ana', async () => {
  const { say, quotes, leads } = setup();
  await say('Maria, orce para o cliente Carlos Lima, 45 91111-2222');
  const r = await say('Maria, orce o pacote Ouro para 2 pessoas para a cliente Ana Souza');
  assert.equal(quotes.length, 1);
  assert.equal(quotes[0].client, 'Ana Souza');
  assert.notEqual(quotes[0].phone, '5545911112222');
  assert.equal(leads.at(-1).nome, 'Ana Souza');
  assert.doesNotMatch(r, /Carlos/);
});

test('o seu exemplo: pediu o contrato do Carlos e depois "gere um orçamento" sem dizer o cliente: ela NÃO assume o Carlos, pergunta', async () => {
  const { say, quotes } = setup();
  const c = await say('Maria, o contrato do cliente Carlos Lima');
  assert.match(c, /Carlos Lima/);
  const q = await say('Maria, gere para mim um orçamento');
  assert.match(q, /para qual \*cliente\*/);
  assert.equal(quotes.length, 0, 'não criou nada para o Carlos por conta própria');
});

test('"para ele": vale o último cliente citado, e a resposta AVISA qual é (dá para corrigir na hora)', async () => {
  const { say, quotes, leads } = setup();
  await say('Maria, o contrato do cliente Carlos Lima');
  const r = await say('Maria, orce o pacote Ouro para 2 pessoas para ele');
  assert.match(r, /↪ Entendi que é do cliente \*Carlos Lima\* \(o último que você citou\)\. Se for outro, me diga o nome\./);
  assert.equal(quotes[0].client, 'Carlos Lima');
  assert.equal(leads[0].telefone, '5545911112222', 'e o telefone dele, que estava no contrato');
});

test('citar outro cliente troca o foco: "para ele" passa a ser o último, nunca o anterior', async () => {
  const { say, quotes } = setup();
  await say('Maria, o contrato do cliente Carlos Lima');
  await say('Maria, o contrato do cliente João Alves');
  const r = await say('Maria, orce o pacote Prata para 1 pessoa para ele');
  assert.equal(quotes[0].client, 'João Alves');
  assert.match(r, /Entendi que é do cliente \*João Alves\*/);
});

test('o foco vence com o tempo (30 min) e "novo assunto" zera tudo; sem foco, "para ele" pergunta o cliente', async () => {
  const a = setup();
  await a.say('Maria, o contrato do cliente Carlos Lima');
  a.maria.focus.get('5545999990001').at = Date.now() - 31 * 60_000;
  assert.match(await a.say('Maria, orce o pacote Ouro para ele'), /para qual \*cliente\*/, 'passou de 30 minutos');
  const b = setup();
  await b.say('Maria, o contrato do cliente Carlos Lima');
  assert.match(await b.say('Maria, novo assunto'), /Zerei o assunto anterior/);
  assert.match(await b.say('Maria, orce o pacote Ouro para ele'), /para qual \*cliente\*/);
  assert.equal(b.quotes.length, 0);
});

test('um pedido novo ou uma pergunta não é engolido por um rascunho antigo; a resposta do que ela perguntou continua', async () => {
  const { say, quotes, prepared } = setup();
  await say('Maria, gere o contrato do cliente Carlos Lima'); // ela pergunta o pacote
  const preco = await say('Maria, quanto custa o pacote Ouro?');
  assert.equal(quotes.length, 0, 'uma pergunta não completa o rascunho');
  assert.doesNotMatch(preco, /Qual é o \*pacote\*|Contrato CT|Orçamento ORC/, 'e não foi tratada como resposta do rascunho');
  const joao = await say('Maria, o contrato do cliente João Alves');
  assert.match(joao, /VD-2026-0002/, 'consulta de outro cliente é consulta, não continuação');
  await say('Maria, gere o contrato do cliente Carlos Lima');
  const ok = await say('Maria, pacote Prata para 1 pessoa');
  assert.equal(quotes.length, 1, 'a resposta ("pacote Prata...") continua o pedido certo');
  assert.equal(quotes[0].client, 'Carlos Lima');
  assert.equal(prepared.length, 0);
  assert.match(ok, /Carlos Lima/);
});

test('PDF "desse contrato" depois de falar de outro cliente: não manda o contrato errado', async () => {
  const { say } = setup();
  await say('Maria, o contrato do cliente Carlos Lima');
  await say('Maria, cadastre a cliente Ana Souza, 45 98888-7777');
  const r = await say('Maria, me manda o PDF desse contrato');
  assert.match(r, /De qual cliente é o contrato/, 'o foco mudou para a Ana: não envia o do Carlos por engano');
});
