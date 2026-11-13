import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ConnectionManager, accountOf } from '../src/connection.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function setup(opts = {}) {
  const log = []; let active = 0; let maxActive = 0;
  const mk = (name, ms) => Object.assign(new EventEmitter(), { status: 'connected', getState: () => ({}), send: async (to, p) => { active += 1; maxActive = Math.max(maxActive, active); log.push(`ini:${name}:${p.text}`); await sleep(ms); log.push(`fim:${name}:${p.text}`); active -= 1; return { jid: to }; }, async start() {}, async stop() {} });
  const principal = mk('principal', 40);
  const lines = Object.assign(new EventEmitter(), { isConnected: () => true, send: async (key, p) => { const n = key.split(':')[1]; log.push(`ini:${n}:${p.text}`); await sleep(40); log.push(`fim:${n}:${p.text}`); return { jid: key }; }, stop: async () => {} });
  const cm = new ConnectionManager({ store: { settings: {} }, clients: { qr: principal }, lines, quietMs: 60, maxQuietWaitMs: 500, ...opts });
  return { cm, log, lines, principal };
}

test('o mesmo número nunca envia duas mensagens ao mesmo tempo (uma por vez, na ordem); números diferentes seguem em paralelo', async () => {
  const { cm, log } = setup();
  await Promise.all([cm.send('5511900000001@s.whatsapp.net', { text: 'a' }), cm.send('5511900000002@s.whatsapp.net', { text: 'b' }), cm.send('5511900000003@s.whatsapp.net', { text: 'c' })]);
  for (let i = 0; i < log.length; i += 2) assert.ok(log[i].startsWith('ini') && log[i + 1].startsWith('fim') && log[i].split(':')[2] === log[i + 1].split(':')[2], 'cada envio termina antes do próximo começar');
  assert.equal(log.length, 6);
});

test('contas diferentes (o principal e o WhatsApp de cada vendedor) enviam ao mesmo tempo, sem esperar umas pelas outras', async () => {
  const { cm, log } = setup();
  await Promise.all([cm.send('5511900000001@s.whatsapp.net', { text: 'p' }), cm.send('l:fran:5511900000002@s.whatsapp.net', { text: 'f' }), cm.send('l:diego:5511900000003@s.whatsapp.net', { text: 'd' })]);
  const starts = log.filter((x) => x.startsWith('ini'));
  assert.equal(starts.length, 3);
  assert.deepEqual(log.slice(0, 3).every((x) => x.startsWith('ini')), true, 'as três começaram antes de qualquer uma terminar');
  assert.equal(accountOf('l:fran:5511@s.whatsapp.net'), 'linha:fran'); assert.equal(accountOf('ig:123'), 'instagram'); assert.equal(accountOf('5511@s.whatsapp.net'), 'principal');
});

test('uma falha de envio não trava a fila daquele número', async () => {
  const { cm, principal, log } = setup();
  let n = 0;
  principal.send = async (to, p) => { n += 1; if (n === 1) throw new Error('caiu'); log.push(`ok:${p.text}`); return { jid: to }; };
  const a = cm.send('5511900000001@s.whatsapp.net', { text: 'a' }).catch((e) => e.message);
  const b = cm.send('5511900000002@s.whatsapp.net', { text: 'b' });
  assert.equal(await a, 'caiu');
  await b;
  assert.deepEqual(log, ['ok:b']);
});

test('se a pessoa da equipe acabou de digitar pelo celular naquele número, a resposta automática espera um pouco antes de sair', async () => {
  const { cm, log } = setup({ numberGapMs: 60 });
  cm.emit('ownerMessage', { jid: '5511900000009@s.whatsapp.net', text: 'oi, estou atendendo' });
  const t0 = Date.now();
  await cm.send('5511900000001@s.whatsapp.net', { text: 'auto' });
  assert.ok(Date.now() - t0 >= 50, 'esperou o intervalo de silêncio');
  // Em outro número, não espera.
  const t1 = Date.now();
  await cm.send('l:fran:5511900000002@s.whatsapp.net', { text: 'outro' });
  assert.ok(Date.now() - t1 < 50);
  assert.ok(log.length >= 4);
});

test('pausa por conversa: onde a pessoa digitou espera a pausa inteira; as outras conversas do número só um intervalo curto', async () => {
  const { cm } = setup({ quietMs: 400, numberGapMs: 30, maxQuietWaitMs: 2000 });
  cm.emit('ownerMessage', { jid: 'l:mand:5569900000001@s.whatsapp.net', text: 'oi mãe' });
  assert.ok(cm.humanWaitMs('l:mand:5569900000001@s.whatsapp.net') > 300, 'na conversa da mãe: pausa inteira');
  const outra = cm.humanWaitMs('l:mand:5527999568520@s.whatsapp.net');
  assert.ok(outra <= 30, `cliente novo no mesmo número: só o intervalo curto (${outra} ms)`);
  assert.equal(cm.humanWaitMs('l:outro:5527999568520@s.whatsapp.net'), 0, 'outro número: livre');
  const t0 = Date.now();
  await cm.send('l:mand:5527999568520@s.whatsapp.net', { text: 'resposta da IA ao cliente' });
  assert.ok(Date.now() - t0 < 300, 'o cliente não esperou a pausa da conversa da mãe');
});

test('atalhos (/ia, "Só um momento") digitados no celular não pausam a IA', () => {
  const { cm } = setup({ quietMs: 400, numberGapMs: 400 });
  cm.ignoreOwner = (msg) => /^\/ia$|s[oó] um momento/i.test(msg.text);
  cm.emit('ownerMessage', { jid: 'l:mand:5527999568520@s.whatsapp.net', text: '/ia' });
  cm.emit('ownerMessage', { jid: 'l:mand:5527999568520@s.whatsapp.net', text: 'Só um momento' });
  assert.equal(cm.humanWaitMs('l:mand:5527999568520@s.whatsapp.net'), 0);
  cm.emit('ownerMessage', { jid: 'l:mand:5527999568520@s.whatsapp.net', text: 'bom dia, tudo bem?' });
  assert.ok(cm.humanWaitMs('l:mand:5527999568520@s.whatsapp.net') > 300, 'mensagem de verdade pausa');
});

test('a pausa por conversa vale para TODOS os números: principal, Central, vendedores e Instagram', () => {
  const { cm } = setup({ quietMs: 400, numberGapMs: 30 });
  const pares = [
    ['5545988880001@s.whatsapp.net', '5545988880002@s.whatsapp.net'], // principal
    ['l:central:5545988880001@s.whatsapp.net', 'l:central:5545988880002@s.whatsapp.net'], // Central
    ['l:giovana:5545988880001@s.whatsapp.net', 'l:giovana:5545988880002@s.whatsapp.net'], // vendedora
    ['ig:maria.silva', 'ig:joao.souza'], // Instagram (usuário com letras)
  ];
  for (const [mexeu, outro] of pares) {
    cm.emit('ownerMessage', { jid: mexeu, text: 'mensagem da pessoa' });
    assert.ok(cm.humanWaitMs(mexeu) > 300, `pausa na conversa em que digitou: ${mexeu}`);
    assert.ok(cm.humanWaitMs(outro) <= 30, `os outros clientes do mesmo número seguem: ${outro}`);
  }
});
