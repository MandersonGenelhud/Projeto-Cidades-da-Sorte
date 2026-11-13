import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerLinkDiretoRoutes, codeIn, directText } from '../src/routes/link-direto.js';

function setup({ enabled = true, connectedIds = ['giovana', 'eliezer'] } = {}) {
  const users = [
    { id: 'giovana', name: 'Giovana Souza', role: 'seller', whatsapp: '5545999000001', sectors: ['documentacao'], rotationSeq: 1 },
    { id: 'eliezer', name: 'Eliezer', role: 'seller', whatsapp: '5545999000002', sectors: ['documentacao'], rotationSeq: 2 },
    { id: 'diego', name: 'Diego', role: 'seller', whatsapp: '5545999000003', sectors: ['loteamentos'], rotationSeq: 0 },
  ];
  const store = { settings: { crm: { directLink: { enabled }, centralWhatsapp: '595981000000' } }, data: { rotationSeq: 2 }, save() {}, addLog() {}, updateSettings(p) { Object.assign(this.settings.crm.directLink, p.crm.directLink); } };
  const notes = []; const assigned = [];
  const crm = {
    nextSeller: (pool) => users.filter((u) => pool(u)).sort((a, b) => a.rotationSeq - b.rotationSeq)[0],
    assign: (u, id, owner) => { assigned.push([id, owner]); },
    addNote: (u, id, t) => notes.push(t),
  };
  const lines = { byOwner: (id) => ({ id: `l-${id}`, phone: users.find((u) => u.id === id)?.whatsapp }) };
  const wa = { isConnected: (k) => connectedIds.some((id) => k.startsWith(`l:l-${id}:`)) };
  const routes = {};
  const app = { get: (p, h) => { routes[`GET ${p}`] = h; }, put: (p, h) => { routes[`PUT ${p}`] = h; } };
  const pool = (u) => u.role === 'seller' && (!u.sectors?.length || u.sectors.includes('documentacao')); // como o rodízio da Central: Diego (só imóveis) fora
  const ld = registerLinkDiretoRoutes(app, { store, auth: { users, get: (id) => users.find((u) => u.id === id) }, crm, lines, wa, pool, centralPhone: () => store.settings.crm.centralWhatsapp, needAdmin: () => {}, httpError: (c, m) => new Error(m), publicBase: () => 'https://hub.migra.com' });
  return { ld, users, store, routes, notes, assigned };
}

test('cada clique vai para o próximo vendedor do rodízio, com mensagem pronta e código; o Diego nunca recebe', () => {
  const { ld } = setup();
  const vistos = [];
  for (let i = 0; i < 6; i++) {
    const r = ld.click({ ua: 'Mozilla/5.0 (iPhone)' });
    vistos.push(r.seller.id);
    assert.match(r.url, /^https:\/\/wa\.me\/5545999000\d{3}\?text=/);
    assert.match(decodeURIComponent(r.url), /vim pelo anúncio da Migra.*Meu código é AN-[A-Z0-9]{4}\./);
  }
  assert.deepEqual(vistos, ['giovana', 'eliezer', 'giovana', 'eliezer', 'giovana', 'eliezer']);
  assert.ok(!vistos.includes('diego'));
});

test('robô da miniatura do link não conta nem gasta a vez; a mesma pessoa volta para o mesmo vendedor', () => {
  const { ld, store } = setup();
  const bot = ld.click({ ua: 'facebookexternalhit/1.1' });
  assert.equal(bot.seller, null);
  assert.match(bot.url, /wa\.me\/595981000000/, 'robô vai para a Central');
  assert.equal(Object.keys(store.data.directClicks || {}).length, 0);
  const a = ld.click({ ua: 'Mozilla' });
  const again = ld.click({ ua: 'Mozilla', cookie: a.code });
  assert.equal(again.seller.id, a.seller.id);
  assert.equal(again.code, a.code);
  assert.equal(again.repeat, true);
  const other = ld.click({ ua: 'Mozilla' });
  assert.notEqual(other.seller.id, a.seller.id, 'a repetição não avançou o rodízio de outra pessoa');
});

test('prefere quem está com o WhatsApp conectado ao sistema; sem ninguém, vai para a Central; desligado, vai para a Central', () => {
  let s = setup({ connectedIds: ['eliezer'] });
  assert.equal(s.ld.click({ ua: 'Mozilla' }).seller.id, 'eliezer');
  s = setup();
  s.users.forEach((u) => { u.whatsapp = ''; });
  const none = s.ld.click({ ua: 'Mozilla' });
  assert.equal(none.seller, null, 'ninguém com WhatsApp: não fica sem destino');
  assert.match(none.url, /595981000000/);
  s = setup({ enabled: false });
  const off = s.ld.click({ ua: 'Mozilla' });
  assert.equal(off.seller, null);
  assert.match(off.url, /595981000000/);
});

test('quando o cliente manda a mensagem com o código no número do vendedor: chegada marcada, prospecto ligado ao vendedor e ao anúncio', () => {
  const { ld, store, notes, assigned } = setup();
  const r = ld.click({ ua: 'Mozilla', campanha: 'residencia-novembro' });
  const lead = { id: 'L1', ownerId: null, source: 'whatsapp' };
  const msg = { jid: 'l:l-giovana:5511988887777@s.whatsapp.net', line: 'l-giovana', text: directText(r.seller, r.code) };
  const c = ld.onIncoming(msg, lead);
  assert.ok(c.arrivedAt);
  assert.deepEqual(assigned, [['L1', r.seller.id]]);
  assert.equal(lead.adTitle, 'Link direto: residencia-novembro');
  assert.equal(lead.source, 'link_anuncio');
  assert.match(notes[0], /link direto do anúncio/);
  assert.equal(ld.onIncoming(msg, lead), null, 'não marca duas vezes');
  assert.equal(store.data.directClicks[r.code].key, msg.jid);
  assert.equal(codeIn('meu código é an-7k3q'), 'AN-7K3Q');
});

test('rota pública /v redireciona e grava o cookie; painel mostra o link e os cliques de hoje', () => {
  const { routes } = setup();
  const headers = {}; let redirected = '';
  const res = { append: (k, v) => { headers[k] = v; }, set() { return this; }, redirect: (code, url) => { redirected = url; }, status() { return this; }, type() { return this; }, send() {} };
  routes['GET /v']({ headers: {}, get: () => 'Mozilla', params: {}, query: { utm_campaign: 'teste' }, secure: true }, res);
  assert.match(redirected, /^https:\/\/wa\.me\//);
  assert.match(headers['Set-Cookie'], /^mg_v=AN-/);
  let out; routes['GET /api/link-direto']({}, { json: (x) => { out = x; } });
  assert.equal(out.url, 'https://hub.migra.com/v');
  assert.deepEqual(out.rodizio.map((v) => v.nome), ['Giovana Souza', 'Eliezer']);
  assert.equal(out.hoje.reduce((s, x) => s + x.cliques, 0), 1);
});

test('alguém clicando sem parar no link não gasta a vez dos vendedores', () => {
  const { routes, store } = setup();
  const res = () => ({ append() {}, set() { return this; }, redirect: (c, url) => { res.last = url; }, status() { return this; }, type() { return this; }, send() {} });
  for (let i = 0; i < 12; i++) routes['GET /v']({ headers: {}, get: () => 'Mozilla', params: {}, query: {}, ip: '1.2.3.4' }, res());
  assert.equal(Object.keys(store.data.directClicks).length, 8, 'depois de 8 cliques em 10 min, os outros vão para a Central');
});
