import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Maria, PROFILES } from '../src/maria.js';
import { tempStore } from './helpers.js';

const LINE = 'l1';
const PARC = '556984761664';

function setup() {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const adm = auth.create({ name: 'Marcos Miguel', login: 'marcos', password: 'segredo123', role: 'admin' });
  const par = auth.create({ name: 'Solenaine Eletromec', login: 'solenaine', password: 'segredo123', role: 'seller' });
  auth.update(adm.id, { whatsapp: '5545999990001' }); auth.update(par.id, { whatsapp: PARC });
  store.updateSettings({ maria: { ...store.settings.maria, profiles: { [par.id]: 'parceiro' } } });
  const sent = []; const seen = []; const asked = [];
  const llm = { configured: true, chat: async ({ messages }) => { seen.push(messages[0].content); return { content: 'Resposta.' }; } };
  const maria = new Maria({
    store, auth, llm, sales: { listFor: () => { asked.push('sales'); return []; }, canSee: () => true, view: (s) => s, summary: () => ({}) }, customers: { search: () => [] }, cash: { entries: () => { asked.push('cash'); return []; } },
    knowledge: (o) => (o?.publicOnly ? '# BASE PUBLICA' : '# BASE PUBLICA\n# REGRAS INTERNAS DA DIREÇÃO cortesia de 1 ano'),
    send: async (j, p) => { sent.push(p); }, lineName: () => 'Maria', marcosPhone: () => '5545999990001', audit: () => {}, log: () => {},
  });
  maria.config.lineId = LINE;
  const say = async (text) => { sent.length = 0; await maria.handle({ line: LINE, jid: `l:${LINE}:${PARC}@s.whatsapp.net`, phone: PARC, text }); return sent.map((m) => m.text).filter(Boolean).join('\n'); };
  return { maria, say, seen, asked, par };
}

test('o perfil parceiro existe e não é o perfil completo', () => {
  const t = setup();
  assert.ok(PROFILES.parceiro);
  assert.equal(t.maria.profileOf(t.par), 'parceiro');
});

test('parceiro: faturamento, caixa, atrasos e portfólio não são liberados', async () => {
  const t = setup();
  for (const q of ['Maria, como está o faturamento do mês?', 'Maria, como está o caixa este mês?', 'Maria, tem parcelas em atraso?', 'Maria, me dá o resumo de hoje', 'Maria, anote no portfólio: algo']) {
    const r = await t.say(q);
    assert.match(r, /não está liberado|só os administradores/, q);
  }
  assert.deepEqual(t.asked, [], 'nenhum dado interno foi consultado');
});

test('parceiro conversa só com a base pública: sem regras internas nem lista da equipe', async () => {
  const t = setup();
  await t.say('Maria, quanto custa o pacote Ouro?');
  const prompt = t.seen.find((s) => s.includes('BASE DA EMPRESA'));
  assert.ok(prompt, 'respondeu pelo bate-papo');
  assert.match(prompt, /BASE PUBLICA/);
  assert.doesNotMatch(prompt, /REGRAS INTERNAS DA DIREÇÃO|cortesia de 1 ano|Migra School é decisão/);
  assert.doesNotMatch(prompt, /Equipe cadastrada/);
  assert.match(prompt, /PARCEIRO EXTERNO/);
});

test('parceiro pode agir como vendedor: pedido de orçamento chega ao fluxo dele (só o que é dele)', async () => {
  const t = setup();
  const r = await t.say('Maria, orce o pacote Ouro');
  assert.doesNotMatch(r, /não está liberado/);
});
