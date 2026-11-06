// Envio ao cliente pedido pela Maria: a ficha de dados e o contrato saem pelo WhatsApp que o cliente já conhece
// (o do vendedor, se ele tem o seu conectado; senão o número principal da Migra), nunca pelo número interno da Maria.
// Quando o cliente responde, a conversa segue o fluxo normal (atendente de IA, CRM, ficha e contrato).
// Quem confirma, limita e registra é a Maria (src/maria.js); aqui só está o "como enviar".

/**
 * deps: publicBase(), store, quotes() → lista, samePhone, lines, lineKey, wa, agent, crm, closing, contractFlow,
 * fichaMessage(nome, url) → texto.
 */
export function makeOutbound(deps) {
  const { publicBase, store, quotes, samePhone, lines, lineKey, wa, agent, crm, closing, contractFlow, fichaMessage, contractFile = () => null } = deps;
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
    // Só CRIA o cadastro quando o cliente é novo; um cadastro que já existe não é alterado (nem nome, nem dono).
    const existing = crm.findForConversation({ key, phone });
    const lead = existing || crm.ensureFromConversation({ key, phone, name: nome, channel: 'whatsapp' });
    if (lead && !existing && viewer.role !== 'admin') crm.assign(user, lead.id, user.id);
    if (lead && !crm.canSee(viewer, lead)) throw new Error('Este cliente é de outro vendedor. Fale com o administrador.');
    return { key, via, conv, lead };
  }

  return {
    ready: () => Boolean(publicBase()),
    isBlocked: (phone) => store.isBlacklisted(phone),
    /** Já existe orçamento em aberto deste número? (então o contrato não precisa de pacote). */
    hasQuote: (phone) => quotes().some((q) => q.phone && samePhone(q.phone, phone) && q.contract?.status !== 'assinado'),
    route,
    prepare,

    /** Manda ao cliente o link da ficha de dados. */
    async sendForm({ user, viewer, phone, nome, adultos }) {
      if (!publicBase()) throw new Error('O sistema ainda não tem endereço na internet, então o cliente não conseguiria abrir o link.');
      const { key, via, conv, lead } = prepare({ user, viewer, phone, nome });
      const f = closing.createForm({ convKey: key, lead, servico: lead?.interest || '', adultos });
      // Ficha pedida pela Maria: o vendedor decide o próximo passo (sem Pix nem termo automáticos) e é avisado quando o cliente preencher.
      f.noAuto = true;
      f.requesterId = user.id;
      const q = quotes().filter((x) => (lead && x.leadId === lead.id) || (x.phone && samePhone(x.phone, phone))).at(-1);
      if (q) f.quoteId = q.id;
      store.save();
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
    async sendContract({ user, viewer, phone, nome, pacote, pessoas, adultos, itens = null, desconto = 0 }) {
      if (!publicBase()) throw new Error('O sistema ainda não tem endereço na internet, então o cliente não conseguiria abrir o link.');
      const { key, via, conv, lead } = prepare({ user, viewer, phone, nome });
      const r = await contractFlow.sendContract(conv, { pacote, pessoas, adultos, nome, itens, desconto });
      if (r.erro) throw new Error(r.erro);
      if (r.jaAssinado) return { kind: 'ja_assinado', via };
      if (r.precisaDados) {
        const text = `Para preparar o seu contrato preciso dos seus dados. É só tocar no link, preencher (uns 2 minutos) e enviar:\n${r.link}`;
        await wa.send(key, { text, typing: false });
        agent.remember(conv, 'assistant', text);
        const form = lead ? closing.forLead(lead.id) : null;
        if (form) { form.requesterId = user.id; store.save(); } // o vendedor é avisado quando o cliente preencher; o contrato sai sozinho

        if (lead) crm.addNote(viewer, lead.id, `📝 Ficha de dados enviada ao cliente pela Maria (contrato sai quando ele preencher), a pedido de ${user.name}`);
        return { kind: 'ficha_para_contrato', via };
      }
      // Além do link de assinatura (já enviado pelo fluxo), o PDF do contrato para o cliente ler com calma.
      const q = quotes().filter((x) => (lead && x.leadId === lead.id) || x.convKey === key || (x.phone && samePhone(x.phone, phone))).at(-1);
      const file = q ? contractFile(q) : null;
      if (file) await wa.send(key, { text: 'Segue também o contrato em PDF, para você ler com calma antes de assinar. 📄', media: { buffer: file.buffer, mimetype: 'application/pdf', fileName: file.name }, typing: false });
      if (lead) crm.addNote(viewer, lead.id, `✍️ Contrato enviado ao cliente (PDF e link de assinatura) pela Maria, a pedido de ${user.name}`);
      return { kind: 'contrato', via, pdf: Boolean(file) };
    },
  };
}

const fold = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const rs = (v) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Orçamento recente (já filtrado por permissão) do mesmo cliente: pelo telefone, pelo nome inteiro ou por parte do nome ("Ana").
 * Se mais de um cliente combina com a parte do nome, pede o nome completo (nunca chuta).
 */
export function findRecentQuote(openQuotes, { nome = '', phone = '', samePhone, normalizePhone }) {
  const ph = normalizePhone(phone) || '';
  const byPhone = ph ? openQuotes.filter((q) => q.phone && samePhone(q.phone, ph)) : [];
  if (byPhone.length) return byPhone.at(-1);
  const n = fold(nome);
  if (!n) return null;
  const exact = openQuotes.filter((q) => fold(q.client) === n);
  if (exact.length) return exact.at(-1);
  const part = openQuotes.filter((q) => n.length >= 3 && fold(q.client).split(/\s+/).some((w) => w === n || (n.includes(' ') && fold(q.client).includes(n))));
  const names = [...new Set(part.map((q) => q.client))];
  if (names.length > 1) throw new Error(`achei mais de um cliente com esse nome (${names.slice(0, 4).join(', ')}). Me diga o nome completo, por favor.`);
  return part.at(-1) || null;
}

/** Aviso ao vendedor: o cliente preencheu a ficha, com a prévia do orçamento. */
export function filledNotice({ nome = 'O cliente', quote = null, requesterName = '', mariaName = 'Maria' }) {
  const first = String(requesterName || '').split(' ')[0];
  const prev = quote
    ? `\n\n*Prévia do orçamento ${quote.number}*\n${quote.items.map((r) => `${r.name}${r.qty > 1 ? ` × ${r.qty}` : ''}`).join(', ')}\nTotal ${rs(quote.plan.total)} · entrada ${rs(quote.plan.entry)}${quote.plan.parcels?.length ? ` + ${quote.plan.parcels.length} parcelas` : ''}`
    : '';
  return `📝 ${first ? `${first}, o` : 'O'} cliente *${nome}* já preencheu a ficha de dados! Os dados já estão no sistema.${prev}\n\nSe ele fechar, é só pedir: "${mariaName}, gere o contrato de ${nome}".`;
}
