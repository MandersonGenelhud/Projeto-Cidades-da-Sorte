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
      name: 'enviar_ficha_de_dados',
      description: 'Use assim que o cliente mostrar que quer mesmo fechar (ex.: "quero", "vamos fazer", "como faço para garantir"). Gera o link da ficha de dados pessoais (nome, CPF, RG, estado civil, endereço), já preenchida com o que sabemos. Quando ele enviar a ficha, o sistema manda sozinho a confirmação, o Pix da reserva e o termo da reserva para assinar.',
      parameters: {
        type: 'object',
        properties: {
          servico: { type: 'string', description: 'O que o cliente vai fazer (ex.: residência permanente - pacote Ouro)' },
          adultos: { type: 'number', description: 'Quantos adultos vão no processo, se ele disse' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'passar_fechamento_para_humano',
      description: 'Passa o cliente para o Marcos ou um vendedor FINALIZAR a negociação, com tudo mastigado. Use quando: (1) o cliente prefere fechar com uma pessoa; ou (2) você descobriu a última objeção que impede o fechamento, tentou contornar e não resolveu. O humano recebe o resumo completo no WhatsApp e a IA para de responder este cliente.',
      parameters: {
        type: 'object',
        properties: {
          resumo: { type: 'string', description: 'Quem é o cliente e o que ele quer, em até 3 frases' },
          pacote: { type: 'string', description: 'Pacote ou serviço escolhido' },
          pessoas: { type: 'number', description: 'Quantas pessoas no processo' },
          duvidas_esclarecidas: { type: 'string', description: 'As dúvidas que ele tinha e que você já respondeu' },
          objecao: { type: 'string', description: 'A última coisa que ainda impede o fechamento, nas palavras do cliente (vazio se ele só prefere fechar com uma pessoa)' },
          o_que_ja_foi_dito: { type: 'string', description: 'Como você tentou contornar a objeção e como ele reagiu' },
          sugestao: { type: 'string', description: 'Sua sugestão de solução para o humano apresentar e fechar' },
          moradia: { type: 'string', description: 'Plano de moradia no Paraguai, se ele disse (alugar, comprar terreno e construir, comprar imóvel)' },
          prefere: { type: 'string', enum: ['Marcos', 'vendedor', 'tanto faz'], description: 'Com quem ele prefere fechar' },
          temperatura: { type: 'string', enum: ['quente', 'morno', 'frio'] },
        },
        required: ['resumo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agendar_visita_escritorio',
      description: 'Registra o pedido de visita ao escritório da Migra aqui no Paraguai (ou de um encontro com o Marcos) e avisa o Marcos, que confirma o dia e o horário com o cliente. Use só depois de fazer a ressalva de vir preparado (documentos e valor para iniciar) e de saber a preferência de dia.',
      parameters: {
        type: 'object',
        properties: {
          nome: { type: 'string', description: 'Nome do cliente' },
          data_preferida: { type: 'string', description: 'Dia que o cliente prefere, nas palavras dele (ex.: "segunda, 10/11" ou "próxima semana")' },
          periodo: { type: 'string', description: 'manhã, tarde ou horário que ele disse' },
          pessoas: { type: 'number', description: 'Quantas pessoas vêm' },
          assunto: { type: 'string', description: 'O que ele quer resolver na visita (ex.: iniciar residência, pacote Ouro)' },
          preparado: { type: 'string', description: 'O que ele disse sobre vir com os documentos e o valor para iniciar' },
        },
        required: ['data_preferida', 'assunto'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'enviar_etapas_pagamento',
      description: 'Envia ao cliente o passo a passo do pagamento (fluxograma com a entrada e as 3 parcelas, valores e quando paga cada uma), calculado pela tabela. Use quando ele perguntar como funciona o pagamento, quanto paga em cada etapa, ou logo depois de fechar.',
      parameters: {
        type: 'object',
        properties: {
          pacote: { type: 'string', description: 'Nome do pacote (Inicial, Prata, Ouro, Empresa Unipersonal, Empresa EAS, Empresa S.A., Estudantil)' },
          pessoas: { type: 'number', description: 'Quantas pessoas no processo' },
          adultos: { type: 'number', description: 'Quantos adultos (a taxa das certidões é por adulto)' },
        },
        required: ['pacote', 'pessoas'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gerar_pix',
      description: 'Gera o Pix da reserva para o cliente pagar agora (o sistema envia o QR Code e o código copia e cola direto para ele). Use quando o cliente decidir fechar e já tiver passado o nome completo e o CPF. O valor é calculado pela regra da reserva; não invente valores.',
      parameters: {
        type: 'object',
        properties: {
          adultos: { type: 'number', description: 'Quantos adultos vão entrar no processo' },
          nome_pagador: { type: 'string', description: 'Nome completo de quem vai pagar (para o recibo)' },
          cpf_pagador: { type: 'string', description: 'CPF de quem vai pagar (para o recibo)' },
        },
        required: ['adultos', 'nome_pagador'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cliente_informou_pagamento',
      description: 'Use quando o cliente disser que já pagou o Pix ou mandar o comprovante. Avisa a equipe para conferir. Nunca diga que o pagamento foi confirmado: a confirmação chega pelo sistema, junto com o recibo.',
      parameters: {
        type: 'object',
        properties: { observacao: { type: 'string', description: 'O que o cliente disse' } },
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
      case 'enviar_ficha_de_dados': {
        if (!ctx.onForm) return { erro: 'Ficha indisponível. Use transferir_para_humano.' };
        return await ctx.onForm(args);
      }
      case 'passar_fechamento_para_humano': {
        if (!ctx.onCloseHandoff) {
          ctx.onHandoff?.(`Fechamento com humano: ${args.objecao || args.resumo || ''}`);
          return { ok: true, mensagem: 'Equipe avisada. Diga que um consultor vai finalizar com ele em instantes.' };
        }
        const r = await ctx.onCloseHandoff(args);
        if (r?.ok) ctx.pause?.(`Fechamento com ${r.quem || 'a equipe'}${args.objecao ? `: ${args.objecao}` : ''}`);
        return r;
      }
      case 'agendar_visita_escritorio': {
        if (!ctx.onVisit) return { erro: 'Agendamento de visita indisponível. Use transferir_para_humano.' };
        return await ctx.onVisit(args);
      }
      case 'enviar_etapas_pagamento': {
        if (!ctx.onPlan) return { erro: 'Indisponível. Explique o pagamento pela base.' };
        return await ctx.onPlan(args);
      }
      case 'gerar_pix': {
        if (!ctx.onPix) return { erro: 'Pagamento por Pix indisponível. Use encaminhar_para_vendedor.' };
        return await ctx.onPix(args);
      }
      case 'cliente_informou_pagamento': {
        if (!ctx.onPaidClaim) return { erro: 'Indisponível. Diga que a equipe vai conferir.' };
        return await ctx.onPaidClaim(args);
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
