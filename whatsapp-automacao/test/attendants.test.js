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

import { conversationBoards } from '../src/attendants.js';

test('quadros: um por pessoa (mesmo sem conversa), um da IA sem direcionar e um por número da equipe; mostra quem espera resposta', () => {
  const now = new Date('2026-11-07T12:00:00Z');
  const lineOwner = (k) => (k.startsWith('line:f') ? { ownerId: 'f', label: 'Fran' } : k.startsWith('line:t') ? { ownerId: null, label: 'WhatsApp da equipe' } : null);
  const boards = conversationBoards({
    now, users: [...users, { id: 'x', name: 'Inativa', role: 'seller', active: false }], lineOwner, findLead: () => null,
    conversations: [
      conv('line:f:1', { updatedAt: '2026-11-07T11:00:00Z' }), // cliente escreveu por último há 60 min
      conv('line:f:2', { last: { role: 'assistant', content: 'resposta' } }),
      conv('line:f:3', { handoff: true }),
      conv('line:t:1'), conv('5959000'),
    ],
  });
  const by = Object.fromEntries(boards.map((b) => [b.id, b]));
  assert.equal(boards[0].id, 'triagem', 'o quadro da IA sem direcionar vem primeiro');
  assert.equal(by.triagem.total, 1);
  assert.ok(by.e && by.m, 'quem não tem conversa também tem quadro');
  assert.equal(by.e.total, 0);
  assert.ok(!by.x, 'usuário desativado não tem quadro');
  assert.equal(by.f.total, 3);
  assert.equal(by.f.waiting, 1);
  assert.equal(by.f.oldestWaitMin, 60);
  assert.equal(by.f.human, 1);
  assert.equal(by.f.answered, 2);
  assert.deepEqual(by.f.items.map((i) => i.state).sort(), ['aguardando', 'humano', 'respondida']);
  assert.equal(by['line:WhatsApp da equipe'].total, 1, 'número da equipe sem dono tem o seu quadro');
});
