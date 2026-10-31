import test from 'node:test';
import assert from 'node:assert/strict';
import { Learnings } from '../src/learnings.js';
import { Agent } from '../src/agent/agent.js';
import { presetSettings } from '../src/agent/presets.js';
import { tempStore } from './helpers.js';

const TALK = [
  { role: 'user', content: 'Quero o Prata mas só recebo dia 10' },
  { role: 'assistant', content: 'Hoje você só paga a entrada; o resto é nas vindas.' },
  { role: 'user', content: 'Ah, então dá. Prefiro Pix.' },
  { role: 'assistant', content: 'Perfeito, vou te mandar a ficha.' },
];

test('venda confirmada vira sugestão pendente; só o aprovado entra no atendimento', async () => {
  const store = tempStore();
  const llm = { configured: true, chat: async () => ({ content: '{"licoes": ["Quem só recebe no dia 10 decide quando entende que hoje paga só a entrada.", "curta"]}' }) };
  const l = new Learnings({ store, llm });
  const out = await l.fromWon({ id: 'L1' }, TALK);
  assert.equal(out.length, 1, 'frase curta demais é ignorada');
  assert.equal(out[0].status, 'pendente');
  assert.equal(l.approvedText(), '', 'pendente não vai para a atendente');
  assert.deepEqual(await l.fromWon({ id: 'L1' }, TALK), [], 'uma vez por venda');
  l.approve(out[0].id, 'Marcos', 'Quem só recebe no dia 10 fecha quando entende que hoje paga só a entrada.');
  assert.match(l.approvedText(), /^- Quem só recebe no dia 10 fecha/);
  const own = l.add('Mostrar o depoimento do Instagram antes do Pix acalma quem tem receio.', { by: 'Marcos' });
  assert.equal(own.status, 'aprovado');
  l.reject(own.id, 'Marcos');
  assert.doesNotMatch(l.approvedText(), /Instagram/);
  assert.throws(() => l.add('oi'), /pelo menos uma frase/);
  // Conversa curta demais ou IA sem chave: nada é sugerido.
  assert.deepEqual(await l.fromWon({ id: 'L2' }, TALK.slice(0, 2)), []);
  assert.deepEqual(await new Learnings({ store, llm: { configured: false } }).fromWon({ id: 'L3' }, TALK), []);
});

test('atendente: fechamento por escolha (Pix, cartão ou dinheiro), sem aceitar "depois", taxa da visita e aprendizados', async () => {
  const store = tempStore();
  store.updateSettings(presetSettings('migra-paraguai'));
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  let system = '';
  const llm = { configured: true, chat: async ({ messages }) => { system = messages[0].content; return { content: 'Sua reserva fica R$ 2.600,00. Prefere Pix ou cartão?', tool_calls: [] }; } };
  const agent = new Agent({ store, llm, now: () => new Date(2026, 9, 26, 9, 5) });
  agent.requestVisit = async () => ({ ok: true });
  agent.scheduleReturn = async () => ({ ok: true });
  agent.learnings = () => '- Quem só recebe no dia 10 fecha quando entende que hoje paga só a entrada.';
  const conv = agent.conversation('5511999990000@s.whatsapp.net');
  agent.remember(conv, 'user', 'Vou deixar para depois');
  await agent.think(conv);
  assert.match(system, /A sua reserva fica R\$ 1\.000,00 \+ R\$ 800,00 por adulto \(com 2 adultos, R\$ 2\.600,00\)\. Você prefere fazer no Pix, no cartão de crédito ou à vista em dinheiro aqui no escritório/);
  assert.match(system, /levar_para_whatsapp/);
  assert.match(system, /NUNCA pergunte algo que possa ser respondido com "não"/);
  assert.match(system, /Só depois de duas tentativas/);
  assert.match(system, /2 = R\$ 2\.600,00/);
  assert.match(system, /consultoria presencial com taxa de R\$ 150,00/);
  assert.match(system, /Aprendizados de vendas fechadas[\s\S]*dia 10/);
  assert.doesNotMatch(system, /Quer que eu já te mande a ficha/);
  // Taxa zerada no painel: a atendente não fala de taxa.
  store.updateSettings({ visits: { consultFee: 0 } });
  await agent.think(conv);
  assert.doesNotMatch(system, /consultoria presencial com taxa de R\$ 0/);
});

