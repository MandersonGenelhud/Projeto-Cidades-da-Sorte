import test from 'node:test';
import assert from 'node:assert/strict';
import { noticeCandidates, noticeText, topicOf, MARCOS_NEW } from '../src/marcos-notice.js';

const NOW = new Date('2026-11-13T15:00:00Z').getTime();
const c = (n, extra = {}) => ({ key: `55459888800${n}@s.whatsapp.net`, phone: `55459888800${n}`, name: `Cliente ${n}`, updatedAt: '2026-11-10T12:00:00Z', messages: [{ role: 'user', content: 'quero a residência' }], ...extra });

test('quem recebe: só quem conversou com o Marcos no número antigo, recente, sem repetir e sem equipe, bloqueado, grupo ou recusa', () => {
  const convs = [
    c('01'), c('01', { key: 'outra-chave' }), // mesmo telefone: uma vez só
    c('02', { key: 'l:geo:554598880002@s.whatsapp.net' }), // número de vendedor: não é do Marcos
    c('03', { updatedAt: '2026-08-01T12:00:00Z' }), // antiga demais
    c('04', { messages: [{ role: 'assistant', content: 'oi' }] }), // a pessoa nunca falou
    c('05', { declined: { kind: 'sem_interesse' } }),
    c('06'), c('07'), c('08'),
    { key: '120363@g.us', messages: [{ role: 'user', content: 'oi' }], updatedAt: '2026-11-10T12:00:00Z' },
  ];
  const list = noticeCandidates(convs, { now: NOW, days: 30, done: { 5545988880008: 'x' }, isTeam: (p) => p.endsWith('06'), isBlocked: (p) => p.endsWith('07') });
  assert.deepEqual(list.map((x) => x.phone), ['5545988880001']);
});

test('mensagem: saudação, Maria do Grupo Migra, o que aconteceu, vídeo do Marcos, assunto e o link do número novo', () => {
  const t = noticeText({ name: 'Edval Souza', assunto: 'a sua documentação no Paraguai' });
  assert.match(t, /^(Bom dia|Boa tarde|Boa noite), Edval! Aqui é a Maria, do atendimento do Grupo Migra\. O WhatsApp antigo do Marcos parou de funcionar/);
  assert.match(t, /vídeo no Instagram: https:\/\/www\.instagram\.com\/reel\/DfpZGadT-hW\//);
  assert.doesNotMatch(t, /obrf=/, 'sem o rastreio do link');
  assert.match(t, /estavam conversando sobre a sua documentação no Paraguai/);
  assert.match(t, new RegExp(`https://wa\\.me/${MARCOS_NEW}$`));
  assert.doesNotMatch(noticeText({ video: '' }), /Instagram/, 'sem vídeo configurado, a frase sai');
  assert.ok(t.length < 520, 'curta');
});

test('assunto: interesse registrado primeiro; senão pistas do que a pessoa falou; senão vazio', () => {
  assert.equal(topicOf({ interest: 'Pacote Ouro' }, {}), 'Pacote Ouro');
  assert.equal(topicOf(null, { messages: [{ role: 'user', content: 'tem terreno em Hernandarias?' }] }), 'imóveis no Paraguai');
  assert.equal(topicOf(null, { messages: [{ role: 'user', content: 'oi tudo bem' }] }), '');
});
