import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withBrazil55, isBrazilLocal } from '../src/utils.js';
import { fixValue, fixPhones } from '../src/phone-fix.js';
import { Store } from '../src/store.js';
import { Quotes } from '../src/quotes.js';
import { Closing } from '../src/closing.js';
import { Auth } from '../src/auth.js';
import { Crm } from '../src/crm.js';
import { Payments } from '../src/payments.js';
import { presetSettings } from '../src/agent/presets.js';
import { tempStore } from './helpers.js';

test('regra: DDD + número do Brasil ganha o 55; com +, com 55, de outro país ou incompleto não muda', () => {
  assert.equal(withBrazil55('45 99999-0000'), '5545999990000');
  assert.equal(withBrazil55('(45) 99999-0000'), '5545999990000');
  assert.equal(withBrazil55('045 99999-0000'), '5545999990000', 'zero na frente do DDD');
  assert.equal(withBrazil55('45 3333-4444'), '554533334444', 'fixo');
  assert.equal(withBrazil55('+55 45 99999-0000'), '5545999990000');
  assert.equal(withBrazil55('5545999990000'), '5545999990000', 'já tem 55');
  assert.equal(withBrazil55('+595 981 123456'), '595981123456', 'Paraguai com +');
  assert.equal(withBrazil55('595981123456'), '595981123456', 'Paraguai sem +, 12 dígitos: não é número local');
  assert.equal(withBrazil55('981123456'), '981123456', 'só 9 dígitos: não dá para saber');
  assert.equal(withBrazil55('+1 415 555 0123'), '14155550123', 'EUA com +');
  assert.equal(withBrazil55('2025550123'), '2025550123', 'DDD que não existe no Brasil (20): não mexe');
  assert.equal(withBrazil55(''), '');
  assert.equal(isBrazilLocal('45999990000'), true);
  assert.equal(isBrazilLocal('45899990000'), false, '11 dígitos precisam do 9 do celular');
});

test('correção dos cadastros: só o que é claramente brasileiro, mostra antes e depois, e rodar de novo não muda mais nada', () => {
  assert.equal(fixValue('45999990000'), '5545999990000');
  assert.equal(fixValue('45999990000', { plus: true }), '+5545999990000');
  assert.equal(fixValue('5545999990000'), null);
  assert.equal(fixValue('+595981123456'), null);
  assert.equal(fixValue(''), null);
  const store = tempStore();
  store.data.leads = [{ id: 'l1', name: 'Ana', phone: '45999990000' }, { id: 'l2', name: 'Ok', phone: '5545999990000' }, { id: 'l3', name: 'Py', phone: '595981123456' }];
  store.data.quotes = [{ number: 'ORC-1', phone: '11988887777', contract: { client: { nome: 'Ana', whatsapp: '11 98888-7777' } } }];
  store.data.sales = [{ number: 'V-1', client: { nome: 'Bia', phone: '21977776666' } }];
  store.data.closing = [{ id: 'f1', data: { whatsapp: '(41) 99999-1111' } }];
  store.data.conversations = { c1: { key: 'c1', phone: '45999990000' }, c2: { key: 'ig:1', phone: null } };
  store.data.legacyContracts = [{ number: '9', phone: '45988880000' }];
  const dry = fixPhones(store, { dryRun: true });
  assert.equal(dry.count, 7);
  assert.equal(store.data.leads[0].phone, '45999990000', 'dryRun não muda');
  const r = fixPhones(store);
  assert.equal(r.count, 7);
  assert.equal(store.data.leads[0].phone, '5545999990000');
  assert.equal(store.data.leads[2].phone, '595981123456');
  assert.equal(store.data.quotes[0].phone, '5511988887777');
  assert.equal(store.data.quotes[0].contract.client.whatsapp, '+5511988887777');
  assert.equal(store.data.sales[0].client.phone, '5521977776666');
  assert.equal(store.data.closing[0].data.whatsapp, '+5541999991111');
  assert.equal(store.data.conversations.c1.phone, '5545999990000');
  assert.equal(store.data.legacyContracts[0].phone, '5545988880000');
  assert.ok(store.data.phoneFixLog.at(-1).changes.every((c) => c.from && c.to && c.where), 'cada mudança fica registrada com antes e depois');
  assert.equal(fixPhones(store).count, 0, 'rodar de novo não muda nada');
});

