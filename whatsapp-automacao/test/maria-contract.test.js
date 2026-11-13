import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Crm } from '../src/crm.js';
import { Payments } from '../src/payments.js';
import { Closing } from '../src/closing.js';
import { Maria } from '../src/maria.js';
import { tempStore } from './helpers.js';

const LINE = 'linha-maria';
const REQUIRED = ['nome', 'cpf', 'nacionalidade', 'estadoCivil', 'rua', 'numero', 'cidade', 'uf'];
const FULL = { nome: 'Ana Souza', cpf: '529.982.247-25', nacionalidade: 'Brasileira', estadoCivil: 'Casada', rua: 'Rua das Flores', numero: '10', cidade: 'Foz do Iguaçu', uf: 'PR' };

function setup() {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const marcos = auth.create({ name: 'Marcos Miguel', login: 'marcos', password: 'segredo123', role: 'admin' });
  const silvane = auth.create({ name: 'Silvane Nunes', login: 'silvane', password: 'segredo123', role: 'seller' });
  store.updateSettings({ maria: { profiles: { [silvane.id]: 'basic' } } }); // perfil "contratos e clientes" fixado (pelo nome, a Silvani hoje é diretoria)
  const ana = auth.create({ name: 'Ana Vendedora', login: 'ana', password: 'segredo123', role: 'seller' });
  auth.update(marcos.id, { whatsapp: '5545999990001' });
  auth.update(silvane.id, { whatsapp: '5545999990003' });
  auth.update(ana.id, { whatsapp: '5545999990004' });
  const sent = []; const created = []; const forms = []; const prepared = []; const audits = [];
  const quotes = [];
  const contracts = {
    packages: () => ['Pacote Ouro', 'Pacote Prata'],
    fields: ['nome', 'cpf', 'nacionalidade', 'estadoCivil', 'rua', 'numero', 'cidade', 'uf', 'email', 'cep', 'whatsapp'],
    required: REQUIRED,
    ready: (c) => REQUIRED.every((k) => String(c[k] || '').trim()),
    findQuote: (_v, { nome }) => quotes.find((q) => q.client.toLowerCase() === String(nome).toLowerCase()) || null,
    createQuote: ({ pacote, pessoas, nome, telefone, user }) => { if (!/Ouro|Prata/.test(pacote)) throw new Error('Pacote não encontrado'); const q = { id: `q${quotes.length + 1}`, number: `ORC-2026-000${quotes.length + 1}`, client: nome, phone: telefone, items: [{ name: pacote, qty: pessoas }], plan: { total: 12997 * pessoas, entry: 2600, parcels: [1, 2, 3] }, by: user.name }; quotes.push(q); created.push(q); return q; },
    clientFor: (q, { nome, dados }) => ({ ...(q.filled || {}), ...dados, nome: dados.nome || q.filled?.nome || nome }),
    prepare: (q, client) => { prepared.push({ q, client }); return { url: 'https://painel.migra.com/contrato/abc?t=xyz', ct: 'CT-2026-0001', buffer: Buffer.from('%PDF-contrato'), name: 'Contrato CT-2026-0001.pdf' }; },
    formLink: (q, { user }) => { forms.push({ q, by: user.name }); return { url: 'https://painel.migra.com/ficha/f1?t=tok', filled: false }; },
    summary: (q) => ({ number: q.number, items: q.items.map((i) => `${i.name} × ${i.qty}`).join(', '), total: q.plan.total, entry: q.plan.entry, parcels: 3 }),
    audit: (t) => audits.push(t),
  };
  const maria = new Maria({ store, auth, sales: { listFor: () => [], summary: () => ({}), get: () => null, canSee: () => true, view: (s) => s }, customers: { search: () => [], duplicates: () => [] }, cash: { entries: () => [], summary: () => ({ byCurrency: {}, spending: [] }) }, contracts,
    send: async (jid, p) => { sent.push({ jid, ...p }); }, lineName: (id) => (id === LINE ? 'Maria' : ''), marcosPhone: () => '5545999990001', audit: () => {}, log: () => {} });
  const say = async (phone, text) => { sent.length = 0; await maria.handle({ line: LINE, jid: `l:${LINE}:${phone}@s.whatsapp.net`, phone, text }); return sent.filter((m) => m.text || m.media); };
  return { maria, say, quotes, created, forms, prepared, audits, sent };
}

