// Conexão com o WhatsApp via Baileys (protocolo do WhatsApp Web, sem navegador).
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
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
    // Foto ou documento sem legenda (ex.: foto do RG): a atendente precisa saber que chegou.
    (m.imageMessage ? '[foto enviada]' : m.documentMessage ? '[documento enviado]' : '') ||
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

/** Motivo da queda em português, para o painel. */
export function describeClose(code, message = '') {
  const known = {
    401: 'sessão encerrada no celular',
    403: 'o WhatsApp recusou a conexão deste número (bloqueio temporário?)',
    405: 'o WhatsApp recusou a conexão (versão ou sessão antiga); tentando de novo com sessão nova',
    408: 'sem resposta do WhatsApp (internet do computador ou firewall/antivírus bloqueando web.whatsapp.com)',
    411: 'conflito de sessão com outro aparelho',
    428: 'conexão encerrada pelo WhatsApp',
    440: 'este número foi aberto em outro lugar (outro computador ou a VPS ligados com o mesmo número?)',
    500: 'sessão salva corrompida; gerando uma nova',
    503: 'WhatsApp fora do ar no momento',
  };
  return `${known[code] || 'conexão caiu'}${code ? ` (código ${code})` : ''}${!known[code] && message ? `: ${message}` : ''}`;
}

/**
 * Quanto esperar antes de reconectar (ms). Queda isolada: espera curta. Quedas repetidas (internet
 * oscilando, número aberto em outro lugar) esperam cada vez mais, para não ficar "batendo na porta" do WhatsApp:
 * 3 quedas em 10 minutos = 10 s, depois 20 s, 40 s... até 5 min.
 */