test('ao iniciar o sistema: a correção roda uma vez sozinha', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-tel-'));
  const a = new Store(dir);
  a.data.leads = [{ id: 'l1', name: 'Ana', phone: '45999990000' }];
  a.data.phones55_2026 = false;
  a.flush();
  const b = new Store(dir);
  assert.equal(b.data.leads[0].phone, '5545999990000');
  assert.equal(b.data.phones55_2026, true);
  assert.ok(b.data.logs.some((l) => /ganharam o prefixo \+55/.test(l.message)));
});

test('orçamento novo guarda o telefone com 55', () => {
  const store = tempStore();
  store.updateSettings(presetSettings('migra-paraguai'));
  const quotes = new Quotes({ store, dataDir: store.dataDir, secret: 's', matchPackage: () => ({ name: 'Pacote Ouro', price: 12997 }) });
  const q = quotes.create({ items: [{ pacote: 'Ouro', quantidade: 1 }], adults: 1, client: 'Ana', phone: '45 99999-0000', start: '2026-10-29' });
  assert.equal(q.phone, '5545999990000');
  assert.equal(quotes.create({ items: [{ pacote: 'Ouro', quantidade: 1 }], adults: 1, client: 'Py', phone: '+595 981 123456', start: '2026-10-29' }).phone, '595981123456');
});

test('ficha de cadastro: já vem com +55 e o WhatsApp digitado só com DDD fica com +55; "+55" sozinho conta como vazio', async () => {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  auth.create({ name: 'Marcos', login: 'marcos', password: 'segredo123', role: 'admin' });
  const crm = new Crm({ store, auth });
  store.updateSettings({ payments: { pixKey: '12345678000190', receiverName: 'Migra', receiverCity: 'CDE', company: { name: 'Migra' } }, crm: { panelUrl: 'https://p.migra.com' } });
  const sendTo = async () => {};
  const payments = new Payments({ store, crm, dataDir: store.dataDir, secret: 'x', sendTo, notifyAdmins: async () => {} });
  const closing = new Closing({ store, crm, payments, secret: 'x', dataDir: store.dataDir, sendTo, notifyAdmins: async () => {}, remember: () => {}, baseUrl: () => 'https://p.migra.com' });
  const semFone = crm.ensureFromConversation({ key: 'ig:5', username: 'tati', name: 'Tatiane Costa', channel: 'instagram' });
  const f = closing.createForm({ convKey: 'ig:5', lead: semFone });
  assert.equal(closing.publicForm(f.id, closing.token(f.id)).data.whatsapp, '+55 ', 'sem telefone conhecido, já vem com o +55 do Brasil');
  const DATA = { nome: 'Tatiane Costa', cpf: '529.982.247-25', rg: '1', rgOrgao: 'SSP/SP', nascimento: '10/05/1960', nacionalidade: 'Brasileira', estadoCivil: 'Casado(a)', cep: '01310-100', rua: 'Av. A', numero: '1', bairro: 'B', cidade: 'C', uf: 'sp', adultos: '1' };
  await assert.rejects(closing.submitForm(f.id, closing.token(f.id), { ...DATA, whatsapp: '+55 ' }), /WhatsApp/);
  await closing.submitForm(f.id, closing.token(f.id), { ...DATA, whatsapp: '(45) 99999-0000' });
  assert.equal(f.data.whatsapp, '+5545999990000');
  const comFone = crm.ensureFromConversation({ key: '5511987654321@s.whatsapp.net', phone: '5511987654321', name: 'Ana Souza', channel: 'whatsapp' });
  const g = closing.createForm({ convKey: comFone.conversationKey, lead: comFone });
  assert.equal(closing.publicForm(g.id, closing.token(g.id)).data.whatsapp, '+5511987654321');
});
