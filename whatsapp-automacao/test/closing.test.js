import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Auth } from '../src/auth.js';
import { Crm } from '../src/crm.js';
import { Payments } from '../src/payments.js';
import { Closing, validCpf } from '../src/closing.js';
import { jpegSize } from '../src/pdfdoc.js';
import { tempStore } from './helpers.js';

// JPEG 1x1 válido, engordado com um comentário (a assinatura real tem alguns KB).
const tinyJpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const pad = Buffer.alloc(2000, 0x20);
const com = Buffer.concat([Buffer.from([0xff, 0xfe, (pad.length + 2) >> 8, (pad.length + 2) & 0xff]), pad]);
const SIG = `data:image/jpeg;base64,${Buffer.concat([tinyJpeg.subarray(0, 2), com, tinyJpeg.subarray(2)]).toString('base64')}`;

function setup(closingSettings = {}) {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  auth.create({ name: 'Marcos', login: 'marcos', password: 'segredo123', role: 'admin' });
  const crm = new Crm({ store, auth });
  store.updateSettings({
    payments: { pixKey: '12345678000190', receiverName: 'Migra Paraguai', receiverCity: 'Ciudad del Este', bankInfo: 'Banco X · Ag 1 · CC 2', company: { name: 'Migra Paraguai Assessoria', document: '12.345.678/0001-90', address: 'Av. Central, 100' }, reservation: { base: 1000, perAdult: 800, description: 'reserva' } },
    crm: { panelUrl: 'https://painel.migra.com' },
    closing: closingSettings,
  });
  const sent = [];
  const admins = [];
  const memory = [];
  const sendTo = async (key, payload) => sent.push({ key, ...payload });
  const payments = new Payments({ store, crm, dataDir: store.dataDir, secret: 'x', sendTo, notifyAdmins: async (t) => admins.push(t) });
  const closing = new Closing({
    store, crm, payments, secret: 'x', dataDir: store.dataDir, sendTo,
    notifyAdmins: async (t) => admins.push(t),
    remember: (key, text) => memory.push(text),
    baseUrl: () => store.settings.crm.panelUrl,
  });
  payments.onPaid = (p) => closing.onPaid(p);
  const lead = crm.ensureFromConversation({ key: '5511987654321@s.whatsapp.net', phone: '5511987654321', name: 'Ana Souza', channel: 'whatsapp' });
  return { store, crm, payments, closing, lead, sent, admins, memory };
}

const DATA = {
  nome: 'Ana Paula Souza', cpf: '529.982.247-25', rg: '12.345.678-9', rgOrgao: 'SSP/SP', nascimento: '10/05/1990', nacionalidade: 'Brasileira',
  estadoCivil: 'Casado(a)', profissao: 'Enfermeira', email: 'ana@exemplo.com', whatsapp: '+5511987654321', cep: '01310-100', rua: 'Av. Paulista',
  numero: '1000', bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'sp', adultos: '2', acompanhantes: 'Carlos Souza (marido)',
};
// Espera o envio em segundo plano (QR Code e mensagens) terminar.
const flush = async (sent, n = 6) => { for (let i = 0; i < 100 && sent.length < n; i++) await new Promise((r) => setTimeout(r, 20)); };

test('CPF: confere os dígitos verificadores', () => {
  assert.ok(validCpf('529.982.247-25'));
  assert.ok(!validCpf('529.982.247-24'));
  assert.ok(!validCpf('111.111.111-11'));
});

