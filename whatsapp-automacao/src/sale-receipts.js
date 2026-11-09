// Recibo da PARCELA de uma venda/contrato: quando uma parcela é dada como recebida (pelo painel, pela Maria lendo o comprovante ou pelo Pix automático),
// o sistema emite o recibo em nome da empresa (PDF, número sequencial, mesmo padrão do recibo do Pix), guarda na parcela e envia ao cliente pelo WhatsApp.
// Regras: um recibo por recebimento; desfazer o recebimento ANULA o recibo (o número nunca é reaproveitado); a entrada paga pelo Pix já tem recibo próprio
// e não gera um segundo; sem WhatsApp do cliente, o recibo fica guardado e o administrador é avisado para enviar.
import fs from 'node:fs';
import path from 'node:path';

const brl = (v) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dBr = (iso) => String(iso || '').slice(0, 10).split('-').reverse().join('/');

export class SaleReceipts {
  /** deps: store, sales, payments (usa o mesmo desenho de recibo e a mesma numeração), docOf(sale) → CPF, sendToClient(sale, { text, media }) → Promise<boolean>, notifyAdmins(text), now. */
  constructor({ store, sales, payments, docOf = () => '', sendToClient = async () => false, notifyAdmins = async () => {}, now = () => new Date() }) {
    Object.assign(this, { store, sales, payments, docOf, sendToClient, notifyAdmins, now });
    this.dir = path.join(payments.dir, 'parcelas');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  file(sale, index, no) { return path.join(this.dir, `recibo-${String(no).padStart(4, '0')}-${sale.id}-${index}.pdf`); }

  #label(no) { return String(no).padStart(4, '0'); }

  /** Emite o recibo da parcela (se ainda não existe um válido). Devolve o registro. */
  issue(saleId, index, { by = 'Sistema' } = {}) {
    const sale = this.sales.get(saleId);
    const p = sale?.parcels?.[Number(index)];
    if (!sale || !p) throw Object.assign(new Error('Parcela não encontrada'), { status: 404 });
    if (p.status !== 'pago') throw Object.assign(new Error('Esta parcela ainda não foi recebida: não há recibo para emitir'), { status: 400 });
    if (p.receipt && !p.receipt.voidedAt) return p.receipt;
    this.store.data.receiptSeq = (this.store.data.receiptSeq || 0) + 1;
    const no = this.store.data.receiptSeq;
    const pseudo = {
      id: `parcela-${sale.id}-${index}-${no}`, receiptNo: no, amount: p.value, paidAt: `${p.paidAt || this.now().toISOString().slice(0, 10)}T12:00:00`,
      description: `${p.label} do contrato ${sale.number}${sale.items?.length ? ` (${sale.items.map((i) => `${i.name}${i.qty > 1 ? ` × ${i.qty}` : ''}`).join(', ')})` : ''}`,
      payerName: sale.client?.nome || 'Cliente', payerDoc: this.docOf(sale) || '', methodLabel: p.method || 'Pix', reference: `${sale.number}-P${Number(index) + 1}`, confirmedBy: p.confirmedBy || by,
    };
    const buf = this.payments.receiptPdf(pseudo);
    const file = this.file(sale, index, no);
    fs.writeFileSync(file, buf, { mode: 0o600 });
    p.receipt = { no, file: path.basename(file), issuedAt: this.now().toISOString(), issuedBy: by, value: p.value, sentAt: null, sentError: '' };
    sale.history.push({ at: this.now().toISOString(), by: by?.name || by, text: `Recibo nº ${this.#label(no)} emitido: ${p.label} (${brl(p.value)})` });
    this.store.save();
    return p.receipt;
  }

  /** Envia ao cliente pelo WhatsApp. Sem como enviar, guarda o motivo e avisa o administrador (o recibo continua disponível no painel). */
  async send(saleId, index) {
    const sale = this.sales.get(saleId);
    const p = sale?.parcels?.[Number(index)];
    if (!p?.receipt || p.receipt.voidedAt) throw Object.assign(new Error('Emita o recibo antes de enviar'), { status: 400 });
    const r = p.receipt;
    if (r.viaPix) return { ok: true, receipt: r, note: 'A entrada paga pelo Pix já tem recibo próprio, enviado na confirmação.' };
    const text = `✅ Pagamento recebido! Recebemos ${brl(r.value)} referente à ${p.label} do seu contrato ${sale.number}. Segue o seu recibo nº ${this.#label(r.no)}. Obrigado!`;
    let ok = false; let why = '';
    try { ok = await this.sendToClient(sale, { text, media: { path: path.join(this.dir, r.file), mimetype: 'application/pdf', fileName: `Recibo-${this.#label(r.no)}.pdf` } }); if (!ok) why = 'o cliente não tem WhatsApp cadastrado ou o número está fora do ar'; } catch (e) { why = e.message; }
    if (ok) { r.sentAt = this.now().toISOString(); r.sentError = ''; sale.history.push({ at: r.sentAt, by: 'Sistema', text: `Recibo nº ${this.#label(r.no)} enviado ao cliente pelo WhatsApp` }); } else {
      r.sentError = String(why).slice(0, 200);
      await this.notifyAdmins(`🧾 Recibo nº ${this.#label(r.no)} gerado, mas NÃO foi enviado ao cliente (${r.sentError}).\n👤 ${sale.client?.nome || 'Cliente'} · ${sale.number} · ${p.label} · ${brl(r.value)}\nAbra Vendas e contratos para baixar o PDF ou reenviar.`).catch(() => {});
    }
    this.store.save();
    return { ok, receipt: r };
  }

  /** Emite e envia (usado automaticamente quando a parcela é recebida). */
  async issueAndSend(saleId, index, opts = {}) {
    const r = this.issue(saleId, index, opts);
    if (r.sentAt) return { ok: true, receipt: r };
    return this.send(saleId, index);
  }

  /** O recebimento foi desfeito: o recibo é anulado (o número fica registrado como anulado). */
  void(saleId, index, by = 'Sistema') {
    const sale = this.sales.get(saleId);
    const p = sale?.parcels?.[Number(index)];
    if (!p?.receipt || p.receipt.voidedAt) return null;
    p.receipt.voidedAt = this.now().toISOString(); p.receipt.voidedBy = by?.name || by;
    (p.receiptsVoided ||= []).push(p.receipt);
    sale.history.push({ at: p.receipt.voidedAt, by: by?.name || by, text: `Recibo nº ${this.#label(p.receipt.no)} anulado (recebimento desfeito)` });
    p.receipt = null;
    this.store.save();
    return true;
  }

  pdf(saleId, index) {
    const sale = this.sales.get(saleId);
    const r = sale?.parcels?.[Number(index)]?.receipt;
    if (!r || r.voidedAt) return null;
    const f = path.join(this.dir, r.file);
    return fs.existsSync(f) ? { buffer: fs.readFileSync(f), name: `Recibo-${this.#label(r.no)}.pdf` } : null;
  }
}
