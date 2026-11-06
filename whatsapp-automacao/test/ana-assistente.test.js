import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Personal } from '../src/personal.js';
import { Ana } from '../src/ana.js';
import { Maria } from '../src/maria.js';
import { storeOf, storeFromName, parseShoppingItems } from '../src/shopping.js';
import { tempStore } from './helpers.js';

const LINE = 'l1';
const NOW0 = new Date(2026, 10, 6, 10, 0); // sexta, 06/11/2026

function setup({ llm = null } = {}) {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const marcos = auth.create({ name: 'Marcos Miguel', login: 'marcos', password: 'segredo123', role: 'admin' });
  const mand = auth.create({ name: 'Manderson Genel', login: 'manderson', password: 'segredo123', role: 'admin' });
  auth.update(marcos.id, { whatsapp: '5545999990001' }); auth.update(mand.id, { whatsapp: '5545999990002' });
  let clock = new Date(NOW0);
  const now = () => new Date(clock);
  const personal = new Personal({ store, now });
  const ana = new Ana({ store, auth, personal, llm, now, notify: async () => true });
  const sent = [];
  const maria = new Maria({ store, auth, ana, sales: {}, customers: {}, cash: {}, send: async (j, p) => sent.push(p), lineName: () => 'Maria', marcosPhone: () => '5545999990001', audit() {}, log() {} });
  maria.config.lineId = LINE;
  const say = async (phone, text) => { sent.length = 0; await maria.handle({ line: LINE, jid: `l:${LINE}:${phone}@s.whatsapp.net`, phone, text }); return sent.map((m) => m.text || '').join('\n'); };
  return { say, personal, ana, ids: { marcos, mand }, M: '5545999990001', D: '5545999990002', setClock: (d) => { clock = d; } };
}

test('o que se compra onde: lâmpada → material de construção, martelo → ferramentas, leite → mercado, remédio → farmácia', () => {
  const casos = { 'lâmpada': 'Material de construção', 'martelo': 'Ferramentas e ferragens', 'leite': 'Mercado', 'remédio': 'Farmácia', 'ração do cachorro': 'Pet shop', 'lâmpada do carro': 'Automotivo', 'pneu': 'Automotivo', 'carregador': 'Eletrônicos', 'camisa': 'Roupas e calçados', 'toalhas': 'Casa e decoração', 'caneta': 'Papelaria e escritório', 'cimento': 'Material de construção', 'alicate': 'Ferramentas e ferragens', 'papel higiênico': 'Mercado', 'coisa estranha': 'Outros' };
  for (const [item, loja] of Object.entries(casos)) assert.equal(storeOf(item), loja, item);
  assert.equal(storeFromName('minha lista de mercado'), 'Mercado');
  assert.equal(storeFromName('na casa de ferramentas'), 'Ferramentas e ferragens');
  assert.equal(storeFromName('lista de compras'), '', 'só "compras" não é uma loja');
  assert.equal(storeOf('martelo', { martelo: 'Casa e decoração' }), 'Casa e decoração', 'o que a pessoa ensinou vale mais');
  assert.deepEqual(parseShoppingItems('adiciona 2 litros de suco, pão e 6 lâmpadas na lista'), [{ nome: 'Suco', qtd: '2 litros' }, { nome: 'Pão', qtd: '' }, { nome: 'Lâmpadas', qtd: '6' }]);
});

test('o fluxo que você descreveu: lembrou de algo durante o dia, a Ana guarda na loja certa; ele pede a lista do mercado e ela mostra só ela', async () => {
  const { say, M } = setup();
  const a = await say(M, 'Ana, preciso comprar lâmpada');
  assert.match(a, /🧱 \*Material de construção\*: Lâmpada/);
  const b = await say(M, 'Ana, preciso comprar um martelo');
  assert.match(b, /🔧 \*Ferramentas e ferragens\*: Martelo/);
  await say(M, 'Ana, acabou o leite');
  await say(M, 'Ana, me lembra de comprar pão, ovos e café quando eu for no mercado');
  const mercado = await say(M, 'Ana, verifique a minha lista de mercado');
  assert.match(mercado, /Lista — Mercado/);
  for (const i of ['Leite', 'Pão', 'Ovos', 'Café']) assert.match(mercado, new RegExp(`• ${i}`));
  assert.doesNotMatch(mercado, /Lâmpada|Martelo/, 'só do mercado');
  const tudo = await say(M, 'Ana, me mostra minha lista de compras');
  assert.match(tudo, /🛒 \*Mercado\*[\s\S]*🧱 \*Material de construção\*[\s\S]*Lâmpada[\s\S]*🔧 \*Ferramentas e ferragens\*[\s\S]*Martelo/);
  assert.match(await say(M, 'Ana, o que eu preciso comprar na ferramentas?'), /Lista — Ferramentas e ferragens[\s\S]*Martelo/);
});

