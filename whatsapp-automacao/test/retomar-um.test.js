import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan } from '../src/atendimento-plano.js';
import { restartStalled } from '../src/restart.js';

const NOW = Date.parse('2026-11-13T15:00:00Z');
const at = (h) => new Date(NOW - h * 3_600_000).toISOString();
const mk = (key, msgs, extra = {}) => ({ key, phone: key.replace(/\D/g, '').slice(-13), name: `Cliente ${key.slice(-4, -2)}`, messages: msgs.map(([role, content, h, by]) => ({ role, content, at: at(h), ...(by ? { by } : {}) })), ...extra });

function store() {
  const convs = [
    mk('l:mand:5511900000001@s.whatsapp.net', [['assistant', 'Olá!', 50], ['user', 'quanto custa a residência?', 48]]),          // esperando resposta
    mk('l:gio:5511900000002@s.whatsapp.net', [['user', 'oi', 80], ['assistant', 'Qual serviço?', 79]]),                              // parou de responder
    mk('l:mand:5511900000003@s.whatsapp.net', [['user', 'oi', 30], ['assistant', 'te ligo amanhã', 29, 'owner']]),                  // pessoa da equipe já falou: fora
    mk('l:mand:5511900000004@s.whatsapp.net', [['user', 'já fechei com outro', 20]], { declined: { kind: 'fechou_outro' } }),       // recusou: fora
  ];
  return { data: { conversations: Object.fromEntries(convs.map((c) => [c.key, c])) }, settings: {}, save() {}, isBlacklisted: () => false };
}

test('lista um por um: só os parados de verdade, com tipo, última mensagem e o mais recente primeiro', () => {
  const p = buildPlan({ store: store(), now: NOW, days: 30, withRows: true });
  assert.equal(p.retomar, 2);
  assert.deepEqual(p.rows.map((r) => r.key), ['l:mand:5511900000001@s.whatsapp.net', 'l:gio:5511900000002@s.whatsapp.net']);
  assert.equal(p.rows[0].tipo, 'esperando');
  assert.equal(p.rows[0].ultima, 'quanto custa a residência?');
  assert.equal(p.rows[1].tipo, 'silenciou');
  assert.equal(buildPlan({ store: store(), now: NOW, days: 30 }).rows, undefined, 'sem withRows não monta a lista');
});

test('retomar UM: só aquela conversa entra na fila (as outras continuam como estão)', () => {
  const st = store();
  const queued = [];
  const pending = { queue: [], items: {}, enqueue: (keys) => { queued.push(...keys); return { queued: keys.length, blocked: 0, reasons: {} }; } };
  const r = restartStalled({ store: st, agent: {}, pending, now: NOW, days: 30, includeSilent: true, onlyKeys: ['l:gio:5511900000002@s.whatsapp.net'], leadOf: () => null, isBlocked: () => false });
  assert.equal(r.total, 1);
  assert.deepEqual(queued, ['l:gio:5511900000002@s.whatsapp.net']);
  assert.ok(!pending.items['l:mand:5511900000001@s.whatsapp.net'], 'a outra conversa não foi mexida');
});

test('botão Retomar: a IA escreve AGORA; trava leve pede "mesmo assim"; trava forte e número desconectado nunca', async () => {
  const { registerControleRoutes } = await import('../src/routes/controle.js');
  const routes = {};
  const app = new Proxy({}, { get: (_, m) => (p, h) => { routes[`${String(m).toUpperCase()} ${p}`] = h; } });
  const st = store();
  st.settings = { agent: {} };
  st.addLog = () => {};
  const handled = []; const unpaused = [];
  let guard = ''; let connected = true; let aiOff = false;
  const agent = { active: true, setHandoff: (k, v) => unpaused.push([k, v]), handleIncoming: (x, send) => { handled.push(x); return send('Oi! Desculpe a demora.', {}); } };
  const sent = [];
  const httpError = (status, msg) => Object.assign(new Error(msg), { status });
  registerControleRoutes(app, {
    needAdmin: () => {}, httpError, inOffice: () => true, securityEvent: () => {}, conversationOffice: () => 'py', convLabel: () => 'Manderson', lineOwnerOf: () => null,
    store: st, auth: { users: [] }, crm: { findForConversation: () => null }, agent, pending: { queue: [], items: {}, resolve: () => {}, status: () => ({}) },
    lines: { list: () => [] }, wa: { isConnected: () => connected, send: async (k, p) => sent.push([k, p.text]) }, sales: {}, quotes: {}, legacy: {},
    outreachFor: () => guard, aiOffFor: () => aiOff, closedFor: () => '',
  });
  const call = async (body) => {
    let out = null; let status = 200;
    const res = { json: (x) => { out = x; return res; }, status: (s) => { status = s; return res; } };
    try { await routes['POST /api/atendimento/retomar-um']({ body, user: { role: 'admin' } }, res); } catch (e) { status = e.status; out = { error: e.message }; }
    return { status, out };
  };
  const key = 'l:mand:5511900000001@s.whatsapp.net';
  let r = await call({ key });
  assert.equal(r.status, 200);
  assert.equal(handled.length, 1);
  assert.match(handled[0].resume, /CLIENTE ESPERANDO RESPOSTA/);
  assert.deepEqual(sent[0], [key, 'Oi! Desculpe a demora.']);

  guard = 'antigo';
  r = await call({ key });
  assert.equal(r.status, 409);
  assert.equal(r.out.confirmar, true);
  assert.match(r.out.error, /mesmo assim/);
  r = await call({ key, force: true });
  assert.equal(r.status, 200, 'o administrador confirmou: retoma');

  guard = 'recusou';
  r = await call({ key, force: true });
  assert.equal(r.status, 409, 'quem recusou nunca, nem forçando');
  guard = '';
  connected = false;
  r = await call({ key });
  assert.match(r.out.error, /DESCONECTADO/);
  connected = true; aiOff = true;
  r = await call({ key });
  assert.match(r.out.error, /IA está desligada neste número/);
  aiOff = false;
  const silencioso = 'l:gio:5511900000002@s.whatsapp.net';
  await call({ key: silencioso });
  assert.match(handled.at(-1).resume, /RETOMADA DO ATENDIMENTO/, 'quem parou de responder recebe a retomada');
});
