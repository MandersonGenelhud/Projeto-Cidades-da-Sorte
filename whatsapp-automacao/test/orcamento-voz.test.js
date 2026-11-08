import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeQuoteDelivery } from '../src/quote-delivery.js';
import { Quotes } from '../src/quotes.js';
import { speakable, QUOTE_VOICE_STYLE } from '../src/voice.js';
import { presetSettings } from '../src/agent/presets.js';
import { tempStore } from './helpers.js';

function setup({ tts, ig = false, voiceOn = true, voiceOf = null } = {}) {
  const store = tempStore();
  store.updateSettings(presetSettings('migra-paraguai'));
  if (voiceOn) store.updateSettings({ quotes: { voice: { enabled: true } } });
  const quotes = new Quotes({ store, dataDir: store.dataDir, secret: 's', matchPackage: () => ({ name: 'Pacote Ouro', price: 12997 }) });
  quotes.reserveLink = (r) => `https://app.migra.com/reservar/${r.id}?t=abc`;
  const q = quotes.create({ items: [{ pacote: 'Ouro', quantidade: 1 }], adults: 1, client: 'ana souza', start: '2026-10-29' });
  const sent = []; const mem = []; const logs = [];
  const wa = { send: async (to, payload) => { sent.push({ to, ...payload }); } };
  const agent = { conversation: () => ({}), remember: (c, role, text) => mem.push(text) };
  const key = ig ? 'ig:55' : '5545999990000@s.whatsapp.net';
  const d = makeQuoteDelivery({ quotes, wa, agent, getTts: () => tts, voiceOf, store, speakable, style: QUOTE_VOICE_STYLE, quoteLink: () => 'https://app.migra.com/orcamento/x', log: (l) => logs.push(l), pause: async () => {} });
  return { d, q, key, sent, mem, logs, quotes, store };
}
const okTts = (calls = []) => ({ ready: true, speak: async (text, voice, style) => { calls.push({ text, voice, style }); return { buffer: Buffer.from('opus'), mimetype: 'audio/ogg; codecs=opus' }; } });

test('orçamento: primeiro a mensagem de voz (alegre e calma, voz calorosa), depois o PDF com o botão "pronto para dar entrada"', async () => {
  const calls = [];
  const { d, q, key, sent, mem } = setup({ tts: okTts(calls) });
  const r = await d.deliver({ convKey: key, q, name: 'ana souza' });
  assert.equal(r.voice, true);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].media.ptt, true, 'a voz vai como mensagem de voz');
  assert.match(sent[0].media.mimetype, /^audio\//);
  assert.equal(sent[0].text, '');
  assert.equal(sent[1].media.mimetype, 'application/pdf');
  assert.match(sent[1].media.fileName, /^Orçamento ORC-.*\.pdf$/);
  assert.match(sent[1].text, /^Pronto para dar entrada\? Clique aqui para dar início à sua reserva: https:\/\/app\.migra\.com\/reservar\//);
  assert.doesNotMatch(sent[1].text, /contrato/i);
  assert.equal(calls[0].voice, 'Sulafat');
  assert.match(calls[0].style, /suave/);
  assert.match(calls[0].style, /calmo e pausado/);
  assert.match(calls[0].style, /nunca acelerada nem robótica/);
  assert.match(mem[0], /^\[mensagem de voz com a apresentação do orçamento\]/);
  assert.match(mem[0], /\[PDF do orçamento ORC-.* enviado/);
});

test('o que a voz diz: simpático, curto, com pausas (vírgulas e pontos), sem valores, sem "contrato" e sem prometer nada', async () => {
  const calls = [];
  const { d, q, key } = setup({ tts: okTts(calls) });
  await d.deliver({ convKey: key, q, name: 'ana souza' });
  const t = calls[0].text;
  assert.match(t, /^Oi Ana! Tudo bem\?/);
  assert.match(t, /Preparei o seu orçamento para você\./);
  assert.match(t, /clicar no botão que está no PDF/);
  assert.match(t, /dá entrada na sua reserva/);
  assert.match(t, /Muito sucesso!$/);
  assert.doesNotMatch(t, /carinho|beijo|abraço/i);
  assert.doesNotMatch(t, /contrato|R\$|reais|%|desconto|garant/i);
  assert.ok(t.split(/[.!?]/).filter(Boolean).length >= 6, 'frases curtas, uma de cada vez (a voz respira entre elas)');
  assert.ok(t.length < 520, 'não é um discurso');
  assert.doesNotMatch(t, /beijo/i);
});

test('voz indisponível, desligada ou com erro: segue com o PDF e o texto de antes, sem derrubar o envio; Instagram nunca recebe voz', async () => {
  for (const tts of [null, { ready: false }, { ready: true, speak: async () => { throw new Error('cota do Gemini'); } }]) {
    const { d, q, key, sent, logs } = setup({ tts });
    const r = await d.deliver({ convKey: key, q, name: 'Ana' });
    assert.equal(r.voice, false);
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /^Olá, Ana! Segue o seu orçamento/);
    assert.match(sent[0].text, /clique aqui para dar início à sua reserva/);
    assert.equal(sent[0].media.mimetype, 'application/pdf');
    if (tts?.ready) assert.ok(logs.some((l) => /Voz do orçamento/.test(l.message)));
  }
  const ig = setup({ tts: okTts(), ig: true });
  const r = await ig.d.deliver({ convKey: ig.key, q: ig.q, name: 'Tati' });
  assert.equal(r.voice, false);
  assert.equal(ig.sent.length, 1);
  assert.match(ig.sent[0].text, /Abra o PDF aqui: https:\/\/app\.migra\.com\/orcamento\/x/);
  assert.ok(!ig.sent[0].media, 'Instagram não recebe arquivo nem áudio');
  const off = setup({ tts: okTts() });
  off.store.updateSettings({ quotes: { voice: { enabled: false } } });
  assert.equal((await off.d.deliver({ convKey: off.key, q: off.q, name: 'Ana' })).voice, false, 'dá para desligar a voz');
  const outra = setup({ tts: okTts() });
  outra.store.updateSettings({ quotes: { voice: { voice: 'Achernar' } } });
  const calls = []; const dd = makeQuoteDelivery({ quotes: outra.quotes, wa: { send: async () => {} }, agent: { conversation: () => ({}), remember() {} }, tts: okTts(calls), store: outra.store, speakable, pause: async () => {} });
  await dd.deliver({ convKey: outra.key, q: outra.q, name: 'Ana' });
  assert.equal(calls[0].voice, 'Achernar', 'a voz pode ser trocada por ajuste');
});

