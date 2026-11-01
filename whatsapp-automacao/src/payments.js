// Cobrança por Pix no fechamento: gera o Pix (copia e cola + QR Code), confirma o
// pagamento (pelo administrador ou automaticamente pelo Mercado Pago), fecha a
// venda no CRM, manda o recibo em nome da empresa e avisa o dono.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { fileURLToPath } from 'node:url';
import { pixBrCode, valorPorExtenso } from './pix.js';
import { PdfCanvas, PAGE } from './pdfdoc.js';

const LOGO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'img', 'migra-logo-escuro.jpg');
const RC = { green: '#0B2A1E', gold: '#D4AF37', ink: '#1d1d1f', gray: '#5f6368', line: '#d9dedb', soft: '#F4F7F5' };
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
    // Pix comum (sem confirmação automática do banco): o comprovante enviado na conversa é lido e dá a baixa.
    const ask = p.provider !== 'mercadopago' && this.config.autoReceipt !== false
      ? '\n\nDepois de pagar, me envie o comprovante aqui na conversa (foto, print ou PDF): eu abro, confiro e confirmo o seu pagamento na hora. 🧾' : '';
    if (!ig) {
      await this.sendTo(p.convKey, { text: `QR Code do Pix · ${money(p.amount)} · ${p.description}${ask}`, media: { path: this.qrPath(p), mimetype: 'image/png', fileName: 'pix.png' } });
    }
    await this.sendTo(p.convKey, { text: ig ? `${p.brcode}${ask}` : p.brcode });
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
      // Mentoria não é venda de pacote: não fecha o prospecto (nem gera ranking ou comissão de parceiro).
      if (lead.stage !== 'ganho' && !p.purpose) this.crm.update(sys, lead.id, { stage: 'ganho', closedValue: lead.value || p.amount });
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
      p.purpose === 'mentoria' ? '🎓 *Mentoria paga! Pix confirmado*' : p.purpose === 'visita' ? '💳 *Taxa de assessoria presencial paga* (estornar se fechar)' : '💰 *Venda fechada! Pix confirmado*',
      `👤 ${p.payerName || lead?.name || 'Cliente'}${lead?.phone ? ` · +${lead.phone}` : lead?.instagram ? ` · @${lead.instagram}` : ''}`,
      `💵 ${money(p.amount)} · ${p.description}`,
      lead?.interest ? `📦 ${lead.interest}${lead.people > 1 ? ` · ${lead.people} pessoas` : ''}${lead.value ? ` · total ${money(lead.value)}` : ''}` : '',
      owner ? `🧑‍💼 Vendedor: ${owner}` : '',
      lead?.adTitle ? `📣 Veio do anúncio: ${lead.adTitle}` : '',
      q.temperature ? `🌡️ Peneira: ${q.temperature}${q.start ? ` · quer iniciar ${q.start}` : ''}` : '',
      lead?.aiSummary ? `📝 ${lead.aiSummary}` : '',
      `🧾 Recibo nº ${String(p.receiptNo).padStart(4, '0')} ${p.receiptSentAt ? 'enviado ao cliente' : 'gerado'} · confirmado por ${by}`,
      p.receipt?.auto ? `🔎 Confirmado pela LEITURA DO COMPROVANTE enviado pelo cliente (transação ${p.receipt.ref}), não pelo extrato. Dê uma conferida no banco; o comprovante está guardado no painel.` : '',
    ].filter(Boolean).join('\n');
    await this.notifyAdmins(notice).catch((e) => this.store.addLog({ type: 'error', message: `Aviso de pagamento: ${e.message}` }));
    this.store.addLog({ type: 'system', message: `💰 Pix confirmado: ${money(p.amount)} de ${p.payerName || lead?.name || 'cliente'} (por ${by})` });
    this.notify('paymentPaid', { id: p.id, amount: p.amount, name: p.payerName || lead?.name || '', description: p.description });
    // Próximo passo do fechamento (ex.: termo da reserva depois do pagamento).
    await Promise.resolve(this.onPaid?.(p)).catch((e) => this.store.addLog({ type: 'error', message: `Depois do pagamento: ${e.message}` }));
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
  /** Recibo no mesmo padrão visual do contrato: faixa verde com a logo, filete dourado, marca d'água e selo de pago. */
  receiptPdf(p) {
    const cfg = this.config.company || {};
    const no = String(p.receiptNo || 0).padStart(4, '0');
    const paid = new Date(p.paidAt || Date.now());
    const when = paid.toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
    const day = paid.toLocaleDateString('pt-BR', { dateStyle: 'long', timeZone: 'America/Sao_Paulo' });
    const company = cfg.name || this.config.receiverName || this.store.settings.business?.name || 'Empresa';
    const payer = p.payerName || this.crm.leads.find((l) => l.id === p.leadId)?.name || 'Cliente';
    const code = this.receiptToken(p.id).slice(0, 10).toUpperCase();
    const c = new PdfCanvas();
    const W = PAGE.W;
    const M = 50;
    const maxW = W - 2 * M;
    let logo = null;
    try { logo = fs.readFileSync(LOGO); } catch { /* sem logo: só o nome */ }

    c.watermark('MIGRA PARAGUAI');
    c.rect(0, 0, W, 96, { fill: RC.green });
    c.rect(0, 96, W, 3, { fill: RC.gold });
    if (logo) c.image(logo, M - 6, 16, 150);
    else c.text('MIGRA PARAGUAI', M, 36, { size: 18, bold: true, color: '#fff' });
    c.text(`RECIBO Nº ${no}`, W - M, 26, { size: 15, bold: true, color: RC.gold, align: 'right' });
    c.text(`Emitido em ${day}`, W - M, 48, { size: 9, color: '#cfe0d7', align: 'right' });
    c.text('Comprovante oficial de recebimento', W - M, 63, { size: 8, bold: true, color: '#ffe8a3', align: 'right' });

    let y = 128;
    c.text('RECIBO DE PAGAMENTO', W / 2, y, { size: 17, bold: true, color: RC.ink, align: 'center', spacing: 1 });
    y += 38;

    // Cartão do valor
    c.rect(M, y, maxW, 92, { fill: RC.soft, radius: 8 });
    c.rect(M, y, 6, 92, { fill: RC.gold });
    c.text('VALOR RECEBIDO', M + 26, y + 16, { size: 8.5, bold: true, color: RC.gray, spacing: 1.2 });
    c.text(money(p.amount), M + 26, y + 32, { size: 30, bold: true, color: RC.green });
    const ext = String(valorPorExtenso(p.amount));
    c.para(`(${ext})`, M + 26, y + 70, maxW - 190, { size: 9, color: RC.gray });
    // Selo de pago
    c.rect(W - M - 124, y + 22, 100, 46, { stroke: RC.green, radius: 8, lineWidth: 2 });
    c.text('PAGO', W - M - 74, y + 32, { size: 20, bold: true, color: RC.green, align: 'center', spacing: 2 });
    c.text('Pix confirmado', W - M - 74, y + 54, { size: 7.5, color: RC.gray, align: 'center' });
    y += 120;

    // Texto do recibo
    const body = `Recebemos de ${payer.toUpperCase()}${p.payerDoc ? `, CPF/CNPJ ${p.payerDoc},` : ''} a importância de ${money(p.amount)} (${ext}), referente a ${p.description}.`;
    for (const line of c.lines(body, maxW, { size: 11 })) {
      c.text(line, M, y, { size: 11, color: RC.ink });
      y += 17;
    }
    y += 12;

    // Detalhes do pagamento
    const rows = [
      ['Forma de pagamento', `Pix${p.provider === 'mercadopago' ? ' (Mercado Pago)' : ''}`],
      ['Data e hora do pagamento', when],
      ['Identificador da transação', p.txid],
      ['Situação', 'Pago e confirmado'],
    ];
    c.text('DETALHES DO PAGAMENTO', M, y, { size: 9, bold: true, color: RC.green, spacing: 0.8 });
    y += 16;
    c.rect(M, y - 4, maxW, 0.8, { fill: RC.gold });
    for (const [k, v] of rows) {
      y += 6;
      c.text(k, M + 6, y, { size: 9.5, color: RC.gray });
      c.text(String(v), W - M - 6, y, { size: 9.5, bold: true, color: RC.ink, align: 'right' });
      y += 15;
      c.rect(M, y, maxW, 0.5, { fill: RC.line });
    }
    y += 18;

    // Observação conforme o tipo da cobrança
    const note = p.purpose === 'visita'
      ? 'Taxa de reserva do atendimento presencial com a assessoria. Se você fechar com a Migra, este valor é estornado integralmente.'
      : p.purpose === 'mentoria' ? 'Mentoria com o Marcos Miguel. Este valor não é reembolsável.' : '';
    if (note) {
      const lines = c.lines(note, maxW - 28, { size: 9 });
      const h = lines.length * 13 + 16;
      c.rect(M, y, maxW, h, { fill: '#FFF8E1', radius: 6 });
      lines.forEach((l, i) => c.text(l, M + 14, y + 9 + i * 13, { size: 9, color: '#6b5300' }));
      y += h + 16;
    }

    // Emitente e assinatura
    y = Math.max(y + 10, 560);
    c.text(`${this.config.receiverCity ? `${this.config.receiverCity}, ` : ''}${day}.`, M, y, { size: 10.5, color: RC.ink });
    y += 54;
    c.rect(M, y, 230, 0.8, { fill: RC.ink });
    c.text(company, M, y + 7, { size: 10.5, bold: true, color: RC.ink });
    c.text([cfg.document && `CNPJ/CPF ${cfg.document}`, 'Assinado eletronicamente'].filter(Boolean).join(' · '), M, y + 22, { size: 8.5, color: RC.gray });

    // Rodapé
    const fy = PAGE.H - 70;
    c.rect(0, fy, W, 2, { fill: RC.gold });
    c.rect(0, fy + 2, W, 68, { fill: RC.green });
    const contact = [cfg.address, [cfg.phone, cfg.email].filter(Boolean).join(' · ')].filter(Boolean).join('  |  ');
    if (contact) c.text(contact.slice(0, 120), W / 2, fy + 14, { size: 7.8, color: '#cfe0d7', align: 'center' });
    c.text(`Recibo emitido eletronicamente pelo ${this.store.settings.brand?.name || 'Migra Hub'}  ·  Código de verificação ${code}`, W / 2, fy + 32, { size: 7.8, bold: true, color: RC.gold, align: 'center' });
    return c.toBuffer();
  }
}
