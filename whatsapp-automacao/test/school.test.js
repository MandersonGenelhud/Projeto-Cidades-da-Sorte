import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Maria } from '../src/maria.js';
import { Store } from '../src/store.js';
import { groupLiveBrief, STAFF_RULES } from '../src/group-brief.js';
import { companyBrief } from '../src/agent/prompt.js';
import { GROUP_KNOWLEDGE, GROUP_BLOCK_V2, SCHOOL_KNOWLEDGE, MIGRATECH_KNOWLEDGE, presetSettings } from '../src/agent/presets.js';
import { tempStore } from './helpers.js';

test('Migra School: preço de tabela, para quem é e o que ajuda no dia a dia (como o Marcos explicou), sem cotação e sem brinde por conta própria', () => {
  const t = SCHOOL_KNOWLEDGE;
  assert.match(t, /Preço de tabela: R\$ 59,99 por mês \(cerca de R\$ 60,00\)/);
  assert.match(t, /Se algum bloco acima disser que a Migra School não tem preço, vale este/);
  for (const re of [/mercado/, /escola dos filhos/, /trabalho/, /trânsito/, /circulando por todo o Paraguai/, /comprar e ao vender/, /câmbio no dia a dia \(real, guarani e dólar\)/, /cotação do comércio local pode ser diferente da cotação do dia/, /na prática/, /assessoria da Migra School/, /inglês \(a partir do espanhol e a partir do português\)/]) assert.match(t, re);
  assert.match(t, /nunca informe cotação de moeda de memória/i);
  assert.match(t, /Não ofereça desconto, gratuidade ou cortesia por conta própria: condições especiais são decisão do Marcos/);
  assert.doesNotMatch(t, /1 ano|um ano/, 'a cortesia de 1 ano NÃO está no texto que a atendente de clientes lê');
  assert.doesNotMatch(GROUP_KNOWLEDGE, /Ainda não há preço nem data cadastrados/, 'o texto do grupo não contradiz mais o preço');
  assert.match(GROUP_KNOWLEDGE, /no bloco "Migra School" mais abaixo/);
  const kb = presetSettings('migra-paraguai').business.knowledge;
  assert.match(kb, /# Migra School: preço, para quem é/);
  assert.doesNotMatch(kb, /um ano de Migra School|1 ano de Migra School|cortesia, para ajudar na decisão/, 'o que a atendente de clientes lê não traz a cortesia do Marcos');
});

test('a cortesia de 1 ano é regra INTERNA: só a Maria sabe, como decisão exclusiva do Marcos (o vendedor pede autorização)', () => {
  assert.match(STAFF_RULES, /REGRAS INTERNAS DA DIREÇÃO \(só para a equipe/);
  assert.match(STAFF_RULES, /o Marcos costuma dar 1 ano de Migra School como cortesia/);
  assert.match(STAFF_RULES, /A decisão é SÓ do Marcos: o vendedor deve pedir autorização a ele antes de oferecer/);
  assert.match(STAFF_RULES, /não ofereça nem confirme a cortesia por conta própria/);
});

test('oferta do aplicativo para a atendente de IA aparece ao vivo enquanto vale (e some depois), separada da cortesia do Marcos', () => {
  const crm = { appOffer: { enabled: true, regularPrice: 59.99, discountPct: 50, months: 6, period: 'por mês', validUntil: '2026-12-25' } };
  const ok = groupLiveBrief({ crm, now: () => new Date(2026, 10, 6) });
  assert.match(ok, /Oferta do aplicativo de idiomas/);
  assert.match(ok, /Vigente até 25\/12\/2026: 6 meses com 50% de desconto \(de R\$ 59,99 por mês por R\$ 29,99\)/);
  assert.match(ok, /diferente da cortesia de 1 ano, que é decisão exclusiva do Marcos/);
  assert.doesNotMatch(groupLiveBrief({ crm, now: () => new Date(2027, 0, 10) }), /Oferta do aplicativo/, 'vencida: não aparece');
  assert.doesNotMatch(groupLiveBrief({ crm: { appOffer: { ...crm.appOffer, enabled: false } }, now: () => new Date(2026, 10, 6) }), /Oferta do aplicativo/);
});

function reload(store, mutate) { mutate(store); store.flush(); return new Store(store.dataDir); }

test('instalações existentes: o bloco do grupo não editado ganha a versão nova; o da School entra uma vez; edição do Marcos é preservada', () => {
  const a = tempStore();
  a.updateSettings(presetSettings('migra-paraguai'));
  const antes = reload(a, (s) => { s.settings.business.knowledge = `# Outro\nTexto.\n\n${GROUP_BLOCK_V2}\n\n${MIGRATECH_KNOWLEDGE}`; delete s.settings.agent.schoolMemory2026; });
  const k = antes.settings.business.knowledge;
  assert.doesNotMatch(k, /Ainda não há preço nem data cadastrados/, 'o texto antigo do grupo foi trocado');
  assert.match(k, /# Migra School: preço, para quem é/);
  assert.match(k, /# Outro\nTexto\./);
  assert.match(k, /# Migra Tech:/, 'o resto fica');
  assert.equal((k.match(/# Migra School: preço/g) || []).length, 1);
  assert.equal((new Store(antes.dataDir).settings.business.knowledge.match(/# Migra School: preço/g) || []).length, 1, 'não duplica');

  const b = tempStore();
  b.updateSettings(presetSettings('migra-paraguai'));
  const editado = reload(b, (s) => { s.settings.business.knowledge = `${GROUP_BLOCK_V2}\n- Linha do Marcos.\n\n# Moradia\nFim.`; delete s.settings.agent.schoolMemory2026; });
  const kb = editado.settings.business.knowledge;
  assert.match(kb, /Linha do Marcos\./, 'a edição dele não se perde');
  assert.match(kb, /# Migra School: preço/, 'e o preço entra mesmo assim, com a regra de que vale o mais recente');
});

test('a Maria conhece o preço da School, as regras internas e a oferta vigente; a atendente de clientes não recebe a regra interna', async () => {
  const store = tempStore();
  store.updateSettings(presetSettings('migra-paraguai'));
  const auth = new Auth({ store, dataDir: store.dataDir });
  const marcos = auth.create({ name: 'Marcos Miguel', login: 'marcos', password: 'segredo123', role: 'admin' });
  auth.update(marcos.id, { whatsapp: '5545999990001' });
  const seen = [];
  const llm = { configured: true, chat: async ({ messages }) => { if (/classifica pedidos/.test(messages[0].content)) return { content: JSON.stringify({ acao: 'conversa' }) }; seen.push(messages[0].content); return { content: 'Certo!' }; } };
  const knowledge = () => `${groupLiveBrief({ crm: { appOffer: { enabled: true, regularPrice: 59.99, discountPct: 50, months: 6, period: 'por mês', validUntil: '2099-12-25' } } })}\n\n${STAFF_RULES}\n\n${companyBrief(store.settings)}`;
  const maria = new Maria({ store, auth, llm, knowledge, sales: {}, customers: {}, cash: {}, send: async () => {}, lineName: () => 'Maria', marcosPhone: () => '', audit() {}, log() {} });
  maria.config.lineId = 'l1';
  await maria.handle({ line: 'l1', jid: 'l:l1:5545999990001@s.whatsapp.net', phone: '5545999990001', text: 'Maria, quanto custa a Migra School e quando o Marcos dá cortesia?' });
  const sys = seen.at(-1);
  assert.match(sys, /Preço de tabela: R\$ 59,99 por mês \(cerca de R\$ 60,00\)/);
  assert.match(sys, /o Marcos costuma dar 1 ano de Migra School como cortesia/);
  assert.match(sys, /vendedor deve pedir autorização a ele antes de oferecer/);
  assert.match(sys, /Oferta do aplicativo de idiomas/);
  // o que a atendente de clientes lê (o conhecimento do negócio) não tem a cortesia
  assert.doesNotMatch(companyBrief(store.settings), /costuma dar 1 ano de Migra School/);
});
