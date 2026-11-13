import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backlogCandidates, migraSignal, registerClientesEsperandoRoutes } from '../src/routes/clientes-esperando.js';

const NOW = Date.parse('2026-11-13T15:40:00Z');
const at = (min) => new Date(NOW - min * 60_000).toISOString();
const K = (ph, line = 'mand') => `l:${line}:${ph}@s.whatsapp.net`;
const conv = (key, messages, extra = {}) => ({ key, phone: key.split(':')[2].split('@')[0], name: '', messages, updatedAt: at(0), ...extra });

function base() {
  return {
    // veio pela Central (sem resposta)
    [K('5527999568520')]: conv(K('5527999568520'), [{ role: 'user', content: 'Olá Manderson, vim pela Central da Migra. Meu código é MG-4821.', at: at(80) }]),
    // assunto da Migra, sem resposta
    [K('5577995570663')]: conv(K('5577995570663'), [{ role: 'user', content: 'Boa tarde, quanto custa a residência no Paraguai?', at: at(90) }]),
    // "Só um momento" e a IA ainda não voltou
    [K('5569911112222')]: conv(K('5569911112222'), [
      { role: 'user', content: 'Quero fechar o contrato da cédula', at: at(60) },
      { role: 'assistant', by: 'owner', content: 'Só um momento', at: at(58) },
    ], { handoff: true, handoffReason: 'Você respondeu pelo celular' }),
    // família: sem sinal da Migra
    [K('5569933334444')]: conv(K('5569933334444'), [{ role: 'user', content: 'Gratidão 🙏', at: at(10) }]),
    // já respondido pelo dono
    [K('5569955556666')]: conv(K('5569955556666'), [
      { role: 'user', content: 'Oi, sobre o contrato', at: at(30) },
      { role: 'assistant', by: 'owner', content: 'Te mando amanhã os valores', at: at(20) },
    ]),
    // outro número (outra vendedora)
    [K('5545977778888', 'giovana')]: conv(K('5545977778888', 'giovana'), [{ role: 'user', content: 'vim pela Central da Migra', at: at(15) }]),
    // grupo e número principal: nunca
    '120363000000@g.us': conv('l:mand:120363000000@g.us', [{ role: 'user', content: 'migra', at: at(5) }]),
    '5545911110000@s.whatsapp.net': { key: '5545911110000@s.whatsapp.net', messages: [{ role: 'user', content: 'migra', at: at(5) }] },
  };
}

test('acha só quem fala da Migra e não foi respondido; inclui o "Só um momento"; deixa a família de fora', () => {
  const r = backlogCandidates({ conversations: base(), lineIds: new Set(['mand']), now: NOW });
  const keys = r.esperando.map((x) => x.phone);
  assert.deepEqual(keys.sort(), ['5527999568520', '5569911112222', '5577995570663'].sort());
  assert.equal(r.esperando[0].forte, true, 'quem veio pela Central vem primeiro');
  const momento = r.esperando.find((x) => x.phone === '5569911112222');
  assert.equal(momento.soUmMomento, true);
  assert.ok(r.ignorados.some((x) => x.key === K('5569933334444')), 'família ficou de fora');
  assert.ok(!keys.includes('5569955556666'), 'já respondido pelo dono não entra');
});

test('todos os números dos vendedores quando não filtra; nunca grupo nem número principal', () => {
  const r = backlogCandidates({ conversations: base(), now: NOW });
  assert.ok(r.esperando.some((x) => x.linha === 'giovana'));
  assert.ok(!r.esperando.some((x) => /g\.us/.test(x.key) || !x.key.startsWith('l:')));
});

test('equipe, recusa, /pausa, mensagens velhas e pausas de outro tipo ficam de fora', () => {
  const c = base();
  c[K('5527999568520')].declined = { kind: 'outro' };
  c[K('5577995570663')].handoff = true; c[K('5577995570663')].handoffReason = 'o consultor pediu pausa (/pausa)';
  c[K('5545900001111')] = conv(K('5545900001111'), [{ role: 'user', content: 'vim pela Central da Migra', at: at(60 * 24 * 10) }]);
  c[K('5545900002222')] = conv(K('5545900002222'), [{ role: 'user', content: 'contrato', at: at(5) }], { handoff: true, handoffReason: 'Encaminhado ao setor de documentação' });
  const r = backlogCandidates({ conversations: c, lineIds: new Set(['mand']), now: NOW, isTeam: (p) => p === '5569911112222' });
  assert.deepEqual(r.esperando.map((x) => x.phone), []);
});

test('mensagem que ainda não entrou na memória (fila de sem resposta) também conta', () => {
  const r = backlogCandidates({
    conversations: {},
    pendingItems: { [K('5511987654321')]: { jid: K('5511987654321'), phone: '5511987654321', name: 'Carla', texts: ['Oi, vi o anúncio da Migra sobre terrenos'], at: NOW - 3_600_000 } },
    now: NOW,
  });
  assert.equal(r.esperando.length, 1);
  assert.equal(r.esperando[0].nome, 'Carla');
  assert.deepEqual(r.esperando[0].extra, ['Oi, vi o anúncio da Migra sobre terrenos']);
});

