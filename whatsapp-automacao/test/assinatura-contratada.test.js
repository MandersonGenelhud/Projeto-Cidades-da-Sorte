import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contractPdf } from '../src/contract.js';
import { totpCode } from '../src/security.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const J = { 'content-type': 'application/json' };
const ck = (r) => r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const JPEG = fs.readFileSync(path.join(ROOT, 'public', 'img', 'grupo-migra-escuro.jpg')); // qualquer JPEG serve de imagem de teste
const quote = { number: 'ORC-2026-00001', client: 'Ana Souza', items: [{ name: 'Pacote Ouro', qty: 1, price: 12997, total: 12997 }], plan: { total: 12997, entry: 2600, people: 1, adults: 1, subtotal: 12997, parcels: [{ n: 2, date: '2026-12-01', value: 10397 }], entryParts: [] } };

test('contrato: com a assinatura da contratada cadastrada e autorizada ela aparece (imagem, nome e registro); sem ela, nada é desenhado', () => {
  const sem = contractPdf({ client: { nome: 'Ana Souza', cpf: '529.982.247-25' }, quote });
  const com = contractPdf({ client: { nome: 'Ana Souza', cpf: '529.982.247-25' }, quote, contractor: { image: JPEG, name: 'Eliezer Teste Silva', role: 'Diretor', authorizedAt: '2026-11-07T12:00:00Z' } });
  const txt = (b) => b.toString('latin1');
  assert.ok(com.length > sem.length + JPEG.length / 2, 'a imagem entrou no PDF');
  assert.match(txt(com), /Eliezer Teste Silva/);
  assert.match(txt(com), /autorizou o uso da pr/);
  assert.doesNotMatch(txt(sem), /autorizou o uso da pr/);
  assert.match(txt(sem), /Migra Assessoria/, 'sem assinatura cadastrada, continua "Responsável: Migra Assessoria"');
});

