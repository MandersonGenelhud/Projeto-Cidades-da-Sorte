import test from 'node:test';
import assert from 'node:assert/strict';
import { distributionReport, slaCheck, assignments, viaOf } from '../src/distribution.js';
import { Auth } from '../src/auth.js';
import { Crm } from '../src/crm.js';
import { tempStore } from './helpers.js';

const now = new Date(2026, 10, 9, 15, 0); // segunda, 9/11/2026, 15h
const at = (h, d = 9) => new Date(2026, 10, d, h, 0).toISOString();
const lead = (id, ownerId, stage, assigns, extra = {}) => ({ id, name: `Cliente ${id}`, phone: `5545900000${id}`, ownerId, stage, createdAt: at(8), timeline: assigns.map(([when, toId, via, fromId]) => ({ at: when, type: 'dono', toId, via, fromId: fromId || null, text: `Responsável (${via})` })), ...extra });
const users = [{ id: 'a', name: 'Ana', role: 'seller', active: true }, { id: 'b', name: 'Bia', role: 'seller', active: true }, { id: 'c', name: 'Caio', role: 'seller', active: true }];

test('entrega por vendedor, por onde chegou, quem foi atendido e em quanto tempo, e o que virou proposta e contrato', () => {
  const leads = [
    lead('1', 'a', 'ganho', [[at(9), 'a', 'rodízio']], { timeline: [{ at: at(9), type: 'dono', toId: 'a', via: 'rodízio' }, { at: at(9.5 | 0), type: 'nota', byId: 'a' }] }),
    lead('2', 'a', 'proposta', [[at(10), 'a', 'rodízio']]),
    lead('3', 'b', 'novo', [[at(11), 'b', 'IA passou (receio)']]),
    lead('4', 'b', 'em_contato', [[at(8), 'b', 'indicação de parceiro']]),
    lead('5', 'c', 'novo', [[at(8), 'a', 'rodízio'], [at(9), 'c', 'manual', 'a']]),
  ];
  leads[0].timeline.push({ at: at(10), type: 'nota', byId: 'a' }); // Ana atende o cliente 1 uma hora depois
  const r = distributionReport({ leads, users, rotation: users, sales: [{ number: 'VD-1', client: { nome: 'Cliente 1' }, sellerId: 'a', sellerName: 'Ana', total: 12997, createdAt: at(12), status: 'aberta' }], from: '2026-11-01', to: '2026-11-09', now, days: 3 });
  const by = Object.fromEntries(r.sellers.map((s) => [s.id, s]));
  assert.equal(by.a.received, 3, 'Ana recebeu 3 entregas (a do cliente 5 foi repassada depois)');
  assert.equal(by.a.repassado, 1);
  assert.equal(by.a.byVia.rodizio, 3);
  assert.equal(by.b.byVia.indicacao, 1); assert.equal(by.b.byVia.ia, 1);
  assert.equal(by.c.byVia.transferencia, 1, 'repasse manual aparece como transferência');
  assert.equal(by.a.ganho, 1); assert.equal(by.a.proposta, 1);
  assert.equal(by.a.contracts, 1); assert.equal(by.a.contractsValue, 12997);
  assert.equal(r.contracts[0].number, 'VD-1');
  assert.ok(by.a.attended >= 1 && by.a.firstActionMedianMin >= 0);
  assert.equal(by.b.noAction, 2, 'Bia ainda não agiu em nenhum dos dois');
  assert.ok(r.waiting.every((w) => w.late) && r.waiting.some((w) => w.sellerId === 'b'), 'cliente parado além do prazo aparece na lista');
  assert.equal(r.funnel.contratos, 1); assert.equal(r.funnel.valor, 12997);
  assert.equal(by.a.perDay.reduce((x, y) => x + y, 0), 3);
});

test('rodízio justo: com volume, mostra recebido x esperado e o desvio de cada um; com pouco volume não aponta injustiça', () => {
  const mk = (n, to) => Array.from({ length: n }, (_, i) => lead(`${to}${i}`, to, 'novo', [[at(9), to, 'rodízio']]));
  const r = distributionReport({ leads: [...mk(8, 'a'), ...mk(2, 'b'), ...mk(2, 'c')], users, rotation: users, from: '2026-11-01', to: '2026-11-09', now });
  const by = Object.fromEntries(r.sellers.map((s) => [s.id, s]));
  assert.equal(r.totalRodizio, 12);
  assert.equal(by.a.fair.expected, 4); assert.equal(by.a.fair.deviationPct, 100);
  assert.equal(by.b.fair.deviationPct, -50);
  const poucos = distributionReport({ leads: mk(3, 'a'), users, rotation: users, from: '2026-11-01', to: '2026-11-09', now });
  assert.equal(poucos.sellers.find((s) => s.id === 'a').fair, null);
});