test('sinal da Migra: Central, código, prospecto e assunto', () => {
  assert.equal(migraSignal({ texts: ['Olá, vim pela Central da Migra.'] }).forte, true);
  assert.equal(migraSignal({ texts: ['meu código é ABC123'] }).forte, true);
  assert.equal(migraSignal({ texts: ['oi'], lead: { id: 1 } }).forte, true);
  assert.equal(migraSignal({ texts: ['quero saber da residência'] }).forte, false);
  assert.equal(migraSignal({ texts: ['Amém, idem!'] }), null);
});

function fakeApp() {
  const routes = {};
  return { routes, get: (p, h) => { routes[`GET ${p}`] = h; }, post: (p, h) => { routes[`POST ${p}`] = h; } };
}

test('Atender agora: tira a pausa, a IA responde cada um (um de cada vez) e respeita IA desligada no número', async () => {
  const conversations = base();
  const logs = []; const sent = []; const handled = [];
  const store = { data: { conversations }, settings: {}, addLog: (l) => logs.push(l), isBlacklisted: () => false };
  const agent = {
    active: true,
    conversation: (k) => conversations[k] || (conversations[k] = conv(k, [])),
    remember: (c, role, content) => c.messages.push({ role, content, at: new Date().toISOString() }),
    setHandoff: (k, v) => { conversations[k].handoff = v; },
    handleIncoming: async ({ key, resume }, send) => { handled.push({ key, resume }); await send('Oi! Desculpe a demora.', {}); conversations[key].messages.push({ role: 'assistant', content: 'Oi! Desculpe a demora.', at: new Date().toISOString() }); },
  };
  const wa = { isConnected: () => true, send: async (to, p) => { sent.push([to, p.text]); } };
  const lines = { list: () => [{ id: 'mand', label: 'Manderson' }, { id: 'giovana', label: 'Giovana' }, { id: 'central', label: 'Central' }], byOwner: () => null };
  const app = fakeApp();
  const ce = registerClientesEsperandoRoutes(app, {
    store, agent, wa, lines, sleep: async () => {},
    leads: () => [], pendingItems: () => ({}), isTeam: () => false,
    aiOffFor: (k) => k.startsWith('l:giovana:'), isMariaKey: () => false, isWithinWorkHours: () => true,
    httpError: (code, msg) => Object.assign(new Error(msg), { status: code }),
  });
  let out = null;
  app.routes['GET /api/clientes-esperando']({ user: { role: 'admin' }, query: {} }, { json: (x) => { out = x; } });
  assert.ok(out.esperando.find((x) => x.linha === 'giovana').bloqueio, 'Giovana com IA desligada aparece como bloqueada');
  assert.ok(!out.linhas.some((l) => l.id === 'central'), 'a Central não entra (tem regra própria)');

  const r = ce.start(lines.list().filter((l) => l.id !== 'central'), 'Manderson');
  assert.equal(r.total, 3, 'só os 3 do Manderson (Giovana está com a IA desligada)');
  while (ce.job.running) await new Promise((res) => setTimeout(res, 5));
  assert.equal(handled.length, 3);
  assert.equal(conversations[K('5569911112222')].handoff, false, 'o "Só um momento" voltou para a IA');
  assert.match(handled.find((h) => h.key === K('5569911112222')).resume, /Só um momento/);
  assert.equal(sent.length, 3);
  assert.ok(!sent.some(([to]) => to.startsWith('l:giovana:')));
  assert.throws(() => ce.start([{ id: 'mand' }], 'x'), /Nenhum cliente/, 'depois de atendidos, não repete');
});

test('vendedor só vê o próprio número; fora do horário não começa', () => {
  const app = fakeApp();
  const ce = registerClientesEsperandoRoutes(app, {
    store: { data: { conversations: base() }, settings: {}, addLog: () => {} }, agent: { active: true }, wa: { isConnected: () => true },
    lines: { list: () => [{ id: 'mand' }, { id: 'giovana' }], byOwner: (id) => (id === 'u-gio' ? { id: 'giovana' } : null) },
    sleep: async () => {}, leads: () => [], pendingItems: () => ({}), isTeam: () => false, aiOffFor: () => false, isMariaKey: () => false,
    isWithinWorkHours: () => false, httpError: (c, m) => new Error(m),
  });
  assert.deepEqual(ce.linesFor({ role: 'seller', id: 'u-gio' }).map((l) => l.id), ['giovana']);
  assert.deepEqual(ce.linesFor({ role: 'seller', id: 'outro' }), []);
  assert.throws(() => ce.start([{ id: 'mand' }], 'x'), /Fora do horário/);
});