test('ficha → Pix → termo, na ordem, com os dados do cliente', async () => {
  const { closing, lead, sent, admins, memory, crm } = setup();
  const f = closing.createForm({ convKey: lead.conversationKey, lead, servico: 'Residência - pacote Ouro' });
  assert.match(closing.formUrl(f), /^https:\/\/painel\.migra\.com\/ficha\/[0-9a-f]+\?t=/);

  // Já vem preenchida com o que sabemos.
  const pub = closing.publicForm(f.id, closing.token(f.id));
  assert.equal(pub.data.nome, 'Ana Souza');
  assert.equal(pub.data.whatsapp, '+5511987654321');
  assert.equal(pub.data.objetivo, 'Residência - pacote Ouro');
  assert.throws(() => closing.publicForm(f.id, 'errado'), /Link inválido/);

  await assert.rejects(closing.submitForm(f.id, closing.token(f.id), { ...DATA, cpf: '123.456.789-00' }), /CPF/);
  await assert.rejects(closing.submitForm(f.id, closing.token(f.id), { ...DATA, rua: '' }), /Rua/);
  const r = await closing.submitForm(f.id, closing.token(f.id), DATA, { ip: '200.1.2.3', ua: 'iPhone' });
  assert.equal(r.nome, 'Ana');
  await flush(sent);

  // Mensagens: confirmação, aviso do Pix, QR Code, copia e cola, instrução e termo.
  const texts = sent.map((m) => m.text);
  assert.match(texts[0], /Recebi seus dados, Ana/);
  assert.match(texts[1], /Pix de R\$ 2\.600,00/); // 1.000 + 2 × 800
  assert.ok(sent[2].media?.path.endsWith('.png'));
  assert.match(texts[3], /^000201/);
  assert.match(texts[4], /Banco X/);
  assert.match(texts[5], /termo da sua reserva/);
  assert.match(texts[5], /\/termo\//);
  assert.ok(!texts.join(' ').toLowerCase().includes('contrato'));
  assert.ok(memory.some((m) => m.includes('Pix de R$ 2.600,00')));
  assert.ok(admins.some((a) => a.includes('Ficha de dados preenchida')));

  // CRM atualizado.
  const l = crm.byId(lead.id);
  assert.equal(l.name, 'Ana Paula Souza');
  assert.equal(l.people, 2);
  assert.match(l.contractData, /CPF: 529\.982\.247-25/);

  // Termo com os dados.
  const term = closing.publicTerm(f.id, closing.token(f.id, 'termo'));
  assert.match(term.text, /Ana Paula Souza/);
  assert.match(term.text, /529\.982\.247-25/);
  assert.match(term.text, /Av\. Paulista, 1000, Bela Vista, São Paulo\/SP/);
  assert.match(term.text, /R\$ 2\.600,00/);
  assert.match(term.text, /Migra Paraguai Assessoria/);
  assert.ok(!/\{\w+\}/.test(term.text), 'nenhum campo ficou sem preencher');

  // Assinatura.
  const tt = closing.token(f.id, 'termo');
  await assert.rejects(closing.signTerm(f.id, tt, { nome: 'Ana Paula Souza', cpf: '52998224725', assinatura: SIG }), /concorda/);
  await assert.rejects(closing.signTerm(f.id, tt, { nome: 'Outra Pessoa', cpf: '52998224725', aceite: true, assinatura: SIG }), /nome/);
  await assert.rejects(closing.signTerm(f.id, tt, { nome: 'Ana Paula Souza', cpf: '52998224725', aceite: true, assinatura: 'data:image/png;base64,AAA' }), /assinatura/);
  sent.length = 0;
  const ok = await closing.signTerm(f.id, tt, { nome: 'ana paula souza', cpf: '52998224725', aceite: true, assinatura: SIG }, { ip: '200.1.2.3', ua: 'iPhone' });
  assert.ok(ok.ok);
  const pdf = fs.readFileSync(closing.termPath(f));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.includes(Buffer.from('/Subtype /Image')));
  assert.ok(sent[0]?.media?.path.endsWith('.pdf'));
  assert.match(sent[0].text, /Termo assinado/);
  assert.equal(closing.publicTerm(f.id, tt).status, 'assinado');
  assert.ok(admins.some((a) => a.includes('Termo da reserva assinado')));
});

test('termo só depois do pagamento, quando configurado assim', async () => {
  const { closing, payments, lead, sent } = setup({ termAfter: 'payment' });
  const f = closing.createForm({ convKey: lead.conversationKey, lead });
  await closing.submitForm(f.id, closing.token(f.id), DATA);
  await flush(sent, 5);
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(!sent.some((m) => /termo/.test(m.text || '')));
  await payments.confirm(f.paymentId, { by: 'Marcos' });
  assert.ok(sent.some((m) => /termo da sua reserva/.test(m.text || '')));
});

test('PDF: lê o tamanho do JPEG da assinatura', () => {
  assert.deepEqual(jpegSize(Buffer.from(SIG.split(',')[1], 'base64')), { width: 1, height: 1 });
});

test('ordem do Marcos: depois da ficha vai o contrato; o Pix só sai depois da assinatura e o termo é dispensado', async () => {
  const { Closing } = await import('../src/closing.js');
  const { tempStore: ts } = await import('./helpers.js');
  const store = ts();
  store.updateSettings({ payments: { enabled: true, pixKey: '12345678000190', reservation: { base: 1000, perAdult: 800 } }, closing: { enabled: true } });
  const said = [];
  const created = [];
  const payments = {
    reservationAmount: (n) => 1000 + 800 * n,
    create: async (x) => { const p = { id: 'p1', ...x }; created.push(p); return p; },
    sendCharge: async () => said.push('[qr]'),
    get: () => null,
  };
  const closing = new Closing({ store, crm: { leads: [], notify() {}, addNote() {} }, payments, sendTo: async (_k, { text }) => said.push(text), remember() {}, notifyAdmins: async () => {}, notify() {}, secret: 's', dataDir: store.dataDir, baseUrl: () => 'https://x.test' });
  const f = { id: 'f1', convKey: 'k', leadId: null, status: 'preenchida', data: { nome: 'Luiza Souza', cpf: '529.982.247-25', adultos: '2', whatsapp: '5545988887777' } };
  closing.list.push(f);
  // Contrato enviado: nada de Pix agora.
  closing.onFilled = async () => ({ contractSent: true });
  await closing.afterForm(f);
  assert.equal(f.viaContract, true);
  assert.equal(created.length, 0, 'nenhum Pix antes da assinatura');
  assert.equal(f.term, undefined, 'e o termo da reserva é dispensado');
  // Assinou: o servidor chama o Pix (uma vez só).
  await closing.sendReservationPix(f, { intro: 'Agora o último passo: para garantir a sua reserva' });
  await closing.sendReservationPix(f);
  assert.equal(created.length, 1);
  assert.equal(created[0].amount, 2600);
  assert.ok(said.some((t) => /Agora o último passo: para garantir a sua reserva, segue o Pix de R\$ 2\.600,00/.test(t)));
  assert.ok(said.some((t) => /Se preferir pagar no cartão de crédito/.test(t)));
  // Sem contrato possível (sem endereço público ou sem orçamento): segue o caminho antigo, com o Pix logo.
  const g = { id: 'f2', convKey: 'k2', leadId: null, status: 'preenchida', data: { nome: 'João Pereira', cpf: '529.982.247-25', adultos: '1', whatsapp: '5545988880000' } };
  closing.list.push(g);
  closing.onFilled = async () => null;
  await closing.afterForm(g);
  assert.equal(created.length, 2, 'fallback: Pix logo depois da ficha');
});
