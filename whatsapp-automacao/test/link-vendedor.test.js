import test from 'node:test';
import assert from 'node:assert/strict';
import { sellerWaLink, nextLinkAction, remindText, LINK_TIMES } from '../src/seller-link.js';
import { Auth } from '../src/auth.js';
import { Crm } from '../src/crm.js';
import { Sectors } from '../src/sectors.js';
import { centralNote } from '../src/agent/central.js';
import { tempStore } from './helpers.js';

const T0 = new Date('2026-11-12T13:00:00Z').getTime();
const at = (min) => T0 + min * 60_000;
const h = (extra = {}) => ({ linkAt: new Date(T0).toISOString(), ...extra });

test('link abre o WhatsApp do vendedor com a mensagem pronta e o código do cliente', () => {
  const l = sellerWaLink({ sellerPhone: '+595 981 000 001', sellerName: 'Giovana Silva', code: 'MIG-1234' });
  assert.match(l, /^https:\/\/wa\.me\/595981000001\?text=/);
  assert.equal(decodeURIComponent(l.split('text=')[1]), 'Olá Giovana, vim pela Central da Migra. Meu código é MIG-1234.');
  assert.equal(sellerWaLink({ sellerPhone: '' }), '');
});

test('tempos da retomada: 15 min lembrete, 60 min aviso ao vendedor, 20 h último lembrete, nada depois de 24 h', () => {
  assert.equal(LINK_TIMES.remind1Min, 15);
  assert.equal(nextLinkAction(h(), { now: at(10) }), '');
  assert.equal(nextLinkAction(h(), { now: at(16) }), 'remind1');
  assert.equal(nextLinkAction(h({ remind1At: 'x' }), { now: at(40) }), '');
  assert.equal(nextLinkAction(h({ remind1At: 'x' }), { now: at(61) }), 'sellerAlert');
  assert.equal(nextLinkAction(h({ remind1At: 'x', sellerAlertAt: 'x' }), { now: at(5 * 60) }), '');
  assert.equal(nextLinkAction(h({ remind1At: 'x', sellerAlertAt: 'x' }), { now: at(20 * 60 + 1) }), 'remind2');
  assert.equal(nextLinkAction(h({ remind1At: 'x', sellerAlertAt: 'x', remind2At: 'x' }), { now: at(22 * 60) }), '', 'no máximo 2 lembretes');
  assert.equal(nextLinkAction(h(), { now: at(24 * 60) }), '', 'janela de 24 h fechada: não manda mais nada');
});

test('o cliente chamou o vendedor: nenhum lembrete nem aviso', () => {
  assert.equal(nextLinkAction(h({ arrivedAt: 'x' }), { now: at(16) }), '');
  assert.equal(nextLinkAction(h({ arrivedAt: 'x' }), { now: at(61) }), '');
});

test('fora do horário comercial: lembrete ao cliente espera; aviso ao vendedor sai (é para a equipe)', () => {
  assert.equal(nextLinkAction(h(), { now: at(16), inHours: false }), '');
  assert.equal(nextLinkAction(h({ remind1At: 'x' }), { now: at(61), inHours: false }), 'sellerAlert');
  assert.equal(nextLinkAction(h({ remind1At: 'x', sellerAlertAt: 'x' }), { now: at(20 * 60 + 1), inHours: false }), '');
});

test('textos dos lembretes levam o link', () => {
  assert.match(remindText('Giovana', 'https://wa.me/1'), /Giovana já está te esperando.*https:\/\/wa\.me\/1/);
  assert.match(remindText('Giovana', 'https://wa.me/1', true), /continua à disposição.*https:\/\/wa\.me\/1/);
});

test('imóvel pela Central no modo link: o cliente recebe o link do corretor; a IA do corretor não puxa conversa', async () => {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  auth.create({ name: 'Diego Corretor', login: 'diego', password: 'segredo123', role: 'seller', whatsapp: '595981000002', sectors: ['loteamentos'] });
  const crm = new Crm({ store, auth });
  const sent = [];
  const sectors = new Sectors({ store, crm, auth, send: async (p, t) => sent.push(t) });
  let aiStarted = false;
  sectors.aiLineFor = () => ({ id: 'l1', label: 'Diego' });
  sectors.startOnLine = async () => { aiStarted = true; };
  sectors.linkFor = ({ person, lead }) => sellerWaLink({ sellerPhone: person.whatsapp, sellerName: person.name, code: lead.code });
  const conv = { key: 'l:central:5511911112222@s.whatsapp.net', phone: '5511911112222', name: 'Paula', messages: [{ role: 'user', content: 'quero um lote' }] };
  const r = await sectors.route(conv, { setor: 'loteamentos', resumo: 'quer lote' });
  assert.match(r.instrucao, /https:\/\/wa\.me\/595981000002/);
  assert.equal(aiStarted, false);
  assert.match(sent[0], /O cliente recebeu o link para te chamar/);
  const lead = crm.findForConversation({ key: conv.key, phone: conv.phone });
  assert.ok(lead.handoff.linkAt && lead.handoff.link);
});

test('orientação da Central no modo link: passa o link exatamente como veio', () => {
  assert.match(centralNote({ linkMode: true }), /LINK do consultor exatamente como veio/);
});
