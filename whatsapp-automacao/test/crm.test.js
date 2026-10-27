import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Auth, checkPassword, hashPassword } from '../src/auth.js';
import { Crm, addDays } from '../src/crm.js';
import { CrmAi, parseJsonObject } from '../src/crm-ai.js';
import { tempStore } from './helpers.js';

const NOW = new Date(2026, 9, 27, 10, 0); // 27/10/2026

function setup() {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const admin = auth.get(auth.create({ name: 'Marcos', login: 'marcos', password: 'segredo123', role: 'admin' }).id);
  const ana = auth.get(auth.create({ name: 'Ana', login: 'ana', password: 'ana12345', whatsapp: '11 98765-4321' }).id);
  const bia = auth.get(auth.create({ name: 'Bia', login: 'bia', password: 'bia12345' }).id);
  const crm = new Crm({ store, auth, now: () => NOW });
  return { store, auth, crm, admin, ana, bia };
}

test('senha com scrypt e cookie de sessão assinado', () => {
  const h = hashPassword('minha-senha');
  assert.ok(checkPassword('minha-senha', h));
  assert.ok(!checkPassword('outra', h));
  const { auth, ana } = setup();
  const cookie = auth.sessionCookie(ana).split(';')[0];
  assert.equal(auth.fromRequest({ headers: { cookie } }).id, ana.id);
  assert.equal(auth.fromRequest({ headers: { cookie: cookie.slice(0, -2) + 'xx' } }), null); // adulterado
  auth.update(ana.id, { active: false });
  assert.equal(auth.fromRequest({ headers: { cookie } }), null); // vendedor desativado sai na hora
});

test('nunca fica sem administrador', () => {
  const { auth, admin } = setup();
  assert.throws(() => auth.update(admin.id, { role: 'seller' }), /pelo menos um administrador/);
  assert.equal(auth.get(admin.id).role, 'admin');
});

test('vendedor vê só os seus e os sem dono; valor estimado pelo pacote x pessoas', () => {
  const { crm, admin, ana, bia } = setup();
  const a = crm.create(ana, { name: 'João', phone: '11 91234-5678', interest: 'Pacote Ouro', people: 2 });
  crm.create(bia, { name: 'Maria', phone: '11 92222-3333' });
  crm.create(admin, { name: 'Sem dono', phone: '11 93333-4444' });
  assert.equal(a.value, 25994);
  assert.equal(a.ownerId, ana.id);
  assert.deepEqual(crm.list(ana).map((l) => l.name).sort(), ['João', 'Sem dono']);
  assert.equal(crm.list(admin).length, 3);
  const maria = crm.leads.find((l) => l.name === 'Maria');
  assert.throws(() => crm.get(ana, maria.id), /outro vendedor/);
});

test('retorno agendado (até anos depois), aviso no dia e agenda do vendedor', () => {
  const { crm, ana } = setup();
  const l = crm.create(ana, { name: 'Pedro', phone: '11 94444-5555' });
  crm.followUp(ana, l.id, { date: '2028-03-01', reason: 'Quer ir depois que o filho terminar a escola' });
  const lead = crm.leads.find((x) => x.id === l.id);
  assert.equal(lead.stage, 'aguardando');
  assert.equal(crm.agenda(ana).futuros.length, 1);
  assert.equal(crm.dueToNotify().length, 0);
  crm.followUp(ana, l.id, { date: '2026-10-27', reason: 'Recebe o salário hoje' });
  assert.equal(crm.agenda(ana).hoje.length, 1);
  assert.equal(crm.dueToNotify().length, 1);
  crm.markNotified(lead);
  assert.equal(crm.dueToNotify().length, 0); // avisa uma vez só
  assert.match(lead.timeline.map((t) => t.text).join('\n'), /01\/03\/2028.*escola[\s\S]*27\/10\/2026/);
});

test('etapas exigem motivo/data; fechado guarda valor; vendedor saiu: carteira transferida', () => {
  const { crm, admin, ana, bia } = setup();
  const l = crm.create(ana, { name: 'Carla', phone: '11 95555-6666', interest: 'Pacote Prata' });
  assert.throws(() => crm.update(ana, l.id, { stage: 'perdido' }), /por que/);
  assert.throws(() => crm.update(ana, l.id, { stage: 'aguardando' }), /data do retorno/);
  crm.update(ana, l.id, { stage: 'ganho' });
  assert.equal(crm.leads.find((x) => x.id === l.id).closedValue, 11997);
  const open = crm.create(ana, { name: 'Davi', phone: '11 96666-7777' });
  assert.throws(() => crm.transfer(ana, ana.id, bia.id), /administrador/);
  assert.deepEqual(crm.transfer(admin, ana.id, bia.id), { transferred: 1 }); // só os em aberto
  assert.equal(crm.leads.find((x) => x.id === open.id).ownerId, bia.id);
  assert.equal(crm.leads.find((x) => x.id === l.id).ownerId, ana.id); // fechado continua com quem vendeu
});