test('comprei: risca um item, ou tudo de uma loja; "tira da lista"; desfaz; item repetido não duplica; comprei 6 lâmpadas NÃO vira gasto de R$ 6', async () => {
  const { say, M, personal, ids } = setup();
  await say(M, 'Ana, preciso comprar leite, pão e ovos');
  await say(M, 'Ana, preciso comprar um martelo');
  assert.match(await say(M, 'Ana, preciso comprar leite'), /já está na sua lista/);
  assert.match(await say(M, 'Ana, comprei o martelo'), /Marquei como comprado, Marcos: Martelo/);
  assert.match(await say(M, 'Ana, desfaz'), /Desfeito/);
  assert.equal(personal.shoppingList(ids.marcos.id, { store: 'Ferramentas e ferragens' }).length, 1, 'voltou para a lista');
  const z = await say(M, 'Ana, comprei tudo do mercado');
  assert.match(z, /Marquei como comprado.*Leite.*Pão.*Ovos/);
  assert.match(z, /Lista de mercado zerada/);
  assert.match(await say(M, 'Ana, tira o martelo da lista'), /Tirei da lista, Marcos: Martelo/);
  await say(M, 'Ana, preciso comprar 6 lâmpadas');
  const c = await say(M, 'Ana, comprei 6 lâmpadas');
  assert.match(c, /Marquei como comprado/);
  assert.equal(personal.entries(ids.marcos.id, {}).length, 0, 'nenhum gasto de R$ 6 foi registrado');
});

test('item que ela não conhece fica em "Outros" e avisa; quando ensinado ("é da farmácia"), ela aprende e acerta da próxima vez', async () => {
  const { say, M, personal, ids } = setup();
  const a = await say(M, 'Ana, preciso comprar zinabre');
  assert.match(a, /Outros\*: Zinabre/);
  assert.match(a, /Não tenho certeza de onde se compra \*Zinabre\*/);
  const b = await say(M, 'Ana, o zinabre é da farmácia');
  assert.match(b, /Entendi, Marcos: \*Zinabre\* é de 💊 \*Farmácia\*.*já mudei na lista/);
  assert.equal(personal.shoppingList(ids.marcos.id, { store: 'Farmácia' })[0].items[0].text, 'Zinabre');
  await say(M, 'Ana, comprei o zinabre');
  const c = await say(M, 'Ana, acabou o zinabre');
  assert.match(c, /💊 \*Farmácia\*: Zinabre/, 'aprendeu');
  assert.match(await say(M, 'Ana, anota martelo na lista de mercado'), /🛒 \*Mercado\*: Martelo/, 'quando a pessoa nomeia a loja, vale o que ela disse');
});

test('compra futura: com data longe vira lista + lembrete na data; com data próxima é só lembrete', async () => {
  const { say, M, personal, ids } = setup();
  const r = await say(M, 'Ana, quero comprar um relógio daqui a 6 meses');
  assert.match(r, /Compra futura: te lembro em 06\/05\/2027/);
  assert.equal(personal.shoppingList(ids.marcos.id, {})[0].items[0].targetDate, '2027-05-06');
  assert.equal(personal.agenda(ids.marcos.id, '2027-05-06', '2027-05-06')[0].title, 'Comprar: Relógio');
  const p = await say(M, 'Ana, me lembre de comprar presente amanhã');
  assert.match(p, /Anotado, Marcos/);
  assert.equal(personal.agenda(ids.marcos.id, '2026-11-07', '2026-11-07')[0].title, 'Comprar presente', 'data próxima: lembrete na agenda');
});

test('contas que se repetem: todo dia 10, toda segunda, todo ano; renova sozinha; cancelar para tudo', async () => {
  const { say, M, personal, ids, ana, setClock } = setup();
  const r = await say(M, 'Ana, todo dia 10 pago a internet, R$ 120');
  assert.match(r, /Internet\* · R\$ 120,00 — todo mês \(dia 10\)/);
  assert.match(r, /Próxima: terça-feira|Próxima: .*10\/11/);
  const open = personal.entries(ids.marcos.id, { status: 'a_pagar' });
  assert.equal(open.length >= 12 && open.length <= 13, true);
  assert.equal(open[0].dueDate > '2027-10-01', true, 'cobre mais de 1 ano à frente');
  assert.equal(personal.agenda(ids.marcos.id, '2026-11-10', '2026-11-10')[0].kind, 'conta');
  setClock(new Date(2027, 5, 1, 10, 0));
  const before = personal.entries(ids.marcos.id, { status: 'a_pagar' }).length;
  personal.renewSeries(ids.marcos.id);
  assert.ok(personal.entries(ids.marcos.id, { status: 'a_pagar' }).length > before, 'renovou sozinha, sem a pessoa pedir');
  setClock(NOW0);
  assert.match(await say(M, 'Ana, cancele a internet'), /Cancelei a repetição, Marcos: \*Internet\*/);
  assert.equal(personal.entries(ids.marcos.id, { status: 'a_pagar' }).length, 0);
  assert.match(await say(M, 'Ana, toda segunda às 8h academia'), /Academia\* — toda segunda-feira às 08:00/);
  const y = await say(M, 'Ana, aniversário da Maria dia 12/03 todo ano');
  assert.match(y, /todo ano \(12\/03\)/);
  assert.equal(personal.agenda(ids.marcos.id, '2027-03-12', '2027-03-12').length, 1);
  assert.equal(personal.agenda(ids.marcos.id, '2030-03-12', '2030-03-12').length, 1, 'anual cobre 4 anos');
});

