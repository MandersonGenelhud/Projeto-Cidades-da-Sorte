// WhatsApp Cloud API (API oficial da Meta): envio via Graph API e recebimento via webhook.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { normalizePhone } from '../utils.js';

export class CloudApiClient extends EventEmitter {
  constructor({ getConfig, fetchImpl = globalThis.fetch }) {
    super();
    this.getConfig = getConfig; // () => { accessToken, phoneNumberId, verifyToken, appSecret, graphVersion }
    this.fetch = fetchImpl;
    this.status = 'disconnected';
    this.me = null;
    this.error = null;
    this.seen = new Set(); // ids já processados (a Meta reenvia em caso de timeout)
  }

  getState() {
    return { status: this.status, qr: null, me: this.me, error: this.error, mode: 'cloud' };
  }

  #setStatus(status, extra = {}) {
    this.status = status;
    Object.assign(this, extra);
    this.emit('status', this.getState());
  }

  get baseUrl() {
    const { graphVersion = 'v22.0', phoneNumberId } = this.getConfig();
    const host = process.env.WA_GRAPH_BASE_URL || 'https://graph.facebook.com';
    return `${host}/${graphVersion}/${phoneNumberId}`;
  }

  async #graph(url, { method = 'GET', body, form } = {}) {
    const { accessToken } = this.getConfig();
    const res = await this.fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: form || (body ? JSON.stringify(body) : undefined),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(`Meta: ${data.error?.message || `HTTP ${res.status}`}`);
    return data;
  }

  /** Valida o token e o ID do número consultando a Graph API. */
  async start() {
    const { accessToken, phoneNumberId } = this.getConfig();
    if (!accessToken || !phoneNumberId) {
      this.#setStatus('disconnected', { me: null, error: 'Preencha o token de acesso e o ID do número de telefone' });
      return;
    }
    this.#setStatus('connecting', { error: null });
    try {
      const info = await this.#graph(`${this.baseUrl}?fields=display_phone_number,verified_name`);
      this.#setStatus('connected', {
        me: { phone: normalizePhone(info.display_phone_number) || info.display_phone_number, name: info.verified_name || '' },
        error: null,
      });
    } catch (err) {
      this.#setStatus('disconnected', { me: null, error: err.message });
    }
  }

  async stop() {
    this.#setStatus('disconnected', { me: null });
  }

  async restart() {
    await this.start();
  }

  async logout() {
    await this.stop();
  }

  // ---------- Webhook ----------
  /** GET /webhook: verificação feita pela Meta ao cadastrar a URL. */
  verifyWebhook(query) {
    const { verifyToken } = this.getConfig();
    if (query['hub.mode'] === 'subscribe' && verifyToken && query['hub.verify_token'] === verifyToken) {
      return String(query['hub.challenge'] ?? '');
    }
    return null;
  }

  /** Confere a assinatura X-Hub-Signature-256 (se o App Secret estiver configurado). */
  checkSignature(rawBody, header) {
    const { appSecret } = this.getConfig();
    if (!appSecret) return true;
    if (!header || !rawBody) return false;
    const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
    const a = Buffer.from(expected);
    const b = Buffer.from(String(header));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /** POST /webhook: converte o payload da Meta em mensagens no formato interno. */
  handleWebhook(payload) {
    const out = [];
    for (const entry of payload?.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        const names = Object.fromEntries((value.contacts || []).map((c) => [c.wa_id, c.profile?.name || '']));
        for (const m of value.messages || []) {
          if (this.seen.has(m.id)) continue;
          this.seen.add(m.id);
          if (this.seen.size > 5000) this.seen.delete(this.seen.values().next().value);
          const text =
            m.text?.body ||
            m.interactive?.button_reply?.title ||
            m.interactive?.list_reply?.title ||
            m.button?.text ||
            m.image?.caption ||
            m.video?.caption ||
            m.document?.caption ||
            '';
          const msg = {
            id: m.id,
            jid: m.from,
            isGroup: false,
            phone: m.from,
            name: names[m.from] || '',
            text,
            type: m.type,
            timestamp: Number(m.timestamp) * 1000 || Date.now(),
          };
          out.push(msg);
          this.emit('message', msg);
          this.markRead(m.id).catch(() => {});
        }
      }
    }
    return out;
  }

  async markRead(messageId) {
    if (this.status !== 'connected') return;
    await this.#graph(`${this.baseUrl}/messages`, {
      method: 'POST',
      body: { messaging_product: 'whatsapp', status: 'read', message_id: messageId },
    });
  }

  // ---------- Envio ----------
  async resolveJid(to) {
    const phone = normalizePhone(to) || String(to).replace(/\D/g, '');
    if (!phone) throw new Error(`Número inválido: ${to}`);
    return phone;
  }

  async checkNumber(phone) {
    // A Cloud API não tem consulta de número; valida só o formato.
    const p = normalizePhone(phone);
    return p ? { exists: true, jid: p, note: 'A API oficial não permite verificar se o número tem WhatsApp' } : { exists: false, error: 'Número inválido' };
  }

  async #uploadMedia(media) {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', media.mimetype);
    form.append('file', new Blob([fs.readFileSync(media.path)], { type: media.mimetype }), media.fileName || path.basename(media.path));
    const data = await this.#graph(`${this.baseUrl}/media`, { method: 'POST', form });
    return data.id;
  }

  async send(to, { text = '', media = null } = {}) {
    if (this.status !== 'connected') throw new Error('API oficial da Meta não está conectada');
    const phone = await this.resolveJid(to);
    let body;
    if (media?.path) {
      const id = await this.#uploadMedia(media);
      const mt = media.mimetype || '';
      const kind = mt.startsWith('image/') ? 'image' : mt.startsWith('video/') ? 'video' : mt.startsWith('audio/') ? 'audio' : 'document';
      const obj = { id };
      if (text && kind !== 'audio') obj.caption = text;
      if (kind === 'document') obj.filename = media.fileName || path.basename(media.path);
      body = { messaging_product: 'whatsapp', to: phone, type: kind, [kind]: obj };
    } else {
      if (!text) throw new Error('Mensagem vazia');
      body = { messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: text, preview_url: true } };
    }
    const data = await this.#graph(`${this.baseUrl}/messages`, { method: 'POST', body });
    if (media?.mimetype?.startsWith('audio/') && text) {
      await this.#graph(`${this.baseUrl}/messages`, {
        method: 'POST',
        body: { messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: text } },
      });
    }
    return { id: data.messages?.[0]?.id, jid: phone };
  }

  async getGroups() {
    throw new Error('A API oficial da Meta não dá acesso a grupos. Use a conexão por QR Code.');
  }

  async getGroupParticipants() {
    return this.getGroups();
  }
}
