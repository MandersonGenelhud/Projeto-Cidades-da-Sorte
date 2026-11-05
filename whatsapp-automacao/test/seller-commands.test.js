import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, extractContractArgs, makeSellerCommands } from '../src/seller-commands.js';

const packages = [{ name: 'Cédula de Identidade' }, { name: 'Residência Permanente' }];

test('atalho: reconhece /contrato no começo da mensagem e ignora o resto', () => {
  assert.deepEqual(parseCommand('/contrato residência 2 pessoas'), { cmd: 'contrato', rest: 'residência 2 pessoas' });
  assert.deepEqual(parseCommand('  /CONTRATO'), { cmd: 'contrato', rest: '' });
  assert.equal(parseCommand('vou mandar o contrato amanhã'), null);
  assert.equal(parseCommand('veja /contrato depois'), null);
});

test('atalho: pacote e pessoas vêm do texto do consultor; senão a IA lê a conversa (só pacote válido)', async () => {
  assert.deepEqual(await extractContractArgs({ packages, rest: 'residencia permanente 3 pessoas 2 adultos' }), { pacote: 'Residência Permanente', pessoas: 3, adultos: 2 });
  const conv = { messages: [{ role: 'user', content: 'quero a cédula para mim e minha esposa' }, { role: 'assistant', content: 'fechado, cédula para 2' }] };
  const llm = { configured: true, chat: async () => ({ content: '```json\n{"pacote":"Cédula de Identidade","pessoas":2,"adultos":2}\n```' }) };
  assert.deepEqual(await extractContractArgs({ llm, conv, packages }), { pacote: 'Cédula de Identidade', pessoas: 2, adultos: 2 });
  const inventado = { configured: true, chat: async () => ({ content: '{"pacote":"Pacote Inexistente","pessoas":1}' }) };
  assert.equal((await extractContractArgs({ llm: inventado, conv, packages })).pacote, undefined, 'não aceita pacote fora da lista');
  const quebrado = { configured: true, chat: async () => ({ content: 'não sei' }) };
  assert.deepEqual(await extractContractArgs({ llm: quebrado, conv, packages }), {});
});

function setup(sendContract) {
  const calls = { say: [], tell: [], revoke: [], audit: [] };
  const conv = { key: 'line:ab:5511999990000@s.whatsapp.net', name: 'Paula', messages: [] };
  const cmds = makeSellerCommands({
    agent: { conversation: () => conv }, packages: () => packages, contractFlow: { sendContract },
    say: async (k, t) => calls.say.push([k, t]), tell: async (o, t) => calls.tell.push([o?.name, t]),
    revoke: async (j, id) => calls.revoke.push([j, id]), ownerOf: () => ({ name: 'Ana', whatsapp: '595981000001' }), audit: (t) => calls.audit.push(t),
  });
  return { cmds, calls, conv };
}
const msg = (text) => ({ jid: 'line:ab:5511999990000@s.whatsapp.net', id: 'MSGID1', phone: '5511999990000', text });

test('atalho: contrato gerado → comando apagado da conversa do cliente e consultor avisado', async () => {
  let got;
  const { cmds, calls } = setup(async (c, args) => { got = args; return { ok: true, enviado: true }; });
  assert.equal(await cmds.handle(msg('/contrato cédula 2 pessoas')), true);
  assert.deepEqual(calls.revoke, [['line:ab:5511999990000@s.whatsapp.net', 'MSGID1']]);
  assert.equal(got.pacote, 'Cédula de Identidade');
  assert.match(calls.tell[0][1], /Contrato de Paula gerado e enviado/);
  assert.equal(calls.say.length, 0);
});

test('atalho: faltam dados → ficha vai para o cliente; erro → consultor recebe o motivo e a dica', async () => {
  const a = setup(async () => ({ ok: true, precisaDados: true, link: 'https://x/ficha/1' }));
  await a.cmds.handle(msg('/contrato'));
  assert.match(a.calls.say[0][1], /https:\/\/x\/ficha\/1/);
  assert.match(a.calls.tell[0][1], /faltam os dados/);
  const b = setup(async () => ({ erro: 'Ainda não há orçamento para este cliente' }));
  await b.cmds.handle(msg('/contrato'));
  assert.match(b.calls.tell[0][1], /não consegui\. Ainda não há orçamento/);
  assert.match(b.calls.tell[0][1], /Dica: escreva o pacote/);
  assert.equal(b.calls.say.length, 0, 'nada vai para o cliente quando dá erro');
  const c = setup(async () => { throw new Error('quebrou'); });
  await c.cmds.handle(msg('/contrato'));
  assert.match(c.calls.tell[0][1], /quebrou/);
});

test('atalho: texto comum não é comando', async () => {
  const { cmds, calls } = setup(async () => ({}));
  assert.equal(await cmds.handle(msg('oi, tudo bem?')), false);
  assert.equal(calls.revoke.length, 0);
});
