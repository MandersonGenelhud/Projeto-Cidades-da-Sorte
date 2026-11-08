import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSilent, buildSilenceText, enqueueSilence, silenceConfig, NUDGE_TEXT } from '../src/silence.js';
import { Agent } from '../src/agent/agent.js';
import { tempStore } from './helpers.js';

const NOW = Date.parse('2026-11-10T15:00:00Z');
const h = (n) => new Date(NOW - n * 3_600_000).toISOString();
const conv = (key, msgs, extra = {}) => ({ key, phone: key.replace(/\D/g, '') || null, name: 'Ana Souza', messages: msgs.map(([role, hours]) => ({ role, content: `${role} ${hours}`, at: h(hours) })), ...extra });
const cfg = silenceConfig({});

test('quem sumiu: chamada de volta depois de 4 h sem resposta; encerramento 24 h depois do aviso; cada fase uma vez só', () => {
  const convs = [
    conv('5545900000001@s.whatsapp.net', [['user', 6], ['assistant', 5.5]]), // 5,5 h sem resposta: chama de volta
    conv('5545900000002@s.whatsapp.net', [['user', 4], ['assistant', 3]]), // só 3 h: ainda cedo
    conv('5545900000003@s.whatsapp.net', [['user', 40], ['assistant', 39], ['assistant', 30]], { silence: { nudgeAt: NOW - 26 * 3_600_000 } }), // aviso há 26 h: encerramento
    conv('5545900000004@s.whatsapp.net', [['user', 40], ['assistant', 30]], { silence: { nudgeAt: NOW - 10 * 3_600_000 } }), // aviso há 10 h: espera
    conv('5545900000005@s.whatsapp.net', [['user', 40], ['assistant', 30]], { silence: { nudgeAt: NOW - 50 * 3_600_000, closeAt: NOW - 20 * 3_600_000 } }), // já encerrado: nada
    conv('5545900000006@s.whatsapp.net', [['assistant', 9]]), // o cliente nunca falou
    conv('5545900000007@s.whatsapp.net', [['assistant', 9], ['user', 8]]), // a vez é nossa, não dele
  ];
  const r = collectSilent({ conversations: convs, now: NOW, cfg });
  assert.deepEqual(r.nudges.map((c) => c.phone), ['5545900000001']);
  assert.deepEqual(r.closings.map((c) => c.phone), ['5545900000003']);
});

test('não incomoda: pessoa assumiu, bloqueado, cliente fechado ou perdido, grupo, simulação, conversa antiga demais e Instagram fora das 24 h', () => {
  const convs = [
    conv('5545900000010@s.whatsapp.net', [['user', 9], ['assistant', 8]], { handoff: true, handoffReason: 'Assumido pelo painel' }),
    conv('5545900000011@s.whatsapp.net', [['user', 9], ['assistant', 8]]),
    conv('5545900000012@s.whatsapp.net', [['user', 9], ['assistant', 8]]),
    conv('120363@g.us', [['user', 9], ['assistant', 8]]), conv('sim:x', [['user', 9], ['assistant', 8]], { simulation: true }),
    conv('5545900000013@s.whatsapp.net', [['user', 24 * 20], ['assistant', 24 * 20 - 1]]),
    conv('ig:55', [['user', 30], ['assistant', 29]], { phone: null }),
    conv('ig:56', [['user', 6], ['assistant', 5]], { phone: null }),
  ];
  const r = collectSilent({ conversations: convs, now: NOW, cfg, isBlocked: (p) => p === '5545900000011', leadOf: (c) => (c.phone === '5545900000012' ? { stage: 'ganho' } : null) });
  assert.deepEqual(r.nudges.map((c) => c.key), ['ig:56']);
});

