// Envio automático da cópia do sistema antigo: o programa de cópia (no computador de quem tem o login do sistema antigo)
// manda o captura.json e os arquivos (PDFs, fotos e documentos) direto para cá, e tudo já vai para o lugar certo:
// contratos e clientes importados, arquivos ligados ao contrato ou cliente dono, vendas com parcelas e CRM.
// A chave de envio é temporária (8 horas), serve SÓ para este envio e morre quando o envio termina.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeRecord, norm } from './legacy-import.js';

const TOKEN_TTL_MS = 8 * 3600_000;
const err = (status, message) => Object.assign(new Error(message), { status });
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const KIND = { pdf: '%PDF', png: '\x89PNG', jpg: '\xff\xd8\xff', webp: 'RIFF', docx: 'PK\x03\x04', doc: '\xd0\xcf\x11\xe0' };
const OK_EXT = new Set(Object.keys(KIND));
export const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

/** Dono de cada arquivo: a página onde ele apareceu diz de qual contrato e de qual cliente é. */
export function fileOwners(captura) {
  const owners = new Map();
  for (const p of captura?.pages || []) {
    const f = Object.fromEntries((p.fields || []).map((x) => [x.label, x.value]));
    const rec = Object.keys(f).length >= 3 ? normalizeRecord(f, { source: p.url }) : null;
    const names = [...new Set([...(p.arquivos || []).map((a) => a.name), ...(p.pdfs || [])])];
    for (const name of names) if (!owners.has(name)) owners.set(name, { url: p.url, number: rec?.number || '', client: rec?.client || '', kind: (p.arquivos || []).find((a) => a.name === name)?.kind || 'pdf' });
  }
  return owners;
}

export class Ingest {
  constructor({ store, dataDir, legacy, sales, crm }) {
    Object.assign(this, { store, legacy, sales, crm });
    this.dir = path.join(dataDir, 'legado');
    fs.mkdirSync(this.dir, { recursive: true });
    store.data.ingestTokens ||= [];
    store.data.legacyRuns ||= {};
    store.data.legacyFiles ||= [];
  }

  /** Cria a chave temporária que vai dentro do programa baixado pelo administrador. */
  issueToken(user) {
    const token = crypto.randomBytes(24).toString('base64url');
    const now = Date.now();
    this.store.data.ingestTokens = this.store.data.ingestTokens.filter((t) => t.exp > now && !t.usedAt).slice(-20);
    this.store.data.ingestTokens.push({ hash: sha(token), exp: now + TOKEN_TTL_MS, by: user?.name || '', at: new Date(now).toISOString(), usedAt: null, run: null });
    this.store.save();
    return { token, exp: new Date(now + TOKEN_TTL_MS).toISOString() };
  }

  /** Confere a chave do cabeçalho Authorization: Bearer. */
  auth(req) {
    const m = /^Bearer ([\w-]{20,80})$/.exec(String(req.get('authorization') || ''));
    const rec = m && this.store.data.ingestTokens.find((t) => t.hash === sha(m[1]));
    if (!rec || rec.exp < Date.now() || rec.usedAt) throw err(401, 'Chave de envio inválida ou vencida. Baixe o programa de cópia de novo no painel.');
    return rec;
  }

  start(rec, captura) {
    if (!captura || !Array.isArray(captura.pages)) throw err(400, 'Arquivo de cópia inválido');
    if (rec.run) return this.store.data.legacyRuns[rec.run];
    const summary = this.legacy.import(captura, { name: rec.by || 'Cópia automática' });
    const id = crypto.randomBytes(5).toString('hex');
    const owners = [...fileOwners(captura)].map(([name, o]) => ({ name, ...o }));
    const run = { id, at: new Date().toISOString(), by: rec.by, summary, owners, received: 0, rejected: 0 };
    this.store.data.legacyRuns[id] = run;
    rec.run = id;
    this.store.save();
    return run;
  }

  /** Recebe um lote de arquivos e liga cada um ao contrato ou cliente dono. */
  addFiles(rec, files) {
    const run = this.store.data.legacyRuns[rec.run];
    if (!run) throw err(409, 'Envie primeiro o arquivo de cópia (captura.json).');
    const dir = path.join(this.dir, run.id);
    fs.mkdirSync(dir, { recursive: true });
    const out = { saved: 0, rejected: 0 };
    for (const f of files) {
      const ext = path.extname(f.originalname || '').slice(1).toLowerCase().replace('jpeg', 'jpg');
      const head = f.buffer.subarray(0, 8).toString('latin1');
      if (!OK_EXT.has(ext) || !head.startsWith(KIND[ext])) { out.rejected += 1; run.rejected += 1; continue; }
      const id = crypto.randomBytes(6).toString('hex');
      const stored = `${id}.${ext}`;
      fs.writeFileSync(path.join(dir, stored), f.buffer);
      const o = run.owners.find((x) => x.name === path.basename(f.originalname));
      const meta = { id, run: run.id, name: path.basename(f.originalname), ext, kind: o?.kind || (ext === 'pdf' ? 'pdf' : 'imagem'), size: f.buffer.length, stored: `${run.id}/${stored}`, contract: o?.number || '', client: o?.client || '', page: o?.url || '', at: new Date().toISOString() };
      this.store.data.legacyFiles.push(meta);
      const rec2 = (o?.number && this.legacy.list.find((r) => r.number === o.number)) || (o?.client && this.legacy.list.find((r) => norm(r.client) === norm(o.client)));
      if (rec2) (rec2.files ||= []).push({ id, name: meta.name, kind: meta.kind, size: meta.size });
      else {
        const cl = o?.client && this.legacy.clients.find((c) => norm(c.name) === norm(o.client));
        if (cl) (cl.files ||= []).push({ id, name: meta.name, kind: meta.kind, size: meta.size });
      }
      out.saved += 1; run.received += 1;
    }
    this.store.save();
    return out;
  }

  /** Fim do envio: leva tudo para Vendas e CRM e encerra a chave. */
  finish(rec, user) {
    const run = this.store.data.legacyRuns[rec.run];
    if (!run) throw err(409, 'Nada foi enviado ainda.');
    const applied = this.legacy.apply({ sales: this.sales, crm: this.crm, user: user || { name: rec.by || 'Cópia automática', role: 'admin' } });
    rec.usedAt = new Date().toISOString();
    run.finishedAt = rec.usedAt;
    run.applied = applied;
    this.store.save();
    return { run: run.id, summary: run.summary, files: { received: run.received, rejected: run.rejected }, applied };
  }

  file(id) {
    const f = this.store.data.legacyFiles.find((x) => x.id === id);
    return f ? { ...f, path: path.join(this.dir, f.stored) } : null;
  }
}
