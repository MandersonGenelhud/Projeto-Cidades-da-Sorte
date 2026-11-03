import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { totpCode } from '../src/security.js';
import { capturar, enviarParaOSistema } from '../tools/capturar-sistema/capturar.mjs';
import { buildBat } from '../src/legacy-tool.js';

let chromium = null;
try { chromium = createRequire(import.meta.url)('playwright').chromium; } catch { /* sem navegador */ }
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const J = { 'content-type': 'application/json' };
const ck = (r) => r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

/** PNG 200x200 de ruído (parece uma foto de documento: grande e pouco compressível). */
function png() {
  const w = 200; const h = 200;
  const raw = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), crypto.randomBytes(w * 3)])));
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const FOTO = png();
const CONTRATOS = [{ n: 700, nome: 'Ana Souza', cpf: '111.222.333-44', tel: '+55 11 98765-4321' }, { n: 701, nome: 'Beto Lima', cpf: '555.666.777-88', tel: '+55 21 99999-0000' }];

function sistemaAntigo() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (b, t = 'text/html; charset=utf-8') => { res.writeHead(200, { 'content-type': t }); res.end(b); };
    if (u.pathname === '/contratos') return send(`<h1>Contratos</h1><table><thead><tr><th>Nº</th><th>Cliente</th><th>Valor</th><th>Data</th></tr></thead><tbody>${CONTRATOS.map((c) => `<tr><td>${c.n}</td><td>${c.nome}</td><td>R$ 1.000,00</td><td>10/03/2025</td><td><a href="/contratos/ver/${c.n}">Ver</a></td></tr>`).join('')}</tbody></table>`);
    const m = u.pathname.match(/^\/contratos\/ver\/(\d+)$/);
    if (m) {
      const c = CONTRATOS.find((x) => x.n === Number(m[1]));
      return send(`<h2>Contrato ${c.n}</h2><table><tr><th>Número do contrato</th><td>${c.n}</td></tr><tr><th>Contratante</th><td>${c.nome}</td></tr><tr><th>CPF</th><td>${c.cpf}</td></tr><tr><th>Telefone</th><td>${c.tel}</td></tr><tr><th>Valor</th><td>R$ 1.000,00</td></tr></table>
        <table><thead><tr><th>Parcela</th><th>Vencimento</th><th>Valor</th><th>Situação</th></tr></thead><tbody><tr><td>Entrada</td><td>10/03/2025</td><td>R$ 500,00</td><td>Pago</td></tr><tr><td>Parcela 1</td><td>10/04/2025</td><td>R$ 500,00</td><td>Pendente</td></tr></tbody></table>
        <a href="/contratos/pdf/${c.n}.pdf">Baixar PDF</a>${c.n === 700 ? '<img src="/uploads/rg-ana.png" width="200" height="200" alt="RG">' : ''}`);
    }
    if (u.pathname.endsWith('.pdf')) return send('%PDF-1.4 contrato assinado de teste', 'application/pdf');
    if (u.pathname === '/uploads/rg-ana.png') return send(FOTO, 'image/png');
    res.writeHead(404); res.end('x');
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

