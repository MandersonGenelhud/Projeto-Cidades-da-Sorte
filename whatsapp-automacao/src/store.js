// Banco de dados simples em arquivo JSON (sem dependências nativas).
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { DEFAULT_PRESET, presetSettings, presetUpgrade } from './agent/presets.js';

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
      ownerPhone: '', // WhatsApp do Marcos: contratação, parcerias e assuntos de negócio vão direto para ele
      codePrefix: 'MIG',
      fx: { USD: 5.5, PYG: 0.0007 }, // cotação usada só para somar vendas em R$ nos painéis
      // Assuntos que vão direto para um especialista (ex.: terrenos → Robson).
      specialists: (PRESET.crm?.specialists || []).map((x) => ({ ...x })),
      // Setores do Grupo Migra e os atendentes de cada um (Prospectos → Regras → Setores).
      sectors: {
        loteamentos: { label: 'Loteamentos e terrenos (Migra Imobiliária)', people: [] },
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
      // Ritmo humano: espera para "ver", ler e digitar; divide a resposta em mensagens curtas.
      humanize: { enabled: true, noticeMin: 5, noticeMax: 20 },
      // Conversas sem resposta: considera mensagens dos últimos N dias e responde sozinho.
      pendingMaxDays: 15, // a IA responde sozinha quem esperou até 15 dias
      pendingPerHour: 30, // modo cuidadoso: no máximo 30 respostas por hora para quem ficou esperando
      pendingHours: '7-21', // e só das 7h às 21h
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
    // Fechamento: ficha de dados → Pix → termo da reserva assinado no celular.
    closing: {
      enabled: true,
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
