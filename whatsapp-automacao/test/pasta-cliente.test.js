import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerPastaClienteRoutes, sniffType, sameClientSales } from '../src/routes/pasta-cliente.js';

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(50, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
const HTML = Buffer.from('<html><script>alert(1)</script></html>');

function setup() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pasta-'));
  const list = [
    { id: 's1', number: 'VND-1', sellerId: 'gio', client: { nome: 'Ana Souza', phone: '5545988887777' }, createdAt: '2025-01-10' },
    { id: 's2', number: 'VND-2', sellerId: 'gio', client: { nome: 'Ana Souza', phone: '+55 45 98888-7777' }, createdAt: '2026-11-10' },
    { id: 's3', number: 'VND-3', sellerId: 'eli', client: { nome: 'Bruno', phone: '5545911112222' }, createdAt: '2026-11-11' },
  ];
  const sales = { list, get: (id) => list.find((s) => s.id === id), canSee: (u, s) => u.role === 'admin' || s.sellerId === u.id };
  const store = { data: {}, save() {} };
  const events = [];
  const routes = {};
  const app = new Proxy({}, { get: (_, m) => (p, ...h) => { routes[`${String(m).toUpperCase()} ${p}`] = h.at(-1); } });
  registerPastaClienteRoutes(app, { store, sales, dataDir, httpError: (st, m) => Object.assign(new Error(m), { status: st }), securityEvent: (t, u, r, x) => events.push([t, x]), upload: null });
  const call = async (key, req) => {
    let out = null; let status = 200; const headers = {};
    const res = { json: (x) => { out = x; }, set: (h) => Object.assign(headers, h), send: (b) => { out = b; } };
    try { await routes[key](req, res); } catch (e) { status = e.status; out = e.message; }
    return { status, out, headers };
  };
  return { call, dataDir, store, events };
}
const admin = { id: 'adm', role: 'admin', name: 'Marcos' };
const gio = { id: 'gio', role: 'seller', name: 'Giovana' };

test('tipo do arquivo pelo conteúdo: PDF e imagem passam; HTML disfarçado não', () => {
  assert.equal(sniffType(PDF), 'application/pdf');
  assert.equal(sniffType(PNG), 'image/png');
  assert.equal(sniffType(HTML), '');
});

test('guarda o documento no contrato, protegido, e a renovação enxerga os documentos do contrato anterior', async () => {
  const { call, dataDir, store, events } = setup();
  const up = await call('POST /api/sales/:id/docs', { params: { id: 's1' }, user: gio, body: { kind: 'passaporte', note: 'validade 2030' }, file: { buffer: PDF, size: PDF.length, originalname: 'passaporte ana.pdf' } });
  assert.equal(up.status, 200);
  assert.equal(up.out.kindLabel, 'Passaporte');
  const meta = store.data.clientDocs.s1[0];
  const file = path.join(dataDir, 'client-docs', 's1', meta.file);
  assert.ok(fs.existsSync(file));
  assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'arquivo só do sistema');
  assert.match(meta.file, /^[a-f0-9]{16}\.pdf$/, 'nome aleatório, não o nome enviado');
  // contrato novo (renovação) da mesma cliente
  const novo = await call('GET /api/sales/:id/docs', { params: { id: 's2' }, user: gio });
  assert.equal(novo.out.docs.length, 0);
  assert.equal(novo.out.anteriores[0].number, 'VND-1');
  assert.equal(novo.out.anteriores[0].docs[0].kind, 'passaporte');
  const dl = await call('GET /api/sales/:id/docs/:docId', { params: { id: 's2', docId: meta.id }, user: gio });
  assert.equal(dl.status, 200);
  assert.ok(Buffer.isBuffer(dl.out));
  assert.match(dl.headers['Content-Disposition'], /^attachment/);
  assert.ok(events.some(([t]) => t === 'pasta_cliente_envio') && events.some(([t]) => t === 'pasta_cliente_download'));
});

test('travas: vendedor de outro contrato não vê; arquivo que não é PDF/imagem é recusado; só administrador exclui', async () => {
  const { call, store } = setup();
  assert.equal((await call('GET /api/sales/:id/docs', { params: { id: 's3' }, user: gio })).status, 404);
  assert.equal((await call('POST /api/sales/:id/docs', { params: { id: 's1' }, user: gio, body: {}, file: { buffer: HTML, size: HTML.length, originalname: 'x.pdf' } })).status, 415);
  await call('POST /api/sales/:id/docs', { params: { id: 's1' }, user: gio, body: { kind: 'foto' }, file: { buffer: PNG, size: PNG.length, originalname: 'foto.png' } });
  const id = store.data.clientDocs.s1[0].id;
  assert.equal((await call('DELETE /api/sales/:id/docs/:docId', { params: { id: 's1', docId: id }, user: gio })).status, 403);
  assert.equal((await call('DELETE /api/sales/:id/docs/:docId', { params: { id: 's1', docId: id }, user: admin })).status, 200);
  assert.equal(store.data.clientDocs.s1.length, 0);
});

test('mesmo cliente pelo telefone (com ou sem formatação)', () => {
  const a = { id: 'a', client: { phone: '5545988887777', nome: 'X' } };
  const b = { id: 'b', client: { phone: '(45) 98888-7777', nome: 'Outro nome' } };
  const c = { id: 'c', client: { phone: '5545900000000', nome: 'X' } };
  assert.deepEqual(sameClientSales(a, [a, b, c]).map((s) => s.id), ['b']);
});
