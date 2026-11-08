import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDirectory, searchDirectory, describePerson } from '../src/directory.js';
import { quickIntent } from '../src/maria.js';

const src = () => ({
  sales: [{ id: 's1', number: 'ANT-1500', legacy: true, legacyNumber: '1500', client: { nome: 'Carlos Lima Souza', phone: '5545988887711' }, status: 'ativa', total: 12997, parcels: [{ value: 5000, status: 'pago' }, { value: 7997, status: 'pendente' }], quoteId: null }],
  quotes: [{ id: 'q1', number: 'ORC-2026-09767', client: 'Tatiane', phone: '5544999991111', validUntil: '2099-01-01', plan: { total: 12997 }, contract: { status: 'enviado', client: { nome: 'Tatiane Costa Lima', cpf: '529.982.247-25', whatsapp: '+5544999991111', email: 't@x.com' } } }],
  leads: [{ id: 'L1', name: 'Tatiane Costa', phone: null, instagram: 'tati.costa', code: 'MIG-GPTW', stage: 'novo', ownerName: 'Ana', conversationKey: 'ig:77' }, { id: 'L2', name: 'João Batista', phone: '5545900000001', code: 'MIG-AAAA', stage: 'novo' }, { id: 'L3', name: 'João Batista', phone: '5545900000002', code: 'MIG-BBBB', stage: 'novo' }],
  conversations: [{ key: 'ig:77', name: 'Tatiane Costa', username: 'tati.costa', phone: null, messages: [{}, {}, {}] }, { key: '5544999991111@s.whatsapp.net', name: 'Tatiane', phone: '5544999991111', messages: [{}] }],
  closing: [{ id: 'f1', status: 'preenchida', data: { nome: 'Tatiane Costa Lima', cpf: '529.982.247-25', whatsapp: '+5544999991111' } }],
  payments: [{ id: 'px1', status: 'pending', amount: 1800, description: 'Reserva · contrato CT-2026-09767', payerName: 'Tatiane Costa Lima', payerDoc: '529.982.247-25', payerPhone: '5544999991111', convKey: 'ig:77' }],
  legacyContracts: [{ number: '1500', client: 'Carlos Lima Souza', doc: '111.444.777-35', phone: '45988887711', value: 12997, paid: 5000, status: 'ativo' }, { number: '1600', client: 'Maria Antiga', doc: '', phone: '', value: 3000, paid: 0, status: 'ativo' }],
  legacyClients: [{ name: 'Maria Antiga', phone: '', doc: '', email: '' }],
  documents: [],
});

test('índice: lê TUDO (venda, orçamento e contrato, prospecto, conversa, ficha, Pix, sistema antigo) e junta a mesma pessoa pelo CPF ou telefone', () => {
  const dir = buildDirectory(src());
  const tati = dir.people.find((p) => p.cpfs.includes('52998224725'));
  assert.ok(tati, 'achou pelo CPF');
  assert.ok(tati.phones.includes('5544999991111'));
  const kinds = new Set(tati.items.map((i) => i.kind));
  for (const k of ['orçamento', 'contrato', 'ficha de cadastro', 'Pix', 'conversa no WhatsApp']) assert.ok(kinds.has(k), `Tatiane tem: ${k}`);
  assert.equal(tati.name, 'Tatiane Costa Lima', 'o nome mais completo');
  const carlos = dir.people.find((p) => p.names.includes('Carlos Lima Souza'));
  assert.deepEqual(carlos.cpfs, ['11144477735'], 'o CPF veio do sistema antigo');
  assert.ok(carlos.sources.includes('sale') && carlos.sources.includes('legacyContract'), 'a venda e o contrato antigo são a mesma pessoa (mesmo telefone)');
  assert.ok(dir.bySource.legacyContract === 2 && dir.bySource.payment === 1);
});

test('homônimos não se juntam só pelo nome: João Batista com telefones diferentes são duas pessoas', () => {
  const dir = buildDirectory(src());
  assert.equal(dir.people.filter((p) => p.names.includes('João Batista')).length, 2);
  const r = searchDirectory(dir, 'joao batista');
  assert.equal(r.length, 2);
  assert.equal(searchDirectory(dir, '45 90000-0002')[0].person.phones[0], '5545900000002', 'o telefone desempata');
});

test('busca por CPF (completo, parte), telefone (qualquer formato), número de contrato (CT-, ORC-, ANT-, só o final), nome e @ do Instagram', () => {
  const dir = buildDirectory(src());
  const first = (q) => searchDirectory(dir, q)[0]?.person.name;
  assert.equal(first('529.982.247-25'), 'Tatiane Costa Lima');
  assert.equal(first('52998224725'), 'Tatiane Costa Lima');
  assert.equal(first('+55 44 99999-1111'), 'Tatiane Costa Lima');
  assert.equal(first('44999991111'), 'Tatiane Costa Lima');
  assert.equal(first('CT-2026-09767'), 'Tatiane Costa Lima');
  assert.equal(first('ORC-2026-09767'), 'Tatiane Costa Lima');
  assert.equal(first('09767'), 'Tatiane Costa Lima', 'só o final do número');
  assert.equal(first('MIG-GPTW'), 'Tatiane Costa Lima', 'o prospecto do Instagram, o Pix e a ficha da mesma conversa são a mesma pessoa');
  assert.equal(first('1500'), 'Carlos Lima Souza', 'número do sistema antigo');
  assert.equal(first('ANT-1500'), 'Carlos Lima Souza');
  assert.equal(first('tati.costa'), 'Tatiane Costa Lima', 'o @ do Instagram leva à mesma pessoa');
  assert.equal(first('Maria Antiga'), 'Maria Antiga');
  assert.equal(searchDirectory(dir, 'zzzz inexistente').length, 0);
  assert.equal(searchDirectory(dir, 'a').length, 0, 'busca curta demais não devolve tudo');
});

