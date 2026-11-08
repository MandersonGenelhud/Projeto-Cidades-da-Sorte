import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { Auth } from '../src/auth.js';
import { Crm } from '../src/crm.js';
import { Quotes } from '../src/quotes.js';
import { PdfCanvas } from '../src/pdfdoc.js';
import { presetSettings } from '../src/agent/presets.js';
import { makeContractPix } from '../src/contract-pix.js';
import { tempStore } from './helpers.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('PDF: área clicável (link) é gravada como anotação de URI na página certa', () => {
  const c = new PdfCanvas();
  c.rect(10, 10, 100, 30, { fill: '#D4AF37' });
  c.link(10, 10, 100, 30, 'https://app.exemplo.com/reservar/abc?t=xyz');
  c.addPage();
  c.link(5, 5, 50, 20, 'https://segunda.pagina/x(1)');
  const raw = c.toBuffer().toString('latin1');
  assert.match(raw, /\/Subtype \/Link/);
  assert.match(raw, /\/URI \(https:\/\/app\.exemplo\.com\/reservar\/abc\?t=xyz\)/);
  assert.ok(raw.includes('/URI (https://segunda.pagina/x1)'), 'parênteses perigosos são retirados do endereço');
  assert.equal((raw.match(/\/Annots \[/g) || []).length, 2, 'uma lista de links por página');
});