test('/api/contract-signer: só administrador; exige imagem JPEG, nome completo e a confirmação de que a pessoa autoriza; dá para desligar e remover', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-sign-'));
  const port = 39850 + Math.floor(Math.random() * 100);
  const base = `http://127.0.0.1:${port}`;
  const proc = spawn(process.execPath, ['src/server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: String(port), TUNNEL: 'off', OPEN_BROWSER: '' }, stdio: 'ignore' });
  t.after(() => proc.kill());
  for (let i = 0; i < 60; i++) { try { await fetch(`${base}/api/auth/state`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const login = async (user, first) => {
    const body = JSON.stringify({ name: user, login: user, password: 'segredo123', whatsapp: '595987101567' });
    const r = first ? await fetch(`${base}/api/auth/setup`, { method: 'POST', headers: J, body }) : await fetch(`${base}/api/auth/login`, { method: 'POST', headers: J, body });
    let cookie = ck(r);
    const call = (u, m = 'GET', b) => fetch(base + u, { method: m, headers: { cookie, ...J }, body: b ? JSON.stringify(b) : undefined });
    const sec = await (await call('/api/security/2fa/setup')).json();
    cookie = ck(await call('/api/security/2fa/enable', 'POST', { code: totpCode(sec.secret) })) || cookie;
    return call;
  };
  const marcos = await login('marcos', true);
  await marcos('/api/users', 'POST', { name: 'Ana', login: 'ana', password: 'segredo123', role: 'seller' });
  const ana = await login('ana');
  const image = `data:image/jpeg;base64,${JPEG.toString('base64')}`;
  assert.equal((await ana('/api/contract-signer')).status, 403);
  assert.equal((await ana('/api/contract-signer', 'PUT', { name: 'Eliezer Teste Silva', image, authorize: true })).status, 403);
  assert.equal((await ana('/api/contract-signer/image')).status, 403);
  assert.equal((await (await marcos('/api/contract-signer')).json()).active, false);
  assert.equal((await marcos('/api/contract-signer', 'PUT', { name: 'Eliezer', image, authorize: true })).status, 400, 'nome completo');
  assert.equal((await marcos('/api/contract-signer', 'PUT', { name: 'Eliezer Teste Silva', image: 'data:image/png;base64,AAAA', authorize: true })).status, 400, 'só JPEG');
  assert.equal((await marcos('/api/contract-signer', 'PUT', { name: 'Eliezer Teste Silva', authorize: true })).status, 400, 'sem imagem ainda');
  assert.equal((await marcos('/api/contract-signer', 'PUT', { name: 'Eliezer Teste Silva', image })).status, 400, 'sem a confirmação de autorização');
  assert.equal((await marcos('/api/contract-signer', 'PUT', { name: 'Eliezer Teste Silva', role: 'Diretor', image, authorize: true })).status, 200);
  const meta = await (await marcos('/api/contract-signer')).json();
  assert.equal(meta.active, true); assert.equal(meta.authorizedBy, 'marcos'); assert.equal(meta.hasImage, true);
  assert.equal((await marcos('/api/contract-signer/image')).headers.get('content-type'), 'image/jpeg');
  assert.equal((await marcos('/api/contract-signer', 'PUT', { name: 'Eliezer Teste Silva', enabled: false })).status, 200);
  assert.equal((await (await marcos('/api/contract-signer')).json()).active, false, 'desligada: não vai nos contratos');
  assert.equal((await marcos('/api/contract-signer', 'DELETE')).status, 200);
  const gone = await (await marcos('/api/contract-signer')).json();
  assert.equal(gone.hasImage, false); assert.equal(gone.active, false);
  assert.equal(fs.existsSync(path.join(dir, 'contract-signer.jpg')), false);
});

import { quickIntent } from '../src/maria.js';
test('Maria: "link de preenchimento do contrato" ou "para ele assinar online" envia o fluxo do contrato; só "ficha" envia a ficha', () => {
  assert.deepEqual([quickIntent('Maria, envie o link de preenchimento do contrato para o cliente 45 98888-7777').acao, quickIntent('Maria, envie o link de preenchimento do contrato para o cliente 45 98888-7777').o_que], ['enviar_cliente', 'contrato']);
  assert.equal(quickIntent('Maria, mande o link para o cliente 45 98888-7777 preencher e assinar online').o_que, 'contrato');
  assert.equal(quickIntent('Maria, envie a ficha para o cliente 45 98888-7777').o_que, 'ficha');
});

test('contrato: cláusula DOS DEPENDENTES lista quem são (ou diz que não há) e a numeração das cláusulas segue certa', () => {
  const txt = (b) => b.toString('latin1');
  const base = { nome: 'Ana Souza', cpf: '529.982.247-25' };
  const com = contractPdf({ client: { ...base, acompanhantes: 'Pedro Souza (filho, 8 anos); Lia Souza (sobrinha, pessoa com deficiência)' }, quote });
  assert.match(txt(com), /DOS DEPENDENTES/);
  assert.match(txt(com), /Pedro Souza/);
  assert.match(txt(com), /Lia Souza/);
  assert.match(txt(com), /CL.USULA SEGUNDA . DOS DEPENDENTES/);
  assert.match(txt(com), /CL.USULA TERCEIRA . DAS OBRIGA/);
  assert.match(txt(com), /CL.USULA D.CIMA PRIMEIRA . DO FORO/);
  const nenhum = contractPdf({ client: { ...base, acompanhantes: 'nenhum' }, quote });
  assert.match(txt(nenhum), /n.o h. dependentes inclu.dos/);
  assert.doesNotMatch(txt(nenhum), /integram o processo/);
  const vazio = contractPdf({ client: base, quote });
  assert.match(txt(vazio), /n.o h. dependentes inclu.dos/);
});

test('contrato com dois responsáveis: as duas assinaturas, nomes e registros aparecem; com um só, só ele', () => {
  const c1 = { image: JPEG, name: 'Eliezer Teste Silva', role: 'Responsável do escritório Migra', authorizedAt: '2026-11-07T12:00:00Z' };
  const c2 = { image: JPEG, name: 'Marcos Teste Souza', role: 'Diretor', authorizedAt: '2026-11-08T12:00:00Z' };
  const txt = (b) => b.toString('latin1');
  const um = contractPdf({ client: { nome: 'Ana Souza', cpf: '529.982.247-25' }, quote, contractors: [c1] });
  const dois = contractPdf({ client: { nome: 'Ana Souza', cpf: '529.982.247-25' }, quote, contractors: [c1, c2] });
  assert.match(txt(um), /Eliezer Teste Silva/);
  assert.doesNotMatch(txt(um), /Marcos Teste Souza/);
  assert.match(txt(dois), /Eliezer Teste Silva/);
  assert.match(txt(dois), /Marcos Teste Souza/);
  assert.ok(dois.length > um.length + JPEG.length / 2, 'a 2ª imagem entrou no PDF');
  const velho = contractPdf({ client: { nome: 'Ana Souza', cpf: '529.982.247-25' }, quote, contractor: c1 });
  assert.match(txt(velho), /Eliezer Teste Silva/, 'o parâmetro antigo (um só) continua valendo');
});

test('dois responsáveis pelo painel: só administrador; cada um tem a sua imagem, autorização e liga/desliga; ao cadastrar, os contratos não assinados são refeitos e os assinados não mudam', async (t) => {
  const { Store } = await import('../src/store.js');
  const { Quotes } = await import('../src/quotes.js');
  const { presetSettings } = await import('../src/agent/presets.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-sign2-'));
  const store = new Store(dir);
  store.updateSettings(presetSettings('migra-paraguai'));
  const quotes = new Quotes({ store, dataDir: dir, secret: 's', matchPackage: () => ({ name: 'Pacote Ouro', price: 12997 }) });
  const mk = (n) => quotes.create({ items: [{ pacote: 'Ouro', quantidade: 1 }], adults: 1, client: n, start: '2026-10-29' });
  const aberto = mk('Aberto'); const assinado = mk('Assinado');
  fs.mkdirSync(path.join(dir, 'contratos'), { recursive: true });
  const cf = (q) => path.join(dir, 'contratos', `CT-${q.number.replace(/^ORC-/, '')}.pdf`);
  const cl = (nome) => ({ nome, nacionalidade: 'Brasileira', estadoCivil: 'Solteiro(a)', cpf: '529.982.247-25', rg: '1', rua: 'A', numero: '1', cidade: 'C', uf: 'PR' });
  for (const [q, nome, st] of [[aberto, 'Aberto', 'enviado'], [assinado, 'Assinado', 'assinado']]) { fs.writeFileSync(cf(q), Buffer.from(`%PDF-VELHO-${st}`)); q.contract = { client: cl(nome), at: '2026-10-30T10:00:00Z', status: st }; }
  store.data.termsPdf2026 = true; // só interessa a atualização feita pela assinatura
  store.flush();

  const port = 39950 + Math.floor(Math.random() * 40);
  const base = `http://127.0.0.1:${port}`;
  const proc = spawn(process.execPath, ['src/server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: String(port), TUNNEL: 'off', OPEN_BROWSER: '' }, stdio: 'ignore' });
  t.after(() => proc.kill());
  for (let i = 0; i < 60; i++) { try { await fetch(`${base}/api/auth/state`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const login = async (user, first) => {
    const body = JSON.stringify({ name: user, login: user, password: 'segredo123', whatsapp: '595987101567' });
    const r = first ? await fetch(`${base}/api/auth/setup`, { method: 'POST', headers: J, body }) : await fetch(`${base}/api/auth/login`, { method: 'POST', headers: J, body });
    let cookie = ck(r);
    const call = (u, m = 'GET', b) => fetch(base + u, { method: m, headers: { cookie, ...J }, body: b ? JSON.stringify(b) : undefined });
    const sec = await (await call('/api/security/2fa/setup')).json();
    cookie = ck(await call('/api/security/2fa/enable', 'POST', { code: totpCode(sec.secret) })) || cookie;
    return call;
  };
  const marcos = await login('marcos', true);
  await marcos('/api/users', 'POST', { name: 'Ana', login: 'ana', password: 'segredo123', role: 'seller' });
  const ana = await login('ana');
  const image = `data:image/jpeg;base64,${JPEG.toString('base64')}`;
  for (const [m, u, b] of [['GET', '/api/contract-signers'], ['GET', '/api/contract-signer/2'], ['PUT', '/api/contract-signer/2', { name: 'Marcos Teste Souza', image, authorize: true }], ['DELETE', '/api/contract-signer/2'], ['GET', '/api/contract-signer/2/image']]) assert.equal((await ana(u, m, b)).status, 403, `${m} ${u}`);
  const todos = await (await marcos('/api/contract-signers')).json();
  assert.deepEqual(todos.map((x) => [x.slot, x.active]), [[1, false], [2, false]]);
  assert.equal((await marcos('/api/contract-signer', 'PUT', { name: 'Eliezer Teste Silva', role: 'Responsável do escritório Migra', image })).status, 400, 'sem a autorização da pessoa');
  assert.equal((await marcos('/api/contract-signer', 'PUT', { name: 'Eliezer Teste Silva', role: 'Responsável do escritório Migra', image, authorize: true })).status, 200);
  const novo = fs.readFileSync(cf(aberto));
  assert.equal(novo.subarray(0, 8).toString(), '%PDF-1.4', 'o contrato não assinado foi refeito');
  assert.match(novo.toString('latin1'), /Eliezer Teste Silva/);
  assert.equal(fs.readFileSync(cf(assinado)).toString(), '%PDF-VELHO-assinado', 'o contrato já assinado pelo cliente não muda');
  const depois = await (await marcos('/api/contract-signers')).json();
  assert.deepEqual(depois.map((x) => x.active), [true, false], 'o 2º ainda não foi cadastrado');
  assert.equal(fs.existsSync(path.join(dir, 'contract-signer-2.jpg')), false);
  // O 2º (Marcos) entra depois, sem mexer no 1º.
  assert.equal((await marcos('/api/contract-signer/2', 'PUT', { name: 'Marcos Teste Souza', role: 'Diretor', image, authorize: true })).status, 200);
  assert.match(fs.readFileSync(cf(aberto)).toString('latin1'), /Marcos Teste Souza/);
  assert.equal((await (await marcos('/api/contract-signers')).json()).every((x) => x.active), true);
  assert.equal((await marcos('/api/contract-signer/2', 'DELETE')).status, 200);
  assert.doesNotMatch(fs.readFileSync(cf(aberto)).toString('latin1'), /Marcos Teste Souza/, 'removido: sai do contrato');
  assert.match(fs.readFileSync(cf(aberto)).toString('latin1'), /Eliezer Teste Silva/);
  assert.equal((await (await marcos('/api/contract-signer')).json()).active, true, 'o 1º continua');
});