export function reconnectDelay({ failures = 0, recentDrops = 0, loggedOut = false, normal = false } = {}) {
  if (loggedOut || normal) return 1000;
  const base = Math.min(60_000, 3000 * 2 ** Math.min(failures, 5));
  const flap = recentDrops >= 3 ? Math.min(300_000, 10_000 * 2 ** (recentDrops - 3)) : 0;
  return Math.max(base, flap);
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
    this.failures = 0; // quedas seguidas antes de aparecer o QR Code ou conectar
    this.drops = []; // quando o WhatsApp caiu nos últimos 10 minutos (para segurar o ritmo das reconexões)
    this.lastError = null; // motivo da última queda, mostrado no painel
  }

  getState() {
    return { status: this.status, qr: this.qr, me: this.me, lastError: this.lastError };
  }

  #setStatus(status, extra = {}) {
    this.status = status;
    Object.assign(this, extra);
    this.emit('status', this.getState());
  }

  async start() {
    this.stopping = false;
    // Só uma conexão por número: encerra a anterior (se houver) e, se outra chamada de start() começar enquanto esta
    // espera, só a última cria o socket. Duas conexões com o mesmo número derrubam uma à outra sem parar.
    const myStart = (this.startSeq = (this.startSeq || 0) + 1);
    const prev = this.sock;
    this.sock = null;
    try { prev?.end(undefined); } catch { /* ignora */ }
    this.#setStatus('connecting', { qr: null });
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    // Versão atual do WhatsApp Web (com versão velha o WhatsApp recusa e o QR Code não aparece).
    // Cada consulta tem limite de tempo para nunca ficar preso em "Conectando…".
    const within = (p, ms) => Promise.race([p, sleep(ms).then(() => ({}))]);
    let version;
    const a = await within(fetchLatestWaWebVersion().catch(() => ({})), 6000);
    if (a?.version && a.isLatest !== false) version = a.version;
    if (!version) {
      const b = await within(fetchLatestBaileysVersion().catch(() => ({})), 6000);
      version = b?.version || a?.version; // sem internet para consultar: usa a embutida
    }

    if (myStart !== this.startSeq) return; // outra chamada de start() passou na frente: só a última cria o socket
    if (this.stopping) { this.#setStatus('disconnected', { qr: null }); return; }
    const sock = makeWASocket({
      auth: state,
      version,
      logger: this.logger,
      browser: (this.currentBrowser = this.#browser(state.creds?.registered)),
      markOnlineOnConnect: false,
      // Pede ao celular o histórico completo: dele saem os clientes que ficaram sem resposta.
      syncFullHistory: true,
    });
    this.sock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (this.sock !== sock) return; // evento de um socket antigo (após restart)
      if (qr) {
        this.failures = 0;
        const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 300 });
        this.#setStatus('qr', { qr: dataUrl, lastError: null });
      }
      if (connection === 'open') {
        this.failures = 0;
        this.lastError = null;
        this.#saveBrowser();
        const id = sock.user?.id;
        this.#setStatus('connected', {
          qr: null,
          me: { phone: jidToPhone(id), name: sock.user?.name || sock.user?.notify || '' },
        });
      }
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        const wasUp = this.status === 'connected' || this.status === 'qr';
        // 515 = o WhatsApp pede para reiniciar logo depois de ler o QR Code (normal).
        const normal = code === DisconnectReason.restartRequired;
        if (!normal && !wasUp) this.failures++;
        // 428 antes do QR Code: o WhatsApp recusou a identificação. Depois de 3 tentativas, usa a que sempre gera QR.
        if (code === 428 && !wasUp && !state.creds?.registered && this.failures >= 3) this.fallback = true;
        this.lastError = normal ? null : describeClose(code, lastDisconnect?.error?.message);
        const nowMs = Date.now();
        this.drops = this.drops.filter((t) => nowMs - t < 10 * 60_000);
        if (!normal && !loggedOut) this.drops.push(nowMs);
        if (!normal) this.emit('drop', { at: new Date(nowMs).toISOString(), code: code || null, reason: this.lastError || '', wasUp, recent: this.drops.length });
        // Vai reconectar sozinho: mostra "conectando" (âmbar) em vez de vermelho, para não ficar piscando a cada oscilação.
        this.#setStatus(!this.stopping && !loggedOut ? 'connecting' : 'disconnected', { qr: null, me: null });
        if (this.lastError && !loggedOut) this.emit('log', { type: 'error', message: `WhatsApp: ${this.lastError}` });
        // Sessão encerrada no celular, ou sessão salva que não abre mais (comum depois de "Desconectar"):
        // apaga a sessão antiga para gerar um QR Code novo.
        const stale = !state.creds?.registered || this.failures >= 3;
        if (loggedOut || (this.failures >= 2 && stale && [401, 403, 405, 411, 428, 440, 500].includes(code))) {
          this.#clearAuth();
          this.emit('log', { type: 'system', message: loggedOut ? 'Sessão encerrada no celular. Escaneie o QR Code novamente.' : 'Sessão antiga do WhatsApp apagada para gerar um QR Code novo.' });
        }
        if (!this.stopping) {
          // Reconecta sozinho; se continuar caindo, espera mais (o WhatsApp bloqueia tentativas seguidas).
          const wait = reconnectDelay({ failures: this.failures, recentDrops: this.drops.length, loggedOut, normal });
          await sleep(wait);
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

  /**
   * Como o sistema se apresenta ao WhatsApp. Sessões já conectadas mantêm a identificação com que foram pareadas;
   * pareamentos novos usam Windows Desktop (o macOS Desktop passou a ser recusado com 428 antes do QR Code).
   */
  #browser(registered) {
    if (registered) {
      try {
        const saved = JSON.parse(fs.readFileSync(path.join(this.authDir, 'browser.json'), 'utf8'));
        if (Array.isArray(saved) && saved.length === 3) return saved;
      } catch { /* sessão antiga, pareada como macOS Desktop */ }
      return Browsers.macOS('Desktop');
    }
    // Plano B: identificação de navegador (sempre gera QR; o celular manda menos histórico).
    return this.fallback ? Browsers.windows('Chrome') : Browsers.windows('Desktop');
  }

  #saveBrowser() {
    try {
      const file = path.join(this.authDir, 'browser.json');
      if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(this.currentBrowser));
    } catch { /* não é essencial */ }
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
  async #simulateTyping(jid, text, typingMs) {
    try {
      await this.sock.presenceSubscribe(jid);
      await this.sock.sendPresenceUpdate('composing', jid);
      const ms = typingMs ?? Math.min(6000, 800 + (text?.length || 0) * randomBetween(25, 45));
      await sleep(ms);
      await this.sock.sendPresenceUpdate('paused', jid);
    } catch {
      /* presença é opcional */
    }
  }

  /**
   * Envia uma mensagem. `media` é opcional: { path, mimetype, fileName }.
   */
  /** Marca as mensagens do cliente como lidas (os dois tracinhos azuis). */
  async markRead(jid, ids = []) {
    if (!this.sock || this.status !== 'connected' || !ids.length) return;
    try {
      await this.sock.readMessages(ids.filter(Boolean).map((id) => ({ remoteJid: jid, id, fromMe: false })));
    } catch {
      /* confirmação de leitura é opcional */
    }
  }

  /** `typingMs` define quanto tempo aparece "digitando…" (senão, calcula pelo tamanho do texto). */
  async send(to, { text = '', media = null, typing = true, typingMs } = {}) {
    this.#ensureConnected();
    const jid = await this.resolveJid(to);
    if (typing && typingMs !== 0) await this.#simulateTyping(jid, text, typingMs);

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