test('com nome, pacote e dados completos: gera o contrato e manda PDF + link só para quem pediu, sem enviar nada ao cliente', async () => {
  const { say, created, prepared, audits, quotes } = setup();
  const text = 'Maria, gere o contrato do cliente Ana Souza, pacote Ouro para 2 pessoas, CPF 529.982.247-25';
  // O orçamento já guarda os demais dados (como se a ficha estivesse preenchida).
  const first = await say('5545999990001', text);
  assert.match(first[0].text, /faltam dados|ainda faltam/, 'sem os outros dados, cai na ficha (teste abaixo)');
  quotes[0].filled = { ...FULL };
  const r = await say('5545999990001', 'Maria, gere o contrato do cliente Ana Souza');
  assert.equal(r.length, 1);
  assert.equal(r[0].jid, 'l:linha-maria:5545999990001@s.whatsapp.net', 'responde só a quem pediu');
  assert.equal(r[0].media.mimetype, 'application/pdf');
  assert.match(r[0].text, /Contrato CT-2026-0001/);
  assert.match(r[0].text, /https:\/\/painel\.migra\.com\/contrato\/abc/);
  assert.match(r[0].text, /Não enviei nada ao cliente/);
  assert.equal(created.length, 1, 'reaproveitou o orçamento, não criou outro');
  assert.equal(prepared.length, 1);
  assert.ok(audits.some((a) => /Marcos Miguel gerou CT-2026-0001/.test(a)));
});

test('sem os dados do cliente: manda o link da ficha para quem pediu e diz o que falta; não gera contrato nem escreve ao cliente', async () => {
  const { say, forms, prepared, created } = setup();
  const r = await say('5545999990001', 'Maria, gere o contrato da Ana Souza, pacote Ouro para 2 pessoas');
  assert.equal(r.length, 3, 'o aviso para quem pediu + o pedido por escrito + o link sozinho (para encaminhar ao cliente)');
  assert.match(r[0].text, /faltam dados/);
  assert.match(r[0].text, /CPF/);
  assert.match(r[0].text, /Não enviei nada ao cliente/);
  assert.match(r[1].text, /DADOS PARA O CONTRATO[\s\S]*Dependentes/, 'o pedido por escrito traz os campos, e-mail opcional e dependentes');
  assert.match(r[1].text, /Email \(se quiser\)/);
  assert.equal(r[2].text, 'https://painel.migra.com/ficha/f1?t=tok', 'o link vem sozinho, fácil de tocar e encaminhar');
  assert.ok(r.every((m) => m.jid === r[0].jid), 'tudo volta só para quem pediu');
  assert.equal(forms.length, 1);
  assert.equal(prepared.length, 0);
  assert.equal(created[0].items[0].qty, 2);
  assert.equal(created[0].items[0].name, 'Pacote Ouro');
});

test('falta o pacote ou o nome: ela pergunta e continua o mesmo contrato na mensagem seguinte (dentro de 15 minutos)', async () => {
  const { say, created, forms } = setup();
  const ask = await say('5545999990001', 'Maria, gere um contrato');
  assert.match(ask[0].text, /nome do cliente/);
  const ask2 = await say('5545999990001', 'Maria, o cliente Carlos Lima');
  assert.match(ask2[0].text, /Qual é o \*pacote\*/);
  assert.equal(created.length, 0, 'não cria nada pela metade');
  const done = await say('5545999990001', 'Maria, pacote Prata para 1 pessoa');
  assert.match(done[0].text, /Carlos Lima/);
  assert.equal(created.length, 1);
  assert.equal(created[0].client, 'Carlos Lima');
  assert.equal(created[0].items[0].name, 'Pacote Prata');
  assert.equal(forms.length, 1);
});

