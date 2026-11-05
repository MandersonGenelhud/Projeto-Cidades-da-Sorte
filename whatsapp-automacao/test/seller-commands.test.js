import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, parseWhen, extractContractArgs, makeSellerCommands } from '../src/seller-commands.js';

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

function setup(sendContract, extra = {}, owner = { name: 'Ana', whatsapp: '595981000001', role: 'seller', id: 'u1' }) {
  const calls = { say: [], tell: [], revoke: [], audit: [], handoff: [], tasks: [] };
  const conv = { key: 'line:ab:5511999990000@s.whatsapp.net', name: 'Paula', messages: [] };
  const cmds = makeSellerCommands({
    agent: { conversation: () => conv }, packages: () => packages, contractFlow: { sendContract },
    say: async (k, t) => calls.say.push([k, t]), tell: async (o, t) => calls.tell.push([o?.name, t]),
    revoke: async (j, id) => calls.revoke.push([j, id]), ownerOf: () => owner, audit: (t) => calls.audit.push(t),
    setHandoff: (k, v, r) => calls.handoff.push([k, v, r]), addTask: (u, b) => { calls.tasks.push([u.name, b]); return { title: b.title }; },
    sendQuote: async () => ({ numero: 'ORC-1' }), sendForm: async () => ({ link: 'https://x/ficha/9' }), contractSummary: (p) => (p === '5511999990000' ? 'Contrato 1: pago 50%' : ''),
    digest: () => 'Vencidas: 3', health: () => 'Saúde: tudo certo', now: () => new Date(2026, 10, 5, 10, 0), ...extra,
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

test('atalhos: lista de comandos conhecidos; desconhecido ou fora do começo é texto comum', () => {
  for (const c of ['orcamento', 'orçamento', 'ficha', 'ia', 'pausa', 'lembrar', 'status', 'ajuda', 'resumo', 'saude', 'saúde']) assert.ok(parseCommand(`/${c} x`), c);
  assert.equal(parseCommand('/qualquercoisa'), null);
  assert.equal(parseCommand('http://site.com/ia'), null);
});

test('/lembrar: entende hoje, amanhã, dia da semana, dd/mm e horário', () => {
  const now = new Date(2026, 10, 5, 10, 0); // quinta, 05/11/2026
  assert.deepEqual(parseWhen('amanhã 14h ligar para ele', now), { due: '2026-11-06', time: '14:00', title: 'ligar para ele' });
  assert.deepEqual(parseWhen('hoje às 16:30 enviar contrato', now), { due: '2026-11-05', time: '16:30', title: 'enviar contrato' });
  assert.equal(parseWhen('segunda cobrar parcela', now).due, '2026-11-09');
  assert.equal(parseWhen('20/11 retornar', now).due, '2026-11-20');
  assert.equal(parseWhen('só lembrar dele', now).due, '');
});

test('atalhos do consultor: ficha, ia, pausa, lembrar, status e ajuda', async () => {
  const a = setup(async () => ({}));
  await a.cmds.handle(msg('/ficha'));
  assert.match(a.calls.say[0][1], /https:\/\/x\/ficha\/9/);
  await a.cmds.handle(msg('/pausa')); await a.cmds.handle(msg('/ia'));
  assert.deepEqual(a.calls.handoff.map((h) => h[1]), [true, false]);
  await a.cmds.handle(msg('/lembrar amanhã 14h ligar'));
  assert.equal(a.calls.tasks[0][1].due, '2026-11-06');
  assert.match(a.calls.tasks[0][1].title, /ligar \(Paula\) às 14:00/);
  await a.cmds.handle(msg('/status'));
  assert.match(a.calls.tell.at(-1)[1], /pago 50%/);
  await a.cmds.handle(msg('/ajuda'));
  assert.match(a.calls.tell.at(-1)[1], /\/contrato/);
  assert.doesNotMatch(a.calls.tell.at(-1)[1], /\/resumo/, 'consultor não vê os atalhos do administrador');
  assert.equal(a.calls.revoke.length, 6, 'todos os comandos somem da conversa do cliente');
});

test('/orcamento: usa o pacote do comando; sem pacote o consultor recebe a dica e nada vai ao cliente', async () => {
  const a = setup(async () => ({}));
  await a.cmds.handle(msg('/orcamento residência 2 pessoas'));
  assert.match(a.calls.tell.at(-1)[1], /Orçamento ORC-1 de Paula enviado/);
  await a.cmds.handle(msg('/orcamento'));
  assert.match(a.calls.tell.at(-1)[1], /não achei o pacote/);
  assert.equal(a.calls.say.length, 0);
});

test('atalhos de administração: /resumo e /saude só para administrador; na conversa "Você" não apaga nada', async () => {
  const seller = setup(async () => ({}));
  await seller.cmds.handle(msg('/resumo'));
  assert.match(seller.calls.tell[0][1], /só do administrador/);
  const admin = setup(async () => ({}), {}, { name: 'Marcos', whatsapp: '595987101567', role: 'admin', id: 'a1' });
  await admin.cmds.handle({ jid: 'self', phone: '595987101567', text: '/resumo' }, { self: true });
  await admin.cmds.handle({ jid: 'self', phone: '595987101567', text: '/saude' }, { self: true });
  await admin.cmds.handle({ jid: 'self', phone: '595987101567', text: '/ficha' }, { self: true });
  assert.equal(admin.calls.tell[0][1], 'Vencidas: 3');
  assert.equal(admin.calls.tell[1][1], 'Saúde: tudo certo');
  assert.match(admin.calls.tell[2][1], /digite na conversa do cliente/);
  assert.equal(admin.calls.revoke.length, 0);
});