test('dia 31 não escorrega: condomínio todo dia 31 cai no último dia dos meses curtos e volta ao 31', async () => {
  const { say, M, personal, ids } = setup();
  await say(M, 'Ana, todo dia 31 pago o condomínio, R$ 500');
  const dates = personal.entries(ids.marcos.id, { status: 'a_pagar' }).map((e) => e.dueDate).sort();
  assert.ok(dates.includes('2026-11-30') && dates.includes('2026-12-31') && dates.includes('2027-02-28') && dates.includes('2027-03-31'), dates.join(' '));
});

test('metas: cria com prazo e diz quanto guardar por mês; guardar dinheiro mostra o andamento; desfaz tira o valor', async () => {
  const { say, M, personal, ids } = setup();
  const g = await say(M, 'Ana, quero juntar 20 mil para a viagem até junho');
  assert.match(g, /Meta criada, Marcos!/);
  assert.match(g, /R\$ 20\.000,00 até 30\/06\/2027/);
  assert.match(g, /R\$ 2\.500,00 por mês\* \(8 meses\)/);
  const s = await say(M, 'Ana, guardei 1.000 na meta da viagem');
  assert.match(s, /\+R\$ 1\.000,00 na meta \*Viagem\*/);
  assert.match(s, /▓░░░░░░░░░ 5% \(R\$ 1\.000,00 de R\$ 20\.000,00\)/);
  assert.match(await say(M, 'Ana, como estão minhas metas?'), /Viagem[\s\S]*5% · R\$ 1\.000,00 de R\$ 20\.000,00 · faltam R\$ 19\.000,00/);
  assert.match(await say(M, 'Ana, desfaz'), /Desfeito/);
  assert.equal(personal.goals(ids.marcos.id)[0].saved, 0);
});

test('olhar para frente: compara com o mês passado e projeta o fechamento do mês', async () => {
  const { say, M, personal, ids } = setup();
  personal.addEntry(ids.marcos.id, { kind: 'saida', amount: 300, description: 'Restaurante', category: 'Restaurantes e lanches', date: '2026-10-12' });
  personal.addEntry(ids.marcos.id, { kind: 'saida', amount: 480, description: 'Restaurante', category: 'Restaurantes e lanches', date: '2026-11-03' });
  personal.addEntry(ids.marcos.id, { kind: 'entrada', amount: 5000, description: 'Salário', date: '2026-11-05' });
  const r = await say(M, 'Ana, como está meu financeiro este mês?');
  assert.match(r, /📈 Comparado ao mês passado: Restaurantes e lanches \+60% \(R\$ 480,00 contra R\$ 300,00\)/);
  assert.match(r, /🔮 No ritmo de agora, o mês deve fechar com cerca de \*R\$ /);
});

test('PRIVACIDADE: lista de compras, metas e repetições de um não aparecem para o outro', async () => {
  const { say, M, D } = setup();
  await say(M, 'Ana, preciso comprar um presente surpresa para a esposa');
  await say(M, 'Ana, quero juntar 50 mil para o carro até dezembro');
  assert.match(await say(D, 'Ana, me mostra minha lista de compras'), /lista de compras está vazia/);
  assert.doesNotMatch(await say(D, 'Ana, como estão minhas metas?'), /carro|50\.000/);
});

test('trava: a Ana segue livre nas listas pessoais e continua sem excluir dado da empresa', async () => {
  const { say, M } = setup();
  await say(M, 'Ana, preciso comprar leite');
  assert.match(await say(M, 'Ana, apague o leite da lista'), /Tirei da lista/);
  const blocked = await say(M, 'Ana, apague o cliente Carlos Lima');
  assert.match(blocked, /por segurança eu não excluo nem altero nada no sistema/);
});
