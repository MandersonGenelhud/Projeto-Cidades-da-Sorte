// Conexão com o WhatsApp via Baileys (protocolo do WhatsApp Web, sem navegador).
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { jidToPhone, normalizePhone, randomBetween, sleep } from '../utils.js';

/**
 * Converte uma mensagem do Baileys no formato interno.
 * `lidToPn` resolve contas com LID (@lid) para o número real.
 */
export function normalizeMessage(msg, lidToPn = new Map()) {
  if (!msg?.message) return null;
  const jid = msg.key.remoteJid;
  if (!jid || jid === 'status@broadcast' || jid.endsWith('@newsletter')) return null;
  const isGroup = jid.endsWith('@g.us');
  const m = msg.message.ephemeralMessage?.message || msg.message;
  const text =
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    '';
  // Em contas com LID o número real vem em remoteJidAlt (ou no mapeamento LID → número).
  const pnJid = [msg.key.remoteJidAlt, lidToPn.get(jid), jid].find((j) => j && j.endsWith('@s.whatsapp.net'));
  const senderJid = isGroup ? msg.key.participantAlt || msg.key.participant : pnJid;
  return {
    id: msg.key.id,
    jid,
    isGroup,
    fromMe: Boolean(msg.key.fromMe),
    phone: senderJid ? jidToPhone(senderJid) : null,
    name: msg.key.fromMe ? '' : msg.pushName || '',
    text,
    timestamp: Number(msg.messageTimestamp) * 1000 || Date.now(),
  };
}

export class WhatsAppClient extends EventEmitter {
  constructor({ authDir, logLevel = 'silent' }) {
    super();
    this.authDir = authDir;
    this.logger = pino({ level: logLevel });
    this.sock = null;
    this.status = 'disconnected'; // disconnected | connecting | qr | connected
    this.qr = null; // data URL da imagem do QR Code
    this.me = null;
    this.jidCache = new Map();
    this.sentIds = new Set(); // mensagens enviadas por este sistema (para não confundir com o dono)
    this.stopping = false;
  }

  getState() {
    return { status: this.status, qr: this.qr, me: this.me };
  }