test('o que é falado vira palavras (sem dígitos soltos) para a voz não tropeçar', () => {
  const s = speakable('Tudo certo? São 2 pessoas, 15% e R$ 1.800,00 até 12/11.');
  assert.doesNotMatch(s, /\d/);
});

test('voz em espera: por padrão ninguém recebe voz; o administrador liga por perfil de WhatsApp e escolhe a voz de cada atendente', async () => {
  const calls = [];
  const padrao = setup({ tts: okTts(calls), voiceOn: false });
  assert.equal((await padrao.d.deliver({ convKey: padrao.key, q: padrao.q, name: 'Ana' })).voice, false, 'em espera');
  assert.equal(calls.length, 0);
  const lig = setup({ tts: okTts(calls), voiceOn: false, voiceOf: () => ({ on: true, voice: 'Leda' }) });
  assert.equal((await lig.d.deliver({ convKey: lig.key, q: lig.q, name: 'Ana' })).voice, true);
  assert.equal(calls[0].voice, 'Leda', 'cada perfil tem a sua voz');
  const deslig = setup({ tts: okTts(calls), voiceOn: true, voiceOf: () => ({ on: false, voice: 'Leda' }) });
  assert.equal((await deslig.d.deliver({ convKey: deslig.key, q: deslig.q, name: 'Ana' })).voice, false, 'o perfil desligado manda mais que o ajuste geral');
});

test('entrada na reserva: depois do PDF vem a pergunta "vamos dar entrada?" com o link da ficha; sem a palavra contrato', async () => {
  const { d, q, key, sent, mem } = setup({ tts: null });
  const r = await d.deliver({ convKey: key, q, name: 'ana souza', entryAsk: true });
  assert.equal(sent.length, 2);
  assert.equal(sent[0].media.mimetype, 'application/pdf');
  assert.match(sent[0].text, /^Segue o seu orçamento ORC-/);
  assert.match(sent[1].text, /^Vamos dar entrada no seu processo de reserva, Ana\?/);
  assert.match(sent[1].text, /https:\/\/app\.migra\.com\/reservar\//);
  assert.doesNotMatch(sent[1].text, /contrato/i);
  assert.ok(r.ask);
  assert.match(mem[0], /Vamos dar entrada/);
  const ig = setup({ tts: null, ig: true });
  await ig.d.deliver({ convKey: ig.key, q: ig.q, name: 'Tati', entryAsk: true });
  assert.ok(ig.sent.every((m) => !m.media), 'Instagram não recebe arquivo');
});
