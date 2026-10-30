import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { InstagramClient, splitForInstagram } from '../src/transports/instagram.js';
import { ConnectionManager } from '../src/connection.js';
import { AutoReply } from '../src/autoreply.js';
import { Agent } from '../src/agent/agent.js';
import { buildSystemPrompt } from '../src/agent/prompt.js';
import { FakeWA, tempStore } from './helpers.js';

const cfg = { enabled: true, accessToken: 'IGAAteste', verifyToken: 'v', appSecret: 'segredo', graphVersion: 'v25.0' };

function fakeGraph() {
  const calls = [];
  let n = 0;
  const fn = async (url, opts = {}) => {
    calls.push({ url, ...opts, json: opts.body ? JSON.parse(opts.body) : null });
    let body = {};
    if (url.includes('/me?')) body = { user_id: '1784', username: 'migraparaguai', name: 'Migra Paraguai' };
    else if (url.includes('fields=name,username')) body = { name: 'Lucas Lima', username: 'lucas.lima' };
    else if (url.endsWith('/messages')) body = { recipient_id: '999', message_id: `mid.out.${++n}` };
    return { ok: true, status: 200, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

const dm = (mid, sender, recipient, text, extra = {}) => ({
  object: 'instagram',
  entry: [{ id: '1784', time: 1, messaging: [{ sender: { id: sender }, recipient: { id: recipient }, timestamp: 1761577200000, message: { mid, text, ...extra } }] }],
});

test('conecta, recebe Direct com nome do perfil e ignora duplicado', async () => {
  const fetch = fakeGraph();
  const ig = new InstagramClient({ getConfig: () => cfg, fetchImpl: fetch });
  await ig.start();
  assert.equal(ig.status, 'connected');
  assert.equal(ig.me.username, 'migraparaguai');
  const got = [];
  ig.on('message', (m) => got.push(m));
  await ig.handleWebhook(dm('mid.1', '999', '1784', 'Oi, quero morar no Paraguai'));
  await ig.handleWebhook(dm('mid.1', '999', '1784', 'Oi, quero morar no Paraguai'));
  assert.equal(got.length, 1);
  assert.deepEqual([got[0].jid, got[0].username, got[0].name, got[0].channel], ['ig:999', 'lucas.lima', 'Lucas Lima', 'instagram']);
});

test('envio em partes de até 1000 bytes e eco das nossas mensagens é ignorado', async () => {
  const fetch = fakeGraph();
  const ig = new InstagramClient({ getConfig: () => cfg, fetchImpl: fetch });
  await ig.start();
  const longo = 'Ação de residência. '.repeat(80);
  await ig.send('ig:999', { text: longo });
  const sends = fetch.calls.filter((c) => c.url.endsWith('/1784/messages'));
  assert.ok(sends.length >= 2);
  assert.ok(sends.every((c) => Buffer.byteLength(c.json.message.text) <= 1000));
  assert.equal(sends[0].json.recipient.id, '999');

  const owner = [];
  ig.on('ownerMessage', (m) => owner.push(m));
  await ig.handleWebhook(dm('mid.out.1', '1784', '999', sends[0].json.message.text, { is_echo: true })); // eco nosso
  await ig.handleWebhook(dm('mid.dono', '1784', '999', 'Oi Lucas, aqui é o Marcos', { is_echo: true })); // dono pelo app
  assert.deepEqual(owner.map((m) => [m.jid, m.text]), [['ig:999', 'Oi Lucas, aqui é o Marcos']]);
});

test('splitForInstagram não corta texto curto', () => {
  assert.deepEqual(splitForInstagram('Olá!'), ['Olá!']);
});

test('webhook: verificação e assinatura', () => {
  const ig = new InstagramClient({ getConfig: () => cfg });
  assert.equal(ig.verifyWebhook({ 'hub.mode': 'subscribe', 'hub.verify_token': 'v', 'hub.challenge': '42' }), '42');
  assert.equal(ig.verifyWebhook({ 'hub.mode': 'subscribe', 'hub.verify_token': 'x', 'hub.challenge': '42' }), null);
  const raw = Buffer.from('{}');
  assert.ok(ig.checkSignature(raw, `sha256=${crypto.createHmac('sha256', 'segredo').update(raw).digest('hex')}`));
  assert.ok(!ig.checkSignature(raw, 'sha256=00'));
});

test('a resposta vai pelo canal certo: Instagram ou WhatsApp', async () => {
  const store = tempStore();
  const fetch = fakeGraph();
  const ig = new InstagramClient({ getConfig: () => cfg, fetchImpl: fetch });
  await ig.start();
  const whats = new FakeWA();
  whats.getState = () => ({});
  const wa = new ConnectionManager({ store, clients: { qr: whats, cloud: whats }, instagram: ig });
  await wa.send('ig:999', { text: 'oi pelo Instagram' });
  await wa.send('5511999990000@s.whatsapp.net', { text: 'oi pelo WhatsApp' });
  assert.equal(whats.sent.length, 1);
  assert.equal(fetch.calls.filter((c) => c.url.endsWith('/messages')).length, 1);
  assert.ok(wa.isConnected('ig:999'));
});

test('modo de teste aceita @usuario do Instagram', () => {
  const store = tempStore();
  store.updateSettings({ agent: { enabled: true, audience: 'test', testNumbers: ['@Lucas.Lima', '(11) 98765-4321'] } });
  const agent = new Agent({ store, llm: { configured: true }, calendar: null });
  const bot = new AutoReply({ store, wa: new FakeWA(), agent });
  assert.ok(bot.agentAllowed({ username: 'lucas.lima', channel: 'instagram' }));
  assert.ok(!bot.agentAllowed({ username: 'outra.pessoa', channel: 'instagram' }));
  assert.ok(bot.agentAllowed({ phone: '5511987654321' }));
});

test('prompt muda o estilo conforme o canal', () => {
  const store = tempStore();
  const ig = buildSystemPrompt(store.settings, { channel: 'Instagram' });
  assert.match(ig, /no Instagram\./);
  assert.match(ig, /Instagram Direct/);
  assert.doesNotMatch(ig, /negrito do WhatsApp/);
  assert.match(buildSystemPrompt(store.settings), /no WhatsApp\./);
});

test('mensagem que vem de anúncio traz a origem', async () => {
  const { parseReferral } = await import('../src/transports/instagram.js');
  assert.deepEqual(parseReferral({ source: 'ADS', ad_id: 42, ads_context_data: { ad_title: 'Morar no Paraguai' } }), { adId: '42', title: 'Morar no Paraguai' });
  assert.equal(parseReferral({ source: 'SHORTLINK', ref: 'bio' }), null);
});

test('túnel: escolhe o arquivo certo e acha o endereço público', async () => {
  const { downloadName, findTunnelUrl } = await import('../src/tunnel.js');
  assert.equal(downloadName('win32', 'x64').file, 'cloudflared-windows-amd64.exe');
  assert.equal(downloadName('darwin', 'arm64').file, 'cloudflared-darwin-arm64.tgz');
  assert.equal(findTunnelUrl('INF |  https://bold-tree-cat-dog.trycloudflare.com  |'), 'https://bold-tree-cat-dog.trycloudflare.com');
  assert.equal(findTunnelUrl('nada aqui'), null);
  assert.equal(findTunnelUrl('ERR failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": EOF'), null, 'mensagem de erro não é endereço');
});
