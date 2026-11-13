// Banco de dados simples em arquivo JSON (sem dependências nativas).
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { applyTermsToSettings, applyTermsToPlan } from './payment-terms.js';
import { fixPhones } from './phone-fix.js';
import { DEFAULT_PRESET, CRISIS_KNOWLEDGE, GROUP_KNOWLEDGE, GROUP_BLOCK_V1, GROUP_BLOCK_V2, MIGRATECH_KNOWLEDGE, SCHOOL_KNOWLEDGE, presetSettings, presetUpgrade } from './agent/presets.js';

const PRESET = presetSettings(DEFAULT_PRESET);

const DEFAULT_DATA = {
  contacts: [],
  campaigns: [],
  rules: [],
  schedules: [],
  blacklist: [],
  uploads: [],
  logs: [],
  conversations: {},
  appointments: [],
  pending: {},
  users: [],
  leads: [],
  settings: {
    autoReplyEnabled: true,
    ignoreGroups: true,
    replyCooldownMinutes: 0,
    optOutKeywords: ['sair', 'parar', 'cancelar', 'stop'],
    optOutMessage: 'Pronto! Você não receberá mais mensagens nossas. Se mudar de ideia, envie VOLTAR.',
    optInKeywords: ['voltar'],
    optInMessage: 'Que bom ter você de volta! 🎉',
    welcomeEnabled: false,
    welcomeMessage: 'Olá {primeiro_nome}! 👋 Obrigado por entrar em contato.',
    businessHours: {
      enabled: false,
      days: [1, 2, 3, 4, 5],
      start: '08:00',
      end: '18:00',
      message: 'Estamos fora do horário de atendimento. Responderemos assim que possível! 🕗',
    },
    defaultDelayMin: 8,
    defaultDelayMax: 20,
    crm: {
      autoCreate: true, // cliente mandou mensagem → vira prospecto
      autoAssign: 'qualified', // qualified (rodízio depois da peneira da IA) | roundrobin (na 1ª mensagem) | none
      routing: { enabled: true, criteria: PRESET.crm?.routing?.criteria || '' },
      panelUrl: '', // endereço do painel na internet, para o link da ficha no aviso ao vendedor
      ownerPhone: '', // WhatsApp do Marcos: parcerias e assuntos de negócio vão direto para ele
      centralSellers: [], // vendedores que a Central direciona (nomes), em rodízio; vazio = rodízio comum de todos
      handoffMode: 'link', // 'link' = a Central entrega ao cliente o link do WhatsApp do vendedor (o cliente chama); 'ai' = a IA do vendedor chama o cliente
      mainAsCentral: true, // o número principal também é mesa de entrada: a IA pergunta só o interesse e encaminha ao rodízio dos vendedores
      centralWhatsapp: '', // WhatsApp da Central de Atendimento: os botões "Falar com um especialista" do site e da live abrem este número (vazio = rodízio direto entre vendedores)
      jobsContact: [{ name: 'Diego', whatsapp: '' }], // quem quer trabalhar na Migra (só o nome = WhatsApp da Equipe)
      mentoring: { enabled: true, price: 400, currency: 'USD', minutes: 60, priceBRL: 0 }, // priceBRL: valor do Pix em reais (0 = US$ × cotação do painel) // mentoria com o Marcos Miguel (único atendimento direto com ele)
      // Oferta do aplicativo de idiomas da Migra (ainda em desenvolvimento): só vale até a data que o Marcos escolher.
      flashOffer: { enabled: true, validUntil: '2026-11-12', spots: 20, months: 12, groupPeople: 0, title: 'Oferta relâmpago: as 20 primeiras pessoas que fecharem com a Migra e pagarem a entrada até quinta-feira, 12/11, ganham de presente 12 meses de aulas do aplicativo Migra School (espanhol na prática, do dia a dia).', conditions: 'as 20 primeiras pessoas que fecharem e pagarem a entrada até 12/11, em qualquer forma de pagamento aceita (à vista, cartão em até 3x ou entrada com etapas); o brinde é liberado depois que a equipe confirmar o pagamento da entrada.', reference: 'um ano de curso de idiomas em escolas tradicionais custa, em média, de R$ 3 mil a R$ 10 mil' },
      appOffer: { enabled: true, regularPrice: 59.99, discountPct: 50, months: 6, period: 'por mês', validUntil: '2026-12-25', gift: '' }, // oferta de Natal: vale até 25/12/2026
      codePrefix: 'MIG',
      fx: { USD: 5.5, PYG: 0.0007 }, // cotação usada só para somar vendas em R$ nos painéis
      // Assuntos que vão direto para um especialista (ex.: terrenos → Robson).
      specialists: (PRESET.crm?.specialists || []).map((x) => ({ ...x })),
      // Setores do Grupo Migra e os atendentes de cada um (Prospectos → Regras → Setores).
      sectors: {
        loteamentos: { label: 'Loteamentos e terrenos (Migra Imobiliária)', people: [], only: 'Diego' },
        documentacao: { label: 'Documentação e migração (Migra Paraguai)', people: [] },
        veiculos: { label: 'Veículos (Migra Motors)', people: [] },
      },
      requireConfirmation: true, // venda do vendedor só entra no ranking depois que o administrador confirma
      goals: {
        metric: 'sales', // sales (nº de vendas) | revenue (R$ vendido)
        target: 4, // meta mensal padrão por vendedor
        perUser: {}, // { idDoVendedor: meta }
        tiers: [
          { name: 'Bronze', percent: 100, reward: 'Bônus de R$ 300' },
          { name: 'Prata', percent: 130, reward: 'Bônus de R$ 600' },
          { name: 'Ouro', percent: 160, reward: 'Bônus de R$ 1.000 + folga' },
        ],
        team: { target: 15, reward: 'Churrasco da equipe' },
      },
      aiExtract: true, // IA lê as conversas e preenche o prospecto
      notifyFollowUps: true, // avisa o vendedor no WhatsApp no dia do retorno
      packages: (PRESET.crm?.packages || []).map((x) => ({ ...x })),
    },
    instagram: {
      enabled: false,
      accessToken: '', // token de longa duração do Instagram (renovado automaticamente)
      verifyToken: '',
      appSecret: '',
      graphVersion: 'v25.0',
      // Perfis do Grupo Migra: a atendente não responde (menções em story e recados entre as contas).
      manualDays: 30, // até quantos dias atrás a IA prepara respostas e retomadas para a equipe enviar pelo app
      ignoreUsers: ['migraimobiliaria', 'migra_motors', 'migracontabilidade', 'migraparaguai.londrina'],
    },
    connection: {
      mode: 'qr', // qr (WhatsApp Web) | cloud (API oficial da Meta)
      cloud: { accessToken: '', phoneNumberId: '', verifyToken: '', appSecret: '', graphVersion: 'v22.0' },
    },
    agent: {
      enabled: false,
      // Provedor de IA: gemini (Google, tem cota gratuita) ou openrouter (pago, qualquer modelo)
      provider: 'gemini',
      geminiKey: '',
      geminiModel: 'gemini-3.8-flash',
      apiKey: '', // chave do OpenRouter
      model: '~anthropic/claude-sonnet-latest', // modelo do OpenRouter
      temperature: 0.3,
      memoryMessages: 20,
      rulesFirst: true,
      // Modo de teste: o agente só responde os números abaixo (seguro para testar no WhatsApp real).
      audience: 'test', // test | all
      testNumbers: [],
      // Número da equipe que recebe um aviso no WhatsApp quando o agente transfere um atendimento.
      handoffNotifyPhone: '',
      // Se o dono responder um cliente pelo celular, o agente para de responder aquele cliente.
      pauseOnOwnerReply: true,
      // Pausa por "respondi pelo celular" termina sozinha depois de tantas horas sem o dono falar de novo (0 = nunca).
      resumeAfterOwnerHours: 2, // quando o CLIENTE volta a escrever e o dono ficou calado por este tempo, a IA responde (0 = nunca). A IA nunca toma a INICIATIVA depois que uma pessoa falou (outreach-guard).
      // Ritmo humano: espera para "ver", ler e digitar; divide a resposta em mensagens curtas.
      humanize: { enabled: true, noticeMin: 5, noticeMax: 20 },
      // Conversas sem resposta: considera mensagens dos últimos N dias e responde sozinho.
      pendingMaxDays: 30, // a IA responde sozinha quem esperou até 30 dias
      // Retorno automático para quem esperou: mensagem fixa (agradece, demanda alta, imprevistos, continuidade). minHours = quanto tempo de espera para enviar.
      backlogOpening: { enabled: true, minHours: 6, repeatDays: 7, template: '', templateNoDate: '' },
      pendingPerHour: 30, // modo cuidadoso: no máximo 30 respostas por hora para quem ficou esperando
      pendingHours: '7-23', // e só das 7h às 23h (igual ao horário de trabalho da IA)
      // Horário de trabalho da atendente de IA: todos os dias, das 7h às 23h. Fora dele ela não responde; a mensagem espera e é respondida quando abre.
      workHours: { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], start: '07:00', end: '23:00', message: '' },
      autoAnswerPending: true,
      ...PRESET.agent,
    },
    // Visitas ao escritório (o Marcos confirma pelo painel).
    visits: {
      enabled: true,
      address: '', // endereço do escritório, vai na confirmação
      hours: '', // dias e horários em que o Marcos costuma receber
      notifyPhone: '', // WhatsApp que recebe os pedidos (vazio = administradores)
      bring: '', // o que o cliente deve trazer (vazio = texto padrão)
      consultFeeUsd: 0, // taxa em dólares (US$); se > 0 vale no lugar da taxa em reais (o Pix sai em reais pela cotação do painel)
      consultFee: 250, // taxa de reserva do atendimento presencial: paga antes (Pix), estornada se o cliente fechar; 0 = sem taxa
      people: [], // quem cuida das visitas (Nome = WhatsApp, ou só o nome de quem está na Equipe)
    },
    // Orçamentos ORC-AAAA-NNNNN (PDF + mensagem). nextNumber continua a numeração que a Migra já usa.
    quotes: {
      nextNumber: 9767,
      validityDays: 7,
      consultant: '', // nome no orçamento quando não há vendedor dono da conversa
      phone: '', // WhatsApp no rodapé do PDF (vazio = telefone da empresa em Pagamentos)
      email: '',
      instagram: '@migraparaguayassessoria',
      address: '', // vazio = Santa Rita - Alto Paraná, Paraguai
    },
    // Contrato: dados da contratada (a assinatura sai como "Responsável: Migra Assessoria", sem nome de pessoa).
    contract: { company: 'MIGRA ASESORIA PARAGUAY E.A.S.', ruc: '80171751-5', address: 'Calle Las Palmeras, Edifício Domício 2, Santa Rita, Alto Paraná, República do Paraguai', signer: 'Migra Assessoria', city: 'Santa Rita, Alto Paraná', foro: 'Santa Rita, República do Paraguai', payee: 'Migra Paraguai Assessoria LTDA, CNPJ 58.521.546/0001-78' },
    // Segurança: duas etapas obrigatórias para todos (administrador e vendedores).
    security: { require2fa: true, backupDir: '' },
    // Controle de caixa (só administradores liberados): categorias das despesas e quem pode ver (vazio = todos os administradores).
    cash: { categories: [], allowedUserIds: [] },
    // Nina: secretária financeira por WhatsApp (texto e áudio). lineId = número só dela (vazio = o número principal, chamando "Nina").
    assistant: { enabled: true, wakeWord: 'nina', voiceReply: true, voice: 'Laomedeia', voiceStyle: '', lineId: '' },
    // Maria: assessora interna da equipe (número exclusivo). lineId vazio = o número cujo nome de atendente é "Maria". profiles: id do usuário → full | basic | own (vazio = padrão pelo cargo).
    maria: { enabled: true, name: 'Maria', lineId: '', voiceReply: true, wakeWords: ['atendente'], profiles: {}, support: { name: 'Manderson', phone: '5569993051671' } }, // support: quem atende o suporte do sistema, da IA e dos contratos (o Marcos não atende)
    // Ana: assistente pessoal (agenda e financeiro pessoal), no mesmo número da Maria, chamada por "Ana,". users vazio = todos os administradores.
    ana: { enabled: true, users: [], briefingTime: '04:30', voice: 'Aoede' },
    // Fechamento: ficha de dados → Pix → termo da reserva assinado no celular.
    closing: {
      enabled: true,
      contractFirst: true, // depois da ficha vai o contrato para assinar; o Pix da reserva só depois da assinatura (ordem do Marcos)
      termAfter: 'pix', // pix (logo depois do Pix) | payment (depois do pagamento confirmado)
      termTemplate: '', // vazio = modelo padrão
      sellerIfNoPix: true, // recebeu orçamento/ficha e não pagou a entrada: vai para o vendedor com o PDF
      sellerAfterHours: 24,
    },
    // Pix no fechamento (reserva) e recibo em nome da empresa.
    payments: {
      enabled: true,
      provider: 'pix', // pix (chave própria, confirmação manual) | mercadopago (confirmação automática)
      pixKey: PRESET.payments?.pixKey || '',
      receiverName: PRESET.payments?.receiverName || '', // nome do recebedor como está no banco (até 25 letras)
      receiverCity: '',
      company: { name: '', document: '', address: '', phone: '', email: '', ...PRESET.payments?.company },
      reservation: { base: 1000, perAdult: 800, description: 'reserva e início do processo (entrada + certidões)' },
      mercadopago: { accessToken: '', payerEmail: '' },
      bankInfo: '', // dados da conta (opcional), enviados junto com o Pix
      notifyPhone: '', // WhatsApp extra para o aviso de Pix (além dos administradores)
    },
    // Programa de indicação (afiliados). Comissão por linha de negócio, em % da venda + valor fixo.
    affiliates: {
      enabled: true,
      cookieDays: 180,
      rates: { imoveis: { percent: 0, fixed: 0 }, migracao: { percent: 0, fixed: 0 } },
      shareMessage: 'Oi, {nome}! Tudo bem? Agora sou parceiro(a) da Migra Paraguai 🇵🇾 Eles ajudam brasileiros a morar, investir e empreender no Paraguai: residência, cédula, empresa e também terrenos e imóveis. Se você ou alguém da sua família tem esse sonho, dá uma olhada: {link}',
    },
    // Nome e marca do painel (a logo fica em public/img ou é enviada em Configurações).
    brand: { name: 'Migra Hub', tagline: 'Atendimento e vendas · Migra Paraguai' },
    business: { ...PRESET.business },
    agenda: {
      enabled: PRESET.agenda.enabled, // o agente pode consultar/marcar horários
      provider: 'local', // local | calcom
      slotMinutes: 40,
      minAdvanceMinutes: 60,
      maxDaysAhead: 30,
      hours: { 0: '', 1: '08:00-18:00', 2: '08:00-18:00', 3: '08:00-18:00', 4: '08:00-18:00', 5: '08:00-18:00', 6: '08:00-12:00' },
      calcom: { apiKey: '', eventTypeId: '', timeZone: 'America/Sao_Paulo', defaultEmail: '' },
    },
  },
};

