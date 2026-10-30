// Backup automático e criptografado dos dados do painel (clientes, conversas, vendas, configurações).
// Uma cópia por dia, guardada por 30 dias, cifrada com AES-256-GCM (autenticada: arquivo alterado não abre).
// A chave fica em data/backup.key: guarde uma cópia dela fora do computador (sem ela o backup não abre).
// Pasta extra opcional (ex.: pasta do Google Drive): uma segunda cópia fora deste disco.
//
// Restaurar:  node src/backup.js restaurar <arquivo.mhb> [chave]   → gera db.restaurado.json
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const MAGIC = Buffer.from('MHB1');

export function loadKey(dataDir) {
  const file = path.join(dataDir, 'backup.key');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
}

/** Cifra: MAGIC | iv(12) | tag(16) | dados (gzip + AES-256-GCM). */
export function encrypt(plain, key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(MAGIC);
  const body = Buffer.concat([c.update(zlib.gzipSync(plain)), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), body]);
}

export function decrypt(buf, key) {
  if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error('Arquivo não é um backup do Migra Hub');
  const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(4, 16));
  d.setAAD(MAGIC);
  d.setAuthTag(buf.subarray(16, 32));
  return zlib.gunzipSync(Buffer.concat([d.update(buf.subarray(32)), d.final()]));
}

export class Backups {
  constructor({ store, dataDir, keep = 30, log = () => {} }) {
    Object.assign(this, { store, dataDir, keep, log });
    this.dir = path.join(dataDir, 'backups');
    this.key = loadKey(dataDir);
  }

  get extraDir() {
    return String(this.store.settings.security?.backupDir || '').trim();
  }

  list() {
    if (!fs.existsSync(this.dir)) return [];
    return fs.readdirSync(this.dir).filter((f) => f.endsWith('.mhb')).sort().reverse()
      .map((name) => ({ name, size: fs.statSync(path.join(this.dir, name)).size, at: fs.statSync(path.join(this.dir, name)).mtime.toISOString() }));
  }

  /** Faz o backup agora (o banco é gravado antes, para a cópia ficar consistente). */
  run(now = new Date()) {
    this.store.flush?.();
    const plain = Buffer.from(JSON.stringify(this.store.data));
    const stamp = now.toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const name = `migrahub-${stamp}.mhb`;
    fs.mkdirSync(this.dir, { recursive: true });
    const enc = encrypt(plain, this.key);
    fs.writeFileSync(path.join(this.dir, name), enc, { mode: 0o600 });
    // Mantém os 30 mais novos.
    for (const old of this.list().slice(this.keep)) fs.rmSync(path.join(this.dir, old.name), { force: true });
    let extra = '';
    if (this.extraDir) {
      try {
        fs.mkdirSync(this.extraDir, { recursive: true });
        fs.writeFileSync(path.join(this.extraDir, name), enc);
        extra = this.extraDir;
      } catch (e) {
        this.log({ type: 'error', message: `Backup: não gravou a cópia extra em ${this.extraDir} (${e.message})` });
      }
    }
    this.store.data.lastBackup = { name, at: now.toISOString(), size: enc.length, extra };
    this.log({ type: 'system', message: `🔒 Backup criptografado feito: ${name}${extra ? ' (+ cópia extra)' : ''}` });
    return this.store.data.lastBackup;
  }

  file(name) {
    if (!/^migrahub-[\d-]+\.mhb$/.test(name)) return null;
    const f = path.join(this.dir, name);
    return fs.existsSync(f) ? f : null;
  }

  /** Um backup por dia: na hora que liga (se o último tem mais de 20h) e a cada 24h. */
  schedule() {
    const last = Date.parse(this.store.data.lastBackup?.at || 0);
    const due = () => {
      try {
        this.run();
      } catch (e) {
        this.log({ type: 'error', message: `Backup falhou: ${e.message}` });
      }
    };
    if (Date.now() - last > 20 * 3_600_000) setTimeout(due, 60_000).unref?.();
    setInterval(due, 24 * 3_600_000).unref?.();
  }
}

// Linha de comando: restaurar um backup.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === 'restaurar') {
  const file = process.argv[3];
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data'));
  const key = process.argv[4] ? Buffer.from(process.argv[4], 'hex') : loadKey(dataDir);
  const out = path.join(dataDir, 'db.restaurado.json');
  fs.writeFileSync(out, decrypt(fs.readFileSync(file), key));
  console.log(`Backup aberto em ${out}. Para usar: desligue o sistema, renomeie o db.json atual e renomeie este arquivo para db.json.`);
}
