// Funil sempre em dia: o sistema confere o que realmente aconteceu com cada cliente (contrato enviado, contrato assinado, pagamento recebido)
// e move o prospecto para a etapa certa, em vez de depender de alguém lembrar de mudar. Também avisa cada vendedor dos atendimentos parados.
// Regras (só avançam, nunca voltam, nunca mexem em "Perdido"):
//   • pagamento recebido (Pix do sistema, parcela com baixa ou comprovante lido)  → Fechado;
//   • contrato enviado ou assinado                                                → no mínimo "Proposta enviada" (de Novo ou Em contato).
// Contrato assinado SEM pagamento ainda não fecha: o fechamento (e a comissão) só vale com dinheiro recebido.
const SYS = { name: 'Sistema (funil automático)', role: 'admin', id: null };
const DAY = 86_400_000;

export class FunnelSync {
  constructor({ store, crm, sales, quotes, payments, auth, notifyTeam = async () => {}, notifyAdmins = async () => {}, audit = () => {}, now = () => new Date() }) {
    Object.assign(this, { store, crm, sales, quotes, payments, auth, notifyTeam, notifyAdmins, audit, now });
  }

  /** Dedução da etapa certa de um prospecto. null = nada a mudar. */
  deduce(lead) {
    if (!lead || ['ganho', 'perdido'].includes(lead.stage)) return null;
    const paidPix = (this.payments?.list || []).some((p) => p.status === 'paid' && !p.purpose && p.leadId === lead.id);
    const quoteIds = new Set(this.quotes.list.filter((q) => q.leadId === lead.id || (lead.conversationKey && q.convKey === lead.conversationKey)).map((q) => q.id));
    const paidSale = this.sales.list.find((s) => s.status !== 'cancelada' && !s.legacy && (s.leadId === lead.id || quoteIds.has(s.quoteId)) && s.parcels.some((p) => p.status === 'pago'));
    if (paidPix || paidSale) return { to: 'ganho', why: paidSale ? `parcela recebida (venda ${paidSale.number})` : 'Pix confirmado', value: paidSale?.total };
    if (['novo', 'em_contato'].includes(lead.stage)) {
      const q = this.quotes.list.filter((x) => quoteIds.has(x.id) && x.contract).at(-1);
      if (q) return { to: 'proposta', why: q.contract.status === 'assinado' ? `contrato ${q.number} assinado (aguardando pagamento)` : `contrato ${q.number} enviado ao cliente` };
    }
    return null;
  }

  /** Confere todos os prospectos abertos. dryRun = só mostra o que mudaria. */
  reconcile({ dryRun = false } = {}) {
    const changes = [];
    for (const lead of this.crm.leads) {
      const d = this.deduce(lead);
      if (!d) continue;
      changes.push({ id: lead.id, name: lead.name || lead.phone || 'Cliente', from: lead.stage, to: d.to, why: d.why });
      if (dryRun) continue;
      try {
        this.crm.update(SYS, lead.id, { stage: d.to, ...(d.to === 'ganho' ? { closedValue: d.value || lead.value || 0 } : {}) });
        this.crm.addNote({ name: 'Sistema', role: 'admin' }, lead.id, `🔄 Funil atualizado sozinho: ${d.why}.`);
      } catch (e) {
        this.store.addLog({ type: 'error', message: `Funil automático (${lead.name || lead.id}): ${e.message}` });
      }
    }
    if (changes.length && !dryRun) this.audit(`${changes.length} prospecto(s) movido(s): ${changes.slice(0, 8).map((c) => `${c.name} → ${c.to}`).join('; ')}`);
    return { changed: changes.length, changes };
  }

  /** Confere um só prospecto (usado logo depois de um contrato enviado/assinado ou de um pagamento). */
  reconcileOne(leadId) {
    const lead = this.crm.byId(leadId);
    const d = this.deduce(lead);
    if (!d) return null;
    this.crm.update(SYS, lead.id, { stage: d.to, ...(d.to === 'ganho' ? { closedValue: d.value || lead.value || 0 } : {}) });
    this.crm.addNote({ name: 'Sistema', role: 'admin' }, lead.id, `🔄 Funil atualizado sozinho: ${d.why}.`);
    return d;
  }

  /** Atendimentos abertos sem movimento há `days` dias ou mais, agrupados por vendedor. */
  stuck(days = 3) {
    const limit = this.now().getTime() - days * DAY;
    const by = new Map();
    for (const l of this.crm.leads) {
      if (!['em_contato', 'proposta'].includes(l.stage) || !l.ownerId) continue;
      if (new Date(l.updatedAt || 0).getTime() > limit) continue;
      (by.get(l.ownerId) || by.set(l.ownerId, []).get(l.ownerId)).push(l);
    }
    return by;
  }

  /** Uma vez por dia: cada vendedor recebe a lista dos próprios atendimentos parados; o administrador recebe o resumo geral. */
  async digest({ days = 3 } = {}) {
    const today = this.now().toISOString().slice(0, 10);
    if (this.store.data.funnelDigestDay === today) return { sent: 0 };
    this.store.data.funnelDigestDay = today;
    this.store.save();
    const by = this.stuck(days);
    let sent = 0; let total = 0;
    for (const [ownerId, leads] of by) {
      total += leads.length;
      const u = this.auth.get(ownerId);
      if (!u?.whatsapp || u.active === false || u.role === 'admin') continue;
      const list = leads.slice(0, 10).map((l) => `• ${l.name || (l.phone ? `+${l.phone}` : 'Cliente')} (${l.stage === 'proposta' ? 'proposta enviada' : 'em contato'})`).join('\n');
      const text = `📋 *Atendimentos parados, ${String(u.name).split(' ')[0]}*\nVocê tem ${leads.length} cliente(s) sem movimento há ${days} dia(s) ou mais:\n${list}${leads.length > 10 ? `\n… e mais ${leads.length - 10}` : ''}\n\nAbra o CRM e atualize cada um: fechou, vai retomar depois (com a data) ou perdeu (com o motivo). Assim o painel do Marcos mostra a situação real.`;
      if (await this.notifyTeam(u.whatsapp, text).then(() => true).catch(() => false)) sent += 1;
    }
    if (total) await this.notifyAdmins(`📋 *Funil: ${total} atendimento(s) parado(s) há ${days}+ dias* em ${by.size} vendedor(es). Cada vendedor recebeu a própria lista.`).catch(() => {});
    return { sent, total };
  }
}
