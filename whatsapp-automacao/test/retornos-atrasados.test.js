import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Crm } from '../src/crm.js';
import { reconcileOverdue } from '../src/followups-done.js';
import { tempStore } from './helpers.js';

const NOW = new Date(2026, 10, 8, 12, 0); // 08/11/2026
const iso = (d, h = 10) => new Date(2026, 10, d, h, 0).toISOString();

function setup() {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const admin = auth.create({ name: 'Marcos', login: 'marcos', password: 'segredo123', role: 'admin' });
  const crm = new Crm({ store, auth, now: () => NOW });
  const user = { id: admin.id, name: 'Marcos', role: 'admin' };
  const mk = (name, phone, due) => { const l = crm.create(user, { name, phone, stage: 'novo' }); crm.followUp(user, l.id, { date: due, reason: 'conversar depois' }); return crm.byId(l.id); };
  return { store, crm, user, mk };
}
const conv = (store, key, phone, msgs) => { store.data.conversations[key] = { key, phone, name: 'X', messages: msgs.map(([role, at]) => ({ role, content: `${role} ${at}`, at })) }; };

test('retorno atrasado que já foi feito sai de "Atrasados" e vai para "Já contatados" (respondeu ou não); quem ninguém procurou continua atrasado', () => {
  const { store, crm, user, mk } = setup();
  const a = mk('Ana', '5511900000001', '2026-11-03');   // falamos depois da data e ela respondeu
  const b = mk('Bia', '5511900000002', '2026-11-03');   // falamos e ela não respondeu
  const c = mk('Caio', '5511900000003', '2026-11-03');  // ninguém falou depois da data
  const d = mk('Davi', '5511900000004', '2026-11-03');  // só escreveu ele (a vez é nossa): continua atrasado
  conv(store, '5511900000001@s.whatsapp.net', '5511900000001', [['assistant', iso(5)], ['user', iso(5, 11)]]);
  conv(store, '5511900000002@s.whatsapp.net', '5511900000002', [['user', iso(1)], ['assistant', iso(6)]]);
  conv(store, '5511900000003@s.whatsapp.net', '5511900000003', [['assistant', iso(1)], ['user', iso(2)]]); // tudo ANTES de 03/11
  conv(store, '5511900000004@s.whatsapp.net', '5511900000004', [['user', iso(7)]]);
  assert.equal(crm.agenda(user).atrasados.length, 4);
  const dry = reconcileOverdue({ crm, store, now: NOW.getTime(), dryRun: true });
  assert.deepEqual([dry.overdue, dry.resolved], [4, 2]);
  assert.equal(crm.byId(a.id).followUpAt, '2026-11-03', 'o ensaio não altera nada');
  const r = reconcileOverdue({ crm, store, now: NOW.getTime() });
  assert.deepEqual([r.resolved, r.replied, r.silent], [2, 1, 1]);
  const ag = crm.agenda(user);
  assert.deepEqual(ag.atrasados.map((l) => l.name).sort(), ['Caio', 'Davi']);
  assert.deepEqual(ag.contatados.map((l) => l.name).sort(), ['Ana', 'Bia']);
  assert.equal(ag.contatados.find((l) => l.name === 'Ana').contacted.replied, true);
  assert.equal(ag.contatados.find((l) => l.name === 'Bia').contacted.replied, false);
  assert.equal(crm.byId(a.id).stage, 'em_contato', 'saiu de "aguardando" (retomar depois)');
  assert.match(crm.byId(a.id).timeline.at(-1).text, /Retorno de 03\/11\/2026 já feito/);
  // rodar de novo não repete
  assert.equal(reconcileOverdue({ crm, store, now: NOW.getTime() }).resolved, 0);
});

test('decisão da equipe: "vai continuar" sai do quadro; "não vai continuar" vira perdido com o motivo', () => {
  const { store, crm, user, mk } = setup();
  const a = mk('Ana', '5511900000001', '2026-11-03');
  const b = mk('Bia', '5511900000002', '2026-11-03');
  conv(store, 'k1', '5511900000001', [['assistant', iso(5)]]);
  conv(store, 'k2', '5511900000002', [['assistant', iso(5)]]);
  reconcileOverdue({ crm, store, now: NOW.getTime() });
  crm.contactDecision(user, a.id, { decision: 'continua' });
  assert.equal(crm.byId(a.id).contacted, undefined);
  assert.equal(crm.byId(a.id).stage, 'em_contato');
  crm.contactDecision(user, b.id, { decision: 'nao', reason: 'Fechou com outro' });
  assert.equal(crm.byId(b.id).stage, 'perdido');
  assert.equal(crm.byId(b.id).lostReason, 'Fechou com outro');
  assert.equal(crm.agenda(user).contatados.length, 0);
  assert.throws(() => crm.contactDecision(user, a.id, { decision: 'continua' }), /não está em "Já contatados"/);
  assert.throws(() => crm.contactDecision(user, b.id, { decision: 'xis' }), /não está|inválida/);
});
