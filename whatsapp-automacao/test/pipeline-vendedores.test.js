import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSellerOf, stageOf, buildSellerPipeline } from '../src/seller-pipeline.js';

const users = [{ id: 'u1', name: 'Giovana', role: 'seller', receivesLeads: true }, { id: 'u2', name: 'Eliezer', role: 'seller', receivesLeads: true }, { id: 'u3', name: 'Marcos', role: 'admin' }];
const auth = { get: (id) => users.find((u) => u.id === id) || null };
const lineOwnerOf = (key) => (String(key).startsWith('l:fran:') ? { ownerId: 'u2' } : null);
const sellerOf = makeSellerOf({ auth, lineOwnerOf });

test('de quem é o cliente: dono do prospecto, depois dono do WhatsApp por onde chegou, depois quem recebeu a passagem, depois quem fez o orçamento', () => {
  assert.equal(sellerOf({ lead: { ownerId: 'u1' }, convKey: 'l:fran:55@s' }).name, 'Giovana');
  assert.equal(sellerOf({ lead: {}, convKey: 'l:fran:55@s.whatsapp.net' }).name, 'Eliezer');
  assert.equal(sellerOf({ lead: { handoff: { toId: 'u1' } }, convKey: '55@s.whatsapp.net' }).name, 'Giovana');
  assert.equal(sellerOf({ lead: {}, quote: { createdBy: { id: 'u3' } } }).name, 'Marcos');
  assert.equal(sellerOf({ lead: {}, convKey: '55@s.whatsapp.net' }), null, 'sem nenhum vínculo: ainda sem vendedor');
});

test('etapa de cada cliente: atendendo, orçamento, ficha, contrato, comprovante, fechou, não fechou, retornar', () => {
  const q = { number: 'ORC-1', contract: {} };
  assert.equal(stageOf({ lead: { stage: 'em_contato' }, quote: null, form: null, payments: [] }), 'atendendo');
  assert.equal(stageOf({ lead: { stage: 'proposta' }, quote: q, form: null, payments: [] }), 'orcamento');
  assert.equal(stageOf({ lead: {}, quote: q, form: { status: 'preenchida' }, payments: [] }), 'ficha');
  assert.equal(stageOf({ lead: {}, quote: { ...q, contract: { status: 'assinado' } }, form: { status: 'preenchida' }, payments: [] }), 'contrato');
  assert.equal(stageOf({ lead: {}, quote: q, form: null, payments: [{ status: 'pending', receipt: { ref: 'x' } }] }), 'comprovante');
  assert.equal(stageOf({ lead: {}, quote: q, form: null, payments: [{ status: 'paid' }] }), 'fechou');
  assert.equal(stageOf({ lead: { stage: 'ganho' }, quote: null, form: null, payments: [] }), 'fechou');
  assert.equal(stageOf({ lead: { stage: 'perdido' }, quote: q, form: null, payments: [] }), 'nao_fechou');
  assert.equal(stageOf({ lead: { stage: 'aguardando' }, quote: null, form: null, payments: [] }), 'retornar');
  assert.equal(stageOf({ lead: {}, quote: q, form: null, payments: [{ status: 'paid', purpose: 'plano_pdf' }] }), 'orcamento', 'plano em PDF não conta como fechamento da assessoria');
});

test('pipeline por vendedor: cada um vê os seus; o administrador vê todos; cliente sem vendedor aparece à parte', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  const L = (id, name, extra = {}) => ({ id, name, phone: `5511${id}`, stage: 'em_contato', updatedAt: '2026-11-08T10:00:00Z', ...extra });
  const leads = [L('1', 'Ana', { ownerId: 'u1' }), L('2', 'Bia', { ownerId: 'u1' }), L('3', 'Caio', { ownerId: 'u2', conversationKey: 'k3' }), L('4', 'Davi', { conversationKey: 'k4' })];
  const quotes = [{ id: 'q1', number: 'ORC-1', leadId: '2', createdAt: '2026-11-07T10:00:00Z', plan: { total: 12997 } }, { id: 'q3', number: 'ORC-3', leadId: '3', convKey: 'k3', createdAt: '2026-11-07T10:00:00Z', plan: { total: 8000 } }];
  const payments = [{ status: 'paid', leadId: '3' }];
  const all = buildSellerPipeline({ leads, quotes, payments, users, sellerOf, viewer: { role: 'admin' }, now });
  const g = all.sellers.find((s) => s.name === 'Giovana');
  assert.deepEqual([g.total, g.counts.atendendo, g.counts.orcamento], [2, 1, 1]);
  const e = all.sellers.find((s) => s.name === 'Eliezer');
  assert.equal(e.counts.fechou, 1);
  assert.equal(e.taxaFechamento, 100, 'fechou 1 de 1 que recebeu orçamento');
  const sem = all.sellers.find((s) => s.id === 'none');
  assert.equal(sem.total, 1);
  assert.equal(all.columns.length, 8);
  const minha = buildSellerPipeline({ leads, quotes, payments, users, sellerOf, viewer: { role: 'seller', id: 'u1' }, now });
  assert.deepEqual(minha.sellers.filter((s) => s.total > 0).map((s) => s.name), ['Giovana'], 'vendedor só vê os dele');
});

import { Payments } from '../src/payments.js';
import { tempStore } from './helpers.js';

test('aviso de venda fechada ao Marcos diz quem atendeu o cliente (ou que ainda não tem vendedor)', async () => {
  const store = tempStore();
  store.updateSettings({ payments: { enabled: true, pixKey: '12345678000190', receiverName: 'Migra', receiverCity: 'Ciudad del Este', reservation: { base: 1000, perAdult: 800 } } });
  const crm = { leads: [], update() {}, addNote() {}, ownerName: () => '' };
  const notices = [];
  const pay = new Payments({ store, crm, dataDir: store.dataDir, secret: 's', sendTo: async () => {}, notifyAdmins: async (t) => notices.push(t), notify() {} });
  pay.sellerOf = (p) => (p.convKey === 'l:fran:55@s.whatsapp.net' ? { id: 'u2', name: 'Eliezer' } : null);
  const a = await pay.create({ convKey: 'l:fran:55@s.whatsapp.net', amount: 1800, description: 'reserva', payerName: 'Carla' });
  await pay.confirm(a.id, { by: 'Administrador' });
  const b = await pay.create({ convKey: 'x@s.whatsapp.net', amount: 1800, description: 'reserva', payerName: 'Davi' });
  await pay.confirm(b.id, { by: 'Administrador' });
  assert.match(notices[0], /Quem atendeu: Eliezer/);
  assert.match(notices[1], /Quem atendeu: ainda sem vendedor/);
});
