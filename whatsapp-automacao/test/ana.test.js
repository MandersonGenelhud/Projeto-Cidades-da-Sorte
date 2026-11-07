import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Personal } from '../src/personal.js';
import { Ana } from '../src/ana.js';
import { Maria } from '../src/maria.js';
import { tempStore } from './helpers.js';

const LINE = 'linha-maria';
const NOW0 = new Date(2026, 10, 6, 10, 0); // sexta-feira, 06/11/2026 10:00

function setup({ llm = null } = {}) {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const marcos = auth.create({ name: 'Marcos Miguel', login: 'marcos', password: 'segredo123', role: 'admin' });
  const mand = auth.create({ name: 'Manderson Genel', login: 'manderson', password: 'segredo123', role: 'admin' });
  const ana = auth.create({ name: 'Ana Vendedora', login: 'ana', password: 'segredo123', role: 'seller' });
  auth.update(marcos.id, { whatsapp: '5545999990001' });
  auth.update(mand.id, { whatsapp: '5545999990002' });
  auth.update(ana.id, { whatsapp: '5545999990004' });
  let clock = new Date(NOW0);
  const now = () => new Date(clock);
  const personal = new Personal({ store, now });
  const notified = []; const state = { fail: false };
  const audits = [];
  const anaBot = new Ana({ store, auth, personal, llm, now, notify: async (uid, text) => { if (state.fail) return false; notified.push({ uid, text }); return true; }, audit: (t) => audits.push(t), log: () => {} });
  const sent = []; const spoke = [];
  const maria = new Maria({
    store, auth, ana: anaBot, sales: {}, customers: {}, cash: {}, send: async (j, p) => sent.push({ j, ...p }), lineName: () => 'Maria', marcosPhone: () => '', audit: () => {}, log: () => {},
    stt: { ready: true, transcribe: async () => state.transcript || 'Ana, qual a minha agenda de amanhã?' }, downloadAudio: async () => Buffer.from('a'),
    tts: { ready: true, speak: async (t, voice) => { spoke.push({ t, voice }); return { buffer: Buffer.from('v'), mimetype: 'audio/ogg' }; } },
  });
  maria.config.lineId = LINE;
  const say = async (phone, text, extra = {}) => { sent.length = 0; await maria.handle({ line: LINE, jid: `l:${LINE}:${phone}@s.whatsapp.net`, phone, text, ...extra }); return sent.filter((m) => m.text || m.media); };
  const M = '5545999990001'; const D = '5545999990002';
  return { store, auth, personal, ana: anaBot, maria, say, M, D, ids: { marcos, mand, ana }, notified, state, audits, spoke, setClock: (d) => { clock = d; } };
}

test('só responde a "Ana," de quem tem a Ana liberada (administradores); vendedor e "Mariana" não; a Maria segue sendo a Maria', async () => {
  const { say, M, ana, personal, ids } = setup();
  assert.match((await say(M, 'Ana, me lembre de ligar para o contador amanhã às 14h'))[0].text, /Anotado, Marcos/);
  assert.equal((await say('5545999990004', 'Ana, me lembre de ligar para o contador amanhã às 14h')).length, 0, 'vendedora não tem a Ana: silêncio');
  assert.equal((await say(M, 'Mariana, me lembre de algo amanhã')).length, 0);
  assert.equal(personal.agenda(ids.ana.id, '2026-01-01', '2030-01-01').length, 0, 'nada foi gravado para quem não tem a Ana');
  assert.equal(ana.claims('Maria, relatório dos contratos', ids.marcos), null);
  assert.ok(ana.claims('Oi Ana, bom dia', ids.marcos));
});

test('agendar: lembrete com data e hora relativas; avisa 30 min antes só nos compromissos; "desfaz" cancela', async () => {
  const { say, M, personal, ids } = setup();
  const r = await say(M, 'Ana, me lembre de ligar para o contador amanhã às 14h');
  const [it] = personal.agenda(ids.marcos.id, '2026-11-07', '2026-11-07');
  assert.equal(it.title, 'Ligar para o contador');
  assert.equal(it.time, '14:00');
  assert.match(r[0].text, /sábado, 07\/11 às 14:00/);
  assert.match(r[0].text, /Te aviso na hora/);
  const c = await say(M, 'Ana, agende reunião com o dentista dia 20/12 às 9h');
  const [d] = personal.agenda(ids.marcos.id, '2026-12-20', '2026-12-20');
  assert.equal(d.date, '2026-12-20');
  assert.equal(d.time, '09:00');
  assert.match(c[0].text, /domingo, 20\/12|20\/12/);
  assert.match((await say(M, 'Ana, desfaz'))[0].text, /Desfeito/);
  assert.equal(personal.agenda(ids.marcos.id, '2026-12-20', '2026-12-20').length, 0);
});