test('orçamento: o botão "Tudo certo? Clique aqui..." vai dentro do PDF (link clicável) e na frase que acompanha o arquivo', () => {
  const store = tempStore();
  store.updateSettings(presetSettings('migra-paraguai'));
  const quotes = new Quotes({ store, dataDir: store.dataDir, secret: 's', matchPackage: () => ({ name: 'Pacote Ouro', price: 12997 }) });
  quotes.reserveLink = (rec) => `https://app.migra.com/reservar/${rec.id}?t=${quotes.token(rec.id)}`;
  const q = quotes.create({ items: [{ pacote: 'Ouro', quantidade: 1 }], adults: 1, client: 'Ana Souza', start: '2026-10-29' });
  const raw = fs.readFileSync(quotes.file(q)).toString('latin1');
  assert.ok(raw.includes(`/URI (https://app.migra.com/reservar/${q.id}?t=`), 'o link está no PDF');
  assert.match(raw, /TUDO CERTO\? CLIQUE AQUI E D/);
  const cap = quotes.caption(q, { name: 'Ana', reserveLink: quotes.reserveLink(q) });
  assert.match(cap, /\nSe estiver tudo certo, clique aqui para dar início à sua reserva: https:\/\/app\.migra\.com\/reservar\//);
  assert.doesNotMatch(cap, /contrato/i, 'não fala em contrato neste momento');
  // Sem endereço público ainda, o PDF sai igual, sem o botão.
  const q2 = new Quotes({ store, dataDir: store.dataDir, secret: 's', matchPackage: () => ({ name: 'Pacote Ouro', price: 12997 }) });
  const r2 = q2.create({ items: [{ pacote: 'Ouro', quantidade: 1 }], adults: 1, client: 'Bia', start: '2026-10-29' });
  assert.ok(!fs.readFileSync(q2.file(r2)).toString('latin1').includes('/Subtype /Link'));
});

test('ordem: ficha, assinatura e só depois o Pix; o Pix já enviado pela ficha não se repete; "junto com o contrato" continua possível por ajuste', async () => {
  const store = tempStore();
  store.updateSettings({ payments: { pixKey: 'chave@pix', enabled: true } });
  const sent = []; const list = [];
  const payments = { list, create: async (a) => { const p = { id: `p${list.length + 1}`, status: 'pending', amount: a.amount, convKey: a.convKey, description: a.description, createdAt: new Date().toISOString() }; list.push(p); return p; }, sendCharge: async (p) => sent.push(p.id) };
  const conv = { key: '5545999990000@s.whatsapp.net', phone: '5545999990000', messages: [] };
  const api = makeContractPix({ store, payments, wa: { isConnected: () => true }, agent: { conversation: () => conv, remember: () => {} }, crm: { findForConversation: () => null } });
  const q = { number: 'ORC-2026-00001', convKey: conv.key, phone: conv.phone, plan: { total: 12997, entry: 1800 }, contract: { client: { nome: 'Ana', cpf: '1' } } };
  const noEnvio = await api.sendContractPix(q, { phase: 'envio' });
  assert.equal(noEnvio.sent, false);
  assert.match(noEnvio.why, /depois que o cliente assinar/);
  assert.equal(list.length, 0, 'ao enviar o contrato NÃO sai Pix');
  const depois = await api.sendContractPix(q, { phase: 'assinatura' });
  assert.equal(depois.sent, true);
  assert.equal(list[0].amount, 1800);
  // Pix de reserva que já saiu pela ficha: não duplica.
  const q2 = { ...q, number: 'ORC-2026-00002' };
  list.push({ id: 'pf', status: 'pending', amount: 1800, convKey: conv.key, description: 'reserva - 1 adulto(s)', createdAt: new Date().toISOString() });
  list.splice(0, 1);
  assert.match((await api.sendContractPix(q2, { phase: 'assinatura' })).why, /já há um Pix de reserva em aberto/);
  // Ajuste para o modelo antigo (Pix junto com o contrato).
  store.updateSettings({ payments: { contractPixWhen: 'envio' } });
  const q3 = { ...q, number: 'ORC-2026-00003' }; list.length = 0;
  assert.equal((await api.sendContractPix(q3, { phase: 'envio' })).sent, true);
  assert.match((await api.sendContractPix({ ...q3, number: 'ORC-2026-00004' }, { phase: 'assinatura' })).why, /já saiu junto com o contrato/);
});

test('botão do orçamento pelo painel: link inválido não abre; válido abre a ficha já preenchida e marca o interesse; assinado e vencido avisam', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-reserva-'));
  const store = new Store(dir);
  store.updateSettings(presetSettings('migra-paraguai'));
  const auth = new Auth({ store, dataDir: dir });
  const crm = new Crm({ store, auth });
  const quotes = new Quotes({ store, dataDir: dir, secret: auth.secret, matchPackage: () => ({ name: 'Pacote Ouro', price: 12997 }) });
  const lead = crm.ensureFromConversation({ key: '5545999990000@s.whatsapp.net', phone: '5545999990000', name: 'Ana Souza', channel: 'whatsapp' });
  const mk = (start) => quotes.create({ items: [{ pacote: 'Ouro', quantidade: 2 }], adults: 2, client: 'Ana Souza', phone: '5545999990000', start, leadId: lead.id, convKey: lead.conversationKey });
  const hoje = new Date().toISOString().slice(0, 10);
  const ok = mk(hoje); const velho = mk('2026-01-01'); const assinado = mk(hoje);
  assinado.contract = { status: 'assinado', client: { nome: 'Ana' } };
  store.flush();
  const port = 40150 + Math.floor(Math.random() * 40);
  const base = `http://127.0.0.1:${port}`;
  const proc = spawn(process.execPath, ['src/server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: String(port), TUNNEL: 'off', OPEN_BROWSER: '', PUBLIC_URL: base }, stdio: 'ignore' });
  t.after(() => proc.kill());
  for (let i = 0; i < 60; i++) { try { await fetch(`${base}/api/auth/state`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const go = (q, token) => fetch(`${base}/reservar/${q.id}?t=${token ?? quotes.token(q.id)}`, { redirect: 'manual' });
  assert.equal((await go(ok, 'errado')).status, 404);
  assert.equal((await fetch(`${base}/reservar/naoexiste?t=x`, { redirect: 'manual' })).status, 404);
  assert.equal((await go(velho)).status, 410);
  const asn = await go(assinado);
  assert.equal(asn.status, 200);
  assert.match(await asn.text(), /já foi assinado/);
  const r = await go(ok);
  assert.equal(r.status, 302);
  const loc = r.headers.get('location');
  assert.match(loc, /\/ficha\/[0-9a-f]+\?t=/);
  const id = /\/ficha\/([0-9a-f]+)\?t=([^&]+)/.exec(loc);
  const f = await (await fetch(`${base}/api/public/ficha/${id[1]}?t=${id[2]}`)).json();
  assert.equal(f.data.nome, 'Ana Souza', 'a ficha já vem com o nome do orçamento');
  assert.match(f.data.whatsapp, /5545999990000/, 'e o telefone');
  assert.equal(String(f.data.adultos), '2');
  await new Promise((r) => setTimeout(r, 600)); // o servidor grava no disco logo depois
  const dbAfter = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
  const form = dbAfter.closing.find((x) => x.id === id[1]);
  assert.equal(form.quoteId, ok.id);
  assert.equal(form.contractRequested, true);
  assert.ok(dbAfter.leads.find((l) => l.id === lead.id).timeline.some((x) => /clicou em "dar início à reserva"/.test(x.text)));
});