test('Instagram: a ferramenta de levar para o WhatsApp só aparece no Direct', async () => {
  const store = tempStore();
  store.updateSettings(presetSettings('migra-paraguai'));
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  const seen = [];
  const replies = [
    { content: '', tool_calls: [{ id: '1', type: 'function', function: { name: 'levar_para_whatsapp', arguments: JSON.stringify({ whatsapp: '45 98888-1111', nome: 'Carla' }) } }] },
    { content: 'Acabei de te chamar no WhatsApp, seguimos por lá!', tool_calls: [] },
    { content: 'Oi!', tool_calls: [] },
  ];
  const llm = { configured: true, chat: async ({ tools }) => { seen.push(tools.map((t) => t.function.name)); return replies.shift(); } };
  const agent = new Agent({ store, llm, now: () => new Date(2026, 9, 26, 9, 5) });
  const moved = [];
  agent.moveToWhatsapp = async (conv, args) => { moved.push(args); return { ok: true }; };
  const ig = agent.conversation('ig:123');
  agent.remember(ig, 'user', 'Meu zap é 45 98888-1111');
  const r = await agent.think(ig);
  assert.equal(moved[0].whatsapp, '45 98888-1111');
  assert.match(r.text, /WhatsApp/);
  assert.ok(seen[0].includes('levar_para_whatsapp'));
  const wa = agent.conversation('5545988881111@s.whatsapp.net');
  agent.remember(wa, 'user', 'Oi');
  await agent.think(wa);
  assert.ok(!seen.at(-1).includes('levar_para_whatsapp'), 'no WhatsApp a ferramenta não aparece');
});

test('mentoria com o Marcos (US$ 250/h): a atendente oferece só para quem insiste e registra para ele confirmar', async () => {
  const store = tempStore();
  store.updateSettings(presetSettings('migra-paraguai'));
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  let system = '';
  const llm = { configured: true, chat: async ({ messages }) => { system = messages[0].content; return { content: 'Ok', tool_calls: [] }; } };
  const agent = new Agent({ store, llm, now: () => new Date(2026, 9, 26, 9, 5) });
  agent.notifyOwner = async () => ({ ok: true });
  agent.bookMentoring = async () => ({ ok: true });
  const conv = agent.conversation('5511999990000@s.whatsapp.net');
  agent.remember(conv, 'user', 'Quero falar direto com o Marcos');
  await agent.think(conv);
  assert.match(system, /60 minutos por US\$ 250/);
  assert.match(system, /não converta para reais por conta própria/);
  assert.match(system, /investimentos no Paraguai/);
  assert.match(system, /online ou presencial/);
  assert.match(system, /JÁ É CLIENTE da Migra não paga/);
  assert.match(system, /pagamento vem ANTES do agendamento, no Pix ou no cartão/);
  assert.match(system, /Você nunca confirma nem sugere data ou horário/);
  assert.match(system, /até que dia a mentoria precisa ser agendada/);
  assert.match(system, /Quem escolhe o dia e o horário é a equipe do Marcos, não o cliente/);
  assert.match(system, /assessoria do Marcos escolhe o dia e o horário na agenda dele, dentro do prazo, e confirma por aqui com o cliente/);
  assert.match(system, /Não prometa lucro/);
  store.updateSettings({ crm: { mentoring: { enabled: false } } });
  await agent.think(conv);
  assert.doesNotMatch(system, /Mentoria com o Marcos Miguel/);
});
