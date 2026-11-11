// Comprovante de pagamento que o CLIENTE manda ao vendedor (ou à Central) fora de uma cobrança Pix do sistema.
// A IA lê o comprovante e confere TUDO antes de dar baixa (recebedor é a Migra, pagamento concluído, valor igual a uma parcela em aberto,
// data coerente, número de transação único, imagem sem sinal de edição, valor abaixo do limite automático). Passando em tudo:
// parcela recebida, recibo gerado e enviado ao cliente, prospecto como Fechado e aviso "fechado e pago". Falhou em algo: NADA é baixado;
// o arquivo é guardado e os administradores e o vendedor recebem o aviso com o motivo.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const money = (v) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const isoDay = (d) => new Date(d).toISOString().slice(0, 10);
const SYSTEM_USER = { name: 'Sistema (comprovante lido pela IA)', role: 'admin', id: null };

export class ClientProofs {
  /**
   * reader: { read(buffer, mime) → dados, receiverOk(r), maxAuto } (o mesmo leitor dos comprovantes de Pix).
   * notifyClosing(text): avisa fechamento (administradores e número principal). notifyTeam(phone, text): avisa o vendedor.
   * say(msg, text): responde ao cliente no mesmo número. humanSpoke(key): se uma pessoa já falou, a IA não puxa conversa.
   */
  constructor({ store, sales, crm, quotes, auth, reader, download, dataDir, notifyClosing = async () => {}, notifyAdmins = async () => {}, notifyTeam = async () => {}, say = async () => {}, humanSpoke = () => false, audit = () => {}, now = () => new Date() }) {
    Object.assign(this, { store, sales, crm, quotes, auth, reader, download, notifyClosing, notifyAdmins, notifyTeam, say, humanSpoke, audit, now });
    this.dir = path.join(dataDir, 'client-proofs');
  }

  /** O que esta conversa tem de cobrança: o prospecto, o último orçamento com contrato e a venda (se já foi lançada). */
  target(msg) {
    const lead = this.crm.findForConversation({ key: msg.jid, phone: msg.phone });
    if (!lead) return null;
    const quote = this.quotes.list.filter((q) => (q.leadId === lead.id || q.convKey === msg.jid) && q.contract && q.plan).at(-1) || null;
    const sale = this.sales.list.find((s) => s.status !== 'cancelada' && (s.leadId === lead.id || (quote && s.quoteId === quote.id))) || null;
    if (!quote && !sale) return null;
    return { lead, quote, sale };
  }

  wants(msg) {
    if (msg.isGroup || msg.fromMe || msg.channel === 'instagram') return false;
    if (!(msg.hasImage || /pdf/i.test(msg.documentMime || ''))) return false;
    return Boolean(this.target(msg));
  }

  /** Parcelas ainda em aberto: da venda, ou (sem venda lançada) do plano do orçamento. */
  candidates({ sale, quote }) {
    if (sale) return sale.parcels.map((p, i) => ({ index: i, value: p.value, label: p.label, status: p.status })).filter((p) => p.status !== 'pago');
    const plan = quote.plan;
    return [{ index: 0, value: plan.entry, label: 'Entrada' }, ...(plan.parcels || []).map((p, i) => ({ index: i + 1, value: p.value, label: p.label }))].filter((p) => Number(p.value) > 0);
  }

