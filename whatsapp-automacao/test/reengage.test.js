import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Crm } from '../src/crm.js';
import { Reengage, rowsFrom, guessSource } from '../src/reengage.js';
import { tempStore } from './helpers.js';

function setup({ hour = 10 } = {}) {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  auth.create({ name: 'Marcos', login: 'marcos', password: 'segredo123', role: 'admin' });
  const crm = new Crm({ store, auth });
  const agent = {
    conversation(key) { store.data.conversations[key] ||= { key, phone: null, name: '', messages: [], updatedAt: new Date().toISOString() }; return store.data.conversations[key]; },
    remember(conv, role, content) { conv.messages.push({ role, content, at: new Date().toISOString() }); conv.updatedAt = new Date().toISOString(); },
  };
  const sent = [];
  const d = new Date(); d.setHours(hour, 0, 0, 0);
  const r = new Reengage({ store, crm, agent, send: async (to, p) => { if (to === '595981000009') throw new Error('falha simulada'); sent.push({ to, text: p.text }); }, now: () => d.getTime() });
  assert.equal(r.config.perDay, 30);
  assert.deepEqual([r.config.minDelayMs, r.config.maxDelayMs], [30_000, 65_000]);
  store.updateSettings({ reengage: { perDay: 3 } });
  return { store, crm, agent, r, sent };
}
const csv = 'Nome;WhatsApp;E-mail;Origem\nAna Souza;+55 11 98765-4321;ana@x.com;Instagram\nBeto;+595 981 000001;;Facebook\nCaio;;caio@x.com;site\nDora;+595 981 000002;;Grupo VIP\nEva;+595 981 000003;;Quiz';

test('lê planilha e captura: telefone, nome, e-mail e origem', () => {
  const rows = rowsFrom(csv);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((x) => x.source), ['instagram', 'facebook', 'site', 'grupo', 'quiz']);
  assert.equal(rows[0].phone, '5511987654321');
  const cap = rowsFrom({ pages: [{ url: '/leads-instagram', tables: [{ headers: ['Nome', 'Telefone'], rows: [['Fulano', '+595 981 123456']] }], fields: [] }], api: [{ url: '/api/leads-facebook', json: [{ nome: 'Ciclano', celular: '595981777777', e_mail: 'c@x' }] }] });
  assert.deepEqual(cap.map((x) => [x.name, x.source]), [['Ciclano', 'facebook'], ['Fulano', 'instagram']]);
  assert.equal(guessSource('Meta Ads'), 'facebook');
  assert.equal(rowsFrom(csv, { source: 'quiz' }).every((x) => x.source === 'quiz'), true);
});

test('cruza com o WhatsApp e o CRM: quem já falou não recebe; grupo e "não incomodar" ficam de fora', () => {
  const { store, crm, agent, r } = setup();
  agent.remember(agent.conversation('5511987654321@s.whatsapp.net'), 'user', 'oi');
  store.data.conversations['5511987654321@s.whatsapp.net'].phone = '5511987654321';
  crm.create({ name: 'Marcos', role: 'admin' }, { name: 'Beto', phone: '595981000001', stage: 'em_contato' });
  store.addToBlacklist('595981000003');
  const stats = r.import(rowsFrom(csv));
  assert.deepEqual(stats, { lidas: 5, novos: 1, jaAtendidos: 2, grupo: 1, semTelefone: 1, repetidos: 0, naoIncomodar: 1 });
  assert.deepEqual(r.list({ status: 'novo' }).map((c) => c.name), ['Dora']);
  assert.match(r.list({ status: 'novo' })[0].hold, /grupo/i);
  assert.equal(r.import(rowsFrom(csv)).repetidos, 4, 'importar de novo não duplica');
});

test('envio: só aprovados, mensagem do canal com o nome, conversa e prospecto criados, limite diário e horário', async () => {
  const { store, crm, r, sent } = setup();
  r.import(rowsFrom('Nome;Telefone;Origem\nAna;+595981000010;Instagram\nBeto;+595981000011;Instagram\nCaio;+595981000012;Instagram\nDora;+595981000013;Facebook'));
  const ids = r.list({ status: 'novo' }).map((c) => c.id);
  const sleeps = [];
  const run = await r.sendApproved(ids, { sleep: async (ms) => sleeps.push(ms), delay: () => 30_000 });
  assert.equal(run.sent, 3, 'limite do dia (3)');
  assert.equal(sleeps.length, 2);
  assert.match(sent[0].text, /^Oi, Ana! Vi que você entrou em contato com a gente lá no Instagram da Migra, para ver a possibilidade de migrar para o Paraguai\. O nosso Instagram está com um probleminha/);
  assert.match(sent[0].text, /Podemos dar continuidade ao seu atendimento por aqui\?/);
  assert.match(sent[0].text, /é só me avisar que eu paro/);
  assert.equal(store.data.conversations['595981000010@s.whatsapp.net'].messages[0].role, 'assistant');
  const lead = crm.leads.find((l) => l.phone === '595981000010');
  assert.equal(lead.source, 'instagram');
  assert.equal(r.summary().enviado, 3);
  await assert.rejects(r.sendApproved(ids, { sleep: async () => {} }), /limite de hoje/);
  // respondeu
  store.data.conversations['595981000010@s.whatsapp.net'].messages.push({ role: 'user', content: 'Oi, quero sim', at: new Date(Date.now() + 5000).toISOString() });
  assert.equal(r.summary().respondeu, 1);
});

test('fora do horário não envia; falha de um contato não derruba os outros; "não incomodar" entra na lista de bloqueio', async () => {
  const night = setup({ hour: 23 });
  night.r.import(rowsFrom('Nome;Telefone;Origem\nAna;+595981000010;Instagram'));
  await assert.rejects(night.r.sendApproved(night.r.list({ status: 'novo' }).map((c) => c.id), { sleep: async () => {} }), /entre 8h e 20h/);
  const { r, sent, store } = setup();
  r.import(rowsFrom('Nome;Telefone;Origem\nAna;+595981000009;Instagram\nBeto;+595981000011;Instagram\nCaio;+595981000012;Site'));
  const all = r.list({ status: 'novo' });
  const run = await r.sendApproved(all.map((c) => c.id), { sleep: async () => {} });
  assert.deepEqual([run.sent, run.failed], [2, 1]);
  assert.equal(sent.length, 2);
  const c = r.list({ source: 'site' })[0];
  assert.match(sent.at(-1).text, /se cadastrou no site da Migra/);
  const again = setup();
  again.r.import(rowsFrom('Nome;Telefone;Origem\nZé;+595981000020;Instagram'));
  const z = again.r.list()[0];
  again.r.mark(z.id, 'nao_incomodar');
  assert.ok(again.store.isBlacklisted('595981000020'));
  await assert.rejects(again.r.sendApproved([z.id], { sleep: async () => {} }), /Nenhum contato novo/);
  void c; void store;
});
