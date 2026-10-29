// Cobrança por Pix no fechamento: gera o Pix (copia e cola + QR Code), confirma o
// pagamento (pelo administrador ou automaticamente pelo Mercado Pago), fecha a
// venda no CRM, manda o recibo em nome da empresa e avisa o dono.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { pixBrCode, simplePdf, valorPorExtenso } from './pix.js';

const money = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const err = (status, message) => Object.assign(new Error(message), { status });
const MP_API = () => process.env.MERCADOPAGO_API_URL || 'https://api.mercadopago.com';

export class Payments {
  /**
   * sendTo(chave da conversa, { text, media }) envia pelo canal do cliente;
   * notifyAdmins(texto) avisa o dono no WhatsApp; secret assina os links de recibo.
   */
  constructor({ store, crm, dataDir, sendTo, notifyAdmins, notify, secret, fetchImpl = globalThis.fetch }) {
    this.store = store;
    this.crm = crm;
    this.dir = path.join(dataDir, 'payments');
    fs.mkdirSync(this.dir, { recursive: true });
    this.sendTo = sendTo;
    this.notifyAdmins = notifyAdmins || (async () => {});
    this.notify = notify || (() => {});
    this.secret = secret;
    this.fetch = fetchImpl;
    store.data.payments ||= [];
  }

  get config() {
    return this.store.settings.payments || {};
  }

  get list() {
    return this.store.data.payments;
  }

  get(id) {
    return this.list.find((p) => p.id === id) || null;
  }

  /** Valor da reserva pela regra cadastrada (ex.: R$ 1.000 + R$ 800 por adulto). */
  reservationAmount(adults = 1) {
    const r = this.config.reservation || {};
    return Number(r.base || 0) + Number(r.perAdult || 0) * Math.max(1, Number(adults) || 1);
  }

  receiptToken(id) {
    return crypto.createHmac('sha256', this.secret).update(`recibo:${id}`).digest('base64url').slice(0, 22);
  }

  receiptUrl(p) {
    const base = String(this.store.settings.crm?.panelUrl || process.env.PUBLIC_URL || '').replace(/\/+$/, '');
    return base ? `${base}/recibo/${p.id}?t=${this.receiptToken(p.id)}` : '';
  }

  /** Cria a cobrança. Devolve o registro (com o copia e cola em p.brcode). */
  async create({ convKey = null, leadId = null, amount, description, payerName = '', payerDoc = '', by = 'IA' }) {
    const c = this.config;
    if (c.enabled === false) throw err(400, 'Pagamentos por Pix estão desligados (Configurações → Pagamentos)');
    const value = Math.round(Number(amount) * 100) / 100;
    if (!(value > 0)) throw err(400, 'Valor inválido');
    const id = crypto.randomBytes(6).toString('hex');
    const txid = `MIG${id}`.toUpperCase().slice(0, 25);
    const p = {
      id,
      txid,
      leadId,
      convKey,
      amount: value,
      description: String(description || c.reservation?.description || 'Reserva').trim(),
      payerName: String(payerName || '').trim(),
      payerDoc: String(payerDoc || '').trim(),
      status: 'pending',
      provider: c.provider === 'mercadopago' && c.mercadopago?.accessToken ? 'mercadopago' : 'pix',
      createdAt: new Date().toISOString(),
      createdBy: by,
    };
    if (p.provider === 'mercadopago') {
      const order = await this.#mpCreate(p);
      p.mpOrderId = order.id;
      const pay = order.transactions?.payments?.[0]?.payment_method || {};
      p.brcode = pay.qr_code;
      p.ticketUrl = pay.ticket_url || '';
      if (pay.qr_code_base64) fs.writeFileSync(this.qrPath(p), Buffer.from(pay.qr_code_base64, 'base64'));
    } else {
      p.brcode = pixBrCode({ key: c.pixKey, name: c.receiverName || c.company?.name, city: c.receiverCity, amount: value, txid });
    }
    if (!p.brcode) throw err(502, 'Não foi possível gerar o Pix');
    if (!fs.existsSync(this.qrPath(p))) await QRCode.toFile(this.qrPath(p), p.brcode, { width: 480, margin: 2 });
    this.list.push(p);
    this.store.save();
    if (leadId) this.crm.addNote({ name: by, role: 'admin' }, leadId, `Pix gerado: ${money(value)} (${p.description})`);
    this.notify('payment', { id: p.id, status: p.status });
    return p;
  }

  qrPath(p) {
    return path.join(this.dir, `${p.id}.png`);
  }

  receiptPath(p) {
    return path.join(this.dir, `recibo-${p.id}.pdf`);
  }

