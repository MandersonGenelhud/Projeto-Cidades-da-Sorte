import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { capturar } from '../tools/capturar-sistema/capturar.mjs';
import { extractRecords, LegacyContracts, parseMoney, parseDate, lastNumber } from '../src/legacy-import.js';
import { tempStore } from './helpers.js';

let chromium = null;
try { chromium = createRequire(import.meta.url)('playwright').chromium; } catch { /* sem navegador: o teste do navegador é pulado */ }

const CONTRATOS = Array.from({ length: 7 }, (_, i) => ({ n: 500 + i, nome: `Cliente ${i + 1}`, valor: 1000 * (i + 1) + 0.5, data: `0${(i % 9) + 1}/03/2025` }));

function sistemaFalso() {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    const send = (body, type = 'text/html; charset=utf-8') => { res.writeHead(200, { 'content-type': type }); res.end(body); };
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/contratos') {
      const pg = Number(u.searchParams.get('pagina') || 1);
      const part = CONTRATOS.slice((pg - 1) * 4, pg * 4);
      return send(`<h1>Contratos</h1><a href="/sair">Sair</a><table><thead><tr><th>Nº</th><th>Cliente</th><th>Valor</th><th>Data</th><th></th></tr></thead><tbody>${part.map((c) => `<tr><td>${c.n}</td><td>${c.nome}</td><td>R$ ${c.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td><td>${c.data}</td><td><a href="/contratos/ver/${c.n}">Ver</a> <a href="/contratos/excluir/${c.n}">Excluir</a></td></tr>`).join('')}</tbody></table>${pg === 1 ? '<a href="/contratos?pagina=2">Próxima</a>' : ''}<a href="/contratos/dinamico">Clientes</a>`);
    }
    const m = u.pathname.match(/^\/contratos\/ver\/(\d+)$/);
    if (m) {
      const c = CONTRATOS.find((x) => x.n === Number(m[1]));
      return send(`<h2>Contrato ${c.n}</h2><table><tr><th>Número do contrato</th><td>${c.n}</td></tr><tr><th>Contratante</th><td>${c.nome}</td></tr><tr><th>CPF</th><td>123.456.789-0${c.n % 10}</td></tr></table><label for="s">Serviço</label><input id="s" value="Residência"><input type="password" name="senha" value="SEGREDO-NAO-LER"><a href="/contratos/pdf/${c.n}.pdf">Baixar PDF</a><a href="/contratos/excluir/${c.n}">Excluir</a>`);
    }
    if (u.pathname === '/contratos/dinamico') {
      return send(`<table><thead><tr><th>Nome</th><th>Telefone</th></tr></thead><tbody id="b"></tbody></table><button id="nx" onclick="go()">Próxima</button><button onclick="fetch('/contratos/excluir/tudo')">Excluir tudo</button>
        <script>const todos = Array.from({length: 12}, (_, i) => ['Pessoa ' + (i + 1), '+5959810000' + String(i).padStart(2, '0')]); let p = 0;
        function show() { document.getElementById('b').innerHTML = todos.slice(p * 5, p * 5 + 5).map((r) => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>').join(''); document.getElementById('nx').disabled = (p + 1) * 5 >= todos.length; }
        function go() { p++; show(); } show();</script>`);
    }
    if (u.pathname.endsWith('.pdf')) return send('%PDF-1.4 fake', 'application/pdf');
    res.writeHead(404); res.end('x');
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, hits, url: `http://127.0.0.1:${server.address().port}` })));
}

test('leitor: valores, datas e junção de duplicados', () => {
  assert.equal(parseMoney('R$ 1.234,56'), 1234.56);
  assert.equal(parseMoney('1,234.56'), 1234.56);
  assert.equal(parseMoney('US$ 250'), 250);
  assert.equal(parseDate('05/03/2025'), '2025-03-05');
  assert.equal(parseDate('2025-03-05T10:00:00Z'), '2025-03-05');
  const recs = extractRecords({
    pages: [
      { url: 'a', tables: [{ headers: ['Nº', 'Cliente', 'Valor', 'Data'], rows: [['501', 'Ana', 'R$ 2.000,00', '01/02/2025']] }], fields: [] },
      { url: 'b', tables: [], fields: [{ label: 'Número do contrato', value: '501' }, { label: 'Contratante', value: 'Ana' }, { label: 'CPF', value: '111' }, { label: 'Serviço', value: 'Residência' }] },
    ],
    api: [{ url: 'x', json: { data: [{ id: 502, cliente: { nome: 'Beto' }, valor_total: 3500, status: 'ativo', criado_em: '2025-02-02' }] } }],
  });
  assert.equal(recs.length, 2);
  const a = recs.find((r) => r.number === '501');
  assert.deepEqual([a.client, a.value, a.date, a.doc, a.service], ['Ana', 2000, '2025-02-01', '111', 'Residência']);
  assert.equal(recs.find((r) => r.number === '502').value, 3500);
  assert.equal(lastNumber(recs), 502);
});

