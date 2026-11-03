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
      return send(`<h1>Contratos</h1><a href="/sair">Sair</a><table><thead><tr><th>Nº</th><th>Cliente</th><th>Valor</th><th>Data</th><th></th></tr></thead><tbody>${part.map((c) => `<tr><td>${c.n}</td><td>${c.nome}</td><td>R$ ${c.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td><td>${c.data}</td><td><a href="/contratos/ver/${c.n}">Ver</a> <a href="/contratos/excluir/${c.n}">Excluir</a></td></tr>`).join('')}</tbody></table>${pg === 1 ? '<a href="/contratos?pagina=2">Próxima</a>' : ''}<a href="/contratos/dinamico">Clientes</a><a href="https://www.youtube.com/watch?v=abcDEF12345" title="Depoimento da Maria">vídeo</a><video src="/contratos/v.mp4"></video><button aria-label="Notificações" onclick="document.getElementById('nt').textContent='Aviso: contrato 503 vencido há 5 dias'">sino</button><div id="nt"></div><button role="tab" aria-selected="false" onclick="document.getElementById('ab').textContent='Aba Vencidos: 2 contratos'">Vencidos</button><div id="ab"></div><a href="/contratos/gerador">Gerador de contratos</a><button role="tab" onclick="fetch('/contratos/excluir/aba')">Excluir aba</button>`);
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
    if (u.pathname === '/contratos/gerador') return send('<h1>Gerador de contratos</h1><p>CLÁUSULA PRIMEIRA – DO OBJETO: o presente contrato tem por objeto a assessoria migratória.</p><textarea>CLÁUSULA SEGUNDA – DAS OBRIGAÇÕES</textarea>');
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
  const first = lc.import(cap, { name: 'Marcos' });
  assert.deepEqual([first.added, first.updated, first.total, first.ultimoNumero, first.newClients], [2, 0, 2, 501, 2]);
  const second = lc.import(cap, { name: 'Marcos' });
  assert.deepEqual([second.added, second.updated, second.total, second.newClients], [0, 2, 2, 0]);
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
  assert.equal(r.paginas, 4 + CONTRATOS.length, 'lista (2 páginas) + clientes + gerador + uma ficha por contrato');
  assert.equal(r.pdfs, CONTRATOS.length);
  assert.ok(!hits.some((h) => /sair|excluir/.test(h)), 'nunca visitou sair nem excluir');
  const bruto = fs.readFileSync(path.join(pasta, 'captura.json'), 'utf8');
  assert.ok(!bruto.includes('SEGREDO-NAO-LER'), 'campo de senha não é lido');
  const mapa = fs.readFileSync(path.join(pasta, 'mapa.txt'), 'utf8');
  assert.match(mapa, /\/contratos\/ver\/\{n\}/);
  assert.match(mapa, /Vídeos encontrados[\s\S]*youtube\.com\/watch\?v=abcDEF12345/, 'lista os endereços dos vídeos da página');
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
  const modeloHtml = fs.readdirSync(path.join(pasta, 'modelos')).filter((f) => f.endsWith('.html')).map((f) => fs.readFileSync(path.join(pasta, 'modelos', f), 'utf8'));
  assert.ok(modeloHtml.some((h) => h.includes('CLÁUSULA PRIMEIRA – DO OBJETO')), 'guardou o modelo de contrato do gerador');
  assert.ok(fs.readdirSync(path.join(pasta, 'modelos')).some((f) => f.endsWith('.png')), 'e a foto da tela dele');
  assert.match(mapa, /Modelos e amostras de contrato/);
  const lista = JSON.parse(bruto).pages.find((p) => /\/contratos(\?|$)/.test(p.url));
  assert.match(lista.texto, /Aviso: contrato 503 vencido há 5 dias/, 'abriu o sino de notificações e leu o aviso');
  assert.match(lista.texto, /Aba Vencidos: 2 contratos/, 'abriu a aba de vencidos');
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

test('o programa lê o endereço certo mesmo quando o .bat manda --saida primeiro (erro "invalid URL --saida")', async () => {
  const { spawn } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const file = fileURLToPath(new URL('../tools/capturar-sistema/capturar.mjs', import.meta.url));
  const src = fs.readFileSync(file, 'utf8');
  assert.match(src, /startsWith\('--'\)/, 'ignora as opções ao procurar o endereço');
  // Sem endereço e com --saida primeiro, ele precisa PERGUNTAR o endereço (e não tentar abrir "--saida").
  const out = await new Promise((resolve) => {
    const p = spawn(process.execPath, [file, '--saida', os.tmpdir()], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    p.stdout.on('data', (d) => { buf += d; if (/ndereço do sistema/.test(buf)) p.kill(); });
    p.stderr.on('data', (d) => (buf += d));
    const t = setTimeout(() => p.kill(), 6000);
    p.on('close', () => { clearTimeout(t); resolve(buf); });
  });
  assert.match(out, /ndereço do sistema/);
  assert.doesNotMatch(out, /invalid URL|--saida"/);
});

test('endereço: Enter aceita o padrão que vem no programa, domínio sem https é completado e vazio não derruba (erro "navigating to https://")', async () => {
  const { spawn } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const file = fileURLToPath(new URL('../tools/capturar-sistema/capturar.mjs', import.meta.url));
  const rodar = (env, resposta) => new Promise((resolve) => {
    const p = spawn(process.execPath, [file, '--saida', os.tmpdir()], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = ''; let enviou = false;
    p.stdout.on('data', (d) => { buf += d; if (!enviou && /Endereço|endereço/.test(buf)) { enviou = true; p.stdin.write(`${resposta}\n`); } if (/Sistema antigo:/.test(buf)) setTimeout(() => p.kill(), 300); });
    p.stderr.on('data', (d) => (buf += d));
    const t = setTimeout(() => p.kill(), 8000);
    p.on('close', () => { clearTimeout(t); resolve(buf); });
  });
  const a = await rodar({ MIGRA_SITE: 'https://migrapyassessoria.com' }, '');
  assert.match(a, /Sistema antigo: https:\/\/migrapyassessoria\.com/, 'Enter sem digitar usa o padrão do programa');
  const b = await rodar({ MIGRA_SITE: '' }, 'meusite.com');
  assert.match(b, /Sistema antigo: https:\/\/meusite\.com/, 'domínio sem https é completado');
  assert.doesNotMatch(a + b, /invalid URL|navigating to "https:\/\/"/);
  assert.equal((a.match(/Programa de cópia de contratos iniciado/g) || []).length, 1, 'a mensagem de início aparece uma vez');
  assert.match(buildBatSample(), /set "MIGRA_SITE=https:\/\/migrapyassessoria\.com"/);
});
import { buildBat as buildBatSample0 } from '../src/legacy-tool.js';
const buildBatSample = () => buildBatSample0();