  /** Envia o QR Code e o copia e cola para o cliente (o código vai sozinho numa mensagem, fácil de copiar). */
  async sendCharge(p) {
    if (!p.convKey) return;
    const ig = String(p.convKey).startsWith('ig:');
    if (!ig) {
      await this.sendTo(p.convKey, { text: `QR Code do Pix · ${money(p.amount)} · ${p.description}`, media: { path: this.qrPath(p), mimetype: 'image/png', fileName: 'pix.png' } });
    }
    await this.sendTo(p.convKey, { text: p.brcode });
  }

  /** Pagamento confirmado: fecha a venda, gera e envia o recibo e avisa o dono. */
  async confirm(id, { by = 'Administrador', userId = null } = {}) {
    const p = this.get(id);
    if (!p) throw err(404, 'Cobrança não encontrada');
    if (p.status === 'paid') return p;
    if (p.status === 'canceled') throw err(400, 'Esta cobrança foi cancelada');
    this.store.data.receiptSeq = (this.store.data.receiptSeq || 0) + 1;
    Object.assign(p, { status: 'paid', paidAt: new Date().toISOString(), confirmedBy: by, receiptNo: this.store.data.receiptSeq });
    fs.writeFileSync(this.receiptPath(p), this.receiptPdf(p));
    this.store.save();

    const lead = p.leadId ? this.crm.leads.find((l) => l.id === p.leadId) : null;
    if (lead) {
      const sys = { name: by, role: 'admin', id: userId };
      if (lead.stage !== 'ganho') this.crm.update(sys, lead.id, { stage: 'ganho', closedValue: lead.value || p.amount });
      this.crm.addNote(sys, lead.id, `✅ Pix confirmado: ${money(p.amount)} · recibo nº ${String(p.receiptNo).padStart(4, '0')}`);
    }

    // Recibo para o cliente.
    if (p.convKey) {
      const url = this.receiptUrl(p);
      const text = `✅ Pagamento confirmado! Recebemos ${money(p.amount)} referente a ${p.description}. Segue o seu recibo.${url && String(p.convKey).startsWith('ig:') ? `\n${url}` : ''}`;
      try {
        if (String(p.convKey).startsWith('ig:')) await this.sendTo(p.convKey, { text });
        else await this.sendTo(p.convKey, { text, media: { path: this.receiptPath(p), mimetype: 'application/pdf', fileName: `Recibo-${String(p.receiptNo).padStart(4, '0')}.pdf` } });
        p.receiptSentAt = new Date().toISOString();
        this.store.save();
      } catch (e) {
        this.store.addLog({ type: 'error', message: `Recibo não enviado ao cliente: ${e.message}` });
      }
    }

    // Aviso para o dono.
    const owner = lead?.ownerId ? this.crm.ownerName(lead.ownerId) : '';
    const q = lead?.qualification || {};
    const notice = [
      '💰 *Venda fechada! Pix confirmado*',
      `👤 ${p.payerName || lead?.name || 'Cliente'}${lead?.phone ? ` · +${lead.phone}` : lead?.instagram ? ` · @${lead.instagram}` : ''}`,
      `💵 ${money(p.amount)} · ${p.description}`,
      lead?.interest ? `📦 ${lead.interest}${lead.people > 1 ? ` · ${lead.people} pessoas` : ''}${lead.value ? ` · total ${money(lead.value)}` : ''}` : '',
      owner ? `🧑‍💼 Vendedor: ${owner}` : '',
      lead?.adTitle ? `📣 Veio do anúncio: ${lead.adTitle}` : '',
      q.temperature ? `🌡️ Peneira: ${q.temperature}${q.start ? ` · quer iniciar ${q.start}` : ''}` : '',
      lead?.aiSummary ? `📝 ${lead.aiSummary}` : '',
      `🧾 Recibo nº ${String(p.receiptNo).padStart(4, '0')} ${p.receiptSentAt ? 'enviado ao cliente' : 'gerado'} · confirmado por ${by}`,
    ].filter(Boolean).join('\n');
    await this.notifyAdmins(notice).catch((e) => this.store.addLog({ type: 'error', message: `Aviso de pagamento: ${e.message}` }));
    this.store.addLog({ type: 'system', message: `💰 Pix confirmado: ${money(p.amount)} de ${p.payerName || lead?.name || 'cliente'} (por ${by})` });
    this.notify('paymentPaid', { id: p.id, amount: p.amount, name: p.payerName || lead?.name || '', description: p.description });
    return p;
  }

  cancel(id) {
    const p = this.get(id);
    if (!p) throw err(404, 'Cobrança não encontrada');
    if (p.status === 'paid') throw err(400, 'Esta cobrança já foi paga');
    p.status = 'canceled';
    this.store.save();
    this.notify('payment', { id, status: p.status });
    return p;
  }

