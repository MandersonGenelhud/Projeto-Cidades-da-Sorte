import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Personal } from '../src/personal.js';
import { Ana, parseAdvanceDays, scopeOf } from '../src/ana.js';
import { Family } from '../src/ana-family.js';
import { Maria } from '../src/maria.js';
import { tempStore } from './helpers.js';

const LINE = 'linha-maria';
const NOW0 = new Date(2026, 10, 6, 10, 0); // sexta, 06/11/2026 10:00
const CAROL9 = '5569992876716'; const CAROL8 = '556992876716'; const D = '5545999990002';

function setup() {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const mand = auth.create({ name: 'Manderson Genel', login: 'manderson', password: 'segredo123', role: 'admin' });
  const marcos = auth.create({ name: 'Marcos Miguel', login: 'marcos', password: 'segredo123', role: 'admin' });
  auth.update(mand.id, { whatsapp: D }); auth.update(marcos.id, { whatsapp: '5545999990001' });
  let clock = new Date(NOW0); const now = () => new Date(clock);
  const family = new Family({ store, auth });
  const carol = family.add({ name: 'Carol', whatsapp: '+5569992876716', linkedUserId: mand.id });
  const personal = new Personal({ store, now });
  const notified = [];
  const ana = new Ana({ store, auth, personal, llm: null, family, now, notify: async (uid, text) => { notified.push({ uid, text }); return true; }, audit: () => {}, log: () => {} });
  const sent = [];
  const maria = new Maria({ store, auth, ana, sales: {}, customers: {}, cash: {}, send: async (j, p) => sent.push({ j, ...p }), lineName: () => 'Maria', marcosPhone: () => '', audit: () => {}, log: () => {}, stt: { ready: false }, tts: { ready: false } });
  maria.config.lineId = LINE;
  const say = async (phone, text) => { sent.length = 0; await maria.handle({ line: LINE, jid: `l:${LINE}:${phone}@s.whatsapp.net`, phone, text }); return sent.filter((m) => m.text || m.media); };
  return { store, auth, personal, ana, family, maria, say, notified, ids: { mand, marcos, carol }, setClock: (d) => { clock = d; } };
}
const carolId = (s) => `fam:${s.ids.carol.id}`;

test('a esposa usa a Ana pelo número da Maria (com ou sem o 9º dígito); sem "Ana," ou com "Maria," ninguém responde; Maria nunca atende pessoa da casa', async () => {
  const s = setup();
  const a = await s.say(CAROL9, 'Ana, me lembre de ligar para a escola amanhã às 9h');
  assert.match(a[0].text, /Anotado, Carol/);
  const b = await s.say(CAROL8, 'Ana, quais são meus compromissos de amanhã?');
  assert.match(b[0].text, /ligar para a escola/i);
  assert.equal((await s.say(CAROL9, 'me lembre de algo amanhã')).length, 0, 'sem chamar pelo nome: silêncio');
  assert.equal((await s.say(CAROL9, 'Maria, qual o caixa de hoje?')).length, 0, 'a Maria não atende pessoa da casa');
  assert.equal((await s.say(CAROL9, 'Mariana, tudo bem?')).length, 0);
  assert.doesNotMatch((await s.say('5569988880000', 'Ana, me lembre de algo amanhã às 9h')).map((m) => m.text).join(' '), /Anotado/, 'número não cadastrado não usa a Ana');
});

test('privacidade: a agenda e o financeiro da Carol e do Manderson são separados; o que um registra o outro não vê', async () => {
  const s = setup();
  await s.say(CAROL9, 'Ana, gastei 200 reais de roupa');
  await s.say(CAROL9, 'Ana, me lembre de comprar o presente amanhã às 15h');
  const d1 = (await s.say(D, 'Ana, como está meu financeiro este mês?'))[0].text;
  assert.doesNotMatch(d1, /200|roupa/);
  const d2 = (await s.say(D, 'Ana, o que tenho amanhã?'))[0].text;
  assert.doesNotMatch(d2, /presente/);
  assert.match((await s.say(CAROL9, 'Ana, como está meu financeiro este mês?'))[0].text, /R\$ 200,00/);
});