  #setStatus(status, extra = {}) {
    this.status = status;
    Object.assign(this, extra);
    this.emit('status', this.getState());
  }

  async start() {
    this.stopping = false;
    this.#setStatus('connecting', { qr: null });
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    let version;
    try {
      ({ version } = await fetchLatestBaileysVersion());
    } catch {
      version = undefined; // usa a versão embutida na biblioteca
    }

    const sock = makeWASocket({
      auth: state,
      version,
      logger: this.logger,
      browser: Browsers.macOS('Desktop'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    this.sock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (this.sock !== sock) return; // evento de um socket antigo (após restart)
      if (qr) {
        const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 300 });
        this.#setStatus('qr', { qr: dataUrl });
      }
      if (connection === 'open') {
        const id = sock.user?.id;
        this.#setStatus('connected', {
          qr: null,
          me: { phone: jidToPhone(id), name: sock.user?.name || sock.user?.notify || '' },
        });
      }
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        this.#setStatus('disconnected', { qr: null, me: null });
        if (loggedOut) {
          this.#clearAuth();
          this.emit('log', { type: 'system', message: 'Sessão encerrada no celular. Escaneie o QR Code novamente.' });
        }
        if (!this.stopping) {
          // Reconecta automaticamente (após logout, gera um novo QR Code).
          await sleep(loggedOut ? 1000 : 3000);
          this.start().catch((err) => this.emit('log', { type: 'error', message: `Falha ao reconectar: ${err.message}` }));
        }
      }
    });

    // Histórico enviado pelo celular logo depois de conectar: usado para achar
    // clientes que estavam esperando resposta.
    sock.ev.on('messaging-history.set', ({ messages, lidPnMappings }) => {
      if (this.sock !== sock || !messages?.length) return;
      const lidToPn = new Map((lidPnMappings || []).map((x) => [x.lid, x.pn]));
      const normalized = messages.map((msg) => normalizeMessage(msg, lidToPn)).filter((x) => x && !x.isGroup);
      if (normalized.length) this.emit('history', normalized);
    });

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (this.sock !== sock) return;
      if (type === 'append') {
        // Mensagens que chegaram enquanto o sistema estava desligado: não respondem
        // na hora, mas entram na lista de clientes esperando resposta.
        const normalized = messages.map((msg) => normalizeMessage(msg)).filter((x) => x && !x.isGroup);
        if (normalized.length) this.emit('history', normalized);
        return;
      }
      if (type !== 'notify') return;
      for (const msg of messages) {
        if (msg.key.fromMe) {
          // Mensagem que o dono mandou pelo celular (as deste sistema não chegam como "notify").
          if (this.sentIds.has(msg.key.id)) continue;
          const parsed = this.#parseIncoming({ ...msg, key: { ...msg.key, fromMe: false } });
          if (parsed && !parsed.isGroup) this.emit('ownerMessage', parsed);
          continue;
        }
        const parsed = this.#parseIncoming(msg);
        if (parsed) this.emit('message', parsed);
      }
    });
  }

  #parseIncoming(msg) {
    if (!msg.message || msg.key.fromMe) return null;
    return normalizeMessage(msg);
  }

  #clearAuth() {
    fs.rmSync(this.authDir, { recursive: true, force: true });
    fs.mkdirSync(this.authDir, { recursive: true });
    this.jidCache.clear();
  }

  async logout() {
    if (this.sock && this.status === 'connected') {
      try {
        await this.sock.logout();
      } catch {
        /* a conexão será fechada de qualquer forma */
      }
    } else {
      this.#clearAuth();
      this.restart();
    }
  }

  async restart() {
    const old = this.sock;
    this.sock = null;
    try { old?.end(undefined); } catch { /* ignora */ }
    await sleep(500);
    await this.start();
  }

  #ensureConnected() {
    if (!this.sock || this.status !== 'connected') {
      throw new Error('WhatsApp não está conectado');
    }
  }

  /** Descobre o JID correto (resolve o 9º dígito dos números brasileiros). */
  async resolveJid(phoneOrJid) {
    if (String(phoneOrJid).includes('@')) return phoneOrJid;
    const phone = normalizePhone(phoneOrJid);
    if (!phone) throw new Error(`Número inválido: ${phoneOrJid}`);
    if (this.jidCache.has(phone)) return this.jidCache.get(phone);
    this.#ensureConnected();
    const [result] = (await this.sock.onWhatsApp(phone)) || [];
    if (!result?.exists) throw new Error(`O número ${phone} não tem WhatsApp`);
    this.jidCache.set(phone, result.jid);
    return result.jid;
  }

  async checkNumber(phone) {
    try {
      const jid = await this.resolveJid(phone);
      return { exists: true, jid };
    } catch (err) {
      return { exists: false, error: err.message };
    }
  }

  /** Mostra "digitando..." por um tempo proporcional ao tamanho do texto. */
  async #simulateTyping(jid, text) {
    try {
      await this.sock.presenceSubscribe(jid);
      await this.sock.sendPresenceUpdate('composing', jid);
      const ms = Math.min(6000, 800 + (text?.length || 0) * randomBetween(25, 45));
      await sleep(ms);
      await this.sock.sendPresenceUpdate('paused', jid);
    } catch {
      /* presença é opcional */
    }
  }

  /**
   * Envia uma mensagem. `media` é opcional: { path, mimetype, fileName }.
   */
  async send(to, { text = '', media = null, typing = true } = {}) {
    this.#ensureConnected();
    const jid = await this.resolveJid(to);
    if (typing) await this.#simulateTyping(jid, text);

    let content;
    if (media?.path) {
      const buffer = fs.readFileSync(media.path);
      const mimetype = media.mimetype || 'application/octet-stream';
      if (mimetype.startsWith('image/')) content = { image: buffer, caption: text || undefined, mimetype };
      else if (mimetype.startsWith('video/')) content = { video: buffer, caption: text || undefined, mimetype };
      else if (mimetype.startsWith('audio/')) content = { audio: buffer, mimetype, ptt: false };
      else content = {
        document: buffer,
        mimetype,
        fileName: media.fileName || path.basename(media.path),
        caption: text || undefined,
      };
    } else {
      if (!text) throw new Error('Mensagem vazia');
      content = { text };
    }
    const sent = await this.sock.sendMessage(jid, content);
    if (sent?.key?.id) {
      this.sentIds.add(sent.key.id);
      if (this.sentIds.size > 5000) this.sentIds.delete(this.sentIds.values().next().value);
    }
    // Áudio não aceita legenda: envia o texto separado.
    if (media?.mimetype?.startsWith('audio/') && text) await this.sock.sendMessage(jid, { text });
    return { id: sent?.key?.id, jid };
  }

  /**
   * Conexão por código (sem câmera): o dono do número digita o código no celular em
   * Dispositivos conectados → Conectar dispositivo → Conectar com número de telefone.
   */
  async requestPairingCode(phoneInput) {
    const digits = String(phoneInput || '').replace(/\D/g, '');
    if (digits.length < 11 || digits.length > 15) {
      throw new Error('Informe o número completo com o código do país (ex.: +595 981 123456 ou +55 11 98765-4321)');
    }
    if (this.status === 'connected') throw new Error('Já existe um WhatsApp conectado. Desconecte antes.');
    if (!this.sock || this.status !== 'qr') throw new Error('Aguarde o QR Code aparecer e tente de novo');
    const code = await this.sock.requestPairingCode(digits);
    return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
  }

  async getGroups() {
    this.#ensureConnected();
    const groups = await this.sock.groupFetchAllParticipating();
    return Object.values(groups).map((g) => ({
      id: g.id,
      name: g.subject,
      participants: g.participants?.length || 0,
    }));
  }

  async getGroupParticipants(groupId) {
    this.#ensureConnected();
    const meta = await this.sock.groupMetadata(groupId);
    return meta.participants
      .map((p) => {
        const jid = [p.phoneNumber, p.jid, p.id].find((j) => j && j.endsWith('@s.whatsapp.net'));
        return jid ? jidToPhone(jid) : null;
      })
      .filter(Boolean);
  }

  async stop() {
    this.stopping = true;
    try { this.sock?.end(undefined); } catch { /* ignora */ }
  }
}