test('mensagem de cliente vira prospecto (sem duplicar) e rodízio entre vendedores', () => {
  const { store, crm } = setup();
  const a = crm.ensureFromConversation({ key: 'j1@s.whatsapp.net', phone: '5511900000001', name: 'Lia', channel: 'whatsapp' });
  const b = crm.ensureFromConversation({ key: 'j1@s.whatsapp.net', phone: '5511900000001', name: 'Lia' });
  assert.equal(a.id, b.id);
  assert.equal(a.ownerId, null); // padrão: fica para a equipe
  store.updateSettings({ crm: { autoAssign: 'roundrobin' } });
  const c = crm.ensureFromConversation({ key: 'ig:1', username: 'cliente.um', channel: 'instagram' });
  const d = crm.ensureFromConversation({ key: 'ig:2', username: 'cliente.dois', channel: 'instagram' });
  assert.notEqual(c.ownerId, d.ownerId);
  assert.equal(c.instagram, 'cliente.um');
  assert.equal(crm.ensureFromConversation({ key: 'sim:teste' }), null); // simulador não vira prospecto
});

test('IA preenche só o que está vazio e agenda o retorno que o cliente pediu', async () => {
  const { store, crm, ana } = setup();
  const lead = crm.ensureFromConversation({ key: 'k', phone: '5511900000009', channel: 'whatsapp' });
  crm.update(ana, lead.id, { name: 'Nome digitado pelo vendedor' });
  const llm = {
    configured: true,
    chat: async () => ({ content: 'Claro! {"nome":"Outro Nome","cidade":"Curitiba","objetivo":"morar","pacote":"Pacote Ouro","pessoas":3,"etapa":"proposta","retorno_data":"2026-11-15","motivo_espera":"Aguardando o 13º","resumo":"Quer o Pacote Ouro para 3 pessoas; decide em 15/11."}' }),
  };
  const ai = new CrmAi({ store, llm, crm, now: () => NOW });
  const conv = { key: 'k', phone: '5511900000009', messages: [{ role: 'user', content: 'vou decidir dia 15 de novembro' }] };
  await ai.afterReply(conv);
  const l = crm.leads.find((x) => x.id === lead.id);
  assert.equal(l.name, 'Nome digitado pelo vendedor');
  assert.equal(l.city, 'Curitiba');
  assert.equal(l.interest, 'Pacote Ouro');
  assert.equal(l.people, 3);
  assert.equal(l.value, 12997 * 3);
  assert.equal(l.stage, 'aguardando');
  assert.equal(l.followUpAt, '2026-11-15');
  assert.match(l.aiSummary, /15\/11/);
  assert.equal(await ai.afterReply(conv), null); // intervalo entre leituras
});

test('números do painel: conversão, retornos, por vendedor e motivos', () => {
  const { crm, admin, ana } = setup();
  const a = crm.create(ana, { name: 'A', phone: '11 90000-0001', interest: 'Pacote Ouro' });
  const b = crm.create(ana, { name: 'B', phone: '11 90000-0002' });
  const c = crm.create(ana, { name: 'C', phone: '11 90000-0003' });
  crm.update(ana, a.id, { stage: 'ganho' });
  crm.update(ana, b.id, { stage: 'perdido', lostReason: 'Achou caro' });
  crm.followUp(ana, c.id, { date: addDays('2026-10-27', -2), reason: 'Sem dinheiro agora' });
  const s = crm.stats({});
  assert.equal(s.won, 1);
  assert.equal(s.wonValue, 12997);
  assert.equal(s.conversion, 50);
  assert.equal(s.followUps.overdue, 1);
  assert.deepEqual(s.lostReasons, [{ label: 'achou caro', count: 1 }]);
  assert.equal(s.bySeller.find((r) => r.name === 'Ana').overdue, 1);
  assert.ok(s.months.length === 6);
  assert.equal(crm.stats({ ownerId: admin.id }).won, 0);
});

test('parseJsonObject tolera texto em volta', () => {
  assert.deepEqual(parseJsonObject('ok\n{"a":1}\nfim'), { a: 1 });
  assert.equal(parseJsonObject('sem json'), null);
});
