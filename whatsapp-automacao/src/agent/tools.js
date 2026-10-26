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
      parameters: { type: 'object', properties: {} },
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