  #refUsed(ref) {
    return this.sales.list.some((s) => s.parcels.some((p) => p.proof?.ref === ref))
      || (this.store.data.payments || []).some((p) => p.receipt?.ref === ref);
  }

  #save(buffer, mime, name) {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const ext = /pdf/i.test(mime) ? 'pdf' : /png/i.test(mime) ? 'png' : /webp/i.test(mime) ? 'webp' : 'jpg';
    const file = `${name}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(this.dir, file), buffer, { mode: 0o600 });
    return file;
  }

  /** true = tratado aqui (não segue para a conversa); false = não é comprovante (a conversa segue normal). */
  async handle(msg) {
    const t = this.target(msg);
    if (!t) return false;
    const mime = msg.hasImage ? msg.imageMime || 'image/jpeg' : msg.documentMime || 'application/pdf';
    let buffer; let r;
    try {
      buffer = await this.download(msg);
      if (!buffer) throw new Error('não consegui baixar o arquivo');
      r = await this.reader.read(buffer, mime);
    } catch (e) {
      this.store.addLog({ type: 'error', message: `Comprovante enviado ao vendedor: ${e.message}` });
      return false; // sem leitura, não decide nada: a conversa segue e a pessoa vê o arquivo
    }
    if (r?.unsupported) return false;
    if (!r?.comprovante || !(Number(r.valor) > 0)) return false; // outra foto (documento etc.)
    const amount = Math.round(Number(r.valor) * 100) / 100;
    const ref = String(r.id_transacao || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const { lead, quote } = t;
    let { sale } = t;

    // O mesmo comprovante de novo (cliente reenviou): já foi tratado, não repete nada.
    if (ref.length >= 10 && sale?.parcels.some((p) => p.proof?.ref === ref)) return true;

    const open = this.candidates(t);
    const match = open.find((p) => Math.abs(Number(p.value) - amount) < 0.01) || null;
    const problems = [];
    if (!match) problems.push(`o valor do comprovante (${money(amount)}) não bate com nenhuma parcela em aberto${open.length ? ` (${open.slice(0, 4).map((p) => `${p.label}: ${money(p.value)}`).join(', ')})` : ''}`);
    if (r.moeda && r.moeda !== 'BRL') problems.push(`moeda ${r.moeda}`);
    if (r.situacao !== 'concluido') problems.push(`o comprovante não mostra pagamento concluído (${r.situacao || 'sem situação'})`);
    if (!this.reader.receiverOk(r)) problems.push(`o recebedor (${r.recebedor || 'não aparece'}) não confere com o da Migra`);
    const day = /^\d{4}-\d{2}-\d{2}$/.test(r.data || '') ? r.data : null;
    const since = quote?.createdAt || sale?.createdAt;
    if (!day) problems.push('data ilegível');
    else if ((since && day < isoDay(new Date(since).getTime() - 86_400_000)) || day > isoDay(this.now().getTime() + 86_400_000)) problems.push(`data ${day} fora do período desta venda`);
    if (ref.length < 10) problems.push('sem número de transação legível');
    else if (this.#refUsed(ref)) problems.push('esse número de transação já foi usado em outro pagamento');
    if (r.parece_adulterado) problems.push('a imagem parece editada');
    if (match && match.value > this.reader.maxAuto) problems.push(`valor acima do limite de confirmação automática (${money(this.reader.maxAuto)})`);

    const file = this.#save(buffer, mime, `cliente-${lead.id}`);
    const who = lead.name || (lead.phone ? `+${lead.phone}` : 'Cliente');
    const seller = lead.ownerId ? this.auth?.get(lead.ownerId) : null;

    if (problems.length) {
      this.crm.addNote({ name: 'Sistema', role: 'admin' }, lead.id, `🔔 Comprovante de ${money(amount)} recebido (arquivo guardado). NÃO foi dado baixa: ${problems.join('; ')}.`);
      const text = `🔔 *Comprovante recebido: precisa de conferência*\n👤 ${who}${lead.phone ? ` · +${lead.phone}` : ''}\n💵 ${money(amount)}${r.banco ? ` · ${r.banco}` : ''}\n⚠️ ${problems.join('; ')}.\n\nConfira no banco e dê a baixa em Contratos e Vendas. O arquivo está guardado com segurança no sistema.`;
      await this.notifyAdmins(text).catch(() => {});
      if (seller?.whatsapp && seller.role !== 'admin') await this.notifyTeam(seller.whatsapp, text).catch(() => {});
      this.audit(`${who} · comprovante ${money(amount)} para conferência: ${problems.join('; ')}`);
      if (!this.humanSpoke(msg.jid)) await this.say(msg, 'Recebi o seu comprovante! 🙏 Vou pedir para a equipe conferir (leva poucos minutos) e já te aviso por aqui.').catch(() => {});
      return true;
    }

    // Tudo conferido: lança a venda (se ainda não existe), dá baixa, gera e envia o recibo e fecha o prospecto.
    if (!sale) sale = this.sales.fromQuote(quote, { by: 'Sistema', sellerId: lead.ownerId || quote.createdBy?.id || null });
    this.sales.setParcel(SYSTEM_USER, sale.id, match.index, { paid: true, date: day, method: 'Pix (comprovante)', note: `Comprovante lido pela IA · transação ${ref}` });
    const parcel = sale.parcels[match.index];
    parcel.proof = { ref, file, amount, payer: r.pagador || '', bank: r.banco || '', readAt: this.now().toISOString() };
    let closedNow = false;
    if (lead.stage !== 'ganho') {
      this.crm.update({ name: SYSTEM_USER.name, role: 'admin', id: null }, lead.id, { stage: 'ganho', closedValue: sale.total || lead.value || amount });
      closedNow = true;
    }
    this.crm.addNote({ name: 'Sistema', role: 'admin' }, lead.id, `✅ Comprovante lido e conferido: ${parcel.label} de ${money(amount)} (transação ${ref}). Recibo emitido e enviado ao cliente.${closedNow ? ' Prospecto movido para Fechado.' : ''}`);
    this.store.save();
    this.audit(`${who} · ${parcel.label} ${money(amount)} · transação ${ref} · baixa pela leitura do comprovante`);
    await this.notifyClosing([
      closedNow ? '🎉 *FECHADO E PAGO*' : '💰 *Pagamento recebido*',
      `👤 ${who}${lead.phone ? ` · +${lead.phone}` : ''}`,
      `💵 ${parcel.label}: ${money(amount)}${sale.number ? ` · venda ${sale.number}` : ''}`,
      lead.interest ? `📦 ${lead.interest}${lead.people > 1 ? ` · ${lead.people} pessoas` : ''}` : '',
      `🧑‍💼 Quem atendeu: ${seller?.name || 'Central de Atendimento'}`,
      '🧾 Recibo gerado e enviado ao cliente.',
      `🔎 Baixa pela LEITURA DO COMPROVANTE enviado pelo cliente (transação ${ref}). Dê uma conferida no banco; o arquivo está guardado no sistema.`,
    ].filter(Boolean).join('\n')).catch(() => {});
    return true;
  }
}
