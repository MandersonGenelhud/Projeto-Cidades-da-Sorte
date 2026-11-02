import test from 'node:test';
import assert from 'node:assert/strict';
import { byAttendant } from '../src/attendants.js';

const users = [{ id: 'm', name: 'Marcos', role: 'admin' }, { id: 'f', name: 'Fran', role: 'seller' }, { id: 'e', name: 'Eliezer', role: 'seller' }];
const conv = (key, extra = {}) => ({ key, name: key, updatedAt: '2026-11-01T10:00:00Z', count: 2, last: { role: 'user', content: 'oi' }, ...extra });
const leads = [
  { id: 1, ownerId: 'f', stage: 'ganho', closedValue: 1000, source: 'instagram' },
  { id: 2, ownerId: 'f', stage: 'proposta', source: 'whatsapp' },
  { id: 3, ownerId: 'e', stage: 'novo', source: 'instagram_ads' },
  { id: 4, ownerId: null, stage: 'perdido', source: 'instagram' },
];

test('separa conversas e funil por atendente, com canais sem dono e origem dos clientes', () => {
  const lineOwner = (k) => (k.startsWith('line:f') ? { ownerId: 'f', label: 'Fran' } : k.startsWith('line:e') ? { ownerId: 'e', label: 'Eliezer' } : null);
  const r = byAttendant({
    conversations: [conv('line:f:1'), conv('line:f:2'), conv('line:e:1'), conv('5959000'), conv('ig:aa'), conv('ig:bb', { name: 'Com dono' })],
    leads, users, lineOwner,
    findLead: (c) => (c.name === 'Com dono' ? { ownerId: 'e' } : null),
  });
  const by = Object.fromEntries(r.attendants.map((a) => [a.id, a]));
  assert.equal(by.f.funnel.conversas, 2);
  assert.equal(by.e.funnel.conversas, 2, 'o Instagram com vendedor cai no vendedor');
  assert.equal(by.triagem.funnel.conversas, 2, 'quem a IA ainda não direcionou fica em triagem, junto (WhatsApp e Instagram)');
  assert.deepEqual([by.f.funnel.prospectos, by.f.funnel.contato, by.f.funnel.proposta, by.f.funnel.fechados, by.f.funnel.valorFechado], [2, 2, 2, 1, 1000]);
  assert.equal(by.triagem.funnel.perdidos, 1);
  assert.equal(by.f.sources.find((s) => s.label === 'Instagram').fechados, 1);
  assert.equal(r.total.conversas, 6);
  assert.equal(r.total.fechados, 1);
  assert.equal(r.attendants[0].kind, 'admin');
  assert.ok(r.sources.find((s) => s.label === 'Anúncio no Instagram'));
});

test('canal sem movimento não aparece; pessoa da equipe aparece mesmo sem conversa', () => {
  const r = byAttendant({ conversations: [], leads: [], users, lineOwner: () => null, findLead: () => null });
  assert.deepEqual(r.attendants.map((a) => a.id), ['m', 'f', 'e']);
});
