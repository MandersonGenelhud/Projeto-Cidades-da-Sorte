// Números da equipe: um WhatsApp por vendedor (com o nome dele), cada um com o seu
// QR Code, as suas conversas e a IA respondendo com o conhecimento da empresa.
// As conversas desses números usam a chave "l:<id do número>:<jid>", para não se
// misturarem com o número principal nem entre si.
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const LINE_PREFIX = 'l:';
// Cada conexão usa memória do computador; 20 cobre a equipe com folga.
export const MAX_LINES = 20;
export const lineKey = (id, jid) => `${LINE_PREFIX}${id}:${jid}`;

/** "l:abc:5511...@s.whatsapp.net" → { id: 'abc', jid: '5511...@s.whatsapp.net' } */
export function parseLineKey(key) {
  const m = /^l:([^:]+):(.+)$/.exec(String(key || ''));
  return m ? { id: m[1], jid: m[2] } : null;
}

/**
 * O WhatsApp conectou: confere se o número é o do vendedor cadastrado.
 * - Conexão do vendedor sem WhatsApp no cadastro: o número conectado vira o dele.
 * - Conexão sem vendedor: se o número é de alguém da equipe, liga a conexão a essa pessoa.
 * Devolve { patch (para a conexão), userWhatsapp (preencher no cadastro), owner, mismatch }.
 */
export function matchSeller(line, phone, users, { samePhone, taken = () => false }) {
  const owner = line.ownerId ? users.find((u) => u.id === line.ownerId) : null;
  if (owner) {
    if (!owner.whatsapp) return { patch: { phone, verified: true, label: owner.name }, owner, userWhatsapp: phone };
    const ok = samePhone(owner.whatsapp, phone);
    return { patch: { phone, verified: ok, label: owner.name }, owner, mismatch: !ok };
  }
  const found = users.find((u) => u.active !== false && u.whatsapp && samePhone(u.whatsapp, phone) && !taken(u.id));
  if (found) return { patch: { phone, verified: true, ownerId: found.id, label: found.name }, owner: found };
  return { patch: { phone, verified: null } };
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

  /** Conexão do vendedor (cada vendedor tem uma só). */
  byOwner(ownerId) {
    return ownerId ? this.lines.find((l) => l.ownerId === ownerId) || null : null;
  }

  add({ label, ownerId = null }) {
    const existing = this.byOwner(ownerId);
    if (existing) {
      if (!this.clients.has(existing.id)) this.start(existing.id).catch((err) => this.emit('log', { type: 'error', message: `${existing.label}: ${err.message}` }));
      return existing;
    }
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
    // Número que conectou e se ele confere com o cadastro do vendedor (true, false ou null = sem cadastro).
    if (patch.phone !== undefined) next.phone = patch.phone || '';
    if (patch.verified !== undefined) next.verified = patch.verified;
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
    const wrap = (msg) => {
      const out = {
        ...msg,
        jid: lineKey(id, msg.jid),
        line: id,
        lineLabel: line().label,
        ownerId: line().ownerId || null,
        agentOff: line().agent === false,
      };
      if (msg._raw) Object.defineProperty(out, '_raw', { value: msg._raw, enumerable: false, writable: true });
      return out;
    };
    client.on('status', (state) => this.emit('status', { id, ...state }));
    client.on('message', (msg) => this.emit('message', wrap(msg)));
    client.on('ownerMessage', (msg) => this.emit('ownerMessage', wrap(msg)));
    // Histórico do celular do vendedor: clientes que ficaram sem resposta neste número.
    client.on('history', (msgs) => this.emit('history', msgs.map(wrap)));
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

  async downloadAudio(msg) {
    return this.clients.get(msg.line)?.downloadAudio(msg) ?? null;
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
