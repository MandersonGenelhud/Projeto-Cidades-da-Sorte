import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WhatsAppClient } from '../src/transports/whatsapp-web.js';
import { parseCommand } from '../src/seller-commands.js';

const sock = { user: { id: '595987101567:3@s.whatsapp.net' } };
const now = () => Math.floor(Date.now() / 1000);
const msg = (id, text, { to = '5545999990000@s.whatsapp.net', fromMe = true, ts = now() } = {}) => ({ key: { id, remoteJid: to, fromMe }, messageTimestamp: ts, message: { conversation: text } });

function client() {
  const c = new WhatsAppClient({ authDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wa-own-')) });
  const out = { owner: [], message: [], history: [] };
  c.on('ownerMessage', (m) => out.owner.push(m));
  c.on('message', (m) => out.message.push(m));
  c.on('history', (m) => out.history.push(m));
  return { c, out };
}

test('/contrato digitado no celular chega como atalho mesmo quando o WhatsApp entrega como "append"', () => {
  const { c, out } = client();
  c.handleUpsert({ type: 'append', messages: [msg('A1', '/contrato cédula 2 pessoas')] }, sock);
  assert.equal(out.owner.length, 1, 'virou mensagem do consultor');
  assert.equal(out.owner[0].text, '/contrato cédula 2 pessoas');
  assert.equal(out.owner[0].phone, '5545999990000', 'é a conversa do cliente');
  assert.ok(parseCommand(out.owner[0].text), 'e é reconhecido como atalho');
  // Se o mesmo chegar de novo como "notify", não roda duas vezes.
  c.handleUpsert({ type: 'notify', messages: [msg('A1', '/contrato cédula 2 pessoas')] }, sock);
  assert.equal(out.owner.length, 1);
});

test('"append" antigo (histórico ao conectar) não dispara atalho; mensagens do próprio sistema também não', () => {
  const { c, out } = client();
  c.handleUpsert({ type: 'append', messages: [msg('OLD', '/contrato', { ts: now() - 3600 })] }, sock);
  assert.equal(out.owner.length, 0, 'mensagem de uma hora atrás não vira comando agora');
  assert.equal(out.history.length, 1, 'mas continua indo para o histórico');
  c.sentIds.add('SYS');
  c.handleUpsert({ type: 'notify', messages: [msg('SYS', '/ajuda')] }, sock);
  assert.equal(out.owner.length, 0);
  // Hora em formato "Long" (como o WhatsApp manda às vezes) também funciona.
  c.handleUpsert({ type: 'append', messages: [{ ...msg('L1', '/status'), messageTimestamp: { low: now(), high: 0, toNumber() { return this.low; } } }] }, sock);
  assert.equal(out.owner.length, 1);
});

test('na conversa "Você" o append continua indo para a Nina/atalhos de administrador, e mensagem de cliente segue normal', () => {
  const { c, out } = client();
  c.handleUpsert({ type: 'append', messages: [msg('S1', '/resumo', { to: '595987101567@s.whatsapp.net' })] }, sock);
  assert.equal(out.message.length, 1);
  assert.equal(out.message[0].selfChat, true);
  assert.equal(out.owner.length, 0);
  c.handleUpsert({ type: 'notify', messages: [msg('C1', 'oi, quero saber o preço', { fromMe: false })] }, sock);
  assert.equal(out.message.length, 2);
  assert.equal(out.message[1].selfChat, undefined);
});
