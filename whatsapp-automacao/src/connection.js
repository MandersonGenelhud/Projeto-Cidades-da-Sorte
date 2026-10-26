// Gerencia qual conexão está ativa: QR Code (WhatsApp Web) ou API oficial da Meta.
// O resto do sistema conversa só com este objeto.
import { EventEmitter } from 'node:events';

const FORWARDED = ['send', 'checkNumber', 'getGroups', 'getGroupParticipants', 'resolveJid'];

export class ConnectionManager extends EventEmitter {
  constructor({ store, clients }) {
    super();
    this.store = store;
    this.clients = clients; // { qr: WhatsAppClient, cloud: CloudApiClient }
    for (const [mode, client] of Object.entries(clients)) {
      client.on('status', (state) => mode === this.mode && this.emit('status', { ...state, mode }));
      client.on('message', (msg) => mode === this.mode && this.emit('message', msg));
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
    await Promise.all(Object.values(this.clients).map((c) => c.stop()));
  }
}
