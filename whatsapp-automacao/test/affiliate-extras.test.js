import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Affiliates } from '../src/affiliates.js';
import { AffiliateExtras } from '../src/affiliate-extras.js';
import { Auth } from '../src/auth.js';
import { Crm } from '../src/crm.js';
import { tempStore } from './helpers.js';

const admin = { role: 'admin', name: 'Marcos' };
function setup(nowIso = '2026-11-20T12:00:00Z') {
  let now = new Date(nowIso);
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const crm = new Crm({ store, auth });
  const affiliates = new Affiliates({ store, crm, auth, secret: 'x' });
  const toAff = []; const toAdm = [];
  const x = new AffiliateExtras({ store, affiliates, crm, dataDir: store.dataDir, notifyAffiliate: async (p, t) => toAff.push([p, t]), notifyAdmins: async (t) => toAdm.push(t), now: () => now });
  const mk = (name, phone) => affiliates.signup({ name, whatsapp: phone, password: 'segredo123', acceptTerms: true, pixKey: `${phone}@pix`, cpf: '12345678909' });
  const ana = mk('Ana Souza', '11999990001'); const bia = mk('Bia Lima', '11999990002');
  const lead = crm.byId(crm.create({ name: 'Sys', role: 'admin' }, { name: 'Carlos Cliente', phone: '5511988887777' }).id);
  affiliates.attach(lead, ana);
  const comm = (affId, amount, createdAt, currency = 'BRL') => { const c = { id: Math.random().toString(16).slice(2, 10), affId, leadId: lead.id, clientName: 'Carlos', currency, amount, status: 'a_pagar', createdAt }; store.data.affiliates.commissions.push(c); return c; };
  return { store, affiliates, x, ana, bia, lead, comm, toAff, toAdm, setNow: (d) => { now = new Date(d); } };
}

test('saque: só depois do prazo de segurança, pede tudo o que está liberado, paga ou recusa (com motivo)', async () => {
  const { x, ana, comm, toAdm, toAff } = setup();
  comm(ana.id, 300, '2026-11-01T10:00:00Z');
  comm(ana.id, 200, '2026-11-18T10:00:00Z'); // ainda no prazo de 7 dias
  const b = x.balance(ana);
  assert.deepEqual(b.available, { BRL: 300 }); assert.deepEqual(b.waiting, { BRL: 200 });
  const p = await x.requestPayout(ana, { currency: 'BRL' });
  assert.equal(p.amount, 300); assert.equal(p.dueAt, '2026-11-21T12:00:00.000Z', 'pagar em até 24 horas');
  assert.match(toAdm[0], /Saque de indicador/);
  await assert.rejects(x.requestPayout(ana, {}), /Não há comissão disponível/, 'não pede o mesmo dinheiro duas vezes');
  await assert.rejects(x.payPayout({ role: 'seller' }, p.id), /Só o administrador/);
  await assert.rejects(x.rejectPayout(admin, p.id, {}), /motivo/);
  await x.rejectPayout(admin, p.id, { reason: 'Chave Pix errada' });
  assert.deepEqual(x.balance(ana).available, { BRL: 300 }, 'recusado volta para o saldo');
  const p2 = await x.requestPayout(ana, {});
  await x.payPayout(admin, p2.id);
  assert.deepEqual(x.balance(ana).available, {});
  assert.ok(toAff.some(([, t]) => /foi pago/.test(t)));
});

test('saque: sem chave Pix cadastrada não pede', async () => {
  const { x, ana, comm } = setup();
  comm(ana.id, 100, '2026-11-01T10:00:00Z');
  delete ana.pixKey;
  await assert.rejects(x.requestPayout(ana, {}), /Cadastre primeiro/);
});

test('troca de indicação: o primeiro indicador é avisado e decide; a comissão a pagar vai junto; paga não muda mais', async () => {
  const { x, ana, bia, lead, comm, toAff, affiliates } = setup();
  const c = comm(ana.id, 500, '2026-11-01T10:00:00Z');
  const t = await x.requestTransfer(admin, { lead: lead.code, toCode: bia.code, reason: 'É meu cunhado' });
  assert.match(toAff[0][1], /pediu que a indicação fique com outra pessoa/);
  await assert.rejects(x.requestTransfer(admin, { lead: lead.code, toCode: bia.code }), /aguardando/);
  await assert.rejects(x.respond(bia, t.id, true), /não encontrado/, 'só o primeiro indicador responde');
  await x.respond(ana, t.id, true);
  assert.equal(lead.affiliateId, bia.id); assert.equal(c.affId, bia.id);
  // Com comissão paga, não muda mais.
  c.status = 'paga';
  await assert.rejects(x.cede(bia, { lead: lead.code, toCode: ana.code }), /já foi paga/);
  assert.equal(affiliates.get(lead.affiliateId).id, bia.id);
});

