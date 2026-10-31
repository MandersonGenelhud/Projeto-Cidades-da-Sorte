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
      description: 'Só quando o cliente INSISTIR em falar com uma pessoa ou continuar com receio depois de você tentar de tudo: você mesma fecha a venda. O sistema escolhe o vendedor da vez, envia o resumo para ele e devolve o link do WhatsApp do vendedor para você mandar ao cliente. Preencha só com o que o cliente realmente disse; não invente.',
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
          interesse_real: { type: 'string', description: 'O que ele realmente quer conquistar (o motivo por trás: família, segurança, impostos, empreender…)' },
          situacao_atual: { type: 'string', description: 'Como está a vida dele hoje (trabalho, família, dinheiro, prazo), pelo que ele contou' },
          dica_de_fechamento: { type: 'string', description: 'Qual técnica de fechamento usar com este cliente e por quê (ex.: fechamento por resumo, alternativo, prova social, história do Marcos)' },
          sugestao: { type: 'string', description: 'Sugestão concreta para o atendente finalizar a venda' },
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
      description: 'ÚLTIMO recurso. Você mesma fecha a venda: tire as dúvidas, contorne as objeções, mande orçamento e ficha. Use isto SÓ quando: (1) depois de tentar (história do Marcos, prova social, segurança do termo e do recibo), o cliente ainda tiver receio de fechar pela conversa ou insistir em falar com uma pessoa; ou (2) ele recebeu o orçamento mas não consegue pagar a entrada no Pix agora. O vendedor recebe a prévia da conversa, as dicas de fechamento e o PDF do orçamento; você continua disponível para o cliente.',
      parameters: {
        type: 'object',
        properties: {
          resumo: { type: 'string', description: 'Sobre o cliente: quem é e o que quer, em até 3 frases' },
          interesse_real: { type: 'string', description: 'O interesse real dele (o motivo por trás: família, segurança, impostos, empreender…)' },
          situacao_atual: { type: 'string', description: 'A situação atual dele (trabalho, família, dinheiro, prazo), pelo que ele contou' },
          pacote: { type: 'string', description: 'Pacote ou serviço de interesse' },
          pessoas: { type: 'number', description: 'Quantas pessoas no processo' },
          duvidas_esclarecidas: { type: 'string', description: 'As dúvidas que ele tinha e que você já respondeu' },
          objecao: { type: 'string', description: 'O receio que ainda impede, nas palavras do cliente' },
          o_que_ja_foi_dito: { type: 'string', description: 'Como você tentou contornar e como ele reagiu' },
          dica_de_fechamento: { type: 'string', description: 'A técnica de fechamento que mais combina com este cliente e por quê' },
          sugestao: { type: 'string', description: 'Sugestão concreta para o atendente finalizar a venda' },
          moradia: { type: 'string', description: 'Plano de moradia no Paraguai, se ele disse (alugar, comprar terreno e construir, comprar imóvel)' },
          temperatura: { type: 'string', enum: ['quente', 'morno', 'frio'] },
        },
        required: ['resumo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gerar_orcamento',
      description: 'Gera o orçamento oficial da Migra (número ORC, PDF com a marca e o resumo no WhatsApp: serviços, total, entrada e parcelas com datas) e envia ao cliente. Use quando ele pedir orçamento, perguntar quanto fica para a família ou para mais de um pacote. O sistema calcula tudo pela tabela; não faça contas por conta própria.',
      parameters: {
        type: 'object',
        properties: {
          itens: {
            type: 'array',
            description: 'Pacotes e quantas pessoas em cada um',
            items: {
              type: 'object',
              properties: {
                pacote: { type: 'string', description: 'Inicial, Prata, Ouro, Empresa Unipersonal, Empresa EAS, Empresa S.A. ou Estudantil' },
                quantidade: { type: 'number', description: 'Quantas pessoas nesse pacote' },
              },
              required: ['pacote', 'quantidade'],
            },
          },
          adultos: { type: 'number', description: 'Quantos adultos no total (a taxa das certidões é por adulto)' },
          nome: { type: 'string', description: 'Nome do cliente para o orçamento' },
        },
        required: ['itens'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'enviar_contrato',
      description: 'Gera o contrato de prestação de serviços (já preenchido com os dados do cliente e o orçamento) e envia o link para ele assinar pelo celular. Use quando o cliente PEDIR o contrato. Se ainda faltarem os dados pessoais, o sistema devolve o link da ficha: mande ao cliente, e o contrato sai sozinho quando ele preencher. Se ainda não houver orçamento, informe o pacote e as pessoas.',
      parameters: {
        type: 'object',
        properties: {
          itens: {
            type: 'array',
            description: 'Só se ainda não houver orçamento: pacotes e quantas pessoas em cada um',
            items: {
              type: 'object',
              properties: {
                pacote: { type: 'string' },
                quantidade: { type: 'number' },
              },
              required: ['pacote', 'quantidade'],
            },
          },
          adultos: { type: 'number', description: 'Quantos adultos no total (se souber)' },
          nome: { type: 'string', description: 'Nome do cliente (se souber)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'levar_para_whatsapp',
      description: 'Só no Instagram: quando o cliente passar o WhatsApp, o sistema chama ele no WhatsApp da Migra continuando a conversa (lá o fechamento é completo e não tem o limite de 24h do Instagram).',
      parameters: {
        type: 'object',
        properties: {
          whatsapp: { type: 'string', description: 'Número que o cliente passou, com DDD (e +código do país se não for do Brasil)' },
          nome: { type: 'string', description: 'Nome do cliente, se souber' },
          primeira_mensagem: { type: 'string', description: 'A primeira mensagem no WhatsApp: cumprimente pelo nome, diga que é da Migra continuando a conversa do Instagram e já dê o próximo passo (sem pergunta de sim ou não). Até 300 caracteres.' },
        },
        required: ['whatsapp'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reservar_mentoria',
      description: 'Reserva a mentoria de 1 hora com o Marcos Miguel. O cliente escolhe online ou presencial e a forma de pagamento (Pix ou cartão). Quem JÁ É CLIENTE da Migra não paga (o sistema confere). Para os demais, o pagamento vem antes do agendamento: o Pix é gerado e enviado na hora; no cartão a equipe manda o link. Depois de pago, a assessoria do Marcos escolhe o dia e o horário (dentro do prazo do cliente) e confirma com ele.',
      parameters: {
        type: 'object',
        properties: {
          formato: { type: 'string', enum: ['online', 'presencial'], description: 'Como o cliente quer a mentoria' },
          pagamento: { type: 'string', enum: ['pix', 'cartao'], description: 'Forma de pagamento escolhida (ignorada para quem já é cliente)' },
          assunto: { type: 'string', description: 'O que ele quer conversar com o Marcos, em até 2 frases' },
          prazo_para_agendar: { type: 'string', description: 'Até que dia a mentoria precisa ser agendada (o prazo do cliente). NÃO é dia e horário: quem escolhe é a equipe do Marcos' },
          nome: { type: 'string', description: 'Nome completo de quem vai pagar (para o recibo)' },
          cpf: { type: 'string', description: 'CPF de quem vai pagar (só se for Pix)' },
        },
        required: ['formato'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'direcionar_para_setor',
      description: 'Direciona o cliente para o atendente do setor certo do Grupo Migra, que recebe o resumo no WhatsApp e entra em contato com o cliente. Use para loteamentos/terrenos/imóveis (inclusive quem quer falar com o dono de um loteamento) e para veículos, depois de entender o básico do que ele procura.',
      parameters: {
        type: 'object',
        properties: {
          setor: { type: 'string', enum: ['loteamentos', 'veiculos', 'documentacao'], description: 'loteamentos = terrenos, lotes, casas e imóveis (Migra Imobiliária); veiculos = carros e motos (Migra Motors); documentacao = residência, cédula e migração' },
          resumo: { type: 'string', description: 'O que o cliente quer, em até 2 frases' },
          detalhes: { type: 'string', description: 'O que ele já disse: cidade ou loteamento, tamanho, orçamento, prazo, modelo do veículo…' },
          nome: { type: 'string', description: 'Nome do cliente, se ele disse' },
          telefone: { type: 'string', description: 'WhatsApp do cliente (peça no Instagram, onde não temos o número)' },
        },
        required: ['setor', 'resumo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agendar_retorno',
      description: 'Quando o cliente disser "mais pra frente", "vou pensar", "depois eu vejo" e você já tentou contornar: combine com ele um dia e horário exatos e registre aqui. No dia, o sistema retoma a conversa sozinho com o cliente. Use só depois que ele concordar com a data.',
      parameters: {
        type: 'object',
        properties: {
          data: { type: 'string', description: 'Dia combinado, no formato AAAA-MM-DD (até 12 meses)' },
          hora: { type: 'string', description: 'Horário combinado, HH:MM (entre 08:00 e 20:00)' },
          motivo: { type: 'string', description: 'Por que ele pediu para esperar, nas palavras dele' },
          o_que_falta: { type: 'string', description: 'O que falta para fechar e qual o próximo passo no retorno (ex.: receber o salário dia 10 e pagar a entrada)' },
        },
        required: ['data', 'motivo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'avisar_marcos',
      description: 'Para assuntos que não são venda de pacote: quem quer trabalhar na Migra (contratação, currículo, vaga: vai para o Gabriel, da equipe), propostas de parceria de negócio, fornecedores, imprensa ou investidores (vão para o Marcos); e quem quer a mentoria paga com o Marcos (assunto "mentoria"). Avisa no WhatsApp com o resumo.',
      parameters: {
        type: 'object',
        properties: {
          assunto: { type: 'string', enum: ['contratação', 'parceria de negócio', 'fornecedor', 'imprensa', 'mentoria', 'outro'] },
          resumo: { type: 'string', description: 'O que a pessoa quer, em até 3 frases' },
          nome: { type: 'string', description: 'Nome da pessoa ou da empresa' },
        },
        required: ['assunto', 'resumo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agendar_visita_escritorio',
      description: 'Registra o pedido de visita ao escritório da Migra aqui no Paraguai (consultoria presencial com a equipe) e avisa quem cuida das visitas, que confirma o dia e o horário com o cliente. Use só depois de fazer a ressalva de vir preparado (documentos e valor para iniciar) e de saber a preferência de dia.',
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
        // A IA continua disponível: o atendente do escritório recebe tudo e entra junto.
        return await ctx.onCloseHandoff(args);
      }
      case 'gerar_orcamento': {
        if (!ctx.onQuote) return { erro: 'Orçamento indisponível. Use enviar_etapas_pagamento.' };
        return await ctx.onQuote(args);
      }
      case 'reservar_mentoria': {
        if (!ctx.onMentoring) return { erro: 'Indisponível agora. Use avisar_marcos com assunto "mentoria".' };
        return await ctx.onMentoring(args);
      }
      case 'levar_para_whatsapp': {
        if (!ctx.onMoveToWhatsapp) return { erro: 'Indisponível agora. Siga a conversa por aqui mesmo.' };
        return await ctx.onMoveToWhatsapp(args);
      }
      case 'enviar_contrato': {
        if (!ctx.onContract) return { erro: 'Contrato indisponível por aqui. Use passar_fechamento_para_humano (ou transferir_para_humano) para a equipe enviar.' };
        return await ctx.onContract(args);
      }
      case 'direcionar_para_setor': {
        if (!ctx.onSector) return { erro: 'Indisponível. Use avisar_marcos.' };
        return await ctx.onSector(args);
      }
      case 'agendar_retorno': {
        if (!ctx.onReturn) return { erro: 'Indisponível. Use passar_fechamento_para_humano.' };
        return await ctx.onReturn(args);
      }
      case 'avisar_marcos': {
        if (!ctx.onOwner) {
          ctx.onHandoff?.(`Para o Marcos (${args.assunto}): ${args.resumo}`);
          return { ok: true, mensagem: 'Aviso enviado. Diga que passou o assunto para o Marcos.' };
        }
        return await ctx.onOwner(args);
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
