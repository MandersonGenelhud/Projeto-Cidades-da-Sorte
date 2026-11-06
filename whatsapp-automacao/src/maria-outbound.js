// Envio ao cliente pedido pela Maria: a ficha de dados e o contrato saem pelo WhatsApp que o cliente já conhece
// (o do vendedor, se ele tem o seu conectado; senão o número principal da Migra), nunca pelo número interno da Maria.
// Quando o cliente responde, a conversa segue o fluxo normal (atendente de IA, CRM, ficha e contrato).
// Quem confirma, limita e registra é a Maria (src/maria.js); aqui só está o "como enviar".

/**
 * deps: publicBase(), store, quotes() → lista, samePhone, lines, lineKey, wa, agent, crm, closing, contractFlow,
 * fichaMessage(nome, url) → texto.
 */
export function makeOutbound(deps) {
  const { publicBase, store, quotes, samePhone, lines, lineKey, wa, agent, crm, closing, contractFlow, fichaMessage } = deps;
  const connected = (key) => (wa.isConnected ? wa.isConnected(key) : wa.status === 'connected');

  /** De qual WhatsApp sai: o do vendedor (se conectado) ou o principal. Administrador sempre pelo principal. */
  function route(user, phone) {
    const line = user.role !== 'admin' ? lines.byOwner(user.id) : null;
    const lk = line ? lineKey(line.id, `${phone}@s.whatsapp.net`) : null;
    if (lk && connected(lk)) return { key: lk, via: 'o seu WhatsApp' };
    return { key: `${phone}@s.whatsapp.net`, via: 'o WhatsApp principal da Migra' };
  }

  /** Conversa e prospecto do cliente (criados se for novo). O vendedor fica como dono; cliente de outro vendedor é recusado. */
  function prepare({ user, viewer, phone, nome }) {
    const { key, via } = route(user, phone);
    if (!connected(key)) throw new Error(`${via === 'o seu WhatsApp' ? 'O seu WhatsApp' : 'O WhatsApp principal'} não está conectado agora. Confira em Conexões e tente de novo.`);
    const conv = agent.conversation(key);
    conv.phone ||= phone;
    if (nome) conv.name ||= nome;
    const lead = crm.findForConversation({ key, phone }) || crm.ensureFromConversation({ key, phone, name: nome, channel: 'whatsapp' });
    if (lead && viewer.role !== 'admin' && !lead.ownerId) crm.assign(user, lead.id, user.id);
    if (lead && !crm.canSee(viewer, lead)) throw new Error('Este cliente é de outro vendedor. Fale com o administrador.');
    if (lead && nome && (!lead.name || /^@|^\+?\d+$/.test(lead.name))) lead.name = nome;
    return { key, via, conv, lead };
  }

  return {
    ready: () => Boolean(publicBase()),
    isBlocked: (phone) => store.isBlacklisted(phone),
    /** Já existe orçamento em aberto deste número? (então o contrato não precisa de pacote). */
    hasQuote: (phone) => quotes().some((q) => q.phone && samePhone(q.phone, phone) && q.contract?.status !== 'assinado'),
    route,

    /** Manda ao cliente o link da ficha de dados. */
    async sendForm({ user, viewer, phone, nome, adultos }) {
      if (!publicBase()) throw new Error('O sistema ainda não tem endereço na internet, então o cliente não conseguiria abrir o link.');
      const { key, via, conv, lead } = prepare({ user, viewer, phone, nome });
      const f = closing.createForm({ convKey: key, lead, servico: lead?.interest || '', adultos });
      const text = fichaMessage(nome, closing.formUrl(f));
      await wa.send(key, { text, typing: false });
      agent.remember(conv, 'assistant', text);
      if (lead) crm.addNote(viewer, lead.id, `📝 Ficha de dados enviada ao cliente pela Maria, a pedido de ${user.name}`);
      return { kind: 'ficha', via };
    },

    /**
     * Manda o contrato: com orçamento e dados completos, o link de assinatura; senão a ficha (e o contrato sai sozinho quando ele preencher).
     * Sem orçamento, o fluxo cria um com o pacote informado e manda o orçamento em PDF antes (como a atendente faz).
     */
    async sendContract({ user, viewer, phone, nome, pacote, pessoas, adultos }) {
      if (!publicBase()) throw new Error('O sistema ainda não tem endereço na internet, então o cliente não conseguiria abrir o link.');
      const { key, via, conv, lead } = prepare({ user, viewer, phone, nome });
      const r = await contractFlow.sendContract(conv, { pacote, pessoas, adultos, nome });
      if (r.erro) throw new Error(r.erro);
      if (r.jaAssinado) return { kind: 'ja_assinado', via };
      if (r.precisaDados) {
        const text = `Para preparar o seu contrato preciso dos seus dados. É só tocar no link, preencher (uns 2 minutos) e enviar:\n${r.link}`;
        await wa.send(key, { text, typing: false });
        agent.remember(conv, 'assistant', text);
        if (lead) crm.addNote(viewer, lead.id, `📝 Ficha de dados enviada ao cliente pela Maria (contrato sai quando ele preencher), a pedido de ${user.name}`);
        return { kind: 'ficha_para_contrato', via };
      }
      if (lead) crm.addNote(viewer, lead.id, `✍️ Contrato enviado ao cliente pela Maria, a pedido de ${user.name}`);
      return { kind: 'contrato', via };
    },
  };
}