test('compromissos de 1 e 2 anos; passado, data que falta e horário que já passou são recusados com educação', async () => {
  const { say, M, personal, ids } = setup();
  const r = await say(M, 'Ana, agende renovação do seguro daqui a 2 anos');
  assert.equal(personal.agenda(ids.marcos.id, '2028-11-06', '2028-11-06').length, 1);
  assert.match(r[0].text, /daqui a 2 anos/);
  assert.match((await say(M, 'Ana, me lembre de pagar o IPTU dia 02/11/2026'))[0].text, /já passou/);
  assert.match((await say(M, 'Ana, me lembre de ligar para o banco'))[0].text, /para quando\?/);
  assert.match((await say(M, 'Ana, me lembre de ligar hoje às 8h'))[0].text, /já passou/);
});

test('agenda: lista o dia em ordem, com horário; dia vazio e semana', async () => {
  const { say, M } = setup();
  await say(M, 'Ana, me lembre de ligar para o banco amanhã às 15h');
  await say(M, 'Ana, me lembre de buscar o carro amanhã às 9h');
  await say(M, 'Ana, me lembre de comprar presente amanhã');
  const r = (await say(M, 'Ana, quais são meus compromissos de amanhã?'))[0].text;
  assert.match(r, /Amanhã \(sábado, 07\/11\)/);
  assert.ok(r.indexOf('09:00') < r.indexOf('15:00'), 'em ordem de hora');
  assert.match(r, /Comprar presente/);
  assert.match((await say(M, 'Ana, o que tenho depois de amanhã?'))[0].text, /Nada na agenda/);
  assert.match((await say(M, 'Ana, quais compromissos tenho esta semana?'))[0].text, /Próximos 7 dias/);
});

test('financeiro: registra gastos e entradas, categoriza ("café" = restaurantes) e resume o dia', async () => {
  const { say, M, personal, ids } = setup();
  const a = await say(M, 'Ana, gastei 10 reais de café');
  assert.match(a[0].text, /Anotei, Marcos: gasto de \*R\$ 10,00\* · Restaurantes e lanches/);
  await say(M, 'Ana, gastei 15 reais no restaurante');
  await say(M, 'Ana, recebi 3 mil de salário');
  const r = (await say(M, 'Ana, como está meu financeiro hoje?'))[0].text;
  assert.match(r, /Entradas R\$ 3\.000,00 · Saídas R\$ 25,00 · \*Saldo R\$ 2\.975,00\*/);
  assert.match(r, /Restaurantes e lanches R\$ 25,00/);
  assert.equal(personal.entries(ids.marcos.id, {}).length, 3);
  assert.match((await say(M, 'Ana, quanto gastei com restaurante este mês?'))[0].text, /gastou R\$ 25,00/);
});

test('valor alto pede confirmação (erro de voz sai caro); "sim" grava e "não" cancela', async () => {
  const { say, M, personal, ids } = setup();
  const a = await say(M, 'Ana, gastei 15000 reais em móveis');
  assert.match(a[0].text, /valor alto/);
  assert.equal(personal.entries(ids.marcos.id, {}).length, 0);
  assert.match((await say(M, 'Ana, sim'))[0].text, /Anotei/);
  assert.equal(personal.entries(ids.marcos.id, {}).length, 1);
  await say(M, 'Ana, gastei 20000 reais em viagem');
  assert.match((await say(M, 'Ana, não'))[0].text, /não anotei nada/);
  assert.equal(personal.entries(ids.marcos.id, {}).length, 1);
});

test('compra parcelada (12 parcelas = 1 ano): cria as 12 contas a pagar e os 12 avisos na agenda; paguei baixa a mais próxima; desfaz volta', async () => {
  const { say, M, personal, ids } = setup();
  await say(M, 'Ana, recebi 6 mil de salário');
  const r = (await say(M, 'Ana, comprei um carro em 12 parcelas de 1.500, a primeira dia 10/12'))[0].text;
  assert.match(r, /12x de R\$ 1\.500,00 \(total R\$ 18\.000,00\)/);
  assert.match(r, /10\/12\/2026 até 10\/11\/2027/);
  assert.match(r, /25% do que você recebeu/);
  const open = personal.entries(ids.marcos.id, { status: 'a_pagar' });
  assert.equal(open.length, 12);
  const bills = personal.agenda(ids.marcos.id, '2026-12-01', '2027-12-31').filter((i) => i.kind === 'conta');
  assert.equal(bills.length, 12);
  assert.equal(bills[0].date, '2026-12-10');
  assert.equal(bills[11].date, '2027-11-10');
  const p = (await say(M, 'Ana, paguei a parcela do carro'))[0].text;
  assert.match(p, /Baixei, Marcos.*parcela 1\/12/);
  assert.match(p, /Próxima: .*parcela 2\/12.*10\/01\/2027/);
  assert.equal(personal.entries(ids.marcos.id, { status: 'a_pagar' }).length, 11);
  assert.match((await say(M, 'Ana, desfaz'))[0].text, /Desfeito/);
  assert.equal(personal.entries(ids.marcos.id, { status: 'a_pagar' }).length, 12, 'voltou a ficar em aberto');
  assert.match((await say(M, 'Ana, desfaz'))[0].text, /nada recente|Desfeito/);
});

