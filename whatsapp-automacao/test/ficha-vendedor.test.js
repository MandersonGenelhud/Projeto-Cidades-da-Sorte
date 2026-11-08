import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fullConversation, questionAnswers, clientBrief } from '../src/lead-brief.js';
import { totpCode } from '../src/security.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const J = { 'content-type': 'application/json' };
const ck = (r) => r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const NOW = Date.parse('2026-11-10T15:00:00Z');
const at = (h) => new Date(NOW - h * 3_600_000).toISOString();
const m = (role, content, h) => ({ role, content, at: at(h) });

test('conversa completa: junta Instagram e WhatsApp do mesmo prospecto em ordem de tempo, sem cortar nas 40 últimas', () => {
  const convs = {
    'ig:1': { messages: [m('user', 'oi, quero morar no Paraguai', 50), m('assistant', 'Olá! Você tem o valor para começar?', 49.9), m('user', 'tenho o valor', 49.8)] },
    '5545900000001@s.whatsapp.net': { messages: [m('user', 'Oi, vim pelo Instagram, código MIG-ABCD', 10)] },
  };
  const lead = { conversationKey: 'ig:1', whatsappKey: '5545900000001@s.whatsapp.net' };
  const f = fullConversation(lead, (k) => convs[k]);
  assert.equal(f.total, 4);
  assert.deepEqual(f.messages.map((x) => x.channel), ['Instagram', 'Instagram', 'Instagram', 'WhatsApp']);
  assert.deepEqual(f.messages.map((x) => x.who), ['cliente', 'atendimento', 'cliente', 'cliente']);
  const longa = { messages: Array.from({ length: 120 }, (_, i) => m(i % 2 ? 'assistant' : 'user', `msg ${i}`, 200 - i)) };
  assert.equal(fullConversation({ conversationKey: 'k' }, () => longa).messages.length, 120, 'mais de 40 mensagens aparecem');
  assert.deepEqual(fullConversation({ conversationKey: 'x' }, () => null).messages, []);
});

test('o que ele respondeu quando perguntamos: pares pergunta e resposta, ignorando avisos internos', () => {
  const msgs = fullConversation({ conversationKey: 'k' }, () => ({ messages: [
    m('user', 'quero cédula', 9), m('assistant', 'Ótimo! Quantas pessoas vão?', 8.9), m('user', 'somos 2', 8.8), m('user', 'eu e minha esposa', 8.7),
    m('assistant', '[Pix de 1800 enviado: QR Code]', 8), m('assistant', 'Você tem o valor para começar? Posso te mostrar as opções.', 7), m('user', 'tenho o valor', 6),
    m('assistant', 'Perfeito, vou chamar o consultor.', 5),
  ] })).messages;
  const qa = questionAnswers(msgs);
  assert.equal(qa.length, 2);
  assert.equal(qa[0].question, 'Quantas pessoas vão?');
  assert.equal(qa[0].answer, 'somos 2 / eu e minha esposa');
  assert.equal(qa[1].question, 'Você tem o valor para começar?');
  assert.equal(qa[1].answer, 'tenho o valor');
});

test('Conheça o cliente: só fatos registrados (primeiro contato, peneira, orçamento, contrato, Pix, última mensagem)', () => {
  const lead = { id: 'L1', conversationKey: 'ig:1', adTitle: 'Anúncio Ouro', interest: 'Pacote Ouro', people: 2, value: 25994, qualification: { money: 'tem', moneyEvidence: 'tenho o valor', start: 'agora', objections: 'prazo' }, aiSummary: 'Aposentada, quer se mudar logo.', city: 'Cascavel' };
  const messages = fullConversation(lead, () => ({ messages: [m('user', 'oi', 30), m('assistant', 'Olá! Tem o valor?', 29), m('user', 'tenho o valor', 28), m('assistant', 'Segue o orçamento', 27)] })).messages;
  const quotes = [{ leadId: 'L1', number: 'ORC-2026-1', validUntil: '2026-11-11', plan: { total: 25994 }, contract: { status: 'enviado' } }];
  const payments = [{ leadId: 'L1', status: 'pending', amount: 1800 }];
  const b = clientBrief({ lead, messages, quotes, payments, now: NOW });
  const f = Object.fromEntries(b.facts.map((x) => [x.label, x.value]));
  assert.match(f['Primeiro contato'], /pelo Instagram \(anúncio: Anúncio Ouro\)/);
  assert.equal(f['Primeira frase dele'], '"oi"');
  assert.match(f.Dinheiro, /disse: "tenho o valor"/);
  assert.equal(f.Cidade, 'Cascavel');
  assert.ok(b.status.some((x) => /ORC-2026-1 de R\$ 25\.994,00: vence em 1 dia/.test(x)));
  assert.ok(b.status.includes('Contrato enviado, ainda sem assinatura.'));
  assert.ok(b.status.some((x) => /Pix em aberto: R\$ 1\.800,00/.test(x)));
  assert.ok(b.status.some((x) => /última mensagem é nossa/.test(x)));
  assert.deepEqual(b.counts, { total: 4, cliente: 2, atendimento: 2 });
  const vazio = clientBrief({ lead: { id: 'L2' }, messages: [], now: NOW });
  assert.ok(vazio.status.includes('Ainda não recebeu orçamento.'));
  assert.deepEqual(vazio.facts, []);
});