test('importação: não duplica, completa o que falta e mostra o último número', () => {
  const lc = new LegacyContracts({ store: tempStore() });
  const cap = { pages: [{ url: 'a', tables: [{ headers: ['Número', 'Cliente', 'Valor'], rows: [['500', 'Ana', '1000'], ['501', 'Beto', '2000']] }], fields: [] }], api: [] };
  assert.equal(lc.preview(cap).total, 2);
  assert.deepEqual(lc.import(cap, { name: 'Marcos' }), { added: 2, updated: 0, total: 2, ultimoNumero: 501 });
  assert.deepEqual(lc.import(cap, { name: 'Marcos' }), { added: 0, updated: 2, total: 2, ultimoNumero: 501 });
  assert.throws(() => lc.import({ pages: [], api: [] }), /Não encontrei/);
  assert.equal(lc.search({ q: 'beto' }).length, 1);
  assert.match(lc.csv(), /"500";"Ana"/);
});

test('ferramenta de captura: percorre a lista e as páginas, lê fichas e PDFs, nunca sai, exclui nem lê senha', { skip: !chromium }, async (t) => {
  const { server, hits, url } = await sistemaFalso();
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); server.close(); });
  const context = await browser.newContext();
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-'));
  const r = await capturar(context, { inicio: `${url}/contratos`, pasta, espera: 0, log: () => {} });
  assert.equal(r.paginas, 3 + CONTRATOS.length, 'lista (2 páginas) + clientes + uma ficha por contrato');
  assert.equal(r.pdfs, CONTRATOS.length);
  assert.ok(!hits.some((h) => /sair|excluir/.test(h)), 'nunca visitou sair nem excluir');
  const bruto = fs.readFileSync(path.join(pasta, 'captura.json'), 'utf8');
  assert.ok(!bruto.includes('SEGREDO-NAO-LER'), 'campo de senha não é lido');
  const mapa = fs.readFileSync(path.join(pasta, 'mapa.txt'), 'utf8');
  assert.match(mapa, /\/contratos\/ver\/\{n\}/);
  assert.ok(!mapa.includes('Cliente 1') && !mapa.includes('123.456'), 'o mapa não tem dados de clientes');
  const recs = extractRecords(JSON.parse(bruto));
  assert.equal(recs.length, CONTRATOS.length);
  const c = recs.find((x) => x.number === '503');
  assert.deepEqual([c.client, c.value, c.service], ['Cliente 4', 4000.5, 'Residência']);
  assert.match(c.doc, /^123\.456\.789/);
  assert.equal(lastNumber(recs), 506);
  const dinamica = JSON.parse(bruto).pages.find((p) => p.url.endsWith('/dinamico'));
  assert.equal(dinamica.tables[0].rows.length, 12, 'clicou em Próxima até acabar e juntou as 3 páginas da lista');
  assert.ok(!hits.some((h) => /excluir/.test(h)), 'nunca clicou em Excluir');
});

test('o programa de cópia realmente inicia quando chamado pela linha de comando (no Windows o caminho do arquivo é diferente)', async () => {
  const { spawn } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const src = fs.readFileSync(fileURLToPath(new URL('../tools/capturar-sistema/capturar.mjs', import.meta.url)), 'utf8');
  assert.ok(src.includes('fileURLToPath(import.meta.url)'), 'compara o caminho com fileURLToPath, não com URL.pathname (quebra no Windows)');
  const out = await new Promise((resolve) => {
    const p = spawn(process.execPath, [fileURLToPath(new URL('../tools/capturar-sistema/capturar.mjs', import.meta.url)), 'http://127.0.0.1:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    p.stdout.on('data', (d) => (buf += d));
    p.stderr.on('data', (d) => (buf += d));
    const t = setTimeout(() => p.kill(), 5000);
    p.on('close', () => { clearTimeout(t); resolve(buf); });
  });
  assert.match(out, /Programa de cópia de contratos iniciado/);
});
