// Números da equipe: até 6 WhatsApps (um por vendedor), cada um com o seu QR Code,
// as suas conversas e a IA respondendo com o conhecimento da empresa.
// As conversas desses números usam a chave "l:<id do número>:<jid>", para não se
// misturarem com o número principal nem entre si.
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const LINE_PREFIX = 'l:';
export const MAX_LINES = 6;
export const lineKey = (id, jid) => `${LINE_PREFIX}${id}:${jid}`;

/** "l:abc:5511...@s.whatsapp.net" → { id: 'abc', jid: '5511...@s.whatsapp.net' } */
export function parseLineKey(key) {
  const m = /^l:([^:]+):(.+)$/.exec(String(key || ''));
  return m ? { id: m[1], jid: m[2] } : null;
}

export class LineManager extends EventEmitter {
  /** createClient({ authDir }) devolve um cliente com a mesma interface do WhatsAppClient. */
  constructor({ store, dataDir, createClient }) {
    super();
    this.store = store;
    this.dir = path.join(dataDir, 'lines');
    this.createClient = createClient;
    this.clients = new Map();
  }

  get lines() {
    return this.store.settings.lines || [];
  }

  #save(lines) {
    this.store.updateSettings({ lines });
  }

  get(id) {
    return this.lines.find((l) => l.id === id) || null;
  }

  /** Números com o estado da conexão (QR, conectado…). */
  list() {
    return this.lines.map((l) => ({ ...l, ...(this.clients.get(l.id)?.getState() || { status: 'disconnected', qr: null, me: null }) }));
  }

  add({ label, ownerId = null }) {
    if (this.lines.length >= MAX_LINES) throw Object.assign(new Error(`O limite é de ${MAX_LINES} números da equipe`), { status: 400 });
    const line = { id: crypto.randomBytes(4).toString('hex'), label: String(label || `Número ${this.lines.length + 1}`).trim(), ownerId: ownerId || null, agent: true, createdAt: new Date().toISOString() };
    this.#save([...this.lines, line]);
    this.start(line.id).catch((err) => this.emit('log', { type: 'error', message: `${line.label}: ${err.message}` }));
    return line;
  }

  update(id, patch) {
    const line = this.get(id);
    if (!line) throw Object.assign(new Error('Número não encontrado'), { status: 404 });
    const next = { ...line };
    if (patch.label !== undefined) next.label = String(patch.label).trim() || line.label;
    if (patch.ownerId !== undefined) next.ownerId = patch.ownerId || null;
    if (patch.agent !== undefined) next.agent = Boolean(patch.agent);
    this.#save(this.lines.map((l) => (l.id === id ? next : l)));
    this.emit('status', { id });
    return next;
  }

  async remove(id) {
    const client = this.clients.get(id);
    if (client) {
      await client.logout().catch(() => {});
      await client.stop().catch(() => {});
      this.clients.delete(id);
    }
    fs.rmSync(path.join(this.dir, id), { recursive: true, force: true });
    this.#save(this.lines.filter((l) => l.id !== id));
    this.emit('status', { id });
  }

  /** Liga (ou religa) a conexão de um número. */
  async start(id) {
    if (!this.get(id)) throw Object.assign(new Error('Número não encontrado'), { status: 404 });
    let client = this.clients.get(id);
    if (!client) {
      const authDir = path.join(this.dir, id);
      fs.mkdirSync(authDir, { recursive: true });
      client = this.createClient({ authDir });
      this.#wire(id, client);
      this.clients.set(id, client);
      await client.start();
    } else {
      await client.restart();
    }
    return this.get(id);
  }

  async startAll() {
    for (const l of this.lines) await this.start(l.id).catch((err) => this.emit('log', { type: 'error', message: `${l.label}: ${err.message}` }));
  }

  #wire(id, client) {
    const line = () => this.get(id) || { id, label: id };
    const wrap = (msg) => ({
      ...msg,
      jid: lineKey(id, msg.jid),
      line: id,
      lineLabel: line().label,
      ownerId: line().ownerId || null,
      agentOff: line().agent === false,
    });
    client.on('status', (state) => this.emit('status', { id, ...state }));
    client.on('message', (msg) => this.emit('message', wrap(msg)));
    client.on('ownerMessage', (msg) => this.emit('ownerMessage', wrap(msg)));
    client.on('log', (entry) => this.emit('log', { ...entry, message: `[${line().label}] ${entry.message}` }));
  }

  #client(key) {
    const parsed = parseLineKey(key);
    if (!parsed) throw new Error('Conversa não é de um número da equipe');
    const client = this.clients.get(parsed.id);
    if (!client) throw new Error('Este número da equipe não está ligado');
    return { client, jid: parsed.jid };
  }

  isConnected(key) {
    const parsed = parseLineKey(key);
    return parsed ? this.clients.get(parsed.id)?.status === 'connected' : false;
  }

  async send(key, payload) {
    const { client, jid } = this.#client(key);
    const result = await client.send(jid, payload);
    return { ...result, jid: key };
  }

  async markRead(key, ids) {
    const { client, jid } = this.#client(key);
    await client.markRead?.(jid, ids);
  }

  async requestPairingCode(id, phone) {
    const client = this.clients.get(id);
    if (!client) throw new Error('Este número ainda não foi ligado');
    return client.requestPairingCode(phone);
  }

  async logout(id) {
    const client = this.clients.get(id);
    if (client) await client.logout();
  }

  async stop() {
    await Promise.all([...this.clients.values()].map((c) => c.stop().catch(() => {})));
  }
}