test('parcelas: valor total dividido ("18000 em 12x") e dados insuficientes', async () => {
  const { say, M, personal, ids } = setup();
  const r = (await say(M, 'Ana, parcelei uma moto, 18000 em 12x, primeira parcela dia 15/12'))[0].text;
  assert.match(r, /12x de R\$ 1\.500,00/);
  assert.equal(personal.entries(ids.marcos.id, { status: 'a_pagar' })[0].amount, 1500);
  assert.match((await say(M, 'Ana, comprei uma geladeira parcelada'))[0].text, /Ana|Marcos/);
});

test('orçamento mensal por categoria: define, avisa a 80% ao registrar e mostra o andamento', async () => {
  const { say, M } = setup();
  assert.match((await say(M, 'Ana, como está meu orçamento?'))[0].text, /ainda não definiu orçamento/);
  assert.match((await say(M, 'Ana, defina meu orçamento de lazer em 400'))[0].text, /Orçamento de Lazer: \*R\$ 400,00\*/);
  assert.match((await say(M, 'Ana, meu orçamento total do mês é 6000'))[0].text, /Orçamento total do mês: \*R\$ 6\.000,00\*/);
  await say(M, 'Ana, gastei 200 reais no cinema');
  const w = (await say(M, 'Ana, gastei 140 reais no show'))[0].text;
  assert.match(w, /Lazer: já usou 85% do limite/);
  const o = (await say(M, 'Ana, como está meu orçamento?'))[0].text;
  assert.match(o, /Total: R\$ 340,00 de R\$ 6\.000,00 \(6%\)/);
  assert.match(o, /🟡 Lazer: R\$ 340,00 de R\$ 400,00 \(85%\)/);
});

test('PRIVACIDADE: o que o Marcos registra o Manderson não vê, e vice-versa; vendedor nem entra', async () => {
  const { say, M, D, personal, ids } = setup();
  await say(M, 'Ana, gastei 500 reais em presente');
  await say(M, 'Ana, me lembre de levar a aliança amanhã às 10h');
  const dr = (await say(D, 'Ana, como está meu financeiro este mês?'))[0].text;
  assert.match(dr, /ainda não tenho lançamentos/);
  assert.doesNotMatch(dr, /500|presente/);
  const da = (await say(D, 'Ana, o que tenho amanhã?'))[0].text;
  assert.match(da, /Nada na agenda/);
  assert.doesNotMatch(da, /aliança/);
  assert.equal(personal.entries(ids.mand.id, {}).length, 0);
  assert.equal(personal.csv(ids.mand.id).includes('presente'), false);
  assert.match((await say(M, 'Ana, como está meu financeiro?'))[0].text, /R\$ 500,00/);
});

test('resumo da manhã às 04:30: uma vez por dia, só a agenda da própria pessoa, sem repetir; sem nada não manda; WhatsApp fora do ar tenta de novo', async () => {
  const t = setup();
  const { say, M, ana, ids, notified, state, setClock } = t;
  await say(M, 'Ana, me lembre de ligar para o contador hoje às 15h');
  await say(M, 'Ana, me lembre de renovar o seguro hoje');
  setClock(new Date(2026, 10, 6, 4, 29));
  assert.equal((await ana.tick()).sent, 0, 'antes do horário nada sai');
  setClock(new Date(2026, 10, 6, 4, 30));
  state.fail = true;
  assert.equal((await ana.tick()).sent, 0, 'WhatsApp fora do ar: não marca como enviado');
  state.fail = false;
  assert.equal((await ana.tick()).sent, 1);
  const msg = notified.find((n) => n.uid === ids.marcos.id).text;
  assert.match(msg, /^☀️ Bom dia, Marcos! Sua agenda de hoje \(sexta-feira, 06\/11\)/);
  assert.match(msg, /• 15:00 Ligar para o contador/);
  assert.match(msg, /\(sem horário\) Renovar o seguro/);
  assert.equal(notified.filter((n) => n.uid === ids.mand.id).length, 0, 'o Manderson não recebe a agenda do Marcos');
  setClock(new Date(2026, 10, 6, 4, 31));
  assert.equal((await ana.tick()).sent, 0, 'não repete no mesmo dia');
  setClock(new Date(2026, 10, 7, 4, 30));
  assert.equal((await ana.tick()).sent, 0, 'dia seguinte sem nada (e o lembrete de ontem já perdeu o sentido): não incomoda');
});

