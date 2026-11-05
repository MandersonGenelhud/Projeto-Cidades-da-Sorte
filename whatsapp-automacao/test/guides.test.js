import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Tutorials } from '../src/tutorials.js';
import { Cities } from '../src/cities.js';
import { Marketing } from '../src/marketing.js';
import { totpCode } from '../src/security.js';
import { tempStore } from './helpers.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const J = { 'content-type': 'application/json' };
const ck = (r) => r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

test('tutoriais: vendedor não vê a parte do administrador nem os ocultos; treinamento semanal só a cada 7 dias', async () => {
  let now = new Date('2026-11-03T10:00:00Z');
  const t = new Tutorials({ store: tempStore(), now: () => now });
  const admin = { role: 'admin' }; const seller = { role: 'seller' };
  assert.ok(t.list(admin).some((x) => x.audience === 'admin'));
  assert.ok(!t.list(seller).some((x) => x.audience === 'admin'), 'guia do administrador não aparece para vendedor');
  assert.equal(t.get(seller, t.list(admin).find((x) => x.audience === 'admin').id), null);
  assert.ok(t.list(seller).length >= 3);
  const hid = t.add({ title: 'Interno', body: 'x', audience: 'seller', hidden: true });
  assert.ok(!t.list(seller).some((x) => x.id === hid.id));
  assert.throws(() => t.add({ title: 'a', body: 'b', audience: 'todos' }), /Público/);
  // semanal
  let prompt = '';
  const body = 'Ideia da semana: próximo passo claro. '.repeat(12);
  const llm = { configured: true, async chat({ messages }) { prompt = messages[0].content; return { content: `Aqui vai: {"title":"Próximo passo claro","body":"${body}"}` }; } };
  assert.equal(t.isDue(), true);
  const w = await t.generateWeekly({ llm, stats: { vendasNovas: 2 } });
  assert.equal(w.auto, true);
  assert.match(prompt, /vendasNovas/);
  assert.match(prompt, /Nunca invente número/);
  assert.equal(await t.generateWeekly({ llm }), null, 'não repete dentro de 7 dias');
  now = new Date('2026-11-11T10:00:00Z');
  assert.equal(t.isDue(), true);
  const bad = { configured: true, async chat() { return { content: 'sem json' }; } };
  await assert.rejects(t.generateWeekly({ llm: bad }), /não devolveu/);
  assert.match(t.noticeText(w), /Treinamento novo/);
});

test('guia de cidades: emergência nacional a conferir, importação sem duplicar, texto do guia', () => {
  const c = new Cities({ store: tempStore() });
  const nat = c.nationalCity();
  assert.ok(nat.items.length >= 3 && nat.items.every((i) => i.verified === false));
  const cde = c.list('ciudad del este')[0];
  assert.equal(cde.department, 'Alto Paraná');
  const r = c.importText(cde.id, 'Categoria;Nome;Telefone;Endereço\nSaúde;Hospital Regional;+595 61 000000;Av. Principal\nSaúde;Hospital Regional;+595 61 000000;Av. Principal\nXx;;;');
  assert.equal(r.added, 1);
  assert.equal(r.bad.length, 1);
  const msg = c.message(cde.id, 'Carla Souza');
  assert.match(msg, /Olá, Carla!/);
  assert.match(msg, /Hospital Regional/);
  assert.match(msg, /Polícia Nacional/, 'emergência nacional vem junto');
  assert.throws(() => c.addItem(cde.id, { name: 'Sem dados' }), /telefone ou o endereço/);
  assert.throws(() => c.addCity({ name: 'Ciudad del Este' }), /já existe/);
  assert.equal(c.addItem(cde.id, { name: '<b>Mercado</b>', category: 'qualquer', phone: '1' }).category, 'Outros');
});

test('marketing: lê campanhas da Meta (só leitura), soma contatos, não segue endereço de fora e não vaza a chave', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url: String(url), auth: opts?.headers?.Authorization });
    if (String(url).includes('?fields=name,currency')) return { ok: true, json: async () => ({ name: 'Conta Migra', currency: 'BRL' }) };
    if (String(url).includes('/insights')) return { ok: true, json: async () => ({ data: [
      { campaign_id: '1', campaign_name: 'WhatsApp residência', spend: '300.50', impressions: '10000', clicks: '200', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '30' }, { action_type: 'link_click', value: '200' }] },
      { campaign_id: '2', campaign_name: 'Formulário', spend: '100', impressions: '2000', clicks: '20', actions: [{ action_type: 'lead', value: '5' }] },
      { campaign_id: '3', campaign_name: 'Sem resultado', spend: '50', impressions: '1000', clicks: '5' },
    ], paging: { next: 'https://evil.example/steal?x=1' } }) };
    throw new Error('chamada inesperada');
  };
  const store = tempStore();
  const m = new Marketing({ store, fetchImpl });
  await assert.rejects(m.sync(), /Cole o ID/);
  assert.throws(() => m.setConfig({ adAccountId: 'abc' }), /só números/);
  m.setConfig({ adAccountId: 'act_1234567890', metaToken: 'TOKEN-SECRETO' });
  const snap = await m.sync({ preset: 'last_7d' });
  assert.equal(calls.length, 2, 'não seguiu o endereço de fora');
  assert.ok(calls.every((c) => !c.url.includes('TOKEN-SECRETO') && c.auth === 'Bearer TOKEN-SECRETO'), 'a chave vai só no cabeçalho');
  assert.deepEqual([snap.totals.spend, snap.totals.chats, snap.totals.leads, snap.totals.results, snap.totals.cpl], [450.5, 30, 5, 35, 12.87]);
  assert.equal(snap.campaigns[0].name, 'WhatsApp residência');
  const view = m.withCrm(snap, [{ adTitle: 'a', stage: 'ganho' }, { adTitle: 'b', stage: 'novo' }, { stage: 'ganho' }]);
  assert.deepEqual(view.crm, { fromAds: 2, won: 1, costPerSale: 450.5 });
  const txt = m.plainSummary(view);
  assert.match(txt, /Sem resultado" gastou/);
  assert.match(txt, /cada venda custou/);
  assert.doesNotMatch(JSON.stringify(m.snapshot), /TOKEN-SECRETO/);
  const bad = new Marketing({ store: tempStore(), fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'Invalid OAuth', code: 190 } }) }) });
  bad.setConfig({ adAccountId: '12345', metaToken: 't' });
  await assert.rejects(bad.sync(), (e) => e.auth === true);
});

