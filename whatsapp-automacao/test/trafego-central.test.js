import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Crm } from '../src/crm.js';
import { Sectors, parsePeople } from '../src/sectors.js';
import { Traffic, trafficRouteAllowed } from '../src/traffic.js';
import { tempStore } from './helpers.js';

// ---------- Tráfego ----------
function trafficSetup() {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const crm = new Crm({ store, auth });
  const convs = {};
  const mk = (key, name, source, extra = {}) => {
    const l = crm.ensureFromConversation({ key, phone: key.replace(/\D/g, '').slice(-12), name, channel: 'whatsapp' });
    Object.assign(l, { source, createdAt: '2026-11-11T14:00:00Z', ...extra });
    return l;
  };
  const a = mk('l:central:5545988880001@s.whatsapp.net', 'A', 'whatsapp_ads', { adTitle: 'Residência 90 dias', handoff: { at: 'x' } });
  const b = mk('l:central:5545988880002@s.whatsapp.net', 'B', 'whatsapp_ads', { adTitle: 'Residência 90 dias', stage: 'ganho' });
  const c = mk('5545988880003@s.whatsapp.net', 'C', 'whatsapp');
  const d = mk('l:geo:5545988880004@s.whatsapp.net', 'D', 'whatsapp');
  const old = mk('5545988880005@s.whatsapp.net', 'E', 'manual'); // cadastro manual não é "chegada"
  convs[a.conversationKey] = { messages: [{ role: 'user', content: 'oi', at: '2026-11-11T14:00:00Z' }, { role: 'assistant', content: 'oi!', at: '2026-11-11T14:02:00Z' }] };
  convs[b.conversationKey] = { messages: [{ role: 'user', content: 'oi', at: '2026-11-11T14:00:00Z' }, { role: 'assistant', content: 'oi!', at: '2026-11-11T14:20:00Z' }] };
  convs[c.conversationKey] = { messages: [{ role: 'user', content: 'oi', at: '2026-11-11T14:00:00Z' }] };
  void d; void old;
  const t = new Traffic({ store, crm, lineLabel: (id) => ({ central: 'Central de Atendimento', geo: 'Geovana' })[id], conversation: (k) => convs[k] || null, now: () => new Date('2026-11-11T23:00:00Z') });
  return { t, crm };
}

test('tráfego: novos por dia, por número, por anúncio, resposta e encaminhamento (sem cadastro manual)', () => {
  const { t } = trafficSetup();
  const r = t.report({ from: '2026-11-11', to: '2026-11-11' });
  assert.equal(r.totais.novos, 4);
  assert.equal(r.totais.deAnuncio, 2); assert.equal(r.totais.organicos, 2);
  assert.equal(r.totais.encaminhados, 1); assert.equal(r.totais.fechados, 1); assert.equal(r.totais.conversao, 25);
  assert.equal(r.totais.semResposta, 1, 'o cliente C escreveu e ninguém respondeu');
  assert.equal(r.totais.tempoMedianoMin, 11, 'mediana de 2 e 20 minutos');
  assert.equal(r.totais.respondidosEm5min, 50);
  const central = r.numeros.find((n) => n.numero === 'Central de Atendimento');
  assert.equal(central.novos, 2); assert.equal(central.deAnuncio, 2);
  assert.ok(r.numeros.find((n) => n.numero === 'Número principal'));
  assert.ok(r.numeros.find((n) => n.numero === 'Geovana'));
  assert.deepEqual(r.anuncios.map((x) => [x.anuncio, x.novos]), [['Residência 90 dias', 2]]);
});

test('tráfego: relatório diário em texto e planilha, sem telefone nem nome de cliente', () => {
  const { t } = trafficSetup();
  const txt = t.dailyText('2026-11-11');
  assert.match(txt, /Chegaram \*4\* pessoa/);
  assert.match(txt, /Central de Atendimento 2/);
  assert.match(txt, /Residência 90 dias 2/);
  assert.match(txt, /ainda sem resposta/);
  assert.doesNotMatch(txt, /5545988880|Carlos| A | B /);
  const csv = t.csv(t.report({ from: '2026-11-11', to: '2026-11-11' }));
  assert.match(csv, /^Data;Novos contatos/);
  assert.match(csv, /2026-11-11;4;2;2;1;1;1;11/);
  assert.match(t.dailyText('2026-10-01'), /Nenhum contato novo/);
});