test('permissões: administrador e vendedor geram; Silvane (contratos e clientes, só leitura) não gera; sem a chamada pelo nome, nada acontece', async () => {
  const { say, created } = setup();
  const sil = await say('5545999990003', 'Maria, gere o contrato da Ana Souza, pacote Ouro');
  assert.match(sil[0].text, /não está liberado/);
  assert.equal(created.length, 0);
  assert.equal((await say('5545999990004', 'gere o contrato da Ana Souza, pacote Ouro')).length, 0, 'sem o nome dela: silêncio');
  assert.equal(created.length, 0);
  const ven = await say('5545999990004', 'Maria, gere o contrato da Ana Souza, pacote Ouro para 1 pessoa');
  assert.match(ven[0].text, /faltam dados/);
  assert.equal(created[0].by, 'Ana Vendedora', 'o orçamento fica no nome de quem pediu');
});

test('pacote inexistente e nome só com o primeiro nome: não gera contrato incompleto', async () => {
  const { say, prepared, quotes } = setup();
  const bad = await say('5545999990001', 'Maria, gere o contrato do cliente Beto Alves, pacote Diamante');
  assert.match(bad[0].text, /Qual é o \*pacote\*/, 'pacote que não existe na lista é tratado como não informado');
  await say('5545999990001', 'Maria, o cliente Joana, pacote Ouro');
  quotes.at(-1).filled = { ...FULL, nome: 'Joana' };
  const r = await say('5545999990001', 'Maria, gere o contrato do cliente Joana');
  assert.match(r[0].text, /faltam dados[\s\S]*nome completo/);
  assert.equal(prepared.length, 0);
});

test('ficha criada pela Maria (sem conversa de cliente): quando preenchida não gera Pix nem escreve ao cliente, só avisa quem pediu', async () => {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  auth.create({ name: 'Marcos', login: 'marcos', password: 'segredo123', role: 'admin' });
  const crm = new Crm({ store, auth });
  store.updateSettings({ payments: { pixKey: '12345678000190', receiverName: 'Migra', receiverCity: 'CDE', enabled: true }, crm: { panelUrl: 'https://painel.migra.com' } });
  const sent = []; const admins = [];
  const sendTo = async (key, p) => sent.push({ key, ...p });
  const payments = new Payments({ store, crm, dataDir: store.dataDir, secret: 'x', sendTo, notifyAdmins: async (t) => admins.push(t) });
  const closing = new Closing({ store, crm, payments, secret: 'x', dataDir: store.dataDir, sendTo, notifyAdmins: async (t) => admins.push(t), remember: () => {}, baseUrl: () => store.settings.crm.panelUrl });
  const warned = [];
  closing.onManualFilled = async (f) => warned.push(f.data.nome);
  const f = closing.createForm({ convKey: null, lead: null, servico: 'Pacote Ouro × 2', adultos: 2 });
  f.noAuto = true;
  const t = closing.token(f.id);
  await closing.submitForm(f.id, t, { nome: 'Ana Souza', cpf: '52998224725', rg: '1234567', nascimento: '1990-01-01', nacionalidade: 'Brasileira', estadoCivil: 'Casada', rua: 'Rua A', numero: '1', bairro: 'Centro', cidade: 'Foz', uf: 'PR', cep: '85850-000', whatsapp: '+5545988887777', adultos: '2' });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(f.status, 'preenchida');
  assert.deepEqual(warned, ['Ana Souza'], 'avisa quem pediu');
  assert.equal(sent.length, 0, 'nada vai a nenhum cliente');
  assert.equal(payments.list?.length || 0, 0, 'nenhum Pix de reserva é criado');
  assert.equal(admins.length, 0);
});