test('ficha pelo painel: o vendedor dono vê a conversa completa e o resumo; outro vendedor não vê; administrador vê', async (t) => {
  const { Store } = await import('../src/store.js');
  const { Auth } = await import('../src/auth.js');
  const { Crm } = await import('../src/crm.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-ficha-'));
  const store = new Store(dir);
  const crm = new Crm({ store, auth: new Auth({ store, dataDir: dir }) });
  store.data.conversations['ig:1'] = { key: 'ig:1', username: 'tati.costa', messages: Array.from({ length: 90 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: i % 2 ? `Pergunta ${i}?` : `Resposta ${i}`, at: new Date(NOW - (200 - i) * 60_000).toISOString() })), updatedAt: new Date().toISOString() };
  const lead = crm.ensureFromConversation({ key: 'ig:1', username: 'tati.costa', name: 'Tatiane Costa', channel: 'instagram' });
  store.flush();
  const port = 40050 + Math.floor(Math.random() * 40);
  const base = `http://127.0.0.1:${port}`;
  const proc = spawn(process.execPath, ['src/server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: String(port), TUNNEL: 'off', OPEN_BROWSER: '' }, stdio: 'ignore' });
  t.after(() => proc.kill());
  for (let i = 0; i < 60; i++) { try { await fetch(`${base}/api/auth/state`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const login = async (user, first) => {
    const body = JSON.stringify({ name: user, login: user, password: 'segredo123', whatsapp: '595987101567' });
    const r = first ? await fetch(`${base}/api/auth/setup`, { method: 'POST', headers: J, body }) : await fetch(`${base}/api/auth/login`, { method: 'POST', headers: J, body });
    let cookie = ck(r);
    const call = (u, mt = 'GET', b) => fetch(base + u, { method: mt, headers: { cookie, ...J }, body: b ? JSON.stringify(b) : undefined });
    const sec = await (await call('/api/security/2fa/setup')).json();
    cookie = ck(await call('/api/security/2fa/enable', 'POST', { code: totpCode(sec.secret) })) || cookie;
    return call;
  };
  const marcos = await login('marcos', true);
  const ids = {};
  for (const n of ['ana', 'bia']) { const u = await (await marcos('/api/users', 'POST', { name: n, login: n, password: 'segredo123', role: 'seller' })).json(); ids[n] = u.id || u.user?.id; }
  const ana = await login('ana'); const bia = await login('bia');
  const users = await (await marcos('/api/users')).json();
  const anaId = (users.users || users).find((u) => u.login === 'ana').id;
  assert.equal((await marcos(`/api/leads/${lead.id}/assign`, 'POST', { ownerId: anaId })).status, 200);
  const r = await ana(`/api/leads/${lead.id}`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.conversation.length, 90, 'a conversa inteira, não só as 40 últimas');
  assert.equal(j.conversationTotal, 90);
  assert.ok(j.brief.qa.length > 0 && j.brief.facts.some((x) => x.label === 'Primeiro contato'));
  assert.equal((await bia(`/api/leads/${lead.id}`)).status, 403, 'outro vendedor não vê a conversa');
  assert.equal((await marcos(`/api/leads/${lead.id}`)).status, 200);
  assert.equal((await ana(`/api/leads/${encodeURIComponent(lead.code)}`)).status, 200, 'abre também pelo código');
});
