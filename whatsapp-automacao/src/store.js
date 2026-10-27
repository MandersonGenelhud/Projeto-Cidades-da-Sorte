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
      autoAssign: 'none', // none (fica para a equipe) | roundrobin (rodízio entre vendedores)
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
      // Conversas sem resposta: considera mensagens dos últimos N dias.
      pendingMaxDays: 7,
      ...PRESET.agent,
    },
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