test('equipe de tráfego: só lê o relatório; qualquer outra rota é recusada', () => {
  assert.equal(trafficRouteAllowed('GET', '/traffic'), true);
  assert.equal(trafficRouteAllowed('GET', '/traffic.csv'), true);
  assert.equal(trafficRouteAllowed('GET', '/me'), true);
  for (const [m, p] of [['GET', '/leads'], ['GET', '/sales'], ['GET', '/conversations'], ['GET', '/settings'], ['GET', '/users'], ['PUT', '/traffic/config'], ['POST', '/traffic/send-report'], ['POST', '/leads'], ['GET', '/status'], ['GET', '/cash']]) {
    assert.equal(trafficRouteAllowed(m, p), false, `${m} ${p}`);
  }
});

test('usuário "só tráfego": não entra no rodízio, não recebe indicações nem setores', () => {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const u = auth.create({ name: 'Gestor de Tráfego', login: 'trafego', password: 'segredo123', role: 'seller', whatsapp: '595981000009', trafficOnly: true, sectors: ['documentacao'] });
  const g = auth.get(u.id);
  assert.equal(g.trafficOnly, true); assert.equal(g.receivesLeads, false);
  const crm = new Crm({ store, auth });
  assert.ok(!crm.rotation().some((x) => x.id === g.id));
  auth.update(g.id, { receivesLeads: true });
  assert.equal(auth.get(g.id).receivesLeads, false, 'não dá para ligar o rodízio de quem é só tráfego');
  auth.update(g.id, { trafficOnly: false });
  auth.update(g.id, { receivesLeads: true });
  assert.equal(auth.get(g.id).receivesLeads, true);
  const adm = auth.get(auth.create({ name: 'Adm', login: 'adm', password: 'segredo123', role: 'admin' }).id);
  assert.ok(!adm.trafficOnly, 'administrador nunca é "só tráfego"');
});

// ---------- IA do vendedor continua ----------
function sectorSetup() {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  auth.create({ name: 'Marcos', login: 'marcos', password: 'segredo123', role: 'admin' });
  const diego = auth.get(auth.create({ name: 'Diego Corretor', login: 'diego', password: 'segredo123', role: 'seller', whatsapp: '595981000002', sectors: ['loteamentos'] }).id);
  const crm = new Crm({ store, auth });
  const sent = [];
  const sectors = new Sectors({ store, crm, auth, send: async (phone, text) => sent.push({ phone, text }) });
  const conv = { key: '5511911112222@s.whatsapp.net', phone: '5511911112222', name: 'Paula', messages: [{ role: 'user', content: 'quero um lote' }] };
  return { sectors, sent, conv, diego };
}

test('imóvel: se a IA do número do corretor está ligada, ela chama o cliente e continua; o aviso diz isso', async () => {
  const { sectors, sent, conv, diego } = sectorSetup();
  const started = [];
  sectors.aiLineFor = () => ({ id: 'l1', label: 'Diego', agent: true });
  sectors.startOnLine = async (a) => { started.push(a); };
  const r = await sectors.route(conv, { setor: 'loteamentos', resumo: 'quer lote' });
  assert.equal(started.length, 1);
  assert.equal(started[0].phone, '5511911112222');
  assert.match(sent[0].text, /A IA do seu WhatsApp \(Diego\) já vai chamar o cliente/);
  assert.match(r.instrucao, /pelo WhatsApp dele em instantes/);
  void diego;
});

test('imóvel: IA do corretor desligada: ela NÃO chama o cliente e o aviso diz que o atendimento é do corretor', async () => {
  const { sectors, sent, conv } = sectorSetup();
  let called = false;
  sectors.aiLineFor = () => null;
  sectors.startOnLine = async () => { called = true; };
  await sectors.route(conv, { setor: 'loteamentos', resumo: 'quer lote' });
  assert.equal(called, false);
  assert.match(sent[0].text, /A IA do seu número está desligada: o atendimento é seu/);
  assert.match(sent[0].text, /wa\.me\/5511911112222/);
});