test('troca: o indicador pode manter; sem resposta a diretoria decide; o indicador também cede por conta própria', async () => {
  const { x, ana, bia, lead } = setup();
  const t = await x.requestTransfer(admin, { lead: lead.code, toCode: bia.code });
  await x.respond(ana, t.id, false);
  assert.equal(lead.affiliateId, ana.id);
  const t2 = await x.requestTransfer(admin, { lead: lead.code, toCode: bia.code });
  await assert.rejects(x.decide({ role: 'seller' }, t2.id, true), /Só a diretoria/);
  await x.decide(admin, t2.id, true, 'Cliente confirmou por escrito');
  assert.equal(lead.affiliateId, bia.id);
  await assert.rejects(x.cede(ana, { lead: lead.code, toCode: bia.code }), /não encontrado/, 'quem não é mais o indicador não cede');
  await x.cede(bia, { lead: lead.code, toCode: ana.code, reason: 'combinado' });
  assert.equal(lead.affiliateId, ana.id);
});

test('grupos só com link oficial do WhatsApp; material leva o link do indicador e a imagem', () => {
  const { x, ana } = setup();
  const g = x.setGroups(admin, [{ label: 'Morar no Paraguai', url: 'https://chat.whatsapp.com/AbC123' }, { label: 'Falso', url: 'https://golpe.com/x' }]);
  assert.equal(g.length, 1); assert.equal(g[0].key, 'g1');
  assert.throws(() => x.setGroups({ role: 'seller' }, []), /Só o administrador/);
  assert.throws(() => x.saveMaterial(admin, null, { text: 'x' }), /título/);
  const m = x.saveMaterial(admin, null, { title: 'Residência', text: 'Oi! Sou {nome}. Pré-cadastro: {link}', channel: 'instagram' }, { mimetype: 'image/png', buffer: Buffer.from('png') });
  assert.ok(x.imagePath(m.image));
  assert.throws(() => x.saveMaterial(admin, null, { title: 'X' }, { mimetype: 'text/html', buffer: Buffer.from('<b>') }), /PNG, JPG ou WEBP/);
  const f = x.forAffiliate(m, { base: 'https://migra.test', code: ana.code, name: 'Ana Souza' });
  assert.equal(f.text, `Oi! Sou Ana. Pré-cadastro: https://migra.test/r/${ana.code}?m=${m.id}`);
  assert.equal(x.imagePath('../../etc/passwd'), null);
});

test('link na prática: miniatura para o WhatsApp sem contar clique de robô; grupo passa pelo pré-cadastro', async (t) => {
  const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-af-'));
  const port = 40100 + Math.floor(Math.random() * 100);
  const base = `http://127.0.0.1:${port}`;
  // Indicador, grupo e material já gravados no banco antes de ligar.
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const affiliates = new Affiliates({ store, crm: new Crm({ store, auth }), auth, secret: 'x' });
  const a = affiliates.signup({ name: 'Ana Souza', whatsapp: '11999990001', password: 'segredo123', acceptTerms: true, pixKey: 'ana@pix' });
  store.data.affiliates.materials = [{ id: 'abcdef123456', title: 'Residência <já>', text: 'Venha: {link}', channel: 'whatsapp', active: true, createdAt: '2026-11-01' }];
  store.settings.affiliates = { groups: [{ key: 'morar', label: 'Morar no PY', url: 'https://chat.whatsapp.com/AbC123' }] };
  store.flush?.(); store.save();
  fs.cpSync(store.dataDir, dir, { recursive: true });
  const proc = spawn(process.execPath, ['src/server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: String(port), TUNNEL: 'off', OPEN_BROWSER: '' }, stdio: 'ignore' });
  t.after(() => proc.kill());
  for (let i = 0; i < 60; i++) { try { await fetch(`${base}/api/auth/state`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const bot = await fetch(`${base}/r/${a.code}?m=abcdef123456`, { headers: { 'user-agent': 'WhatsApp/2.23 A' }, redirect: 'manual' });
  const html = await bot.text();
  assert.match(html, /og:title" content="Residência &lt;já&gt;"/, 'título escapado');
  assert.match(html, /og:image/);
  assert.ok(!bot.headers.get('set-cookie'), 'robô não ganha cookie nem conta clique');
  const g = await fetch(`${base}/r/${a.code}?g=morar`, { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0' } });
  assert.equal(g.status, 302);
  assert.equal(g.headers.get('location'), `/indicacao?ref=${a.code}&g=morar`);
  const pre = await (await fetch(`${base}/api/public/precadastro`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: (g.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ') }, body: JSON.stringify({ name: 'Paulo Teste', whatsapp: '11977776666', consent: true, ref: a.code, group: 'morar' }) })).json();
  assert.equal(pre.groupUrl, 'https://chat.whatsapp.com/AbC123');
  assert.equal((await fetch(`${base}/api/affiliate/extras`)).status, 401, 'escritório virtual pede login');
  assert.equal((await fetch(`${base}/api/affiliates-payouts`)).status, 401, 'administração pede login');
});