test('lista de compras UMA SÓ do casal, com aviso ao outro quando adiciona ou compra', async () => {
  const s = setup();
  await s.say(CAROL9, 'Ana, preciso comprar leite');
  assert.ok(s.notified.some((n) => n.uid === s.ids.mand.id && /Carol adicionou na lista de compras: leite/i.test(n.text)), 'o Manderson foi avisado');
  const lista = (await s.say(D, 'Ana, me mostra minha lista de mercado'))[0].text;
  assert.match(lista, /leite/i, 'a lista é a mesma');
  await s.say(D, 'Ana, acabou o café');
  assert.ok(s.notified.some((n) => n.uid === carolId(s) && /Manderson adicionou na lista de compras: café/i.test(n.text)), 'a Carol foi avisada');
  assert.match((await s.say(CAROL8, 'Ana, me mostra minha lista de compras'))[0].text, /café/i);
  await s.say(D, 'Ana, comprei o leite');
  assert.ok(s.notified.some((n) => n.uid === carolId(s) && /comprou: leite/i.test(n.text)));
  assert.doesNotMatch((await s.say(CAROL9, 'Ana, me mostra minha lista de mercado'))[0].text, /leite/i, 'saiu da lista dos dois');
});

test('"Ana, lembre o Manderson / a Carol": vai para a agenda do outro, que é avisado na hora; vale nos dois sentidos', async () => {
  const s = setup();
  const r = (await s.say(CAROL9, 'Ana, lembre o Manderson de buscar o carro amanhã às 10h'))[0].text;
  assert.match(r, /Vou lembrar Manderson/);
  assert.match(r, /Avisei Manderson agora/);
  const aviso = s.notified.find((n) => n.uid === s.ids.mand.id && /Carol adicionou um lembrete para você/.test(n.text));
  assert.ok(aviso); assert.match(aviso.text, /buscar o carro/i);
  assert.match((await s.say(D, 'Ana, o que tenho amanhã?'))[0].text, /buscar o carro/i);
  assert.doesNotMatch((await s.say(CAROL9, 'Ana, o que tenho amanhã?'))[0].text, /buscar o carro/i, 'não entra na agenda da Carol');
  await s.say(D, 'Ana, lembre minha esposa de pagar o dentista amanhã às 14h');
  assert.ok(s.notified.some((n) => n.uid === carolId(s) && /Manderson adicionou um lembrete para você/.test(n.text)));
  assert.match((await s.say(CAROL8, 'Ana, o que tenho amanhã?'))[0].text, /dentista/i);
  // faltou a data: a pergunta volta para quem pediu e nada é criado
  const q = (await s.say(CAROL9, 'Ana, lembre o Manderson de ligar para o banco'))[0].text;
  assert.match(q, /para quando\?/i);
});

test('contas da casa x pessoais: separadas na soma e na lista de contas a pagar', async () => {
  const s = setup();
  await s.say(CAROL9, 'Ana, gastei 300 reais de mercado da casa');
  await s.say(CAROL9, 'Ana, gastei 50 reais de café pessoal');
  const res = (await s.say(CAROL9, 'Ana, como está meu financeiro este mês?'))[0].text;
  assert.match(res, /da casa R\$ 300,00/);
  assert.match(res, /pessoais R\$ 50,00/);
  await s.say(CAROL9, 'Ana, me lembre de pagar a conta de luz dia 20/11, é da casa');
  await s.say(CAROL9, 'Ana, me lembre de pagar a academia dia 21/11, é pessoal');
  assert.equal(scopeOf('conta da casa'), 'casa'); assert.equal(scopeOf('gasto pessoal'), 'pessoal'); assert.equal(scopeOf('comprar pão'), '');
});

