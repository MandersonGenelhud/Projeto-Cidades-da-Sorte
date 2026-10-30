// Gerencia as conexões: WhatsApp (QR Code ou API oficial da Meta, um de cada vez)
// e, em paralelo, o Instagram Direct. O resto do sistema conversa só com este objeto.
import { EventEmitter } from 'node:events';
import { IG_PREFIX } from './transports/instagram.js';
import { LINE_PREFIX } from './lines.js';

const FORWARDED = ['checkNumber', 'getGroups', 'getGroupParticipants', 'resolveJid'];

export class ConnectionManager extends EventEmitter {
  constructor({ store, clients, instagram = null, lines = null }) {
    super();
    this.store = store;
    this.lines = lines; // LineManager: números da equipe (chaves "l:…")
    if (lines) {
      lines.on('message', (msg) => this.emit('message', msg));
      lines.on('ownerMessage', (msg) => this.emit('ownerMessage', msg));
      lines.on('history', (msgs) => this.emit('history', msgs));
      lines.on('status', (state) => this.emit('lineStatus', state));
      lines.on('log', (entry) => this.emit('log', entry));
    }
    this.clients = clients; // { qr: WhatsAppClient, cloud: CloudApiClient }
    this.instagram = instagram; // InstagramClient (opcional), funciona junto com o WhatsApp
    if (instagram) {
      instagram.on('status', (state) => this.emit('instagramStatus', state));
      instagram.on('message', (msg) => this.emit('message', msg));
      instagram.on('ownerMessage', (msg) => this.emit('ownerMessage', msg));
    }
    for (const [mode, client] of Object.entries(clients)) {
      client.on('status', (state) => mode === this.mode && this.emit('status', { ...state, mode }));
      client.on('message', (msg) => mode === this.mode && this.emit('message', msg));
      client.on('ownerMessage', (msg) => mode === this.mode && this.emit('ownerMessage', msg));
      client.on('history', (msgs) => mode === this.mode && this.emit('history', msgs));
      client.on('log', (entry) => this.emit('log', entry));
    }
    for (const method of FORWARDED) {
      this[method] = (...args) => this.current[method](...args);
    }
  }

  get mode() {
    return this.store.settings.connection?.mode === 'cloud' ? 'cloud' : 'qr';
  }

  get current() {
    return this.clients[this.mode];
  }

  get status() {
    return this.current.status;
  }

  getState() {
    return { ...this.current.getState(), mode: this.mode };
  }

  /** O canal de uma conversa está conectado? */
  isConnected(to) {
    if (String(to).startsWith(LINE_PREFIX)) return Boolean(this.lines?.isConnected(to));
    return String(to).startsWith(IG_PREFIX) ? this.instagram?.status === 'connected' : this.status === 'connected';
  }

  /** Envia pelo canal da conversa e avisa quem estiver ouvindo (ex.: lista de conversas sem resposta). */
  async send(to, payload) {
    if (String(to).startsWith(LINE_PREFIX)) {
      if (!this.lines) throw new Error('Números da equipe não configurados');
      const result = await this.lines.send(to, payload);
      this.emit('sent', { to, jid: result?.jid });
      return result;
    }
    const client = String(to).startsWith(IG_PREFIX) ? this.instagram : this.current;
    if (!client) throw new Error('Instagram não configurado');
    const result = await client.send(to, payload);
    this.emit('sent', { to, jid: result?.jid });
    return result;
  }

  /** Marca mensagens como lidas no canal da conversa (erros são ignorados). */
  async markRead(to, ids) {
    if (String(to).startsWith(LINE_PREFIX)) return this.lines?.markRead(to, ids).catch(() => {});
    const client = String(to).startsWith(IG_PREFIX) ? this.instagram : this.current;
    try {
      await client?.markRead?.(to, ids);
    } catch {
      /* opcional */
    }
  }

  async requestPairingCode(phone) {
    if (this.mode !== 'qr') throw new Error('A conexão por código só existe no modo QR Code');
    return this.clients.qr.requestPairingCode(phone);
  }

  async start() {
    await this.current.start();
  }

  async restart() {
    await this.current.restart();
  }

  async logout() {
    await this.current.logout();
  }

  /** Troca o modo de conexão, desligando o anterior. */
  async switchMode(mode) {
    const previous = this.current;
    this.store.updateSettings({ connection: { mode } });
    if (previous !== this.current) await previous.stop();
    await this.current.start();
    this.emit('status', this.getState());
  }

  async stop() {
    await Promise.all([...Object.values(this.clients), this.instagram, this.lines].filter(Boolean).map((c) => c.stop()));
  }
}
