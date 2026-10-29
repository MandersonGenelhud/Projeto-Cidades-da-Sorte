// Ferramentas que o agente pode usar (passo 6 do vídeo: "o agente age").

export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'consultar_horarios_disponiveis',
      description: 'Lista os horários livres na agenda em uma data. Use sempre antes de oferecer horários.',
      parameters: {
        type: 'object',
        properties: { data: { type: 'string', description: 'Data no formato AAAA-MM-DD' } },
        required: ['data'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agendar_horario',
      description: 'Marca um horário na agenda para o cliente desta conversa. Só use depois que o cliente confirmar nome, serviço, data e hora.',
      parameters: {
        type: 'object',
        properties: {
          data: { type: 'string', description: 'AAAA-MM-DD' },
          hora: { type: 'string', description: 'HH:MM, exatamente como retornado em consultar_horarios_disponiveis' },
          nome: { type: 'string', description: 'Nome completo do cliente' },
          servico: { type: 'string', description: 'Serviço desejado' },
          email: { type: 'string', description: 'E-mail do cliente (opcional)' },
          observacoes: { type: 'string', description: 'Observações (opcional)' },
        },
        required: ['data', 'hora', 'nome', 'servico'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listar_meus_agendamentos',
      description: 'Lista os próximos agendamentos do cliente desta conversa (com os IDs para cancelar).',
      // sem "parameters": alguns provedores recusam um objeto sem propriedades
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancelar_agendamento',
      description: 'Cancela um agendamento do cliente desta conversa. Use o ID obtido em listar_meus_agendamentos.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'encaminhar_para_vendedor',
      description: 'Use quando a peneira mostrar que o cliente está pronto para conversar com um consultor (cliente quente) ou quando ele pedir para fechar/falar com um consultor. O sistema escolhe o vendedor da vez, envia o resumo para ele e devolve o link do WhatsApp do vendedor para você mandar ao cliente. Preencha só com o que o cliente realmente disse; não invente.',
      parameters: {
        type: 'object',
        properties: {
          resumo: { type: 'string', description: 'O que o cliente quer e a situação dele, em até 3 frases' },
          temperatura: { type: 'string', enum: ['quente', 'morno', 'frio'], description: 'quente = quer começar logo e tem como pagar; morno = interessado com dúvidas; frio = só pesquisando ou sem recursos agora' },
          nome: { type: 'string', description: 'Nome do cliente, se ele disse' },
          pacote: { type: 'string', description: 'Pacote de interesse, se houver' },
          pessoas: { type: 'number', description: 'Quantas pessoas no processo' },
          tem_recursos: { type: 'string', enum: ['sim', 'parcial', 'nao', 'nao_informou'], description: 'Se o cliente tem o valor para começar' },
          evidencia_recursos: { type: 'string', description: 'A frase do cliente que mostra isso (copie as palavras dele)' },
          quando_quer_iniciar: { type: 'string', description: 'Quando pretende começar, nas palavras do cliente' },
          objecoes: { type: 'string', description: 'Dúvidas ou objeções que ainda restam' },
          telefone: { type: 'string', description: 'WhatsApp do cliente, se ele informou' },
          dados_formalizacao: { type: 'string', description: 'Dados que o cliente passou para formalizar a negociação (nome completo, CPF, e-mail, data de nascimento, cidade), exatamente como ele escreveu' },
        },
        required: ['resumo', 'temperatura'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'encaminhar_para_especialista',
      description: 'Passa o cliente para o especialista de um assunto (ex.: terrenos e imóveis). O especialista recebe o resumo e você recebe o link do WhatsApp dele para enviar ao cliente.',
      parameters: {
        type: 'object',
        properties: {
          assunto: { type: 'string', description: 'O assunto, como está na lista de especialistas' },
          resumo: { type: 'string', description: 'O que o cliente procura, em até 3 frases' },
          nome: { type: 'string', description: 'Nome do cliente, se ele disse' },
        },
        required: ['assunto', 'resumo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'transferir_para_humano',
      description: 'Pausa o robô nesta conversa e avisa a equipe para um atendente humano assumir.',
      parameters: {
        type: 'object',
        properties: { motivo: { type: 'string' } },
        required: ['motivo'],
      },
    },
  },
];

/**
 * Executa uma ferramenta e devolve um objeto serializável para a IA.
 * ctx: { calendar, phone, dryRun, onHandoff, onBooked }
 */
export async function runTool(name, args, ctx) {
  try {
    switch (name) {
      case 'consultar_horarios_disponiveis': {
        const r = await ctx.calendar.getSlots(args.data);
        if (r.error) return { erro: r.error };
        if (r.closed) return { data: r.date, dia: r.weekday, fechado: true, horarios: [] };
        return { data: r.date, dia: r.weekday, horarios: r.slots };
      }
      case 'agendar_horario': {
        if (!ctx.phone) return { erro: 'Telefone do cliente desconhecido; transfira para um humano.' };
        const appt = await ctx.calendar.book(
          {
            date: args.data,
            time: args.hora,
            name: args.nome,
            service: args.servico,
            notes: args.observacoes,
            email: args.email,
            phone: ctx.phone,
          },
          { dryRun: ctx.dryRun },
        );
        ctx.onBooked?.(appt);
        return { ok: true, id: appt.id, data: appt.date, hora: appt.time, servico: appt.service, nome: appt.name };
      }
      case 'listar_meus_agendamentos': {
        const list = ctx.phone ? ctx.calendar.listByPhone(ctx.phone) : [];
        return { agendamentos: list.map((a) => ({ id: a.id, data: a.date, hora: a.time, servico: a.service })) };
      }
      case 'cancelar_agendamento': {
        const appt = await ctx.calendar.cancel(args.id, ctx.phone, { dryRun: ctx.dryRun });
        return { ok: true, cancelado: { data: appt.date, hora: appt.time } };
      }
      case 'encaminhar_para_vendedor': {
        if (!ctx.onRoute) return { erro: 'Encaminhamento indisponível. Use transferir_para_humano.' };
        return await ctx.onRoute(args);
      }
      case 'encaminhar_para_especialista': {
        if (!ctx.onSpecialist) return { erro: 'Encaminhamento indisponível. Use transferir_para_humano.' };
        return await ctx.onSpecialist(args);
      }
      case 'transferir_para_humano': {
        ctx.onHandoff?.(args.motivo || '');
        return { ok: true, mensagem: 'Equipe avisada. Diga ao cliente que um atendente vai responder em breve.' };
      }
      default:
        return { erro: `Ferramenta desconhecida: ${name}` };
    }
  } catch (err) {
    return { erro: err.message };
  }
}