test('período: entregas fora do intervalo não entram', () => {
  const leads = [lead('1', 'a', 'novo', [[new Date(2026, 9, 1, 9).toISOString(), 'a', 'rodízio']])];
  const r = distributionReport({ leads, users, rotation: users, from: '2026-11-01', to: '2026-11-09', now });
  assert.equal(r.sellers.find((s) => s.id === 'a').received, 0);
});

test('cliente parado: lembra o vendedor depois do prazo e avisa a administração em dobro; só no horário comercial; ação do vendedor tira da lista', () => {
  const leads = [
    lead('1', 'a', 'novo', [[at(9), 'a', 'rodízio']]), // 6 h parado
    lead('2', 'b', 'novo', [[at(12), 'b', 'rodízio']]), // 3 h: só lembrete
    lead('3', 'c', 'novo', [[at(9), 'c', 'rodízio']], { timeline: [{ at: at(9), type: 'dono', toId: 'c', via: 'rodízio' }, { at: at(9.9 | 0) , type: 'nota', byId: 'c' }, { at: at(11), type: 'nota', byId: 'c' }] }), // atendido
    lead('4', 'a', 'ganho', [[at(9), 'a', 'rodízio']]), // já fechou
  ];
  const r = slaCheck({ leads, now, slaHours: 2 });
  assert.deepEqual(r.escalate.map((x) => x.lead.id), ['1']);
  assert.deepEqual(r.nudge.map((x) => x.lead.id), ['2']);
  assert.deepEqual(slaCheck({ leads, now: new Date(2026, 10, 9, 22, 0), slaHours: 2 }), { nudge: [], escalate: [] }, 'de noite não cobra ninguém');
  assert.deepEqual(slaCheck({ leads, now: new Date(2026, 10, 8, 15, 0), slaHours: 2 }), { nudge: [], escalate: [] }, 'domingo também não');
  leads[0].slaEscalatedAt = 'x'; leads[1].slaNudgedAt = 'x';
  const again = slaCheck({ leads, now, slaHours: 2 });
  assert.equal(again.nudge.length + again.escalate.length, 0, 'cada aviso sai uma vez só');
  // Entrega às 21h conta a partir das 8h do dia seguinte.
  const night = [lead('9', 'a', 'novo', [[at(21, 8), 'a', 'rodízio']])];
  assert.equal(slaCheck({ leads: night, now: new Date(2026, 10, 9, 9, 0), slaHours: 2 }).nudge.length, 0, '1 h depois de abrir ainda não passou do prazo');
  assert.equal(slaCheck({ leads: night, now: new Date(2026, 10, 9, 10, 30), slaHours: 2 }).nudge.length, 1);
});

test('o CRM real grava a história de cada entrega (quem recebeu, de quem veio e por qual via)', () => {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const adm = auth.create({ name: 'Marcos', login: 'marcos', password: 'segredo123', role: 'admin' });
  const a = auth.create({ name: 'Ana', login: 'ana', password: 'segredo123', role: 'seller', whatsapp: '5545999990001' });
  const b = auth.create({ name: 'Bia', login: 'bia', password: 'segredo123', role: 'seller', whatsapp: '5545999990002' });
  const crm = new Crm({ store, auth });
  crm.create(adm, { name: 'João', phone: '5545988887777' });
  const lead0 = crm.leads.at(-1);
  crm.routeLead(lead0, { reason: 'rodízio' });
  const first = lead0.ownerId;
  const other = first === a.id ? b.id : a.id;
  crm.assign(adm, lead0.id, other);
  const list = assignments([lead0]);
  assert.equal(list.length >= 2, true);
  assert.equal(list.at(-2).via, 'rodizio');
  assert.equal(list.at(-1).toId, other); assert.equal(list.at(-1).fromId, first);
  assert.equal(list.at(-1).via, 'transferencia');
  assert.equal(viaOf({ text: 'Responsável: X (rodízio após a peneira da IA)' }), 'rodizio');
  assert.equal(viaOf({ text: 'Responsável: X (indicação de parceiro)' }), 'indicacao');
});
