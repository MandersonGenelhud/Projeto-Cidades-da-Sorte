import test from 'node:test';
import assert from 'node:assert/strict';
import { isMomentPhrase, makeSellerCommands } from '../src/seller-commands.js';

test('"Só um momento" e variações curtas são o atalho; frases maiores não', () => {
  for (const t of ['Só um momento', 'só um momento.', 'So um momento!', 'Só um momentinho', 'Um momento, por favor', 'um momento', 'Só 1 momento…']) assert.ok(isMomentPhrase(t), t);
  for (const t of ['Só um momento que vou ver o valor do terreno', 'momento', 'Bom dia', 'Em um momento oportuno conversamos', '/ia']) assert.ok(!isMomentPhrase(t), t);
});

function setup(resumeAI) {
  const calls = { revoke: 0, resume: 0, tell: [] };
  const cmds = makeSellerCommands({
    agent: { conversation: () => ({ messages: [] }) }, packages: () => [], contractFlow: {}, say: async () => {},
    tell: async (o, t) => calls.tell.push(t), revoke: async () => { calls.revoke += 1; }, ownerOf: () => ({ name: 'Giovana', role: 'seller' }),
    setHandoff: () => {}, resumeAI: resumeAI || (async () => { calls.resume += 1; return { ok: true }; }),
  });
  return { cmds, calls };
}

test('"Só um momento" na conversa: a IA assume, a frase NÃO é apagada (o cliente vê uma frase normal)', async () => {
  const { cmds, calls } = setup();
  const msg = { jid: 'l:geo:5545988880001@s.whatsapp.net', phone: '5545988880001', id: 'X1', text: 'Só um momento' };
  assert.equal(cmds.wants(msg), true);
  assert.equal(await cmds.handle(msg), true);
  assert.equal(calls.resume, 1);
  assert.equal(calls.revoke, 0, 'não apaga');
  assert.equal(calls.tell.length, 0, 'não incomoda o consultor quando dá certo');
});

test('se a IA não pode assumir (ex.: desligada no número), o consultor é avisado', async () => {
  const { cmds, calls } = setup(async () => ({ erro: 'A IA está desligada neste número' }));
  await cmds.handle({ jid: 'l:geo:1@s.whatsapp.net', phone: '1', text: 'só um momento' });
  assert.match(calls.tell[0], /IA está desligada/);
});