test('na prática: vendedor lê guia e tutoriais dele, não vê o do administrador nem o marketing; chave da Meta aparece mascarada', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-gd-'));
  const port = 39700 + Math.floor(Math.random() * 150);
  const base = `http://127.0.0.1:${port}`;
  const proc = spawn(process.execPath, ['src/server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: String(port), TUNNEL: 'off', OPEN_BROWSER: '' }, stdio: 'ignore' });
  t.after(() => proc.kill());
  for (let i = 0; i < 60; i++) { try { await fetch(`${base}/api/auth/state`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const login = async (user, first) => {
    const body = JSON.stringify({ name: 'Marcos', login: user, password: 'segredo123', whatsapp: '595987101567' });
    const r = first ? await fetch(`${base}/api/auth/setup`, { method: 'POST', headers: J, body }) : await fetch(`${base}/api/auth/login`, { method: 'POST', headers: J, body: JSON.stringify({ login: user, password: 'segredo123' }) });
    let cookie = ck(r);
    const call = (u, m = 'GET', b) => fetch(base + u, { method: m, headers: { cookie, ...J }, body: b ? JSON.stringify(b) : undefined });
    const sec = await (await call('/api/security/2fa/setup')).json();
    cookie = ck(await call('/api/security/2fa/enable', 'POST', { code: totpCode(sec.secret) })) || cookie;
    return call;
  };
  const admin = await login('marcos', true);
  await admin('/api/users', 'POST', { name: 'Ana', login: 'ana', password: 'segredo123', role: 'seller' });
  const ana = await login('ana');
  const adminList = await (await admin('/api/tutorials')).json();
  const sellerList = await (await ana('/api/tutorials')).json();
  const adm = adminList.find((x) => x.audience === 'admin');
  assert.ok(adm && !sellerList.some((x) => x.id === adm.id));
  assert.equal((await ana(`/api/tutorials/${adm.id}`)).status, 404);
  assert.equal((await ana('/api/tutorials', 'POST', { title: 'x', body: 'y' })).status, 403);
  assert.equal((await ana('/api/tutorials/weekly/run', 'POST', {})).status, 403);
  assert.equal((await ana('/api/cities')).status, 200);
  const cities = (await (await ana('/api/cities?q=encarnacion')).json()).cities;
  assert.equal(cities.length, 1);
  assert.equal((await ana(`/api/cities/${cities[0].id}/items`, 'POST', { name: 'x', phone: '1' })).status, 403);
  assert.equal((await ana(`/api/cities/${cities[0].id}/import`, 'POST', { text: 'a' })).status, 403);
  assert.equal((await ana('/api/marketing')).status, 403);
  assert.equal((await ana('/api/marketing/sync', 'POST', {})).status, 403);
  assert.equal((await admin('/api/marketing/config', 'PUT', { adAccountId: '999999', metaToken: 'SEGREDO-META-1234' })).status, 200);
  const m = await (await admin('/api/marketing')).json();
  assert.equal(m.hasToken, true);
  assert.doesNotMatch(JSON.stringify(m), /SEGREDO-META/);
  assert.doesNotMatch(JSON.stringify(await (await admin('/api/settings')).json()), /SEGREDO-META-1234/, 'a chave sai mascarada nas configurações');
  assert.doesNotMatch(JSON.stringify(await (await admin('/api/audit')).json()), /SEGREDO-META/);
});

test('treinamento: atalhos do WhatsApp aparecem para o vendedor e os da administração só para o administrador', async () => {
  const { Tutorials } = await import('../src/tutorials.js');
  const { COMMANDS } = await import('../src/seller-commands.js');
  const store = tempStore();
  const t = new Tutorials({ store });
  const seller = { id: 's', role: 'seller' }; const admin = { id: 'a', role: 'admin' };
  const item = t.list(seller).find((x) => /Atalhos no seu WhatsApp/.test(x.title));
  assert.ok(item, 'vendedor vê o guia de atalhos');
  const mine = t.get(seller, item.id);
  for (const [name, c] of Object.entries(COMMANDS)) if (!c.admin) assert.ok(mine.body.includes(`/${name}`), `guia do vendedor cita /${name}`);
  assert.ok(!/\/resumo|\/saude/.test(mine.body), 'vendedor não vê os atalhos de administrador');
  assert.ok(!t.list(seller).some((x) => /administração/.test(x.title)));
  assert.ok(t.list(admin).some((x) => /Atalhos da administração/.test(x.title)));
});
