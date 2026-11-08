// "Dados para o orçamento": quando o cliente pede um orçamento (ou a atendente vai mandar um), ele recebe um link curto para preencher os dados básicos
// (nome, WhatsApp, quantos adultos, e-mail se quiser). Preenchendo, o sistema ELABORA o orçamento e entrega em PDF. Depois vem o convite para dar entrada
// na reserva (ficha completa → documento para assinar → Pix). Cada pedido vale uma vez só: reenviar o link não cria um segundo orçamento.
import crypto from 'node:crypto';
import { normalizePhone } from './utils.js';

const err = (status, message) => Object.assign(new Error(message), { status });
const clean = (s, n = 120) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const DAY = 86_400_000;

export class QuoteRequests {
  /** deps: store, secret, baseUrl() → endereço público, onFilled(rec) → cria e entrega o orçamento. */
  constructor({ store, secret, baseUrl = () => '', onFilled = async () => {}, now = () => Date.now() }) {
    Object.assign(this, { store, secret, baseUrl, onFilled, now });
    store.data.quoteRequests ||= [];
  }

  get list() { return this.store.data.quoteRequests; }

  token(id) { return crypto.createHmac('sha256', this.secret).update(`orcdados:${id}`).digest('base64url').slice(0, 20); }

  url(rec) { const b = String(this.baseUrl() || '').replace(/\/+$/, ''); return b ? `${b}/orcamento-dados/${rec.id}?t=${this.token(rec.id)}` : ''; }

  #auth(id, t) {
    const rec = this.list.find((r) => r.id === id);
    const good = rec ? this.token(rec.id) : '';
    const ok = rec && typeof t === 'string' && t.length === good.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(good));
    if (!ok) throw err(404, 'Link inválido. Peça um novo link no WhatsApp.');
    return rec;
  }

  /** Pedido em aberto desta conversa (últimas 48 h), se houver. */
  openFor(convKey) { return this.list.find((r) => r.convKey === convKey && r.status === 'enviado' && this.now() - Date.parse(r.createdAt) < 2 * DAY) || null; }

  /** Cria o pedido (ou atualiza o que já está em aberto com o pacote mais recente). items = [{ pacote, quantidade }]. */
  create({ convKey, leadId = null, items = [], adults = null, name = '', phone = '', consultant = '' }) {
    let rec = this.openFor(convKey);
    if (!rec) {
      rec = { id: crypto.randomBytes(6).toString('hex'), convKey, leadId, status: 'enviado', createdAt: new Date(this.now()).toISOString(), data: {} };
      this.list.push(rec);
    }
    Object.assign(rec, { items, consultant, leadId: leadId || rec.leadId });
    const placeholder = (n) => !n || /^@|^\+?\d+$|^cliente$/i.test(String(n).trim());
    if (!rec.data.nome && !placeholder(name)) rec.data.nome = clean(name, 100);
    if (!rec.data.whatsapp) rec.data.whatsapp = phone ? `+${String(phone).replace(/\D/g, '')}` : '+55 ';
    if (!rec.data.adultos && adults) rec.data.adultos = String(adults);
    this.store.save();
    return rec;
  }

  /** O que a página mostra. */
  view(id, t) {
    const rec = this.#auth(id, t);
    return { status: rec.status, data: rec.data, company: this.store.settings.payments?.company?.name || this.store.settings.business?.name || 'Migra' };
  }

  /** O cliente enviou os dados: valida, grava e manda elaborar o orçamento (uma vez só). */
  async submit(id, t, input = {}) {
    const rec = this.#auth(id, t);
    if (rec.status === 'preenchido') return { ok: true, already: true, nome: String(rec.data.nome || '').split(' ')[0] };
    const nome = clean(input.nome, 100);
    if (nome.split(' ').filter(Boolean).length < 2) throw err(400, 'Informe o seu nome completo, por favor.');
    const phone = normalizePhone(input.whatsapp);
    if (!phone) throw err(400, 'Confira o seu WhatsApp com DDD, por favor (ex.: 45 99999-0000).');
    const adultos = Math.round(Number(input.adultos));
    if (!(adultos >= 1 && adultos <= 20)) throw err(400, 'Diga quantos adultos vão no processo (de 1 a 20).');
    const email = clean(input.email, 120);
    if (email && !/^\S+@\S+\.\S+$/.test(email)) throw err(400, 'Confira o e-mail, por favor (ou deixe em branco).');
    rec.data = { nome, whatsapp: `+${phone}`, adultos: String(adultos), email };
    rec.status = 'preenchido';
    rec.filledAt = new Date(this.now()).toISOString();
    this.store.save();
    // O orçamento é elaborado em seguida; se algo falhar, o pedido continua guardado para a equipe e o cliente não vê erro.
    Promise.resolve(this.onFilled(rec)).catch((e) => this.store.addLog({ type: 'error', message: `Orçamento depois dos dados: ${e.message}` }));
    return { ok: true, nome: nome.split(' ')[0] };
  }
}