test('textos: pedem retorno com gentileza, explicam a fila e o prazo de 24 h, sem pedir desculpas', () => {
  const noite = new Date(2026, 10, 10, 22, 0); // hora local, para não depender do fuso da máquina
  const n = buildSilenceText('nudge', { name: 'ana souza', now: noite });
  assert.match(n, /^Boa noite, Ana! Estou entrando em contato para dar continuidade ao seu atendimento\./);
  assert.match(n, /Caso você não tenha mais interesse, já se manifeste/);
  assert.match(n, /demanda está alta/);
  assert.match(n, /fila de espera/);
  assert.match(n, /24 horas/);
  assert.match(n, /finalizar o seu atendimento/);
  // Gatilhos de oportunidade, sempre no condicional: nada de "vai aumentar", data, percentual ou desconto inventado.
  assert.match(n, /é possível que taxas e valores sejam reajustados/);
  assert.match(n, /A oportunidade bate à porta/);
  assert.doesNotMatch(n, /vai aumentar|vão aumentar|\d+ ?%|desconto|últimas vagas|até (hoje|amanhã|sexta)/i);
  assert.match(n, /"sim"/);
  const e = buildSilenceText('encerramento', { name: '', now: new Date(2026, 10, 10, 9, 0) });
  assert.match(e, /^Bom dia\. Como não tive retorno/);
  assert.match(e, /final da fila/);
  assert.match(e, /podem não ser os mesmos/);
  assert.doesNotMatch(n + e, /desculp|perdão/i);
  assert.equal(buildSilenceText('nudge', { name: 'Ana', now: noite, cfg: { nudgeText: 'Oi {nome}, tudo bem?' } }), 'Oi Ana, tudo bem?', 'o texto pode ser trocado pelo painel');
  assert.ok(NUDGE_TEXT.includes('{saudacao}'));
});

test('enfileirar: cria os itens certos, respeita desligado e simulação (dryRun só conta); item que não entrou na fila não fica pendurado', () => {
  const store = tempStore();
  const convs = [conv('5545900000001@s.whatsapp.net', [['user', 6], ['assistant', 5]]), conv('5545900000003@s.whatsapp.net', [['user', 40], ['assistant', 30]], { silence: { nudgeAt: NOW - 26 * 3_600_000 } })];
  const pending = { queue: [], items: {}, enqueue(keys) { this.queue.push(...keys); return { queued: keys.length }; } };
  const dry = enqueueSilence({ store, pending, conversations: convs, now: NOW, dryRun: true });
  assert.deepEqual([dry.nudges, dry.closings, dry.queued], [1, 1, 0]);
  assert.equal(Object.keys(pending.items).length, 0);
  const r = enqueueSilence({ store, pending, conversations: convs, now: NOW });
  assert.equal(r.queued, 2);
  assert.equal(pending.items['5545900000001@s.whatsapp.net'].kind, 'nudge');
  assert.equal(pending.items['5545900000003@s.whatsapp.net'].kind, 'encerramento');
  assert.ok(Object.values(pending.items).every((i) => i.noOpening && i.restart === false));
  store.updateSettings({ agent: { silence: { enabled: false } } });
  assert.equal(enqueueSilence({ store, pending: { queue: [], items: {}, enqueue: () => ({}) }, conversations: convs, now: NOW }).off, true);
  const recusa = { queue: [], items: {}, enqueue: () => ({ queued: 0 }) }; // número desconectado: nada entra
  store.updateSettings({ agent: { silence: { enabled: true } } });
  enqueueSilence({ store, pending: recusa, conversations: convs, now: NOW });
  assert.equal(Object.keys(recusa.items).length, 0);
});

