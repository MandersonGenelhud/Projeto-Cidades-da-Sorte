import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WhatsAppClient } from '../src/transports/whatsapp-web.js';
import { parseCommand } from '../src/seller-commands.js';

const sock = { user: { id: '595987101567:3@s.whatsapp.net' } };
const now = () => Math.floor(Date.now() / 1000);
const tick = () => new Promise((r) => setTimeout(r, 60));
const msg = (id, text, { to = '5545999990000@s.whatsapp.net', fromMe = true, ts = now() } = {}) => ({ key: { id, remoteJid: to, fromMe }, messageTimestamp: ts, message: { conversation: text } });

function client() {
  const c = new WhatsAppClient({ authDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wa-own-')) });
  c.appendDelayMs = 20; // no sistema de verdade espera 4 s
  const out = { owner: [], message: [], history: [] };
  c.on('ownerMessage', (m) => out.owner.push(m));
  c.on('message', (m) => out.message.push(m));
  c.on('history', (m) => out.history.push(m));
  return { c, out };
}

test('/contrato digitado no celular chega como atalho mesmo quando o WhatsApp entrega como "append"', async () => {
  const { c, out } = client();
  c.handleUpsert({ type: 'append', messages: [msg('A1', '/contrato cédula 2 pessoas')] }, sock);
  await tick();
  assert.equal(out.owner.length, 1, 'virou mensagem do consultor');
  assert.equal(out.owner[0].text, '/contrato cédula 2 pessoas');
  assert.equal(out.owner[0].phone, '5545999990000', 'é a conversa do cliente');
  assert.ok(parseCommand(out.owner[0].text), 'e é reconhecido como atalho');
  // Se o mesmo chegar de novo como "notify", não roda duas vezes.
  c.handleUpsert({ type: 'notify', messages: [msg('A1', '/contrato cédula 2 pessoas')] }, sock);
  assert.equal(out.owner.length, 1);
});

test('"append" antigo (histórico ao conectar) não dispara atalho; mensagens do próprio sistema também não', async () => {
  const { c, out } = client();
  c.handleUpsert({ type: 'append', messages: [msg('OLD', '/contrato', { ts: now() - 3600 })] }, sock);
  await tick();
  assert.equal(out.owner.length, 0, 'mensagem de uma hora atrás não vira comando agora');
  assert.equal(out.history.length, 1, 'mas continua indo para o histórico');
  c.sentIds.add('SYS');
  c.handleUpsert({ type: 'notify', messages: [msg('SYS', '/ajuda')] }, sock);
  assert.equal(out.owner.length, 0);
  // Hora em formato "Long" (como o WhatsApp manda às vezes) também funciona.
  c.handleUpsert({ type: 'append', messages: [{ ...msg('L1', '/status'), messageTimestamp: { low: now(), high: 0, toNumber() { return this.low; } } }] }, sock);
  await tick();
  assert.equal(out.owner.length, 1);
});

test('na conversa "Você" o append continua indo para a Nina/atalhos de administrador, e mensagem de cliente segue normal', async () => {
  const { c, out } = client();
  c.handleUpsert({ type: 'append', messages: [msg('S1', '/resumo', { to: '595987101567@s.whatsapp.net' })] }, sock);
  await tick();
  assert.equal(out.message.length, 1);
  assert.equal(out.message[0].selfChat, true);
  assert.equal(out.owner.length, 0);
  c.handleUpsert({ type: 'notify', messages: [msg('C1', 'oi, quero saber o preço', { fromMe: false })] }, sock);
  assert.equal(out.message.length, 2);
  assert.equal(out.message[1].selfChat, undefined);
});

test('a resposta da própria IA, devolvida pelo WhatsApp como "append" antes de o envio terminar, NÃO conta como o dono respondendo', async () => {
  const { c, out } = client();
  // O WhatsApp devolve a mensagem durante o envio; só depois o sistema guarda o id dela.
  c.handleUpsert({ type: 'append', messages: [msg('IA1', 'Olá! Tudo bem? Posso te ajudar com a residência.')] }, sock);
  c.sentIds.add('IA1');
  await tick();
  assert.equal(out.owner.length, 0, 'não pausa a IA');
});

test('conserto: conversas pausadas por engano (resposta da IA gravada duas vezes) voltam para a IA; pausa de verdade continua', async () => {
  const { Agent, OWNER_PAUSE } = await import('../src/agent/agent.js');
  const { tempStore } = await import('./helpers.js');
  const store = tempStore();
  const agent = new Agent({ store, llm: { configured: false }, calendar: null, notify: () => {} });
  const t0 = Date.parse('2026-11-05T12:00:00Z');
  const iso = (ms) => new Date(ms).toISOString();
  store.data.conversations = {
    eco: { key: 'eco', handoff: true, handoffReason: OWNER_PAUSE, ownerRepliedAt: t0 + 500, messages: [
      { role: 'user', content: 'oi', at: iso(t0 - 5000) }, { role: 'assistant', content: 'Olá!', at: iso(t0 + 500) }, { role: 'assistant', content: 'Olá!', at: iso(t0 + 900) },
      { role: 'user', content: 'quanto custa?', at: iso(t0 + 60000) }] },
    real: { key: 'real', handoff: true, handoffReason: OWNER_PAUSE, ownerRepliedAt: t0 + 120000, messages: [
      { role: 'user', content: 'oi', at: iso(t0) }, { role: 'assistant', content: 'Fala, aqui é o Marcos', at: iso(t0 + 120000) }] },
  };
  assert.equal(agent.repairEchoPauses(), 1);
  assert.equal(store.data.conversations.eco.handoff, false, 'a IA volta a atender');
  assert.equal(store.data.conversations.eco.messages.filter((m) => m.content === 'Olá!').length, 1, 'tira a cópia repetida');
  assert.equal(store.data.conversations.real.handoff, true, 'quando o Marcos respondeu de verdade, continua pausada');
  assert.equal(agent.repairEchoPauses(), 0, 'rodar de novo não muda nada');
});
