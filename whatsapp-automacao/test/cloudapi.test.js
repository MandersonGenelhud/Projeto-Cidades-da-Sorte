import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { CloudApiClient } from '../src/transports/cloudapi.js';

const config = { accessToken: 'TOKEN', phoneNumberId: '1098', verifyToken: 'verifica', appSecret: 'segredo', graphVersion: 'v22.0' };

function fakeFetch() {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, ...opts, json: opts.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : null });
    const body = url.includes('fields=') ? { display_phone_number: '+55 41 3333-4444', verified_name: 'Clínica Sorriso' } : { messages: [{ id: 'wamid.1' }] };
    return { ok: true, status: 200, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

test('verificação do webhook', () => {
  const c = new CloudApiClient({ getConfig: () => config });
  assert.equal(c.verifyWebhook({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verifica', 'hub.challenge': '99' }), '99');
  assert.equal(c.verifyWebhook({ 'hub.mode': 'subscribe', 'hub.verify_token': 'x', 'hub.challenge': '99' }), null);
});

test('assinatura X-Hub-Signature-256', () => {
  const c = new CloudApiClient({ getConfig: () => config });
  const raw = Buffer.from('{"a":1}');
  const sig = `sha256=${crypto.createHmac('sha256', 'segredo').update(raw).digest('hex')}`;
  assert.equal(c.checkSignature(raw, sig), true);
  assert.equal(c.checkSignature(raw, 'sha256=errado'), false);
  assert.equal(c.checkSignature(raw, undefined), false);
});

test('conecta, recebe mensagem do webhook (sem duplicar) e responde', async () => {
  const fetch = fakeFetch();
  const c = new CloudApiClient({ getConfig: () => config, fetchImpl: fetch });
  await c.start();
  assert.equal(c.status, 'connected');
  assert.equal(c.me.phone, '554133334444');

  const received = [];
  c.on('message', (m) => received.push(m));
  const payload = {
    entry: [{ changes: [{ value: {
      contacts: [{ wa_id: '5541999990000', profile: { name: 'Lucas' } }],
      messages: [{ id: 'wamid.A', from: '5541999990000', timestamp: '1761400000', type: 'text', text: { body: 'Oi! Vocês abrem sábado?' } }],
    } }] }],
  };
  c.handleWebhook(payload);
  c.handleWebhook(payload); // reenvio da Meta
  assert.equal(received.length, 1);
  assert.deepEqual([received[0].phone, received[0].name, received[0].text], ['5541999990000', 'Lucas', 'Oi! Vocês abrem sábado?']);

  await c.send('5541999990000', { text: 'Abrimos sim, das 8h às 12h!' });
  const sendCall = fetch.calls.find((x) => x.json?.type === 'text');
  assert.equal(sendCall.url, 'https://graph.facebook.com/v22.0/1098/messages');
  assert.equal(sendCall.headers.Authorization, 'Bearer TOKEN');
  assert.deepEqual(sendCall.json.text.body, 'Abrimos sim, das 8h às 12h!');
});
