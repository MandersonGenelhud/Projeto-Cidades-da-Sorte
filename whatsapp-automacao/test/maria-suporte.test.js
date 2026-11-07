import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Maria, quickIntent } from '../src/maria.js';
import { tempStore } from './helpers.js';

const LINE = 'l1';
const MARCOS = '5545999990001'; const ANA = '5545999990004';

function setup(config = {}) {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const marcos = auth.create({ name: 'Marcos Miguel', login: 'marcos', password: 'segredo123', role: 'admin' });
  const ana = auth.create({ name: 'Ana Vendedora', login: 'ana', password: 'segredo123', role: 'seller' });
  auth.update(marcos.id, { whatsapp: MARCOS }); auth.update(ana.id, { whatsapp: ANA });
  const sent = []; const prompts = [];
  const llm = { configured: true, chat: async ({ messages }) => { prompts.push(messages[0].content); if (/classifica pedidos/.test(messages[0].content)) return { content: /^ajuda$/i.test(String(messages.at(-1).content).trim()) ? '{"acao":"ajuda"}' : '{"acao":"conversa"}' }; return { content: 'Claro!' }; } };
  const maria = new Maria({ store, auth, llm, sales: { listFor: () => [] }, customers: {}, cash: {}, knowledge: () => 'BASE', send: async (j, p) => { sent.push(p); }, lineName: () => 'Maria', marcosPhone: () => MARCOS, audit: () => {}, log: () => {} });
  maria.config.lineId = LINE;
  Object.assign(maria.config, config);
  const say = async (phone, text) => { sent.length = 0; await maria.handle({ line: LINE, jid: `l:${LINE}:${phone}@s.whatsapp.net`, phone, text }); return sent.map((m) => m.text).join('\n'); };
  return { say, prompts, store };
}

test('reconhece pedidos de suporte (falar com o Manderson, problema no sistema, contrato que não sai, sugestão)', () => {
  for (const t of ['preciso falar com o Manderson', 'Maria, preciso falar com o Manderson através da Maria', 'quero falar com o suporte', 'o sistema não está funcionando', 'o contrato não sai de jeito nenhum', 'a IA deu erro de novo', 'tenho uma sugestão para o sistema', 'a ficha travou', 'quero reportar um erro']) assert.equal(quickIntent(t)?.acao, 'suporte', t);
  for (const t of ['gere o contrato da Ana', 'relatório dos contratos de hoje', 'como está o faturamento', 'me manda o contrato do João']) assert.notEqual(quickIntent(t)?.acao, 'suporte', t);
});

test('"preciso falar com o Manderson": a Maria explica que o suporte é com ele (o Marcos é atarefado) e manda o link do WhatsApp com a mensagem já começada', async () => {
  const t = setup();
  const r = await t.say(ANA, 'Maria, preciso falar com o Manderson');
  assert.match(r, /suporte do sistema é com o \*Manderson\*/);
  assert.match(r, /Marcos é muito atarefado/);
  assert.match(r, /contrato que não sai/);
  const link = r.match(/https:\/\/wa\.me\/(\d+)\?text=([^\s]+)/);
  assert.ok(link, 'trouxe o link');
  assert.equal(link[1], '5569993051671');
  assert.match(decodeURIComponent(link[2]), /Oi, Manderson! Aqui é Ana\./);
});

test('com o problema descrito, o texto do vendedor já vai no link', async () => {
  const t = setup();
  const r = await t.say(ANA, 'Maria, o contrato não está dando certo, não gera o PDF do cliente Carlos');
  const link = r.match(/text=([^\s]+)/);
  assert.match(decodeURIComponent(link[1]), /contrato não está dando certo/);
});

test('o número do suporte é configurável (maria.support) e o padrão é o do Manderson', async () => {
  const t = setup({ support: { name: 'Suporte', phone: '5511988887777' } });
  const r = await t.say(ANA, 'Maria, quero falar com o suporte');
  assert.match(r, /wa\.me\/5511988887777/);
  assert.match(r, /\*Suporte\*/);
});

test('aviso fixo de suporte: uma vez para cada vendedor, nunca para administrador; a ajuda e o bate-papo também orientam', async () => {
  const t = setup();
  const first = await t.say(ANA, 'Maria, ajuda');
  assert.match(first, /Suporte:.*Manderson/s);
  const again = await t.say(ANA, 'Maria, ajuda');
  assert.equal((again.match(/ℹ️ \*Suporte:\*/g) || []).length, 0, 'o aviso de primeira vez não repete');
  assert.match(again, /preciso falar com o Manderson/, 'mas a ajuda sempre lembra');
  const marcos = await t.say(MARCOS, 'Maria, ajuda');
  assert.doesNotMatch(marcos, /ℹ️ \*Suporte:\*/, 'administrador não recebe o aviso');
  await t.say(ANA, 'Maria, o que é o Pacote Ouro?');
  assert.ok(t.prompts.some((p) => /Suporte: qualquer problema com o sistema/.test(p) && /Manderson/.test(p)), 'o bate-papo também sabe indicar o suporte');
});
