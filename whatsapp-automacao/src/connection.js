// Gerencia as conexões: WhatsApp (QR Code ou API oficial da Meta, um de cada vez)
// e, em paralelo, o Instagram Direct. O resto do sistema conversa só com este objeto.
import { EventEmitter } from 'node:events';
import { IG_PREFIX } from './transports/instagram.js';
import { LINE_PREFIX } from './lines.js';

const FORWARDED = ['checkNumber', 'getGroups', 'getGroupParticipants', 'resolveJid'];

/** De qual CONTA (número) sai a mensagem: cada número da equipe, o principal e o Instagram são contas separadas. */
export const accountOf = (to) => {
  const s = String(to || '');
  if (s.startsWith(LINE_PREFIX)) return `linha:${s.split(':')[1]}`;
  return s.startsWith(IG_PREFIX) ? 'instagram' : 'principal';
};
/** O destinatário (só os dígitos do número), igual para "l:linha:5545...@s.whatsapp.net" e "5545...". */
const destOf = (to) => (String(to).split(':').pop().split('@')[0] || '').replace(/\D/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class ConnectionManager extends EventEmitter {
  constructor({ store, clients, instagram = null, lines = null, quietMs = 6000, maxQuietWaitMs = 20_000, guard = null }) {
    super();
    this.guard = guard; // proteção do número (src/send-guard.js): intervalo, teto por minuto e de contatos novos por hora
    // Uma mensagem de cada vez em cada conta: duas respostas automáticas nunca saem juntas pelo mesmo número (contas diferentes seguem em paralelo).
    this.sendChain = new Map(); // conta → fim da última mensagem na fila
    this.humanAt = new Map(); // conta → quando a pessoa da equipe digitou pelo celular pela última vez
    this.quietMs = quietMs;
    this.maxQuietWaitMs = maxQuietWaitMs;
    this.on('ownerMessage', (msg) => this.humanAt.set(accountOf(msg?.jid), Date.now()));
    this.on('message', (msg) => { if (msg?.jid) this.guard?.noteInbound(accountOf(msg.jid), destOf(msg.jid)); });
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
      client.on('drop', (d) => mode === this.mode && this.emit('drop', d));
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

  /** Número principal desligado de propósito (ex.: banido pelo WhatsApp): não tenta reconectar nem mostra "aguardando QR Code". */
  get mainOff() { return this.store.settings.connection?.mainOff === true; }

  getState() {
    if (this.mainOff) return { status: 'off', me: null, qr: null, error: '', mode: this.mode, mainOff: true };
    return { ...this.current.getState(), mode: this.mode };
  }

  /** O canal de uma conversa está conectado? */
  isConnected(to) {
    if (String(to).startsWith(LINE_PREFIX)) return Boolean(this.lines?.isConnected(to));
    return String(to).startsWith(IG_PREFIX) ? this.instagram?.status === 'connected' : this.status === 'connected';
  }

  /** Baixa o áudio de uma mensagem recebida (número principal ou número da equipe). */
  async downloadAudio(msg) {
    if (msg?.line) return this.lines?.downloadAudio(msg) ?? null;
    return this.current.downloadAudio?.(msg) ?? null;
  }

  /** Quanto falta para a pessoa da equipe "parar" de usar este número pelo celular (ms; 0 = livre). */
  humanWaitMs(to) {
    const at = this.humanAt.get(accountOf(to)) || 0;
    return Math.max(0, at + this.quietMs - Date.now());
  }

  /** Envia pelo canal da conversa e avisa quem estiver ouvindo (ex.: lista de conversas sem resposta). */
  /** Apaga para todos uma mensagem enviada por nós (só WhatsApp). */
  async revoke(to, id) {
    if (String(to).startsWith(LINE_PREFIX)) return this.lines?.revoke(to, id);
    if (String(to).startsWith(IG_PREFIX)) return undefined;
    return this.current?.revoke?.(to, id);
  }

  /**
   * Envia pelo canal da conversa. Cada conta (número) tem a sua fila: só uma mensagem sai por vez, e se a pessoa da equipe acabou de
   * digitar pelo celular naquele número, a resposta automática espera alguns segundos para não atravessar o atendimento manual.
   */
  send(to, payload) {
    const account = accountOf(to);
    const prev = this.sendChain.get(account) || Promise.resolve();
    const run = async () => {
      const wait = Math.min(this.maxQuietWaitMs, Math.max(0, (this.humanAt.get(account) || 0) + this.quietMs - Date.now()));
      if (wait > 0 && payload?.auto !== false) await sleep(wait);
      // Proteção do número: espera a vez (intervalo e teto por minuto); contato novo além do teto da hora é recusado.
      if (this.guard && !String(to).startsWith(IG_PREFIX)) {
        const g = this.guard.plan(account, destOf(to), { team: payload?.team === true });
        if (g > 0) await sleep(g);
      }
      const result = await this.#sendNow(to, payload);
      if (this.guard && !String(to).startsWith(IG_PREFIX)) this.guard.record(account, destOf(to), { team: payload?.team === true });
      return result;
    };
    const next = prev.catch(() => {}).then(run);
    this.sendChain.set(account, next.catch(() => {}));
    return next;
  }

  async #sendNow(to, payload) {
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
    if (this.mainOff) return;
    await this.current.start();
  }

  async restart() {
    if (this.mainOff) return;
    await this.current.restart();
  }

  async logout() {
    await this.current.logout();
  }

  /** Desliga (ou religa) o número principal. Desligado: encerra a sessão local e não volta a pedir QR Code; os números da equipe e o Instagram seguem. */
  async setMainOff(off) {
    if (off) {
      this.store.updateSettings({ connection: { mainOff: true } });
      try { await this.current.logout(); } catch { /* sessão já inválida (número banido) */ }
      try { await this.current.stop(); } catch { /* já parado */ }
    } else {
      this.store.updateSettings({ connection: { mainOff: false } });
      await this.current.start();
    }
    this.emit('status', this.getState());
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