test('quando o cliente volta a falar o silêncio acaba (e quem tinha recebido o encerramento é recebido de volta com simpatia)', async () => {
  const store = tempStore();
  store.updateSettings({ agent: { enabled: true, audience: 'all', triagePending: false, workHours: { enabled: false } } });
  const seen = [];
  const llm = { configured: true, chat: async ({ messages }) => { seen.push(messages[0].content); return { content: 'Que bom que você voltou!', tool_calls: [] }; } };
  const agent = new Agent({ store, llm, calendar: null });
  const key = '5545900000003@s.whatsapp.net';
  store.data.conversations[key] = conv(key, [['user', 40], ['assistant', 30]], { silence: { nudgeAt: Date.now() - 30 * 3_600_000, closeAt: Date.now() - 5 * 3_600_000 } });
  const sent = [];
  await agent.handleIncoming({ key, phone: '5545900000003', name: 'Ana', text: 'oi, voltei' }, async (t) => sent.push(t));
  assert.equal(store.data.conversations[key].silence, undefined, 'o silêncio foi zerado');
  assert.equal(sent.length >= 1, true);
  assert.match(seen.at(-1), /CLIENTE VOLTOU DEPOIS DO AVISO DE ENCERRAMENTO/);
  // Sem o aviso de encerramento, só zera.
  const k2 = '5545900000004@s.whatsapp.net';
  store.data.conversations[k2] = conv(k2, [['user', 40], ['assistant', 30]], { silence: { nudgeAt: Date.now() - 3_600_000 } });
  await agent.handleIncoming({ key: k2, phone: '5545900000004', name: 'Bia', text: 'estou aqui' }, async () => {});
  assert.equal(store.data.conversations[k2].silence, undefined);
  assert.doesNotMatch(seen.at(-1), /VOLTOU DEPOIS DO AVISO/);
});

test('IA que falha: tenta de novo antes de desistir, não apaga a mensagem do cliente e avisa a fila para tentar mais tarde', async () => {
  const store = tempStore();
  store.updateSettings({ agent: { enabled: true, audience: 'all', triagePending: false } });
  let calls = 0;
  const llm = { configured: true, chat: async () => { calls++; if (calls <= 2) throw new Error('Google Gemini: limite por minuto'); return { content: 'Oi! Como posso ajudar?', tool_calls: [] }; } };
  const agent = new Agent({ store, llm, calendar: null });
  const key = '5545900000020@s.whatsapp.net';
  const sent = [];
  await agent.handleIncoming({ key, phone: '5545900000020', name: 'Carla', text: 'quero iniciar' }, async (t) => sent.push(t));
  assert.equal(calls, 3, 'duas falhas e a terceira tentativa respondeu');
  assert.equal(sent.length >= 1, true, 'o cliente foi respondido sem precisar mandar de novo');
  assert.equal(store.data.conversations[key].aiFailedAt, undefined);

  // Falha em todas as tentativas: nada é enviado, a mensagem do cliente continua guardada e o gancho de recuperação é chamado.
  calls = -100;
  const llm2 = { configured: true, chat: async () => { throw new Error('modelo indisponível'); } };
  const agent2 = new Agent({ store: tempStore(), llm: llm2, calendar: null });
  agent2.store.updateSettings({ agent: { enabled: true, audience: 'all', triagePending: false } });
  const falhou = [];
  agent2.onFailed = (c) => falhou.push(c.key);
  const enviados = [];
  await agent2.handleIncoming({ key, phone: '5545900000020', name: 'Carla', text: 'oi, tem alguém?' }, async (t) => enviados.push(t));
  assert.equal(enviados.length, 0, 'nunca manda mensagem de erro ao cliente');
  assert.deepEqual(falhou, [key]);
  const conv = agent2.store.data.conversations[key];
  assert.equal(conv.messages.at(-1).content, 'oi, tem alguém?', 'a mensagem do cliente NÃO foi apagada');
  assert.ok(conv.aiFailedAt);
  // A fila devolve a mesma mensagem: não grava duas vezes.
  agent2.llm = { configured: true, chat: async () => ({ content: 'Estou aqui!', tool_calls: [] }) };
  await agent2.handleIncoming({ key, phone: '5545900000020', name: 'Carla', text: 'oi, tem alguém?' }, async (t) => enviados.push(t));
  assert.equal(conv.messages.filter((m) => m.role === 'user').length, 1);
  assert.equal(enviados.length >= 1, true);
});