test('lembretes na hora marcada: compromisso avisa 30 min antes, lembrete na hora, uma vez só; atraso de mais de 3 horas não dispara', async () => {
  const { say, M, ana, personal, ids, notified, setClock } = setup();
  await say(M, 'Ana, agende reunião com o contador hoje às 15h');
  await say(M, 'Ana, me lembre de ligar para a escola hoje às 16h');
  setClock(new Date(2026, 10, 6, 14, 29));
  assert.equal((await ana.tick()).sent, 0, 'ainda não é hora (o compromisso das 15h avisa às 14:30)');
  setClock(new Date(2026, 10, 6, 14, 31));
  notified.length = 0;
  await ana.tick();
  assert.equal(notified.length, 1);
  assert.match(notified[0].text, /lembrete: \*Reunião com o contador\* \(começa às 15:00, daqui a 30 min\)/);
  await ana.tick();
  assert.equal(notified.length, 1, 'uma vez só');
  setClock(new Date(2026, 10, 6, 16, 0));
  await ana.tick();
  assert.match(notified.at(-1).text, /lembrete: \*Ligar para a escola\* \(16:00\)/);
  personal.addItem(ids.marcos.id, { kind: 'lembrete', title: 'Muito antigo', date: '2026-11-03', time: '09:00' });
  setClock(new Date(2026, 10, 7, 12, 0));
  const before = notified.length;
  await ana.tick();
  assert.equal(notified.length, before, 'mais de 3 horas de atraso não dispara');
});

test('áudio: a Ana ouve, responde com a voz DELA (diferente da Maria) em voz e texto', async () => {
  const { say, M, spoke, state } = setup();
  state.transcript = 'Ana, me lembre de ligar para o contador amanhã às 14h';
  const r = await say(M, '', { hasAudio: true });
  assert.ok(r.some((m) => m.media?.ptt), 'mandou áudio');
  assert.equal(r.filter((m) => /Anotado, Marcos/.test(m.text || '')).length, 0, 'só áudio, sem o texto junto');
  assert.equal(spoke[0].voice, 'Aoede');
  assert.ok((await say(M, 'sim, me manda o texto')).some((m) => /Anotado, Marcos/.test(m.text || '')), 'o texto vem quando a pessoa pede');
  state.transcript = 'Maria, como está o faturamento?';
  spoke.length = 0;
  await say(M, '', { hasAudio: true });
  assert.notEqual(spoke[0]?.voice, 'Aoede', 'a Maria continua com a voz dela');
});