test('envio automático: a cópia vai sozinha para o sistema, cada arquivo no contrato certo, e a chave morre no fim', { skip: !chromium }, async (t) => {
  // sistema novo
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-ing-'));
  const port = 39900 + Math.floor(Math.random() * 90);
  const base = `http://127.0.0.1:${port}`;
  const proc = spawn(process.execPath, ['src/server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: String(port), TUNNEL: 'off', OPEN_BROWSER: '' }, stdio: 'ignore' });
  t.after(() => proc.kill());
  for (let i = 0; i < 60; i++) { try { await fetch(`${base}/api/auth/state`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const s = await fetch(`${base}/api/auth/setup`, { method: 'POST', headers: J, body: JSON.stringify({ name: 'Marcos', login: 'marcos', password: 'segredo123', whatsapp: '595987101567' }) });
  let cookie = ck(s);
  const admin = (u, m = 'GET', b) => fetch(base + u, { method: m, headers: { cookie, ...J }, body: b ? JSON.stringify(b) : undefined });
  const sec = await (await admin('/api/security/2fa/setup')).json();
  cookie = ck(await admin('/api/security/2fa/enable', 'POST', { code: totpCode(sec.secret) })) || cookie;

  // o programa baixado pelo painel já leva o endereço e uma chave temporária
  const bat = await (await admin('/api/legacy/ferramenta.bat')).text();
  const url = /set "MIGRA_URL=([^"]+)"/.exec(bat)?.[1];
  const token = /set "MIGRA_TOKEN=([^"]+)"/.exec(bat)?.[1];
  assert.equal(url, base);
  assert.ok(token && token.length >= 30);
  assert.ok(bat.indexOf('MIGRA_TOKEN') < bat.indexOf('node capturar.mjs'), 'a chave é definida antes de rodar o programa');
  assert.ok(!buildBat(undefined, { url: 'javascript:x', token: 'curta' }).includes('set "MIGRA_TOKEN='), 'endereço ou chave estranhos não entram no arquivo');

  // chave errada ou usando o resto da API: recusado
  const post = (rota, tok, body, ct) => fetch(base + rota, { method: 'POST', headers: { authorization: `Bearer ${tok}`, ...(ct ? { 'content-type': ct } : {}) }, body });
  assert.equal((await post('/api/legacy/ingest/fim', 'x'.repeat(32))).status, 401);
  assert.equal((await fetch(`${base}/api/leads`, { headers: { authorization: `Bearer ${token}` } })).status, 401, 'a chave de envio não abre o resto do sistema');

  // copia o sistema antigo e envia
  const antigo = await sistemaAntigo();
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); antigo.server.close(); });
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-ing-'));
  const cap = await capturar(await browser.newContext(), { inicio: `${antigo.url}/contratos`, pasta, espera: 0, log: () => {} });
  assert.ok(cap.arquivos >= 3, 'baixou os 2 PDFs e a foto');
  const fim = await enviarParaOSistema({ url: base, token, pasta, log: () => {} });
  assert.equal(fim.summary.total, 2);
  assert.equal(fim.files.received, cap.arquivos);
  assert.deepEqual([fim.applied.sales, fim.applied.clients], [2, 2]);

  // cada coisa no lugar certo
  const list = await (await admin('/api/legacy')).json();
  const ana = list.items.find((c) => c.number === '700');
  assert.equal(ana.parcelas, 2);
  const detalhe = await (await admin(`/api/legacy/${ana.id}`)).json();
  assert.deepEqual(detalhe.files.map((f) => f.kind).sort(), ['imagem', 'pdf']);
  const img = await admin(`/api/legacy/files/${detalhe.files.find((f) => f.kind === 'imagem').id}`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal(img.headers.get('content-security-policy'), 'sandbox');
  assert.ok(Buffer.from(await img.arrayBuffer()).equals(FOTO), 'a foto chegou inteira');
  const beto = await (await admin(`/api/legacy/${list.items.find((c) => c.number === '701').id}`)).json();
  assert.deepEqual(beto.files.map((f) => f.kind), ['pdf'], 'o PDF do Beto não foi parar no contrato da Ana');
  const vendas = await (await admin('/api/sales')).json();
  assert.equal(vendas.length, 2);
  assert.equal(vendas.find((v) => v.legacyNumber === '700').overdue, 500, 'a parcela de abril de 2025 está atrasada');
  const leads = await (await admin('/api/leads')).json();
  assert.ok(['Ana Souza', 'Beto Lima'].every((n) => leads.some((l) => l.name === n && l.stage === 'ganho')));

  // a chave morreu: não dá para enviar de novo nem reaproveitar
  assert.equal((await post('/api/legacy/ingest/fim', token)).status, 401);
  // arquivo disfarçado é recusado (nem chegou a ser guardado)
  const t2 = /set "MIGRA_TOKEN=([^"]+)"/.exec(await (await admin('/api/legacy/ferramenta.bat')).text())[1];
  const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(path.join(pasta, 'captura.json'))], { type: 'application/json' }), 'captura.json');
  assert.equal((await post('/api/legacy/ingest/captura', t2, fd)).status, 200);
  const fake = new FormData(); fake.append('files', new Blob(['<script>alert(1)</script>']), '0001.pdf'); fake.append('files', new Blob([Buffer.from('MZ-executavel')]), 'x.exe');
  const out = await (await post('/api/legacy/ingest/arquivos', t2, fake)).json();
  assert.deepEqual([out.saved, out.rejected], [0, 2]);
  // sem sessão do painel não se baixa arquivo
  assert.equal((await fetch(`${base}/api/legacy/files/${detalhe.files[0].id}`)).status, 401);
});