test('eco de mídia: imagem/áudio/PDF logo depois de uma resposta da própria IA não pausa a conversa; mensagem do dono depois disso pausa', () => {
  const store = tempStore();
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  const agent = new Agent({ store, llm: { configured: true, chat: async () => ({ content: 'x', tool_calls: [] }) }, calendar: null });
  const key = '5545900000030@s.whatsapp.net';
  const c = agent.conversation(key);
  agent.remember(c, 'assistant', 'Segue o QR Code do Pix');
  agent.ownerReplied({ key, phone: '5545900000030', text: '' }); // eco da imagem que o sistema mandou
  assert.equal(c.handoff, false, 'não pausou');
  c.messages.at(-1).at = new Date(Date.now() - 120_000).toISOString(); // a resposta da IA foi há 2 min
  agent.ownerReplied({ key, phone: '5545900000030', text: 'Oi, aqui é o Marcos, já te respondo' });
  assert.equal(c.handoff, true, 'o dono falando de verdade continua pausando');
});

import { stallReport } from '../src/ai-stalls.js';
test('relatório "por que parou": cada conversa sem resposta mostra o motivo', () => {
  const t = (n) => new Date(NOW - n * 3_600_000).toISOString();
  const c = (key, extra = {}) => ({ key, phone: key.replace(/\D/g, '') || null, name: key, messages: [{ role: 'assistant', content: 'oi', at: t(5) }, { role: 'user', content: 'quero iniciar', at: t(2) }], ...extra });
  const convs = [
    c('5545900000001@s.whatsapp.net', { handoff: true, handoffReason: 'Você respondeu pelo celular' }), c('5545900000002@s.whatsapp.net', { aiFailedAt: NOW }), c('5545900000003@s.whatsapp.net'),
    c('5545900000004@s.whatsapp.net'), c('5545900000005@s.whatsapp.net', { messages: [{ role: 'user', content: 'oi', at: t(1) }, { role: 'assistant', content: 'olá', at: t(0.5) }] }),
  ];
  const r = stallReport({ conversations: convs, pending: { queue: ['5545900000003@s.whatsapp.net'], items: {} }, agentCfg: { workHours: { enabled: false } }, isBlocked: (p) => p === '5545900000004', now: NOW });
  const por = Object.fromEntries(r.rows.map((x) => [x.phone, x.codigo]));
  assert.deepEqual(por, { 5545900000001: 'pausada', 5545900000002: 'ia_falhou', 5545900000003: 'na_fila', 5545900000004: 'bloqueado' });
  assert.match(r.rows.find((x) => x.codigo === 'pausada').motivo, /Você respondeu pelo celular/);
  assert.equal(r.total, 4, 'quem já foi respondido não aparece');
  const sem = stallReport({ conversations: [c('5545900000009@s.whatsapp.net')], agentCfg: { workHours: { enabled: false } }, now: NOW });
  assert.equal(sem.rows[0].codigo, 'sem_motivo');
});

import { buildSystemPrompt } from '../src/agent/prompt.js';
import { Store } from '../src/store.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('gatilhos confirmados pela direção: alta procura e possibilidade de reajuste entram nos argumentos de venda, sem data nem percentual; o que a direção escreveu não é trocado', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-gatilho-'));
  const a = new Store(dir);
  assert.match(a.settings.business.demand, /fila de espera/);
  assert.match(a.settings.business.priceIncrease, /é possível que taxas e valores sejam reajustados/);
  assert.match(a.settings.business.priceIncrease, /nunca "vai aumentar"/);
  assert.doesNotMatch(a.settings.business.priceIncrease, /\d{1,2}\/\d{1,2}|\d+ ?%/);
  const prompt = buildSystemPrompt(a.settings, { now: new Date('2026-11-10T12:00:00Z') });
  assert.match(prompt, /Alta procura e fila de espera \(confirmado pela direção\)/);
  assert.match(prompt, /Reajuste previsto \(confirmado pela direção\)/);
  // Instalação em que o Marcos já escreveu o próprio texto: não é sobrescrito.
  a.updateSettings({ business: { priceIncrease: 'Reajuste de 10% em janeiro (texto do Marcos)' } });
  a.data.triggers2026 = false; a.flush();
  const b = new Store(dir);
  assert.equal(b.settings.business.priceIncrease, 'Reajuste de 10% em janeiro (texto do Marcos)');
  assert.equal(b.data.triggers2026, true);
});
