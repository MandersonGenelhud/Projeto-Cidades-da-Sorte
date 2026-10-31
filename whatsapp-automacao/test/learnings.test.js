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
  assert.match(system, /prefere fazer no Pix, no cartão de crédito ou à vista em dinheiro aqui no escritório/);
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
