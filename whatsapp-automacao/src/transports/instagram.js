// Instagram Direct pela API oficial (Instagram API com login do Instagram).
// Recebe mensagens por webhook e responde pela Graph API do Instagram.
// As conversas usam a chave "ig:<IGSID>" para não se misturarem com o WhatsApp.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

export const IG_PREFIX = 'ig:';
const MAX_BYTES = 1000; // limite do Instagram por mensagem

/** Divide textos longos em partes de até 1000 bytes, preferindo quebrar entre frases. */
export function splitForInstagram(text, maxBytes = MAX_BYTES) {
  const parts = [];
  let rest = String(text || '').trim();
  const bytes = (s) => Buffer.byteLength(s, 'utf8');
  while (rest && bytes(rest) > maxBytes) {
    let cut = rest.length;
    while (cut > 0 && bytes(rest.slice(0, cut)) > maxBytes) cut--;
    const window = rest.slice(0, cut);
    const nice = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '));
    const at = nice > cut * 0.4 ? nice + 1 : window.lastIndexOf(' ') > 0 ? window.lastIndexOf(' ') : cut;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

export class InstagramClient extends EventEmitter {
  constructor({ getConfig, onTokenRefreshed, fetchImpl = globalThis.fetch }) {
    super();
    this.getConfig = getConfig; // () => { enabled, accessToken, verifyToken, appSecret, graphVersion }
    this.onTokenRefreshed = onTokenRefreshed || (() => {});
    this.fetch = fetchImpl;
    this.status = 'disconnected';
    this.me = null;
    this.error = null;
    this.seen = new Set();
    this.sentIds = new Set();
    this.recentSends = []; // { to, text, at } para reconhecer o eco das nossas mensagens
    this.names = new Map();
    this.refreshTimer = null;
  }

  getState() {
    return { status: this.status, me: this.me, error: this.error };
  }

  #setStatus(status, extra = {}) {
    this.status = status;
    Object.assign(this, extra);
    this.emit('status', this.getState());
  }

  get base() {
    const host = process.env.IG_GRAPH_BASE_URL || 'https://graph.instagram.com';
    return `${host}/${this.getConfig().graphVersion || 'v25.0'}`;
  }

  async #graph(path, { method = 'GET', body } = {}) {
    const { accessToken } = this.getConfig();
    const res = await this.fetch(`${this.base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(`Instagram: ${data.error?.message || `HTTP ${res.status}`}`);
    return data;
  }

  /** Confere o token e descobre a conta profissional conectada. */
  async start() {
    const cfg = this.getConfig();
    clearInterval(this.refreshTimer);
    if (!cfg.enabled) {
      this.#setStatus('disconnected', { me: null, error: null });
      return;
    }
    if (!cfg.accessToken) {
      this.#setStatus('disconnected', { me: null, error: 'Cole o token de acesso do Instagram' });
      return;
    }
    this.#setStatus('connecting', { error: null });
    try {
      const me = await this.#graph('/me?fields=user_id,username,name');
      this.#setStatus('connected', { me: { id: String(me.user_id || me.id), username: me.username, name: me.name || '' }, error: null });
      // O token de longa duração vale 60 dias; renova uma vez por dia para não expirar.
      this.refreshTimer = setInterval(() => this.refreshToken().catch(() => {}), 24 * 3600 * 1000);
      this.refreshTimer.unref?.();
    } catch (err) {
      this.#setStatus('disconnected', { me: null, error: err.message });
    }
  }

  async stop() {
    clearInterval(this.refreshTimer);
    this.#setStatus('disconnected', { me: null });
  }

  async refreshToken() {
    const { accessToken } = this.getConfig();
    const host = process.env.IG_GRAPH_BASE_URL || 'https://graph.instagram.com';
    const res = await this.fetch(`${host}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(accessToken)}`);
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.access_token) this.onTokenRefreshed(data.access_token);
    return data;
  }

  // ---------- Webhook ----------
  verifyWebhook(query) {
    const { verifyToken } = this.getConfig();
    if (query['hub.mode'] === 'subscribe' && verifyToken && query['hub.verify_token'] === verifyToken) {
      return String(query['hub.challenge'] ?? '');
    }
    return null;
  }

  checkSignature(rawBody, header) {
    const { appSecret } = this.getConfig();
    if (!appSecret) return true;
    if (!header || !rawBody) return false;
    const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
    const a = Buffer.from(expected);
    const b = Buffer.from(String(header));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /** Converte o payload do Instagram em mensagens no formato interno. */
  async handleWebhook(payload) {
    if (payload?.object !== 'instagram') return [];
    const out = [];
    const myId = this.me?.id;
    for (const entry of payload.entry || []) {
      for (const ev of entry.messaging || []) {
        const m = ev.message;
        if (!m?.mid || m.is_deleted || this.seen.has(m.mid)) continue;
        this.seen.add(m.mid);
        if (this.seen.size > 5000) this.seen.delete(this.seen.values().next().value);
        const text = m.text || (m.attachments?.length ? '[o cliente enviou um anexo]' : '');
        const timestamp = Number(ev.timestamp) || Date.now();

        if (m.is_echo || (myId && String(ev.sender?.id) === myId)) {
          // Mensagem enviada pela conta: nossa (ignora) ou do dono pelo app (pausa o agente).
          const customer = String(ev.recipient?.id);
          if (this.#isOurEcho(m.mid, customer, text)) continue;
          const msg = { id: m.mid, jid: `${IG_PREFIX}${customer}`, channel: 'instagram', isGroup: false, phone: null, text, timestamp };
          this.emit('ownerMessage', msg);
          continue;
        }
        if (m.is_self) continue;

        const igsid = String(ev.sender?.id);
        const profile = await this.#profile(igsid);
        const msg = {
          id: m.mid,
          jid: `${IG_PREFIX}${igsid}`,
          channel: 'instagram',
          isGroup: false,
          phone: null,
          username: profile.username || '',
          name: profile.name || (profile.username ? `@${profile.username}` : ''),
          text,
          timestamp,
        };
        out.push(msg);
        this.emit('message', msg);
      }
    }
    return out;
  }

  #isOurEcho(mid, to, text) {
    if (this.sentIds.has(mid)) return true;
    const now = Date.now();
    this.recentSends = this.recentSends.filter((s) => now - s.at < 120_000);
    return this.recentSends.some((s) => s.to === to && s.text === text);
  }

  async #profile(igsid) {
    if (this.names.has(igsid)) return this.names.get(igsid);
    let profile = {};
    try {
      profile = await this.#graph(`/${igsid}?fields=name,username`);
    } catch {
      profile = {};
    }
    this.names.set(igsid, profile);
    return profile;
  }

  // ---------- Envio ----------
  async send(to, { text = '' } = {}) {
    if (this.status !== 'connected') throw new Error('Instagram não está conectado');
    const igsid = String(to).replace(IG_PREFIX, '');
    if (!text) throw new Error('Mensagem vazia (no Instagram o agente envia só texto)');
    let last;
    for (const part of splitForInstagram(text)) {
      this.recentSends.push({ to: igsid, text: part, at: Date.now() });
      last = await this.#graph(`/${this.me.id}/messages`, {
        method: 'POST',
        body: { recipient: { id: igsid }, message: { text: part } },
      });
      if (last?.message_id) this.sentIds.add(last.message_id);
    }
    return { id: last?.message_id, jid: `${IG_PREFIX}${igsid}` };
  }
}