test('planilha: só da própria pessoa, com fórmulas neutralizadas; e nada de dado pessoal no registro de acessos', async () => {
  const { say, M, personal, ids, audits } = setup();
  personal.addEntry(ids.marcos.id, { kind: 'saida', amount: 10, description: '=HYPERLINK("http://x")', category: 'Outros' });
  await say(M, 'Ana, gastei 33 reais de gasolina');
  const r = (await say(M, 'Ana, me manda minha planilha'))[0];
  assert.equal(r.media.mimetype, 'text/csv');
  const csv = r.media.buffer.toString('utf8');
  assert.match(csv, /data;tipo;valor;moeda;categoria;descricao;situacao;vencimento;parcela/);
  assert.match(csv, /"'=HYPERLINK/, 'fórmula neutralizada');
  assert.match(csv, /gasolina/);
  assert.ok(audits.every((a) => !/33|gasolina|HYPERLINK|contador/.test(a)), 'o registro guarda só que a Ana foi usada');
});

test('Ana desligada não responde; escolher pessoas específicas muda quem pode', async () => {
  const t = setup();
  t.store.updateSettings({ ana: { enabled: false } });
  assert.equal((await t.say(t.M, 'Ana, me lembre de algo amanhã')).length, 0);
  t.store.updateSettings({ ana: { enabled: true, users: [t.ids.ana.id] } });
  assert.equal((await t.say(t.M, 'Ana, me lembre de algo amanhã')).length, 0, 'Marcos fora da lista');
  assert.match((await t.say('5545999990004', 'Ana, me lembre de levar o contrato amanhã às 9h'))[0].text, /Anotado, Ana/);
});

import { expandMagnitude, brNum } from '../src/ana.js';

test('valores ditos como as pessoas falam: "3 mil", "2,5 mil", "10k", "1 milhão", "1.500,50"', () => {
  assert.equal(expandMagnitude('recebi 3 mil de salário'), 'recebi 3000 de salário');
  assert.equal(expandMagnitude('gastei 2,5 mil'), 'gastei 2500');
  assert.equal(expandMagnitude('investi 10k'), 'investi 10000');
  assert.equal(expandMagnitude('vendi por 1 milhão'), 'vendi por 1000000');
  assert.equal(expandMagnitude('paguei mil reais'), 'paguei 1000 reais');
  assert.equal(expandMagnitude('milhares de pessoas'), 'milhares de pessoas', 'palavra comum não muda');
  assert.equal(brNum('1.500,50'), 1500.5);
  assert.equal(brNum('1.500'), 1500);
  assert.equal(brNum('10,5'), 10.5);
});

test('com a IA: o que ela devolve é conferido (data absurda, valor negativo e categoria inventada não entram)', async () => {
  const answers = [];
  const llm = { configured: true, chat: async ({ messages }) => ({ content: JSON.stringify(answers.shift()) }) };
  const t = setup({ llm });
  answers.push({ acao: 'agendar', titulo: 'Reunião com o contador', tipo: 'compromisso', data: '2026-11-10', hora: '09:00' });
  const ok = await t.say(t.M, 'Ana, marque reunião com o contador terça às 9h');
  assert.match(ok[0].text, /Anotado, Marcos/);
  const [it] = t.personal.agenda(t.ids.marcos.id, '2026-11-10', '2026-11-10');
  assert.equal(it.kind, 'compromisso');
  assert.equal(it.remindMin, 30, 'compromisso avisa 30 min antes');
  answers.push({ acao: 'agendar', titulo: 'Algo', data: '2099-01-01', hora: '25:99' });
  assert.match((await t.say(t.M, 'Ana, me lembre de algo'))[0].text, /para quando\?/, 'data a mais de 5 anos e hora inválida são ignoradas');
  answers.push({ acao: 'registrar', valor: -50, descricao: 'x', categoria: 'Categoria Inventada' });
  assert.match((await t.say(t.M, 'Ana, gastei algo'))[0].text, /não entendi o valor/i);
  answers.push({ acao: 'registrar', valor: 42.5, moeda: 'BRL', descricao: 'Livro', categoria: 'Categoria Inventada' });
  await t.say(t.M, 'Ana, comprei um livro');
  assert.equal(t.personal.entries(t.ids.marcos.id, {})[0].category, 'Educação', 'categoria inventada vira a pela descrição');
  answers.push({ acao: 'inventada' });
  const r = await t.say(t.M, 'Ana, faça algo estranho');
  assert.ok(r.length === 1, 'ação desconhecida cai no bate-papo/ajuda, sem erro');
});

test('conversa com a IA: recebe só o resumo do mês e da semana da PRÓPRIA pessoa, nunca os lançamentos nem os dados de outra', async () => {
  const seen = [];
  const llm = { configured: true, chat: async ({ messages }) => { seen.push(messages); return { content: messages[0].content.includes('conversa') ? 'x' : (/classificador|entendedor/.test(messages[0].content) ? JSON.stringify({ acao: 'conversa' }) : 'Claro, Marcos! Vamos organizar isso.') }; } };
  const t = setup({ llm });
  t.personal.addEntry(t.ids.marcos.id, { kind: 'saida', amount: 123.45, description: 'Segredo do Marcos', category: 'Outros' });
  t.personal.addEntry(t.ids.mand.id, { kind: 'saida', amount: 999, description: 'Segredo do Manderson', category: 'Outros' });
  const r = await t.say(t.M, 'Ana, estou gastando demais, o que você acha?');
  assert.match(r[0].text, /Claro, Marcos!/);
  const chatPrompt = seen.at(-1)[0].content;
  assert.match(chatPrompt, /Você é a Ana, assistente pessoal e financeira de Marcos/);
  assert.match(chatPrompt, /saídas R\$ 123,45/, 'o total do mês dele');
  assert.doesNotMatch(chatPrompt, /Segredo do Marcos/, 'nem o texto dos lançamentos');
  assert.doesNotMatch(chatPrompt, /Manderson|999/, 'nada de outra pessoa');
  assert.match(chatPrompt, /NÃO dê recomendação de investimento específica/);
});