test('avisos antecipados: "2 dias antes e no mesmo dia" é entendido e avisa às 9h; se não disser numa conta, a Ana pergunta', async () => {
  assert.deepEqual(parseAdvanceDays('pagar a luz dia 20, 2 dias antes e no mesmo dia'), { found: true, days: [2, 0] });
  assert.deepEqual(parseAdvanceDays('avisa 1 e 2 dias antes'), { found: true, days: [2, 1] });
  assert.deepEqual(parseAdvanceDays('na véspera'), { found: true, days: [1] });
  assert.equal(parseAdvanceDays('pagar dia 20').found, false);
  const s = setup();
  const r = (await s.say(D, 'Ana, me lembre de pagar a conta de luz dia 20/11, 2 dias antes e no mesmo dia'))[0].text;
  assert.match(r, /Te aviso 2 dias antes e no mesmo dia \(às 9h\)/);
  assert.doesNotMatch(r, /Quer que eu avise antes/);
  assert.match(r, /📅 \*Pagar a conta de luz\*/, 'o título não leva a frase do aviso');
  s.setClock(new Date(2026, 10, 18, 9, 5));
  await s.ana.tick(new Date(2026, 10, 18, 9, 5));
  assert.ok(s.notified.some((n) => n.uid === s.ids.mand.id && /conta de luz\* é daqui a 2 dias/i.test(n.text)), 'avisou 2 dias antes');
  const before = s.notified.length;
  await s.ana.tick(new Date(2026, 10, 18, 9, 6));
  assert.equal(s.notified.length, before, 'uma vez só');
  s.setClock(new Date(2026, 10, 20, 9, 1));
  await s.ana.tick(new Date(2026, 10, 20, 9, 1));
  assert.ok(s.notified.some((n) => /conta de luz\* é hoje/i.test(n.text)), 'e no mesmo dia');
  // sem dizer: ela pergunta e entende a resposta
  const s2 = setup();
  const q = (await s2.say(CAROL9, 'Ana, me lembre de pagar a conta de internet dia 25/11'))[0].text;
  assert.match(q, /Quer que eu avise antes/);
  const ok = (await s2.say(CAROL9, 'Ana, 1 dia antes'))[0].text;
  assert.match(ok, /Te aviso 1 dia antes/);
  await s2.ana.tick(new Date(2026, 10, 24, 9, 2));
  assert.ok(s2.notified.some((n) => n.uid === carolId(s2) && /conta de internet\* é amanhã/i.test(n.text)));
});

test('cadastro da pessoa da casa: valida número, não duplica e o resumo da manhã chega também para ela', async () => {
  const s = setup();
  assert.throws(() => s.family.add({ name: 'X', whatsapp: '123', linkedUserId: s.ids.mand.id }), /WhatsApp inválido/);
  assert.throws(() => s.family.add({ name: 'Outra', whatsapp: CAROL8, linkedUserId: s.ids.marcos.id }), /já está cadastrado/, 'o mesmo número com ou sem o 9');
  assert.throws(() => s.family.add({ name: 'Y', whatsapp: D, linkedUserId: s.ids.marcos.id }), /equipe/);
  assert.throws(() => s.family.add({ name: 'Z', whatsapp: '5569988887777', linkedUserId: s.ids.mand.id }), /já tem alguém ligado/);
  await s.say(CAROL9, 'Ana, me lembre de levar a documentação hoje às 16h');
  s.setClock(new Date(2026, 10, 6, 4, 31));
  await s.ana.tick(new Date(2026, 10, 6, 4, 31));
  assert.ok(s.notified.some((n) => n.uid === carolId(s) && /Sua agenda de hoje/.test(n.text)), 'o resumo da manhã chega para ela');
  s.family.remove(s.ids.carol.id);
  assert.doesNotMatch((await s.say(CAROL9, 'Ana, me lembre de algo amanhã às 9h')).map((m) => m.text).join(' '), /Anotado/, 'removida: a Ana não atende mais');
});