  /** O cliente disse que pagou: avisa o dono para conferir no banco (não confirma sozinho). */
  async clientClaimsPaid(convKey, note = '') {
    const p = [...this.list].reverse().find((x) => x.convKey === convKey && x.status === 'pending');
    if (!p) return { ok: false, mensagem: 'Não há Pix pendente para este cliente.' };
    p.claimedAt = new Date().toISOString();
    this.store.save();
    const lead = p.leadId ? this.crm.leads.find((l) => l.id === p.leadId) : null;
    if (p.provider !== 'mercadopago') {
      await this.notifyAdmins(`🔔 *Cliente avisou que pagou o Pix*\n👤 ${p.payerName || lead?.name || 'Cliente'}\n💵 ${money(p.amount)} · ${p.description}${note ? `\n📝 ${note}` : ''}\n\nConfira no banco e confirme no painel (Pagamentos → Confirmar). O recibo sai automático.`).catch(() => {});
    }
    this.notify('payment', { id: p.id, status: p.status, claimed: true });
    return { ok: true, automatico: p.provider === 'mercadopago' };
  }

  // ---------- Mercado Pago (confirmação automática) ----------
  async #mp(method, url, body, idem) {
    const res = await this.fetch(`${MP_API()}${url}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.mercadopago.accessToken}`,
        'Content-Type': 'application/json',
        ...(idem ? { 'X-Idempotency-Key': idem } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw err(502, `Mercado Pago: ${data.message || data.errors?.[0]?.message || `HTTP ${res.status}`}`);
    return data;
  }

  #mpCreate(p) {
    return this.#mp('POST', '/v1/orders', {
      type: 'online',
      external_reference: p.txid,
      total_amount: p.amount.toFixed(2),
      processing_mode: 'automatic',
      transactions: { payments: [{ amount: p.amount.toFixed(2), payment_method: { id: 'pix', type: 'bank_transfer' }, expiration_time: 'P2D' }] },
      payer: { email: this.config.mercadopago.payerEmail || this.config.company?.email || 'cliente@migraparaguai.com' },
    }, crypto.randomUUID());
  }

  /** Confere no Mercado Pago as cobranças pendentes (chamado a cada minuto). */
  async checkPending() {
    if (!this.config.mercadopago?.accessToken) return 0;
    let paid = 0;
    for (const p of this.list.filter((x) => x.status === 'pending' && x.mpOrderId)) {
      try {
        const o = await this.#mp('GET', `/v1/orders/${p.mpOrderId}`);
        const pay = o.transactions?.payments?.[0] || {};
        if (o.status === 'processed' || pay.status === 'processed' || pay.status_detail === 'accredited') {
          await this.confirm(p.id, { by: 'Mercado Pago (automático)' });
          paid++;
        } else if (['expired', 'canceled', 'cancelled'].includes(o.status)) {
          p.status = 'canceled';
          this.store.save();
        }
      } catch (e) {
        this.store.addLog({ type: 'error', message: `Conferir Pix no Mercado Pago: ${e.message}` });
      }
    }
    return paid;
  }

  // ---------- Recibo ----------
  receiptPdf(p) {
    const c = this.config.company || {};
    const no = String(p.receiptNo || 0).padStart(4, '0');
    const paid = new Date(p.paidAt || Date.now());
    const when = paid.toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' });
    const company = c.name || this.config.receiverName || this.store.settings.business?.name || 'Empresa';
    const payer = p.payerName || this.crm.leads.find((l) => l.id === p.leadId)?.name || 'Cliente';
    return simplePdf([
      { text: company, size: 16, bold: true, gap: 0 },
      { text: [c.document && `CNPJ/CPF: ${c.document}`, c.address, [c.phone, c.email].filter(Boolean).join(' · ')].filter(Boolean).join('\n'), size: 9.5, gap: 4 },
      { text: `RECIBO Nº ${no}`, size: 20, bold: true, gap: 34 },
      { text: `Valor: ${money(p.amount)}`, size: 14, bold: true, gap: 10 },
      {
        text: `Recebemos de ${payer}${p.payerDoc ? ` (CPF/CNPJ ${p.payerDoc})` : ''} a importância de ${money(p.amount)} (${valorPorExtenso(p.amount)}), referente a ${p.description}.`,
        size: 12, gap: 22, wrap: 80,
      },
      { text: `Forma de pagamento: Pix${p.provider === 'mercadopago' ? ' (Mercado Pago)' : ''}\nIdentificador da transação: ${p.txid}\nData do pagamento: ${when}`, size: 11, gap: 16 },
      { text: `${this.config.receiverCity || ''}${this.config.receiverCity ? ', ' : ''}${paid.toLocaleDateString('pt-BR', { dateStyle: 'long' })}.`, size: 11, gap: 30 },
      { text: '______________________________________', size: 11, gap: 46 },
      { text: company, size: 11, bold: true, gap: 2 },
      { text: `Recibo emitido eletronicamente pelo ${this.store.settings.brand?.name || 'Migra Hub'}. Código de verificação: ${this.receiptToken(p.id).slice(0, 10).toUpperCase()}`, size: 8.5, gap: 60 },
    ]);
  }
}