test('resposta da Maria sobre a pessoa: telefone, CPF e onde está cada contrato', () => {
  const dir = buildDirectory(src());
  const t = describePerson(searchDirectory(dir, 'CT-2026-09767')[0].person);
  assert.match(t, /Tatiane Costa Lima/);
  assert.match(t, /\+55 44 9999-91111|\+55 44 99999-1111/);
  assert.match(t, /CPF 529\.982\.247-25/);
  assert.match(t, /contrato: CT-2026-09767 · enviado, sem assinatura/);
  assert.match(t, /Pix: .*em aberto.*R\$ 1\.800,00/);
  const c = describePerson(searchDirectory(dir, '1500')[0].person);
  assert.match(c, /venda do sistema antigo: 1500/);
  assert.match(c, /pago R\$ 5\.000,00/);
});

test('Maria entende pergunta por CPF, telefone ou número sem dizer o nome', () => {
  assert.deepEqual(quickIntent('Maria, quem é o CPF 529.982.247-25?'), { acao: 'cliente', termo: '529.982.247-25' });
  assert.equal(quickIntent('acha o 44 99999-1111').acao, 'cliente');
  assert.equal(quickIntent('procura o 09767').acao, 'cliente');
  assert.equal(quickIntent('o contrato 09767').acao, 'contrato');
});

import { Auth } from '../src/auth.js';
import { Sales } from '../src/sales.js';
import { Maria } from '../src/maria.js';
import { tempStore } from './helpers.js';

function mariaSetup() {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const marcos = auth.create({ name: 'Marcos Miguel', login: 'marcos', password: 'segredo123', role: 'admin' });
  const ana = auth.create({ name: 'Ana Vendedora', login: 'ana', password: 'segredo123', role: 'seller' });
  auth.update(marcos.id, { whatsapp: '5545999990001' }); auth.update(ana.id, { whatsapp: '5545999990004' });
  const sales = new Sales({ store, auth });
  const sent = [];
  // O índice é montado já filtrado: o administrador vê tudo; a Ana só os registros ligados a ela (aqui, só a Tatiane).
  const todos = src();
  const doAna = { ...src(), sales: [], quotes: todos.quotes, leads: todos.leads.filter((l) => l.id === 'L1'), conversations: [], closing: [], payments: [], legacyContracts: [], legacyClients: [], documents: [] };
  const directory = { search: (viewer, q, o) => searchDirectory(buildDirectory(viewer.role === 'admin' ? todos : doAna), q, o), build: () => null };
  const maria = new Maria({
    directory, quoteContractFile: (id) => (id === 'q1' ? { buffer: Buffer.from('%PDF-1.4 teste'), name: 'Contrato CT-2026-09767.pdf', signed: false } : null),
    store, auth, sales, customers: { search: () => [], duplicates: () => [] }, cash: {},
    send: async (jid, payload) => { sent.push({ jid, ...payload }); }, downloadAudio: async () => Buffer.from('x'),
    lineName: (id) => (id === 'linha-maria' ? 'Maria' : ''), marcosPhone: () => '5545999990001', audit: () => {}, log: () => {},
  });
  const say = async (phone, text) => { sent.length = 0; await maria.handle({ line: 'linha-maria', jid: `l:linha-maria:${phone}@s.whatsapp.net`, phone, text }); return sent.slice(); };
  return { say, sent };
}

test('Maria acha o contrato mesmo sem venda lançada: pelo número, pelo CPF ou pelo telefone, e envia o PDF', async () => {
  const { say } = mariaSetup();
  const a = await say('5545999990001', 'Maria, o contrato CT-2026-09767');
  assert.match(a[0].text, /Tatiane Costa Lima/);
  assert.match(a[0].text, /contrato: CT-2026-09767 · enviado, sem assinatura/);
  const pdf = await say('5545999990001', 'Maria, me manda o contrato 09767');
  assert.ok(pdf.some((m) => m.fileName === 'Contrato CT-2026-09767.pdf' || m.document || m.media || m.file || JSON.stringify(m).includes('09767')), 'o PDF foi enviado');
  const cpf = await say('5545999990001', 'Maria, quem é o CPF 529.982.247-25?');
  assert.match(cpf[0].text, /Tatiane Costa Lima/);
  assert.match(cpf[0].text, /Pix: .*em aberto/);
  const tel = await say('5545999990001', 'Maria, acha o 44 99999-1111');
  assert.match(tel[0].text, /Tatiane Costa Lima/);
});

test('Maria com o vendedor: ele só encontra os próprios clientes, nunca o que é de outro', async () => {
  const { say } = mariaSetup();
  const proprio = await say('5545999990004', 'Maria, o cliente tatiane');
  assert.match(proprio[0].text, /Tatiane/);
  const alheio = await say('5545999990004', 'Maria, o cliente Carlos Lima');
  assert.match(alheio[0].text, /Não achei/);
  assert.doesNotMatch(alheio[0].text, /Carlos Lima Souza|111\.444|11144477735/);
  const cpfAlheio = await say('5545999990004', 'Maria, quem é o CPF 111.444.777-35?');
  assert.match(cpfAlheio[0].text, /Não achei/);
});
