// REGRA: o Pix do que foi combinado (normalmente a reserva/entrada) vai ao cliente DEPOIS que ele assina o contrato (ordem do Marcos: ficha, assinatura, Pix).
// `payments.contractPixWhen = 'envio'` faz o Pix sair junto com o contrato. Pix da reserva já enviado pela ficha também conta: nunca sai em duplicidade.
// Valor = o combinado com o vendedor (q.agreedPix) ou, sem isso, a entrada do orçamento. Um Pix por combinado: não reenvia enquanto o mesmo valor
// está em aberto nem depois de pago. Se o Pix não puder sair, o contrato segue e o motivo volta para quem enviou (nunca derruba o contrato).
const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** deps: { store, payments, wa, agent, crm, httpError } */
export function makeContractPix({ store, payments, wa, agent, crm, httpError = (s, m) => Object.assign(new Error(m), { status: s }) }) {
  async function sendContractPix(q, { client = null, by = 'Sistema', phase = null } = {}) {
    const out = { sent: false, why: '', amount: 0 };
    const c = store.settings.payments || {};
    const ct = `CT-${String(q.number).replace(/^ORC-/, '')}`;
    try {
      if (c.autoPixOnContract === false) { out.why = 'envio automático do Pix desligado'; return out; }
      // Quando sai: padrão é depois da assinatura. Quem chama no envio do contrato (phase 'envio') só manda se a regra for "junto com o contrato".
      if (phase && phase !== (c.contractPixWhen === 'envio' ? 'envio' : 'assinatura')) { out.why = phase === 'envio' ? 'o Pix sai depois que o cliente assinar o contrato' : 'o Pix já saiu junto com o contrato'; return out; }
      if (c.enabled === false || !(c.pixKey || c.mercadopago?.accessToken)) { out.why = 'o Pix não está configurado (Configurações → Pagamentos)'; return out; }
      const key = q.convKey;
      if (!key) { out.why = 'o orçamento não está ligado a uma conversa do cliente'; return out; }
      if (!(wa.isConnected ? wa.isConnected(key) : wa.status === 'connected')) { out.why = 'o WhatsApp deste cliente está desconectado'; return out; }
      const agreed = Number(q.agreedPix?.amount);
      const amount = Math.round((agreed > 0 ? agreed : Number(q.plan?.entry)) * 100) / 100;
      if (!(amount > 0) || amount > Number(q.plan?.total || 0) + 0.005) { out.why = 'valor do Pix inválido (confira o combinado)'; return out; }
      out.amount = amount;
      const prev = q.contractPix?.paymentId ? payments.list.find((x) => x.id === q.contractPix.paymentId) : null;
      if (prev && prev.status === 'paid') { out.why = 'a reserva deste contrato já foi paga'; return out; }
      if (prev && prev.status === 'pending' && Math.abs(prev.amount - amount) < 0.005) { out.why = 'o Pix deste combinado já foi enviado e está em aberto'; return out; }
      const conv = agent.conversation(key, { create: false });
      // Pix de reserva em aberto para esta conversa (por exemplo o da ficha de dados) nas últimas 24 h: não gera outro.
      const openForm = payments.list.find((x) => x.convKey === key && x.status === 'pending' && Date.now() - Date.parse(x.createdAt) < 86_400_000 && !String(x.description || '').includes('contrato') && /reserva/i.test(x.description || ''));
      if (openForm) { out.why = 'já há um Pix de reserva em aberto para este cliente'; return out; }
      const lead = crm.findForConversation({ key, phone: conv?.phone || q.phone });
      const p = await payments.create({ convKey: key, leadId: lead?.id || q.leadId || null, amount, description: `Reserva · contrato ${ct}`, payerName: client?.nome || q.contract?.client?.nome || '', payerDoc: client?.cpf || q.contract?.client?.cpf || '', payerPhone: client?.whatsapp || q.contract?.client?.whatsapp || q.phone || conv?.phone || '', by });
      q.contractPix = { paymentId: p.id, amount, at: new Date().toISOString(), by };
      store.save();
      await payments.sendCharge(p);
      if (conv) agent.remember(conv, 'assistant', `[Pix de ${p.amount} enviado: QR Code e código copia e cola · ${ct}]`);
      out.sent = true; out.paymentId = p.id;
      store.addLog({ type: 'system', message: `Pix de ${brl(p.amount)} enviado junto com o contrato ${ct}${agreed > 0 ? ' (valor combinado)' : ' (entrada do orçamento)'}.` });
    } catch (e) {
      out.why = e.message;
      store.addLog({ type: 'error', message: `Pix do contrato ${ct} não saiu: ${e.message}` });
    }
    return out;
  }

  /** Combinado entre vendedor e cliente para o Pix deste contrato. Só aceita valor positivo e até o total do orçamento. */
  function setAgreedPix(q, amount, by) {
    if (amount === undefined || amount === null || amount === '') return;
    const v = Math.round(Number(String(amount).replace(',', '.')) * 100) / 100;
    if (!(v > 0) || v > Number(q.plan?.total || 0)) throw httpError(400, 'O valor do Pix combinado precisa ser maior que zero e não pode passar do total do orçamento.');
    q.agreedPix = { amount: v, by, at: new Date().toISOString() };
  }
  return { sendContractPix, setAgreedPix };
}
