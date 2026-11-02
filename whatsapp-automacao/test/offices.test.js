import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { totpCode } from '../src/security.js';
import { Auth } from '../src/auth.js';
import { Crm } from '../src/crm.js';
import { Sectors } from '../src/sectors.js';
import { sees, officeOfUser, isGlobal } from '../src/offices.js';
import { siteOfficeMap, siteHostsFrom } from '../src/site-host.js';
import { tempStore } from './helpers.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const J = { 'content-type': 'application/json' };
const ck = (r) => r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

test('regras de escritório: administrador geral vê os dois; equipe só o seu; sem marca = Paraguai', () => {
  const admin = { role: 'admin' }; const pr = { role: 'seller', office: 'pr' }; const old = { role: 'seller' };
  assert.equal(isGlobal(admin), true);
  assert.equal(sees(admin, 'pr') && sees(admin, 'py'), true);
  assert.equal(sees(pr, 'pr'), true);
  assert.equal(sees(pr, 'py'), false);
  assert.equal(sees(pr, undefined), false, 'sem marca é do Paraguai');
  assert.equal(officeOfUser(old), 'py');
  assert.deepEqual([...siteHostsFrom({ SITE_HOSTS: 'a.com=py,b.com.br=pr,www.b.com.br=pr' })], ['a.com', 'b.com.br', 'www.b.com.br']);
  assert.equal(siteOfficeMap({ SITE_HOSTS: 'a.com=py,b.com.br=pr' }).get('b.com.br'), 'pr');
  assert.equal(siteOfficeMap({ SITE_HOSTS: 'plain.com' }).get('plain.com'), 'py');
});

test('rodízio e setores: cada escritório só distribui para a própria equipe', () => {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  auth.create({ name: 'Marcos', login: 'marcos', password: 'segredo123', role: 'admin' });
  const ana = auth.create({ name: 'Ana', login: 'ana', password: 'segredo123', whatsapp: '595981000001', office: 'py', sectors: ['documentacao'] });
  const paulo = auth.create({ name: 'Paulo', login: 'paulo', password: 'segredo123', whatsapp: '5545999000002', office: 'pr', sectors: ['documentacao'] });
  const crm = new Crm({ store, auth });
  const sectors = new Sectors({ store, crm, auth });
  const lead = crm.byId(crm.create({ name: 'Sistema', role: 'admin' }, { name: 'Cliente PR', phone: '5545988887777', office: 'pr' }).id);
  assert.equal(crm.routeLead(lead).id, paulo.id, 'lead do Paraná vai para a equipe do Paraná');
  const lead2 = crm.byId(crm.create({ name: 'Sistema', role: 'admin' }, { name: 'Cliente PY', phone: '595981222333' }).id);
  assert.equal(lead2.office, 'py');
  assert.equal(crm.routeLead(lead2).id, ana.id);
  assert.deepEqual(sectors.people('documentacao', 'pr').map((p) => p.name), ['Paulo']);
  assert.deepEqual(sectors.people('documentacao', 'py').map((p) => p.name), ['Ana']);
  assert.equal(sectors.next('loteamentos', 'pr'), null, 'sem ninguém marcado no Paraná, não cai no Paraguai');
  // usuários antigos (sem escritório) viram Paraguai
  assert.equal(auth.get(ana.id).office, 'py');
});

