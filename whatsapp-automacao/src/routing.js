// Encaminhamento: a IA fez a peneira no Direct/WhatsApp, o cliente está pronto
// para conversar com um consultor. O sistema escolhe o vendedor da vez (rodízio),
// avisa o vendedor com o histórico e devolve o link do WhatsApp dele para o cliente.
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const money = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
const TEMP = { quente: '🔥 Quente', morno: '🌤️ Morno', frio: '❄️ Frio' };
const MONEY = { sim: 'Tem o valor para começar', parcial: 'Tem parte do valor', nao: 'Ainda não tem o valor', nao_informou: 'Não informou' };

/** Prévia das últimas mensagens da conversa (cliente e atendimento), para quem vai continuar. */
export function chatPreview(conv, n = 10) {
  return (conv?.messages || [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-n)
    .map((m) => `${m.role === 'user' ? '👤' : '🤖'} ${m.content.replace(/\s+/g, ' ').slice(0, 180)}`)
    .join('\n');
}

export class LeadRouter {
  constructor({ store, crm, sendWhatsApp, canSendWhatsApp }) {
    this.store = store;
    this.crm = crm;
    this.sendWhatsApp = sendWhatsApp; // (telefone, texto) => Promise
    this.canSendWhatsApp = canSendWhatsApp || (() => false);
  }

  get businessName() {
    return this.store.settings.business?.name || 'nossa empresa';
  }

  panelLink(lead) {
    const base = String(this.store.settings.crm?.panelUrl || process.env.PUBLIC_URL || '').replace(/\/+$/, '');
    return base ? `${base}/#lead=${lead.id}` : '';
  }

  /** Link wa.me com a mensagem pronta que o cliente envia ao vendedor. */
  clientLink(lead, seller) {
    const channel = String(lead.conversationKey || '').startsWith('ig:') ? 'pelo Instagram' : 'pelo atendimento online';
    const text = `Olá, ${firstName(seller.name)}! Vim ${channel} da ${this.businessName}.${lead.name ? ` Meu nome é ${lead.name}.` : ''} Meu código de atendimento é ${lead.code}.`;
    return `https://wa.me/${seller.whatsapp}?text=${encodeURIComponent(text)}`;
  }

  /** Mensagem que o vendedor recebe no WhatsApp dele. */
  sellerMessage(lead, conv, tips = {}) {
    const q = lead.qualification || {};
    const contact = lead.phone ? `+${lead.phone}` : lead.instagram ? `@${lead.instagram} (Instagram)` : 'pelo link';
    const preview = chatPreview(conv, 10);
    const link = this.panelLink(lead);
    return [
      `🔔 *Novo cliente para você* — ${lead.code}`,
      `👤 ${lead.name || 'Sem nome'} · ${contact}`,
      lead.adTitle ? `📣 Veio do anúncio: ${lead.adTitle}` : '',
      lead.interest ? `📦 ${lead.interest}${lead.people > 1 ? ` · ${lead.people} pessoas` : ''}${lead.value ? ` · ${money(lead.value)}` : ''}` : '',
      `🌡️ ${TEMP[q.temperature] || 'Sem classificação'}${q.start ? ` · quer iniciar: ${q.start}` : ''}`,
      q.money ? `💰 ${MONEY[q.money] || q.money}${q.moneyEvidence ? ` — disse: "${q.moneyEvidence}"` : ''}` : '',
      q.objections ? `⚠️ Dúvidas/objeções: ${q.objections}` : '',
      lead.contractData ? `🧾 Dados para formalizar: ${lead.contractData}` : '',
      lead.aiSummary ? `📝 ${lead.aiSummary}` : '',
      tips.interesse_real ? `🎯 Interesse real: ${tips.interesse_real}` : '',
      tips.situacao_atual ? `📍 Situação atual: ${tips.situacao_atual}` : '',
      tips.dica_de_fechamento ? `🧠 Técnica de fechamento: ${tips.dica_de_fechamento}` : '',
      tips.sugestao ? `🏁 Sugestão para finalizar: ${tips.sugestao}` : '',
      preview ? `\n💬 Prévia da conversa:\n${preview}` : '',
      `\nO cliente vai te chamar no WhatsApp com o código *${lead.code}*.`,
      link ? `Ficha completa e conversa: ${link}` : 'Veja a ficha completa no painel (Prospectos → buscar pelo código).',
    ].filter(Boolean).join('\n');
  }

  /** Especialista do assunto (ex.: terrenos → Robson): avisa e devolve o link dele. */
  async routeSpecialist(conv, args, { dryRun = false } = {}) {
    const list = (this.store.settings.crm?.specialists || []).filter((s) => s.topic && s.name);
    const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const wanted = norm(args.assunto);
    const spec = list.find((s) => norm(s.topic) === wanted)
      || list.find((s) => norm(s.topic).split(/[,;/]| e /).some((w) => w.trim() && (wanted.includes(w.trim()) || w.trim().includes(wanted))))
      || (list.length === 1 ? list[0] : null);
    if (!spec) return { erro: 'Não achei especialista para esse assunto. Use transferir_para_humano.' };
    if (!spec.whatsapp) return { erro: `O WhatsApp de ${spec.name} não foi cadastrado. Use transferir_para_humano.` };
    const name = args.nome || conv.name || '';
    const text = `Olá, ${firstName(spec.name)}! Vim pelo atendimento da ${this.businessName}.${name ? ` Meu nome é ${name}.` : ''} Tenho interesse em: ${args.assunto}.`;
    const link = `https://wa.me/${spec.whatsapp}?text=${encodeURIComponent(text)}`;
    if (dryRun || String(conv.key).startsWith('sim:')) {
      return { ok: true, simulacao: true, especialista: firstName(spec.name), link, instrucao: 'Simulação: nada foi enviado. Mande o link ao cliente.' };
    }
    const lead = this.crm.findForConversation({ key: conv.key, phone: conv.phone });
    if (lead) this.crm.addNote({ name: 'IA', role: 'admin' }, lead.id, `Encaminhado para ${spec.name} (${spec.topic}): ${args.resumo}`);
    const where = conv.phone ? `+${conv.phone}` : conv.username ? `@${conv.username} (Instagram)` : 'pelo link';
    const notice = `🔔 *Cliente para você: ${spec.topic}*\n👤 ${name || 'Sem nome'} · ${where}\n📝 ${args.resumo}\n\nO cliente vai te chamar no WhatsApp.`;
    let warned = false;
    if (this.canSendWhatsApp()) {
      try {
        await this.sendWhatsApp(spec.whatsapp, notice);
        warned = true;
      } catch (err) {
        this.store.addLog({ type: 'error', message: `Aviso ao especialista ${spec.name}: ${err.message}` });
      }
    }
    this.store.addLog({ type: 'system', message: `🎯 ${name || where} encaminhado para ${spec.name} (${spec.topic})${warned ? ' (avisado no WhatsApp)' : ''}` });
    return { ok: true, especialista: firstName(spec.name), link, instrucao: `Diga que ${firstName(spec.name)} é o especialista em ${spec.topic}, que já recebeu o resumo, e envie o link para o cliente falar com ele.` };
  }

  /**
   * Chamado pela ferramenta da IA. Em simulação (dryRun) mostra quem seria
   * o vendedor, sem mexer no rodízio nem avisar ninguém.
   */
  async route(conv, args, { dryRun = false } = {}) {
    const routing = this.store.settings.crm?.routing || {};
    if (routing.enabled === false) return { erro: 'Encaminhamento desligado. Use transferir_para_humano.' };
    if (dryRun || String(conv.key).startsWith('sim:')) {
      const seller = this.crm.nextSeller();
      if (!seller) return { erro: 'Nenhum vendedor no rodízio (cadastre vendedores com WhatsApp na aba Equipe). Use transferir_para_humano.' };
      const fake = { code: 'TESTE-0000', name: args.nome || conv.name || '', conversationKey: conv.key };
      return {
        ok: true,
        simulacao: true,
        vendedor: firstName(seller.name),
        link: this.clientLink(fake, seller),
        instrucao: 'Simulação: nada foi gravado. Envie ao cliente o link do WhatsApp do consultor, explicando que ele continua o atendimento por lá.',
      };
    }
    const lead = this.crm.ensureFromConversation({
      key: conv.key,
      phone: conv.phone,
      name: conv.name,
      username: conv.username,
      channel: String(conv.key).startsWith('ig:') ? 'instagram' : 'whatsapp',
    }) || this.crm.findForConversation({ key: conv.key, phone: conv.phone });
    if (!lead) return { erro: 'Não foi possível registrar o cliente no CRM. Use transferir_para_humano.' };
    this.crm.qualify(lead, args);
    const seller = this.crm.routeLead(lead, { reason: 'rodízio após a peneira da IA' });
    if (!seller) return { erro: 'Nenhum vendedor disponível no rodízio. Use transferir_para_humano.' };
    lead.routedAt = new Date().toISOString();
    conv.routedTo = seller.id;
    this.store.save();

    const text = this.sellerMessage(lead, conv, args);
    let warned = false;
    if (this.canSendWhatsApp()) {
      try {
        await this.sendWhatsApp(seller.whatsapp, text);
        warned = true;
      } catch (err) {
        this.store.addLog({ type: 'error', message: `Aviso ao vendedor ${seller.name}: ${err.message}` });
      }
    }
    this.store.addLog({
      type: 'system',
      message: `🎯 ${lead.name || lead.code} encaminhado para ${seller.name}${warned ? ' (avisado no WhatsApp)' : ' (aviso só no painel: o WhatsApp do sistema não está conectado)'}`,
    });
    return {
      ok: true,
      vendedor: firstName(seller.name),
      codigo: lead.code,
      link: this.clientLink(lead, seller),
      instrucao: `Envie o link ao cliente dizendo que o(a) consultor(a) ${firstName(seller.name)} vai continuar o atendimento pelo WhatsApp e já recebeu o resumo da conversa. Peça para ele tocar no link e mandar a mensagem que já vem escrita.`,
    };
  }
}
