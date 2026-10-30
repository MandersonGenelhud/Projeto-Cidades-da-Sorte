// Contrato automático pela atendente de IA: o cliente pede o contrato na conversa.
// Com orçamento e dados completos, o contrato é gerado e o link de assinatura vai na hora;
// sem os dados, vai a ficha e o contrato sai sozinho quando ele preencher.

/** Campos que o contrato precisa (a ficha de dados tem todos). */
export const CONTRACT_REQUIRED = ['nome', 'cpf', 'nacionalidade', 'estadoCivil', 'rua', 'numero', 'cidade', 'uf'];
export const contractReady = (c) => Boolean(c) && CONTRACT_REQUIRED.every((k) => String(c[k] || '').trim());
const ct = (q) => `CT-${q.number.replace(/^ORC-/, '')}`;

/**
 * deps: store, crm, closing, auth, lines, parseLineKey, samePhone, pickClient, publicBase,
 * quotes() → lista de orçamentos, prepare(quote, client) → { url, text }, makeQuote(args) → orçamento,
 * say(convKey, texto), audit(texto).
 */
export function makeContractFlow(deps) {
  const { store, crm, closing, auth, lines, parseLineKey, samePhone, pickClient, publicBase, quotes, prepare, makeQuote, say, audit = () => {} } = deps;

  /** Gera o contrato com os dados do cliente e manda o link de assinatura no WhatsApp dele. */
  async function sendContractTo({ convKey, lead, quote, client }) {
    if (!quote.convKey) quote.convKey = convKey;
    const r = prepare(quote, client);
    await say(convKey, r.text);
    if (lead) {
      lead.contractRequested = false;
      crm.addNote({ name: 'IA', role: 'admin' }, lead.id, `✍️ Contrato ${ct(quote)} gerado e enviado pela IA para assinatura pelo celular`);
    }
    for (const f of closing.list.filter((x) => x.convKey === convKey)) f.contractRequested = false;
    audit(`${ct(quote)} · ${client.nome}`);
    store.save();
    return r;
  }

  async function sendContract(conv, args = {}, { dryRun } = {}) {
    if (dryRun || String(conv.key).startsWith('sim:')) {
      return { ok: true, simulacao: true, instrucao: 'Simulação: no atendimento real, o sistema gera o contrato com os dados da ficha e manda o link para assinar pelo celular (ou manda a ficha, se faltarem dados). Diga isso ao cliente em uma frase.' };
    }
    if (!publicBase()) return { erro: 'O sistema ainda não tem endereço na internet. Use passar_fechamento_para_humano (ou transferir_para_humano) para a equipe enviar o contrato.' };
    const lead = crm.findForConversation({ key: conv.key, phone: conv.phone })
      || crm.ensureFromConversation({ key: conv.key, phone: conv.phone, name: conv.name, username: conv.username, channel: String(conv.key).startsWith('ig:') ? 'instagram' : 'whatsapp' });
    let quote = quotes().filter((q) => q.convKey === conv.key || (lead && q.leadId === lead.id) || (conv.phone && q.phone && samePhone(q.phone, conv.phone))).at(-1) || null;
    if (quote?.contract?.status === 'assinado') {
      return { ok: true, jaAssinado: true, instrucao: `O contrato ${ct(quote)} deste cliente já foi assinado e a via assinada já foi enviada para ele. Diga isso e siga com o próximo passo (Pix ou documentos).` };
    }
    // Sem orçamento: faz agora, se a atendente informou o pacote.
    if (!quote) {
      const items = Array.isArray(args.itens) && args.itens.length ? args.itens : args.pacote ? [{ pacote: args.pacote, quantidade: args.pessoas || 1 }] : null;
      if (!items) return { erro: 'Ainda não há orçamento para este cliente, e o contrato sai a partir dele. Pergunte o pacote e quantas pessoas (e adultos) e chame enviar_contrato de novo com esses dados.' };
      const parsed = parseLineKey(conv.key);
      const owner = parsed ? auth.get(lines.get(parsed.id)?.ownerId) : (lead?.ownerId ? auth.get(lead.ownerId) : null);
      try {
        quote = await makeQuote({ convKey: conv.key, lead, items, adults: args.adultos, client: args.nome, consultant: owner?.name?.split(' ')[0] });
      } catch (e) {
        return { erro: e.message };
      }
    }
    const form = (lead && closing.forLead(lead.id)) || closing.forConversation(conv.key) || null;
    const filled = form?.status === 'preenchida' ? pickClient(form.data) : null;
    const client = contractReady(filled) ? filled : contractReady(quote.contract?.client) ? quote.contract.client : null;
    if (client) {
      try {
        await sendContractTo({ convKey: conv.key, lead, quote, client });
      } catch (e) {
        return { erro: `${e.message} Use passar_fechamento_para_humano para a equipe enviar o contrato.` };
      }
      return { ok: true, enviado: true, instrucao: 'O link do contrato, já preenchido com os dados do cliente e o orçamento, foi enviado logo acima. Diga em uma frase que é só tocar, ler com calma e assinar pelo celular com o dedo, e que a via assinada chega aqui. Não repita o link.' };
    }
    // Faltam dados: manda a ficha (ou reenvia a que já existe) e marca o pedido do contrato.
    const f = form && form.status !== 'preenchida' ? form : closing.createForm({ convKey: conv.key, lead, servico: quote.items.map((r) => `${r.name} × ${r.qty}`).join(', '), adultos: args.adultos || quote.plan?.adults });
    f.contractRequested = true;
    if (lead) lead.contractRequested = true;
    store.save();
    return {
      ok: true,
      precisaDados: true,
      link: closing.formUrl(f),
      instrucao: 'Para gerar o contrato faltam os dados pessoais do cliente. Mande este link exatamente como veio e diga que é só tocar, preencher cada campo (uns 2 minutos, o CEP completa o endereço) e tocar em "Enviar meus dados": assim que ele enviar, o contrato já preenchido chega aqui sozinho para assinar pelo celular. Não peça CPF, RG ou endereço pelo chat.',
    };
  }

  return { sendContract, sendContractTo };
}