/** Mescla objetos de configuração em profundidade (sem mesclar arrays). */
export function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch === undefined ? base : patch;
  const out = { ...(base || {}) };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base?.[k] && typeof base[k] === 'object'
      ? deepMerge(base[k], v)
      : v;
  }
  return out;
}

const MAX_LOGS = 2000;

export class Store extends EventEmitter {
  constructor(dataDir) {
    super();
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'db.json');
    fs.mkdirSync(dataDir, { recursive: true });
    this.data = this.#load();
    this.saveTimer = null;
    // Base de conhecimento do perfil atualizada? Aplica sozinho, mantendo os ajustes do usuário.
    const upgrade = presetUpgrade(this.data.settings);
    if (upgrade) {
      this.data.settings = deepMerge(this.data.settings, upgrade.patch);
      this.upgradedPreset = upgrade.id;
      this.flush();
    }
    // O especialista de terrenos (Robson) vira atendente do setor de loteamentos.
    const crmS = this.data.settings.crm;
    const lots = crmS?.sectors?.loteamentos;
    if (lots && !lots.people?.length && !crmS.sectorsSeeded) {
      lots.people = (crmS.specialists || []).filter((x) => /terren|lote|im[oó]ve/i.test(x.topic) && x.name && x.whatsapp).map((x) => ({ name: x.name, whatsapp: x.whatsapp }));
      crmS.sectorsSeeded = true;
      this.flush();
    }
    // Nov/2026: a taxa do atendimento presencial passa de R$ 150 (cobrada depois, só de quem não fechava) para R$ 125 paga antes e estornada ao fechar.
    const vs = this.data.settings.visits;
    if (vs && !vs.fee125) {
      if (Number(vs.consultFee) === 150 || vs.consultFee === undefined) vs.consultFee = 125;
      vs.fee125 = true;
      this.flush();
    }
    // Correção: a taxa de reserva é R$ 150 (não R$ 125). Quem recebeu o valor errado passa para 150 uma vez.
    if (vs && !vs.fee150) {
      if (Number(vs.consultFee) === 125 || vs.consultFee === undefined) vs.consultFee = 150;
      vs.fee150 = true;
      this.flush();
    }
    // Nov/2026: valores novos (a barreira para ninguém querer ir ao escritório): visita R$ 250 e mentoria com o Marcos US$ 400. Aplica uma vez.
    const crmM = this.data.settings.crm;
    if (vs && !vs.fee250) {
      if (Number(vs.consultFee) === 150 || vs.consultFee === undefined) vs.consultFee = 250;
      vs.fee250 = true;
      this.flush();
    }
    if (crmM?.mentoring && !crmM.mentoring.price400) {
      if (Number(crmM.mentoring.price) === 250 || !crmM.mentoring.price) crmM.mentoring.price = 400;
      crmM.mentoring.price400 = true;
      this.flush();
    }
    const agP = this.data.settings.agent;
    if (agP && !agP.prices2026Nov) {
      for (const [k, v] of Object.entries(agP)) if (typeof v === 'string' && /(US\$ 250|250 dólares americanos|taxa de reserva de R\$ 150,00)/.test(v)) agP[k] = v.replace(/250 dólares americanos \(US\$ 250/g, '400 dólares americanos (US$ 400').replace(/taxa de reserva de R\$ 150,00/g, 'taxa de reserva de R$ 250,00');
      agP.prices2026Nov = true;
      this.flush();
    }
    // O RG é o documento necessário agora (de 10 anos para cá); o passaporte não o substitui. Corrige textos antigos gravados na base, uma vez.
    const ag = this.data.settings.agent;
    if (ag && !ag.rgFix2026) {
      const fix = (t) => t.replace(/RG \(ou passaporte\)/gi, 'RG (de 10 anos para cá; o passaporte não serve agora)').replace(/RG ou passaporte/gi, 'RG (de 10 anos para cá; o passaporte não serve agora)');
      for (const [k, v] of Object.entries(ag)) if (typeof v === 'string' && /RG (ou passaporte|\(ou passaporte\))/i.test(v)) ag[k] = fix(v);
      ag.rgFix2026 = true;
      this.flush();
    }
    // Nova divisão da equipe (Nov/2026): nada de vendas nem visitas para o Marcos.
    // Visitas → Silvani; migração → Camila e Fran; veículos → Eliezer; imobiliária → Diego (o Gabriel saiu da área de corretores em Nov/2026).
    // Só os nomes: o WhatsApp vem do cadastro de cada um na Equipe. Aplica uma vez (depois vale o painel).
    if (crmS && !crmS.teamRouting2026) {
      const people = (...names) => names.map((name) => ({ name, whatsapp: '' }));
      crmS.sectors ||= {};
      crmS.sectors.loteamentos = { ...(crmS.sectors.loteamentos || {}), people: people('Diego') };
      crmS.sectors.documentacao = { ...(crmS.sectors.documentacao || {}), people: people('Camila', 'Fran') };
      crmS.sectors.veiculos = { ...(crmS.sectors.veiculos || {}), people: people('Eliezer') };
      this.data.settings.visits = { ...(this.data.settings.visits || {}), people: people('Silvani') };
      for (const u of this.data.users || []) {
        if (/^marcos\b/i.test(String(u.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) Object.assign(u, { receivesLeads: false, receivesAffiliateLeads: false });
      }
      crmS.jobsContact = [{ name: 'Diego', whatsapp: '' }];
      crmS.teamRouting2026 = true;
      this.flush();
    }
    // Nov/2026: TODO assunto de terreno, lote e imóvel, de qualquer vendedor, vai só para o Diego.
    if (crmS && !crmS.lotsGabriel2026) {
      crmS.sectors ||= {};
      crmS.sectors.loteamentos = { ...(crmS.sectors.loteamentos || {}), only: 'Diego' };
      crmS.lotsGabriel2026 = true;
      this.flush();
    }
    // Nov/2026: como a atendente responde sobre a crise política e bancária do Paraguai (uma vez; depois o Marcos edita).
    // v2: o caso é do Ueno Bank (fintech); os bancos tradicionais seguem normais; Congresso e Justiça agem.
    const bizK = this.data.settings.business;
    if (bizK && /migra/i.test(bizK.name || '') && !this.data.settings.agent?.crisisMemory2026b) {
      const atual = String(bizK.knowledge || '');
      const i = atual.indexOf('# Momento político e bancário do Paraguai');
      if (i >= 0) {
        const j = atual.indexOf('\n# ', i + 5); // próximo título: o bloco termina antes dele
        bizK.knowledge = `${atual.slice(0, i)}${CRISIS_KNOWLEDGE}${j >= 0 ? atual.slice(j) : ''}`.trim();
      } else {
        bizK.knowledge = `${CRISIS_KNOWLEDGE}\n${atual.trim()}`.trim();
      }
      this.data.settings.agent ||= {};
      this.data.settings.agent.crisisMemory2026 = true;
      this.data.settings.agent.crisisMemory2026b = true;
      this.flush();
    }
    // Nov/2026: visão completa do Grupo Migra (o que opera e o que está em desenvolvimento). Se o bloco antigo não foi editado, é trocado;
    // se o Marcos já mexeu nele, o texto novo entra ANTES e o dele fica (nada é perdido).
    const bizG = this.data.settings.business;
    if (bizG && /migra/i.test(bizG.name || '') && !this.data.settings.agent?.groupMemory2026) {
      const cur = String(bizG.knowledge || '');
      const head = '# Grupo Migra: as empresas do grupo';
      const i = cur.indexOf(head);
      if (cur.includes('# Grupo Migra: visão completa')) {
        // já tem
      } else if (i >= 0) {
        const j = cur.indexOf('\n# ', i + 5);
        const block = cur.slice(i, j >= 0 ? j : undefined);
        const norm = (x) => String(x).replace(/\s+/g, ' ').trim();
        bizG.knowledge = norm(block) === norm(GROUP_BLOCK_V1)
          ? `${cur.slice(0, i)}${GROUP_KNOWLEDGE}${j >= 0 ? `\n${cur.slice(j)}` : ''}`.trim()
          : `${cur.slice(0, i)}${GROUP_KNOWLEDGE}\n(Se houver diferença entre o bloco acima e o bloco "as empresas do grupo" abaixo, vale o de cima, que é mais recente.)\n\n${cur.slice(i)}`.trim();
      } else {
        bizG.knowledge = `${cur.trim()}\n\n${GROUP_KNOWLEDGE}`.trim();
      }
      this.data.settings.agent ||= {};
      this.data.settings.agent.groupMemory2026 = true;
      this.flush();
    }
    // Nov/2026: Migra Tech (núcleo de inovação e tecnologia). Entra como bloco próprio, uma vez; edições do Marcos não são tocadas.
    const bizT = this.data.settings.business;
    if (bizT && /migra/i.test(bizT.name || '') && !this.data.settings.agent?.techMemory2026) {
      const cur = String(bizT.knowledge || '');
      if (!cur.includes('# Migra Tech:')) bizT.knowledge = `${cur.trim()}\n\n${MIGRATECH_KNOWLEDGE}`.trim();
      this.data.settings.agent ||= {};
      this.data.settings.agent.techMemory2026 = true;
      this.flush();
    }
    // Nov/2026: preço e finalidade da Migra School. O bloco do grupo é trocado só se não foi editado; o bloco da School entra uma vez.
    const bizS = this.data.settings.business;
    if (bizS && /migra/i.test(bizS.name || '') && !this.data.settings.agent?.schoolMemory2026) {
      let cur = String(bizS.knowledge || '');
      const i = cur.indexOf('# Grupo Migra: visão completa');
      if (i >= 0) {
        const j = cur.indexOf('\n# ', i + 5);
        const block = cur.slice(i, j >= 0 ? j : undefined);
        const norm = (x) => String(x).replace(/\s+/g, ' ').trim();
        if (norm(block) === norm(GROUP_BLOCK_V2)) cur = `${cur.slice(0, i)}${GROUP_KNOWLEDGE}${j >= 0 ? `\n${cur.slice(j)}` : ''}`;
      }
      if (!cur.includes('# Migra School: preço')) cur = `${cur.trim()}\n\n${SCHOOL_KNOWLEDGE}`;
      bizS.knowledge = cur.trim();
      this.data.settings.agent ||= {};
      this.data.settings.agent.schoolMemory2026 = true;
      this.flush();
    }
    // Nov/2026: a IA retoma conversas de até 30 dias (antes 15), para ninguém ficar para trás. Uma vez; depois vale o painel.
    // O Google aposenta modelos Gemini antigos (2.x e 1.x): quem ficou salvo neles trava a IA inteira. Troca pelo atual em toda inicialização.
    const agModel = this.data.settings.agent;
    if (agModel && /^gemini-[12]\./.test(String(agModel.geminiModel || ''))) {
      agModel.geminiModel = 'gemini-3.8-flash';
      this.flush();
    }
    // Regra nova de vencimento das parcelas (valores iguais): troca, uma vez, os textos antigos guardados (conhecimento da IA, planos enviados e orçamentos).
    if (!this.data.termsMigration2026) {
      applyTermsToSettings(this.data.settings);
      for (const rec of this.data.payplans || []) applyTermsToPlan(rec.plan);
      for (const rec of this.data.quotes || []) applyTermsToPlan(rec.plan);
      this.data.termsMigration2026 = true;
      this.flush();
    }
    // Telefones de clientes sem o +55 (só DDD + número): acrescenta o 55 do Brasil uma vez; cada mudança fica registrada em phoneFixLog.
    if (!this.data.phones55_2026) {
      const r = fixPhones(this);
      this.data.phones55_2026 = true;
      this.flush();
      if (r.count) this.addLog({ type: 'system', message: `Telefones: ${r.count} cadastro(s) de clientes ganharam o prefixo +55 do Brasil.` });
    }
    // Depois que o dono responde pelo celular, a IA voltava só após 6 h: vendas perdidas. Quem ainda está no padrão antigo passa a 2 h (uma vez).
    if (!this.data.ownerResume2026) {
      const agOwner = this.data.settings.agent;
      if (agOwner && Number(agOwner.resumeAfterOwnerHours) === 6) agOwner.resumeAfterOwnerHours = 2;
      this.data.ownerResume2026 = true;
      this.flush();
    }
    // Central de Atendimento (10/11/2026): os botões do site e da live abrem o número da Central, não o de um vendedor. Só em instalações que já têm usuários.
    if (!this.data.central2026) {
      const crmC = this.data.settings.crm;
      if (crmC && (this.data.users || []).length && !crmC.centralWhatsapp) crmC.centralWhatsapp = '595984453784';
            this.data.central2026 = true;
      this.flush();
    }
    // Ajuste (10/11/2026): a Central direciona para as VENDEDORAS (por papel, não por nome) e a IA volta a responder o cliente que escreve depois de horas sem o dono falar.
    if (!this.data.centralFix2026) {
      const crmF = this.data.settings.crm; const agF = this.data.settings.agent;
      if (crmF && JSON.stringify(crmF.centralSellers || []) === JSON.stringify(['Geovana', 'Fran'])) crmF.centralSellers = [];
      if (agF && Number(agF.resumeAfterOwnerHours) === 0) agF.resumeAfterOwnerHours = 2;
      for (const u of this.data.users || []) if (/^central\b/i.test(String(u.name || ''))) u.receivesLeads = false;
      this.data.centralFix2026 = true;
      this.flush();
    }
    // Rodízio configurado pela direção (11/11/2026): todos FORA do rodízio para a direção ligar um a um na Equipe. Exceções: Diego (só imóveis/loteamentos)
    // e Eliezer (só documentação). Marcos e Gabriel ficam desligados e sem área. As listas antigas de nomes dos setores passam para a marcação por pessoa
    // (para ninguém perder a área) e são esvaziadas, de modo que o botão "Pausar rodízio" de cada pessoa manda em tudo.
    if (!this.data.rodizio2026) {
      const nm = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
      const first = (u) => nm(u.name).split(' ')[0];
      const users = this.data.users || [];
      const secs = this.data.settings.crm?.sectors || {};
      for (const [sid, cfg] of Object.entries(secs)) {
        for (const p of cfg?.people || []) {
          const n = nm(p.name);
          const u = users.find((x) => n && (nm(x.name) === n || nm(x.name).startsWith(`${n} `)));
          if (u) u.sectors = [...new Set([...(u.sectors || []), sid])];
        }
        if (cfg) cfg.people = [];
      }
      for (const u of users) {
        const f = first(u);
        u.receivesLeads = false;
        if (f === 'diego') Object.assign(u, { receivesLeads: true, sectors: ['loteamentos'] });
        else if (f === 'eliezer') Object.assign(u, { receivesLeads: true, sectors: ['documentacao'] });
        else if (f === 'marcos' || f === 'gabriel') Object.assign(u, { receivesLeads: false, receivesAffiliateLeads: false, sectors: [] });
      }
      this.data.rodizio2026 = true;
      this.flush();
    }
    // Número novo do Marcos (13/11/2026): +595 982 543 275. Estava no cadastro de outra pessoa (a Maria e a Ana o chamavam de "Silvani").
    // Passa para o cadastro do Marcos (e como número do dono); de quem estava, o número é retirado e fica anotado.
    if (!this.data.marcosNovo2026) {
      const NOVO = '595982543275';
      const tail = (x) => String(x || '').replace(/\D/g, '').slice(-9);
      const fold = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const users = this.data.users || [];
      const marcos = users.find((u) => u.role === 'admin' && /^marcos\b/.test(fold(u.name)));
      if (marcos) {
        for (const u of users) {
          if (u.id !== marcos.id && u.whatsapp && tail(u.whatsapp) === tail(NOVO)) { u.whatsappAntigo = u.whatsapp; u.whatsapp = ''; u.whatsappRetiradoEm = new Date().toISOString(); }
        }
        if (marcos.whatsapp && tail(marcos.whatsapp) !== tail(NOVO)) marcos.whatsappAntigo = marcos.whatsapp;
        marcos.whatsapp = NOVO;
        const c = this.data.settings.crm;
        if (c) c.ownerPhone = NOVO;
        const fam = this.data.settings.ana?.family;
        if (Array.isArray(fam)) this.data.settings.ana.family = fam.filter((f) => tail(f.whatsapp) !== tail(NOVO));
      }
      this.data.marcosNovo2026 = true;
      this.flush();
    }
    // Pedido da direção (13/11/2026): o Manderson recebe cópia de tudo o que é avisado ao Marcos.
    if (!this.data.copiaManderson2026) {
      const c = this.data.settings.crm;
      if (c && !(c.copyToPhones || []).length) c.copyToPhones = ['5569993051671'];
      this.data.copiaManderson2026 = true;
      this.flush();
    }
    // Regra da direção (12/11/2026): só os leads NOVOS (de ontem, 11/11, em diante) recebem iniciativa nossa; os antigos nunca são procurados de novo.
    if (!this.data.novosLeads2026) {
      const c = this.data.settings.crm;
      if (c && !c.outreachSince) c.outreachSince = '2026-11-11T03:00:00.000Z'; // 11/11/2026 00:00 no Paraguai
      this.data.novosLeads2026 = true;
      this.flush();
    }
    // Regra da direção (10/11/2026): depois que uma pessoa falou com o cliente, a IA não volta sozinha. Uma vez, tira o prazo de retomada automática.
    if (!this.data.humanRule2026) {
      const agH = this.data.settings.agent;
      void agH; // (a retomada do cliente que volta a escrever foi mantida; ver centralFix2026)
      this.data.humanRule2026 = true;
      this.flush();
    }
    // Oferta relâmpago com vagas limitadas (20, Prata ou Ouro, à vista): troca uma vez o texto da versão anterior, sem mexer no que a direção já tiver ajustado nas datas e vagas.
    if (!this.data.flash2026b) {
      const crmF = this.data.settings.crm;
      if (crmF?.flashOffer && !crmF.flashOffer.spots) {
        const def = DEFAULT_DATA.settings?.crm?.flashOffer;
        if (def) crmF.flashOffer = { ...crmF.flashOffer, spots: def.spots, groupPeople: crmF.flashOffer.groupPeople || 0, title: def.title, conditions: def.conditions };
      }
      this.data.flash2026b = true;
      this.flush();
    }
    if (!this.data.flash2026c) {
      const fx = this.data.settings.crm?.flashOffer;
      const def2 = DEFAULT_DATA.settings?.crm?.flashOffer;
      if (fx && def2) fx.conditions = def2.conditions;
      this.data.flash2026c = true;
      this.flush();
    }
    if (!this.data.flash2026d) {
      const fy = this.data.settings.crm?.flashOffer;
      const def3 = DEFAULT_DATA.settings?.crm?.flashOffer;
      if (fy && def3) Object.assign(fy, { title: def3.title, conditions: def3.conditions, semesterMonths: def3.semesterMonths });
      this.data.flash2026d = true;
      this.flush();
    }
    // Oferta relâmpago estendida a todos (decisão da direção): quem pagar a entrada até a data ganha os 12 meses; sem limite de vagas.
    if (!this.data.flash2026e) {
      const fz = this.data.settings.crm?.flashOffer;
      const def4 = DEFAULT_DATA.settings?.crm?.flashOffer;
      if (fz && def4) Object.assign(fz, { title: def4.title, conditions: def4.conditions, spots: 0, months: 12 });
      this.data.flash2026e = true;
      this.flush();
    }
    // Oferta limitada às 20 primeiras pessoas (informação do Marcos, 09/11/2026): o limite é real e contado pelo sistema.
    if (!this.data.flash2026f) {
      const fw = this.data.settings.crm?.flashOffer;
      const def5 = DEFAULT_DATA.settings?.crm?.flashOffer;
      if (fw && def5) Object.assign(fw, { title: def5.title, conditions: def5.conditions, spots: 20, months: 12 });
      this.data.flash2026f = true;
      this.flush();
    }
    // Gatilhos de venda confirmados pela direção (Marcos): alta procura/fila e possibilidade de reajuste (sem data nem percentual, nada inventado).
    // Só preenche se o campo estiver vazio; o que a direção escreveu depois não é tocado.
    if (!this.data.triggers2026) {
      const bizG = this.data.settings.business;
      if (bizG && /migra/i.test(bizG.name || '')) {
        if (!String(bizG.demand || '').trim()) bizG.demand = 'A procura está alta: trabalhamos com fila de espera e há muitas pessoas querendo mudar de vida e aproveitando essa oportunidade para fazer a migração.';
        if (!String(bizG.priceIncrease || '').trim()) bizG.priceIncrease = 'Por causa da alta procura, é possível que taxas e valores sejam reajustados no futuro. Não há data nem percentual definidos: diga sempre "é possível", nunca "vai aumentar", e nunca cite data ou valor de reajuste.';
      }
      this.data.triggers2026 = true;
      this.flush();
    }
    const agDays = this.data.settings.agent;
    if (agDays && !agDays.pendingDays2026) {
      if (!(Number(agDays.pendingMaxDays) > 30)) agDays.pendingMaxDays = 30;
      agDays.pendingDays2026 = true;
      this.flush();
    }
    // Nov/2026: a atendente de IA trabalha todos os dias, das 7h às 23h (a fila de quem esperou segue o mesmo horário). Uma vez; depois vale o painel.
    const agW = this.data.settings.agent;
    if (agW && !agW.workHours2026) {
      agW.workHours = { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], start: '07:00', end: '23:00', message: '' };
      agW.pendingHours = '7-23';
      agW.workHours2026 = true;
      this.flush();
    }
    // Nov/2026: o Gabriel saiu da área de corretores; quem cuida de imóveis é só o Diego. Para quem já tinha as regras antigas:
    // setor Loteamentos (só o Diego), contato de vagas, especialistas, a área da pessoa e o que a atendente "sabe" (nunca cita o Gabriel).
    if (crmS && !crmS.corretorDiego2026) {
      const fold1 = (n) => String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      const isGab = (n) => /^gabriel\b/i.test(fold1(n));
      const users = this.data.users || [];
      const gabIds = new Set(users.filter((u) => isGab(u.name)).map((u) => u.id));
      const nameOf = (x) => (typeof x === 'string' ? users.find((u) => u.id === x)?.name : x?.name);
      const sec = crmS.sectors?.loteamentos;
      if (sec) {
        if (isGab(sec.only)) sec.only = 'Diego';
        if (Array.isArray(sec.people)) {
          sec.people = sec.people.filter((x) => !(typeof x === 'string' ? gabIds.has(x) : isGab(x?.name) || gabIds.has(x?.id)));
          if (!sec.people.some((x) => /^diego\b/i.test(fold1(nameOf(x))))) sec.people.push({ name: 'Diego', whatsapp: '' });
        }
      }
      if (Array.isArray(crmS.jobsContact)) {
        const j = crmS.jobsContact.map((x) => (isGab(x?.name) ? { ...x, name: 'Diego' } : x));
        crmS.jobsContact = j.filter((x, i) => j.findIndex((y) => fold1(y?.name).toLowerCase() === fold1(x?.name).toLowerCase()) === i);
      }
      if (Array.isArray(crmS.specialists)) for (const sp of crmS.specialists) if (isGab(sp?.name)) sp.name = 'Diego';
      for (const u of users) if (gabIds.has(u.id) && Array.isArray(u.sectors)) u.sectors = u.sectors.filter((x) => x !== 'loteamentos');
      const noGab = (t) => String(t).replace(/\bGabriel e (?:o )?Diego\b/g, 'Diego').replace(/\bDiego e (?:o )?Gabriel\b/g, 'Diego').replace(/\bGabriel\b/g, 'Diego');
      const biz = this.data.settings.business;
      if (biz && typeof biz.knowledge === 'string' && /\bGabriel\b/.test(biz.knowledge)) biz.knowledge = noGab(biz.knowledge);
      for (const [k, v] of Object.entries(this.data.settings.agent || {})) if (typeof v === 'string' && /\bGabriel\b/.test(v)) this.data.settings.agent[k] = noGab(v);
      for (const l of this.data.learnings || []) if (typeof l?.text === 'string' && /\bGabriel\b/.test(l.text)) l.text = noGab(l.text);
      crmS.corretorDiego2026 = true;
      this.flush();
    }
    // Nov/2026: memória da atendente sobre CNH x licença paraguaia (quem vai morar precisa da licença: Ouro, não Prata).
    const biz = this.data.settings.business;
    if (biz && /migra/i.test(biz.name || '') && !this.data.settings.agent?.cnhMemory2026) {
      const cnh = 'Minha CNH brasileira serve para dirigir no Paraguai? Muitos clientes acham que a CNH brasileira basta e por isso escolhem o Prata. Para quem vai MORAR no Paraguai, a licença de condução paraguaia é necessária: o pacote certo é o Ouro, que já inclui a licença (carro ou moto). Quando o cliente disser que vai residir e escolher o Prata por causa da CNH, explique isso com calma e recomende o Ouro. Não invente prazos, multas ou regras de trânsito que não estão aqui.';
      if (!String(biz.faq || '').includes('CNH brasileira serve')) biz.faq = `${String(biz.faq || '').trim()}\n${cnh}`.trim();
      this.data.settings.agent ||= {};
      this.data.settings.agent.cnhMemory2026 = true;
      this.flush();
    }
    // Nov/2026: as duas Assessorias Prime entram na lista de pacotes do orçamento (uma vez; depois vale o que o Marcos editar).
    if (crmS && !crmS.primePackages2026) {
      crmS.packages ||= [];
      for (const p of [{ name: 'Assessoria Prime R$ 2.750', price: 2750 }, { name: 'Assessoria Prime R$ 1.560', price: 1560 }]) {
        if (!crmS.packages.some((x) => x.name === p.name)) crmS.packages.push(p);
      }
      crmS.primePackages2026 = true;
      this.flush();
    }
    // Instalações antigas vinham com 7 dias: passa para 15 uma vez (depois vale o que o Marcos escolher).
    const a = this.data.settings.agent;
    if (a && !a.pendingDays15) {
      if (Number(a.pendingMaxDays || 7) < 15) a.pendingMaxDays = 15;
      a.pendingDays15 = true;
      this.flush();
    }
  }

  #load() {
    const base = structuredClone(DEFAULT_DATA);
    if (!fs.existsSync(this.file)) return base;
    try {
      const loaded = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return {
        ...base,
        ...loaded,
        settings: deepMerge(base.settings, loaded.settings || {}),
      };
    } catch (err) {
      const backup = `${this.file}.corrompido-${Date.now()}`;
      fs.copyFileSync(this.file, backup);
      console.error(`db.json inválido, backup salvo em ${backup}:`, err.message);
      return base;
    }
  }

  /** Agenda a gravação para agrupar várias alterações seguidas. */
  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 200);
  }

  flush() {
    clearTimeout(this.saveTimer);
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  get settings() {
    return this.data.settings;
  }

  updateSettings(patch) {
    this.data.settings = deepMerge(this.data.settings, patch);
    this.save();
    return this.data.settings;
  }

  isBlacklisted(phone) {
    return this.data.blacklist.includes(phone);
  }

  addToBlacklist(phone) {
    if (!this.isBlacklisted(phone)) {
      this.data.blacklist.push(phone);
      this.save();
    }
  }

  removeFromBlacklist(phone) {
    this.data.blacklist = this.data.blacklist.filter((p) => p !== phone);
    this.save();
  }

  addLog(entry) {
    const log = { at: new Date().toISOString(), ...entry };
    this.data.logs.push(log);
    if (this.data.logs.length > MAX_LOGS) this.data.logs.splice(0, this.data.logs.length - MAX_LOGS);
    this.save();
    this.emit('log', log);
    return log;
  }
}
