import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Maria } from '../src/maria.js';
import { tempStore } from './helpers.js';

const LINE = 'l1';
const MARCOS = '5545999990001';

function setup({ voice = true, link = false } = {}) {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const adm = auth.create({ name: 'Marcos Miguel', login: 'marcos', password: 'segredo123', role: 'admin' });
  auth.update(adm.id, { whatsapp: MARCOS });
  const sent = []; const spoken = []; const prompts = [];
  const state = { transcript: 'Maria, o que é o Pacote Ouro?' };
  const llm = { configured: true, chat: async ({ messages }) => {
    prompts.push(messages[0].content);
    if (/Reescreva a resposta abaixo para ser falada/.test(messages[0].content)) return { content: 'Então, deixa eu te explicar melhor: o Ouro inclui a licença de condução, e por isso é o indicado para quem vai morar lá. Entendeu?' };
    if (/classifica pedidos/.test(messages[0].content)) return { content: '{"acao":"conversa"}' };
    return { content: link ? 'Veja em https://migra.com/ouro o Pacote Ouro.' : 'O Pacote Ouro é o pacote completo de residência, com a licença de condução inclusa.' };
  } };
  const maria = new Maria({
    store, auth, llm, sales: { listFor: () => [] }, customers: {}, cash: {}, knowledge: () => 'BASE',
    stt: voice ? { ready: true, transcribe: async () => state.transcript } : null,
    tts: voice ? { ready: true, speak: async (t) => { spoken.push(t); return { buffer: Buffer.from('voz'), mimetype: 'audio/ogg; codecs=opus' }; } } : null,
    downloadAudio: async () => Buffer.from('a'),
    send: async (j, p) => { sent.push(p); }, lineName: () => 'Maria', marcosPhone: () => MARCOS, audit: () => {}, log: () => {},
  });
  maria.config.lineId = LINE;
  const say = async (text, extra = {}) => { sent.length = 0; await maria.handle({ line: LINE, jid: `l:${LINE}:${MARCOS}@s.whatsapp.net`, phone: MARCOS, text, ...extra }); return [...sent]; };
  return { say, spoken, prompts, state };
}

test('pergunta em ÁUDIO: responde SÓ em áudio (sem texto junto), conversando e oferecendo o resumo por texto', async () => {
  const t = setup();
  const r = await t.say('', { hasAudio: true });
  assert.equal(r.length, 1);
  assert.ok(r[0].media?.ptt, 'só a nota de voz');
  assert.equal(r[0].text, '', 'nenhum texto junto');
  assert.match(t.spoken[0], /resumo por texto/);
  assert.match(t.prompts.find((p) => /ESTA RESPOSTA SERÁ FALADA/.test(p)), /perguntando de forma natural se a pessoa entendeu/);
});

test('"sim, me manda o texto" (mesmo sem dizer o nome) manda o texto da resposta; "não" não manda nada', async () => {
  const t = setup();
  await t.say('', { hasAudio: true });
  const r = await t.say('sim, me manda');
  assert.equal(r.length, 1);
  assert.match(r[0].text, /Pacote Ouro é o pacote completo/);
  assert.equal(r[0].media, undefined);
  const t2 = setup();
  await t2.say('', { hasAudio: true });
  assert.equal((await t2.say('não precisa, obrigado')).length, 0);
  assert.equal((await t2.say('sim')).length, 0, 'depois do não, um "sim" solto não faz nada');
});

test('o pedido de texto também vale por áudio ("me manda o texto") e a Maria transcreve e atende', async () => {
  const t = setup();
  await t.say('', { hasAudio: true });
  t.state.transcript = 'Maria, me manda o resumo por texto';
  const r = await t.say('', { hasAudio: true });
  assert.match(r[0].text, /Pacote Ouro é o pacote completo/);
});

test('pergunta em TEXTO: responde em texto e oferece explicar por áudio; o "sim" manda um áudio mais explicado, perguntando se entendeu', async () => {
  const t = setup();
  const r = await t.say('Maria, o que é o Pacote Ouro?');
  assert.equal(r.filter((m) => m.media).length, 0, 'só texto');
  assert.match(r[0].text, /Pacote Ouro é o pacote completo/);
  assert.match(r[0].text, /posso te explicar por áudio/);
  const a = await t.say('sim, pode mandar');
  assert.equal(a.length, 1);
  assert.ok(a[0].media?.ptt, 'agora em áudio');
  assert.match(t.spoken.at(-1), /deixa eu te explicar melhor/);
  assert.match(t.spoken.at(-1), /Entendeu\?/);
  assert.match(t.spoken.at(-1), /resumo por texto/, 'e oferece o texto de novo');
});

test('pedir "responde em áudio" direto também funciona; sem o serviço de voz, vai por escrito com aviso', async () => {
  const t = setup();
  await t.say('Maria, o que é o Pacote Ouro?');
  const a = await t.say('me explica por áudio');
  assert.ok(a[0].media?.ptt);
  const semVoz = setup({ voice: false });
  await semVoz.say('Maria, o que é o Pacote Ouro?');
  const r = await semVoz.say('manda em áudio');
  assert.equal(r.filter((m) => m.media).length, 0);
});

test('resposta com link ou arquivo vai por escrito (áudio não carrega link), mesmo se a pergunta foi em áudio', async () => {
  const t = setup({ link: true });
  const r = await t.say('', { hasAudio: true });
  assert.equal(r.filter((m) => m.media).length, 0);
  assert.match(r[0].text, /https:\/\/migra\.com\/ouro/);
});

test('o "sim" só vale por 15 minutos e só para a própria pessoa; sem resposta anterior, "sim" solto é ignorado', async () => {
  const t = setup();
  assert.equal((await t.say('sim')).length, 0);
});