test('na prática: cada equipe vê só o seu escritório; o administrador do escritório cuida só do dele; o geral compara os dois', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-off-'));
  const port = 39800 + Math.floor(Math.random() * 150);
  const base = `http://127.0.0.1:${port}`;
  let proc;
  const start = async () => {
    proc = spawn(process.execPath, ['src/server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: String(port), TUNNEL: 'off', OPEN_BROWSER: '' }, stdio: 'ignore' });
    for (let i = 0; i < 60; i++) { try { await fetch(`${base}/api/auth/state`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  };
  t.after(() => proc?.kill());
  await start();
  const login = async (user, pass, first) => {
    const r = first ? await fetch(`${base}/api/auth/setup`, { method: 'POST', headers: J, body: JSON.stringify({ name: 'Marcos', login: user, password: pass, whatsapp: '595987101567' }) }) : await fetch(`${base}/api/auth/login`, { method: 'POST', headers: J, body: JSON.stringify({ login: user, password: pass }) });
    let cookie = ck(r);
    const call = (u, m = 'GET', b, h = {}) => fetch(base + u, { method: m, headers: { cookie, ...J, ...h }, body: b ? JSON.stringify(b) : undefined });
    const sec = await (await call('/api/security/2fa/setup')).json();
    cookie = ck(await call('/api/security/2fa/enable', 'POST', { code: totpCode(sec.secret) })) || cookie;
    return call;
  };
  const admin = await login('marcos', 'segredo123', true);
  const mk = async (name, login, extra) => (await admin('/api/users', 'POST', { name, login, password: 'segredo123', role: 'seller', ...extra })).json();
  const ana = await mk('Ana', 'ana', { office: 'py' });
  const paulo = await mk('Paulo', 'paulo', { office: 'pr' });
  const chefe = await mk('Chefe PR', 'chefepr', { office: 'pr', officeAdmin: true });
  assert.equal(chefe.officeAdmin, true);
  assert.equal(chefe.office, 'pr');
  const lead = async (name, phone, extra) => (await admin('/api/leads', 'POST', { name, phone, source: 'whatsapp', ...extra })).json();
  const A = await lead('Cliente A', '595981111111', { ownerId: ana.id, office: 'py', conversationKey: 'k-a' });
  const B = await lead('Cliente B', '595981222222', { ownerId: paulo.id, office: 'pr', conversationKey: 'k-b' });
  const C = await lead('Cliente C', '595981333333', { office: 'pr', conversationKey: 'k-c' });
  assert.deepEqual([A.office, B.office, C.office], ['py', 'pr', 'pr']);
  await new Promise((r) => setTimeout(r, 800)); proc.kill(); await new Promise((r) => setTimeout(r, 1500));
  const f = path.join(dir, 'db.json'); const db = JSON.parse(fs.readFileSync(f, 'utf8'));
  const cv = (key, name) => ({ key, name, phone: key.replace(/\D/g, ''), handoff: false, updatedAt: new Date().toISOString(), messages: [{ role: 'user', content: 'oi', at: new Date().toISOString() }] });
  db.conversations = { 'k-a': cv('k-a', 'Cliente A'), 'k-b': cv('k-b', 'Cliente B'), 'k-c': cv('k-c', 'Cliente C') };
  fs.writeFileSync(f, JSON.stringify(db));
  await start();
  const names = async (call, u, h) => (await (await call(u, 'GET', undefined, h)).json()).map((x) => x.name || x.key).sort();

  // administrador geral: os dois lados, ou um de cada vez
  assert.deepEqual(await names(admin, '/api/leads'), ['Cliente A', 'Cliente B', 'Cliente C']);
  assert.deepEqual(await names(admin, '/api/leads', { 'X-Office': 'pr' }), ['Cliente B', 'Cliente C']);
  assert.deepEqual(await names(admin, '/api/leads', { 'X-Office': 'py' }), ['Cliente A']);
  assert.deepEqual(await names(admin, '/api/conversations', { 'X-Office': 'pr' }), ['Cliente B', 'Cliente C']);

  // vendedores: só o próprio escritório e só o que é deles
  const sAna = await login('ana', 'segredo123'); const sPaulo = await login('paulo', 'segredo123');
  assert.deepEqual(await names(sAna, '/api/leads'), ['Cliente A']);
  assert.deepEqual(await names(sPaulo, '/api/leads'), ['Cliente B', 'Cliente C'], 'enxerga o cliente sem dono do próprio escritório');
  assert.deepEqual(await names(sPaulo, '/api/conversations'), ['Cliente B']);
  assert.equal((await sPaulo('/api/conversations/k-a')).status, 403);
  assert.equal((await sAna('/api/offices')).status, 200);
  assert.equal((await sPaulo('/api/offices-compare')).status, 403);
  const rk = await (await sPaulo('/api/crm/ranking')).json();
  assert.ok(!JSON.stringify(rk).includes('"Ana"'), 'o ranking do Paraná não mostra a equipe do Paraguai');

  // administrador do escritório (Paraná)
  const boss = await login('chefepr', 'segredo123');
  assert.deepEqual(await names(boss, '/api/leads'), ['Cliente B', 'Cliente C']);
  assert.deepEqual(await names(boss, '/api/conversations'), ['Cliente B', 'Cliente C']);
  assert.equal((await boss('/api/conversations/k-a')).status, 403);
  const team = await (await boss('/api/users')).json();
  assert.deepEqual(team.map((u) => u.login).sort(), ['chefepr', 'paulo'], 'só a equipe do Paraná');
  const created = await (await boss('/api/users', 'POST', { name: 'Novo PR', login: 'novopr', password: 'segredo123', role: 'admin', office: 'py', officeAdmin: true })).json();
  assert.deepEqual([created.role, created.office, created.officeAdmin], ['seller', 'pr', false], 'não consegue criar admin nem gente do Paraguai');
  assert.equal((await boss(`/api/users/${ana.id}`, 'PATCH', { name: 'X' })).status, 403, 'não mexe na equipe do outro escritório');
  assert.equal((await boss(`/api/users/${paulo.id}`, 'PATCH', { name: 'Paulo S.', role: 'admin', office: 'py', officeAdmin: true })).status, 200);
  const after = (await (await boss('/api/users')).json()).find((u) => u.id === paulo.id);
  assert.deepEqual([after.name, after.role, after.office, after.officeAdmin], ['Paulo S.', 'seller', 'pr', false], 'só muda o que é permitido');
  assert.equal((await boss(`/api/users/${chefe.id}`, 'PATCH', { officeAdmin: false })).status, 403, 'não mexe no próprio acesso');
  for (const u of ['/api/settings', '/api/offices-compare', '/api/legacy', '/api/audit']) assert.equal((await boss(u)).status, 403, u);
  assert.equal((await boss('/api/offices/pr', 'PUT', { name: 'x' })).status, 403);
  const att = await (await boss('/api/attendants')).json();
  assert.ok(!att.attendants.some((a) => a.name === 'Ana'), 'painel de atendentes sem o Paraguai');
  const ex = await (await boss('/api/executive')).json();
  assert.equal(ex.crm.newLeads, 2, 'resultados só do Paraná');

  // IA própria e comparativo (administrador geral)
  assert.equal((await admin('/api/offices/pr', 'PUT', { name: 'Migra Paraná', overrides: { agent: { agentName: 'Bia', instructions: 'Atendemos de Foz do Iguaçu.' }, business: { address: 'Foz do Iguaçu' } } })).status, 200);
  const cfg = await (await admin('/api/offices/pr')).json();
  assert.deepEqual([cfg.overrides.agent.agentName, cfg.overrides.business.address], ['Bia', 'Foz do Iguaçu']);
  const cmp = await (await admin('/api/offices-compare')).json();
  assert.deepEqual(cmp.map((o) => [o.id, o.leadsMes]), [['py', 1], ['pr', 2]]);
  const audit = await (await admin('/api/audit')).json();
  assert.ok(audit.items.some((e) => e.entity === 'escritório'));
});
