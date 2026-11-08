// Servidor HTTP: API REST + painel web + webhook da Meta.
// Fuso do negócio: agenda, horários e "hoje" do agente usam este fuso.
process.env.TZ ||= 'America/Sao_Paulo';

import './patch-baileys.js'; // antes da biblioteca do WhatsApp carregar
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import QRCode from 'qrcode';
import { Store } from './store.js';
import { WhatsAppClient } from './transports/whatsapp-web.js';
import { CloudApiClient } from './transports/cloudapi.js';
import { InstagramClient } from './transports/instagram.js';
import { ConnectionManager } from './connection.js';
import { CampaignRunner } from './campaigns.js';
import { AutoReply } from './autoreply.js';
import { Scheduler } from './scheduler.js';
import { PendingInbox, extractPending, extractStalled } from './pending.js';
import { LeadRouter, chatPreview } from './routing.js';
import { buildRanking, currentMonth } from './ranking.js';
import { clearDemo, hasDemo, loadDemo } from './demo.js';
import { Tunnel } from './tunnel.js';
import { makeContractFlow, contractReady, CONTRACT_REQUIRED } from './autocontract.js';
import { makeSellerCommands } from './seller-commands.js';
import { Learnings } from './learnings.js';
import { ReceiptReader } from './receipts.js';
import { OWNER_PAUSE } from './agent/agent.js';
import { Migratech } from './migratech.js';
import { Contabil } from './contabil.js';
import { AppSignups, APPS as SIGNUP_APPS } from './app-signups.js';
import { Cash, METHODS as CASH_METHODS, CURRENCIES as CASH_CURRENCIES, SCOPE_LABELS as CASH_SCOPE_LABELS, BOOKS as CASH_BOOKS, toCsv as cashToCsv } from './cash.js';
import { Nina } from './assistant.js';
import { Maria, PROFILES as MARIA_PROFILES } from './maria.js';
import { Ana } from './ana.js';
import { Personal } from './personal.js';
import { Portfolio } from './portfolio.js';
import { makeOutbound, findRecentQuote, filledNotice } from './maria-outbound.js';
import { groupLiveBrief, HUB_OVERVIEW, STAFF_RULES } from './group-brief.js';
import { HttpStt, HttpTts, GeminiStt, FallbackStt, GeminiTts, ChoiceTts, GEMINI_VOICES } from './voice.js';
import { Payments } from './payments.js';
import { Realty, PROPERTY_TYPES } from './realty.js';
import { Audit } from './audit.js';
import { byAttendant, attendantOf } from './attendants.js';
import { registerControleRoutes } from './routes/controle.js';
import { makeContractorSigner } from './routes/assinatura-contratada.js';
import { makeContractPix } from './contract-pix.js';
import { fullConversation, clientBrief } from './lead-brief.js';
import { fichaPedido } from './ficha-text.js';
import { slaCheck } from './distribution.js';
import { moveOldCorretorLeads } from './maintenance.js';
import { LegacyContracts, cashRowsFromCapture } from './legacy-import.js';
import { buildBat, buildSiteBat } from './legacy-tool.js';
import { Ingest, MIME as FILE_MIME } from './legacy-ingest.js';
import { Resumes, MIME_BY_EXT } from './resumes.js';
import { VideoCalls, priceSeen } from './videocalls.js';
import { Live } from './live.js';
import { Recordings } from './recordings.js';
import { Tutorials } from './tutorials.js';
import { Cities, CATEGORIES as CITY_CATEGORIES } from './cities.js';
import { Marketing, PRESETS as MKT_PRESETS } from './marketing.js';
import { Collections } from './collections.js';
import { Customer360 } from './customer360.js';
import { Tasks } from './tasks.js';
import { Commitments } from './commitments.js';
import { ContractCards } from './contract-cards.js';
import { Alerts } from './alerts.js';
import { Documents, TYPES as DOC_TYPES } from './documents.js';
import { Usage, DEFAULT_PRICING, cleanPricing, priceModel, historyReport } from './usage.js';
import { OFFICE_IDS, normOffice, officeOfUser, sees, officeList } from './offices.js';
import { crossSiteBlocked } from './csrf.js';
import { siteGuard, siteHostsFrom, siteOfficeMap, hostOf } from './site-host.js';
import { mergeContent, sanitizeContent, renderHome, renderPremium } from './site-content.js';
import { buildExecutive, periods as execPeriods, dayStr } from './executive.js';
import { Reengage, rowsFrom, leadRowsFromApi, TEMPLATES as REENGAGE_TEMPLATES } from './reengage.js';
import { Motors } from './motors.js';
import { School } from './school.js';
import { Proposals, simulate as finSimulate, options as finOptions, schedule as finSchedule, isConfigured as finConfigured } from './finance.js';
import { Affiliates } from './affiliates.js';
import { LineManager, lineKey, matchSeller, parseLineKey } from './lines.js';
import { Closing, DEFAULT_TERM } from './closing.js';
import { humanizeConfig, splitIntoBubbles } from './humanize.js';
import { Visits, DEFAULT_BRING } from './visits.js';
import { PayPlans, planMessage } from './payplan.js';
import { Quotes } from './quotes.js';
import { Sales } from './sales.js';
import { contractPdf } from './contract.js';
import { parseJsonObject } from './crm-ai.js';
import { collectHandoffs, digestMessage } from './digest.js';
import { searchConversations } from './convsearch.js';
import { ServiceCatalog, CATEGORIES as SERVICE_CATEGORIES } from './services.js';
import { Commissions } from './commissions.js';
import { Support, SLA as SUPPORT_SLA } from './support.js';
import { ContractTemplates, importLessons, importTeamContacts } from './legacy-extras.js';
import { PartnerProjects } from './partner-projects.js';
import { AffiliateExtras } from './affiliate-extras.js';
import { reportCsv, auditCsv, REPORTS } from './reports-csv.js';
import { buildScreenMap, compareMap } from './legacy-map.js';
import { Sectors, resolvePeople, isOwner } from './sectors.js';
import { LoginGuard, newTotpSecret, otpauthUrl, verifyTotp } from './security.js';
import { Backups } from './backup.js';
import { AutoFollowUps } from './followups.js';
import { Updater, RESTART_EXIT_CODE } from './updater.js';
import { Auth, publicUser } from './auth.js';
import { Crm, STAGES } from './crm.js';
import { CrmAi } from './crm-ai.js';
import { LLMClient } from './agent/llm.js';
import { createCalendar, toDateStr } from './agent/calendar.js';
import { Agent, STRESS_TESTS } from './agent/agent.js';
import { backlogOpening } from './agent/greeting.js';
import { buildSystemPrompt, companyBrief } from './agent/prompt.js';
import { PRESETS, presetSettings } from './agent/presets.js';
import { csvToContacts, isWithinWorkHours, normalizePhone, randomBetween, renderTemplate, samePhone, sleep, uid } from './utils.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const PANEL_USER = process.env.PANEL_USER || 'admin';
const PANEL_PASSWORD = process.env.PANEL_PASSWORD || '';

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const store = new Store(DATA_DIR);

// Variáveis de ambiente têm prioridade sobre o que foi salvo pelo painel.
const cloudConfig = () => {
  const c = store.settings.connection.cloud;
  return {
    accessToken: process.env.WA_CLOUD_TOKEN || c.accessToken,
    phoneNumberId: process.env.WA_PHONE_NUMBER_ID || c.phoneNumberId,
    verifyToken: process.env.WA_VERIFY_TOKEN || c.verifyToken,
    appSecret: process.env.WA_APP_SECRET || c.appSecret,
    graphVersion: c.graphVersion || 'v22.0',
  };
};
const agentConfig = () => {
  const a = store.settings.agent;
  const provider = ['openrouter', 'openai', 'anthropic'].includes(a.provider) ? a.provider : 'gemini';
  if (provider === 'openai') return { ...a, provider, apiKey: process.env.OPENAI_API_KEY || a.openaiKey, model: a.openaiModel || 'gpt-5-mini' };
  if (provider === 'anthropic') return { ...a, provider, apiKey: process.env.ANTHROPIC_API_KEY || a.claudeKey, model: a.claudeModel || 'claude-opus-5-5' };
  return provider === 'gemini'
    ? { ...a, provider, apiKey: process.env.GEMINI_API_KEY || a.geminiKey, model: a.geminiModel || 'gemini-3.8-flash' }
    : { ...a, provider, apiKey: process.env.OPENROUTER_API_KEY || a.apiKey, model: a.model };
};

const instagramConfig = () => {
  const c = store.settings.instagram;
  return {
    ...c,
    accessToken: process.env.IG_ACCESS_TOKEN || c.accessToken,
    verifyToken: process.env.IG_VERIFY_TOKEN || c.verifyToken,
    appSecret: process.env.IG_APP_SECRET || c.appSecret,
  };
};
const instagram = new InstagramClient({
  getConfig: instagramConfig,
  onTokenRefreshed: (token) => {
    if (!process.env.IG_ACCESS_TOKEN) store.updateSettings({ instagram: { accessToken: token } });
  },
});

// Números da equipe (um WhatsApp por vendedor, com o nome dele).
const lines = new LineManager({
  store,
  dataDir: DATA_DIR,
  createClient: ({ authDir }) => new WhatsAppClient({ authDir, logLevel: process.env.LOG_LEVEL || 'silent' }),
});
const wa = new ConnectionManager({
  store,
  instagram,
  lines,
  clients: {
    qr: new WhatsAppClient({ authDir: path.join(DATA_DIR, 'auth'), logLevel: process.env.LOG_LEVEL || 'silent' }),
    cloud: new CloudApiClient({ getConfig: cloudConfig }),
  },
});

// ---- Eventos em tempo real (Server-Sent Events) ----
const clients = new Set();
function notify(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(payload);
}

const llm = new LLMClient({ getConfig: agentConfig });
// Chave da IA errada ou desativada: avisa os administradores no WhatsApp (no máximo uma vez a cada 6 horas).
let lastKeyAlert = 0;
llm.onAuthError = (err) => {
  if (Date.now() - lastKeyAlert < 6 * 3_600_000) return;
  lastKeyAlert = Date.now();
  notifyAdmins(`⚠️ *A IA parou de responder os clientes*\n${err.message}\n\nAbra o painel → Agente IA, cole uma chave nova e clique em Salvar. Gere em aistudio.google.com/apikey (nunca mande a chave por mensagem).`).catch(() => {});
};
const calendar = createCalendar({ store });
const agent = new Agent({
  store,
  llm,
  calendar,
  notify,
  notifyTeam: async (text) => {
    const phone = normalizePhone(store.settings.agent.handoffNotifyPhone);
    if (phone && wa.status === 'connected') await wa.send(phone, { text, typing: false });
  },
});
// Destrava conversas pausadas por engano (resposta da própria IA lida como se fosse do celular).
try { agent.repairEchoPauses(); } catch (err) { console.error('Conserto das pausas:', err.message); }
setInterval(() => { try { agent.repairEchoPauses(); } catch { /* segue */ } }, 10 * 60_000).unref(); // pausas por eco da própria IA voltam sozinhas, não só ao ligar
const campaigns = new CampaignRunner({ store, wa, notify });
const autoReply = new AutoReply({ store, wa, notify, agent });
const scheduler = new Scheduler({ store, wa, campaigns, notify });
const pending = new PendingInbox({
  store, agent, wa, autoReply, notify,
  // Nome de cada número na fila: o principal, o Instagram ou o WhatsApp de cada vendedor.
  senderLabel: (k) => {
    if (k === 'principal') return 'Número principal';
    if (k === 'instagram') return 'Instagram';
    const l = lines.get(k.replace(/^linha:/, ''));
    return l ? (l.label || auth.get(l.ownerId)?.name || 'WhatsApp de vendedor') : 'WhatsApp de vendedor';
  },
});
const auth = new Auth({ store, dataDir: DATA_DIR });
const crm = new Crm({ store, auth, notify });
const crmAi = new CrmAi({ store, llm, crm });
// Depois de cada resposta do agente, a IA lê a conversa e atualiza o prospecto.
agent.onReplied = (conv, { handoff } = {}) => crmAi.afterReply(conv, { force: handoff });
// Peneira feita: a IA passa o cliente para o vendedor da vez (rodízio).
const router = new LeadRouter({
  store,
  crm,
  sendWhatsApp: (phone, text) => wa.send(phone, { text, typing: false }),
  canSendWhatsApp: () => wa.status === 'connected',
});
agent.routeLead = (conv, args, opts) => router.route(conv, args, opts);
agent.agentNameFor = (conv) => lines.get(parseLineKey(conv.key)?.id)?.agentName || '';
agent.routeSpecialist = (conv, args, opts) => router.routeSpecialist(conv, args, opts);
// Setores (loteamentos, documentação, veículos): a IA direciona e o atendente do setor recebe o resumo.
const sectors = new Sectors({
  store,
  crm,
  auth,
  send: (phone, text) => wa.send(phone, { text, typing: false }),
  canSend: () => wa.status === 'connected',
  notifyAdmins: (text) => notifyAdmins(text),
});
agent.routeSector = (conv, args, opts) => sectors.route(conv, args, opts);
sectors.migrate();
// Escritório de uma conversa: pelo número de WhatsApp (cada número pertence a um escritório); o Instagram atual e o número principal são do Paraguai.
const officeOfKey = (key) => {
  const l = parseLineKey(key);
  if (l) { const line = lines.get(l.id); return normOffice(line?.office) || officeOfUser(auth.get(line?.ownerId)); }
  return normOffice(store.data.conversations?.[key]?.office) || 'py';
};
crm.officeOfKey = officeOfKey;
sectors.officeOfKey = officeOfKey;
/** Com um escritório escolhido (administrador geral) ou fixo (equipe), mostra só ele; 'all' mostra os dois. */
const inOffice = (req, office) => !req.office || req.office === 'all' || req.office === (normOffice(office) || 'py');
// Cada escritório pode ter a própria IA: nome da atendente, texto do negócio e instruções próprias.
// Banco de currículos: quem pergunta por vaga ou manda currículo fica guardado, sem avisar ninguém.
const resumes = new Resumes({ store, dataDir: DATA_DIR, download: (msg) => wa.downloadAudio(msg), send: (jid, p) => wa.send(jid, { ...p, typing: false }), remember: (conv, role, text) => agent.remember(conv, role, text) });
agent.registerCandidate = async (conv, args, { dryRun } = {}) => {
  if (dryRun || String(conv.key).startsWith('sim:')) return { ok: true, simulacao: true, instrucao: 'Simulação: diga que as vagas de vendedor foram preenchidas (eram 3), que hoje não precisamos de mais gente e que pode mandar o currículo.' };
  resumes.register(conv, args);
  return { ok: true, instrucao: 'Contato guardado no banco de currículos (ninguém foi avisado). Agora diga com educação: todas as vagas de vendedor já foram preenchidas (eram apenas 3), hoje não estamos precisando de mais gente, mas se quiser pode enviar o currículo por aqui que deixamos guardado no banco de dados e retornamos caso surja necessidade. Não prometa retorno nem prazo.' };
};
// Consumo da IA por escritório (base do preço do serviço).
const usage = new Usage({ store });
llm.onUsage = (u) => usage.record(u);
agent.officeOfConv = (conv) => officeOfKey(conv.key);
agent.onReply = ({ conv }) => usage.reply(officeOfKey(conv.key));
agent.officeSettingsFor = (conv) => store.settings.offices?.[officeOfKey(conv.key)]?.overrides || null;
// Link do WhatsApp da Migra com o código do cliente (para quem conversa no Instagram escolher tocar em vez de digitar o número).
agent.whatsappLink = (conv) => {
  if (!String(conv.key).startsWith('ig:')) return '';
  const lead = crm.findForConversation({ key: conv.key, phone: conv.phone, username: conv.username })
    || crm.ensureFromConversation({ key: conv.key, phone: conv.phone, name: conv.name, username: conv.username, channel: 'instagram' });
  return whatsappLinkFor(lead);
};
agent.partnerLink = () => (publicBase() ? `${publicBase()}/parceiros` : '');
// Instagram → WhatsApp: o cliente passou o número e a Migra chama no WhatsApp continuando a conversa.
agent.moveToWhatsapp = async (conv, args = {}, { dryRun } = {}) => {
  const phone = normalizePhone(args.whatsapp);
  if (!phone) return { erro: 'Número inválido. Peça o WhatsApp com DDD (e o código do país, se não for do Brasil).' };
  const first = String(args.nome || conv.name || '').trim().split(' ')[0];
  const text = String(args.primeira_mensagem || '').trim().slice(0, 400)
    || `Oi${first ? `, ${first}` : ''}! Aqui é da Migra Paraguai, continuando a nossa conversa do Instagram 😊 Por aqui eu consigo te mandar o orçamento em PDF e tudo certinho para garantir a sua reserva.`;
  if (dryRun || String(conv.key).startsWith('sim:')) return { ok: true, simulacao: true, instrucao: `Simulação: no atendimento real o cliente recebe no WhatsApp (+${phone}): "${text}". Diga que acabou de chamar no WhatsApp e que seguem por lá.` };
  const lead0 = crm.findForConversation({ key: conv.key, phone, username: conv.username });
  const link = whatsappLinkFor(lead0);
  if (wa.status !== 'connected') return { erro: `O WhatsApp da Migra está desconectado agora.${link ? ` Mande este link para ele chamar: ${link}` : ' Siga a conversa por aqui.'}` };
  const lead = crm.findForConversation({ key: conv.key, phone, username: conv.username })
    || crm.ensureFromConversation({ key: conv.key, name: args.nome || conv.name, username: conv.username, channel: 'instagram' });
  const key = `${phone}@s.whatsapp.net`;
  if (lead) {
    if (!lead.phone) lead.phone = phone;
    if (args.nome && (!lead.name || lead.name.startsWith('@'))) lead.name = String(args.nome).trim();
    lead.whatsappKey = key;
    crm.addNote({ name: 'IA', role: 'admin' }, lead.id, `📲 Conversa levada do Instagram para o WhatsApp (+${phone})`);
  }
  await wa.send(key, { text, typing: false });
  const waConv = agent.conversation(key);
  waConv.phone ||= phone;
  waConv.name ||= args.nome || conv.name || '';
  agent.remember(waConv, 'assistant', text);
  store.save();
  notify('crm', { id: lead?.id });
  return { ok: true, instrucao: `O cliente já recebeu a mensagem no WhatsApp (+${phone}). Diga em uma frase que acabou de chamar ele no WhatsApp e que seguem por lá${link ? `; se não aparecer, ele pode chamar por este link: ${link}` : ''}.` };
};
// Retorno combinado: a IA marca dia e hora com o cliente e, no dia, retoma a conversa sozinha.
const followups = new AutoFollowUps({
  store,
  crm,
  agent,
  send: (key, text) => wa.send(key, { text }),
  canSend: (key) => (wa.isConnected ? wa.isConnected(key) : wa.status === 'connected') && agent.active,
  log: (l) => store.addLog(l),
});
agent.scheduleReturn = (conv, args, opts) => followups.schedule(conv, args, opts);
setInterval(() => followups.run().catch((e) => store.addLog({ type: 'error', message: `Retornos combinados: ${e.message}` })), 5 * 60_000).unref();
// Recupera, uma vez, os retornos que se perderam (cliente respondeu "ok, até terça" e o retorno foi cancelado sem enviar).
if (!store.data.followupRecovery2026) {
  setTimeout(() => { try { const n = followups.recoverMissed(); store.data.followupRecovery2026 = new Date().toISOString(); store.save(); if (n) store.addLog({ type: 'system', message: `🔁 ${n} retorno(s) combinado(s) que se perderam foram recolocados na fila` }); } catch (e) { store.addLog({ type: 'error', message: `Recuperar retornos: ${e.message}` }); } }, 30_000).unref();
}
// Migra Imóveis (catálogo e loteamentos) e programa de indicação.
const realty = new Realty({ store, dataDir: DATA_DIR });
const audit = new Audit({ store });
const legacy = new LegacyContracts({ store });
const ingest = new Ingest({ store, dataDir: DATA_DIR, legacy, sales: null, crm: null });

// Videochamadas com a equipe (a IA marca quando o cliente vai falar com marido, esposa ou família).
const videocalls = new VideoCalls({ store, auth });
const live = new Live({ store });
const recordings = new Recordings({ store });
const documents = new Documents({ store });
const tutorials = new Tutorials({ store });
const cityGuide = new Cities({ store });
const marketing = new Marketing({ store });
// O resto da cópia do sistema antigo (catálogo de serviços e o que vier depois). Cada parte falha sozinha, sem derrubar a importação.
function importExtras(cap) {
  const out = {};
  const step = (name, fn) => { try { out[name] = fn(); } catch (e) { out[name] = { erro: e.message }; store.addLog({ type: 'error', message: `Cópia (${name}): ${e.message}` }); } };
  step('servicos', () => serviceCatalog.importCapture(cap));
  for (const fn of extraImporters) step(fn.label, () => fn(cap));
  return out;
}
const extraImporters = [Object.assign((cap) => commissions.importCapture(cap), { label: 'comissoes' }), Object.assign((cap) => support.importCapture(cap), { label: 'suporte' }),
  // Leads entram na Retomada de contatos só para conferência: nada é enviado sem a aprovação do administrador.
  Object.assign((cap) => { const rows = leadRowsFromApi(cap); return rows.length ? reengage.import(rows) : { lidas: 0 }; }, { label: 'leads' }),
  Object.assign((cap) => contractTemplates.importCapture(cap), { label: 'modelos' }),
  Object.assign((cap) => importLessons(tutorials, cap), { label: 'aulas' }),
  Object.assign((cap) => importTeamContacts(store, cap), { label: 'contatos_equipe' })];
const cashHook = (cap) => (typeof cash === 'undefined' ? null : cash.importLegacy(cashRowsFromCapture(cap)));
agent.liveInfo = () => live.promptInfo(`${publicBase()}/live`);
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
// Só quem já viu o valor (e disse que tem condições) vai para a videochamada com o consultor.
const notQualified = () => ({ ok: false, erro: 'Videochamada só para quem já viu o valor e confirmou que tem condições financeiras. Apresente o valor, pergunte com delicadeza se faz sentido e se ele consegue arcar; se não tiver condições, NÃO ofereça videochamada: agradeça, esclareça e use agendar_retorno se fizer sentido.' });
agent.videoSlots = (conv, args) => {
  if (!priceSeen(conv)) return notQualified();
  const r = videocalls.nextDays(args?.a_partir_de);
  const c = videocalls.config;
  if (!r.dias.length) return { ok: false, instrucao: `Não há horário de videochamada livre nos próximos dias${r.primeiroDiaSemAtendimento ? ` (${r.primeiroDiaSemAtendimento.motivo})` : ''}. Diga com naturalidade que a agenda está cheia, siga tirando as dúvidas e use agendar_retorno para voltar em outro dia.` };
  return { ok: true, duracao_minutos: c.durationMin, ...r, instrucao: `Ofereça 2 ou 3 destes horários, só estes${r.primeiroDiaSemAtendimento ? `. Amanhã não há atendimento por vídeo (${r.primeiroDiaSemAtendimento.motivo}); o próximo dia livre está na lista` : ''}.` };
};
agent.videoBook = async (conv, args, { dryRun } = {}) => {
  if (args.valor_apresentado !== true || args.tem_condicoes !== true || !priceSeen(conv)) return notQualified();
  const simulated = dryRun || String(conv.key).startsWith('sim:');
  // Videochamada paga: o horário fica reservado, o Pix sai na hora e só depois do pagamento a videochamada é confirmada. Cliente da Migra não paga.
  const vcLead = simulated ? null : crm.findForConversation({ key: conv.key, phone: conv.phone }) || crm.ensureFromConversation({ key: conv.key, phone: conv.phone, name: conv.name, username: conv.username, channel: String(conv.key).startsWith('ig:') ? 'instagram' : 'whatsapp' });
  const vcFee = videocalls.config.fee;
  if (vcFee > 0 && simulated) return { ok: true, simulacao: true, instrucao: `Simulação: no atendimento real o horário fica reservado, o Pix de R$ ${vcFee.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} sai na hora e a videochamada só é confirmada depois do pagamento e do comprovante. Explique a regra com gentileza.` };
  if (vcFee > 0 && !isClientOfMigra(vcLead)) {
    const held = videocalls.book({ date: args.data, time: args.hora, name: args.nome, phone: conv.phone, people: args.pessoas, notes: args.observacoes, convKey: conv.key, pending: true });
    try {
      const p = await payments.create({ convKey: conv.key, leadId: vcLead?.id || null, amount: vcFee, description: `Videochamada de ${held.durationMin} min com a equipe da Migra (${videocalls.fmt(held)})`, payerName: args.nome, by: 'IA' });
      p.purpose = 'videochamada'; p.videoId = held.id; store.save();
      await payments.sendCharge(p);
    } catch (e) {
      videocalls.cancel(held.id, 'sem cobrança'); 
      return { erro: `Não consegui gerar o Pix agora (${e.message}). Diga que a equipe envia o Pix em instantes e use transferir_para_humano.` };
    }
    const fee = `R$ ${vcFee.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    return { ok: true, aguardandoPagamento: true, valor: fee, data: held.date, hora: held.time, instrucao: `O horário ${videocalls.fmt(held)} ficou RESERVADO por até ${Math.round(videocalls.config.holdMin / 60 * 10) / 10} hora(s) e o Pix de ${fee} já foi enviado logo acima. Explique com educação e sem ofender: a videochamada de ${held.durationMin} minutos (para tirar todas as dúvidas e fechar) só é confirmada depois do pagamento e do envio do comprovante por aqui, porque assim a agenda fica para quem está realmente comprometido e ninguém perde tempo. Não dá para pagar no dia. Peça o comprovante e diga que, assim que o sistema der a baixa, você confirma a videochamada. Se o cliente disser que pagou, use cliente_informou_pagamento. Nunca diga que está confirmada antes do pagamento.` };
  }
  const b = videocalls.book({ date: args.data, time: args.hora, name: args.nome, phone: conv.phone, people: args.pessoas, notes: args.observacoes, convKey: conv.key }, { dryRun: simulated });
  if (!simulated) {
    notify('videocall', { id: b.id });
    const host = auth.get(b.hostId);
    if (host?.whatsapp && wa.status === 'connected') wa.send(host.whatsapp, { text: `📹 *Nova videochamada marcada*\n${videocalls.fmt(b)} (${b.durationMin} min)\nCliente: ${b.name}${b.phone ? ` (+${b.phone})` : ''}${b.people ? `\nPessoas: ${b.people}` : ''}${b.notes ? `\nObs.: ${b.notes}` : ''}`, typing: false }).catch(() => {});
  }
  return { ok: true, simulacao: simulated || undefined, data: b.date, hora: b.time, duracao_minutos: b.durationMin, consultor: firstName(b.hostName), link: b.meetLink || '', instrucao: `Videochamada marcada para ${videocalls.fmt(b)}, com ${b.durationMin} minutos de bate-papo para tirar as dúvidas que ficaram e alinhar o início do procedimento. Confirme ao cliente com calor humano e peça que venha com o marido/a esposa. ${b.meetLink ? `Envie o link da sala: ${b.meetLink}` : 'Diga que o consultor envia o link da sala antes da hora.'}` };
};
agent.pricingInfo = () => {
  const v = store.settings.visits || {}; const m = store.settings.crm?.mentoring || {}; const vc = videocalls.config;
  const rs = (n) => `R$ ${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  return ['Valores vigentes (diga só se o cliente insistir):',
    Number(v.consultFee ?? 250) > 0 ? `- Visita ao escritório (com a equipe): ${rs(v.consultFee ?? 250)}, pagos antes pelo Pix; estornado se o cliente fechar com a Migra.` : '',
    m.enabled !== false && Number(m.price) > 0 ? `- Atendimento exclusivo com o Marcos (1 hora): ${Number(m.price)} ${m.currency === 'BRL' ? 'reais' : 'dólares americanos (US$)'}; não é estornado.` : '',
    vc.fee > 0 ? `- Videochamada de ${vc.durationMin} minutos com o Eliezer ou outro consultor, para tirar todas as dúvidas e fechar: ${rs(vc.fee)}, pagos antes pelo Pix; só fica confirmada depois do comprovante. Use horarios_videochamada e agendar_videochamada (a ferramenta já reserva o horário e gera o Pix).` : '',
  ].filter(Boolean).join('\n');
};
agent.videoInfo = (conv) => [videocalls.promptInfo(), ...videocalls.forPhone(conv.phone).map((b) => `Este cliente JÁ TEM videochamada marcada: ${videocalls.fmt(b)}. Não marque outra, a menos que ele queira remarcar.`)].join('\n');
const motors = new Motors({ store });
const school = new School({ store });
const proposals = new Proposals({ store, realty, audit });
const affiliates = new Affiliates({
  store,
  crm,
  auth,
  secret: auth.secret,
  notifyAffiliate: async (phone, text) => {
    if (wa.status === 'connected') await wa.send(phone, { text, typing: false });
  },
});// Escritório virtual, parte 2: saque em 24h, cessão de indicação, grupos rastreáveis e materiais de campanha.
const affExtras = new AffiliateExtras({
  store, affiliates, crm, dataDir: DATA_DIR,
  notifyAffiliate: async (phone, text) => { if (phone && wa.status === 'connected') await wa.send(phone, { text, typing: false }); },
  notifyAdmins: (text) => notifyAdmins(text),
});

// Aprendizados: cada venda confirmada vira sugestão para o Marcos aprovar (entra no atendimento só depois).
const learnings = new Learnings({ store, llm });
agent.learnings = () => learnings.approvedText();
crm.onWon = async (lead) => {
  await affiliates.onLeadWon(lead);
  const conv = lead.conversationKey ? agent.conversation(lead.conversationKey, { create: false }) : null;
  if (conv) {
    learnings.fromWon(lead, conv.messages).then((list) => {
      if (list.length) notify('learnings', { count: list.length });
    }).catch((e) => store.addLog({ type: 'error', message: `Aprendizados da venda: ${e.message}` }));
  }
};

// Avisos para o dono (administradores com WhatsApp + número extra dos pagamentos).
async function notifyAdmins(text) {
  if (wa.status !== 'connected') return;
  const phones = new Set(auth.users.filter((u) => u.role === 'admin' && u.active !== false && u.whatsapp).map((u) => u.whatsapp));
  const extra = normalizePhone(store.settings.payments?.notifyPhone);
  if (extra) phones.add(extra);
  for (const phone of phones) await wa.send(phone, { text, typing: false }).catch(() => {});
}
// Na VPS o endereço fixo (PUBLIC_URL) sempre vale: os dados vindos do computador carregam o endereço provisório antigo.
if (process.env.PUBLIC_URL) store.updateSettings({ crm: { panelUrl: String(process.env.PUBLIC_URL).replace(/\/+$/, '') } });
const publicBase = () => String(store.settings.crm?.panelUrl || process.env.PUBLIC_URL || '').replace(/\/+$/, '');

// Pix no fechamento: cobra, confirma, fecha a venda, manda recibo e avisa o dono.
const payments = new Payments({
  store,
  crm,
  dataDir: DATA_DIR,
  secret: auth.secret,
  notify,
  sendTo: (key, payload) => wa.send(key, { ...payload, typing: false }),
  notifyAdmins,
});

// Fechamento: ficha de dados → Pix da reserva → termo da reserva assinado no celular.
const closing = new Closing({
  store,
  crm,
  payments,
  secret: auth.secret,
  dataDir: DATA_DIR,
  notify,
  notifyAdmins,
  baseUrl: publicBase,
  sendTo: (key, payload) => wa.send(key, { ...payload, typing: false }),
  // O que o sistema manda entra na memória da atendente, para ela saber em que passo o cliente está.
  remember: (key, text) => {
    const conv = agent.conversation(key, { create: false });
    if (conv) agent.remember(conv, 'assistant', text);
  },
});
payments.onPaid = (p) => {
  if (p.purpose === 'mentoria') {
    const lead = p.leadId ? crm.byId(p.leadId) : null;
    tellMarcos(mentoringNotice(lead, { ...p.mentoring, nome: p.mentoring?.nome || p.payerName }, { phone: lead?.phone || '' }, `PAGA (R$ ${p.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}): agendar`)).catch(() => {});
    const conv = p.convKey ? agent.conversation(p.convKey, { create: false }) : null;
    const text = 'Pagamento confirmado! ✅ A assessoria do Marcos já recebeu o seu pedido de mentoria e vai escolher o dia e o horário na agenda dele e confirmar por aqui com você se serve.';
    if (p.convKey) wa.send(p.convKey, { text, typing: false }).then(() => conv && agent.remember(conv, 'assistant', text)).catch(() => {});
    return;
  }
  if (p.purpose === 'videochamada') {
    try {
      const b = videocalls.confirmPaid(p.videoId);
      const conv = p.convKey ? agent.conversation(p.convKey, { create: false }) : null;
      const text = b.status === 'confirmed'
        ? `Pagamento confirmado! ✅ Sua videochamada está confirmada para ${videocalls.fmt(b)} (${b.durationMin} minutos).${b.meetLink ? ` Link da sala: ${b.meetLink}` : ' O consultor envia o link da sala antes da hora.'} Se vier com o marido/a esposa, melhor ainda!`
        : 'Pagamento confirmado! ✅ O horário que você escolheu acabou de ser ocupado por outra pessoa, então a nossa equipe vai combinar um novo horário com você por aqui, sem custo extra.';
      if (p.convKey) wa.send(p.convKey, { text, typing: false }).then(() => conv && agent.remember(conv, 'assistant', text)).catch(() => {});
      const host = auth.get(b.hostId);
      const note = `📹 *Videochamada PAGA*\n${b.status === 'confirmed' ? videocalls.fmt(b) : 'sem horário livre: remarcar com o cliente'} (${b.durationMin} min)\nCliente: ${b.name}${b.phone ? ` (+${b.phone})` : ''}\n💵 R$ ${p.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
      if (host?.whatsapp && wa.status === 'connected') wa.send(host.whatsapp, { text: note, typing: false }).catch(() => {});
      notify('videocall', { id: b.id });
    } catch (e) { store.addLog({ type: 'error', message: `Videochamada paga: ${e.message}` }); }
    return;
  }
  if (p.purpose === 'visita') {
    // Taxa do atendimento presencial: agora a equipe do escritório confirma o dia e o horário.
    visits.feePaid(p.visitId, p).catch((e) => store.addLog({ type: 'error', message: `Taxa da visita: ${e.message}` }));
    const text = 'Pagamento confirmado! ✅ Sua reserva está garantida. A equipe do escritório já recebeu o seu pedido e vai confirmar o dia e o horário por aqui. Lembrando: se você fechar com a Migra, essa taxa é estornada.';
    const conv = p.convKey ? agent.conversation(p.convKey, { create: false }) : null;
    if (p.convKey) wa.send(p.convKey, { text, typing: false }).then(() => conv && agent.remember(conv, 'assistant', text)).catch(() => {});
    return;
  }
  closing.onPaid(p);
  setTimeout(() => salesOnPaid(p), 0); // a venda nasce com a entrada já recebida
  // Fechou com a Migra: a taxa de assessoria presencial paga antes precisa ser estornada.
  setTimeout(() => {
    for (const v of visits.refundsDue()) {
      if (v.leadId !== p.leadId || v.refundNoticeAt) continue;
      v.refundNoticeAt = new Date().toISOString();
      store.save();
      notifyAdmins(`💸 *Estornar a taxa de assessoria presencial*\n👤 ${v.name || 'Cliente'}${v.phone ? ` · +${v.phone}` : ''} fechou com a Migra.\nDevolva ${Number(v.feeAmount || visits.fee).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} por Pix e marque como estornado na aba Visitas.`).catch(() => {});
    }
  }, 0);
};
agent.sendForm = async (conv, args, { dryRun } = {}) => {
  if (dryRun || String(conv.key).startsWith('sim:')) {
    return { ok: true, simulacao: true, link: 'https://exemplo.com/ficha/teste', instrucao: 'Simulação: mande o link ao cliente pedindo para preencher os dados pessoais para dar continuidade na reserva.' };
  }
  if (!publicBase()) {
    return { erro: 'O painel ainda não tem endereço público (ligue o acesso pela internet na aba Conexões ou use a VPS). Use transferir_para_humano para a equipe enviar a ficha.' };
  }
  const lead = crm.findForConversation({ key: conv.key, phone: conv.phone })
    || crm.ensureFromConversation({ key: conv.key, phone: conv.phone, name: conv.name, username: conv.username, channel: String(conv.key).startsWith('ig:') ? 'instagram' : 'whatsapp' });
  const f = closing.createForm({ convKey: conv.key, lead, servico: args.servico, adultos: args.adultos });
  return {
    ok: true,
    link: closing.formUrl(f),
    instrucao: 'Mande o link exatamente como veio e oriente de forma bem simples: é só tocar no link e preencher cada campo (leva uns 2 minutos, não precisa copiar nem colar nada, o CEP completa o endereço sozinho) e no final tocar em "Enviar meus dados"; se travar em algum campo, ele te chama aqui. Diga que esses dados já servem para dar entrada no processo e ficam guardados com segurança. Depois que ele enviar, o sistema manda sozinho a confirmação, o orçamento com o nome dele, o Pix e o termo da reserva.',
  };
};
// Passo a passo do pagamento (fluxograma): pela atendente, pelo painel e depois do termo assinado.
const payplans = new PayPlans({ store, secret: auth.secret });
// Backup diário criptografado (30 dias) + cópia extra opcional fora deste disco.
const backups = new Backups({ store, dataDir: DATA_DIR, log: (l) => store.addLog(l) });
backups.schedule();
async function sendPaymentPlan({ convKey, lead, packageName, people, adults, start }) {
  const pkg = crm.matchPackage(packageName || lead?.interest || '');
  if (!pkg) return { erro: `Pacote não encontrado. Pacotes: ${(store.settings.crm?.packages || []).map((p) => p.name).join(', ')}` };
  const rec = payplans.create({ leadId: lead?.id || null, convKey, packageName: pkg.name, price: pkg.price, people: people || lead?.people || 1, adults, start });
  const base = publicBase();
  const text = planMessage(rec.plan, { packageName: pkg.name, link: base ? `${base}/etapas/${rec.id}?t=${payplans.token(rec.id)}` : '' });
  if (convKey) {
    await wa.send(convKey, { text, typing: false });
    const conv = agent.conversation(convKey, { create: false });
    if (conv) agent.remember(conv, 'assistant', text);
  }
  if (lead) crm.addNote({ name: 'IA', role: 'admin' }, lead.id, `📋 Etapas de pagamento enviadas: ${pkg.name} · ${rec.plan.people} pessoa(s) · total R$ ${rec.plan.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
  return { ok: true, rec, text };
}
agent.sendPlan = async (conv, args, { dryRun } = {}) => {
  const pkg = crm.matchPackage(args.pacote);
  if (!pkg) return { erro: `Pacote não encontrado. Pacotes: ${(store.settings.crm?.packages || []).map((p) => p.name).join(', ')}` };
  if (dryRun || String(conv.key).startsWith('sim:')) {
    const rec = payplans.create({ packageName: pkg.name, price: pkg.price, people: args.pessoas, adults: args.adultos });
    return { ok: true, simulacao: true, enviado: planMessage(rec.plan, { packageName: pkg.name }), instrucao: 'O passo a passo já foi enviado ao cliente logo acima. Comente em uma frase e pergunte se ficou alguma dúvida.' };
  }
  const lead = crm.findForConversation({ key: conv.key, phone: conv.phone });
  const r = await sendPaymentPlan({ convKey: conv.key, lead, packageName: pkg.name, people: args.pessoas, adults: args.adultos });
  return r.erro ? r : { ok: true, total: r.rec.plan.total, instrucao: 'O passo a passo já foi enviado ao cliente logo acima. Comente em uma frase e pergunte se ficou alguma dúvida.' };
};
closing.onSigned = async (f) => {
  const lead = f.leadId ? crm.byId(f.leadId) : null;
  if (!crm.matchPackage(lead?.interest || f.data.objetivo || '')) return;
  await sendPaymentPlan({ convKey: f.convKey, lead, packageName: lead?.interest || f.data.objetivo, people: Math.max(Number(lead?.people) || 1, Number(f.data.adultos) || 1), adults: f.data.adultos });
};

// Orçamentos ORC-AAAA-NNNNN: PDF com a marca + mensagem no formato da equipe.
// Catálogo de serviços (preço, prazo e comissão): o orçamento aceita os pacotes da base e qualquer serviço ativo daqui.
const serviceCatalog = new ServiceCatalog({ store });
const matchAnyPackage = (n) => crm.matchPackage(n) || serviceCatalog.match(n);
const quotes = new Quotes({ store, dataDir: DATA_DIR, secret: auth.secret, matchPackage: matchAnyPackage });
// Contratos e vendas (parcelas e comissões).
const sales = new Sales({
  store,
  auth,
  notify,
  // Venda de cliente indicado: o vendedor recebe o percentual "com indicação" e a venda mostra o parceiro.
  referral: (leadId) => {
    const l = crm.byId(leadId);
    const a = l?.affiliateId ? affiliates.get(l.affiliateId) : null;
    return a ? { id: a.id, name: a.name, ...affiliates.rate(l.commissionCategory || l.category) } : null;
  },
});
// Níveis de comissão (meta do mês) e saques: a comissão da venda segue o nível quando os níveis estão ligados.
const commissions = new Commissions({
  store, sales, auth,
  notify: async (kind, payload) => {
    if (kind === 'admins') return notifyAdmins(payload);
    if (kind === 'seller' && payload.seller?.whatsapp && wa.status === 'connected') return wa.send(payload.seller.whatsapp, { text: payload.text, typing: false });
    return null;
  },
});
sales.levelPct = (id) => commissions.levelPct(id);
// Migra Sócios de Projeto: plano de carreira com participação no lucro dos projetos que o consultor trouxer.
const partnerProjects = new PartnerProjects({
  store, auth, sales,
  levels: (id, m) => commissions.levelOf(id, m),
  notify: async (kind, payload) => {
    if (kind === 'admins') return notifyAdmins(payload);
    const u = kind === 'owner' ? auth.get(payload.userId) : null;
    if (u?.whatsapp && wa.status === 'connected') return wa.send(u.whatsapp, { text: payload.text, typing: false });
    return null;
  },
});
// Modelos de contrato do sistema antigo (Migra Paraguai, Migra Med, Migra Brasil, RUC).
const contractTemplates = new ContractTemplates({ store });
// Suporte interno (chamados com prazo de resposta e de solução).
const support = new Support({
  store,
  notify: async (kind, payload) => {
    if (kind === 'admins') return notifyAdmins(payload);
    const u = kind === 'user' ? auth.get(payload.userId) : null;
    if (u?.whatsapp && wa.status === 'connected') return wa.send(u.whatsapp, { text: payload.text, typing: false });
    return null;
  },
});
// Pix da entrada confirmado: a venda é lançada sozinha a partir do último orçamento do cliente.
const salesOnPaid = (p) => {
  try {
    const q = quotes.list.filter((x) => (p.leadId && x.leadId === p.leadId) || (p.convKey && x.convKey === p.convKey)).at(-1);
    if (!q) return;
    const lead = p.leadId ? crm.byId(p.leadId) : null;
    const sale = sales.fromQuote(q, { by: 'Sistema', sellerId: lead?.ownerId || q.createdBy?.id || null, entryPaid: true });
    if (sale.parcels[0].status !== 'pago') sales.setParcel({ role: 'admin', name: 'Sistema (Pix confirmado)' }, sale.id, 0, { paid: true, method: 'Pix' });
  } catch (e) {
    store.addLog({ type: 'error', message: `Lançar venda após o Pix: ${e.message}` });
  }
};
const quoteLink = (q) => (publicBase() ? `${publicBase()}/orcamento/${q.id}?t=${quotes.token(q.id)}` : '');
async function sendQuote({ convKey, lead, items, adults, client, consultant, start, discountPct = 0 }) {
  const q = quotes.create({ items, adults, discountPct, ...(/^\d{4}-\d{2}-\d{2}$/.test(String(start || '')) ? { start } : {}), client: client || lead?.name || '', phone: lead?.phone || '', consultant, leadId: lead?.id || null, convKey });
  const text = quotes.message(q, quoteLink(q));
  if (convKey) {
    const ig = String(convKey).startsWith('ig:');
    await wa.send(convKey, ig ? { text, typing: false } : { text, media: { path: quotes.file(q), mimetype: 'application/pdf', fileName: `${q.number}.pdf` }, typing: false });
    const conv = agent.conversation(convKey, { create: false });
    if (conv) agent.remember(conv, 'assistant', text);
  }
  if (lead) {
    const main = q.items[0];
    const patch = { value: q.plan.total, people: q.plan.people, ...(main ? { interest: main.name } : {}) };
    if (['novo', 'em_contato'].includes(lead.stage)) patch.stage = 'proposta';
    crm.update({ name: 'IA', role: 'admin' }, lead.id, patch);
    crm.addNote({ name: 'IA', role: 'admin' }, lead.id, `🧾 Orçamento ${q.number}: ${q.items.map((r) => `${r.name} × ${r.qty}`).join(', ')} · total R$ ${q.plan.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
  }
  notify('crm', { id: lead?.id });
  return q;
}
agent.sendQuote = async (conv, args, { dryRun } = {}) => {
  const items = Array.isArray(args.itens) && args.itens.length ? args.itens : [{ pacote: args.pacote, quantidade: args.pessoas || 1 }];
  if (dryRun || String(conv.key).startsWith('sim:')) {
    const preview = new Quotes({ store: { settings: { ...store.settings, quotes: { ...store.settings.quotes } }, data: { quotes: [] }, save() {} }, dataDir: path.join(DATA_DIR, 'tmp'), secret: auth.secret, matchPackage: matchAnyPackage });
    try {
      const q = preview.create({ items, adults: args.adultos, client: args.nome || conv.name });
      return { ok: true, simulacao: true, enviado: preview.message(q), instrucao: 'O orçamento (PDF + resumo) já foi enviado logo acima. Comente em uma frase curta e conduza para garantir a reserva.' };
    } catch (e) {
      return { erro: e.message };
    }
  }
  const lead = crm.findForConversation({ key: conv.key, phone: conv.phone })
    || crm.ensureFromConversation({ key: conv.key, phone: conv.phone, name: conv.name, username: conv.username, channel: String(conv.key).startsWith('ig:') ? 'instagram' : 'whatsapp' });
  const parsed = parseLineKey(conv.key);
  const owner = parsed ? auth.get(lines.get(parsed.id)?.ownerId) : (lead?.ownerId ? auth.get(lead.ownerId) : null);
  try {
    const q = await sendQuote({ convKey: conv.key, lead, items, adults: args.adultos, client: args.nome, consultant: owner?.name?.split(' ')[0] });
    return { ok: true, numero: q.number, total: q.plan.total, instrucao: 'O orçamento (PDF + resumo com entrada e parcelas) já foi enviado logo acima. Comente em uma frase curta e conduza para garantir a reserva (ficha de dados). Não repita os valores.' };
  } catch (e) {
    return { erro: e.message };
  }
};

// Passa o cliente para o vendedor com tudo pronto: resumo, prévia da conversa e o PDF do orçamento.
// Usado quando o cliente tem receio (a IA chama) e quando o Pix da entrada não veio (automático).
async function forwardToSeller({ conv, convKey, lead, brief = {}, reason = '', auto = false }) {
  convKey ||= conv?.key;
  conv ||= agent.conversation(convKey, { create: false }) || { key: convKey, messages: [] };
  const parsed = parseLineKey(convKey);
  const lineOwner = parsed ? auth.get(lines.get(parsed.id)?.ownerId) : null;
  const leadOwner = lead?.ownerId ? auth.get(lead.ownerId) : null;
  const ownerPhone = store.settings.crm?.ownerPhone;
  // Fechamento da migração: o dono do WhatsApp da conversa; senão, os atendentes do setor de
  // documentação (Camila e Fran); o Marcos não recebe mais vendas.
  let closer = lineOwner && !isOwner(lineOwner, ownerPhone) ? lineOwner : null;
  if (!closer) {
    const p = sectors.next('documentacao');
    if (p) {
      closer = p.id ? auth.get(p.id) : { id: null, name: p.name, whatsapp: p.whatsapp };
      if (p.id && lead) crm.update({ name: 'IA', role: 'admin' }, lead.id, { ownerId: p.id });
    }
  }
  if (!closer && leadOwner && !isOwner(leadOwner, ownerPhone)) closer = leadOwner;
  if (!closer && lead && store.settings.crm?.routing?.enabled !== false) closer = crm.routeLead(lead, { reason: reason || 'atendente do escritório continua' }) || null;
  // Orçamento: o último desta conversa; sem orçamento, monta um com o pacote de interesse.
  let quote = quotes.list.filter((q) => q.convKey === convKey || (lead && q.leadId === lead.id)).at(-1) || null;
  if (!quote && lead?.interest && crm.matchPackage(lead.interest)) {
    try {
      quote = quotes.create({ items: [{ pacote: lead.interest, quantidade: lead.people || 1 }], adults: lead.people || 1, client: lead.name || conv.name || '', phone: lead.phone || '', consultant: closer?.name?.split(' ')[0], leadId: lead.id, convKey });
    } catch {
      quote = null;
    }
  }
  const phone = conv.phone || lead?.phone || '';
  const who = lead?.name || conv.name || (phone ? `+${phone}` : 'Cliente');
  const preview = chatPreview(conv, 10);
  const q = lead?.qualification || {};
  const text = [
    auto ? `⏰ *Cliente não pagou a entrada: continue com ele*` : '🤝 *Cliente para você continuar o atendimento*',
    `👤 ${who}${phone ? ` · +${phone}` : ''}${lead?.code ? ` · ${lead.code}` : ''}`,
    reason ? `❗ ${reason}` : '',
    quote ? `🧾 Orçamento ${quote.number}: ${quote.items.map((r) => `${r.name} × ${r.qty}`).join(', ')} · total R$ ${quote.plan.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} · entrada R$ ${quote.plan.entry.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (PDF em anexo)` : (brief.pacote || lead?.interest ? `📦 ${brief.pacote || lead.interest} · ${brief.pessoas || lead?.people || 1} pessoa(s)` : ''),
    brief.temperatura || q.temperature ? `🌡️ ${brief.temperatura || q.temperature}` : '',
    `\n📝 *Sobre o cliente:* ${brief.resumo || lead?.aiSummary || 'veja a prévia da conversa abaixo'}`,
    brief.interesse ? `🎯 *Interesse real:* ${brief.interesse}` : '',
    brief.situacao ? `📍 *Situação atual:* ${brief.situacao}` : '',
    brief.duvidas ? `✅ *Dúvidas já esclarecidas:* ${brief.duvidas}` : '',
    brief.objecao || q.objections ? `🚧 *O que ainda impede:* ${brief.objecao || q.objections}` : '',
    brief.tentativas ? `💬 *O que a IA já disse:* ${brief.tentativas}` : '',
    brief.dica ? `\n🧠 *Técnica de fechamento:* ${brief.dica}` : '',
    brief.sugestao ? `🏁 *Sugestão para finalizar:* ${brief.sugestao}` : '',
    brief.moradia ? `🏠 Moradia: ${brief.moradia} (oportunidade para a Migra Imobiliária)` : '',
    preview ? `\n💬 *Prévia da conversa:*\n${preview}` : '',
    `\nA IA continua disponível para o cliente. Chame ele${phone ? `: https://wa.me/${phone}` : ' pelo painel (Conversas)'}`,
  ].filter(Boolean).join('\n');
  if (lead) {
    if (Object.keys(brief).length) lead.closingBrief = { ...brief, at: new Date().toISOString() };
    lead.handoff = { toId: closer?.id || null, toName: closer?.name || '', at: new Date().toISOString(), reason: reason || brief.objecao || '', quote: quote?.number || '', auto };
    if (['novo', 'em_contato'].includes(lead.stage)) crm.update({ name: 'IA', role: 'admin' }, lead.id, { stage: 'proposta' });
    crm.addNote({ name: 'IA', role: 'admin' }, lead.id, `${closer ? `➡️ Encaminhado para ${closer.name}` : '➡️ Encaminhado ao escritório'}${reason ? `: ${reason}` : ''}${quote ? ` · ${quote.number}` : ''}`);
    store.save();
  }
  if (quote) quote.forwardedAt = new Date().toISOString();
  const send = async (to) => {
    await wa.send(to, { text, typing: false });
    if (quote && fs.existsSync(quotes.file(quote))) await wa.send(to, { text: '', media: { path: quotes.file(quote), mimetype: 'application/pdf', fileName: `${quote.number}.pdf` }, typing: false });
  };
  if (wa.status === 'connected') {
    if (closer?.whatsapp) await send(closer.whatsapp).catch(() => {});
    else for (const u of auth.users.filter((x) => x.role === 'admin' && x.active !== false && x.whatsapp)) await send(u.whatsapp).catch(() => {});
  }
  notify('crm', { id: lead?.id });
  return { closer, quote };
}

// Quando o cliente sente receio (ou não consegue pagar a entrada agora), um atendente do escritório continua.
agent.closeHandoff = async (conv, args, { dryRun } = {}) => {
  const say = 'Estou enviando seu contato tudo certinho para um atendente dentro do escritório para continuar seu atendimento. Qualquer coisa, fale aqui comigo.';
  if (dryRun || String(conv.key).startsWith('sim:')) return { ok: true, simulacao: true, instrucao: `Simulação: no atendimento real o resumo e o PDF do orçamento vão para o vendedor. Diga ao cliente exatamente: "${say}"` };
  const lead = crm.findForConversation({ key: conv.key, phone: conv.phone })
    || crm.ensureFromConversation({ key: conv.key, phone: conv.phone, name: conv.name, username: conv.username, channel: String(conv.key).startsWith('ig:') ? 'instagram' : 'whatsapp' });
  const brief = Object.fromEntries(Object.entries({
    resumo: String(args.resumo || '').trim(), pacote: args.pacote || '', pessoas: args.pessoas || '',
    interesse: args.interesse_real, situacao: args.situacao_atual, duvidas: args.duvidas_esclarecidas, objecao: args.objecao,
    tentativas: args.o_que_ja_foi_dito, dica: args.dica_de_fechamento, sugestao: args.sugestao, moradia: args.moradia, temperatura: args.temperatura,
  }).filter(([, v]) => v));
  const { closer } = await forwardToSeller({ conv, lead, brief, reason: args.objecao ? `Receio: ${args.objecao}` : '' });
  return { ok: true, quem: closer?.name?.split(' ')[0] || 'o escritório', instrucao: `Diga ao cliente exatamente: "${say}" Depois continue disponível: se ele voltar a escrever, responda normalmente.` };
};

// Pix da entrada não veio: depois do prazo, o cliente vai para o vendedor com o orçamento.
function forwardUnpaid(now = Date.now()) {
  const c = store.settings.closing || {};
  if (c.sellerIfNoPix === false) return;
  const hours = Number(c.sellerAfterHours) || 24;
  const paid = (key, leadId, since) => (store.data.payments || []).some((p) => p.status === 'paid' && (p.convKey === key || (leadId && p.leadId === leadId)) && p.createdAt >= since);
  const latest = new Map();
  for (const q of quotes.list) if (q.convKey) latest.set(q.convKey, q);
  for (const f of store.data.closing || []) if (f.convKey && !latest.has(f.convKey)) latest.set(f.convKey, { convKey: f.convKey, leadId: f.leadId, createdAt: f.createdAt, form: f });
  for (const item of latest.values()) {
    if (item.forwardedAt || item.form?.forwardedAt) continue;
    if (now - Date.parse(item.createdAt) < hours * 3_600_000 || now - Date.parse(item.createdAt) > 30 * 86_400_000) continue;
    const lead = item.leadId ? crm.byId(item.leadId) : crm.findForConversation({ key: item.convKey });
    if (!lead || ['ganho', 'perdido'].includes(lead.stage) || lead.handoff?.at > item.createdAt) continue;
    if (paid(item.convKey, lead.id, item.createdAt) || item.form?.term?.status === 'assinado') continue;
    if (item.form) item.form.forwardedAt = new Date().toISOString();
    else item.forwardedAt = new Date().toISOString();
    store.save();
    forwardToSeller({ convKey: item.convKey, lead, reason: `Recebeu ${item.form ? 'a ficha' : `o orçamento ${item.number}`} há mais de ${hours}h e não pagou a entrada no Pix`, auto: true })
      .catch((e) => store.addLog({ type: 'error', message: `Encaminhar ao vendedor: ${e.message}` }));
  }
}
setInterval(() => forwardUnpaid(), 15 * 60_000).unref();
// Acesso temporário: ao passar do prazo, a pessoa é desativada (painel e WhatsApp da Maria) e fica no registro de segurança.
const sweepTemporaryAccess = () => {
  for (const u of auth.sweepExpired()) securityEvent('acesso_temporario_encerrado', { name: 'Sistema' }, null, `${u.name} (${u.login}): prazo do acesso temporário terminou e a pessoa foi desativada`);
};
sweepTemporaryAccess();
setInterval(sweepTemporaryAccess, 60_000).unref();

// Contratação, parcerias e assuntos de negócio vão direto para o WhatsApp do Marcos.
// Mentoria com o Marcos (US$ 400/h, online ou presencial): paga antes de agendar; cliente da Migra não paga.
const isClientOfMigra = (lead) => Boolean(lead) && (lead.stage === 'ganho'
  || sales.list.some((s) => s.leadId === lead.id && s.status !== 'cancelada')
  || (store.data.payments || []).some((p) => p.leadId === lead.id && p.status === 'paid' && !p.purpose));
const mentoringPriceBRL = () => {
  const m = store.settings.crm?.mentoring || {};
  if (Number(m.priceBRL) > 0) return Number(m.priceBRL);
  if (m.currency === 'BRL') return Number(m.price) || 0;
  return Math.round((Number(m.price) || 0) * (Number(store.settings.crm?.fx?.USD) || 5.5) * 100) / 100;
};
const mentoringNotice = (lead, args, conv, extra) => [
  `🎓 *Mentoria com o Marcos: ${extra}*`,
  `👤 ${args.nome || lead?.name || conv.name || 'Cliente'}${conv.phone || lead?.phone ? ` · https://wa.me/${conv.phone || lead?.phone}` : ''}`,
  `📍 Formato: ${args.formato === 'presencial' ? 'presencial' : 'online'}`,
  args.assunto ? `📝 ${args.assunto}` : '',
  args.prazo_para_agendar ? `⏳ Precisa ser agendada até: ${args.prazo_para_agendar}` : '',
  lead?.code ? `🔖 ${lead.code}` : '',
  '\nEscolha o dia e o horário na agenda do Marcos (dentro do prazo) e confirme com o cliente, por aqui, se serve para ele.',
].filter(Boolean).join('\n');
const tellMarcos = async (text) => {
  const owner = normalizePhone(store.settings.crm?.ownerPhone);
  if (owner && wa.status === 'connected') await wa.send(owner, { text, typing: false }).catch(() => {});
  else await notifyAdmins(text);
};
agent.isClient = (conv) => isClientOfMigra(crm.findForConversation({ key: conv.key, phone: conv.phone, username: conv.username }));
agent.bookMentoring = async (conv, args = {}, { dryRun } = {}) => {
  const m = store.settings.crm?.mentoring || {};
  const brl = mentoringPriceBRL();
  const money = `R$ ${brl.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const usd = `${m.currency === 'BRL' ? 'R$' : 'US$'} ${Number(m.price || 400).toLocaleString('pt-BR')}`;
  if (dryRun || String(conv.key).startsWith('sim:')) return { ok: true, simulacao: true, instrucao: `Simulação: no atendimento real, cliente da Migra não paga; os demais recebem o Pix de ${money} (${usd}) ou o link do cartão. Diga isso em uma frase.` };
  const lead = crm.findForConversation({ key: conv.key, phone: conv.phone, username: conv.username })
    || crm.ensureFromConversation({ key: conv.key, phone: conv.phone, name: conv.name, username: conv.username, channel: String(conv.key).startsWith('ig:') ? 'instagram' : 'whatsapp' });
  if (isClientOfMigra(lead)) {
    await tellMarcos(mentoringNotice(lead, args, conv, 'cliente da Migra (sem cobrança)'));
    if (lead) crm.addNote({ name: 'IA', role: 'admin' }, lead.id, `🎓 Mentoria com o Marcos pedida (${args.formato || 'online'}), sem cobrança por já ser cliente`);
    return { ok: true, cliente: true, instrucao: 'Este cliente já é da Migra, então a mentoria não tem cobrança. Diga isso com carinho ("como você já é nosso cliente, não tem custo"), que passou o pedido para a assessoria do Marcos, que escolhe o dia e o horário na agenda dele e confirma por aqui se serve para o cliente. Nunca confirme nem sugira data ou horário.' };
  }
  if (args.pagamento === 'cartao') {
    await tellMarcos(mentoringNotice(lead, args, conv, `PAGAMENTO NO CARTÃO (${usd}): enviar o link e, depois de pago, agendar`));
    if (lead) crm.addNote({ name: 'IA', role: 'admin' }, lead.id, `🎓 Mentoria com o Marcos pedida (${args.formato || 'online'}), pagamento no cartão: aguardando o link da equipe`);
    return { ok: true, cartao: true, instrucao: `Diga que a equipe vai enviar o link do cartão por aqui em instantes (mentoria de 1 hora, ${usd}) e que, depois do pagamento, a assessoria do Marcos escolhe o dia e o horário e confirma com ele. Não invente link.` };
  }
  try {
    const p = await payments.create({ convKey: conv.key, leadId: lead?.id || null, amount: brl, description: `Mentoria com Marcos Miguel (${m.minutes || 60} min, ${args.formato === 'presencial' ? 'presencial' : 'online'}) · valor: ${usd} (dólares americanos), pago em reais pela cotação do dia · NÃO reembolsável`, payerName: args.nome, payerDoc: args.cpf, by: 'IA' });
    p.purpose = 'mentoria';
    p.mentoring = { formato: args.formato === 'presencial' ? 'presencial' : 'online', assunto: String(args.assunto || '').slice(0, 300), prazo_para_agendar: String(args.prazo_para_agendar || '').slice(0, 200), nome: args.nome || '' };
    store.save();
    await payments.sendCharge(p);
    return { ok: true, valor: money, instrucao: `O QR Code e o Pix copia e cola já foram enviados logo acima (${money}). Diga que a mentoria é de ${Number(m.price || 400)} dólares americanos (US$ ${Number(m.price || 400)}) e que o Pix, por ser do Brasil, é pago em reais pela cotação do dia (o valor aparece no QR Code; se o cliente perguntar quanto é, diga o valor em reais sem esconder). Explique que é só copiar o código no app do banco; assim que o pagamento for confirmado, o recibo chega aqui e a assessoria do Marcos escolhe o dia e o horário na agenda dele e confirma com ele se serve. Nunca confirme nem sugira data ou horário. Deixe claro, com simpatia, que o valor da mentoria NÃO é devolvido nem estornado, mesmo que ele feche com a Migra.` };
  } catch (e) {
    return { erro: `${e.message}. Use avisar_marcos com assunto "mentoria" para a equipe cobrar.` };
  }
};
/** Quem recebe quem quer trabalhar na Migra (Prospectos → Regras): só o nome de quem está na Equipe, ou "Nome = WhatsApp". */
const jobsContact = () => resolvePeople(store.settings.crm?.jobsContact || [], auth.users)[0] || null;
// Corretor, terreno, loteamento e parceria imobiliária: direto para o Diego (setor Loteamentos). O Marcos não recebe.
const REAL_ESTATE_TOPIC = /corretor|creci|imobili|terren|loteament|\blote\b|\blotes\b|im[oó]ve(?:l|is)/i;
agent.notifyOwner = async (conv, args, { dryRun } = {}) => {
  if (['parceria de negócio', 'outro'].includes(args.assunto) && REAL_ESTATE_TOPIC.test(`${args.resumo || ''} ${args.nome || ''}`)) {
    return sectors.route(conv, { setor: 'loteamentos', resumo: args.resumo || 'Parceria imobiliária', nome: args.nome }, { dryRun });
  }
  // Quem quer trabalhar na Migra vai direto para o Diego (não para o Marcos).
  const hr = args.assunto === 'contratação' ? jobsContact() : null;
  const to = hr ? hr.name.split(' ')[0] : 'Marcos';
  // Um único aviso por pessoa e assunto (o mesmo contato repetido enterra o que importa).
  const seen = (store.data.ownerNotices ||= {});
  const noticeKey = `${conv.key}|${args.assunto || 'outro'}`;
  if (!dryRun && !String(conv.key).startsWith('sim:') && Date.now() - (seen[noticeKey] || 0) < 3 * 86_400_000) {
    return { ok: true, jaAvisado: true, instrucao: `Este assunto já foi passado para ${to}. NÃO chame esta ferramenta de novo: diga só que ${to} já tem o contato e retorna.` };
  }
  if (dryRun || String(conv.key).startsWith('sim:')) return { ok: true, simulacao: true, instrucao: `Simulação: no atendimento real o aviso vai para o WhatsApp de ${to}. Diga que passou o contato para ${hr ? `${to}, da equipe,` : 'o Marcos'} e que ${hr ? 'ele' : 'ele'} retorna.` };
  const who = args.nome || conv.name || (conv.phone ? `+${conv.phone}` : conv.username ? `@${conv.username}` : 'Contato');
  const preview = chatPreview(conv, 6);
  const text = [
    `📌 *Assunto para ${hr ? to : 'o Marcos'}: ${args.assunto || 'outro'}*`,
    `👤 ${who}${conv.phone ? ` · https://wa.me/${conv.phone}` : ''}`,
    `📝 ${args.resumo || ''}`,
    preview ? `\n💬 *Prévia da conversa:*\n${preview}` : '',
  ].filter(Boolean).join('\n');
  const target = hr?.whatsapp || normalizePhone(store.settings.crm?.ownerPhone);
  if (target && wa.status === 'connected') await wa.send(target, { text, typing: false }).catch(() => {});
  else await notifyAdmins(text);
  seen[noticeKey] = Date.now();
  store.save();
  store.addLog({ type: 'system', message: `📌 ${who}: ${args.assunto} → ${to}` });
  return { ok: true, instrucao: hr
    ? `Diga, em uma frase, que passou o contato para ${to}, da equipe da Migra, que cuida das vagas e retorna para ele. Continue disponível.`
    : 'Diga, em uma frase, que passou o assunto direto para o Marcos e que ele mesmo retorna. Continue disponível.' };
};

// Visitas ao escritório: a atendente registra, o Marcos confirma pelo painel.
const visits = new Visits({
  store,
  crm,
  notify,
  isClient: (lead) => isClientOfMigra(lead),
  sendTo: (key, payload) => wa.send(key, { ...payload, typing: false }),
  remember: (key, text) => {
    const conv = agent.conversation(key, { create: false });
    if (conv) agent.remember(conv, 'assistant', text);
  },
  // Pedido de visita: vai para quem cuida das visitas (Silvani), um de cada vez se houver mais de um.
  notifyOwner: async (text) => {
    if (wa.status !== 'connected') return;
    const desk = visitDesk();
    if (desk.length) {
      store.data.visitSeq = (store.data.visitSeq || 0) + 1;
      return wa.send(desk[store.data.visitSeq % desk.length].whatsapp, { text, typing: false });
    }
    const phone = normalizePhone(store.settings.visits?.notifyPhone);
    if (phone) return wa.send(phone, { text, typing: false });
    return notifyAdmins(text);
  },
});
/** Quem cuida das visitas ao escritório (Visitas → responsáveis). */
const visitDesk = () => resolvePeople(store.settings.visits?.people, auth.users);
const visitDeskName = () => visitDesk().map((p) => p.name.split(' ')[0]).join(' ou ') || 'a equipe do escritório';
const isVisitDesk = (user) => Boolean(user?.whatsapp) && visitDesk().some((p) => samePhone(p.whatsapp, user.whatsapp));
agent.requestVisit = async (conv, args, { dryRun } = {}) => {
  if (dryRun || String(conv.key).startsWith('sim:')) return { ok: true, simulacao: true, instrucao: `Simulação: no atendimento real, quem não é cliente recebe o Pix da taxa de reserva e, depois de pago, ${visitDeskName()} confirma o dia e o horário por aqui. Cliente da Migra não paga.` };
  const lead = crm.findForConversation({ key: conv.key, phone: conv.phone })
    || crm.ensureFromConversation({ key: conv.key, phone: conv.phone, name: conv.name, username: conv.username, channel: String(conv.key).startsWith('ig:') ? 'instagram' : 'whatsapp' });
  // Quem quer falar direto com o Marcos não é visita: é a mentoria paga.
  const m = store.settings.crm?.mentoring || {};
  if (m.enabled !== false && Number(m.price) > 0 && /marcos|mentoria|direto com o dono|falar com o dono/i.test(`${args.assunto || ''} ${args.observacoes || ''} ${args.preparado || ''}`)) {
    const price = `${m.currency === 'BRL' ? 'R$' : 'US$'} ${Number(m.price).toLocaleString('pt-BR')}`;
    return { erro: `Não registre visita: quem quer falar direto com o Marcos Miguel contrata a mentoria de ${m.minutes || 60} minutos por ${Number(m.price)} ${m.currency === 'BRL' ? 'reais' : 'dólares americanos'} (${price}), online ou presencial, gratuita para quem já é cliente da Migra. Explique isso com naturalidade, dê a escolha entre seguir com a equipe ou reservar a mentoria e, se ele quiser, use reservar_mentoria. Se na verdade ele só quer conhecer o escritório com a equipe, tente de novo sem citar o Marcos.` };
  }
  // Taxa de reserva (R$ 250) paga ANTES de agendar; estornada se o cliente fechar. Quem já é cliente não paga.
  if (visits.fee > 0 && !isClientOfMigra(lead)) {
    const open = visits.forConversation(conv.key).find((v) => v.status === 'aguardando_taxa');
    const fee = visits.fee;
    const feeText = `R$ ${fee.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    if (open) return { ok: true, jaPedido: true, instrucao: `Este cliente já pediu a visita e o Pix da taxa de ${feeText} já foi enviado: aguardando o pagamento. NÃO gere outro Pix. Lembre com gentileza que, assim que o pagamento cair, a equipe confirma o dia e o horário.` };
    const v = await visits.request({ convKey: conv.key, lead, phone: conv.phone, feePending: true, ...args });
    try {
      const p = await payments.create({ convKey: conv.key, leadId: lead?.id || null, amount: fee, description: 'Taxa de assessoria presencial (reserva de horário) · estornada se fechar com a Migra', payerName: args.nome, by: 'IA' });
      p.purpose = 'visita';
      p.visitId = v.id;
      v.feePaymentId = p.id;
      store.save();
      await payments.sendCharge(p);
    } catch (e) {
      return { erro: `Não consegui gerar o Pix agora (${e.message}). Diga que a equipe envia o Pix da taxa em instantes e use transferir_para_humano.` };
    }
    return { ok: true, valor: feeText, instrucao: `O QR Code e o Pix copia e cola da taxa de reserva (${feeText}) já foram enviados logo acima. Explique em poucas frases: essa taxa reserva o horário na agenda da equipe de assessoria (que está muito concorrida) para atender só pessoas sérias e comprometidas; se ele fechar com a Migra, o valor é estornado, e se não fechar, ele terá tido uma assessoria presencial. Assim que o pagamento for confirmado, a equipe confirma o dia e o horário por aqui. Nunca confirme data ou horário por conta própria. Lembre o que trazer: ${store.settings.visits?.bring || DEFAULT_BRING}` };
  }
  await visits.request({ convKey: conv.key, lead, phone: conv.phone, ...args });
  return { ok: true, instrucao: `Pedido registrado: ${visitDeskName()}, da equipe do escritório, já recebeu. Diga que a equipe confirma o dia e o horário por aqui. Em seguida, em uma mensagem curta, lembre do que trazer: ${store.settings.visits?.bring || DEFAULT_BRING}` };
};
agent.visitInfo = (conv) => {
  const c = store.settings.visits || {};
  const mine = visits.forConversation(conv.key);
  return [
    `Quem cuida das visitas e confirma o dia e o horário: ${visitDeskName()} (equipe do escritório). Não diga que é o Marcos.`,
    c.hours ? `Dias e horários em que o escritório recebe: ${c.hours}.` : '',
    c.address ? `Endereço do escritório: ${c.address}.` : 'O escritório fica em Santa Rita, Alto Paraná; o endereço exato vai junto com a confirmação.',
    `O que trazer (lembre o cliente exatamente disto): ${c.bring || DEFAULT_BRING}`,
    isClientOfMigra(crm.findForConversation({ key: conv.key, phone: conv.phone })) ? 'ESTE CLIENTE JÁ É CLIENTE DA MIGRA (reserva paga): a visita ao escritório NÃO tem taxa para ele. Não fale em taxa.' : '',
    !isClientOfMigra(crm.findForConversation({ key: conv.key, phone: conv.phone })) && visits.fee > 0 ? `Taxa de reserva do atendimento presencial: R$ ${visits.fee.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}, paga ANTES pelo Pix (a ferramenta gera o Pix quando o cliente topar). Quem fecha com a Migra tem o valor ESTORNADO. Quem já é cliente não paga.` : 'A visita não tem taxa.',
    ...mine.map((v) => v.status === 'confirmada' ? `Este cliente JÁ TEM visita confirmada: ${v.date.split('-').reverse().join('/')} às ${v.time}.` : `Este cliente já pediu visita (${v.preferred || 'sem data'}); aguardando a equipe confirmar. Não registre outro pedido.`),
  ].filter(Boolean).join('\n');
};

// Em que passo do fechamento o cliente está (vai para o prompt da atendente).
agent.closingStatus = (conv) => {
  const f = closing.forConversation(conv.key);
  if (!f) return '';
  const p = f.paymentId ? payments.get(f.paymentId) : null;
  return [
    f.status === 'preenchida' ? `Ficha de dados: PREENCHIDA (${f.data.nome}, CPF ${f.data.cpf}).` : 'Ficha de dados: enviada, AINDA NÃO preenchida. Se o cliente disser que preencheu, peça para conferir se clicou em "Enviar meus dados" no final; se precisar, reenvie o mesmo link: ' + closing.formUrl(f),
    p ? `Pix da reserva: ${p.status === 'paid' ? 'PAGO e confirmado (recibo enviado)' : `enviado (R$ ${p.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}), aguardando pagamento`}.` : f.viaContract ? 'Contrato enviado para assinar. O Pix da reserva sai sozinho assim que ele assinar: NÃO mande Pix antes e lembre-o de assinar o contrato.' : f.status === 'preenchida' ? 'Pix da reserva: ainda não enviado pelo sistema (a equipe envia os dados de pagamento).' : '',
    f.term ? `Termo da reserva: ${f.term.status === 'assinado' ? 'ASSINADO' : `enviado para assinar (link: ${closing.termUrl(f)})`}.` : '',
  ].filter(Boolean).join('\n');
};
agent.createPix = async (conv, args, { dryRun } = {}) => {
  const adults = Math.max(1, Number(args.adultos) || 1);
  const amount = payments.reservationAmount(adults);
  const money = (v) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  if (dryRun || String(conv.key).startsWith('sim:')) {
    return { ok: true, simulacao: true, valor: money(amount), instrucao: 'Simulação: nenhum Pix foi gerado. No atendimento real o QR Code e o código copia e cola são enviados ao cliente antes desta resposta.' };
  }
  const lead = crm.findForConversation({ key: conv.key, phone: conv.phone })
    || crm.ensureFromConversation({ key: conv.key, phone: conv.phone, name: conv.name, username: conv.username, channel: String(conv.key).startsWith('ig:') ? 'instagram' : 'whatsapp' });
  // Não duplica: se já há um Pix em aberto para esta conversa (do mesmo valor, ou o que foi enviado junto com o contrato) nas últimas 24 h, não gera outro.
  const open = payments.list.find((x) => x.convKey === conv.key && x.status === 'pending' && Date.now() - Date.parse(x.createdAt) < 86_400_000 && (Math.abs(x.amount - amount) < 0.005 || /contrato/i.test(x.description || '')));
  if (open) return { ok: true, jaEnviado: true, valor: money(open.amount), instrucao: `O Pix de ${money(open.amount)} (${open.description}) JÁ foi enviado a este cliente e está em aberto. NÃO gere outro: lembre o valor, diga que é só copiar o código e colar no app do banco e peça o comprovante aqui na conversa.` };
  const desc = `${store.settings.payments?.reservation?.description || 'reserva'} - ${adults} adulto(s)`;
  const p = await payments.create({ convKey: conv.key, leadId: lead?.id, amount, description: desc, payerName: args.nome_pagador, payerDoc: args.cpf_pagador, payerPhone: conv.phone || lead?.phone || '', by: 'IA' });
  await payments.sendCharge(p);
  return { ok: true, valor: money(amount), instrucao: 'O QR Code e o código Pix copia e cola já foram enviados ao cliente em mensagens separadas, logo acima. Diga o valor, explique que é só copiar o código e colar no app do banco (Pix copia e cola) e que o recibo chega aqui assim que o pagamento for confirmado.' };
};
const cardBase = (adults, wanted) => {
  const min = payments.reservationAmount(adults);
  const v = Number(wanted);
  if (wanted === undefined || wanted === null || wanted === '' || !Number.isFinite(v) || v <= 0) return { base: min, min };
  return { base: Math.round(v * 100) / 100, min };
};
const brl = (v) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
agent.cardOptions = async (conv, args) => {
  const adults = Math.max(1, Number(args.adultos) || 1);
  const { base, min } = cardBase(adults, args.valor);
  if (base < min) return { erro: `O valor mínimo no cartão é a entrada: ${brl(min)}. Explique com educação e pergunte se pode ser a partir desse valor.` };
  const opts = payments.cardOptions(base);
  if (!opts.length) return { ok: true, semTaxas: true, valor: brl(base), instrucao: `As taxas da maquininha ainda não estão cadastradas, então você não consegue calcular as parcelas. Diga que a equipe passa as opções de parcelas com a taxa do cartão (paga pelo cliente) em instantes e use passar_fechamento_para_humano.` };
  return { ok: true, valor: brl(base), taxaPagaPeloCliente: true, opcoes: opts.map((o) => ({ parcelas: o.parcelas, valor_da_parcela: brl(o.parcela), total: brl(o.total), taxa: `${String(o.taxaPercentual).replace('.', ',')}%` })), instrucao: `Mostre as opções ao cliente em lista curta (parcelas, valor de cada e total), lembrando que a taxa da maquininha é paga pelo cliente e que o valor base é ${brl(base)}. Quando ele escolher, use gerar_link_cartao com a parcela${args.valor ? ' e o mesmo valor' : ''}.` };
};
agent.createCardLink = async (conv, args, { dryRun } = {}) => {
  const adults = Math.max(1, Number(args.adultos) || 1);
  const { base, min } = cardBase(adults, args.valor);
  if (base < min) return { erro: `O valor mínimo no cartão é a entrada: ${brl(min)}.` };
  const n = Math.round(Number(args.parcelas)) || 1;
  const opt = payments.cardOptions(base).find((o) => o.parcelas === n);
  if (dryRun || String(conv.key).startsWith('sim:')) return { ok: true, simulacao: true, valor: brl(base), instrucao: 'Simulação: nenhum link foi criado. No atendimento real o link do cartão é enviado ao cliente antes desta resposta.' };
  const lead = crm.findForConversation({ key: conv.key, phone: conv.phone })
    || crm.ensureFromConversation({ key: conv.key, phone: conv.phone, name: conv.name, username: conv.username, channel: String(conv.key).startsWith('ig:') ? 'instagram' : 'whatsapp' });
  const desc = `${store.settings.payments?.reservation?.description || 'reserva'} - ${adults} adulto(s)`;
  if (!payments.cardAvailable || !opt) {
    // Sem o Mercado Pago ligado ou sem a taxa dessa parcela: a equipe cria o link à mão.
    if (lead) crm.addNote({ name: 'IA', role: 'admin' }, lead.id, `Cliente quer pagar ${brl(base)} no cartão em ${n}x (taxa da maquininha por conta do cliente): criar e enviar o link.`);
    notifyAdmins(`💳 *Cliente quer pagar no cartão*\n👤 ${args.nome_pagador || lead?.name || conv.name || 'Cliente'}${conv.phone ? ` · +${conv.phone}` : ''}\n💵 Valor: ${brl(base)} em ${n}x (taxa da maquininha por conta do cliente)\n\nO link não é automático (${payments.cardAvailable ? 'sem taxa cadastrada para essa parcela' : 'Mercado Pago desligado'}). Crie o link e envie ao cliente.`).catch(() => {});
    return { ok: true, manual: true, valor: brl(base), instrucao: `Diga que o link de pagamento no cartão de crédito, com as parcelas e a taxa da maquininha (paga pelo cliente), será enviado pela equipe por aqui em instantes. Não peça dados do cartão.` };
  }
  const p = await payments.createCard({ convKey: conv.key, leadId: lead?.id, amount: base, installments: n, description: desc, payerName: args.nome_pagador, by: 'IA' });
  await payments.sendCardLink(p);
  return { ok: true, valor: brl(p.amount), instrucao: `O link de pagamento no cartão (${n}x, total ${brl(p.amount)}, já com a taxa da maquininha paga pelo cliente) já foi enviado logo acima. Explique que é uma página segura do Mercado Pago, onde ele digita os dados do cartão (nunca peça dados do cartão aqui) e que, assim que for aprovado, o recibo chega nesta conversa. Se ele disser que pagou, use cliente_informou_pagamento.` };
};
agent.claimPaid = async (conv, args, { dryRun } = {}) => {
  if (dryRun || String(conv.key).startsWith('sim:')) return { ok: true, simulacao: true };
  const r = await payments.clientClaimsPaid(conv.key, args.observacao || '');
  return r.ok
    ? { ...r, instrucao: r.automatico ? 'A confirmação é automática e chega em alguns minutos, junto com o recibo.' : 'Peça que o cliente envie o COMPROVANTE do pagamento (foto, print ou PDF) aqui na conversa: você abre o arquivo, confere e confirma na hora, e o recibo chega em seguida. A equipe também foi avisada para conferir.' }
    : r;
};

// O que o CRM já sabe do cliente que veio de outro canal (ex.: Instagram → WhatsApp do vendedor).
// No WhatsApp de um vendedor, a atendente trabalha em nome dele.
agent.channelNote = (conv) => {
  const parsed = parseLineKey(conv.key);
  const line = parsed ? lines.get(parsed.id) : null;
  const owner = line?.ownerId ? auth.get(line.ownerId) : null;
  if (!owner) return '';
  const first = owner.name.split(' ')[0];
  const memory = line?.memory ? `\n\n# Memória deste agente (orientações de ${first}, valem para os clientes deste número)\n${line.memory}` : '';
  return `Você atende pelo WhatsApp de ${owner.name}, consultor(a) da equipe. Os clientes daqui são de ${first}. Apresente-se como a assistente de ${first} na Migra (ex.: "Oi! Aqui é a assistente de ${first}, da Migra"). ${first} acompanha as conversas e assume quando o cliente precisar. Não encaminhe para outro vendedor: este cliente já é de ${first}.${memory}`;
};
// Histórico de orçamentos deste número (inclusive os desativados por prazo): a IA retoma de onde o cliente parou.
agent.quoteContext = (conv) => {
  const lead = crm.findForConversation({ key: conv.key, phone: conv.phone });
  const mine = quotes.list.filter((q) => q.convKey === conv.key || (lead && q.leadId === lead.id) || (conv.phone && q.phone && samePhone(q.phone, conv.phone)));
  if (!mine.length) return '';
  const last = mine.at(-1);
  const st = quoteStatus(last);
  const brDate = (d) => String(d).split('-').reverse().join('/');
  const items = last.items.map((i) => `${i.name} × ${i.qty}`).join(', ');
  const head = `Este cliente JÁ RECEBEU orçamento: ${last.number} de ${brDate(last.issued)} (${items}), total R$ ${Number(last.plan.total).toLocaleString('pt-BR')}, entrada R$ ${Number(last.plan.entry).toLocaleString('pt-BR')}.`;
  if (st === 'vendido') return `${head} Já virou venda: não ofereça outro orçamento, trate como cliente.`;
  if (st === 'ativo') return `${head} Está ATIVO até ${brDate(last.validUntil)}: não gere outro, retome o que foi combinado e conduza ao fechamento.`;
  return `${head} Passou da validade em ${brDate(last.validUntil)} e foi DESATIVADO (ele não respondeu a tempo; os dados dele continuam guardados). Se ele voltar a falar em seguir, diga que lembra do atendimento anterior, retome com os mesmos pacotes e gere um orçamento novo com gerar_orcamento (os valores valem pela tabela de hoje). Não repita as perguntas que ele já respondeu.`;
};
agent.contextFor = (conv) => {
  const lead = crm.findForConversation({ key: conv.key, phone: conv.phone });
  if (!lead || lead.conversationKey === conv.key) return '';
  const q = lead.qualification || {};
  const origin = lead.conversationKey ? agent.conversation(lead.conversationKey, { create: false }) : null;
  const before = (origin?.messages || []).filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim()).slice(-40).map((m) => `${m.role === 'user' ? 'Cliente' : 'Atendimento'}: ${m.content.replace(/\s+/g, ' ').slice(0, 400)}`).join('\n').slice(-7000);
  return [
    `Nome: ${lead.name || '-'} · código ${lead.code}${lead.instagram ? ` · Instagram @${lead.instagram}` : ''}`,
    lead.interest ? `Interesse: ${lead.interest}${lead.people > 1 ? ` para ${lead.people} pessoas` : ''}` : '',
    q.temperature ? `Peneira: cliente ${q.temperature}${q.start ? `, quer começar ${q.start}` : ''}${q.moneyEvidence ? `, sobre o dinheiro disse: "${q.moneyEvidence}"` : ''}` : '',
    q.objections ? `Dúvidas que ficaram: ${q.objections}` : '',
    lead.aiSummary ? `Resumo: ${lead.aiSummary}` : '',
    lead.contractData ? 'Os dados para o contrato já foram passados.' : '',
    before ? `Conversa anterior (até as últimas 40 mensagens; ${String(lead.conversationKey).startsWith('ig:') ? 'Instagram' : 'outro canal'}):\n${before}` : '',
  ].filter(Boolean).join('\n');
};

/**
 * Busca as conversas recentes do Direct: quem chamou nas últimas 24h entra em
 * "Clientes esperando resposta" (o agente pode responder); quem chamou antes
 * vira prospecto para a equipe responder pelo app (regra de 24h do Instagram).
 */
async function syncInstagram() {
  const msgs = await instagram.recentMessages();
  const recent = pending.ingestHistory(msgs, { maxDays: 1, label: 'Instagram' });
  let old = 0;
  const dayAgo = Date.now() - 86_400_000;
  // De 1 a 15 dias: a Meta não deixa o robô responder (regra das 24h). A IA escreve a resposta
  // e a equipe envia pelo app do Instagram, no quadro de Conversas.
  const manualDays = Math.min(60, Number(store.settings.instagram?.manualDays) || 30);
  let drafts = 0;
  for (const p of extractPending(msgs, { maxDays: Math.max(30, manualDays) })) {
    if (p.at >= dayAgo) continue;
    const username = msgs.find((m) => m.jid === p.jid && m.username)?.username || '';
    if (autoReply.ignoredInstagram(username)) continue;
    const lead = crm.ensureFromConversation({ key: p.jid, name: p.name, username, channel: 'instagram' });
    if (!lead) continue;
    if (!lead.igOldNoted) {
      lead.igOldNoted = true;
      crm.addNote({ name: 'Sistema', role: 'admin' }, lead.id, `Mandou mensagem no Direct em ${new Date(p.at).toLocaleDateString('pt-BR')} e ficou sem resposta: "${p.texts.join(' / ').slice(0, 200)}". Passou de 24h, então o robô não pode responder: responda pelo app do Instagram (a resposta sugerida fica em Conversas).`);
      old++;
    }
    const fresh = p.at >= Date.now() - manualDays * 86_400_000;
    if (fresh && lead.igDraft?.clientAt !== p.at && drafts < 40) {
      lead.igDraft = { status: 'pendente', kind: 'responder', clientAt: p.at, username, name: p.name || '', texts: p.texts, text: await draftInstagram(p, username, 'responder', lead).catch(() => ''), at: new Date().toISOString() };
      drafts++;
    }
  }
  // Conversas que esfriaram (o cliente parou de responder, muitas vezes por causa do atendimento robótico):
  // a IA escreve uma retomada humana para a equipe enviar pelo app.
  let stalled = 0;
  for (const p of extractStalled(msgs, { maxDays: manualDays })) {
    if (drafts >= 60) break;
    const username = p.username || msgs.find((m) => m.jid === p.jid && m.username)?.username || '';
    if (autoReply.ignoredInstagram(username)) continue;
    const lead = crm.ensureFromConversation({ key: p.jid, name: p.name, username, channel: 'instagram' });
    if (!lead || ['ganho', 'perdido'].includes(lead.stage)) continue;
    if (lead.igDraft && lead.igDraft.lastOurAt === p.lastOurAt) continue; // já tratado
    lead.igDraft = { status: 'pendente', kind: 'retomar', clientAt: p.at, lastOurAt: p.lastOurAt, username, name: p.name || '', texts: p.texts, text: await draftInstagram(p, username, 'retomar', lead).catch(() => ''), at: new Date().toISOString() };
    stalled++;
    drafts++;
  }
  store.save();
  store.addLog({ type: 'system', message: `📸 Direct verificado: ${recent} conversa(s) para o agente responder, ${old} antiga(s) no CRM e ${drafts} resposta(s) sugerida(s) para enviar pelo app (${stalled} para retomar conversas paradas)` });
  return { recent, old, drafts, stalled, total: new Set(msgs.map((m) => m.jid)).size };
}
/** Resposta sugerida pela IA para quem escreveu no Direct há mais de 24h (a equipe envia pelo app). */
async function draftInstagram(p, username, kind = 'responder', lead = null) {
  if (!llm.configured) return '';
  const conv = agent.conversation(p.jid);
  conv.name ||= p.name || '';
  conv.username ||= username;
  if (!conv.messages.length) {
    for (const m of p.context || []) agent.remember(conv, m.role, m.content);
    if (kind === 'responder') for (const t of p.texts) agent.remember(conv, 'user', t);
  }
  const days = Math.max(1, Math.round((Date.now() - p.at) / 86_400_000));
  // A abertura (saudação, demanda alta, perdão e agradecimento) é fixa; a IA escreve só a continuação.
  const opening = backlogOpening({ name: p.name || conv.name });
  const extraSystem = `# Continuação do atendimento (a equipe envia pelo app do Instagram)
A mensagem já começa com esta abertura, escrita pelo sistema: "${opening}"
NÃO escreva saudação, nem explicação da demora, nem pedido de perdão ou agradecimento: já estão na abertura. Escreva SÓ a continuação, em até 2 frases curtas.
${kind === 'retomar'
    ? `A conversa parou há ${days} dia(s): o cliente deixou de responder. Leia o que ele já disse e dê continuidade ao atendimento de onde parou: mostre que lembrou do caso dele (com as palavras dele) e faça UMA pergunta fácil que leve ao próximo passo.`
    : `O cliente escreveu há ${days} dia(s) e ficou sem resposta. Responda o que ele perguntou e dê continuidade ao atendimento.`}
NÃO peça o WhatsApp e não mande link: o sistema acrescenta isso depois da sua mensagem. Não liste planos em menu, não use markdown, não diga que é o Marcos e não use ferramentas.`;
  const r = await agent.think(conv, { dryRun: true, extraSystem });
  const cont = String(r.text || '').replace(/^\s+/, '').slice(0, 340);
  // Fechamento fixo: link do WhatsApp da Migra com o código da pessoa (liga as duas conversas) ou o número dela.
  const link = whatsappLinkFor(lead);
  const ending = link
    ? `Para continuarmos com mais agilidade, toque aqui e fale com a gente no WhatsApp: ${link}\nSe preferir, me passe o seu número com DDD que eu te chamo.`
    : 'Para continuarmos com mais agilidade, me passe o seu WhatsApp com DDD que eu te chamo.';
  return `${opening}\n\n${cont}\n\n${ending}`;
}
/** Link para o cliente abrir o WhatsApp da Migra já com o código dele na mensagem (o sistema liga a conversa ao Instagram). */
function whatsappLinkFor(lead) {
  const main = mainWhatsapp();
  if (!main) return '';
  return `https://wa.me/${main}?text=${encodeURIComponent(`Oi! Vim do Instagram da Migra${lead?.code ? ` (${lead.code})` : ''}.`)}`;
}

/** Avisa o responsável (ou os administradores) no dia do retorno agendado. */
async function notifyFollowUps() {
  for (const lead of crm.dueToNotify()) {
    const owner = lead.ownerId ? auth.get(lead.ownerId) : null;
    const targets = owner ? [owner] : auth.users.filter((u) => u.role === 'admin' && u.active !== false);
    const who = lead.name || (lead.phone ? `+${lead.phone}` : lead.instagram ? `@${lead.instagram}` : 'cliente');
    const text = `📅 *Retorno agendado para hoje*\nCliente: ${who}${lead.phone ? ` (+${lead.phone})` : ''}\nInteresse: ${lead.interest || '-'}\nMotivo da espera: ${lead.followUpReason || '-'}\n\nAbra o CRM em "Retornos" para retomar o atendimento.`;
    if (store.settings.crm?.notifyFollowUps !== false && wa.status === 'connected') {
      for (const u of targets) {
        if (u.whatsapp) await wa.send(u.whatsapp, { text, typing: false }).catch(() => {});
      }
    }
    store.addLog({ type: 'system', message: `📅 Retorno de hoje: ${who} (responsável: ${owner?.name || 'equipe'})` });
    crm.markNotified(lead);
    notify('crmDue', { id: lead.id });
  }
}

wa.on('status', (state) => {
  notify('status', state);
  if (state.status === 'connected') {
    console.log(`✅ WhatsApp conectado: ${state.me?.phone}`);
    setTimeout(() => sendTunnelNotice().catch(() => {}), 5000).unref?.();
  }
  if (state.error) console.log(`⚠️  Conexão: ${state.error}`);
  if (state.status === 'qr') console.log(`📱 Abra http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT} e escaneie o QR Code`);
});
wa.on('log', (entry) => store.addLog(entry));
// Histórico das últimas quedas do WhatsApp (para descobrir a causa de oscilações).
wa.on('drop', (d) => {
  const list = (store.data.waDrops ||= []);
  list.push(d);
  if (list.length > 60) list.splice(0, list.length - 60);
  store.save();
});

let igSynced = false;
wa.on('instagramStatus', (state) => {
  notify('instagramStatus', state);
  if (state.status === 'connected' && !igSynced) {
    igSynced = true;
    syncInstagram().catch((err) => store.addLog({ type: 'error', message: `Instagram (buscar conversas): ${err.message}` }));
  }
  if (state.status === 'connected') console.log(`✅ Instagram conectado: @${state.me?.username}`);
  if (state.error) console.log(`⚠️  Instagram: ${state.error}`);
});
wa.on('ownerMessage', (msg) => {
  if (maria.isLine(msg)) return; // o número da Maria é só da equipe
  // Atalho do consultor na conversa do cliente ("/contrato"): gera o contrato e não pausa a IA.
  if (!msg.isGroup && sellerCommands.wants(msg)) {
    sellerCommands.handle(msg).catch((err) => store.addLog({ type: 'error', message: `Atalho /contrato: ${err.message}` }));
    return;
  }
  pending.resolve(msg.jid);
  agent.ownerReplied({ key: msg.jid, phone: msg.phone, text: msg.text });
});
wa.on('history', (msgs) => pending.ingestHistory(msgs.filter((m) => !maria.isLine(m)))); // o número da Maria nunca vira fila de clientes
// A cada 5 minutos, responde quem ficou esperando (agente fora do ar, erro da IA, mensagem perdida).
setInterval(() => pending.autoAnswer(), 5 * 60_000).unref();
setInterval(() => pending.ensureRunning(), 60_000).unref();
wa.on('sent', ({ to, jid }) => {
  pending.resolve(jid);
  pending.resolve(to);
});
wa.on('lineStatus', (state) => notify('lineStatus', state));
// WhatsApp do vendedor conectou: confere se o número é o do cadastro.
lines.on('status', (state) => {
  if (state.status !== 'connected' || !state.me?.phone) return;
  const line = lines.get(state.id);
  if (!line || line.phone === state.me.phone) return;
  const r = matchSeller(line, state.me.phone, auth.users, { samePhone, taken: (uid) => Boolean(lines.byOwner(uid)) });
  lines.update(line.id, r.patch);
  if (r.userWhatsapp) auth.update(r.owner.id, { whatsapp: r.userWhatsapp });
  const who = r.owner?.name || 'sem vendedor';
  if (r.mismatch) {
    const msg = `⚠️ A conexão de ${who} foi feita com o WhatsApp +${state.me.phone}, mas o cadastro dele(a) tem +${r.owner.whatsapp}. Confira na aba Conexões WhatsApp.`;
    store.addLog({ type: 'error', message: msg });
    notifyAdmins(msg).catch(() => {});
  } else {
    store.addLog({ type: 'system', message: `✅ WhatsApp +${state.me.phone} conectado e identificado: ${who}` });
  }
  notify('lineStatus', { id: line.id });
});
wa.on('message', (msg) => {
  // Maria (assessora interna): tudo que chega no número dela é só dela; a atendente de clientes nunca responde ali.
  if (maria.isLine(msg)) {
    maria.handle(msg).catch((err) => store.addLog({ type: 'error', message: `Maria: ${err.message}` }));
    return;
  }
  // Nina (secretária do Marcos): mensagem de administrador liberado que a chama (ou áudio) vai só para ela.
  if (nina.wants(msg)) {
    nina.handle(msg).catch((err) => store.addLog({ type: 'error', message: `Nina: ${err.message}` }));
    return;
  }
  // Conversa do dono consigo mesmo: só a Nina atende (chamada pelo nome ou por áudio). O resto é anotação dele, nunca vai para a atendente.
  if (msg.selfChat) {
    // Atalhos de administração digitados na conversa "Você" (/resumo, /saude, /ajuda).
    if (sellerCommands.wants(msg)) { sellerCommands.handle(msg, { self: true }).catch((err) => store.addLog({ type: 'error', message: `Atalho: ${err.message}` })); return; }
    if (!nina.userFor(msg)) store.addLog({ type: 'error', message: `Nina: recebi uma mensagem sua na conversa "Você", mas o número +${msg.phone} não é de um administrador com acesso ao Caixa (aba Equipe: WhatsApp do Marcos + Caixa liberado).` });
    else if (!nina.enabled) store.addLog({ type: 'error', message: 'Nina: recebi uma mensagem sua, mas a Nina está desligada (Caixa → ⚙️ → Nina).' });
    return;
  }
  // Candidato a vaga mandou o currículo: guarda o arquivo e agradece, sem avisar ninguém.
  if (!msg.isGroup && !msg.fromMe) {
    const cv = agent.conversation(msg.jid, { create: false });
    if (cv && resumes.wants(msg, cv)) { resumes.handle(msg, cv).catch((err) => store.addLog({ type: 'error', message: `Currículo: ${err.message}` })); return; }
  }
  // Cliente com Pix em aberto mandou foto/PDF: se for o comprovante, a IA lê, confere e dá baixa; se não for, segue o atendimento.
  if (receipts.wants(msg)) {
    receipts.handle(msg).then((done) => done || routeIncoming(msg)).catch((err) => { store.addLog({ type: 'error', message: `Comprovante: ${err.message}` }); routeIncoming(msg); });
    return;
  }
  routeIncoming(msg);
});
function routeIncoming(msg) {
  pending.onIncoming(msg);
  if (!msg.isGroup) {
    try {
      // Chegou no WhatsApp (da Migra ou de um vendedor) com o código do Instagram: liga ao prospecto
      // e a atendente passa a ver o histórico de lá.
      if (msg.channel !== 'instagram') crm.linkByCode({ text: msg.text, key: msg.jid, phone: msg.phone });
      const lead = crm.ensureFromConversation({ key: msg.jid, phone: msg.phone, name: msg.name, username: msg.username, channel: msg.channel || 'whatsapp', referral: msg.referral, ownerId: msg.ownerId });
      // Veio pelo link de um indicador ("código de indicação: ana482")?
      const aff = affiliates.codeInText(msg.text);
      if (aff && lead) affiliates.attach(lead, aff, 'WhatsApp');
    } catch (err) {
      store.addLog({ type: 'error', message: `CRM: ${err.message}` });
    }
  }
  notify('message', msg);
  autoReply.handle(msg).catch((err) => store.addLog({ type: 'error', message: err.message }));
}

store.on('log', (log) => notify('log', log));

// Endereço na internet sem VPS (túnel gratuito da Cloudflare), para o webhook do Instagram.
const tunnel = new Tunnel({ dataDir: DATA_DIR, port: PORT });
// O túnel é um programa à parte: fecha junto com o painel (inclusive ao atualizar).
process.on('exit', () => tunnel.stop());
// Sem VPS nem domínio, o endereço provisório liga sozinho (a menos que alguém tenha desligado no painel).
const hasFixedUrl = () => Boolean(process.env.PUBLIC_URL) || Boolean(store.settings.crm?.panelUrl && !store.settings.crm.panelUrl.includes('trycloudflare.com'));
const tunnelWanted = () => process.env.TUNNEL !== 'off' && store.settings.instagram?.tunnel !== false && !hasFixedUrl();
let tunnelRetry = 0;
let tunnelTimer = null;
const restartTunnelSoon = () => {
  if (tunnelTimer || !tunnelWanted()) return;
  const wait = Math.min(300_000, 30_000 * 2 ** tunnelRetry++); // 30 s, 1 min, 2 min... até 5 min
  store.addLog({ type: 'system', message: `🌐 Endereço na internet fora do ar${tunnel.state.error ? ` (${tunnel.state.error})` : ''}. Tentando de novo em ${Math.round(wait / 1000)} s.` });
  tunnelTimer = setTimeout(() => {
    tunnelTimer = null;
    if (tunnelWanted()) tunnel.start().catch(() => restartTunnelSoon());
  }, wait);
  tunnelTimer.unref?.();
};
tunnel.on('status', (st) => {
  notify('tunnel', st);
  if (st.url) {
    tunnelRetry = 0;
    store.addLog({ type: 'system', message: `🌐 Endereço na internet ligado: ${st.url} (webhook do Instagram: ${st.url}/webhook/instagram)` });
    const current = store.settings.crm?.panelUrl || '';
    if (!current || current.includes('trycloudflare.com')) store.updateSettings({ crm: { panelUrl: st.url } });
    if (store.data.lastTunnelUrl !== st.url && !hasFixedUrl()) {
      const changed = Boolean(store.data.lastTunnelUrl);
      store.data.lastTunnelUrl = st.url;
      store.data.tunnelNotice = { url: st.url, changed };
      store.save();
      sendTunnelNotice();
    }
  }
  // Caiu (internet, Cloudflare): tenta de novo sozinho.
  if ((st.status === 'error' || st.status === 'off') && !st.url) restartTunnelSoon();
});
/** Avisa a equipe no WhatsApp o endereço novo do sistema (se o WhatsApp estiver fora do ar, avisa quando voltar). */
async function sendTunnelNotice() {
  const n = store.data.tunnelNotice;
  if (!n || wa.status !== 'connected') return;
  store.data.tunnelNotice = null;
  store.save();
  const phones = new Set(auth.users.filter((u) => u.active !== false && !u.pending && u.whatsapp).map((u) => u.whatsapp));
  const text = `🌐 ${n.changed ? 'O endereço do sistema Migra mudou.' : 'O sistema Migra já está na internet.'}\nEntre por aqui: ${n.url}\n${n.changed ? 'Links enviados antes desta mudança (contratos, orçamentos, indicação) param de abrir: gere e envie de novo pelo painel.' : 'Use sempre o link mais recente que chegar por aqui.'}`;
  for (const phone of phones) await wa.send(phone, { text, typing: false }).catch(() => {});
  store.addLog({ type: 'system', message: `🌐 Endereço avisado para ${phones.size} pessoa(s) da equipe: ${n.url}` });
}
// Confere a cada 5 minutos se o endereço abre de verdade; 3 falhas seguidas = liga um túnel novo.
let tunnelFails = 0;
setInterval(async () => {
  if (tunnel.state.status !== 'on' || !tunnel.state.url) return;
  try {
    const r = await fetch(`${tunnel.state.url}/api/brand`, { signal: AbortSignal.timeout(15_000) });
    tunnelFails = r.ok ? 0 : tunnelFails + 1;
  } catch {
    tunnelFails++;
  }
  if (tunnelFails >= 3) {
    tunnelFails = 0;
    store.addLog({ type: 'system', message: '🌐 O endereço na internet parou de responder. Ligando um novo...' });
    tunnel.stop(); // o aviso de "desligado" religa sozinho em seguida
  }
}, 5 * 60_000).unref();

// ---- App ----
const app = express();
// Só confia no proxy da própria máquina/rede (Caddy na VPS): de fora, ninguém falsifica o IP.
app.set('trust proxy', 'loopback, linklocal, uniquelocal');
app.disable('x-powered-by');
// Cabeçalhos de segurança: sem iframe de terceiros (clickjacking), sem adivinhar tipo de arquivo, HTTPS obrigatório na VPS.
app.use((req, res, next) => {
  res.set({
    'X-Frame-Options': 'SAMEORIGIN',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    // Sem scripts nem formulários de fora; ninguém coloca o sistema dentro de outra página.
    'Content-Security-Policy': "base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'self'",
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
// Pedido que muda dados, com sessão aberta, vindo de OUTRO site: recusado (defesa extra além do SameSite do cookie).
app.use((req, res, next) => {
  let pub = ''; try { pub = process.env.PUBLIC_URL ? new URL(process.env.PUBLIC_URL).host : ''; } catch { /* endereço inválido: só vale o próprio host */ }
  if (crossSiteBlocked(req, { cookieName: auth.cookieName, allowedHosts: [pub, ...SITE_HOSTS] })) return res.status(403).json({ error: 'Pedido de outro site bloqueado.' });
  next();
});
// Guarda o corpo bruto para validar a assinatura do webhook da Meta.
app.use(express.json({ limit: '5mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));

// Webhook da API oficial da Meta (fica fora da senha do painel).
const cloud = wa.clients.cloud;
app.get('/webhook', (req, res) => {
  const challenge = cloud.verifyWebhook(req.query);
  if (challenge === null) return res.sendStatus(403);
  store.addLog({ type: 'system', message: 'Webhook da Meta verificado com sucesso ✅' });
  res.status(200).send(challenge);
});
// Webhook do Instagram (Direct)
app.get('/webhook/instagram', (req, res) => {
  const challenge = instagram.verifyWebhook(req.query);
  if (challenge === null) return res.sendStatus(403);
  store.addLog({ type: 'system', message: 'Webhook do Instagram verificado com sucesso ✅' });
  res.status(200).send(challenge);
});
app.post('/webhook/instagram', (req, res) => {
  if (!instagram.checkSignature(req.rawBody, req.get('x-hub-signature-256'))) return res.sendStatus(401);
  res.sendStatus(200);
  if (instagram.status === 'connected') {
    instagram.handleWebhook(req.body).catch((err) => store.addLog({ type: 'error', message: `Instagram: ${err.message}` }));
  }
});
app.post('/webhook', (req, res) => {
  if (!cloud.checkSignature(req.rawBody, req.get('x-hub-signature-256'))) return res.sendStatus(401);
  res.sendStatus(200); // responde rápido; a Meta reenvia se demorar
  if (wa.mode === 'cloud') cloud.handleWebhook(req.body);
});

if (PANEL_PASSWORD) {
  const expected = Buffer.from(`${PANEL_USER}:${PANEL_PASSWORD}`);
  // Páginas públicas (site de imóveis, portal do indicador, recibos) ficam fora da senha extra.
  const PUBLIC = /^\/(imoveis|parceiros|indicacao|r\/|recibo\/|ficha\/|termo\/|etapas\/|orcamento\/|contrato\/|site\/|img\/|brand\/|privacidade\.html|api\/public\/|api\/affiliate\/)/;
  app.use((req, res, next) => {
    if (PUBLIC.test(req.path)) return next();
    const [scheme, encoded] = (req.headers.authorization || '').split(' ');
    const given = scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64') : Buffer.alloc(0);
    if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return next();
    res.set('WWW-Authenticate', 'Basic realm="WhatsApp Automacao"').status(401).send('Autenticação necessária');
  });
}

// O painel (página e programas) só é entregue a quem está logado: sem sessão, vai direto para o login (sem mostrar a casca da tela).
// Domínio próprio do site público (SITE_HOSTS): só páginas públicas; o painel não existe nesse endereço.
const SITE_HOSTS = siteHostsFrom();
const SITE_OFFICES = siteOfficeMap();
const siteContent = () => mergeContent(store.settings.site);
// Página inicial dos domínios do site: a versão premium (cópia melhorada do site do Marcos) ou, se escolhida em Site, a versão editável clássica.
const SITE_DIR = path.join(ROOT, 'public', 'site');
app.use(siteGuard({ hosts: SITE_HOSTS, homeFile: () => path.join(SITE_DIR, store.settings.site?.template === 'classic' ? 'home.html' : 'home-premium.html'), render: (html, origin) => (html.includes('{{HERO_TITLE}}') ? renderHome(html, siteContent(), origin) : renderPremium(html, origin, SITE_DIR)) }));
app.get('/robots.txt', (req, res) => {
  const site = SITE_HOSTS.has(hostOf(req));
  res.type('text/plain').send(site ? `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: https://${hostOf(req)}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n');
});
app.get('/sitemap.xml', (req, res, next) => {
  if (!SITE_HOSTS.has(hostOf(req))) return next();
  const origin = `https://${hostOf(req)}`;
  const urls = ['/', '/migra', '/imoveis', '/motors', '/school', '/parceiros', ...realty.listDevelopments().filter((d) => !d.hidden).map((d) => `/imoveis/l/${d.slug}`), ...realty.listProperties({ publicOnly: true }).map((p) => `/imoveis/p/${p.slug}`)];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${origin}${u}</loc></url>`).join('\n')}\n</urlset>\n`);
});
app.get('/api/public/site', (req, res) => res.json({ home: SITE_HOSTS.has(hostOf(req)) }));
const PANEL_FILES = new Set(['/', '/index.html', '/app.js', '/crm.js', '/ui.js', '/realty-admin.js', '/hub-areas.js', '/atendentes.js', '/contratos-antigos.js', '/retomar.js', '/executivo.js', '/site-admin.js', '/escritorios.js', '/preco.js', '/curriculos.js', '/videochamadas.js', '/live-admin.js', '/gravacoes.js', '/documentos.js', '/grupos.js', '/tutoriais.js', '/cidades.js', '/marketing.js', '/cobranca.js', '/cliente360.js', '/tarefas.js', '/contratos-quadros.js', '/servicos.js', '/comissoes.js', '/suporte.js', '/projetos.js', '/indicadores-admin.js', '/nav-hubs.js', '/empresas-apps.js', '/contabil-painel.js']);
app.use((req, res, next) => {
  if ((req.method !== 'GET' && req.method !== 'HEAD') || !PANEL_FILES.has(req.path)) return next();
  if (auth.fromRequest(req)) return next();
  if (req.path.endsWith('.js')) return res.status(401).type('text/plain').send('Entre com seu login');
  return res.redirect(302, '/login.html');
});
app.use(express.static(path.join(ROOT, 'public')));

// ---------- Site público: imóveis, loteamentos e programa de indicação ----------
const sitePage = (name) => (_req, res) => res.sendFile(path.join(ROOT, 'public', 'site', `${name}.html`));
app.get('/imoveis', sitePage('imoveis'));
app.get('/imoveis/p/:slug', sitePage('imovel'));
app.get('/imoveis/l/:slug', sitePage('loteamento'));
app.get('/parceiros', sitePage('parceiros'));
app.get('/parceiros/painel', sitePage('painel-parceiro'));
app.get('/indicacao', sitePage('indicacao'));
app.get('/imoveis/fotos/:name', (req, res) => {
  const file = realty.imagePath(req.params.name);
  if (!file) return res.sendStatus(404);
  res.set('Cache-Control', 'public, max-age=86400').sendFile(file);
});
// Link de indicação: grava quem indicou (o primeiro vale) e leva para o site.
const LINK_BOT = /whatsapp|facebookexternalhit|facebot|twitterbot|telegrambot|slackbot|linkedinbot|discordbot|bot\b|crawler|spider|preview/i;
const escAttr = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
app.get('/r/:code', (req, res) => {
  // O robô que monta a miniatura do link (WhatsApp, Instagram) não conta como clique.
  const bot = LINK_BOT.test(String(req.get('user-agent') || ''));
  const { cookies, affiliate, seller } = bot ? { cookies: [], affiliate: affiliates.byCode(req.params.code), seller: affiliates.sellerByCode(req.params.code) } : affiliates.recordClick(req, req.params.code);
  if (cookies.length) res.set('Set-Cookie', cookies);
  // Sem destino, o link leva ao pré-cadastro (é ele que garante a comissão de quem indicou).
  const code = affiliate?.code || seller?.refCode || '';
  const material = req.query.m ? affExtras.material(String(req.query.m)) : null;
  const group = affExtras.group(req.query.g || material?.group);
  let to = String(req.query.to || material?.to || (code ? `/indicacao?ref=${code}` : '/imoveis'));
  if (!(to.startsWith('/') && !to.startsWith('//'))) to = '/imoveis';
  // Link de grupo: a pessoa faz o pré-cadastro antes e só então entra no grupo (assim sabemos o número de quem entrou).
  if (group && code) to = `/indicacao?ref=${encodeURIComponent(code)}&g=${encodeURIComponent(group.key)}`;
  if (!material) return res.redirect(to);
  // Material de campanha: página com título, texto e imagem para a miniatura do WhatsApp, e redireciona na hora.
  const base = String(store.settings.crm?.panelUrl || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  const img = material.image ? `${base}/m/img/${material.image}` : `${base}/img/grupo-migra-emblema.png`;
  const desc = String(material.text || '').replace(/\{link\}|\{nome\}/g, '').replace(/\s+/g, ' ').trim().slice(0, 180);
  res.set('Cache-Control', 'no-store').type('html').send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escAttr(material.title)}</title><meta property="og:type" content="website"><meta property="og:title" content="${escAttr(material.title)}"><meta property="og:description" content="${escAttr(desc)}"><meta property="og:image" content="${escAttr(img)}"><meta property="og:url" content="${escAttr(`${base}/r/${code}?m=${material.id}`)}"><meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0;url=${escAttr(to)}"></head><body><p><a href="${escAttr(to)}">Continuar</a></p><script>location.replace(${JSON.stringify(to)})</script></body></html>`);
});
app.get('/m/img/:name', (req, res) => {
  const f = affExtras.imagePath(req.params.name);
  if (!f) return res.sendStatus(404);
  res.set('Cache-Control', 'public, max-age=86400').sendFile(f);
});
// Página do pré-cadastro: quem indicou (só o primeiro nome) e os serviços que dá para escolher.
app.get('/api/public/ref', (req, res) => {
  const { affiliate, seller } = affiliates.referrer(req, String(req.query.ref || ''));
  const who = affiliate || seller;
  res.json({
    name: who ? String(who.name).split(' ')[0] : '',
    kind: affiliate ? 'parceiro' : seller ? 'consultor' : '',
    services: affiliates.services.map((x) => x.label),
    business: store.settings.business?.name || 'Migra Paraguai',
    enabled: store.settings.affiliates?.enabled !== false,
  });
});
// Limite simples contra robôs no formulário público (por IP, por hora).
const preRegHits = new Map();
const preRegAllowed = (ip) => {
  const now = Date.now();
  const list = (preRegHits.get(ip) || []).filter((t) => now - t < 3_600_000);
  if (list.length >= 8) return false;
  list.push(now);
  preRegHits.set(ip, list);
  if (preRegHits.size > 5000) preRegHits.clear();
  return true;
};
app.post('/api/public/precadastro', async (req, res) => {
  if (!preRegAllowed(clientIp(req))) throw httpError(429, 'Recebemos muitos cadastros deste aparelho. Tente de novo mais tarde.');
  const b = req.body || {};
  const ref = affiliates.referrer(req, String(b.ref || ''));
  const r = affiliates.preRegister(b, ref);
  const { lead, owner, affiliate, service, extra } = r;
  const first = (n) => String(n || '').split(' ')[0];
  const sent = (to, text) => (to && wa.status === 'connected' ? wa.send(to, { text, typing: false }).catch(() => {}) : Promise.resolve());
  const brief = `👤 ${lead.name} · +${lead.phone}\n🎯 ${service.label}${extra ? `\n📝 ${extra}` : ''}${affiliate ? `\n🤝 Indicado por ${affiliate.name} (${affiliate.code})` : ref.seller ? '\n🔗 Veio pelo seu link' : ''}`;
  if (owner) {
    await sent(owner.whatsapp, `📝 *Novo pré-cadastro* — ${lead.code}\n${brief}\n\nChame o cliente agora: https://wa.me/${lead.phone}\nO prospecto já está na sua carteira em Prospectos.`);
  } else {
    await notifyAdmins(`📝 *Pré-cadastro sem vendedor* — ${lead.code}\n${brief}\n\nNinguém está com "Receber indicações de parceiros" ligado. Passe o prospecto para um vendedor em Prospectos.`);
  }
  if (affiliate) {
    await sent(affiliate.whatsapp, `📝 Boa notícia, ${first(affiliate.name)}! ${first(lead.name)} fez o pré-cadastro pelo seu link (${service.label}).${owner ? ` Quem vai atender é ${first(owner.name)}, da equipe Migra.` : ' A equipe Migra vai entrar em contato.'}\nAcompanhe no seu escritório virtual.`);
  }
  notify('crm', { id: lead.id });
  const main = mainWhatsapp();
  const text = `Olá! Acabei de fazer o pré-cadastro (código ${lead.code}). Meu nome é ${lead.name} e tenho interesse em: ${service.label}.`;
  const grp = affExtras.group(b.group);
  if (grp) (lead.timeline ||= []).push({ at: new Date().toISOString(), by: 'Sistema', type: 'nota', text: `👥 Entrou no grupo "${grp.label}" pelo link${affiliate ? ` de ${affiliate.name}` : ''}` });
  res.json({ ok: true, code: lead.code, seller: owner ? first(owner.name) : '', whatsappUrl: main ? `https://wa.me/${main}?text=${encodeURIComponent(text)}` : '', groupUrl: grp?.url || '', groupLabel: grp?.label || '' });
});
const mainWhatsapp = () => wa.getState().me?.phone || '';
app.get('/api/public/catalog', (_req, res) => {
  res.json({
    brand: store.settings.brand || {},
    types: PROPERTY_TYPES,
    properties: realty.listProperties({ publicOnly: true }),
    developments: realty.listDevelopments().filter((d) => !d.hidden).map((d) => ({ slug: d.slug, name: d.name, city: d.city, description: d.description, plan: d.plan, currency: d.currency, summary: d.summary })),
    whatsapp: mainWhatsapp(),
    affiliates: { enabled: store.settings.affiliates?.enabled !== false, rates: store.settings.affiliates?.rates || {}, cookieDays: store.settings.affiliates?.cookieDays || 180 },
  });
});
app.get('/api/public/property/:slug', (req, res) => {
  const p = realty.property(req.params.slug);
  if (!p || p.hidden) throw httpError(404, 'Imóvel não encontrado');
  res.json(p);
});
app.get('/api/public/development/:slug', (req, res) => {
  const d = realty.development(req.params.slug);
  if (!d || d.hidden) throw httpError(404, 'Loteamento não encontrado');
  res.json(realty.publicDevelopment(d));
});
// Interessado pelo site: vira prospecto no CRM (com o indicador, se houver) e vai para o WhatsApp do corretor.
app.post('/api/public/interest', async (req, res) => {
  const b = req.body || {};
  const phone = normalizePhone(b.whatsapp);
  if (String(b.name || '').trim().length < 2) throw httpError(400, 'Informe seu nome');
  if (!phone) throw httpError(400, 'Informe um WhatsApp válido, com DDD');
  let item = '';
  let agent = '';
  let value = 0;
  let currency = 'USD';
  let ref = {};
  if (b.kind === 'lot') {
    const d = realty.development(b.slug);
    const lot = d?.lots.find((l) => l.id === b.lotId);
    if (!lot) throw httpError(404, 'Lote não encontrado');
    if (lot.status === 'vendido' || lot.status === 'loteadora') throw httpError(409, 'Este lote não está à venda. Escolha um lote em verde.');
    item = `${d.name} · ${lot.code}${lot.area ? ` · ${lot.area} m²` : ''}`;
    agent = d.agentWhatsapp || '';
    value = lot.price || 0;
    currency = d.currency || 'USD';
    ref = { devId: d.id, lotId: lot.id };
  } else {
    const p = realty.property(b.slug);
    if (!p) throw httpError(404, 'Imóvel não encontrado');
    item = p.title;
    agent = p.agentWhatsapp || '';
    value = p.price || 0;
    currency = p.currency || 'USD';
    ref = { propertyId: p.id };
  }
  const existing = crm.leads.find((l) => l.phone === phone && l.category === 'imoveis' && !['ganho', 'perdido'].includes(l.stage));
  const lead = existing || crm.byId(crm.create({ name: 'Site', role: 'admin' }, { name: b.name, phone, email: b.email, source: 'site', category: 'imoveis', interest: item }).id);
  if (!lead.value && value) {
    lead.value = value;
    lead.currency = currency; // imóveis costumam ser em US$; a comissão sai na mesma moeda
  }
  lead.realtyRef = ref;
  const aff = affiliates.refFromRequest(req);
  if (aff) affiliates.attach(lead, aff, 'link do site');
  crm.addNote({ name: 'Site', role: 'admin' }, lead.id, `Interesse pelo site: ${item}${b.message ? ` · mensagem: ${String(b.message).slice(0, 300)}` : ''}`);
  const target = agent || mainWhatsapp();
  if (agent && wa.status === 'connected') {
    wa.send(agent, { text: `🏠 *Novo interessado pelo site* — ${lead.code}\n👤 ${b.name} · +${phone}\n📍 ${item}${aff ? `\n🤝 Indicado por ${aff.name}` : ''}${b.message ? `\n📝 ${String(b.message).slice(0, 300)}` : ''}`, typing: false }).catch(() => {});
  }
  const text = `Olá! Tenho interesse em: ${item}. Meu nome é ${b.name}. Código: ${lead.code}.`;
  res.json({ ok: true, code: lead.code, whatsappUrl: target ? `https://wa.me/${target}?text=${encodeURIComponent(text)}` : '' });
});

// Sites das outras marcas (Migra Paraguai, Motors, School): catálogo de veículos e formulário de interesse.
app.get('/migra', sitePage('migra'));
app.get('/motors', sitePage('motors'));
app.get('/school', sitePage('school'));
app.get('/marcas', sitePage('marcas'));
app.get('/live', sitePage('live'));
app.get('/api/public/live', (_req, res) => res.set('Cache-Control', 'no-store').json(live.publicView()));
app.get('/api/public/vehicles', (_req, res) => {
  res.json({
    whatsapp: mainWhatsapp(),
    vehicles: motors.vehicles({ publicOnly: true }).map(({ plate, createdAt, updatedAt, ...v }) => v),
  });
});
const BRAND_LEADS = {
  migracao: { sector: 'documentacao', icon: '🛂', label: 'Migra Paraguai (site)' },
  veiculos: { sector: 'veiculos', icon: '🚗', label: 'Migra Motors (site)' },
  school: { sector: 'documentacao', icon: '🎓', label: 'Migra School (site)' },
};
const leadHits = new Map();
app.post('/api/public/lead', async (req, res) => {
  const b = req.body || {};
  const brand = BRAND_LEADS[b.brand];
  if (!brand) throw httpError(400, 'Pedido inválido');
  const ip = clientIp(req);
  const recent = (leadHits.get(ip) || []).filter((t) => Date.now() - t < 3600_000);
  if (recent.length >= 8) throw httpError(429, 'Muitos pedidos seguidos. Tente de novo mais tarde ou fale pelo WhatsApp.');
  leadHits.set(ip, [...recent, Date.now()]);
  const phone = normalizePhone(b.whatsapp);
  const name = String(b.name || '').trim().slice(0, 80);
  if (name.length < 2) throw httpError(400, 'Informe seu nome');
  if (!phone) throw httpError(400, 'Informe um WhatsApp válido, com DDD');
  const item = String(b.item || brand.label).slice(0, 120);
  const message = String(b.message || '').trim().slice(0, 400);
  const office = SITE_OFFICES.get(hostOf(req)) || 'py';
  const person = sectors.next(brand.sector, office);
  const existing = crm.leads.find((l) => l.phone === phone && !['ganho', 'perdido'].includes(l.stage));
  const lead = existing || crm.byId(crm.create({ name: 'Site', role: 'admin' }, { name, phone, email: String(b.email || '').slice(0, 120), source: 'site', interest: item, ownerId: person?.id || null, office }).id);
  const aff = affiliates.refFromRequest(req);
  if (aff && !existing) affiliates.attach(lead, aff, 'link do site');
  crm.addNote({ name: 'Site', role: 'admin' }, lead.id, `${brand.label}: ${item}${message ? ` · mensagem: ${message}` : ''}`);
  notify('crm', { id: lead.id });
  const text = `${brand.icon} *Novo interessado pelo site* (${brand.label}) — ${lead.code}\n👤 ${name} · +${phone}\n📌 ${item}${message ? `\n📝 ${message}` : ''}\n💬 Chame agora: https://wa.me/${phone}`;
  if (person?.whatsapp && wa.status === 'connected') wa.send(person.whatsapp, { text, typing: false }).catch(() => {});
  else if (!person) notifyAdmins(`${text}\n\n⚠️ Ninguém está marcado para este assunto na Equipe.`).catch(() => {});
  const target = person?.whatsapp || mainWhatsapp();
  const hello = `Olá! Vim pelo site (${item}). Meu nome é ${name}. Código: ${lead.code}.`;
  res.json({ ok: true, code: lead.code, whatsappUrl: target ? `https://wa.me/${target}?text=${encodeURIComponent(hello)}` : '' });
});

// Portal do indicador (login próprio, separado do painel da equipe).
app.post('/api/affiliate/signup', (req, res) => {
  const a = affiliates.signup(req.body || {});
  res.set('Set-Cookie', affiliates.sessionCookie(a)).json(affiliates.publicAffiliate(a));
});
app.post('/api/affiliate/login', (req, res) => {
  const key = `parceiro:${String(req.body?.whatsapp || '').replace(/\D/g, '')}`;
  const ip = clientIp(req);
  const wait = loginGuard.blocked({ login: key, ip });
  if (wait) throw httpError(429, `Muitas tentativas erradas. Espere ${wait} minuto(s) e tente de novo.`);
  let a;
  try {
    a = affiliates.login(req.body?.whatsapp, req.body?.password);
  } catch (e) {
    loginGuard.fail({ login: key, ip });
    throw e;
  }
  loginGuard.success({ login: key });
  res.set('Set-Cookie', affiliates.sessionCookie(a)).json(affiliates.publicAffiliate(a));
});
app.post('/api/affiliate/logout', (_req, res) => res.set('Set-Cookie', affiliates.clearCookie()).json({ ok: true }));
const affiliateOnly = (req) => {
  const a = affiliates.fromRequest(req);
  if (!a) throw httpError(401, 'Entre com seu WhatsApp e senha');
  return a;
};
app.get('/api/affiliate/me', (req, res) => {
  const a = affiliateOnly(req);
  const base = String(store.settings.crm?.panelUrl || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  const link = `${base}/r/${a.code}`;
  const wa = mainWhatsapp();
  res.json({
    me: affiliates.publicAffiliate(a),
    stats: affiliates.stats(a),
    leads: affiliates.myLeads(a),
    commissions: affiliates.myCommissions(a),
    rates: store.settings.affiliates?.rates || {},
    categories: affiliates.categories(),
    links: {
      site: link,
      imoveis: `${link}?to=/imoveis`,
      whatsapp: wa ? `https://wa.me/${wa}?text=${encodeURIComponent(`Olá! Vim pela indicação de ${a.name} (código de indicação: ${a.code}). Quero saber mais sobre a Migra Paraguai.`)}` : '',
    },
    materials: shareMaterials(link),
    shareMessage: store.settings.affiliates?.shareMessage || '',
    business: store.settings.business?.name || 'Migra Paraguai',
  });
});
/** Loteamentos e imóveis para divulgar, cada um com o link de quem indica. */
function shareMaterials(link) {
  const devs = realty.listDevelopments().filter((d) => !d.hidden).map((d) => ({
    kind: 'Loteamento', title: d.name, city: d.city || '', info: d.summary?.disponivel ? `${d.summary.disponivel} lote(s) disponível(is)` : '', url: `${link}?to=/imoveis/l/${d.slug}`,
  }));
  const props = realty.listProperties({ publicOnly: true }).slice(0, 40).map((p) => ({
    kind: 'Imóvel', title: p.title, city: p.city || '', info: p.price ? `${{ USD: 'US$', PYG: 'Gs.', BRL: 'R$' }[p.currency] || p.currency || ''} ${Number(p.price).toLocaleString('pt-BR')}` : '', url: `${link}?to=/imoveis/p/${p.slug}`,
  }));
  return [{ kind: 'Pré-cadastro', title: 'Formulário de pré-cadastro (todos os serviços)', city: '', info: 'Garante a indicação', url: link }, { kind: 'Site', title: 'Catálogo de imóveis e terrenos', city: '', info: '', url: `${link}?to=/imoveis` }, ...devs, ...props];
}
app.get('/api/affiliate/qr', async (req, res) => {
  const a = affiliateOnly(req);
  const base = String(store.settings.crm?.panelUrl || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  res.type('image/png').send(await QRCode.toBuffer(`${base}/r/${a.code}`, { width: 360, margin: 1 }));
});
app.patch('/api/affiliate/me', (req, res) => {
  const a = affiliateOnly(req);
  const { email, password, country, pixKey, cpf, bank, account, holder, doc } = req.body || {};
  res.json(affiliates.publicAffiliate(affiliates.update(a.id, { email, password, country, pixKey, cpf, bank, account, holder, doc })));
});

// Escritório virtual: saldo e saque, pedidos de troca de indicação, grupos e materiais de campanha.
const baseUrl = (req) => String(store.settings.crm?.panelUrl || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
app.get('/api/affiliate/extras', (req, res) => {
  const a = affiliateOnly(req);
  const base = baseUrl(req);
  res.json({
    balance: affExtras.balance(a),
    transfers: affExtras.transfersFor(a),
    groups: affExtras.config.groups.map((g) => ({ label: g.label, link: `${base}/r/${a.code}?g=${g.key}` })),
    materials: affExtras.materials().map((m) => affExtras.forAffiliate(m, { base, code: a.code, name: a.name })),
  });
});
app.post('/api/affiliate/payout', async (req, res) => res.json(await affExtras.requestPayout(affiliateOnly(req), { currency: ['BRL', 'USD', 'PYG'].includes(req.body?.currency) ? req.body.currency : 'BRL' })));
app.post('/api/affiliate/transfers/:id/:action', async (req, res) => {
  const a = affiliateOnly(req);
  if (!['ceder', 'manter'].includes(req.params.action)) throw httpError(400, 'Ação inválida');
  res.json(await affExtras.respond(a, req.params.id, req.params.action === 'ceder'));
});
app.post('/api/affiliate/cede', async (req, res) => res.json(await affExtras.cede(affiliateOnly(req), req.body || {})));
// Recibo para o cliente (link assinado, sem login).
app.get('/recibo/:id', (req, res) => {
  const p = payments.get(req.params.id);
  if (!p || p.status !== 'paid' || req.query.t !== payments.receiptToken(p.id)) return res.status(404).send('Recibo não encontrado');
  res.type('application/pdf').set('Content-Disposition', `inline; filename="Recibo-${String(p.receiptNo).padStart(4, '0')}.pdf"`).sendFile(payments.receiptPath(p));
});

// Ficha de dados e termo da reserva (links enviados ao cliente no WhatsApp).
const clientMeta = (req) => ({ ip: req.ip, ua: req.get('user-agent') || '' });
app.get('/ficha/:id', sitePage('ficha'));
app.get('/etapas/:id', sitePage('etapas'));
app.get('/api/public/etapas/:id', (req, res) => {
  const rec = payplans.get(req.params.id, req.query.t);
  if (!rec) throw httpError(404, 'Link inválido');
  res.json({ packageName: rec.packageName, plan: rec.plan, company: store.settings.payments?.company?.name || 'Migra Paraguai' });
});
app.get('/termo/:id', sitePage('termo'));
app.get('/termo/:id/pdf', (req, res) => {
  const f = closing.get(req.params.id);
  if (!f || f.term?.status !== 'assinado' || req.query.t !== closing.token(f.id, 'termo')) return res.status(404).send('Termo não encontrado');
  res.type('application/pdf').set('Content-Disposition', 'inline; filename="Termo-de-reserva.pdf"').sendFile(closing.termPath(f));
});
app.get('/api/public/ficha/:id', (req, res) => res.json(closing.publicForm(req.params.id, req.query.t)));
app.post('/api/public/ficha/:id', async (req, res) => res.json(await closing.submitForm(req.params.id, req.query.t, req.body || {}, clientMeta(req))));
app.get('/api/public/termo/:id', (req, res) => res.json(closing.publicTerm(req.params.id, req.query.t)));
app.post('/api/public/termo/:id/assinar', async (req, res) => res.json(await closing.signTerm(req.params.id, req.query.t, req.body || {}, clientMeta(req))));

// Marca (nome e logo) — pública, usada também na tela de login.
const BRAND_LOGO = path.join(DATA_DIR, 'brand-logo');
app.get('/api/brand', (_req, res) => res.json({ ...(store.settings.brand || {}), customLogo: fs.existsSync(BRAND_LOGO) }));
app.get('/brand/logo', (_req, res) => {
  // Sempre confere com o servidor: quando a logo muda, aparece na hora (sem precisar de Ctrl + F5).
  res.set('Cache-Control', 'no-cache');
  if (fs.existsSync(BRAND_LOGO)) return res.type(fs.readFileSync(`${BRAND_LOGO}.type`, 'utf8')).sendFile(BRAND_LOGO);
  res.sendFile(path.join(ROOT, 'public', 'img', 'grupo-migra-logo.png'));
});

// ---- Login (administrador e vendedores) ----
const require2fa = () => store.settings.security?.require2fa !== false;
app.get('/api/auth/state', (req, res) => {
  const u = auth.fromRequest(req);
  res.json({ needsSetup: auth.needsSetup, setupCodeRequired: Boolean(process.env.SETUP_CODE), user: u ? { ...publicUser(u), visitDesk: isVisitDesk(u), cashAccess: cash.booksFor(u).length > 0 } : null, setup2fa: Boolean(u && require2fa() && !u.totpEnabled) });
});
// Cadastro do vendedor: fica aguardando a liberação do administrador (não entra antes disso).
app.post('/api/auth/signup', (req, res) => {
  if (auth.needsSetup) throw httpError(400, 'Crie primeiro o administrador.');
  const ip = clientIp(req);
  const wait = loginGuard.blocked({ login: 'cadastro', ip });
  if (wait) throw httpError(429, `Muitas tentativas. Espere ${wait} minuto(s).`);
  loginGuard.fail({ login: `cadastro:${ip}`, ip }); // conta tentativas por IP (evita cadastro em massa)
  const b = req.body || {};
  const password = String(b.password || '');
  if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) throw httpError(400, 'A senha precisa ter pelo menos 8 caracteres, com letras e números.');
  if (!normalizePhone(b.whatsapp)) throw httpError(400, 'Informe o seu WhatsApp com DDD (e o código do país).');
  const user = auth.create({ name: b.name, login: b.login, password, whatsapp: b.whatsapp, role: 'seller', pending: true });
  securityEvent('cadastro_pedido', user, req);
  notifyAdmins(`🆕 *Pedido de acesso ao sistema*\n👤 ${user.name} · login ${user.login}\n📱 +${user.whatsapp}\n🌐 IP ${ip}\n\nLibere ou recuse no painel, aba *Equipe*. Se não conhece essa pessoa, recuse.`).catch(() => {});
  notify('users', {});
  res.json({ ok: true, message: 'Cadastro enviado! Assim que o administrador liberar, você recebe um aviso no WhatsApp e já pode entrar.' });
});
app.post('/api/auth/setup', (req, res) => {
  if (!auth.needsSetup) throw httpError(403, 'O administrador já foi criado. Entre com login e senha.');
  // Na VPS o instalador define um código de instalação: sem ele, ninguém que ache o endereço consegue virar administrador.
  const need = process.env.SETUP_CODE;
  if (need) {
    const a = Buffer.from(String(req.body?.setupCode || '').trim());
    const b = Buffer.from(need);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw httpError(403, 'Código de instalação incorreto. Ele aparece no fim da instalação da VPS.');
  }
  const user = auth.create({ ...req.body, role: 'admin' });
  res.set('Set-Cookie', auth.sessionCookie(auth.get(user.id), { secure: req.secure })).json(user);
});
// Login protegido: limite de tentativas, código do app autenticador (2 etapas) e aviso de acesso novo.
const loginGuard = new LoginGuard();
const clientIp = (req) => String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
function securityEvent(type, user, req, extra = '') {
  store.data.securityLog ||= [];
  store.data.securityLog.push({ at: new Date().toISOString(), type, user: user?.name || user || '', ip: req ? clientIp(req) : 'sistema', ua: String(req?.get?.('user-agent') || '').slice(0, 160), extra });
  if (store.data.securityLog.length > 1000) store.data.securityLog.splice(0, store.data.securityLog.length - 1000);
  store.save();
}
app.post('/api/auth/login', async (req, res) => {
  const login = String(req.body.login || '').trim().toLowerCase();
  const ip = clientIp(req);
  const wait = loginGuard.blocked({ login, ip });
  if (wait) throw httpError(429, `Muitas tentativas erradas. Por segurança, espere ${wait} minuto(s) e tente de novo.`);
  if (auth.pendingLogin(login, req.body.password)) throw httpError(403, 'Seu cadastro está aguardando a liberação do administrador. Você recebe um aviso no WhatsApp quando for liberado.');
  const user = auth.login(login, req.body.password);
  if (!user) {
    const locked = loginGuard.fail({ login, ip });
    securityEvent('senha_errada', login, req);
    if (locked) {
      securityEvent('bloqueado', login, req);
      const who = auth.users.find((u) => u.login === login);
      notifyAdmins(`🚨 *Tentativas de senha bloqueadas no painel*\nLogin tentado: ${login || '-'}${who ? ` (${who.name})` : ''}\nIP: ${ip}\nHora: ${new Date().toLocaleString('pt-BR')}\n\n${who ? `Se foi ${who.name.split(' ')[0]} que esqueceu a senha: abra Equipe e toque em *Liberar acesso* (ou troque a senha dela(e), que também libera na hora). Sem fazer nada, libera sozinho em 15 minutos.\n\n` : ''}Se não foi alguém da equipe, alguém está tentando entrar. Troque as senhas e ligue a verificação em duas etapas (Configurações → Segurança).`).catch(() => {});
    }
    throw httpError(401, 'Login ou senha incorretos');
  }
  // Verificação em duas etapas: pede o código do app autenticador (menos em aparelho confiável, até 30 dias).
  const trusted = user.totpEnabled && auth.trustedDevice(req, user);
  if (user.totpEnabled && !trusted && !verifyTotp(user.totpSecret, req.body.code)) {
    if (req.body.code) {
      loginGuard.fail({ login, ip });
      securityEvent('codigo_errado', user, req);
      throw httpError(401, 'Código incorreto. Use o código de 6 números que aparece agora no app autenticador.');
    }
    return res.json({ needs2fa: true });
  }
  loginGuard.success({ login });
  securityEvent(trusted ? 'entrou_aparelho_confiavel' : 'entrou', user, req);
  // Aparelho/endereço novo: avisa os administradores no WhatsApp.
  user.knownIps ||= [];
  if (!user.knownIps.includes(ip)) {
    const first = !user.knownIps.length;
    user.knownIps = [...user.knownIps, ip].slice(-20);
    if (!first) notifyAdmins(`🔐 *Novo acesso ao painel*\n👤 ${user.name} (${user.role === 'admin' ? 'administrador' : 'vendedor'})\n🌐 IP ${ip}\n📱 ${String(req.get('user-agent') || '').slice(0, 90)}\n🕒 ${new Date().toLocaleString('pt-BR')}\n\nSe não foi essa pessoa: Configurações → Segurança → "Derrubar todos os acessos" e troque a senha.`).catch(() => {});
  }
  store.addLog({ type: 'system', message: `🔑 ${user.name} entrou no painel (IP ${ip})` });
  // Guarda o endereço público do painel para o link da ficha no aviso ao vendedor.
  const host = req.get('host') || '';
  if (user.role === 'admin' && !store.settings.crm?.panelUrl && host && !/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(host)) {
    store.updateSettings({ crm: { panelUrl: `${req.protocol}://${host}` } });
  }
  store.save();
  // Duas etapas obrigatórias: quem ainda não ligou entra só para configurar o app autenticador.
  const cookies = [auth.sessionCookie(user, { secure: req.secure })];
  // Digitou o código e pediu para lembrar: este aparelho fica confiável por 30 dias.
  if (user.totpEnabled && !trusted && req.body.remember !== false) cookies.push(auth.trustCookie(user, { secure: req.secure }));
  res.set('Set-Cookie', cookies).json({ ...publicUser(user), setup2fa: require2fa() && !user.totpEnabled });
});
app.post('/api/auth/logout', (_req, res) => {
  res.set('Set-Cookie', auth.clearCookie()).json({ ok: true });
});

// O que um vendedor pode acessar (o resto é só do administrador).
const OFFICE_ADMIN_ROUTES = [
  ['GET', /^\/(attendants|executive)$/],
  ['POST', /^\/users$/],
  ['PATCH', /^\/users\/[a-z0-9]+$/],
  ['POST', /^\/users\/[a-z0-9]+\/(approve|reject)$/],
];
const SELLER_ROUTES = [
  ['GET', /^\/offices$/],
  ['GET', /^\/(modules|status|events|me|users|pending|agent\/status|instagram\/status|crm\/agenda|crm\/stats|crm\/stages|crm\/ranking)$/],
  ['*', /^\/leads(\/|$)/],
  ['GET', /^\/conversations(\/|$)/],
  ['*', /^\/lines(\/|$)/],
  ['*', /^\/payments(\/|$)/],
  ['GET', /^\/realty\//],
  ['PATCH', /^\/realty\/developments\/[^/]+\/lots\/[^/]+$/],
  ['GET', /^\/finance\/(config|proposals(\/[a-f0-9]+\/(pdf|schedule))?)$/],
  ['POST', /^\/finance\/(simulate|options|proposals)$/],
  ['GET', /^\/motors\/(vehicles|lenders)$/],
  ['POST', /^\/motors\/compare$/],
  ['POST', /^\/conversations\/[^/]+\/(reply|handoff)$/],
  ['*', /^\/conversations\/[^/]+\/closing(\/[a-z]+)?$/],
  ['*', /^\/security\/(2fa\/(setup|enable|disable)|logout-all)$/],
  ['*', /^\/quotes(\/|$)/],
  ['POST', /^\/closing\/link$/],
  ['POST', /^\/contract\/extract$/],
  ['GET', /^\/sales(\/summary)?$/],
  ['GET', /^\/sales\/[a-f0-9]+$/],
  ['POST', /^\/sales\/[a-f0-9]+\/parcel\/\d+\/claim$/],
  ['POST', /^\/quotes\/[a-f0-9]+\/sale$/],
  ['GET', /^\/referral\/(me|qr)$/],
  ['PATCH', /^\/me\/prefs$/],
  ['GET', /^\/recordings$/],
  ['GET', /^\/(tutorials(\/[a-f0-9]+)?|cities(\/[a-f0-9]+)?)$/],
  ['POST', /^\/cities\/[a-f0-9]+\/send$/],
  ['*', /^\/tasks(\/[a-f0-9]+)?$/],
  ['GET', /^\/(contract-cards|alerts)$/],
  ['GET', /^\/services$/],
  ['GET', /^\/commissions\/me$/],
  ['POST', /^\/withdrawals$/],
  ['GET', /^\/support(\/[a-f0-9]+)?$/],
  ['GET', /^\/team-contacts$/],
  ['GET', /^\/projects(\/[a-f0-9]+)?$/],
  ['POST', /^\/projects$/],
  ['PATCH', /^\/projects\/[a-f0-9]+$/],
  ['POST', /^\/support(\/[a-f0-9]+\/messages)?$/],
  ['*', /^\/videocall\/me$/],
  ['POST', /^\/videocall\/[a-z0-9]+\/cancel$/],
];
const integrationHits = new Map();
app.post('/api/integrations/:app/users', (req, res) => {
  const ip = clientIp(req); const now = Date.now();
  const h = integrationHits.get(ip) || { n: 0, reset: now + 60_000 };
  if (now > h.reset) { h.n = 0; h.reset = now + 60_000; }
  h.n += 1; integrationHits.set(ip, h);
  if (h.n > 120) return res.status(429).json({ error: 'Muitos pedidos: espere um minuto' });
  const key = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!appSignups.checkKey(req.params.app, key)) {
    if (h.n <= 3) securityEvent('app_chave_invalida', null, req, `${req.params.app}: tentativa com chave errada`);
    return res.status(401).json({ error: 'Chave inválida' });
  }
  res.json(appSignups.ingest(req.params.app, req.body || {}));
});
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/') || req.path.startsWith('/public/') || req.path.startsWith('/affiliate/')) return next();
  // O envio automático da cópia usa uma chave temporária própria (conferida na própria rota), não a sessão do painel.
  if (req.path.startsWith('/legacy/ingest/')) return next();
  // Aplicativos da Migra (Migra Devocional) mandam cadastros com a chave própria (conferida na rota).
  if (req.path.startsWith('/integrations/')) return next();
  const user = auth.fromRequest(req);
  if (!user) return res.status(401).json({ error: auth.needsSetup ? 'Crie o administrador para começar' : 'Entre com seu login', login: true });
  req.user = user;
  // Administrador geral escolhe o escritório (cabeçalho X-Office); a equipe fica sempre no próprio.
  req.office = user.role === 'admin' ? normOffice(req.get('x-office') || (/\.csv$/.test(req.path) ? req.query.office : '')) || 'all' : officeOfUser(user);
  // Sem a verificação em duas etapas ligada, só dá para configurá-la.
  if (require2fa() && !user.totpEnabled && !/^\/(me|security\/2fa\/(setup|enable)|brand)$/.test(req.path)) {
    return res.status(403).json({ error: 'Ligue a verificação em duas etapas para usar o sistema.', setup2fa: true });
  }
  if (user.role === 'admin') return next();
  // Quem cuida das visitas (Silvani) confirma, remarca e cancela pela aba Visitas.
  if (/^\/visits(\/[a-f0-9]+\/(confirm|reschedule|cancel|done))?$/.test(req.path) && isVisitDesk(user)) return next();
  // Quem cuida dos documentos (setor de documentação) usa a aba Documentos.
  if (/^\/documents(\/|$)/.test(req.path) && (user.sectors || []).includes('documentacao')) return next();
  // Administrador do escritório: cuida da equipe, das conversas e dos resultados SÓ do próprio escritório (cada rota confere o escritório).
  if (user.officeAdmin && OFFICE_ADMIN_ROUTES.some(([method, re]) => method === req.method && re.test(req.path))) return next();
  // Gerente: cadastra mapas, lotes e produtos (criar e editar, nunca excluir).
  if (user.manager && ['POST', 'PATCH'].includes(req.method) && /^\/(realty|motors|finance|school)\//.test(req.path)) return next();
  const ok = SELLER_ROUTES.some(([method, re]) => (method === '*' || method === req.method) && re.test(req.path));
  if (!ok) return res.status(403).json({ error: 'Esta área é só do administrador' });
  if (req.method === 'DELETE' && !req.path.startsWith('/leads')) return res.status(403).json({ error: 'Esta área é só do administrador' });
  next();
});
// Auditoria: registra quem criou, alterou ou excluiu preços, lotes, juros, vendedores…
const lotOf = (m) => realty.development(m[1])?.lots.find((l) => l.id === m[2]);
const devOf = (m) => { const d = realty.development(m[1]); return d ? { ...d, lots: undefined } : null; };
app.use('/api', audit.middleware([
  { methods: ['PATCH', 'DELETE'], re: /^\/realty\/developments\/([^/]+)\/lots\/([^/]+)$/, entity: 'lote', get: lotOf, label: (m, o) => `${realty.development(m[1])?.name || 'Loteamento'} · ${o.code || m[2]}` },
  { methods: ['POST'], re: /^\/realty\/developments\/([^/]+)\/(lots|lots\/bulk|block)$/, entity: 'lote', label: (m, o, b) => `${realty.development(m[1])?.name || 'Loteamento'} · ${m[2] === 'lots' ? (o.code || 'novo lote') : 'vários lotes'}` },
  { methods: ['PATCH', 'DELETE'], re: /^\/realty\/developments\/([^/]+)$/, entity: 'loteamento', get: devOf, label: (m, o) => o.name || m[1] },
  { methods: ['POST'], re: /^\/realty\/developments$/, entity: 'loteamento', label: (m, o) => o.name || '' },
  { methods: ['PATCH', 'DELETE'], re: /^\/realty\/properties\/([^/]+)$/, entity: 'imóvel', get: (m) => realty.listProperties().find((p) => p.id === m[1]), label: (m, o) => o.title || m[1] },
  { methods: ['POST'], re: /^\/realty\/properties$/, entity: 'imóvel', label: (m, o) => o.title || '' },
  { methods: ['PATCH', 'DELETE'], re: /^\/motors\/vehicles\/([a-f0-9]+)$/, entity: 'veículo', get: (m) => motors.vehicle(m[1]), label: (m, o) => o.title || m[1] },
  { methods: ['POST'], re: /^\/motors\/vehicles$/, entity: 'veículo', label: (m, o) => o.title || '' },
  { methods: ['PATCH', 'DELETE'], re: /^\/motors\/lenders\/([a-f0-9]+)$/, entity: 'banco/consórcio', get: (m) => motors.lenders().find((l) => l.id === m[1]), label: (m, o) => o.name || m[1] },
  { methods: ['POST'], re: /^\/motors\/lenders$/, entity: 'banco/consórcio', label: (m, o) => o.name || '' },
  { methods: ['PATCH', 'DELETE'], re: /^\/school\/students\/([a-f0-9]+)$/, entity: 'aluno', get: (m) => { const x = school.student(m[1]); return x && { ...x, accesses: undefined }; }, label: (m, o) => o.name || m[1] },
  { methods: ['POST'], re: /^\/school\/students$/, entity: 'aluno', label: (m, o) => o.name || '' },
  { methods: ['PUT'], re: /^\/finance\/config$/, entity: 'juros e regras', get: () => proposals.config, label: () => 'Financiamento de lotes' },
  { methods: ['PATCH'], re: /^\/services\/([a-f0-9]+)$/, entity: 'serviço', get: (m) => { const x = serviceCatalog.get(m[1]); return x && { name: x.name, price: x.price, commissionPct: x.commissionPct, active: x.active }; }, label: (m, o) => o.name || m[1] },
  { methods: ['POST'], re: /^\/services$/, entity: 'serviço', label: (m, o, b) => b?.name || 'novo serviço' },
  { methods: ['PATCH', 'DELETE'], re: /^\/users\/([a-z0-9]+)$/, entity: 'usuário', get: (m) => { const u = auth.get(m[1]); return u && { name: u.name, role: u.role, active: u.active !== false, manager: Boolean(u.manager), sectors: u.sectors || [], whatsapp: u.whatsapp || '' }; }, label: (m, o) => o.name || m[1] },
]));
app.get('/api/audit', (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Só o administrador vê a auditoria');
  res.json({ items: audit.list(req.query), users: [...new Set(audit.log.map((e) => e.user))].sort(), entities: [...new Set(audit.log.map((e) => e.entity).filter(Boolean))].sort() });
});
app.get('/api/audit.csv', (req, res) => {
  needAdmin(req);
  audit.record({ user: req.user, ip: clientIp(req), action: 'alterou', entity: 'auditoria', label: 'Baixou a planilha da auditoria' });
  res.type('text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="auditoria.csv"').send(auditCsv(audit.list({ ...req.query, limit: 1000 })));
});
// Relatórios em planilha: vendas, parcelas em aberto e contratos cancelados (do escritório escolhido no alto da tela).
app.get('/api/reports/:kind.csv', (req, res) => {
  needAdmin(req);
  const kind = req.params.kind;
  if (!REPORTS[kind]) throw httpError(404, 'Relatório não encontrado');
  const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
  const csv = reportCsv(kind, sales.list.filter((s) => inOffice(req, sales.officeOf(s))), { from: day(req.query.from), to: day(req.query.to), seller: String(req.query.seller || '') });
  audit.record({ user: req.user, ip: clientIp(req), action: 'alterou', entity: 'relatório', label: `Baixou a planilha: ${REPORTS[kind].title}` });
  res.type('text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="${REPORTS[kind].file}-${new Date().toISOString().slice(0, 10)}.csv"`).send(csv);
});
app.get('/api/me', (req, res) => res.json(publicUser(req.user)));
// Preferências que o próprio vendedor controla.
app.patch('/api/me/prefs', (req, res) => {
  const patch = {};
  if (req.body?.receivesAffiliateLeads !== undefined) patch.receivesAffiliateLeads = Boolean(req.body.receivesAffiliateLeads);
  res.json(auth.update(req.user.id, patch));
});
// "Divulgar": a equipe tem os mesmos links e materiais dos parceiros.
const linkBase = (req) => (publicBase() || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
app.get('/api/referral/me', (req, res) => {
  const code = affiliates.sellerCode(req.user);
  const link = `${linkBase(req)}/r/${code}`;
  const clicks = affiliates.data.clicks.filter((c) => c.sellerId === req.user.id);
  const mine = crm.leads.filter((l) => l.ownerId === req.user.id);
  const u = auth.get(req.user.id);
  res.json({
    code,
    link,
    receivesAffiliateLeads: Boolean(u.receivesAffiliateLeads),
    stats: {
      clicks: clicks.length,
      visitors: new Set(clicks.map((c) => c.visitor)).size,
      precadastros: mine.filter((l) => l.precadastroAt).length,
      fromPartners: mine.filter((l) => l.affiliateId).length,
    },
    commission: { normal: sales.commissionPct(u.id), withPartner: sales.pctFor(u.id, true) },
    materials: shareMaterials(link),
    shareMessage: store.settings.affiliates?.shareMessage || '',
    publicUrl: Boolean(publicBase()),
  });
});
app.get('/api/referral/qr', async (req, res) => {
  res.type('image/png').send(await QRCode.toBuffer(`${linkBase(req)}/r/${affiliates.sellerCode(req.user)}`, { width: 360, margin: 1 }));
});
// Links para convidar a equipe e os parceiros (aba Equipe).
app.get('/api/system/links', (req, res) => {
  const base = publicBase();
  res.json({
    base,
    fixed: Boolean(store.settings.crm?.panelUrl && !/trycloudflare\.com/.test(store.settings.crm.panelUrl)) || Boolean(process.env.PUBLIC_URL),
    panel: base ? `${base}/` : '',
    signup: base ? `${base}/login.html?cadastro=1` : '',
    partners: base ? `${base}/parceiros` : '',
    site: base ? `${base}/imoveis` : '',
  });
});
// ---------- Segurança da conta ----------
app.get('/api/security/2fa/setup', async (req, res) => {
  const u = req.user;
  if (u.totpEnabled) throw httpError(400, 'A verificação em duas etapas já está ligada');
  u.totpPending = newTotpSecret();
  store.save();
  const url = otpauthUrl(u.totpPending, u.login, store.settings.brand?.name || 'Migra Hub');
  res.json({ secret: u.totpPending, qr: await QRCode.toDataURL(url, { margin: 1, width: 240 }) });
});
app.post('/api/security/2fa/enable', (req, res) => {
  const u = req.user;
  if (!u.totpPending || !verifyTotp(u.totpPending, req.body.code)) throw httpError(400, 'Código incorreto. Confira o código que aparece agora no app e tente de novo.');
  u.totpSecret = u.totpPending;
  u.totpEnabled = true;
  delete u.totpPending;
  u.sessionVersion = (u.sessionVersion || 0) + 1; // outros aparelhos precisam entrar de novo, já com o código
  u.trustVersion = (u.trustVersion || 0) + 1;
  store.save();
  securityEvent('2fa_ligada', u, req);
  res.set('Set-Cookie', auth.sessionCookie(u, { secure: req.secure })).json({ ok: true });
});
app.post('/api/security/2fa/disable', (req, res) => {
  const u = req.user;
  if (!auth.login(u.login, req.body.password) || !verifyTotp(u.totpSecret, req.body.code)) throw httpError(400, 'Senha ou código incorretos');
  u.totpEnabled = false;
  delete u.totpSecret;
  u.trustVersion = (u.trustVersion || 0) + 1;
  store.save();
  securityEvent('2fa_desligada', u, req);
  notifyAdmins(`⚠️ ${u.name} desligou a verificação em duas etapas do painel.`).catch(() => {});
  res.json({ ok: true });
});
app.post('/api/security/logout-all', (req, res) => {
  auth.revokeSessions(req.user.id);
  securityEvent('saiu_de_todos', req.user, req);
  res.set('Set-Cookie', auth.sessionCookie(auth.get(req.user.id), { secure: req.secure })).json({ ok: true });
});
app.post('/api/security/revoke-everyone', (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Só o administrador');
  auth.revokeAll();
  securityEvent('derrubou_todos', req.user, req);
  notifyAdmins(`🚨 ${req.user.name} derrubou todos os acessos ao painel. Todos precisam entrar de novo.`).catch(() => {});
  res.set('Set-Cookie', auth.sessionCookie(auth.get(req.user.id), { secure: req.secure })).json({ ok: true });
});
app.get('/api/security/log', (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Só o administrador');
  res.json({
    events: (store.data.securityLog || []).slice(-200).reverse(),
    users: auth.users.map((u) => ({ name: u.name, role: u.role, twoFactor: Boolean(u.totpEnabled), active: u.active !== false })),
    backups: backups.list().slice(0, 10),
    lastBackup: store.data.lastBackup || null,
    backupDir: store.settings.security?.backupDir || '',
  });
});
app.post('/api/security/backup', (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Só o administrador');
  if (req.body?.backupDir !== undefined) store.updateSettings({ security: { backupDir: String(req.body.backupDir || '').trim() } });
  res.json(backups.run());
});
app.get('/api/security/backup/:name', (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Só o administrador');
  const f = backups.file(req.params.name);
  if (!f) throw httpError(404, 'Backup não encontrado');
  securityEvent('baixou_backup', req.user, req, req.params.name);
  res.download(f);
});
app.get('/api/security/backup-key', (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Só o administrador');
  if (auth.get(req.user.id).totpEnabled !== true) throw httpError(403, 'Ligue a verificação em duas etapas para ver a chave do backup');
  securityEvent('viu_chave_backup', req.user, req);
  res.json({ key: backups.key.toString('hex') });
});

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, `${uid()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 64 * 1024 * 1024 },
});
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/** Converte um id de upload no objeto de mídia interno (nunca aceita caminhos do cliente). */
function resolveMedia(mediaId) {
  if (!mediaId) return null;
  const item = store.data.uploads.find((u) => u.id === mediaId);
  if (!item) throw httpError(400, 'Arquivo não encontrado. Envie o arquivo novamente.');
  return { id: item.id, path: path.join(UPLOAD_DIR, item.storedName), mimetype: item.mimetype, fileName: item.fileName };
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const publicMedia = (m) => (m ? { id: m.id, mimetype: m.mimetype, fileName: m.fileName } : null);

// Status e conexão
app.get('/api/status', (_req, res) => res.json(wa.getState()));
// Saúde do sistema: junta o que costuma parar o envio de mensagens e diz, em português, o que fazer.
function healthReport() {
  const st = wa.getState();
  const drops = [...(store.data.waDrops || [])].slice(-10).reverse();
  const recent = drops.filter((d) => Date.now() - Date.parse(d.at) < 15 * 60_000);
  const ai = agentConfig();
  const aiErr = llm.lastError;
  const queue = pending.status();
  const tips = [];
  const add = (level, text) => tips.push({ level, text });
  if (st.status === 'connected') add('ok', `WhatsApp conectado${st.me?.phone ? ` (+${st.me.phone})` : ''}.`);
  else if (st.status === 'qr') add('bad', 'O WhatsApp está esperando a leitura do QR Code (Conexões). Enquanto isso, nenhuma mensagem é enviada nem recebida.');
  else add('bad', `O WhatsApp NÃO está conectado (${st.status}). ${st.lastError || 'Abra Conexões e reconecte.'}`);
  if (recent.filter((d) => d.code === 440).length >= 2) add('bad', 'O número está aberto em OUTRO lugar (440): provavelmente o sistema do computador e o da VPS estão ligados ao mesmo tempo. Feche o do computador. Os dois se derrubam e o envio para.');
  else if (recent.length >= 3) add('warn', `A conexão caiu ${recent.length} vezes nos últimos 15 minutos (último motivo: ${recent[0].reason || recent[0].code}). Pode ser internet instável ou o número aberto em outro lugar.`);
  if (st.lastSend && !st.lastSend.ok) add('bad', `O último envio falhou: ${st.lastSend.error}. Depois de 3 falhas seguidas o sistema reinicia a conexão sozinho.`);
  else if (st.lastSend?.ok) add('ok', `Último envio com sucesso em ${new Date(st.lastSend.at).toLocaleString('pt-BR')}.`);
  else add('warn', 'Ainda não houve nenhum envio desde que o sistema ligou (faça o teste abaixo).');
  if (!llm.configured) add('bad', 'A IA não está configurada (aba Agente IA: escolha o provedor e cole a chave). Sem ela a atendente não responde ninguém.');
  else if (aiErr && (!llm.lastOkAt || aiErr.at > llm.lastOkAt)) add('bad', `A IA falhou no último uso: ${aiErr.message}`);
  else add('ok', `IA configurada (${ai.provider}, modelo ${ai.model || 'padrão'})${llm.lastOkAt ? `, última resposta em ${new Date(llm.lastOkAt).toLocaleString('pt-BR')}` : ''}.`);
  if (store.settings.agent?.enabled === false) add('bad', 'O agente está DESLIGADO (aba Agente IA → "Agente ligado").');
  if (queue.queue > 0 && !queue.running) add('bad', `Há ${queue.queue} cliente(s) na fila, mas a fila está PARADA. Abra Conversas e clique em "Agente responder marcados" de novo.`);
  else if (queue.queue > 0) add('warn', `Fila respondendo com cuidado: ${queue.queue} na fila, no máximo ${queue.perHour} por hora (${queue.sentLastHour} na última hora), das ${queue.from}h às ${queue.to}h${queue.etaMin ? `. Tempo estimado: cerca de ${Math.ceil(queue.etaMin / 60)} h` : ''}${queue.waiting ? `. Agora: ${queue.waiting}` : ''}.`);
  else if (queue.count > 0) add('warn', `${queue.count} cliente(s) esperando resposta e a fila está vazia (marque e clique em "Agente responder marcados").`);
  const pausedWaiting = pending.list().filter((p) => agent.conversation(p.jid, { create: false })?.handoff);
  if (pausedWaiting.length) add('bad', `${pausedWaiting.length} cliente(s) esperando resposta estão com a IA PAUSADA (conversa assumida por um humano ou "você respondeu pelo celular"). Em Conversas, clique em "Retomar com a IA".`);
  const lineList = lines.list().map((l) => ({ id: l.id, label: l.label, status: l.status, lastError: l.lastError || '', agent: l.agent !== false }));
  const off = lineList.filter((l) => l.status !== 'connected');
  if (off.length) add('warn', `${off.length} WhatsApp(s) de vendedor sem conexão: ${off.map((l) => l.label).join(', ')}.`);
  if (!publicBase()) add('warn', 'O sistema não tem endereço público (necessário para Instagram, contratos e links).');
  return {
    at: new Date().toISOString(),
    uptimeMin: Math.round(process.uptime() / 60),
    node: process.version,
    memoryMb: Math.round(process.memoryUsage().rss / 1048576),
    whatsapp: { status: st.status, me: st.me, lastError: st.lastError, lastSend: st.lastSend, sendFailures: st.sendFailures || 0 },
    drops, lines: lineList, queue,
    ai: { configured: llm.configured, provider: ai.provider, model: ai.model, lastOkAt: llm.lastOkAt || null, lastError: aiErr || null },
    tips,
    ok: !tips.some((t) => t.level === 'bad'),
  };
}
app.get('/api/health/detail', (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Só o administrador');
  res.json(healthReport());
});
app.post('/api/health/test-send', async (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Só o administrador');
  const to = normalizePhone(req.user.whatsapp);
  if (!to) throw httpError(400, 'Seu cadastro não tem WhatsApp (aba Equipe → Editar).');
  if (wa.status !== 'connected') throw httpError(400, `O WhatsApp não está conectado (${wa.status}).`);
  const started = Date.now();
  try {
    await wa.send(to, { text: '✅ Teste do Migra Hub: se você leu isto, o envio de mensagens está funcionando.', typing: false });
    res.json({ ok: true, ms: Date.now() - started, to });
  } catch (e) {
    res.status(502).json({ error: `O envio falhou: ${e.message}` });
  }
});
app.post('/api/connection/logout', async (_req, res) => {
  await wa.logout();
  res.json({ ok: true });
});
app.post('/api/connection/restart', async (_req, res) => {
  wa.restart();
  res.json({ ok: true });
});
app.post('/api/connection/pairing-code', async (req, res) => {
  const code = await wa.requestPairingCode(req.body.phone);
  store.addLog({ type: 'system', message: `Código de conexão gerado: ${code}` });
  res.json({ code });
});
app.post('/api/connection/mode', async (req, res) => {
  const mode = req.body.mode === 'cloud' ? 'cloud' : 'qr';
  await wa.switchMode(mode);
  res.json(wa.getState());
});
app.get('/api/instagram/status', (_req, res) => res.json(instagram.getState()));
app.post('/api/instagram/sync', async (_req, res) => res.json(await syncInstagram()));
// Direct de 1 a 15 dias: resposta sugerida pela IA para a equipe enviar pelo app do Instagram.
app.get('/api/instagram/manual', (_req, res) => res.json(crm.leads.filter((l) => l.igDraft?.status === 'pendente')
  .sort((a, b) => b.igDraft.clientAt - a.igDraft.clientAt)
  .map((l) => ({ id: l.id, code: l.code, name: l.name, ...l.igDraft }))));
app.post('/api/instagram/manual/:id/done', (req, res) => {
  const lead = crm.byId(req.params.id);
  if (!lead?.igDraft) throw httpError(404, 'Conversa não encontrada');
  const text = String(req.body?.text || lead.igDraft.text || '').slice(0, 900);
  Object.assign(lead.igDraft, { status: req.body?.skip ? 'ignorado' : 'respondido', doneBy: req.user.name, doneAt: new Date().toISOString() });
  const conv = lead.conversationKey ? agent.conversation(lead.conversationKey, { create: false }) : null;
  if (conv && text && !req.body?.skip) agent.remember(conv, 'assistant', text);
  crm.addNote(req.user, lead.id, req.body?.skip ? '📸 Direct antigo: marcado como sem resposta necessária' : `📸 Respondido pelo app do Instagram: "${text.slice(0, 200)}"`);
  store.save();
  res.json({ ok: true });
});
app.get('/api/wa/drops', (_req, res) => res.json([...(store.data.waDrops || [])].reverse().slice(0, 30)));
app.get('/api/tunnel', (_req, res) => res.json({ ...tunnel.state, auto: tunnelWanted() }));
app.post('/api/tunnel/start', async (_req, res) => {
  store.updateSettings({ instagram: { tunnel: true } });
  res.json(await tunnel.start());
});
app.post('/api/tunnel/stop', (_req, res) => {
  store.updateSettings({ instagram: { tunnel: false } });
  res.json(tunnel.stop());
});
app.get('/api/connection/info', (req, res) => {
  const c = cloudConfig();
  res.json({
    mode: wa.mode,
    webhookUrl: `${req.protocol}://${req.get('host')}/webhook`,
    instagramWebhookUrl: tunnel.state.url ? `${tunnel.state.url}/webhook/instagram` : `${req.protocol}://${req.get('host')}/webhook/instagram`,
    cloudConfigured: Boolean(c.accessToken && c.phoneNumberId),
    verifyTokenSet: Boolean(c.verifyToken),
    fromEnv: {
      token: Boolean(process.env.WA_CLOUD_TOKEN),
      phoneNumberId: Boolean(process.env.WA_PHONE_NUMBER_ID),
      verifyToken: Boolean(process.env.WA_VERIFY_TOKEN),
      appSecret: Boolean(process.env.WA_APP_SECRET),
      openrouter: Boolean(process.env.OPENROUTER_API_KEY),
      gemini: Boolean(process.env.GEMINI_API_KEY),
      openai: Boolean(process.env.OPENAI_API_KEY),
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      igToken: Boolean(process.env.IG_ACCESS_TOKEN),
      igVerifyToken: Boolean(process.env.IG_VERIFY_TOKEN),
      igAppSecret: Boolean(process.env.IG_APP_SECRET),
    },
  });
});

app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write(`event: status\ndata: ${JSON.stringify(wa.getState())}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
});

app.get('/api/stats', (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const logs = store.data.logs.filter((l) => l.at.startsWith(today));
  res.json({
    contacts: store.data.contacts.length,
    blacklist: store.data.blacklist.length,
    campaigns: store.data.campaigns.length,
    runningCampaign: campaigns.activeId,
    rules: store.data.rules.filter((r) => r.enabled).length,
    schedules: store.data.schedules.filter((s) => s.enabled).length,
    today: {
      sent: logs.filter((l) => l.type === 'sent').length,
      received: logs.filter((l) => l.type === 'received').length,
      autoreplies: logs.filter((l) => l.type === 'autoreply').length,
      errors: logs.filter((l) => l.type === 'error').length,
    },
  });
});

// Uploads de mídia
app.post('/api/uploads', upload.single('file'), (req, res) => {
  if (!req.file) throw httpError(400, 'Nenhum arquivo enviado');
  const item = {
    id: uid(),
    storedName: req.file.filename,
    fileName: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size,
    createdAt: new Date().toISOString(),
  };
  store.data.uploads.push(item);
  store.save();
  res.json(publicMedia(item));
});

// Contatos
app.get('/api/contacts', (req, res) => {
  const q = String(req.query.q || '').toLowerCase();
  const tag = String(req.query.tag || '').toLowerCase();
  let list = store.data.contacts;
  if (q) list = list.filter((c) => c.name?.toLowerCase().includes(q) || c.phone.includes(q));
  if (tag) list = list.filter((c) => c.tags?.some((t) => t.toLowerCase() === tag));
  res.json(list.map((c) => ({ ...c, blocked: store.isBlacklisted(c.phone) })));
});

app.get('/api/tags', (_req, res) => {
  const counts = {};
  for (const c of store.data.contacts) for (const t of c.tags || []) counts[t] = (counts[t] || 0) + 1;
  res.json(Object.entries(counts).map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count));
});

function upsertContacts(list, extraTags = []) {
  let added = 0;
  let updated = 0;
  for (const input of list) {
    const phone = normalizePhone(input.phone);
    if (!phone) continue;
    const tags = [...new Set([...(input.tags || []), ...extraTags].map((t) => t.trim()).filter(Boolean))];
    const existing = store.data.contacts.find((c) => c.phone === phone);
    if (existing) {
      if (input.name) existing.name = input.name;
      existing.tags = [...new Set([...(existing.tags || []), ...tags])];
      existing.fields = { ...(existing.fields || {}), ...(input.fields || {}) };
      updated++;
    } else {
      store.data.contacts.push({
        id: uid(),
        phone,
        name: input.name || '',
        tags,
        fields: input.fields || {},
        createdAt: new Date().toISOString(),
      });
      added++;
    }
  }
  store.save();
  return { added, updated };
}

app.post('/api/contacts', (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (!phone) throw httpError(400, 'Telefone inválido');
  const tags = Array.isArray(req.body.tags) ? req.body.tags : String(req.body.tags || '').split(',');
  res.json(upsertContacts([{ ...req.body, phone, tags }]));
});

app.put('/api/contacts/:id', (req, res) => {
  const c = store.data.contacts.find((x) => x.id === req.params.id);
  if (!c) throw httpError(404, 'Contato não encontrado');
  if (req.body.phone !== undefined) {
    const phone = normalizePhone(req.body.phone);
    if (!phone) throw httpError(400, 'Telefone inválido');
    c.phone = phone;
  }
  if (req.body.name !== undefined) c.name = String(req.body.name);
  if (req.body.tags !== undefined) {
    c.tags = (Array.isArray(req.body.tags) ? req.body.tags : String(req.body.tags).split(','))
      .map((t) => t.trim()).filter(Boolean);
  }
  store.save();
  res.json(c);
});

app.delete('/api/contacts/:id', (req, res) => {
  store.data.contacts = store.data.contacts.filter((c) => c.id !== req.params.id);
  store.save();
  res.json({ ok: true });
});

app.post('/api/contacts/bulk-delete', (req, res) => {
  const ids = new Set(req.body.ids || []);
  store.data.contacts = store.data.contacts.filter((c) => !ids.has(c.id));
  store.save();
  res.json({ ok: true });
});

app.post('/api/contacts/import', csvUpload.single('file'), (req, res) => {
  const text = req.file ? req.file.buffer.toString('utf8') : String(req.body.text || '');
  if (!text.trim()) throw httpError(400, 'Envie um arquivo CSV ou cole a lista');
  const parsed = csvToContacts(text);
  if (!parsed.length) throw httpError(400, 'Nenhum telefone válido encontrado');
  const extraTags = String(req.body.tags || '').split(',');
  res.json({ ...upsertContacts(parsed, extraTags), total: parsed.length });
});

app.get('/api/contacts/export', (_req, res) => {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = ['nome;telefone;tags;descadastrado'];
  for (const c of store.data.contacts) {
    lines.push([esc(c.name), esc(c.phone), esc((c.tags || []).join('|')), store.isBlacklisted(c.phone) ? 'sim' : 'nao'].join(';'));
  }
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="contatos.csv"');
  res.send(`﻿${lines.join('\n')}`);
});

app.post('/api/contacts/check', async (req, res) => {
  const phones = (req.body.phones || []).slice(0, 200);
  const results = [];
  for (const p of phones) results.push({ phone: p, ...(await wa.checkNumber(p)) });
  res.json(results);
});

// Lista de descadastrados (opt-out)
app.get('/api/blacklist', (_req, res) => res.json(store.data.blacklist));
app.post('/api/blacklist', (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (!phone) throw httpError(400, 'Telefone inválido');
  store.addToBlacklist(phone);
  res.json({ ok: true });
});
app.delete('/api/blacklist/:phone', (req, res) => {
  store.removeFromBlacklist(req.params.phone);
  res.json({ ok: true });
});

// Grupos
app.get('/api/groups', async (_req, res) => res.json(await wa.getGroups()));
// Quem do grupo já foi atendido: cruza os membros com as conversas, o CRM e os clientes/contratos copiados do sistema antigo.
// Só lê o grupo (nada é enviado a ninguém) e só o administrador vê.
const digitsOf = (v) => String(v || '').replace(/\D/g, '');
function attendedPhones() {
  const m = new Map();
  const add = (phone, via) => { const d = digitsOf(phone); if (d.length >= 8 && !m.has(d)) m.set(d, via); };
  for (const c of Object.values(store.data.conversations || {})) add(c.phone, 'conversa');
  for (const l of crm.leads) add(l.phone, 'CRM');
  for (const c of legacy.clients) add(c.phone, 'cliente antigo');
  for (const r of legacy.list) add(r.phone, 'contrato antigo');
  return m;
}
app.get('/api/groups/:id/coverage', async (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Esta área é só do administrador');
  const phones = [...new Set((await wa.getGroupParticipants(req.params.id)).map(digitsOf))].filter(Boolean);
  const have = attendedPhones();
  const members = phones.map((p) => ({ phone: p, attended: have.has(p), via: have.get(p) || '' }));
  const unattended = members.filter((x) => !x.attended);
  if (req.query.format === 'csv') {
    const cell = (v) => `"${String(v).replace(/"/g, '""')}"`;
    return res.type('text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="grupo-nao-atendidos.csv"').send(`﻿telefone\r\n${unattended.map((x) => cell(`+${x.phone}`)).join('\r\n')}`);
  }
  res.json({ total: members.length, attended: members.length - unattended.length, unattended: unattended.length, members: members.slice(0, 2000) });
});
app.post('/api/groups/:id/import', async (req, res) => {
  const phones = await wa.getGroupParticipants(req.params.id);
  const tag = String(req.body.tag || 'grupo').trim();
  res.json({ ...upsertContacts(phones.map((phone) => ({ phone })), [tag]), total: phones.length });
});

// Envio avulso
app.post('/api/send', async (req, res) => {
  const { to, message, mediaId } = req.body;
  const contact = store.data.contacts.find((c) => c.phone === normalizePhone(to)) || { phone: to };
  const text = renderTemplate(message || '', contact);
  const result = await wa.send(to, { text, media: resolveMedia(mediaId) });
  store.addLog({ type: 'sent', phone: normalizePhone(to) || to, message: text });
  res.json(result);
});

// Campanhas
app.get('/api/campaigns', (_req, res) => res.json(campaigns.list()));
app.get('/api/campaigns/:id', (req, res) => {
  const c = campaigns.get(req.params.id);
  if (!c) throw httpError(404, 'Campanha não encontrada');
  res.json({ ...campaigns.summary(c), media: publicMedia(c.media), recipients: c.recipients });
});
app.post('/api/campaigns', (req, res) => {
  const c = campaigns.create({ ...req.body, media: resolveMedia(req.body.mediaId) });
  if (req.body.startNow) campaigns.start(c.id);
  res.json(campaigns.summary(c));
});
app.post('/api/campaigns/preview', (req, res) => {
  const recipients = campaigns.resolveRecipients(req.body.target);
  const messages = (req.body.messages || [req.body.message]).filter(Boolean);
  const samples = recipients.slice(0, 3).map((r) => ({
    phone: r.phone,
    text: renderTemplate(messages[0] || '', r),
  }));
  res.json({ total: recipients.length, blocked: recipients.filter((r) => store.isBlacklisted(r.phone)).length, samples });
});
app.post('/api/campaigns/:id/start', (req, res) => res.json(campaigns.summary(campaigns.start(req.params.id))));
app.post('/api/campaigns/:id/pause', (req, res) => res.json(campaigns.summary(campaigns.pause(req.params.id))));
app.post('/api/campaigns/:id/cancel', (req, res) => res.json(campaigns.summary(campaigns.cancel(req.params.id))));
app.post('/api/campaigns/:id/retry-failed', (req, res) => {
  const c = campaigns.get(req.params.id);
  if (!c) throw httpError(404, 'Campanha não encontrada');
  for (const r of c.recipients) if (r.status === 'failed') { r.status = 'pending'; delete r.error; }
  if (c.status === 'done' || c.status === 'canceled') c.status = 'paused';
  store.save();
  res.json(campaigns.summary(c));
});
app.delete('/api/campaigns/:id', (req, res) => {
  campaigns.remove(req.params.id);
  res.json({ ok: true });
});

// Respostas automáticas
app.get('/api/rules', (_req, res) => res.json(autoReply.list().map((r) => ({ ...r, media: publicMedia(r.media) }))));
app.post('/api/rules', (req, res) => {
  const media = req.body.mediaId ? resolveMedia(req.body.mediaId) : req.body.removeMedia ? null : undefined;
  res.json(autoReply.save({ ...req.body, media }));
});
app.delete('/api/rules/:id', (req, res) => {
  autoReply.remove(req.params.id);
  res.json({ ok: true });
});
app.post('/api/rules/test', (req, res) => {
  const decision = autoReply.decide({ text: req.body.text, phone: null, name: req.body.name || 'Cliente' });
  res.json(decision ? { kind: decision.kind, rule: decision.rule?.name, text: decision.text } : null);
});

// Agendamentos
app.get('/api/schedules', (_req, res) => res.json(scheduler.list().map((s) => ({ ...s, media: publicMedia(s.media) }))));
app.post('/api/schedules', (req, res) => {
  const media = req.body.mediaId ? resolveMedia(req.body.mediaId) : undefined;
  res.json(scheduler.save({ ...req.body, media }));
});
app.delete('/api/schedules/:id', (req, res) => {
  scheduler.remove(req.params.id);
  res.json({ ok: true });
});

// Configurações (segredos nunca voltam completos para o navegador)
const SECRET_PATHS = [
  ['agent', 'apiKey'],
  ['agent', 'geminiKey'],
  ['agent', 'openaiKey'],
  ['agent', 'claudeKey'],
  ['connection', 'cloud', 'accessToken'],
  ['connection', 'cloud', 'appSecret'],
  ['agenda', 'calcom', 'apiKey'],
  ['instagram', 'accessToken'],
  ['instagram', 'appSecret'],
  ['payments', 'mercadopago', 'accessToken'],
  ['marketing', 'metaToken'],
  ['updater', 'token'],
];
const MASK = '••••••';
const mask = (v) => (v ? `${MASK}${String(v).slice(-4)}` : '');
function publicSettings() {
  const copy = structuredClone(store.settings);
  for (const p of SECRET_PATHS) {
    const parent = p.slice(0, -1).reduce((o, k) => o?.[k], copy);
    if (parent) parent[p.at(-1)] = mask(parent[p.at(-1)]);
  }
  return copy;
}
function stripMaskedSecrets(patch) {
  for (const p of SECRET_PATHS) {
    const parent = p.slice(0, -1).reduce((o, k) => o?.[k], patch);
    if (parent && typeof parent[p.at(-1)] === 'string' && parent[p.at(-1)].startsWith(MASK)) delete parent[p.at(-1)];
  }
  return patch;
}
app.get('/api/settings', (_req, res) => res.json(publicSettings()));
// Registra quando o agente é ligado/desligado ou muda entre teste e no ar (para descobrir quem ou o que mudou).
function noteAgentMode(before, who) {
  const a = store.settings.agent || {};
  if (before.audience !== a.audience || before.enabled !== a.enabled) store.addLog({ type: 'system', message: `Agente: ${before.enabled ? 'ligado' : 'desligado'}/${before.audience || '-'} → ${a.enabled ? 'ligado' : 'desligado'}/${a.audience || '-'} (por ${who})` });
}
app.put('/api/settings', async (req, res) => {
  const before = JSON.stringify(cloudConfig());
  const igBefore = JSON.stringify(instagramConfig());
  // A tabela de taxas do cartão é substituída inteira (apagar uma linha no painel apaga a taxa).
  if (req.body?.payments?.card?.fees && store.data.settings.payments) store.data.settings.payments.card = { fees: {} };
  const agBefore = { audience: store.settings.agent?.audience, enabled: store.settings.agent?.enabled };
  store.updateSettings(stripMaskedSecrets(req.body));
  noteAgentMode(agBefore, req.user?.name || 'painel');
  // Prazo de quem a IA responde sozinha mudou: já coloca na fila quem entrou no prazo.
  if (req.body?.agent?.pendingMaxDays) setTimeout(() => pending.autoAnswer(), 1000).unref?.();
  // Credenciais da Meta mudaram: reconecta para validar.
  if (wa.mode === 'cloud' && JSON.stringify(cloudConfig()) !== before) wa.restart();
  if (JSON.stringify(instagramConfig()) !== igBefore) instagram.start();
  res.json(publicSettings());
});

// Agente de IA
const agentStatus = () => {
  const a = store.settings.agent;
  return {
    enabled: a.enabled,
    configured: llm.configured,
    active: agent.active,
    provider: agentConfig().provider,
    model: agentConfig().model,
    audience: a.audience,
    testNumbers: (a.testNumbers || []).length,
    business: store.settings.business.name,
    lastError: agent.lastError || null,
  };
};
app.get('/api/agent/status', (_req, res) => res.json(agentStatus()));
// Liga a IA (e, se pedido, coloca no ar para todos) direto do aviso do painel.
app.post('/api/agent/enable', (req, res) => {
  const patch = { enabled: req.body.enabled !== false };
  if (req.body.audience === 'all') patch.audience = 'all';
  const agBefore = { audience: store.settings.agent?.audience, enabled: store.settings.agent?.enabled };
  store.updateSettings({ agent: patch });
  noteAgentMode(agBefore, req.user?.name || 'painel');
  // Ligou a IA: já começa a responder quem estava esperando.
  setTimeout(() => pending.autoAnswer({ minAgeMs: 0 }), 2000);
  res.json(agentStatus());
});
// Testa a chave e o modelo da IA na hora, mostrando o erro exato.
app.post('/api/agent/check', async (_req, res) => {
  const started = Date.now();
  try {
    const r = await llm.chat({ messages: [{ role: 'user', content: 'Responda só: OK' }] });
    agent.lastError = null;
    res.json({ ok: true, model: r.fallbackModel || agentConfig().model, fallback: Boolean(r.fallbackModel), ms: Date.now() - started, reply: String(r.content).slice(0, 60) });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});
app.get('/api/agent/presets', (_req, res) => {
  res.json(Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label })));
});
app.post('/api/agent/presets/:id/apply', (req, res) => {
  store.updateSettings(presetSettings(req.params.id));
  store.addLog({ type: 'system', message: `Perfil de negócio carregado: ${PRESETS[req.params.id].label}` });
  res.json(publicSettings());
});
app.post('/api/agent/simulate', async (req, res) => {
  const text = String(req.body.text || '').trim();
  if (!text) throw httpError(400, 'Digite uma mensagem');
  const r = await agent.simulate({ session: req.body.session || 'simulador', text, dryRun: req.body.dryRun !== false });
  // O painel mostra a resposta no mesmo ritmo do WhatsApp: mensagens picadas e tempos de leitura e digitação.
  const h = humanizeConfig(store.settings.agent?.humanize);
  res.json({ ...r, bubbles: h.splitMessages ? splitIntoBubbles(r.text) : [r.text], humanize: h });
});
app.delete('/api/agent/simulate/:session', (req, res) => {
  agent.clearConversation(`sim:${req.params.session}`);
  res.json({ ok: true });
});
app.get('/api/agent/stress-tests', (_req, res) => {
  const custom = store.settings.agent.testMessages;
  res.json(custom?.length ? custom : STRESS_TESTS);
});
app.post('/api/agent/stress-test', async (req, res) => {
  // Cada teste roda numa conversa nova e sem gravar agendamentos.
  const session = `stress-${uid()}`;
  try {
    res.json(await agent.simulate({ session, text: String(req.body.text || ''), dryRun: true }));
  } finally {
    agent.clearConversation(`sim:${session}`);
  }
});
app.get('/api/agent/prompt', (_req, res) => {
  res.type('text/plain').send(buildSystemPrompt(store.settings, { now: new Date() }));
});

// Conversas (memória do agente)
/** Vendedor vê só as conversas do número dele e as dos prospectos que são dele. */
function canSeeConv(user, key) {
  if (user.role === 'admin') return true;
  const line = parseLineKey(key);
  if (line) return lines.get(line.id)?.ownerId === user.id || (Boolean(user.officeAdmin) && officeOfKey(key) === officeOfUser(user));
  return crm.leads.some((l) => (l.ownerId === user.id || (user.officeAdmin && crm.officeOf(l) === officeOfUser(user))) && (l.conversationKey === key || l.whatsappKey === key));
}
const convLabel = (key) => {
  const line = parseLineKey(key);
  return line ? lines.get(line.id)?.label || 'Número da equipe' : String(key).startsWith('ig:') ? 'Instagram' : 'Principal';
};
// Conversas e funil separados por atendente (só administrador).
app.get('/api/attendants', (req, res) => {
  res.json(byAttendant({
    conversations: agent.listConversations().filter((c) => inOffice(req, conversationOffice(c))),
    leads: crm.leads.filter((l) => inOffice(req, crm.officeOf(l))),
    users: auth.users.filter((u) => inOffice(req, u.role === 'admin' ? 'py' : u.office)),
    lineOwner: lineOwnerOf,
    findLead: (c) => crm.findForConversation({ key: c.key, phone: c.phone, username: c.username }),
  }));
});
/** Escritório de uma conversa (pelo número ou pelo prospecto dono). */
const conversationOffice = (c) => {
  const l = parseLineKey(c.key);
  if (l) return officeOfKey(c.key);
  const lead = crm.findForConversation({ key: c.key, phone: c.phone, username: c.username });
  return lead ? crm.officeOf(lead) : officeOfKey(c.key);
};
// Conta, uma vez só, as mensagens que a atendente já tinha enviado antes da medição exata (mínimo, pela memória das conversas).
usage.backfill(Object.values(store.data.conversations || {}), conversationOffice);
const lineOwnerOf = (key) => { const l = parseLineKey(key); const line = l && lines.get(l.id); return line ? { ownerId: line.ownerId || null, label: line.label } : null; };
// Administrador: cada conversa vem com o atendente responsável, para a tela separar por pessoa.
app.get('/api/conversations', (req, res) => {
  const ids = new Set(auth.users.map((u) => u.id));
  const names = new Map(auth.users.map((u) => [u.id, u.name]));
  const admin = req.user.role === 'admin';
  res.json(agent.listConversations().filter((c) => canSeeConv(req.user, c.key) && inOffice(req, conversationOffice(c))).map((c) => {
    const base = { ...c, channelLabel: convLabel(c.key) };
    if (!admin) return base;
    const id = attendantOf(c, { ids, lineOwner: lineOwnerOf, findLead: (x) => crm.findForConversation({ key: x.key, phone: x.phone, username: x.username }) });
    return { ...base, attendantId: id, attendantName: names.get(id) || (id.startsWith('line:') ? id.slice(5) : 'IA conversando (ainda não direcionada)') };
  }));
});
// Rotas de controle (quadros, auditoria dos números, envio por número, rodízio e fechamentos, baixas da Maria, recomeçar parados): src/routes/controle.js
const { restartAll, convOfLead, noticeQuotes, repairLeads } = registerControleRoutes(app, {
  // Funções definidas mais adiante no arquivo entram por "ponte" (só são chamadas quando chega um pedido).
  needAdmin: (r) => needAdmin(r), httpError: (...x) => httpError(...x), inOffice: (...x) => inOffice(...x), securityEvent: (...x) => securityEvent(...x),
  conversationOffice: (...x) => conversationOffice(...x), convLabel: (...x) => convLabel(...x), lineOwnerOf: (...x) => lineOwnerOf(...x),
  store, auth, crm, agent, pending, lines, wa, sales, quotes, legacy,
});
// Busca por palavra em todas as conversas (só administrador; respeita o escritório escolhido no alto da tela).
app.get('/api/search/conversations', (req, res) => {
  needAdmin(req);
  const q = String(req.query.q || '').trim();
  if (q.length < 2) throw httpError(400, 'Digite pelo menos 2 letras');
  const all = Object.values(store.data.conversations || {});
  const r = searchConversations(all, { q, days: Math.min(3650, Math.max(0, Number(req.query.days) || 0)), canSee: (c) => inOffice(req, conversationOffice(c)) });
  res.json({ ...r, items: r.items.map((i) => ({ ...i, channelLabel: convLabel(i.key) })) });
});
app.use('/api/conversations/:key', (req, _res, next) => {
  if (!canSeeConv(req.user, req.params.key)) throw httpError(403, 'Esta conversa é de outro vendedor');
  next();
});
app.get('/api/conversations/:key', (req, res) => {
  const conv = agent.conversation(req.params.key, { create: false });
  if (!conv) throw httpError(404, 'Conversa não encontrada');
  res.json({ ...conv, channelLabel: convLabel(conv.key) });
});
app.post('/api/conversations/:key/handoff', (req, res) => {
  res.json(agent.setHandoff(req.params.key, Boolean(req.body.value), 'Assumido pelo painel'));
});
app.post('/api/conversations/:key/reply', async (req, res) => {
  const conv = agent.conversation(req.params.key, { create: false });
  if (!conv) throw httpError(404, 'Conversa não encontrada');
  const text = String(req.body.text || '').trim();
  if (!text) throw httpError(400, 'Mensagem vazia');
  await wa.send(conv.key, { text, typing: false });
  agent.remember(conv, 'assistant', text);
  const lead = crm.findForConversation({ key: conv.key, phone: conv.phone });
  if (lead && crm.canSee(req.user, lead)) crm.addNote(req.user, lead.id, `💬 Respondeu o cliente: "${text.slice(0, 200)}"`);
  store.addLog({ type: 'sent', phone: conv.phone || conv.key, message: text });
  res.json(conv);
});
app.delete('/api/conversations/:key', (req, res) => {
  agent.clearConversation(req.params.key);
  res.json({ ok: true });
});

// Conversas sem resposta
app.get('/api/pending', (req, res) => {
  const items = pending.list().filter((p) => canSeeConv(req.user, p.jid) && inOffice(req, officeOfKey(p.jid))).map((p) => {
    const conv = agent.conversation(p.jid, { create: false });
    return { ...p, channelLabel: convLabel(p.jid), pausedReason: conv?.handoff ? conv.handoffReason || 'um humano assumiu' : '' };
  });
  const paused = items.filter((p) => p.pausedReason);
  res.json({ ...pending.status(), count: items.length, items, maxDays: Number(store.settings.agent?.pendingMaxDays || 15), paused: paused.length, pausedByOwner: paused.filter((p) => p.pausedReason === OWNER_PAUSE).length });
});
// Clientes esperando cuja conversa foi pausada só porque o dono respondeu pelo celular: a IA volta a atender e já entra na fila.
app.post('/api/pending/resume-paused', (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Só o administrador');
  const jids = pending.list().map((p) => p.jid).filter((jid) => {
    const c = agent.conversation(jid, { create: false });
    return c?.handoff && c.handoffReason === OWNER_PAUSE;
  });
  for (const jid of jids) agent.setHandoff(jid, false);
  securityEvent('ia_retomada', req.user, req, `${jids.length} conversa(s) devolvida(s) para a IA`);
  const r = jids.length ? pending.enqueue(jids) : { queued: 0, blocked: 0 };
  res.json({ resumed: jids.length, ...r });
});

// Migra Imóveis (administração)
const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12_000_000 } }).single('file');
const imageExt = (file) => {
  if (!file || !/^image\/(png|jpeg|webp)$/.test(file.mimetype)) throw httpError(400, 'Envie uma imagem PNG, JPG ou WEBP');
  return { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[file.mimetype];
};
// Painel executivo (só administrador): cobranças, vencimentos, recebimentos, vendas e funil.
const execFor = (office) => {
  const now = Date.now();
  const today = dayStr(now);
  const month = execPeriods(today).mes;
  const only = office && office !== 'all' ? office : '';
  const stats = crm.stats({ from: month.from, to: month.to, office: only });
  const open = visits.list.filter((v) => ['pendente', 'aguardando_taxa', 'remarcar'].includes(v.status)).length;
  const exec = buildExecutive({
    sales: sales.list.filter((s) => !only || sales.officeOf(s) === only), now,
    crm: { newLeads: stats.newLeads, openLeads: stats.openLeads, openValue: stats.openValue, won: stats.won, wonValue: stats.wonValue, lost: stats.lost, conversion: stats.conversion, avgTicket: stats.avgTicket, followUps: stats.followUps, byStage: stats.byStage, bySource: stats.bySource, months: stats.months },
    extras: { visitasAbertas: only && only !== 'py' ? 0 : open, retomarNovos: only && only !== 'py' ? 0 : reengage.summary().novo, esperando: pending.list().filter((p) => !only || officeOfKey(p.jid) === only).length, whatsapp: wa.status },
  });
  const us = usage.summary(only);
  exec.usage = { month: us.month, today: us.today, total: us.total };
  return exec;
};
app.get('/api/executive', (req, res) => res.json(execFor(req.office)));
// Escritórios: nomes, IA própria de cada um e comparativo de resultados.
app.get('/api/offices', (req, res) => res.json({ offices: officeList(store.settings), mine: { office: req.user.role === 'admin' ? null : officeOfUser(req.user), global: req.user.role === 'admin', officeAdmin: Boolean(req.user.officeAdmin) }, current: req.office }));
const cleanText = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
app.get('/api/offices/:id', (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Só o administrador geral');
  if (!OFFICE_IDS.includes(req.params.id)) throw httpError(404, 'Escritório não encontrado');
  res.json({ ...officeList(store.settings).find((o) => o.id === req.params.id), overrides: store.settings.offices?.[req.params.id]?.overrides || {} });
});
app.put('/api/offices/:id', (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Só o administrador geral');
  const id = req.params.id;
  if (!OFFICE_IDS.includes(id)) throw httpError(404, 'Escritório não encontrado');
  const b = req.body || {};
  const cur = store.settings.offices?.[id] || {};
  const ov = b.overrides || {};
  const next = {
    name: cleanText(b.name ?? cur.name ?? officeList(store.settings).find((o) => o.id === id).name, 60),
    place: cleanText(b.place ?? cur.place ?? '', 40),
    overrides: {
      business: Object.fromEntries(['name', 'description', 'services', 'prices', 'hours', 'address'].filter((k) => ov.business?.[k] !== undefined || cur.overrides?.business?.[k] !== undefined).map((k) => [k, cleanText(ov.business?.[k] ?? cur.overrides?.business?.[k], 4000)]).filter(([, v]) => v)),
      agent: Object.fromEntries(['agentName', 'instructions'].filter((k) => ov.agent?.[k] !== undefined || cur.overrides?.agent?.[k] !== undefined).map((k) => [k, cleanText(ov.agent?.[k] ?? cur.overrides?.agent?.[k], 6000)]).filter(([, v]) => v)),
    },
  };
  store.data.settings.offices = { ...(store.settings.offices || {}), [id]: next };
  store.save();
  audit.record({ user: req.user, ip: clientIp(req), action: 'alterou', entity: 'escritório', label: `${next.name}: nome e IA própria`, changes: [{ field: 'office', label: 'Configuração do escritório', from: '', to: JSON.stringify(next).slice(0, 160), sensitive: false }] });
  res.json({ ok: true });
});
app.get('/api/offices-compare', (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Só o administrador geral');
  res.json(officeList(store.settings).map((o) => {
    const e = execFor(o.id);
    const team = auth.users.filter((u) => u.role !== 'admin' && u.active !== false && officeOfUser(u) === o.id);
    return {
      id: o.id, name: o.name, place: o.place,
      equipe: team.length, numeros: lines.list().filter((l) => (normOffice(l.office) || officeOfUser(auth.get(l.ownerId))) === o.id).length,
      conversas: agent.listConversations().filter((c) => conversationOffice(c) === o.id).length,
      leadsMes: e.crm.newLeads, abertos: e.crm.openLeads, fechadosMes: e.crm.won, valorFechadoMes: e.crm.wonValue, conversao: e.crm.conversion,
      vendasMes: e.kpis.vendasMes, vendidoMes: e.kpis.vendidoMes, recebidoMes: e.kpis.recebidoMes, aReceber: e.kpis.aReceberTotal, atrasado: e.kpis.atrasadoTotal,
    };
  }));
});
// Preço do serviço (só administrador geral): consumo real da IA, custo por resposta e planos sugeridos.
const pricingCfg = () => cleanPricing(store.settings.pricing || {}, DEFAULT_PRICING);
app.get('/api/pricing', (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Só o administrador geral');
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? req.query.month : dayStr(Date.now()).slice(0, 7);
  const office = OFFICE_IDS.includes(req.query.office) ? req.query.office : '';
  const measured = usage.month(month, office);
  res.json({ month, office, config: pricingCfg(), measured, model: priceModel(measured, pricingCfg()), aiModel: store.settings.agent?.geminiModel || '', provider: store.settings.agent?.provider || '' });
});
// Quantas respostas a atendente já enviou (total, hoje, mês) e quanto custa cada uma, com o gasto real informado.
app.get('/api/usage/summary', (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Só o administrador geral');
  const office = OFFICE_IDS.includes(req.query.office) ? req.query.office : req.office !== 'all' ? req.office : '';
  const sum = usage.summary(office);
  const cfg = pricingCfg();
  const per = sum.total && cfg.spentBrl ? cfg.spentBrl / sum.total : 0;
  res.json({ ...sum, office, spentBrl: cfg.spentBrl, spentAsOf: cfg.spentAsOf, costPerReply: Number(per.toFixed(4)), costPer1000: Math.round(per * 1000 * 100) / 100 });
});
// Calibra o preço com o gasto real já feito (R$) e as mensagens que a atendente já enviou.
app.get('/api/pricing/history', (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Só o administrador geral');
  const cfg = pricingCfg();
  const office = OFFICE_IDS.includes(req.query.office) ? req.query.office : '';
  const isDay = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
  res.json(historyReport(Object.values(store.data.conversations || {}), {
    totalCostBrl: Number(String(req.query.cost || '0').replace(',', '.')), from: isDay(req.query.from), to: isDay(req.query.to),
    include: (c) => !office || conversationOffice(c) === office,
    markupPct: req.query.markup !== undefined ? Number(req.query.markup) : cfg.markupPct,
    extraMonthlyBrl: cfg.fixedBrl / Math.max(1, cfg.clients) + cfg.supportHours * cfg.hourBrl,
  }));
});
app.put('/api/pricing', (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Só o administrador geral');
  const before = pricingCfg();
  const next = cleanPricing(req.body || {}, before);
  store.data.settings.pricing = next;
  store.save();
  audit.record({ user: req.user, ip: clientIp(req), action: 'alterou', entity: 'preço do serviço', label: 'Valores usados no cálculo do preço', changes: Object.keys(next).filter((k) => next[k] !== before[k]).map((k) => ({ field: k, label: k, from: String(before[k]), to: String(next[k]), sensitive: true })) });
  res.json(next);
});

// Módulos: o administrador coloca telas em "standby" (somem do menu, nada é apagado) e liga de volta quando quiser.
const PROTECTED_TABS = new Set(['executive', 'modules', 'team', 'connection', 'settings', 'audit']);
app.get('/api/modules', (_req, res) => res.json({ standby: store.settings.modules?.standby || [], protected: [...PROTECTED_TABS] }));
app.put('/api/modules', (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Só o administrador');
  const list = [...new Set((Array.isArray(req.body?.standby) ? req.body.standby : []).map(String))].filter((t) => /^[a-z]{2,30}$/.test(t) && !PROTECTED_TABS.has(t));
  const before = store.settings.modules?.standby || [];
  store.data.settings.modules = { standby: list };
  store.save();
  const added = list.filter((t) => !before.includes(t)); const removed = before.filter((t) => !list.includes(t));
  audit.record({ user: req.user, ip: clientIp(req), action: 'alterou', entity: 'módulos', label: `Standby: ${added.length ? `desativou ${added.join(', ')}` : ''}${added.length && removed.length ? ' · ' : ''}${removed.length ? `reativou ${removed.join(', ')}` : ''}` || 'sem mudanças', changes: [{ field: 'modules', label: 'Telas em standby', from: before.join(', '), to: list.join(', '), sensitive: false }] });
  res.json({ standby: list });
});

// Retomada de contatos (Instagram/Facebook/site/quiz que ainda não foram atendidos). Só administrador.
const reengage = new Reengage({ store, crm, agent, send: (to, payload) => wa.send(to, { ...payload, typing: false }) });
const reengageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 80_000_000 } }).single('file');
const reengageRows = (req) => {
  if (!req.file) throw httpError(400, 'Escolha o arquivo (planilha CSV ou o captura.json)');
  const text = req.file.buffer.toString('utf8');
  let input = text;
  if (/\.json$/i.test(req.file.originalname || '') || /^\s*[[{]/.test(text)) { try { input = JSON.parse(text); } catch { throw httpError(400, 'Arquivo JSON inválido'); } }
  const source = String(req.body?.source || '');
  return rowsFrom(input, { source: ['instagram', 'facebook', 'site', 'quiz', 'grupo', 'outro'].includes(source) ? source : '' });
};
app.post('/api/reengage/import', reengageUpload, (req, res) => {
  const rows = reengageRows(req);
  if (!rows.length) throw httpError(400, 'Não encontrei nenhum contato com telefone ou e-mail neste arquivo.');
  const stats = reengage.import(rows);
  audit.record({ user: req.user, ip: clientIp(req), action: 'criou', entity: 'retomada de contatos', label: `Importou ${stats.lidas} linhas: ${stats.novos} novos, ${stats.jaAtendidos} já atendidos` });
  res.json(stats);
});
app.get('/api/reengage', (req, res) => res.json({ summary: reengage.summary(), items: reengage.list(req.query).slice(0, 500), templates: { ...REENGAGE_TEMPLATES, ...(store.settings.reengage?.templates || {}) } }));
app.post('/api/reengage/send', (req, res) => {
  if (wa.status !== 'connected') throw httpError(400, 'Conecte o WhatsApp primeiro (aba Conexões)');
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
  if (!ids.length) throw httpError(400, 'Marque quem vai receber a mensagem.');
  if (reengage.store.data.reengage.run?.running) throw httpError(409, 'Já existe um envio em andamento');
  if (!reengage.inHours()) throw httpError(400, `Só envio entre ${reengage.config.from}h e ${reengage.config.to}h, para parecer atendimento normal.`);
  securityEvent('retomada_envio', req.user, req, `${ids.length} contato(s) aprovado(s)`);
  reengage.sendApproved(ids, { by: req.user.name }).catch((e) => store.addLog({ type: 'error', message: `Retomada de contatos: ${e.message}` }));
  res.json({ ok: true });
});
app.put('/api/reengage/limit', (req, res) => {
  const before = reengage.config.perDay;
  const perDay = reengage.setLimit(req.body?.perDay);
  audit.record({ user: req.user, ip: clientIp(req), action: 'alterou', entity: 'retomada de contatos', label: 'Limite de mensagens por dia', changes: [{ field: 'perDay', label: 'Mensagens por dia', from: String(before), to: String(perDay), sensitive: true }] });
  res.json({ perDay });
});
app.post('/api/reengage/stop', (_req, res) => res.json(reengage.stop() || { running: false }));
app.patch('/api/reengage/:id', (req, res) => res.json(reengage.mark(req.params.id, req.body?.status)));
app.put('/api/reengage/templates', (req, res) => {
  const t = {};
  for (const k of Object.keys(REENGAGE_TEMPLATES)) if (typeof req.body?.[k] === 'string' && req.body[k].trim()) t[k] = req.body[k].slice(0, 800);
  store.updateSettings({ reengage: { templates: t } });
  audit.record({ user: req.user, ip: clientIp(req), action: 'alterou', entity: 'retomada de contatos', label: 'Mudou os textos da primeira mensagem' });
  res.json({ ok: true });
});

// Conteúdo da página inicial do site (editável pelo administrador).
app.get('/api/site', (_req, res) => res.json(siteContent()));
app.put('/api/site', (req, res) => {
  const patch = sanitizeContent(req.body || {});
  const before = siteContent();
  store.data.settings.site = { ...(store.settings.site || {}), ...patch };
  store.save();
  const after = siteContent();
  audit.record({ user: req.user, ip: clientIp(req), action: 'alterou', entity: 'site', label: `Página inicial: ${Object.keys(patch).join(', ') || 'sem mudanças'}`, changes: Object.keys(patch).map((k) => ({ field: k, label: k, from: JSON.stringify(before[k]).slice(0, 120), to: JSON.stringify(after[k]).slice(0, 120), sensitive: false })) });
  res.json(after);
});

// Currículos (só administrador).
// ---- Documentos emitidos (admissão temporária, cédula, RUC, licença…) ----
const docErr = (fn) => { try { return fn(); } catch (e) { throw httpError(/não encontrado/.test(e.message) ? 404 : 400, e.message); } };
const docPhone = (d) => {
  const raw = d.phone || legacy.clients.find((c) => String(c.name || '').trim().toLowerCase() === String(d.clientName || '').trim().toLowerCase())?.phone || '';
  return normalizePhone(raw) || normalizePhone(`+${String(raw).replace(/\D/g, '')}`) || '';
};
app.get('/api/documents', (req, res) => res.json({ types: DOC_TYPES, counts: documents.counts(), rules: documents.rules, toNotify: documents.toNotify().length, items: documents.list({ type: String(req.query.type || ''), status: String(req.query.status || ''), q: String(req.query.q || ''), responsible: String(req.query.responsible || ''), trash: req.query.trash === '1' }).slice(0, 500) }));
app.post('/api/documents', (req, res) => {
  const d = docErr(() => documents.add(req.body || {}, req.user.name));
  audit.record({ user: req.user, ip: clientIp(req), action: 'criou', entity: 'documento', label: `${d.clientName} · ${DOC_TYPES[d.type]}` });
  res.json(d);
});
app.put('/api/documents/rules', (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Só o administrador muda as regras de aviso');
  const r = docErr(() => documents.setRules(req.body || {}));
  audit.record({ user: req.user, ip: clientIp(req), action: 'alterou', entity: 'documentos', label: 'Regras de aviso de renovação', changes: [{ field: 'rules', label: 'Meses de aviso e renovação', from: '', to: JSON.stringify(r).slice(0, 200), sensitive: false }] });
  res.json(r);
});
app.patch('/api/documents/:id', (req, res) => {
  const d = docErr(() => documents.update(req.params.id, req.body || {}));
  audit.record({ user: req.user, ip: clientIp(req), action: 'alterou', entity: 'documento', label: `${d.clientName} · ${DOC_TYPES[d.type]}` });
  res.json(d);
});
app.delete('/api/documents/:id', (req, res) => {
  const d = docErr(() => documents.remove(req.params.id));
  audit.record({ user: req.user, ip: clientIp(req), action: 'excluiu', entity: 'documento', label: `${d.clientName} · ${DOC_TYPES[d.type]} (vai para a lixeira)` });
  res.json({ ok: true });
});
app.post('/api/documents/:id/restore', (req, res) => { docErr(() => documents.restore(req.params.id)); res.json({ ok: true }); });
app.get('/api/documents/:id/notice', (req, res) => {
  const d = documents.all.find((x) => x.id === req.params.id && !x.deletedAt);
  if (!d) throw httpError(404, 'Documento não encontrado');
  res.json({ text: documents.noticeText(d), phone: docPhone(d) });
});
app.post('/api/documents/:id/notify', async (req, res) => {
  const d = documents.all.find((x) => x.id === req.params.id && !x.deletedAt);
  if (!d) throw httpError(404, 'Documento não encontrado');
  const phone = docPhone(d);
  if (!phone) throw httpError(400, 'Não achei o telefone deste cliente. Preencha o telefone no documento.');
  if (wa.status !== 'connected') throw httpError(400, 'O WhatsApp não está conectado agora.');
  await wa.send(phone, { text: documents.noticeText(d), typing: false });
  documents.markNoticed(d.id);
  audit.record({ user: req.user, ip: clientIp(req), action: 'enviou', entity: 'aviso de documento', label: `${d.clientName} · ${DOC_TYPES[d.type]}` });
  res.json({ ok: true });
});
// ---- Tutoriais e treinamento semanal ----
const tutErr = (fn) => { try { return fn(); } catch (e) { throw httpError(/não encontrado/.test(e.message) ? 404 : 400, e.message); } };
const needAdmin = (req) => { if (req.user.role !== 'admin') throw httpError(403, 'Esta área é só do administrador'); };
app.get('/api/tutorials', (req, res) => res.json(tutorials.list(req.user)));
app.get('/api/tutorials/:id', (req, res) => { const t = tutorials.get(req.user, req.params.id); if (!t) throw httpError(404, 'Tutorial não encontrado'); res.json(t); });
app.post('/api/tutorials', (req, res) => { needAdmin(req); const t = tutErr(() => tutorials.add(req.body || {}, req.user.name)); audit.record({ user: req.user, ip: clientIp(req), action: 'criou', entity: 'tutorial', label: t.title }); res.json(t); });
app.patch('/api/tutorials/:id', (req, res) => { needAdmin(req); const t = tutErr(() => tutorials.update(req.params.id, req.body || {})); audit.record({ user: req.user, ip: clientIp(req), action: 'alterou', entity: 'tutorial', label: t.title }); res.json(t); });
app.delete('/api/tutorials/:id', (req, res) => { needAdmin(req); const t = tutErr(() => tutorials.remove(req.params.id)); audit.record({ user: req.user, ip: clientIp(req), action: 'excluiu', entity: 'tutorial', label: t.title }); res.json({ ok: true }); });
const weeklyStats = () => {
  const since = Date.now() - 7 * 86_400_000;
  const recent = (iso) => iso && Date.parse(iso) >= since;
  return { vendasNovas: sales.list.filter((x) => !x.legacy && recent(x.createdAt)).length, orcamentosEnviados: quotes.list.filter((q) => recent(q.createdAt)).length, contatosNovos: crm.leads.filter((l) => recent(l.createdAt)).length, vendedoresAtivos: auth.users.filter((u) => u.role === 'seller' && u.active !== false).length };
};
async function runWeeklyTraining({ force = false } = {}) {
  const t = await tutorials.generateWeekly({ llm, business: store.settings.business?.description || store.settings.business?.name || '', stats: weeklyStats(), learnings: learnings.approvedText(), force });
  if (!t) return null;
  let i = 0;
  for (const u of auth.users.filter((x) => x.role === 'seller' && x.active !== false && x.whatsapp)) {
    if (wa.status === 'connected') await wa.send(u.whatsapp, { text: tutorials.noticeText(t, i++), typing: false }).catch(() => {});
  }
  store.addLog({ type: 'system', message: `Treinamento da semana criado: ${t.title}` });
  return t;
}
app.post('/api/tutorials/weekly/run', async (req, res) => {
  needAdmin(req);
  const t = await runWeeklyTraining({ force: true }).catch((e) => { throw httpError(400, e.message); });
  if (!t) throw httpError(400, 'A IA não está configurada (aba Agente IA).');
  audit.record({ user: req.user, ip: clientIp(req), action: 'criou', entity: 'treinamento semanal', label: t.title });
  res.json(t);
});

// ---- Guia de Cidades ----
app.get('/api/cities', (req, res) => res.json({ categories: CITY_CATEGORIES, cities: cityGuide.list(String(req.query.q || '')) }));
app.get('/api/cities/:id', (req, res) => { const c = cityGuide.get(req.params.id); if (!c) throw httpError(404, 'Cidade não encontrada'); res.json({ ...c, message: cityGuide.message(c.id) }); });
const cityAdmin = (fn) => (req, res) => { needAdmin(req); res.json(tutErr(() => fn(req))); };
app.post('/api/cities', cityAdmin((req) => { const c = cityGuide.addCity(req.body || {}); audit.record({ user: req.user, ip: clientIp(req), action: 'criou', entity: 'cidade do guia', label: c.name }); return c; }));
app.post('/api/cities/:id/items', cityAdmin((req) => cityGuide.addItem(req.params.id, req.body || {})));
app.patch('/api/cities/:id/items/:itemId', cityAdmin((req) => cityGuide.updateItem(req.params.id, req.params.itemId, req.body || {})));
app.delete('/api/cities/:id/items/:itemId', cityAdmin((req) => { cityGuide.removeItem(req.params.id, req.params.itemId); return { ok: true }; }));
app.post('/api/cities/:id/import', cityAdmin((req) => { const r = cityGuide.importText(req.params.id, req.body?.text); audit.record({ user: req.user, ip: clientIp(req), action: 'criou', entity: 'guia de cidades', label: `${r.added} local(is) importado(s) em ${cityGuide.get(req.params.id)?.name}` }); return r; }));
// O vendedor (ou o administrador) manda o guia da cidade ao cliente: só depois de ver o texto e só para quem ele escolhe.
app.post('/api/cities/:id/send', async (req, res) => {
  const c = cityGuide.get(req.params.id); if (!c) throw httpError(404, 'Cidade não encontrada');
  const phone = normalizePhone(req.body?.phone) || normalizePhone(`+${String(req.body?.phone || '').replace(/\D/g, '')}`);
  if (!phone) throw httpError(400, 'Informe o WhatsApp do cliente com DDD e código do país');
  if (wa.status !== 'connected') throw httpError(400, 'O WhatsApp não está conectado agora.');
  await wa.send(phone, { text: cityGuide.message(c.id, req.body?.name), typing: false });
  cityGuide.recordSent({ cityId: c.id, phone, by: req.user.name });
  audit.record({ user: req.user, ip: clientIp(req), action: 'enviou', entity: 'guia de cidade', label: `${c.name} para +${phone}` });
  res.json({ ok: true });
});

// ---- Marketing (números dos anúncios da Meta) ----
app.get('/api/marketing', (req, res) => {
  needAdmin(req);
  const view = marketing.withCrm(marketing.snapshot, crm.leads);
  res.json({ configured: marketing.configured, adAccountId: marketing.config.adAccountId || '', hasToken: Boolean(marketing.config.metaToken), presets: MKT_PRESETS, snapshot: view, summary: marketing.plainSummary(view) });
});
app.put('/api/marketing/config', (req, res) => {
  needAdmin(req);
  tutErr(() => marketing.setConfig(req.body || {}));
  audit.record({ user: req.user, ip: clientIp(req), action: 'alterou', entity: 'marketing', label: 'Conta de anúncios da Meta e chave de acesso (valor oculto)' });
  res.json({ ok: true, configured: marketing.configured });
});
app.post('/api/marketing/sync', async (req, res) => {
  needAdmin(req);
  try { await marketing.sync({ preset: String(req.body?.preset || 'last_30d') }); } catch (e) { throw httpError(e.status === 401 ? 400 : e.status || 502, e.auth ? 'A Meta recusou a chave de acesso (vencida ou sem permissão). Gere outra e cole em Configurar.' : e.message); }
  const view = marketing.withCrm(marketing.snapshot, crm.leads);
  res.json({ snapshot: view, summary: marketing.plainSummary(view) });
});

// ---- Cobrança de vencidos e previsão de recebimento ----
const normName = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const collections = new Collections({
  store, sales,
  resolvePhone: (s) => {
    const raw = s.client?.phone || legacy.clients.find((c) => (s.client?.doc && c.doc && c.doc === s.client.doc) || normName(c.name) === normName(s.client?.nome))?.phone || '';
    return normalizePhone(raw) || normalizePhone(`+${String(raw).replace(/\D/g, '')}`) || '';
  },
  send: (phone, text) => wa.send(phone, { text, typing: false }),
  canSend: () => wa.status === 'connected',
});
const collScope = (req) => (s) => inOffice(req, sales.officeOf(s));
app.get('/api/collections', (req, res) => {
  needAdmin(req);
  const rows = collections.overdue({ minDays: Number(req.query.minDays) || 1, q: String(req.query.q || ''), inOffice: collScope(req) });
  res.json({ summary: collections.summary(rows), rows: rows.slice(0, 400), shown: Math.min(rows.length, 400), status: collections.status(), forecast: collections.forecast({ inOffice: collScope(req) }) });
});
app.post('/api/collections/enqueue', (req, res) => {
  needAdmin(req);
  const out = collections.enqueue(Array.isArray(req.body?.keys) ? req.body.keys.map(String) : [], req.user.name);
  audit.record({ user: req.user, ip: clientIp(req), action: 'aprovou', entity: 'cobrança de vencidos', label: `${out.queued} parcela(s) aprovada(s) para aviso (${out.skipped.length} ficaram de fora)` });
  res.json(out);
});
app.delete('/api/collections/queue', (req, res) => { needAdmin(req); const n = collections.cancelQueue(); audit.record({ user: req.user, ip: clientIp(req), action: 'cancelou', entity: 'cobrança de vencidos', label: `fila cancelada (${n})` }); res.json({ cancelled: n }); });
app.put('/api/collections/config', (req, res) => {
  needAdmin(req);
  const c = tutErr(() => collections.setConfig(req.body || {}));
  audit.record({ user: req.user, ip: clientIp(req), action: 'alterou', entity: 'cobrança de vencidos', label: 'Limites de envio', changes: [{ field: 'config', label: 'Limites', from: '', to: JSON.stringify(c), sensitive: false }] });
  res.json(c);
});
// ---- Ficha 360 do cliente ----
const customer360 = new Customer360({
  sales: () => sales.list, quotes: () => quotes.list, leads: () => crm.leads, conversations: () => Object.values(store.data.conversations || {}),
  documents: () => documents.all.filter((d) => !d.deletedAt), legacyClients: () => legacy.clients, legacyContracts: () => legacy.list, collectionsLog: () => collections.data.log,
});
app.get('/api/customers/search', (req, res) => { needAdmin(req); res.json(customer360.search(String(req.query.q || ''))); });
app.get('/api/customers/duplicates', (req, res) => { needAdmin(req); res.json(customer360.duplicates({ source: req.query.source === 'leads' ? 'leads' : 'clients' }).slice(0, 200)); });
app.post('/api/customers/duplicates/merge', (req, res) => {
  needAdmin(req);
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).slice(0, 10) : [];
  const r = tutErr(() => legacy.mergeClients(ids));
  audit.record({ user: req.user, ip: clientIp(req), action: 'alterou', entity: 'clientes duplicados', label: `Juntou ${ids.length} cadastros em um` });
  res.json(r);
});
app.get('/api/customers/360', (req, res) => {
  needAdmin(req);
  const { phone = '', doc = '', name = '' } = req.query;
  if (!phone && !doc && !name) throw httpError(400, 'Informe telefone, documento ou nome');
  res.json(customer360.build({ phone: String(phone), doc: String(doc), name: String(name) }));
});
// ---- Catálogo de serviços ----
app.get('/api/services', (req, res) => res.json({ categories: SERVICE_CATEGORIES, items: serviceCatalog.list({ q: String(req.query.q || ''), category: String(req.query.category || ''), active: req.user.role === 'admin' ? String(req.query.active ?? '') : 'true' }) }));
app.post('/api/services', (req, res) => { needAdmin(req); res.json(serviceCatalog.add(req.user, req.body || {})); });
app.patch('/api/services/:id', (req, res) => { needAdmin(req); res.json(serviceCatalog.update(req.user, req.params.id, req.body || {})); });
// ---- Níveis de comissão e saques ----
app.get('/api/commissions/me', (req, res) => res.json(commissions.mine(req.user)));
app.get('/api/commissions/overview', (req, res) => res.json(commissions.overview(req.user)));
app.put('/api/commissions/levels', (req, res) => {
  const r = commissions.setLevels(req.user, req.body || {});
  audit.record({ user: req.user, ip: clientIp(req), action: 'alterou', entity: 'níveis de comissão', label: `${r.enabled ? 'ligados' : 'desligados'}: ${r.plans.map((p) => `${p.label} ${p.pct}% (meta ${p.goal})`).join(', ')}` });
  res.json(r);
});
app.post('/api/commissions/recalc', (req, res) => {
  const r = commissions.recalcMonth(req.user, /^\d{4}-\d{2}$/.test(String(req.body?.month || '')) ? req.body.month : undefined);
  audit.record({ user: req.user, ip: clientIp(req), action: 'alterou', entity: 'comissões', label: `Comissões do mês ${r.month} recalculadas pelo nível (${r.changed} venda(s))` });
  res.json(r);
});
app.post('/api/withdrawals', async (req, res) => res.json(await commissions.request(req.user, req.body || {})));
app.post('/api/withdrawals/:id/:action', async (req, res) => {
  const w = await commissions.decide(req.user, req.params.id, req.params.action, req.body || {});
  audit.record({ user: req.user, ip: clientIp(req), action: 'alterou', entity: 'saque de comissão', label: `${w.sellerName} · R$ ${w.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} → ${w.status}` });
  res.json(w);
});
// ---- Modelos de contrato (texto do sistema antigo, preenchido com os dados do cliente) e contatos da equipe ----
app.get('/api/contract-templates', (req, res) => { needAdmin(req); res.json({ items: contractTemplates.list(), map: store.data.contractTemplateMap || {} }); });
app.get('/api/contract-templates/:key', (req, res) => { needAdmin(req); res.json(contractTemplates.get(req.params.key)); });
app.post('/api/contract-templates/:key/render', (req, res) => {
  needAdmin(req);
  const values = Object.fromEntries(Object.entries(req.body?.values || {}).map(([k, v]) => [String(k).slice(0, 40), String(v ?? '').slice(0, 4000)]));
  const r = contractTemplates.render(req.params.key, values);
  audit.record({ user: req.user, ip: clientIp(req), action: 'criou', entity: 'contrato por modelo', label: `${r.name} · ${values.nome_completo || 'sem nome'}` });
  res.json(r);
});
app.get('/api/team-contacts', (_req, res) => res.json({ items: (store.data.teamContacts || []).filter((c) => c.active !== false) }));
// ---- Projetos e Sócios ----
app.get('/api/projects', (req, res) => res.json(partnerProjects.list(req.user)));
app.put('/api/projects/config', (req, res) => {
  const c = partnerProjects.setConfig(req.user, req.body || {});
  audit.record({ user: req.user, ip: clientIp(req), action: 'alterou', entity: 'regras de Projetos e Sócios', label: `${c.enabled ? 'aberto' : 'fechado'} · meta R$ ${c.minSales} · ${c.minMonths} meses · piloto ${c.pilotSharePct}% · teto ${c.maxSharePct}% · ${c.vestingYears} anos` });
  res.json(c);
});
app.post('/api/projects/invite/:userId', (req, res) => {
  const r = partnerProjects.setInvite(req.user, req.params.userId, req.body?.invited !== false);
  audit.record({ user: req.user, ip: clientIp(req), action: 'alterou', entity: 'Projetos e Sócios', label: `${r.name}: convite ${r.invited ? 'dado' : 'retirado'}` });
  res.json(r);
});
app.post('/api/projects', async (req, res) => res.json(await partnerProjects.submit(req.user, req.body || {})));
app.get('/api/projects/:id', (req, res) => res.json(partnerProjects.get(req.user, req.params.id)));
app.patch('/api/projects/:id', (req, res) => res.json(partnerProjects.edit(req.user, req.params.id, req.body || {})));
const projAudit = (req, p, text) => audit.record({ user: req.user, ip: clientIp(req), action: 'alterou', entity: 'projeto de sócio', label: `${p.title} (${p.ownerName}): ${text}` });
app.post('/api/projects/:id/decide', async (req, res) => { const p = await partnerProjects.decide(req.user, req.params.id, String(req.body?.action || ''), req.body || {}); projAudit(req, p, p.history.at(-1).text); res.json(p); });
app.post('/api/projects/:id/goals', (req, res) => res.json(partnerProjects.setGoals(req.user, req.params.id, req.body?.goals || [])));
app.post('/api/projects/:id/results', (req, res) => { const p = partnerProjects.addResult(req.user, req.params.id, req.body || {}); projAudit(req, p, p.history.at(-1).text); res.json(p); });
app.post('/api/projects/:id/payments', async (req, res) => { const p = await partnerProjects.addPayment(req.user, req.params.id, req.body || {}); projAudit(req, p, p.history.at(-1).text); res.json(p); });
// ---- Suporte interno ----
app.get('/api/support', (req, res) => res.json({ sla: SUPPORT_SLA, ...support.list(req.user, { status: String(req.query.status || 'abertos'), q: String(req.query.q || '') }) }));
app.post('/api/support', async (req, res) => res.json(await support.open(req.user, req.body || {})));
app.get('/api/support/:id', (req, res) => res.json(support.get(req.user, req.params.id)));
app.post('/api/support/:id/messages', async (req, res) => res.json(await support.reply(req.user, req.params.id, req.body || {})));
app.post('/api/support/:id/resolve', async (req, res) => {
  const t = await support.resolve(req.user, req.params.id, req.body || {});
  audit.record({ user: req.user, ip: clientIp(req), action: 'alterou', entity: 'chamado de suporte', label: `${t.number} resolvido` });
  res.json(t);
});
// ---- Tarefas da equipe ----
const tasks = new Tasks({ store, auth });
const tk = (fn) => { try { return fn(); } catch (e) { throw httpError(/não encontrada/.test(e.message) ? 404 : 400, e.message); } };
app.get('/api/tasks', (req, res) => res.json({ counts: tasks.counts(req.user), items: tasks.list(req.user, { status: String(req.query.status || 'open'), q: String(req.query.q || ''), who: req.user.role === 'admin' ? String(req.query.who || '') : '' }).slice(0, 300), people: req.user.role === 'admin' ? auth.users.filter((u) => u.active !== false && !u.pending).map((u) => ({ id: u.id, name: u.name })) : [] }));
app.post('/api/tasks', (req, res) => { const t = tk(() => tasks.add(req.user, req.body || {})); if (t.assigneeId !== req.user.id) audit.record({ user: req.user, ip: clientIp(req), action: 'criou', entity: 'tarefa', label: `${t.title} → ${auth.get(t.assigneeId)?.name}` }); res.json(t); });
app.patch('/api/tasks/:id', (req, res) => res.json(tk(() => tasks.update(req.user, req.params.id, req.body || {}))));
app.delete('/api/tasks/:id', (req, res) => { tk(() => tasks.remove(req.user, req.params.id)); res.json({ ok: true }); });
// ---- Quadros dos contratos, avisos (sininho) e consulta da IA ----
const contractCards = new ContractCards({ sales: () => sales.list, legacy: () => legacy.list, quotes: () => quotes.list, documents: () => documents.all, legacyClients: () => legacy.clients });
const alerts = new Alerts({ cards: contractCards, collections, documents, quotes: () => quotes.list, tasks });
agent.contractContext = (conv) => {
  const lead = crm.findForConversation({ key: conv.key, phone: conv.phone });
  const text = contractCards.summarizeFor(conv.phone || lead?.phone);
  return text ? `Este cliente JÁ TEM contrato com a Migra (inclusive os do sistema antigo). Dados reais do sistema:\n${text}\nContinue o atendimento a partir disso: não trate como cliente novo, não peça de novo o que já está registrado e não ofereça pacote que ele já contratou. Fale de valores e parcelas só deste cliente (é ele quem está conversando).` : '';
};
agent.myContracts = (conv, _args, { dryRun } = {}) => {
  if (dryRun || String(conv.key).startsWith('sim:')) return { ok: true, simulacao: true, instrucao: 'Simulação: no atendimento real a ferramenta devolve os contratos deste número.' };
  const lead = crm.findForConversation({ key: conv.key, phone: conv.phone });
  const list = contractCards.forPhone(conv.phone || lead?.phone);
  if (!list.length) return { ok: true, encontrado: false, instrucao: 'Não achei contrato ligado a ESTE número. Não procure por nome nem CPF que o cliente digitar (pode ser de outra pessoa). Diga com educação que vai pedir para a equipe conferir e use transferir_para_humano.' };
  const brl = (v) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  return { ok: true, encontrado: true, contratos: list.slice(0, 5).map((c) => ({ numero: c.number, servico: c.service, total: brl(c.total), pago: brl(c.paid), em_aberto: brl(c.open), parcelas_pagas: `${c.parcelsPaid} de ${c.parcels}`, em_atraso: c.overdueParcels ? `${c.overdueParcels} parcela(s), ${brl(c.overdueValue)}` : 'nenhuma', proxima: c.next ? `${c.next.value ? `${brl(c.next.value)} em ` : ''}${c.next.due.split('-').reverse().join('/')}` : 'sem parcela futura', documento_a_renovar: c.renewal ? c.renewal.at.split('-').reverse().join('/') : 'não' })), instrucao: 'Responda só o que ele perguntou, com clareza e gentileza, em mensagens curtas. Se houver atraso, ofereça enviar o Pix ou o link do cartão (use gerar_pix ou gerar_link_cartao se ele concordar). Você não altera contrato nem dá baixa: para isso use cliente_informou_pagamento ou transferir_para_humano.' };
};
const cardsScope = (req) => (c) => (req.user.role === 'admin' ? inOffice(req, c.saleId ? sales.officeOf(sales.get(c.saleId)) : 'py') : c.kind === 'venda' && sales.canSee(req.user, sales.get(c.saleId)));
app.get('/api/contract-cards', (req, res) => {
  const out = contractCards.search({ q: String(req.query.q || ''), filter: String(req.query.filter || ''), sort: String(req.query.sort || 'recente'), page: Number(req.query.page) || 1, per: Math.min(60, Number(req.query.per) || 24), canSee: cardsScope(req) });
  res.json(out);
});
app.get('/api/alerts', (req, res) => {
  const items = alerts.build({ user: req.user, inOffice: collScope(req) });
  res.json({ count: items.reduce((n, i) => n + (i.level === 'urgente' ? 1 : 0), 0) + items.filter((i) => i.level !== 'urgente').length, urgent: items.filter((i) => i.level === 'urgente').length, items });
});
// ---- Reuniões gravadas (biblioteca de links) ----
app.get('/api/recordings', (req, res) => res.json(recordings.list({ q: String(req.query.q || '') })));
const recAdmin = (req) => { if (req.user.role !== 'admin') throw httpError(403, 'Só o administrador cadastra gravações'); };
const recTry = (fn) => { try { return fn(); } catch (e) { throw httpError(/não encontrada/.test(e.message) ? 404 : 400, e.message); } };
app.post('/api/recordings', (req, res) => {
  recAdmin(req);
  const r = recTry(() => recordings.add(req.body || {}, req.user.name));
  audit.record({ user: req.user, ip: clientIp(req), action: 'criou', entity: 'gravação', label: r.title });
  res.json(r);
});
app.patch('/api/recordings/:id', (req, res) => {
  recAdmin(req);
  const r = recTry(() => recordings.update(req.params.id, req.body || {}));
  audit.record({ user: req.user, ip: clientIp(req), action: 'alterou', entity: 'gravação', label: r.title });
  res.json(r);
});
app.delete('/api/recordings/:id', (req, res) => {
  recAdmin(req);
  const r = recTry(() => recordings.remove(req.params.id));
  audit.record({ user: req.user, ip: clientIp(req), action: 'excluiu', entity: 'gravação', label: r.title });
  res.json({ ok: true });
});
// ---- Link de atendimento: cada clique vai para um vendedor diferente (rodízio) direto no WhatsApp dele ----
const linkHits = new Map();
app.get('/atendimento', (req, res) => {
  const ip = clientIp(req);
  const recent = (linkHits.get(ip) || []).filter((t) => Date.now() - t < 600_000);
  if (recent.length >= 12) return res.status(429).type('text/plain; charset=utf-8').send('Muitos cliques seguidos. Tente de novo em alguns minutos.');
  linkHits.set(ip, [...recent, Date.now()]);
  if (linkHits.size > 5000) linkHits.clear();
  const origin = String(req.query.o || 'link').replace(/[^a-z0-9-]/gi, '').slice(0, 20) || 'link';
  const office = SITE_OFFICES.get(hostOf(req)) || null;
  const seller = crm.takeNextSeller(office);
  if (!seller) return res.status(503).type('text/plain; charset=utf-8').send('No momento não há atendente disponível. Tente de novo em instantes.');
  const clicks = (store.data.linkClicks ||= []);
  clicks.push({ at: new Date().toISOString(), sellerId: seller.id, origin });
  if (clicks.length > 20000) clicks.splice(0, clicks.length - 20000);
  store.save();
  const from = origin === 'live' ? 'pela live da Migra' : 'pelo site da Migra';
  const text = `Olá, ${seller.name.split(' ')[0]}! Vim ${from} e quero iniciar o meu atendimento para fechar. Código: ${origin.toUpperCase()}-${String(clicks.length).slice(-5)}.`;
  res.set('Cache-Control', 'no-store').redirect(302, `https://wa.me/${String(seller.whatsapp).replace(/\D/g, '')}?text=${encodeURIComponent(text)}`);
});
app.get('/api/links/stats', (req, res) => {
  needAdmin(req);
  const since = Date.now() - 7 * 86_400_000;
  const by = new Map();
  for (const c of store.data.linkClicks || []) { const k = c.sellerId; const e = by.get(k) || { total: 0, week: 0 }; e.total += 1; if (Date.parse(c.at) >= since) e.week += 1; by.set(k, e); }
  res.json({ total: (store.data.linkClicks || []).length, sellers: [...by.entries()].map(([id, v]) => ({ id, name: auth.get(id)?.name || '(removido)', ...v })).sort((a, b) => b.total - a.total), url: `${publicBase()}/atendimento` });
});
// ---- Página de live (Google Meet) ----
app.get('/api/live', (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Esta área é só do administrador');
  res.json({ ...live.cfg, pageUrl: `${publicBase()}/live`, closeUrl: `${publicBase()}/atendimento?o=live` });
});
app.put('/api/live', (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Esta área é só do administrador');
  const before = live.cfg;
  let next;
  try { next = live.set(req.body || {}); } catch (e) { throw httpError(400, e.message); }
  audit.record({ user: req.user, ip: clientIp(req), action: 'alterou', entity: 'live', label: before.status !== next.status ? `Live: ${before.status} → ${next.status}` : 'Dados da página de live', changes: ['status', 'title', 'startsAt', 'meetLink', 'groups'].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(next[k])).map((k) => ({ field: k, label: k, from: JSON.stringify(before[k]).slice(0, 160), to: JSON.stringify(next[k]).slice(0, 160), sensitive: false })) });
  res.json({ ...next, pageUrl: `${publicBase()}/live` });
});
// ---- Videochamadas ----
const videoView = (req) => ({
  config: videocalls.config, hosts: videocalls.hosts(), upcoming: videocalls.upcoming(), needsReschedule: videocalls.needsReschedule(),
  candidates: auth.users.filter((u) => u.role !== 'admin' && u.active !== false && !u.pending).map((u) => ({ id: u.id, name: u.name })),
});
app.get('/api/videocall', (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Esta área é só do administrador');
  res.json(videoView(req));
});
app.put('/api/videocall/config', (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Esta área é só do administrador');
  const before = videocalls.config;
  let next;
  try { next = videocalls.setConfig(req.body || {}); } catch (e) { throw httpError(400, e.message); }
  audit.record({ user: req.user, ip: clientIp(req), action: 'alterou', entity: 'videochamadas', label: 'Regras da agenda de videochamadas', changes: Object.keys(next).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(before[k])).map((k) => ({ field: k, label: k, from: JSON.stringify(before[k]).slice(0, 160), to: JSON.stringify(next[k]).slice(0, 160), sensitive: false })) });
  res.json(videoView(req));
});
app.post('/api/videocall/hosts', (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Esta área é só do administrador');
  const u = auth.get(String(req.body?.userId || ''));
  if (!u) throw httpError(404, 'Usuário não encontrado');
  videocalls.setHost(u.id, Boolean(req.body?.on));
  audit.record({ user: req.user, ip: clientIp(req), action: 'alterou', entity: 'videochamadas', label: `${u.name} ${req.body?.on ? 'passou a fazer' : 'deixou de fazer'} videochamadas` });
  res.json(videoView(req));
});
app.get('/api/videocall/me', (req, res) => res.json({ host: videocalls.isHost(req.user.id), ...(videocalls.mine(req.user.id) || {}), config: { durationMin: videocalls.config.durationMin, meetLink: videocalls.config.meetLink } }));
app.post('/api/videocall/me', async (req, res) => {
  let r;
  try { r = videocalls.setMine(req.user.id, req.body || {}); } catch (e) { throw httpError(400, e.message); }
  audit.record({ user: req.user, ip: clientIp(req), action: 'alterou', entity: 'videochamadas', label: `${req.user.name}: disponibilidade ${r.active ? 'ligada' : 'desligada'}${r.offDates.length ? `, sem atendimento em ${r.offDates.map((d) => d.split('-').reverse().join('/')).join(', ')}` : ''}` });
  if ((req.body?.tomorrowOff || req.body?.offDate) && r.needsReschedule.length) notifyAdmins(`📹 ${req.user.name} avisou que não faz videochamada em um dia que já tem cliente marcado: ${r.needsReschedule.length} cliente(s) precisam ser avisados e remarcados (painel → Videochamadas).`).catch(() => {});
  res.json({ host: true, ...r });
});
app.post('/api/videocall/:id/cancel', (req, res) => {
  const b = videocalls.data.bookings.find((x) => x.id === req.params.id);
  if (!b) throw httpError(404, 'Videochamada não encontrada');
  if (req.user.role !== 'admin' && b.hostId !== req.user.id) throw httpError(403, 'Só quem faz a videochamada ou o administrador pode cancelar');
  videocalls.cancel(b.id, 'cancelada pela equipe');
  audit.record({ user: req.user, ip: clientIp(req), action: 'cancelou', entity: 'videochamada', label: `${b.name} · ${videocalls.fmt(b)}` });
  res.json({ ok: true });
});
app.get('/api/resumes', (req, res) => {
  const q = String(req.query.q || '').toLowerCase();
  res.json(resumes.list.filter((r) => !q || `${r.name} ${r.phone} ${r.interest} ${r.summary}`.toLowerCase().includes(q)).map(({ files, ...r }) => ({ ...r, files: files.map(({ stored, ...f }) => f) })).reverse());
});
app.get('/api/resumes/export.csv', (req, res) => {
  audit.record({ user: req.user, ip: clientIp(req), action: 'alterou', entity: 'currículos', label: 'Baixou a planilha de currículos' });
  res.type('text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="curriculos.csv"').send(resumes.csv());
});
app.get('/api/resumes/:id/files/:fid', (req, res) => {
  const f = resumes.filePath(req.params.id, req.params.fid);
  if (!f || !fs.existsSync(f.path)) throw httpError(404, 'Arquivo não encontrado');
  res.set({ 'Content-Type': MIME_BY_EXT[f.ext] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': 'sandbox', 'Content-Disposition': `inline; filename="${encodeURIComponent(f.name)}"` });
  res.sendFile(f.path);
});
app.patch('/api/resumes/:id', (req, res) => res.json(resumes.update(req.params.id, req.body || {})));
app.delete('/api/resumes/:id', (req, res) => {
  const r = resumes.list.find((x) => x.id === req.params.id);
  resumes.remove(req.params.id);
  audit.record({ user: req.user, ip: clientIp(req), action: 'excluiu', entity: 'currículo', label: r ? `${r.name || r.phone || r.id}` : req.params.id });
  res.json({ ok: true });
});
// Contratos do sistema antigo (importados pela ferramenta tools/capturar-sistema). Só administrador.
const legacyUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 80_000_000 } }).single('file');
const readCapture = (req) => {
  if (!req.file) throw httpError(400, 'Escolha o arquivo captura.json');
  try { return JSON.parse(req.file.buffer.toString('utf8')); } catch { throw httpError(400, 'Este arquivo não é o captura.json gerado pela ferramenta.'); }
};
app.post('/api/legacy/preview', legacyUpload, (req, res) => res.json(legacy.preview(readCapture(req))));
app.post('/api/legacy/screen-map', legacyUpload, (req, res) => {
  needAdmin(req);
  const map = buildScreenMap(readCapture(req));
  res.json({ map, comparison: compareMap(map) });
});
app.post('/api/legacy/import', legacyUpload, (req, res) => {
  const cap = readCapture(req);
  const r = legacy.import(cap, req.user);
  r.documents = documents.importCapture(cap);
  r.cash = cashHook(cap);
  r.extras = importExtras(cap);
  audit.record({ user: req.user, ip: clientIp(req), action: 'criou', entity: 'contratos antigos', label: `Importação: ${r.added} novo(s), ${r.updated} atualizado(s)` });
  res.json(r);
});
ingest.sales = sales; ingest.crm = crm;
const ingestAuth = (req, _res, next) => { try { req.ingestRec = ingest.auth(req); next(); } catch (e) { next(e); } };
const ingestCaptura = multer({ storage: multer.memoryStorage(), limits: { fileSize: 150_000_000, files: 1 } }).single('file');
const ingestArquivos = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30_000_000, files: 30 } }).array('files', 30);
app.post('/api/legacy/ingest/captura', ingestAuth, ingestCaptura, (req, res) => {
  let json;
  try { json = JSON.parse(req.file?.buffer.toString('utf8') || ''); } catch { throw httpError(400, 'Arquivo de cópia inválido'); }
  const run = ingest.start(req.ingestRec, json);
  try { run.summary.cash = cashHook(json); } catch (e) { store.addLog({ type: 'error', message: `Caixa da cópia: ${e.message}` }); }
  try { run.summary.documents = documents.importCapture(json); } catch (e) { store.addLog({ type: 'error', message: `Documentos da cópia: ${e.message}` }); }
  run.summary.extras = importExtras(json);
  store.addLog({ type: 'system', message: `Cópia do sistema antigo recebida: ${run.summary.added} contrato(s) novo(s), ${run.summary.newClients} cliente(s) novo(s)` });
  res.json({ run: run.id, summary: run.summary, expectedFiles: run.owners.length });
});
app.post('/api/legacy/ingest/arquivos', ingestAuth, ingestArquivos, (req, res) => res.json(ingest.addFiles(req.ingestRec, req.files || [])));
app.post('/api/legacy/ingest/fim', ingestAuth, (req, res) => {
  const out = ingest.finish(req.ingestRec);
  audit.record({ user: { name: req.ingestRec.by || 'Cópia automática', role: 'admin' }, ip: clientIp(req), action: 'criou', entity: 'contratos antigos', label: `Cópia automática concluída: ${out.summary.total} contrato(s), ${out.files.received} arquivo(s), ${out.applied.sales} venda(s) e ${out.applied.clients} cliente(s) no sistema novo` });
  notify('sales', {}); notify('crm', {});
  res.json(out);
});
app.get('/api/legacy/files/:id', (req, res) => {
  const f = ingest.file(req.params.id);
  if (!f || !fs.existsSync(f.path)) throw httpError(404, 'Arquivo não encontrado');
  res.set({ 'Content-Type': FILE_MIME[f.ext] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': 'sandbox', 'Content-Disposition': `inline; filename="${encodeURIComponent(f.name)}"` });
  res.sendFile(f.path);
});
app.get('/api/legacy/ferramenta.bat', (req, res) => {
  audit.record({ user: req.user, ip: clientIp(req), action: 'alterou', entity: 'contratos antigos', label: 'Baixou a ferramenta de cópia (CAPTURAR-CONTRATOS.bat)' });
  // O arquivo baixado leva uma chave temporária (8 horas) só para enviar a cópia para cá.
  const { token } = ingest.issueToken(req.user);
  res.type('application/octet-stream').set('Content-Disposition', 'attachment; filename="CAPTURAR-CONTRATOS.bat"').send(buildBat(undefined, { url: linkBase(req), token }));
});
app.get('/api/legacy/ferramenta-site.bat', (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Esta área é só do administrador');
  res.type('application/octet-stream').set('Content-Disposition', 'attachment; filename="COPIAR-VISUAL-DO-SITE.bat"').send(buildSiteBat({ site: String(req.query.site || '') }));
});
app.get('/api/legacy/audit', (_req, res) => res.json({ last: (store.data.legacyAudits || []).at(-1) || null, history: (store.data.legacyAudits || []).slice(-5).map((a) => ({ at: a.at, ok: a.ok, paginas: a.paginas })) }));
app.post('/api/legacy/apply', (req, res) => {
  const out = legacy.apply({ sales, crm, user: req.user, doSales: req.body?.sales !== false, doClients: req.body?.clients !== false });
  audit.record({ user: req.user, ip: clientIp(req), action: 'criou', entity: 'contratos antigos', label: `Levou para o sistema novo: ${out.sales} venda(s) com parcelas e ${out.clients} cliente(s) no CRM` });
  notify('sales', {}); notify('crm', {});
  res.json(out);
});
app.get('/api/legacy', (req, res) => res.json({ items: legacy.search(req.query).map(({ raw, source, parcels, ...r }) => ({ ...r, parcelas: parcels?.length || 0 })), clients: legacy.clients.length, total: legacy.list.length, ultimoNumero: legacy.search({ limit: 1 })[0]?.number || '' }));
app.get('/api/legacy/export.csv', (req, res) => {
  audit.record({ user: req.user, ip: clientIp(req), action: 'alterou', entity: 'contratos antigos', label: 'Baixou a planilha de contratos antigos' });
  res.type('text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="contratos-antigos.csv"').send(legacy.csv());
});
app.get('/api/legacy/:id', (req, res) => {
  const r = legacy.get(req.params.id);
  if (!r) throw httpError(404, 'Contrato não encontrado');
  const { source, ...rest } = r;
  res.json(rest);
});

// Migra Motors: veículos, bancos/consórcios e comparação de financiamento.
app.get('/api/motors/vehicles', (_req, res) => res.json(motors.vehicles()));
app.post('/api/motors/vehicles', (req, res) => res.json(motors.saveVehicle(null, req.body || {})));
app.patch('/api/motors/vehicles/:id', (req, res) => res.json(motors.saveVehicle(req.params.id, req.body || {})));
app.delete('/api/motors/vehicles/:id', (req, res) => { motors.removeVehicle(req.params.id); res.json({ ok: true }); });
app.get('/api/motors/lenders', (_req, res) => res.json(motors.lenders()));
app.post('/api/motors/lenders', (req, res) => res.json(motors.saveLender(null, req.body || {})));
app.patch('/api/motors/lenders/:id', (req, res) => res.json(motors.saveLender(req.params.id, req.body || {})));
app.delete('/api/motors/lenders/:id', (req, res) => { motors.removeLender(req.params.id); res.json({ ok: true }); });
app.post('/api/motors/compare', (req, res) => {
  const b = req.body || {};
  const v = b.vehicleId ? motors.vehicle(b.vehicleId) : null;
  res.json(motors.compare({ price: v ? v.price : b.price, entry: b.entry, months: b.months, vehicleYear: v?.year || b.vehicleYear }));
});
// Migra School: alunos, etapa e frequência (administrador e gerente).
const schoolStaff = (u) => u.role === 'admin' || u.manager;
app.use('/api/school', (req, _res, next) => (schoolStaff(req.user) ? next() : next(httpError(403, 'Só o administrador ou o gerente'))));
app.get('/api/school/summary', (_req, res) => res.json(school.summary()));
app.get('/api/school/students', (req, res) => res.json(school.list(req.query)));
app.post('/api/school/students', (req, res) => res.json(school.save(null, req.body || {})));
app.patch('/api/school/students/:id', (req, res) => res.json(school.save(req.params.id, req.body || {})));
app.delete('/api/school/students/:id', (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Só o administrador exclui');
  school.remove(req.params.id);
  res.json({ ok: true });
});
app.post('/api/school/students/:id/access', (req, res) => res.json({ ...school.access(req.params.id), accesses: undefined }));

// Financiamento de lotes: simulador, propostas de reserva e relatório de parcelas.
const isManagerOrAdmin = (u) => u.role === 'admin' || u.manager;
const lotPrice = (b) => {
  if (b.devId && b.lotId) {
    const lot = realty.development(b.devId)?.lots.find((l) => l.id === b.lotId);
    if (!lot) throw httpError(404, 'Lote não encontrado');
    return lot.price;
  }
  return b.price;
};
app.get('/api/finance/config', (_req, res) => res.json({ config: proposals.config, configured: finConfigured(proposals.config) }));
app.put('/api/finance/config', (req, res) => {
  const config = proposals.saveConfig(req.body || {});
  res.json({ config, configured: finConfigured(config) });
});
app.post('/api/finance/simulate', (req, res) => {
  const b = req.body || {};
  const sim = finSimulate(proposals.config, { price: lotPrice(b), entry: b.entry, installments: b.installments, entryParts: b.entryParts });
  res.json({ sim, configured: finConfigured(proposals.config) });
});
app.post('/api/finance/options', (req, res) => {
  const b = req.body || {};
  res.json({ options: finOptions(proposals.config, { price: lotPrice(b), entry: b.entry, entryParts: b.entryParts }), configured: finConfigured(proposals.config) });
});
app.post('/api/finance/proposals', (req, res) => {
  const b = req.body || {};
  res.json(proposals.create({ devId: b.devId, lotId: b.lotId, client: b.client, entry: b.entry, installments: b.installments, entryParts: b.entryParts, user: req.user }));
});
const mineOrAll = (u, p) => isManagerOrAdmin(u) || p.sellerId === u.id;
app.get('/api/finance/proposals', (req, res) => res.json(proposals.list(req.query).filter((p) => mineOrAll(req.user, p))));
app.get('/api/finance/proposals/:id/pdf', (req, res) => {
  const p = proposals.get(req.params.id);
  if (!p || !mineOrAll(req.user, p)) throw httpError(404, 'Proposta não encontrada');
  res.type('application/pdf').set('Content-Disposition', `inline; filename="${p.number}.pdf"`).send(proposals.pdf(p, store.settings.business?.name || 'Migra Imobiliária'));
});
app.get('/api/finance/proposals/:id/schedule', (req, res) => {
  const p = proposals.get(req.params.id);
  if (!p || !mineOrAll(req.user, p)) throw httpError(404, 'Proposta não encontrada');
  res.json(finSchedule(p.sim, p.paidAt || new Date()));
});
app.post('/api/finance/proposals/:id/paid', (req, res) => {
  if (!isManagerOrAdmin(req.user)) throw httpError(403, 'Só o administrador ou o gerente confirma a reserva');
  res.json(proposals.markPaid(req.params.id, req.user));
});
app.post('/api/finance/proposals/:id/cancel', (req, res) => {
  if (!isManagerOrAdmin(req.user)) throw httpError(403, 'Só o administrador ou o gerente cancela a proposta');
  res.json(proposals.cancel(req.params.id, req.user));
});
app.get('/api/finance/report', (req, res) => {
  if (!isManagerOrAdmin(req.user)) throw httpError(403, 'Só o administrador ou o gerente');
  res.json(proposals.report());
});

app.get('/api/realty/properties', (_req, res) => res.json(realty.listProperties()));
app.post('/api/realty/properties', (req, res) => res.json(realty.saveProperty(null, req.body)));
app.patch('/api/realty/properties/:id', (req, res) => res.json(realty.saveProperty(req.params.id, req.body)));
app.delete('/api/realty/properties/:id', (req, res) => {
  realty.removeProperty(req.params.id);
  res.json({ ok: true });
});
app.post('/api/realty/upload', imageUpload, (req, res) => res.json({ url: realty.saveImage(req.file.buffer, imageExt(req.file)) }));
app.get('/api/realty/developments', (_req, res) => res.json(realty.listDevelopments()));
app.get('/api/realty/developments/:id', (req, res) => {
  const d = realty.development(req.params.id);
  if (!d) throw httpError(404, 'Loteamento não encontrado');
  res.json({ ...d, summary: realty.summary(d) });
});
app.post('/api/realty/developments', (req, res) => res.json(realty.saveDevelopment(null, req.body)));
app.patch('/api/realty/developments/:id', (req, res) => res.json(realty.saveDevelopment(req.params.id, req.body)));
app.delete('/api/realty/developments/:id', (req, res) => {
  realty.removeDevelopment(req.params.id);
  res.json({ ok: true });
});
app.post('/api/realty/developments/:id/plan', imageUpload, (req, res) => {
  res.json(realty.setPlan(req.params.id, req.file?.buffer, imageExt(req.file), { width: req.body.width, height: req.body.height }));
});
app.post('/api/realty/developments/:id/lots', (req, res) => res.json(realty.addLot(req.params.id, req.body)));
app.post('/api/realty/developments/:id/lots/bulk', (req, res) => res.json(realty.addLots(req.params.id, req.body.lots)));
app.post('/api/realty/developments/:id/block', (req, res) => res.json(realty.generateBlock(req.params.id, req.body)));
app.patch('/api/realty/developments/:id/lots/:lotId', (req, res) => {
  // Vendedor só muda a situação (reservar/vender); preço e dados do lote são do administrador e do gerente.
  const full = req.user.role === 'admin' || req.user.manager;
  const body = full ? req.body : { status: req.body.status };
  if (!full) {
    const lot = realty.development(req.params.id)?.lots.find((l) => l.id === req.params.lotId);
    if (body.status === 'loteadora' || lot?.status === 'loteadora') throw httpError(403, 'Só o administrador mexe nos lotes reservados da loteadora');
  }
  res.json(realty.updateLot(req.params.id, req.params.lotId, body));
});
app.delete('/api/realty/developments/:id/lots/:lotId', (req, res) => {
  realty.removeLot(req.params.id, req.params.lotId);
  res.json({ ok: true });
});

// Programa de indicação (administração)
app.get('/api/learnings', (_req, res) => res.json([...learnings.list].reverse()));
app.post('/api/learnings', (req, res) => res.json(learnings.add(req.body?.text, { by: req.user.name })));
app.post('/api/learnings/:id/approve', (req, res) => res.json(learnings.approve(req.params.id, req.user.name, req.body?.text)));
app.post('/api/learnings/:id/reject', (req, res) => res.json(learnings.reject(req.params.id, req.user.name)));
app.delete('/api/learnings/:id', (req, res) => { learnings.remove(req.params.id); res.json({ ok: true }); });
// Administração: saques, trocas de indicação, grupos e materiais.
const materialUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6_000_000 } }).single('image');
app.get('/api/affiliates-payouts', (req, res) => { needAdmin(req); res.json(affExtras.payouts()); });
app.post('/api/affiliates-payouts/:id/:action', async (req, res) => {
  const p = req.params.action === 'pay' ? await affExtras.payPayout(req.user, req.params.id, req.body || {}) : req.params.action === 'reject' ? await affExtras.rejectPayout(req.user, req.params.id, req.body || {}) : null;
  if (!p) throw httpError(400, 'Ação inválida');
  audit.record({ user: req.user, ip: clientIp(req), action: 'alterou', entity: 'saque de indicador', label: `${p.affName} · ${p.currency} ${p.amount} → ${p.status}` });
  res.json(p);
});
app.get('/api/affiliates-transfers', (req, res) => { needAdmin(req); res.json(affExtras.transfers()); });
app.post('/api/affiliates-transfers', async (req, res) => {
  needAdmin(req);
  const t = await affExtras.requestTransfer(req.user, req.body || {});
  audit.record({ user: req.user, ip: clientIp(req), action: 'criou', entity: 'troca de indicação', label: `${t.leadName}: pedido de troca de indicador` });
  res.json(t);
});
app.post('/api/affiliates-transfers/:id/decide', async (req, res) => {
  const t = await affExtras.decide(req.user, req.params.id, req.body?.accept === true, req.body?.note || '');
  audit.record({ user: req.user, ip: clientIp(req), action: 'alterou', entity: 'troca de indicação', label: `${t.leadName}: ${t.status} (diretoria)` });
  res.json(t);
});
app.get('/api/affiliates-groups', (req, res) => { needAdmin(req); res.json(affExtras.config.groups); });
app.put('/api/affiliates-groups', (req, res) => res.json(affExtras.setGroups(req.user, Array.isArray(req.body?.groups) ? req.body.groups : [])));
app.get('/api/affiliates-materials', (req, res) => { needAdmin(req); res.json({ items: affExtras.materials({ all: true }) }); });
app.post('/api/affiliates-materials', materialUpload, (req, res) => res.json(affExtras.saveMaterial(req.user, null, req.body || {}, req.file || null)));
app.patch('/api/affiliates-materials/:id', materialUpload, (req, res) => res.json(affExtras.saveMaterial(req.user, req.params.id, req.body || {}, req.file || null)));
app.get('/api/affiliates', (_req, res) => res.json(affiliates.adminList()));
app.get('/api/affiliates-meta', (_req, res) => res.json({ categories: affiliates.categories(), services: affiliates.services }));
app.patch('/api/affiliates/:id', (req, res) => res.json(affiliates.publicAffiliate(affiliates.update(req.params.id, req.body))));
app.get('/api/affiliates-commissions', (_req, res) => res.json(affiliates.adminCommissions()));
app.post('/api/affiliates-commissions/:id/paid', (req, res) => res.json(affiliates.markPaid(req.params.id, { by: req.user.name, note: req.body?.note })));
app.post('/api/affiliates-commissions/:id/cancel', (req, res) => res.json(affiliates.cancelCommission(req.params.id)));

// Pagamentos (Pix)
const canSeePayment = (user, p) => user.role === 'admin' || Boolean(p.leadId && crm.leads.some((l) => l.id === p.leadId && (l.ownerId === user.id || (user.officeAdmin && crm.officeOf(l) === officeOfUser(user)))));
const publicPayment = (p) => {
  const lead = p.leadId ? crm.leads.find((l) => l.id === p.leadId) : null;
  return { ...p, leadName: lead?.name || '', leadCode: lead?.code || '', ownerName: crm.ownerName(lead?.ownerId), receiptUrl: p.status === 'paid' ? payments.receiptUrl(p) : '' };
};
app.get('/api/payments', (req, res) => {
  res.json(payments.list.filter((p) => canSeePayment(req.user, p) && inOffice(req, crm.leads.find((l) => l.id === p.leadId) ? crm.officeOf(crm.leads.find((l) => l.id === p.leadId)) : 'py')).map(publicPayment).reverse());
});
app.post('/api/payments', async (req, res) => {
  const lead = req.body.leadId ? crm.get(req.user, req.body.leadId) : null;
  const amount = req.body.amount ? Number(req.body.amount) : payments.reservationAmount(req.body.adults || lead?.people || 1);
  const convKey = lead ? lead.whatsappKey || lead.conversationKey || null : null;
  const p = await payments.create({ convKey, leadId: lead?.id || null, amount, description: req.body.description, payerName: req.body.payerName || lead?.name, payerDoc: req.body.payerDoc, by: req.user.name });
  if (req.body.send !== false && convKey) await payments.sendCharge(p).catch((e) => store.addLog({ type: 'error', message: `Envio do Pix: ${e.message}` }));
  res.json(publicPayment(p));
});
app.post('/api/payments/:id/confirm', async (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Só o administrador confirma pagamentos');
  res.json(publicPayment(await payments.confirm(req.params.id, { by: req.user.name, userId: req.user.id })));
});
app.post('/api/payments/:id/cancel', (req, res) => {
  const p = payments.get(req.params.id);
  if (!p || !canSeePayment(req.user, p)) throw httpError(404, 'Cobrança não encontrada');
  res.json(publicPayment(payments.cancel(req.params.id)));
});
app.post('/api/payments/:id/resend', async (req, res) => {
  const p = payments.get(req.params.id);
  if (!p || !canSeePayment(req.user, p)) throw httpError(404, 'Cobrança não encontrada');
  await payments.sendCharge(p);
  res.json({ ok: true });
});
app.get('/api/payments/:id/qr', (req, res) => {
  const p = payments.get(req.params.id);
  if (!p || !canSeePayment(req.user, p)) throw httpError(404, 'Cobrança não encontrada');
  res.sendFile(payments.qrPath(p));
});
app.get('/api/payments/:id/proof', (req, res) => {
  const p = payments.get(req.params.id);
  if (!p || !canSeePayment(req.user, p)) throw httpError(404, 'Cobrança não encontrada');
  const file = ['jpg', 'png', 'pdf'].map((e) => path.join(payments.dir, `comprovante-${p.id}.${e}`)).find((f) => fs.existsSync(f));
  if (!file) throw httpError(404, 'Sem comprovante guardado');
  res.sendFile(file);
});
app.get('/api/payments/:id/receipt', (req, res) => {
  const p = payments.get(req.params.id);
  if (!p || p.status !== 'paid' || !canSeePayment(req.user, p)) throw httpError(404, 'Recibo não encontrado');
  res.type('application/pdf').sendFile(payments.receiptPath(p));
});

// Números da equipe. O administrador gerencia todos; o vendedor conecta o dele.
const myLine = (user, id) => {
  const line = lines.get(id);
  if (!line) throw httpError(404, 'Número não encontrado');
  if (user.role !== 'admin' && line.ownerId !== user.id && !(user.officeAdmin && sees(user, line.office || officeOfUser(auth.get(line.ownerId))))) throw httpError(403, 'Este número é de outro vendedor');
  return line;
};
const publicLine = (l) => {
  const owner = auth.get(l.ownerId);
  return { ...l, label: owner?.name || l.label, ownerName: owner?.name || '', ownerWhatsapp: owner?.whatsapp || '' };
};
app.get('/api/lines', (req, res) => {
  const lineOffice = (l) => normOffice(l.office) || officeOfUser(auth.get(l.ownerId));
  res.json(lines.list().filter((l) => (req.user.role === 'admin' ? inOffice(req, lineOffice(l)) : l.ownerId === req.user.id || (req.user.officeAdmin && lineOffice(l) === officeOfUser(req.user)))).map((l) => ({ ...publicLine(l), office: lineOffice(l) })));
});
app.post('/api/lines', (req, res) => {
  // O vendedor conecta o próprio WhatsApp; o administrador conecta o de qualquer pessoa da equipe.
  const canPick = req.user.role === 'admin' || req.user.officeAdmin;
  const ownerId = canPick ? req.body.ownerId || null : req.user.id;
  const owner = ownerId ? auth.get(ownerId) : null;
  if (ownerId && !owner) throw httpError(404, 'Vendedor não encontrado');
  if (owner && !sees(req.user, owner.office)) throw httpError(403, 'Esta pessoa é de outro escritório');
  const office = owner ? officeOfUser(owner) : req.user.role === 'admin' ? normOffice(req.body.office) || (req.office !== 'all' ? req.office : 'py') : officeOfUser(req.user);
  res.json(publicLine(lines.add({ label: owner?.name || req.body.label, ownerId, office })));
});
app.patch('/api/lines/:id', (req, res) => {
  myLine(req.user, req.params.id);
  const patch = req.user.role === 'admin' ? req.body : { agent: req.body.agent, agentName: req.body.agentName, memory: req.body.memory };
  if (req.user.role !== 'admin') delete patch.office;
  res.json(lines.update(req.params.id, patch));
});
app.delete('/api/lines/:id', async (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Só o administrador remove números');
  await lines.remove(req.params.id);
  res.json({ ok: true });
});
app.post('/api/lines/:id/restart', async (req, res) => {
  myLine(req.user, req.params.id);
  res.json(await lines.start(req.params.id));
});
app.post('/api/lines/:id/logout', async (req, res) => {
  myLine(req.user, req.params.id);
  await lines.logout(req.params.id);
  res.json({ ok: true });
});
app.post('/api/lines/:id/pairing-code', async (req, res) => {
  myLine(req.user, req.params.id);
  res.json({ code: await lines.requestPairingCode(req.params.id, req.body.phone) });
});
app.post('/api/pending/reply', (req, res) => {
  const jids = req.body.all ? pending.list().map((p) => p.jid) : req.body.jids || [];
  res.json(pending.enqueue(jids));
});
app.post('/api/pending/cancel', (_req, res) => {
  pending.cancel();
  res.json(pending.status());
});
app.post('/api/pending/dismiss', (req, res) => {
  pending.dismiss(req.body.jids || []);
  res.json(pending.status());
});

// Atualização do programa
const updater = new Updater({ root: ROOT, dataDir: DATA_DIR, token: () => process.env.GITHUB_TOKEN || store.settings.updater?.token || '' });
const vpsUpdate = () => process.env.UPDATER === 'off';
const watcherAlive = () => { try { return Date.now() - fs.statSync(path.join(DATA_DIR, 'update-watch-alive')).mtimeMs < 3 * 60_000; } catch { return false; } };
app.get('/api/update/check', async (_req, res) => res.json({ ...(await updater.check()), vps: vpsUpdate(), watcherAlive: watcherAlive() }));
app.post('/api/update', async (req, res) => {
  // Na VPS o código vem da imagem: o painel só PEDE a atualização (arquivo de pedido) e um vigia da própria VPS, que roda a cada minuto, executa o atualizar-vps.sh.
  if (vpsUpdate()) {
    if (!watcherAlive()) throw httpError(400, 'A atualização pelo painel ainda não foi ativada na VPS. Rode uma vez no Terminal da VPS: bash /opt/migra/app/whatsapp-automacao/deploy/ativar-atualizacao-painel.sh');
    fs.writeFileSync(path.join(DATA_DIR, 'update-requested'), new Date().toISOString());
    securityEvent('atualizacao_pedida', req.user, req, 'pedido pelo painel (VPS)');
    store.addLog({ type: 'system', message: `⬆️ Atualização pedida pelo painel por ${req.user.name}. A VPS atualiza em até 1 minuto e reinicia.` });
    return res.json({ requested: true });
  }
  const result = await updater.update();
  store.addLog({ type: 'system', message: `⬆️ Agente atualizado: ${result.version.message || result.version.sha.slice(0, 7)}. Reiniciando…` });
  res.json(result);
  // Reinicia para carregar o código novo (os atalhos INICIAR reabrem sozinhos).
  setTimeout(async () => {
    store.flush();
    await wa.stop().catch(() => {});
    process.exit(RESTART_EXIT_CODE);
  }, 1500);
});

// Equipe (usuários)
const sameOfficeUser = (req, u) => req.user.role === 'admin' || (officeOfUser(u) === officeOfUser(req.user) && u.role !== 'admin');
app.get('/api/users', (req, res) => {
  const list = auth.list().map((u) => ({ ...u, lockedMin: loginGuard.lockedLogin(u.login) })); // lockedMin: minutos de bloqueio por tentativas erradas (0 = livre)
  if (req.user.role === 'admin') return res.json(list.filter((u) => u.role === 'admin' || inOffice(req, u.office)));
  const mine = list.filter((u) => u.role !== 'admin' && u.office === officeOfUser(req.user));
  res.json(req.user.officeAdmin ? mine : mine.filter((u) => u.active).map(({ id, name }) => ({ id, name })));
});
// "Liberar acesso": tira o bloqueio por tentativas erradas (a pessoa esqueceu a senha) sem esperar os 15 minutos.
app.post('/api/users/:id/unlock', (req, res) => {
  const target = auth.get(req.params.id);
  if (!target) throw httpError(404, 'Usuário não encontrado');
  if (req.user.role !== 'admin' && !(req.user.officeAdmin && sameOfficeUser(req, target))) throw httpError(403, 'Só administrador libera o acesso');
  loginGuard.unlock(target.login);
  securityEvent('acesso_liberado', req.user, req, `${target.name}: bloqueio por tentativas removido`);
  res.json({ ok: true });
});
app.post('/api/users', (req, res) => {
  const b = { ...(req.body || {}) };
  if (req.user.role !== 'admin') Object.assign(b, { role: 'seller', office: officeOfUser(req.user), officeAdmin: false, pending: false });
  else if (!normOffice(b.office)) b.office = req.office !== 'all' ? req.office : 'py';
  res.json(auth.create(b));
});
app.patch('/api/users/:id', (req, res) => {
  const target = auth.get(req.params.id);
  if (!target) throw httpError(404, 'Usuário não encontrado');
  if (!sameOfficeUser(req, target)) throw httpError(403, 'Esta pessoa é de outro escritório');
  let body = req.body || {};
  if (req.user.role !== 'admin') {
    if (target.id === req.user.id) throw httpError(403, 'Peça ao administrador para mudar o seu próprio acesso');
    body = Object.fromEntries(Object.entries(body).filter(([k]) => ['name', 'whatsapp', 'active', 'receivesLeads', 'sectors', 'password'].includes(k)));
  }
  // Virar (ou deixar de ser) administrador geral: só outro administrador geral faz, nunca em si mesmo; fica no registro de segurança e os demais são avisados.
  const roleChange = body.role !== undefined && (body.role === 'admin') !== (target.role === 'admin');
  if (roleChange && target.id === req.user.id) throw httpError(403, 'Você não pode mudar o seu próprio nível de acesso. Peça a outro administrador geral.');
  const user = auth.update(req.params.id, body);
  if (body.password) { loginGuard.unlock(target.login); securityEvent('acesso_liberado', req.user, req, `${target.name}: senha trocada, tentativas zeradas`); } // senha nova também tira o bloqueio por tentativas
  if (roleChange) {
    const made = user.role === 'admin';
    securityEvent(made ? 'admin_geral_concedido' : 'admin_geral_removido', req.user, req, target.name);
    notifyAdmins(`${made ? '🛡️' : '⚠️'} *${made ? 'Novo administrador geral' : 'Administrador geral removido'}*\n👤 ${target.name}\nFeito por: ${req.user.name}\n🕒 ${new Date().toLocaleString('pt-BR')}\n\nSe não foi combinado, troque as senhas e fale com o Marcos.`).catch(() => {});
  }
  // A conexão do vendedor leva o nome dele.
  const line = lines.byOwner(user.id);
  if (line && line.label !== user.name) lines.update(line.id, { label: user.name });
  // Trocou o WhatsApp do cadastro: confere de novo com o número conectado.
  if (line?.phone && req.body.whatsapp !== undefined) lines.update(line.id, { verified: user.whatsapp ? samePhone(user.whatsapp, line.phone) : null });
  // Trocou de escritório: o número de WhatsApp dele vai junto.
  if (line && body.office !== undefined && req.user.role === 'admin') lines.update(line.id, { office: user.office || 'py' });
  res.json(user);
});
app.post('/api/users/:id/approve', async (req, res) => {
  const u = auth.get(req.params.id);
  if (!u) throw httpError(404, 'Usuário não encontrado');
  if (!sameOfficeUser(req, u)) throw httpError(403, 'Esta pessoa é de outro escritório');
  const user = auth.update(u.id, { active: true });
  securityEvent('cadastro_liberado', req.user, req, u.name);
  const base = publicBase();
  if (u.whatsapp && wa.status === 'connected') {
    await wa.send(u.whatsapp, { text: `✅ Olá, ${u.name.split(' ')[0]}! Seu acesso ao sistema da Migra foi liberado.\n${base ? `Entre em: ${base}\n` : ''}No primeiro acesso, o sistema vai pedir para ligar a verificação em duas etapas (app Google Authenticator).`, typing: false }).catch(() => {});
  }
  notify('users', {});
  res.json(user);
});
app.post('/api/users/:id/reject', (req, res) => {
  const u = auth.get(req.params.id);
  if (!u) throw httpError(404, 'Usuário não encontrado');
  if (!sameOfficeUser(req, u)) throw httpError(403, 'Esta pessoa é de outro escritório');
  if (!u.pending) throw httpError(400, 'Só dá para recusar cadastros que aguardam liberação');
  auth.remove(u.id);
  securityEvent('cadastro_recusado', req.user, req, u.name);
  notify('users', {});
  res.json({ ok: true });
});
app.post('/api/users/:id/transfer', (req, res) => res.json(crm.transfer(req.user, req.params.id, req.body.toId || null)));

// CRM: prospectos
app.get('/api/crm/stages', (_req, res) => res.json({ stages: STAGES, packages: store.settings.crm?.packages || [] }));
app.get('/api/leads', (req, res) => res.json(crm.list(req.user, req.query).filter((l) => inOffice(req, l.office || crm.officeOf(l)))));
app.post('/api/leads', (req, res) => res.json(crm.create(req.user, req.body)));
app.post('/api/leads/from-conversation', (req, res) => {
  const conv = agent.conversation(String(req.body.key || ''), { create: false });
  if (!conv) throw httpError(404, 'Conversa não encontrada');
  const lead = crm.findForConversation({ key: conv.key, phone: conv.phone }) ||
    crm.byId(crm.create(req.user, {
      name: conv.name,
      phone: conv.phone,
      source: String(conv.key).startsWith('ig:') ? 'instagram' : 'whatsapp',
      conversationKey: conv.key,
    }).id);
  lead.conversationKey ||= conv.key;
  store.save();
  crmAi.afterReply(conv, { force: true }).catch(() => {});
  res.json(crm.get(req.user, lead.id));
});
app.get('/api/leads/:id', (req, res) => {
  // O link do aviso traz o id; se o id não existir, tenta pelo código (MIG-XXXX), pela conversa ou pelo @instagram, e explica quando foi apagado.
  let ref = req.params.id;
  if (!crm.leads.some((l) => l.id === ref)) {
    const found = crm.resolveRef(ref);
    if (found) ref = found.id;
    else {
      const t = crm.tombstoneFor(ref);
      throw httpError(404, t ? `Este prospecto (${t.name || t.code}) foi apagado por ${t.by || 'alguém'} em ${new Date(t.at).toLocaleDateString('pt-BR')}.` : 'Prospecto não encontrado. Procure pelo nome, @ ou código (MIG-...) na lista de Prospectos: se a conversa existir, o sistema cria o registro sozinho em até 30 minutos.');
    }
  }
  const lead = crm.get(req.user, ref); // quem pode ver o prospecto (dono, administrador do escritório, administrador) já foi decidido aqui
  const full = fullConversation(lead, (k) => agent.conversation(k, { create: false }));
  res.json({ ...lead, conversation: full.messages, conversationTotal: full.total, brief: clientBrief({ lead, messages: full.messages, quotes: quotes.list, payments: payments.list }) });
});
app.patch('/api/leads/:id', (req, res) => res.json(crm.update(req.user, req.params.id, req.body)));
app.post('/api/leads/:id/notes', (req, res) => res.json(crm.addNote(req.user, req.params.id, req.body.text)));
app.post('/api/leads/:id/followup', (req, res) => res.json(crm.followUp(req.user, req.params.id, req.body)));
app.post('/api/leads/:id/assign', (req, res) => res.json(crm.assign(req.user, req.params.id, req.body.ownerId)));
app.post('/api/leads/:id/ai', async (req, res) => {
  const lead = crm.get(req.user, req.params.id);
  const conv = lead.conversationKey ? agent.conversation(lead.conversationKey, { create: false }) : null;
  if (!conv) throw httpError(400, 'Este prospecto não tem conversa ligada');
  const info = await crmAi.afterReply(conv, { force: true });
  res.json({ info, lead: crm.get(req.user, lead.id) });
});
app.get('/api/closing/template', (_req, res) => res.json({ text: DEFAULT_TERM }));
// Fechamento do prospecto: ver a ficha/termo e enviar a ficha pelo painel.
app.get('/api/leads/:id/closing', (req, res) => {
  const f = closing.forLead(req.params.id);
  res.json(f ? closing.view(f) : null);
});
app.post('/api/leads/:id/closing', async (req, res) => {
  const lead = crm.byId(req.params.id);
  if (!lead) throw httpError(404, 'Prospecto não encontrado');
  if (!publicBase()) throw httpError(400, 'O painel ainda não tem endereço público: ligue o acesso pela internet (aba Conexões) ou use a VPS.');
  const key = lead.whatsappKey || lead.conversationKey || (lead.phone ? lead.phone : null);
  const f = closing.createForm({ convKey: key, lead });
  if (req.body?.send && key) {
    const text = 'Perfeito! Preencha para mim seus dados pessoais para darmos continuidade na sua reserva. Eles já serão usados para dar entrada no seu processo e ficam guardados com segurança:';
    await wa.send(key, { text: `${text}\n${closing.formUrl(f)}`, typing: false });
  }
  res.json(closing.view(f));
});
// Calculadora de orçamento: entrada, parcelas e datas (sábado/domingo passam para segunda).
app.post('/api/payments/calc', async (req, res) => {
  const b = req.body || {};
  const pkg = crm.matchPackage(b.packageName);
  if (!pkg) throw httpError(400, 'Escolha o pacote');
  if (b.send) {
    const lead = crm.byId(b.leadId);
    if (!lead) throw httpError(404, 'Escolha o cliente');
    const key = lead.whatsappKey || lead.conversationKey || lead.phone || null;
    if (!key) throw httpError(400, 'Este cliente não tem WhatsApp');
    const r = await sendPaymentPlan({ convKey: key, lead, packageName: pkg.name, people: b.people, adults: b.adults, start: b.start });
    if (r.erro) throw httpError(400, r.erro);
    return res.json({ sent: true, plan: r.rec.plan, text: r.text });
  }
  const plan = payplans.preview({ price: pkg.price, people: b.people, adults: b.adults, start: b.start });
  res.json({ plan, packageName: pkg.name, price: pkg.price, text: planMessage(plan, { packageName: pkg.name }) });
});
// Etapas de pagamento pelo painel.
app.post('/api/leads/:id/payplan', async (req, res) => {
  const lead = crm.byId(req.params.id);
  if (!lead) throw httpError(404, 'Prospecto não encontrado');
  const key = lead.whatsappKey || lead.conversationKey || lead.phone || null;
  const r = await sendPaymentPlan({ convKey: req.body.send ? key : null, lead, packageName: req.body.packageName || lead.interest, people: req.body.people || lead.people, adults: req.body.adults });
  if (r.erro) throw httpError(400, r.erro);
  res.json({ text: r.text });
});
// Reenvio dos encaminhamentos: cada cliente que a IA passou para um humano vai, com resumo,
// para o vendedor responsável ou para o WhatsApp do próprio Marcos (um por mensagem, com intervalo).
const digestRun = { running: false, total: 0, done: 0, failed: 0 };
const marcosPhone = () => normalizePhone(store.settings.crm?.ownerPhone) || wa.getState?.().me?.phone || '';
function digestPlan(q) {
  const items = collectHandoffs({ store, crm, auth, maxDays: Number(q.days) || 30, includeSent: q.all === '1' || q.all === true });
  // Sem vendedor: vai para os atendentes da migração (Camila e Fran), alternando; o Marcos só se não houver ninguém.
  const team = sectors.people('documentacao');
  let i = 0;
  return items.map((it) => {
    if (it.to.kind === 'vendedor' && !isOwner(it.to.user, store.settings.crm?.ownerPhone)) return { ...it, toPhone: it.to.user.whatsapp, toName: it.to.user.name, senderName: it.to.user.name };
    const p = team.length ? team[i++ % team.length] : null;
    return p ? { ...it, toPhone: p.whatsapp, toName: p.name, senderName: p.name } : { ...it, toPhone: marcosPhone(), toName: 'Marcos (WhatsApp dele)', senderName: 'Marcos' };
  });
}
app.get('/api/handoffs/digest', (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Só o administrador');
  const plan = digestPlan(req.query);
  const groups = {};
  for (const it of plan) (groups[it.toName] ||= { name: it.toName, phone: it.toPhone, count: 0, clients: [] }).count++, groups[it.toName].clients.push(it.name || (it.phone ? `+${it.phone}` : 'Cliente'));
  res.json({ ...digestRun, count: plan.length, marcosPhone: marcosPhone(), groups: Object.values(groups) });
});
app.post('/api/handoffs/digest', (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Só o administrador');
  if (wa.status !== 'connected') throw httpError(400, 'Conecte o WhatsApp primeiro (aba Conexões)');
  if (digestRun.running) throw httpError(409, 'O envio já está em andamento');
  const plan = digestPlan(req.body || {}).filter((it) => it.toPhone);
  if (!plan.length) throw httpError(400, 'Nenhum cliente encaminhado para reenviar (ou falta o WhatsApp do Marcos em Prospectos → Regras)');
  Object.assign(digestRun, { running: true, total: plan.length, done: 0, failed: 0 });
  const counter = {};
  const totals = {};
  for (const it of plan) totals[it.toPhone] = (totals[it.toPhone] || 0) + 1;
  (async () => {
    for (const it of plan) {
      counter[it.toPhone] = (counter[it.toPhone] || 0) + 1;
      const quote = quotes.list.filter((q) => q.convKey === it.key || (it.lead && q.leadId === it.lead.id)).at(-1) || null;
      const text = digestMessage(it, { index: counter[it.toPhone], total: totals[it.toPhone], senderName: it.senderName || 'Marcos', quote });
      try {
        await wa.send(it.toPhone, { text, typing: false });
        if (quote && fs.existsSync(quotes.file(quote))) await wa.send(it.toPhone, { text: '', media: { path: quotes.file(quote), mimetype: 'application/pdf', fileName: `${quote.number}.pdf` }, typing: false });
        it.conv.digestSentAt = new Date().toISOString();
        if (it.lead) crm.addNote({ name: 'Sistema', role: 'admin' }, it.lead.id, `📌 Resumo reenviado para ${it.toName}`);
        digestRun.done++;
      } catch (e) {
        digestRun.failed++;
        store.addLog({ type: 'error', message: `Reenvio do encaminhamento (${it.name || it.phone}): ${e.message}` });
      }
      store.save();
      notify('digest', { ...digestRun });
      await sleep(randomBetween(15, 30) * 1000);
    }
    digestRun.running = false;
    store.addLog({ type: 'system', message: `📌 Encaminhamentos reenviados: ${digestRun.done} de ${digestRun.total}${digestRun.failed ? ` (${digestRun.failed} com erro)` : ''}` });
    notify('digest', { ...digestRun });
  })();
  res.json({ ...digestRun });
});
// Orçamentos: público (PDF pelo link) e pelo painel.
app.get('/orcamento/:id', (req, res) => {
  const q = quotes.get(req.params.id, req.query.t);
  if (!q || !fs.existsSync(quotes.file(q))) return res.status(404).send('Orçamento não encontrado');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${q.number}.pdf"`);
  res.sendFile(quotes.file(q));
});
// Ficha de dados pelo vendedor: link para o cliente só tocar e preencher (sem copiar e colar nada).
const fichaMessage = (name, url) => `${fichaPedido({ nome: name })}\n\n${url}`;
app.post('/api/closing/link', (req, res) => {
  const b = req.body || {};
  const phone = normalizePhone(b.phone);
  if (!phone) throw httpError(400, 'Informe o WhatsApp do cliente');
  if (!publicBase()) throw httpError(400, 'O sistema ainda não tem endereço na internet: ligue o acesso pela internet (aba Conexões) ou use a VPS, para o cliente conseguir abrir o link.');
  // A confirmação e o Pix saem do WhatsApp do próprio vendedor quando ele está conectado; senão, do número principal.
  const line = req.user.role !== 'admin' ? lines.byOwner(req.user.id) : null;
  const key = line && wa.isConnected?.(lineKey(line.id, `${phone}@s.whatsapp.net`)) ? lineKey(line.id, `${phone}@s.whatsapp.net`) : phone;
  let lead = crm.findForConversation({ key, phone }) || crm.ensureFromConversation({ key, phone, name: b.client, channel: 'whatsapp' });
  if (lead && req.user.role !== 'admin' && !lead.ownerId) crm.assign(req.user, lead.id, req.user.id);
  if (lead && !crm.canSee(req.user, lead)) throw httpError(403, 'Este cliente é de outro vendedor');
  if (lead && b.client && !lead.name) lead.name = String(b.client).trim();
  const f = closing.createForm({ convKey: key, lead, servico: b.servico || '', adultos: b.adults });
  const url = closing.formUrl(f);
  if (lead) crm.addNote(req.user, lead.id, '📝 Ficha de dados enviada ao cliente');
  res.json({ url, text: fichaMessage(b.client, url) });
});
// Cliente preencheu a ficha: refaz o último orçamento com o nome completo e manda o PDF.
closing.onFilled = async (f) => {
  if (!f.convKey) return;
  const lead = f.leadId ? crm.byId(f.leadId) : null;
  const last = quotes.list.filter((q) => (lead && q.leadId === lead.id) || (q.phone && f.data.whatsapp && samePhone(q.phone, normalizePhone(f.data.whatsapp) || ''))).at(-1);
  const items = last ? last.items.map((r) => ({ pacote: r.name, quantidade: r.qty })) : (lead?.interest && crm.matchPackage(lead.interest) ? [{ pacote: lead.interest, quantidade: Number(f.data.adultos) || 1 }] : null);
  if (!items) return;
  const owner = lead?.ownerId ? auth.get(lead.ownerId) : null;
  const q = quotes.create({
    items, adults: Number(f.data.adultos) || 1, client: f.data.nome, phone: normalizePhone(f.data.whatsapp) || lead?.phone || '',
    consultant: owner?.name || last?.consultant || '', leadId: lead?.id || null, convKey: f.convKey,
    parcels: last?.plan?.custom ? last.plan.parcels.map((x) => ({ pct: x.pct, date: x.date })) : null,
    createdBy: last?.createdBy || (owner ? { id: owner.id, name: owner.name } : null),
  });
  const text = `📄 Aqui está o seu orçamento ${q.number}, já com o seu nome completo.`;
  await wa.send(f.convKey, String(f.convKey).startsWith('ig:') ? { text: `${text} ${quoteLink(q)}`, typing: false } : { text, media: { path: quotes.file(q), mimetype: 'application/pdf', fileName: `${q.number}.pdf` }, typing: false });
  const conv = agent.conversation(f.convKey, { create: false });
  if (conv) agent.remember(conv, 'assistant', `${text} [PDF do orçamento enviado]`);
  // Ordem do Marcos: orçamento → documentos → formulário → contrato → Pix por último.
  // Com a ficha preenchida, o contrato sai sozinho para assinar pelo celular; o Pix vai depois da assinatura.
  const client = pickClient(f.data);
  if ((store.settings.closing?.contractFirst !== false || f.contractRequested || lead?.contractRequested) && publicBase() && contractReady(client)) {
    try {
      await sendContractTo({ convKey: f.convKey, lead, quote: q, client });
      return { contractSent: true };
    } catch (e) {
      store.addLog({ type: 'error', message: `Contrato automático: ${e.message}` });
    }
  }
  return null;
};
// Orçamentos: cada vendedor vê os dele; o administrador vê todos.
const quoteOffice = (q) => normOffice(q.office) || officeOfUser(auth.get(q.createdBy?.id));
const canSeeQuote = (user, q) => user.role === 'admin' || (sees(user, quoteOffice(q)) && (Boolean(user.officeAdmin) || q.createdBy?.id === user.id));
// Orçamento ativo, vendido, ou desativado (passou da validade sem virar venda): continua guardado com os dados do cliente, só deixa de contar como oferta ativa.
const quoteStatus = (q) => (sales.list.some((x) => x.quoteId === q.id && x.status !== 'cancelada') ? 'vendido' : q.validUntil < new Date().toISOString().slice(0, 10) ? 'desativado' : 'ativo');
const quoteView = (q) => ({
  id: q.id, number: q.number, client: q.client, phone: q.phone, consultant: q.consultant, total: q.plan.total, entry: q.plan.entry,
  items: q.items.map((r) => ({ name: r.name, qty: r.qty })), issued: q.issued, validUntil: q.validUntil, leadId: q.leadId,
  createdBy: q.createdBy?.name || '', createdAt: q.createdAt, custom: Boolean(q.plan.custom), hasContract: Boolean(q.contract), contractSigned: q.contract?.status === 'assinado', sale: sales.list.find((s) => s.quoteId === q.id && s.status !== 'cancelada')?.number || '',
  expired: q.validUntil < new Date().toISOString().slice(0, 10),
  status: quoteStatus(q),
  url: `/api/quotes/${q.id}/pdf`, publicUrl: quoteLink(q),
});
app.get('/api/quotes', (req, res) => {
  const term = String(req.query.q || '').toLowerCase().trim();
  const list = quotes.list.filter((q) => canSeeQuote(req.user, q) && inOffice(req, quoteOffice(q)))
    .filter((q) => !term || [q.number, q.client, q.phone, q.consultant].some((x) => String(x || '').toLowerCase().includes(term)))
    .filter((q) => { const f = String(req.query.status || 'ativos'); const st = quoteStatus(q); return f === 'todos' || (f === 'desativados' ? st === 'desativado' : st !== 'desativado'); })
    .slice(-300).reverse().map(quoteView);
  res.json(list);
});
// Cliente voltou: reativa o orçamento desativado por mais 7 dias (mesmos valores), sem criar outro.
app.post('/api/quotes/:id/reactivate', (req, res) => {
  const q = quotes.list.find((x) => x.id === req.params.id);
  if (!q || !canSeeQuote(req.user, q)) throw httpError(404, 'Orçamento não encontrado');
  if (quoteStatus(q) !== 'desativado') throw httpError(400, 'Este orçamento não está desativado');
  const days = Number(store.settings.quotes?.validityDays) || 7;
  const d = new Date(); d.setDate(d.getDate() + days);
  q.validUntil = d.toISOString().slice(0, 10);
  q.reactivatedAt = new Date().toISOString();
  store.save();
  audit.record({ user: req.user, ip: clientIp(req), action: 'alterou', entity: 'orçamento', label: `${q.number} reativado por ${days} dias (${q.client})` });
  res.json(quoteView(q));
});
// Prévia ao vivo (sem número, sem gravar).
app.post('/api/quotes/preview', (req, res) => {
  const b = req.body || {};
  const r = quotes.compute({ items: b.items, adults: b.adults, start: b.start, parcels: b.parcels, discountPct: b.discountPct });
  res.json({ ...r, text: quotes.message({ number: 'ORC-XXXX-XXXXX', items: r.items, plan: r.plan, validUntil: r.plan.start }).replace(/Válido até .*/, 'Válido por ' + (Number(store.settings.quotes?.validityDays) || 7) + ' dias') });
});
app.post('/api/quotes', async (req, res) => {
  const b = req.body || {};
  const lead = b.leadId ? crm.byId(b.leadId) : null;
  if (lead && !crm.canSee(req.user, lead)) throw httpError(403, 'Este cliente é de outro vendedor');
  // Só o administrador envia pelo WhatsApp principal; o vendedor baixa o PDF e manda do WhatsApp dele.
  const key = b.send && req.user.role === 'admin' && lead ? (lead.whatsappKey || lead.conversationKey || lead.phone || null) : null;
  if (b.send && req.user.role === 'admin' && !key) throw httpError(400, 'Escolha um cliente com WhatsApp para enviar');
  const q = quotes.create({
    items: b.items, adults: b.adults, client: b.client || lead?.name, phone: b.phone || lead?.phone || '',
    consultant: req.user.name, leadId: lead?.id || null, convKey: key, start: b.start, parcels: b.parcels, discountPct: b.discountPct,
    createdBy: { id: req.user.id, name: req.user.name },
  });
  if (key) {
    const text = quotes.message(q, quoteLink(q));
    await wa.send(key, { text, media: { path: quotes.file(q), mimetype: 'application/pdf', fileName: `${q.number}.pdf` }, typing: false });
  }
  if (lead) crm.addNote(req.user, lead.id, `🧾 Orçamento ${q.number} · R$ ${q.plan.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
  securityEvent('orcamento_criado', req.user, req, `${q.number} · ${q.client} · R$ ${q.plan.total}`);
  res.json({ ...quoteView(q), sent: Boolean(key), text: quotes.message(q, quoteLink(q)) });
});
// ---------- Contrato (preenchido com os dados do cliente e do orçamento) ----------
const CONTRACT_FIELDS = ['nome', 'nacionalidade', 'estadoCivil', 'profissao', 'rg', 'rgOrgao', 'cpf', 'cep', 'rua', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'whatsapp', 'email', 'acompanhantes'];
const contractDir = path.join(DATA_DIR, 'contratos');
const contractFile = (q) => path.join(contractDir, `CT-${q.number.replace(/^ORC-/, '')}.pdf`);
const pickClient = (src = {}) => {
  const out = Object.fromEntries(CONTRACT_FIELDS.map((k) => [k, String(src[k] ?? '').replace(/\s+/g, ' ').trim().slice(0, k === 'acompanhantes' ? 600 : 200)]));
  if (out.whatsapp && out.whatsapp.replace(/\D/g, '').length > 2) { const w = normalizePhone(out.whatsapp); if (w) out.whatsapp = `+${w}`; } // sempre com o código do país (55 do Brasil)
  return out;
};
// Dados já conhecidos: os do último contrato deste orçamento > a ficha que o cliente preencheu > o orçamento.
app.get('/api/quotes/:id/contract-data', (req, res) => {
  const q = quotes.list.find((x) => x.id === req.params.id);
  if (!q || !canSeeQuote(req.user, q)) throw httpError(404, 'Orçamento não encontrado');
  const lead = q.leadId ? crm.byId(q.leadId) : (q.phone ? crm.findForConversation({ phone: q.phone }) : null);
  const form = (lead && closing.forLead(lead.id)) || (q.convKey && closing.forConversation(q.convKey)) || null;
  const fromForm = form?.status === 'preenchida' ? form.data : {};
  res.json({ client: pickClient({ nome: q.client, whatsapp: q.phone ? `+${q.phone}` : '', ...fromForm, ...(q.contract?.client || {}) }), fromForm: Boolean(form?.status === 'preenchida'), hasContract: Boolean(q.contract), signed: q.contract?.status === 'assinado' });
});
// O vendedor cola a mensagem do cliente (copiada do WhatsApp): a IA separa nome, CPF, RG, endereço…
app.post('/api/contract/extract', async (req, res) => {
  const text = String(req.body?.text || '').slice(0, 6000);
  if (!text.trim()) throw httpError(400, 'Cole a mensagem do cliente com os dados');
  const found = {};
  const cpf = text.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/);
  if (cpf) found.cpf = cpf[0];
  const cep = text.match(/\b\d{5}-?\d{3}\b/);
  if (cep) found.cep = cep[0];
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  if (email) found.email = email[0];
  if (llm.configured) {
    try {
      const reply = await llm.chat({ tools: [], messages: [
        { role: 'system', content: `Extraia os dados pessoais do texto que o cliente mandou no WhatsApp, para preencher um contrato. Responda só com JSON com estas chaves (string vazia quando não houver): ${CONTRACT_FIELDS.join(', ')}. "acompanhantes" = outras pessoas que vão no processo (nome e parentesco). Copie exatamente o que está escrito; não invente nada.` },
        { role: 'user', content: text },
      ] });
      Object.assign(found, Object.fromEntries(Object.entries(parseJsonObject(reply?.content) || {}).filter(([k, v]) => CONTRACT_FIELDS.includes(k) && String(v || '').trim())));
    } catch (e) {
      store.addLog({ type: 'error', message: `Extrair dados do contrato: ${e.message}` });
    }
  }
  res.json({ client: pickClient(found), ai: llm.configured });
});
// Assinatura da empresa (CONTRATADA) nos contratos: src/routes/assinatura-contratada.js
const contractorSigner = makeContractorSigner({ store, dataDir: DATA_DIR, needAdmin: (r) => needAdmin(r), httpError: (...x) => httpError(...x), securityEvent: (...x) => securityEvent(...x), notifyAdmins: (t) => notifyAdmins(t), onChange: () => { const d = refreshUnsignedContracts(); store.addLog({ type: 'system', message: `Assinatura da empresa atualizada: ${d.contracts} contrato(s) ainda não assinados pelo cliente foram refeitos; ${d.signedKept} já assinados ficaram como estavam.` }); } });
contractorSigner.register(app);
// Refaz os PDFs dos contratos que AINDA NÃO foram assinados pelo cliente (e, se pedido, os de orçamento): assim o texto novo e a assinatura da empresa
// aparecem em todo contrato emitido. Contrato assinado pelo cliente nunca é alterado (é o que ele leu e assinou).
function refreshUnsignedContracts({ withQuotes = false } = {}) {
  const done = { quotes: 0, contracts: 0, signedKept: 0, failed: 0 };
  for (const q of quotes.list) {
    try {
      if (withQuotes) { fs.mkdirSync(quotes.dir, { recursive: true }); fs.writeFileSync(quotes.file(q), quotes.pdf(q)); done.quotes += 1; }
      if (q.contract?.status === 'assinado') { done.signedKept += 1; continue; }
      if (q.contract?.client?.nome && fs.existsSync(contractFile(q))) {
        fs.writeFileSync(contractFile(q), contractPdf({ client: q.contract.client, quote: q, cfg: store.settings.contract || {}, issued: String(q.contract.at || '').slice(0, 10) || undefined, contractors: contractorSigner.contractorSigns() }));
        done.contracts += 1;
      }
    } catch { done.failed += 1; }
  }
  return done;
}
// Regra nova de vencimento das parcelas (valores iguais): refaz, uma vez, os PDFs de orçamento e os contratos não assinados.
if (!store.data.termsPdf2026) {
  const done = refreshUnsignedContracts({ withQuotes: true });
  store.data.termsPdf2026 = true;
  store.save();
  store.addLog({ type: 'system', message: `Nova regra de vencimento das parcelas aplicada: ${done.quotes} orçamento(s) e ${done.contracts} contrato(s) não assinados refeitos; ${done.signedKept} contrato(s) já assinados mantidos como estavam${done.failed ? `; ${done.failed} falharam` : ''}.` });
}
app.post('/api/quotes/:id/contract', (req, res) => {
  const q = quotes.list.find((x) => x.id === req.params.id);
  if (!q || !canSeeQuote(req.user, q)) throw httpError(404, 'Orçamento não encontrado');
  const client = pickClient(req.body?.client || {});
  if (!client.nome) throw httpError(400, 'Informe o nome completo do contratante');
  if (q.contract?.status === 'assinado') throw httpError(400, 'Este contrato já foi assinado pelo cliente e não pode ser alterado. Para mudar algo, faça um novo orçamento.');
  setAgreedPix(q, req.body?.pixAmount, req.user.name);
  fs.mkdirSync(contractDir, { recursive: true });
  fs.writeFileSync(contractFile(q), contractPdf({ client, quote: q, cfg: store.settings.contract || {}, contractors: contractorSigner.contractorSigns() }));
  q.contract = { ...(q.contract || {}), client, at: new Date().toISOString(), by: req.user.name, status: q.contract?.status || 'gerado' };
  store.save();
  if (q.leadId) crm.addNote(req.user, q.leadId, `📝 Contrato CT-${q.number.replace(/^ORC-/, '')} gerado`);
  securityEvent('contrato_gerado', req.user, req, `CT-${q.number.replace(/^ORC-/, '')} · ${client.nome}`);
  res.json({ ok: true, url: `/api/quotes/${q.id}/contract.pdf` });
});
// ---------- Contrato assinado pelo celular ----------
const contractToken = (id) => crypto.createHmac('sha256', auth.secret).update(`ct:${id}`).digest('base64url').slice(0, 20);
const contractSignUrl = (q) => (publicBase() ? `${publicBase()}/contrato/${q.id}?t=${contractToken(q.id)}` : '');
const signedFile = (q) => path.join(contractDir, `CT-${q.number.replace(/^ORC-/, '')}-assinado.pdf`);
function publicContract(req) {
  const q = quotes.list.find((x) => x.id === req.params.id);
  const t = String(req.query.t || '');
  const ok = q && q.contract && t.length === 20 && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(contractToken(q.id)));
  if (!ok) throw httpError(404, 'Link inválido ou contrato não encontrado. Peça um novo link no WhatsApp.');
  return q;
}
/** Gera o contrato (se ainda não existe) e devolve o link e a mensagem para o cliente assinar. */
function prepareContractSign(q, client, user) {
  if (!publicBase()) throw httpError(400, 'O sistema ainda não tem endereço na internet (aba Conexões → criar endereço, ou a VPS).');
  if (client) {
    fs.mkdirSync(contractDir, { recursive: true });
    fs.writeFileSync(contractFile(q), contractPdf({ client, quote: q, cfg: store.settings.contract || {}, contractors: contractorSigner.contractorSigns() }));
    q.contract = { ...(q.contract || {}), client, at: new Date().toISOString(), by: user?.name || 'Sistema', status: 'enviado', signedAt: null };
    store.save();
  }
  if (!q.contract?.client?.nome) throw httpError(400, 'Gere o contrato com os dados do cliente primeiro.');
  const url = contractSignUrl(q);
  const first = q.contract.client.nome.split(' ')[0];
  const ct = `CT-${q.number.replace(/^ORC-/, '')}`;
  return { url, text: `${first}, preparei o seu contrato (${ct}) com os seus dados e as condições combinadas. É só tocar no link, ler com calma e assinar pelo celular mesmo, com o dedo:\n\n${url}\n\nNo final, você recebe aqui a sua via assinada. Qualquer dúvida, me chama. 😊` };
}
// REGRA: todo contrato que vai para o cliente leva junto o Pix do combinado (src/contract-pix.js).
const contractPix = makeContractPix({ store, payments, wa, agent, crm, httpError: (...x) => httpError(...x) });
const { sendContractPix, setAgreedPix } = contractPix;
// ---------- Contrato automático pela atendente de IA ----------
const contractFlow = makeContractFlow({
  store, crm, closing, auth, lines, parseLineKey, samePhone, pickClient, publicBase,
  quotes: () => quotes.list,
  prepare: (q, client) => prepareContractSign(q, client, { name: 'IA' }),
  afterSend: (q, client) => sendContractPix(q, { client, by: 'IA' }),
  makeQuote: (args) => sendQuote(args),
  say: async (convKey, text) => {
    await wa.send(convKey, { text, typing: false });
    const conv = agent.conversation(convKey, { create: false });
    if (conv) agent.remember(conv, 'assistant', text);
  },
  audit: (text) => securityEvent('contrato_enviado', { name: 'IA (atendente)' }, null, text),
});
const sendContractTo = contractFlow.sendContractTo;
agent.sendContract = contractFlow.sendContract;
// Atalho "/contrato" digitado pelo consultor no WhatsApp dele, na conversa do cliente.
const sellerCommands = makeSellerCommands({
  agent, llm, contractFlow,
  packages: () => [...(store.settings.crm?.packages || []), ...serviceCatalog.activeNames()],
  say: async (convKey, text) => { await wa.send(convKey, { text, typing: false }); const c = agent.conversation(convKey, { create: false }); if (c) agent.remember(c, 'assistant', text); },
  tell: async (owner, text) => {
    if (owner?.whatsapp) return wa.send(owner.whatsapp, { text, typing: false });
    store.addLog({ type: 'error', message: `Atalho: não sei para qual número mandar a resposta (cadastre o WhatsApp do Marcos em Configurações). ${text.slice(0, 120)}` });
  },
  revoke: (jid, id) => wa.revoke(jid, id),
  // Quem digitou: o dono da linha (consultor) ou, no número principal, o administrador.
  // A resposta do atalho vai para o dono do número (Marcos ou o próprio número conectado, na conversa "Você"); nunca para o cliente.
  ownerOf: (msg) => { const l = parseLineKey(msg.jid); const u = l ? auth.get(lines.get(l.id)?.ownerId) : null; return u || { name: 'Administração', role: 'admin', whatsapp: marcosPhone() }; },
  sendQuote: (conv, args) => agent.sendQuote(conv, args),
  sendForm: (conv, args) => agent.sendForm(conv, args),
  setHandoff: (key, value, reason) => agent.setHandoff(key, value, reason),
  addTask: (user, body) => tasks.add(user, body),
  contractSummary: (phone) => contractCards.summarizeFor(phone),
  digest: () => alerts.digestText(alerts.build({ user: { role: 'admin' } })),
  health: () => { const h = healthReport(); return `*Saúde do sistema*\n${h.tips.map((t) => `${{ ok: '✅', warn: '⚠️', bad: '🔴' }[t.level] || '•'} ${t.text}`).join('\n')}`; },
  audit: (text) => securityEvent('atalho_whatsapp', { name: 'Atalho no WhatsApp' }, null, text),
});
app.post('/api/quotes/:id/contract/sign-link', async (req, res) => {
  const q = quotes.list.find((x) => x.id === req.params.id);
  if (!q || !canSeeQuote(req.user, q)) throw httpError(404, 'Orçamento não encontrado');
  setAgreedPix(q, req.body?.pixAmount, req.user.name);
  const r = prepareContractSign(q, req.body?.client ? pickClient(req.body.client) : null, req.user);
  let sent = false;
  let pix = null;
  if (req.body?.send && q.convKey && (wa.isConnected ? wa.isConnected(q.convKey) : wa.status === 'connected')) {
    await wa.send(q.convKey, { text: r.text, typing: false });
    const conv = agent.conversation(q.convKey, { create: false });
    if (conv) agent.remember(conv, 'assistant', r.text);
    sent = true;
    pix = await sendContractPix(q, { client: q.contract?.client, by: req.user.name });
  }
  if (q.leadId) crm.addNote(req.user, q.leadId, `✍️ Contrato enviado para assinatura pelo celular${pix?.sent ? ` · Pix de ${pix.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} enviado junto` : ''}`);
  res.json({ ...r, sent, pix });
});
app.get('/contrato/:id', sitePage('contrato'));
app.get('/api/public/contrato/:id', (req, res) => {
  const q = publicContract(req);
  const t = contractToken(q.id);
  res.json({
    status: q.contract.status === 'assinado' ? 'assinado' : 'enviado',
    number: `CT-${q.number.replace(/^ORC-/, '')}`,
    nome: q.contract.client.nome,
    askCpf: Boolean(q.contract.client.cpf),
    total: q.plan.total, entry: q.plan.entry,
    items: q.items.map((r) => `${r.name} × ${r.qty}`),
    pdf: `/api/public/contrato/${q.id}/pdf?t=${t}`,
    company: (store.settings.contract || {}).company || 'MIGRA ASESORIA PARAGUAY E.A.S.',
  });
});
app.get('/api/public/contrato/:id/pdf', (req, res) => {
  const q = publicContract(req);
  const file = q.contract.status === 'assinado' && fs.existsSync(signedFile(q)) ? signedFile(q) : contractFile(q);
  if (!fs.existsSync(file)) throw httpError(404, 'Contrato não encontrado');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Contrato CT-${q.number.replace(/^ORC-/, '')}.pdf"`);
  res.sendFile(file);
});
app.post('/api/public/contrato/:id/assinar', async (req, res) => {
  const q = publicContract(req);
  const b = req.body || {};
  const c = q.contract;
  if (c.status === 'assinado') return res.json({ ok: true, already: true });
  const norm = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!b.aceite) throw httpError(400, 'Marque que leu e concorda com o contrato.');
  if (!['sim', 'nao'].includes(b.imagem)) throw httpError(400, 'Escolha se autoriza ou não o uso de imagem (cláusula nona).');
  if (norm(b.nome) !== norm(c.client.nome)) throw httpError(400, 'Digite o seu nome completo igual ao do contrato.');
  if (c.client.cpf && String(b.cpf || '').replace(/\D/g, '') !== String(c.client.cpf).replace(/\D/g, '')) throw httpError(400, 'O CPF não confere com o do contrato.');
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(b.assinatura || ''));
  const sig = m ? Buffer.from(m[1], 'base64') : null;
  if (!sig || sig.length < 1500 || sig.length > 800_000) throw httpError(400, 'Faça a sua assinatura no quadro, por favor.');
  const signedAt = new Date().toISOString();
  const meta = clientMeta(req);
  const hash = crypto.createHash('sha256').update(JSON.stringify({ n: q.number, c: c.client, t: q.plan.total, p: q.plan.parcels, at: signedAt })).update(sig).digest('hex');
  const sign = { image: sig, signedAt, ip: meta.ip || '', ua: String(meta.ua || '').slice(0, 300), hash, imageConsent: b.imagem };
  fs.writeFileSync(signedFile(q), contractPdf({ client: c.client, quote: q, cfg: store.settings.contract || {}, issued: c.at?.slice(0, 10), sign, contractors: contractorSigner.contractorSigns() }));
  fs.writeFileSync(path.join(contractDir, `assinatura-${q.id}.jpg`), sig);
  Object.assign(c, { status: 'assinado', signedAt, ip: sign.ip, ua: sign.ua, hash, imageConsent: b.imagem });
  store.save();
  const ct = `CT-${q.number.replace(/^ORC-/, '')}`;
  const media = { path: signedFile(q), mimetype: 'application/pdf', fileName: `Contrato ${ct} assinado.pdf` };
  // Via do cliente no WhatsApp (na conversa dele) e aviso para o vendedor e o Marcos.
  const key = q.convKey || (q.phone ? q.phone : null);
  if (key) {
    const text = `Contrato assinado, ${c.client.nome.split(' ')[0]}! ✍️ Segue a sua via. Ele passa a valer com a confirmação do pagamento da entrada.`;
    await wa.send(key, String(key).startsWith('ig:') ? { text, typing: false } : { text, media, typing: false }).catch(() => {});
    const conv = agent.conversation(key, { create: false });
    if (conv) agent.remember(conv, 'assistant', `${text} [PDF do contrato assinado]`);
  }
  // Pix por último: assim que o cliente assina o contrato, vai o Pix da reserva.
  const form = (q.leadId && closing.forLead(q.leadId)) || (q.convKey && closing.forConversation(q.convKey)) || null;
  if (form?.viaContract && !form.paymentId) {
    await closing.sendReservationPix(form, { intro: 'Agora o último passo: para garantir a sua reserva' }).catch((e) => store.addLog({ type: 'error', message: `Pix depois do contrato: ${e.message}` }));
  }
  const notice = `✍️ *Contrato assinado pelo cliente*\n👤 ${c.client.nome}${c.client.cpf ? ` · CPF ${c.client.cpf}` : ''}\n📄 ${ct} · R$ ${q.plan.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n🕒 ${new Date(signedAt).toLocaleString('pt-BR')}\nO PDF assinado está no painel (Orçamentos → Contrato).`;
  const seller = q.createdBy?.id ? auth.get(q.createdBy.id) : null;
  if (seller?.whatsapp && seller.role !== 'admin' && wa.status === 'connected') await wa.send(seller.whatsapp, { text: notice, media, typing: false }).catch(() => {});
  await notifyAdmins(notice).catch(() => {});
  if (q.leadId) crm.addNote({ name: 'Cliente', role: 'admin' }, q.leadId, `✍️ Contrato ${ct} assinado pelo cliente (código ${hash.slice(0, 10).toUpperCase()})`);
  notify('crm', { id: q.leadId });
  res.json({ ok: true });
});
app.get('/api/quotes/:id/contract.pdf', (req, res) => {
  const q = quotes.list.find((x) => x.id === req.params.id);
  if (!q || !canSeeQuote(req.user, q) || !fs.existsSync(contractFile(q))) throw httpError(404, 'Contrato não encontrado: gere o contrato primeiro');
  const signed = q.contract?.status === 'assinado' && fs.existsSync(signedFile(q));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="Contrato CT-${q.number.replace(/^ORC-/, '')}${signed ? ' assinado' : ''}.pdf"`);
  res.sendFile(signed ? signedFile(q) : contractFile(q));
});
// ---------- Fechamento pela conversa: cada etapa num botão (sai do WhatsApp da própria conversa) ----------
function closingContext(user, key) {
  if (!canSeeConv(user, key)) throw httpError(403, 'Esta conversa é de outro vendedor');
  const conv = agent.conversation(key, { create: false });
  if (!conv) throw httpError(404, 'Conversa não encontrada');
  const lead = crm.findForConversation({ key, phone: conv.phone, username: conv.username })
    || crm.ensureFromConversation({ key, phone: conv.phone, name: conv.name, username: conv.username, channel: String(key).startsWith('ig:') ? 'instagram' : 'whatsapp' });
  const form = (lead && closing.forLead(lead.id)) || closing.forConversation(key) || null;
  const quote = quotes.list.filter((q) => q.convKey === key || (lead && q.leadId === lead.id) || (conv.phone && q.phone && samePhone(q.phone, conv.phone))).at(-1) || null;
  const pay = (store.data.payments || []).filter((x) => x.convKey === key || (lead && x.leadId === lead.id)).at(-1) || null;
  return { conv, lead, form, quote, pay };
}
const sayTo = async (conv, text, media) => {
  await wa.send(conv.key, { text, ...(media && !String(conv.key).startsWith('ig:') ? { media } : {}), typing: false });
  agent.remember(conv, 'assistant', media ? `${text} [arquivo enviado]` : text);
};
app.get('/api/conversations/:key/closing', (req, res) => {
  const { form, quote, pay } = closingContext(req.user, req.params.key);
  res.json({
    quote: quote ? { number: quote.number, total: quote.plan.total } : null,
    ficha: form ? form.status : null,
    pix: pay ? pay.status : null,
    contract: quote?.contract ? (quote.contract.status === 'assinado' ? 'assinado' : quote.contract.status === 'enviado' ? 'enviado' : 'gerado') : null,
    term: form?.term?.status || null,
    paid: pay?.status === 'paid',
    admin: req.user.role === 'admin',
  });
});
app.post('/api/conversations/:key/closing/:action', async (req, res) => {
  const { conv, lead, form, quote, pay } = closingContext(req.user, req.params.key);
  const act = req.params.action;
  const first = (conv.name || lead?.name || '').split(' ')[0];
  const filled = form?.status === 'preenchida' ? form.data : null;
  if (act === 'quote') {
    if (!quote) throw httpError(400, 'Ainda não há orçamento para este cliente. Faça na aba Orçamentos com o WhatsApp dele.');
    await sayTo(conv, quotes.message(quote, quoteLink(quote)), { path: quotes.file(quote), mimetype: 'application/pdf', fileName: `${quote.number}.pdf` });
  } else if (act === 'ficha') {
    if (!publicBase()) throw httpError(400, 'O sistema ainda não tem endereço na internet (aba Conexões → criar endereço, ou a VPS).');
    const f = closing.createForm({ convKey: conv.key, lead, servico: quote ? quote.items.map((r) => `${r.name} × ${r.qty}`).join(', ') : '' });
    await sayTo(conv, fichaMessage(first, closing.formUrl(f)));
  } else if (act === 'contract') {
    if (!quote) throw httpError(400, 'Faça primeiro o orçamento deste cliente (aba Orçamentos).');
    if (quote.contract?.status === 'assinado') throw httpError(400, 'Este contrato já foi assinado pelo cliente. A via assinada está em Orçamentos → Contrato.');
    const client = filled ? pickClient(filled) : quote.contract?.client;
    if (!client?.nome) throw httpError(400, 'O cliente ainda não preencheu a ficha. Envie a ficha, ou gere o contrato na aba Orçamentos colando os dados dele.');
    if (!quote.convKey) quote.convKey = conv.key;
    const r = prepareContractSign(quote, client, req.user);
    await sayTo(conv, r.text);
    securityEvent('contrato_enviado', req.user, req, `CT-${quote.number.replace(/^ORC-/, '')} · ${client.nome}`);
    const pixOut = await sendContractPix(quote, { client, by: req.user.name });
    if (!pixOut.sent && pixOut.why && !/já|desligado/.test(pixOut.why)) crm.addNote(req.user, lead.id, `⚠️ O Pix não saiu junto com o contrato: ${pixOut.why}. Envie o Pix pelo botão.`);
  } else if (act === 'pix') {
    const c = store.settings.payments || {};
    if (c.enabled === false || !(c.pixKey || c.mercadopago?.accessToken)) throw httpError(400, 'O Pix não está configurado (Configurações → Pagamentos).');
    const adults = Number(filled?.adultos) || quote?.plan?.adults || lead?.people || 1;
    const p = await payments.create({ convKey: conv.key, leadId: lead?.id || null, amount: payments.reservationAmount(adults), description: `${c.reservation?.description || 'reserva'} - ${adults} adulto(s)`, payerName: filled?.nome || '', payerDoc: filled?.cpf || '', payerPhone: filled?.whatsapp || conv.phone || lead?.phone || '', by: req.user.name });
    if (form) { form.paymentId = p.id; store.save(); }
    await payments.sendCharge(p);
    agent.remember(conv, 'assistant', `[Pix de ${p.amount} enviado: QR Code e código copia e cola]`);
  } else if (act === 'term') {
    if (!filled) throw httpError(400, 'O termo usa os dados da ficha: o cliente precisa preencher a ficha antes.');
    await closing.sendTerm(form);
  } else if (act === 'plan') {
    const pkg = quote?.items?.[0]?.name || lead?.interest;
    const r = await sendPaymentPlan({ convKey: conv.key, lead, packageName: pkg, people: quote?.plan?.people || lead?.people || 1, adults: quote?.plan?.adults });
    if (r.erro) throw httpError(400, r.erro);
  } else if (act === 'paid') {
    if (!pay || pay.status === 'paid') throw httpError(400, pay ? 'Este Pix já está confirmado e o recibo já foi enviado.' : 'Ainda não há Pix gerado para este cliente.');
    if (req.user.role === 'admin') {
      await payments.confirm(pay.id, { by: req.user.name, userId: req.user.id }); // manda o recibo ao cliente
    } else {
      await notifyAdmins(`💰 *${req.user.name} informa que o cliente pagou*\n👤 ${conv.name || lead?.name || ''} · +${conv.phone || ''}\nPix de R$ ${pay.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n\nConfira o extrato e confirme em *Pagamentos*: o recibo sai sozinho para o cliente.`);
      if (lead) crm.addNote(req.user, lead.id, '💰 Vendedor informou que o cliente pagou o Pix (aguardando confirmação do administrador)');
    }
  } else {
    throw httpError(400, 'Ação desconhecida');
  }
  notify('crm', { id: lead?.id });
  res.json({ ok: true });
});
// ---------- Contratos e vendas ----------
const lotStock = () => realty.listDevelopments().map((d) => ({ name: d.name, ...d.summary }));
app.get('/api/sales', (req, res) => res.json(sales.listFor(req.user, req.query).filter((s) => inOffice(req, sales.officeOf(s)))));
app.get('/api/sales/summary', (req, res) => {
  const out = sales.summary(req.user, { ...req.query, office: req.office !== 'all' ? req.office : '' });
  if (req.user.role === 'admin') out.stock = lotStock();
  out.defaultPct = Number(store.settings.sales?.commissionPct) || 0;
  out.affiliateSellerPct = store.settings.sales?.affiliateSellerPct ?? null;
  res.json(out);
});
app.get('/api/sales/:id', (req, res) => {
  const s = sales.get(req.params.id);
  if (!s || !sales.canSee(req.user, s)) throw httpError(404, 'Venda não encontrada');
  res.json(sales.view(s));
});
app.post('/api/quotes/:id/sale', (req, res) => {
  const q = quotes.list.find((x) => x.id === req.params.id);
  if (!q || !canSeeQuote(req.user, q)) throw httpError(404, 'Orçamento não encontrado');
  const sale = sales.fromQuote(q, { by: req.user, sellerId: req.user.role === 'admin' ? (req.body?.sellerId || q.createdBy?.id || null) : req.user.id });
  if (q.leadId && crm.byId(q.leadId)?.stage !== 'ganho') {
    try { crm.setStage(req.user, crm.byId(q.leadId), { stage: 'ganho', closedValue: q.plan.total }); store.save(); } catch { /* o funil segue como está */ }
  }
  securityEvent('venda_lancada', req.user, req, `${sale.number} · ${sale.client.nome} · R$ ${sale.total}`);
  res.json(sales.view(sale));
});
app.post('/api/sales/:id/parcel/:index', (req, res) => {
  const s = sales.setParcel(req.user, req.params.id, req.params.index, req.body || {});
  securityEvent('venda_parcela', req.user, req, `${s.number} · ${s.parcels[Number(req.params.index)]?.label} · ${req.body?.paid === false ? 'desfeito' : 'recebido'}`);
  res.json(sales.view(s));
});
// O vendedor avisa que o cliente pagou (entrada ou parcela): o administrador é avisado na hora no WhatsApp e confirma com um clique.
app.post('/api/sales/:id/parcel/:index/claim', (req, res) => {
  const s = sales.claimParcel(req.user, req.params.id, req.params.index, req.body || {});
  const p = s.parcels[Number(req.params.index)];
  if (!req.body?.undo && p?.claim) {
    notifyAdmins(`💰 *${req.user.name} avisou um pagamento*\n👤 ${s.client?.nome || 'Cliente'}\n🧾 ${s.number} · ${p.label}\n💵 R$ ${Number(p.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${p.claim.method}, ${p.claim.date.split('-').reverse().join('/')})\n\nConfira se o valor caiu e confirme no painel (Contratos e vendas → abrir a venda → Confirmar recebimento).`).catch(() => {});
  }
  securityEvent('venda_parcela_informada', req.user, req, `${s.number} · ${p?.label} · ${req.body?.undo ? 'aviso retirado' : 'pagamento informado'}`);
  res.json(sales.view(s));
});
app.post('/api/sales/:id/commission', (req, res) => {
  const s = sales.setCommission(req.user, req.params.id, req.body || {});
  securityEvent('comissao_alterada', req.user, req, `${s.number} · ${s.commission.pct}% · R$ ${s.commission.value} · ${s.commission.status}`);
  res.json(sales.view(s));
});
app.post('/api/sales/:id/seller', (req, res) => res.json(sales.view(sales.setSeller(req.user, req.params.id, req.body?.sellerId))));
app.post('/api/sales/:id/cancel', (req, res) => {
  const s = sales.cancel(req.user, req.params.id, req.body?.reason);
  securityEvent('venda_cancelada', req.user, req, `${s.number} · ${req.body?.reason || ''}`);
  res.json(sales.view(s));
});
// ---------- Controle de caixa (só administradores liberados) ----------
// Venda só de serviços contábeis (categoria "Contábil" no catálogo) entra no caixa da Migra Contábil Paraguay.
const cashBookOfSale = (sale) => {
  if (sale?.cashBook === 'contabil' || sale?.cashBook === 'migra') return sale.cashBook;
  const names = (sale?.items || []).map((i) => i.name).filter(Boolean);
  return names.length && names.every((n) => serviceCatalog.categoryOf(n) === 'contabil') ? 'contabil' : 'migra';
};
const migratech = new Migratech({ store });
const contabil = new Contabil({ store });
const appSignups = new AppSignups({ store });
const cash = new Cash({ store, auth, payments, sales, affiliates, bookOfSale: cashBookOfSale, extraAutomatic: () => [...migratech.cashEntries(), ...contabil.cashEntries()] });
const nina = new Nina({
  store, auth, cash, llm,
  stt: new FallbackStt(new HttpStt({ url: process.env.STT_URL }), new GeminiStt({ getConfig: agentConfig })),
  tts: new ChoiceTts({ gemini: new GeminiTts({ getConfig: agentConfig }), local: new HttpTts({ url: process.env.TTS_URL }) }),
  send: (jid, payload) => wa.send(jid, payload),
  downloadAudio: (m) => wa.downloadAudio(m),
  audit: (text) => securityEvent('caixa_nina', 'Nina', null, text),
  log: (l) => store.addLog(l),
});
// Contrato em PDF de uma venda: o assinado se existir, senão o gerado (nunca cria nada novo aqui).
const mariaContracts = {
  packages: () => [...(store.settings.crm?.packages || []).map((p) => p.name || p), ...serviceCatalog.activeNames()].filter(Boolean),
  fields: CONTRACT_FIELDS,
  required: CONTRACT_REQUIRED,
  ready: contractReady,
  // Orçamento recente (30 dias) do mesmo cliente que ainda não foi assinado: reaproveita em vez de criar outro.
  findQuote: (viewer, { nome = '', phone = '' }) => {
    const since = Date.now() - 30 * 86_400_000;
    const open = quotes.list.filter((q) => canSeeQuote(viewer, q) && q.contract?.status !== 'assinado' && Date.parse(q.createdAt) >= since);
    return findRecentQuote(open, { nome, phone, samePhone, normalizePhone });
  },
  createQuote: ({ pacote, pessoas, adultos, itens = null, desconto = 0, nome, telefone, user, leadId = null }) => quotes.create({
    items: Array.isArray(itens) && itens.length ? itens : [{ pacote, quantidade: pessoas }], adults: adultos, discountPct: desconto, client: nome, phone: normalizePhone(telefone) || '', leadId,
    consultant: String(user.name || '').split(' ')[0], createdBy: { id: user.id, name: user.name },
  }),
  // Quem pode ser o cliente do contrato: leads, fichas preenchidas e orçamentos que a pessoa enxerga, os últimos atendimentos primeiro.
  candidates: (viewer, user, { nome = '', phone = '' }) => {
    const fold = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const n = fold(nome); const ph = normalizePhone(phone) || '';
    const match = (nm, tel) => (ph ? Boolean(tel) && samePhone(tel, ph) : Boolean(n) && fold(nm).includes(n));
    const found = new Map();
    const add = (c) => {
      if (!match(c.nome, c.telefone)) return;
      const tel = normalizePhone(c.telefone) || '';
      const key = tel ? `p:${tel.slice(-9)}` : c.leadId ? `l:${c.leadId}` : `n:${fold(c.nome)}`;
      const prev = found.get(key);
      if (!prev) { found.set(key, { ...c, telefone: tel }); return; }
      if (Date.parse(c.lastAt) > Date.parse(prev.lastAt)) prev.lastAt = c.lastAt;
      if ((c.nome || '').length > (prev.nome || '').length) prev.nome = c.nome;
      prev.leadId ||= c.leadId; prev.formId ||= c.formId; prev.quoteId ||= c.quoteId;
    };
    for (const l of crm.list(viewer, { q: ph || nome })) {
      const conv = l.conversationKey ? agent.conversation(l.conversationKey, { create: false }) : null;
      const last = [l.updatedAt, conv?.updatedAt].filter(Boolean).sort().at(-1);
      add({ nome: l.name, telefone: l.phone || '', lastAt: last, leadId: l.id });
    }
    for (const f of closing.list) {
      if (f.status !== 'preenchida') continue;
      const lead = f.leadId ? crm.byId(f.leadId) : null;
      const mine = viewer.role === 'admin' || f.requesterId === user.id || (lead && crm.canSee(viewer, lead));
      if (mine) add({ nome: f.data?.nome, telefone: f.data?.whatsapp || '', lastAt: f.filledAt || f.createdAt, leadId: f.leadId || null, formId: f.id });
    }
    const since = Date.now() - 60 * 86_400_000;
    for (const q of quotes.list) {
      if (!canSeeQuote(viewer, q) || q.contract?.status === 'assinado' || Date.parse(q.createdAt) < since) continue;
      add({ nome: q.client, telefone: q.phone || '', lastAt: q.createdAt, leadId: q.leadId || null, quoteId: q.id });
    }
    return [...found.values()].sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt));
  },
  // Link da ficha de dados para a RESERVA (cliente presencial): volta para quem pediu; nada é enviado ao cliente.
  reservationLink: ({ user, viewer, nome = '', telefone = '', adultos = null }) => {
    const lead = nome || telefone ? mariaContracts.registerLead({ user, viewer, nome, telefone, interesse: 'Reserva', pessoas: adultos || 1 }).lead : null;
    const f = closing.createForm({ convKey: lead?.conversationKey || null, lead, servico: 'Reserva', adultos });
    f.noAuto = true;
    f.requesterId = user.id;
    store.save();
    return { url: closing.formUrl(f), leadId: lead?.id || null, formId: f.id };
  },
  clientFor: (q, { nome = '', telefone = '', dados = {}, formId = null, leadId = null }) => {
    const byId = (id) => (id ? closing.list.find((f) => f.id === id) : null);
    const filled = [byId(q.mariaFormId), byId(formId), leadId ? closing.forLead(leadId) : null].find((f) => f?.status === 'preenchida');
    const form = filled || byId(q.mariaFormId);
    const fromForm = form?.status === 'preenchida' ? form.data : {};
    return pickClient({ whatsapp: telefone ? `+${normalizePhone(telefone) || telefone}` : '', ...fromForm, ...(q.contract?.client || {}), ...dados, nome: dados.nome || fromForm.nome || q.contract?.client?.nome || nome });
  },
  // Gera o PDF do contrato e o link de assinatura. NADA é enviado ao cliente: tudo volta para quem pediu.
  prepare: (q, client, user) => {
    const r = prepareContractSign(q, client, user);
    const ct = `CT-${q.number.replace(/^ORC-/, '')}`;
    return { url: r.url, ct, buffer: fs.readFileSync(contractFile(q)), name: `Contrato ${ct}.pdf` };
  },
  // Ficha de dados sem conversa de cliente: quem pediu encaminha o link (ou preenche). Não dispara Pix nem mensagem ao cliente.
  formLink: (q, { nome = '', telefone = '', dados = {}, user, lead = null }) => {
    let f = q.mariaFormId ? closing.list.find((x) => x.id === q.mariaFormId) : null;
    if (!f || f.term?.status === 'assinado') {
      f = closing.createForm({ convKey: lead?.conversationKey || null, lead, servico: q.items.map((r) => `${r.name} × ${r.qty}`).join(', '), adultos: q.plan?.adults });
      q.mariaFormId = f.id;
    }
    f.noAuto = true;
    f.requesterId = user.id;
    f.quoteId = q.id;
    const known = { nome, ...(telefone ? { whatsapp: `+${normalizePhone(telefone) || telefone}` } : {}), ...Object.fromEntries(Object.entries(dados).filter(([k, v]) => v && CONTRACT_FIELDS.includes(k))) };
    for (const [k, v] of Object.entries(known)) if (v && !f.data[k]) f.data[k] = String(v).slice(0, 200);
    store.save();
    return { url: closing.formUrl(f), filled: f.status === 'preenchida' };
  },
  summary: (q) => ({ number: q.number, items: q.items.map((r) => `${r.name}${r.qty > 1 ? ` × ${r.qty}` : ''}`).join(', '), discountPct: q.plan.discountPct || 0, subtotal: q.plan.subtotal ?? q.plan.total, total: q.plan.total, entry: q.plan.entry, parcels: q.plan.parcels?.length || 0, url: quoteLink(q) }),
  quoteFile: (q) => (fs.existsSync(quotes.file(q)) ? { buffer: fs.readFileSync(quotes.file(q)), name: `${q.number}.pdf` } : null),
  // Cadastro do cliente no CRM, como o vendedor faz na tela: fica no nome de quem pediu; cliente de outro vendedor é recusado.
  registerLead: ({ user, viewer, nome = '', telefone = '', interesse = '', pessoas = 1 }) => {
    const phone = normalizePhone(telefone) || null;
    if (telefone && !phone) throw new Error('o telefone não parece correto. Me passe com DDD (ex.: 45 98888-7777).');
    const key = phone ? mariaOutbound.route(user, phone).key : null;
    let lead = phone ? crm.findForConversation({ key, phone }) : null;
    if (lead) {
      // Cadastro que já existe NÃO é alterado pela Maria (nem nome, nem interesse, nem dono): só informa.
      if (!crm.canSee(viewer, lead)) throw new Error('esse cliente já é de outro vendedor. Fale com o administrador.');
      return { lead, created: false };
    }
    const pkg = interesse ? crm.matchPackage(interesse) : null;
    const view = crm.create(viewer, { name: nome, phone, interest: pkg?.name || interesse || '', people: pessoas, source: 'maria', ownerId: user.id, conversationKey: key });
    return { lead: crm.byId(view.id), created: true };
  },
  audit: (text) => securityEvent('maria_contrato', { name: 'Maria' }, null, text),
};
// O cliente preencheu a ficha pedida pela Maria: avisa quem pediu (o vendedor), pelo número da Maria, com a prévia do orçamento.
closing.onManualFilled = async (f) => {
  const lead = f.leadId ? crm.byId(f.leadId) : null;
  const q = (f.quoteId && quotes.list.find((x) => x.id === f.quoteId))
    || quotes.list.filter((x) => (lead && x.leadId === lead.id) || (x.phone && f.data.whatsapp && samePhone(x.phone, normalizePhone(f.data.whatsapp) || ''))).at(-1);
  const text = filledNotice({ nome: f.data.nome || 'O cliente', quote: q, requesterName: auth.get(f.requesterId)?.name, mariaName: maria.name });
  await maria.notifyUser(f.requesterId, text).catch((e) => store.addLog({ type: 'error', message: `Maria (aviso de ficha): ${e.message}` }));
};
// O que a secretária sabe da empresa: a mesma base do atendimento (sem as regras de venda), os pacotes com preço de tabela e quem é da empresa.
const mariaKnowledge = ({ publicOnly = false } = {}) => {
  const pk = (store.settings.crm?.packages || []).filter((p) => p?.name).map((p) => `- ${p.name}${p.price ? `: R$ ${Number(p.price).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} por pessoa (tabela)` : ''}`);
  // Parceiro externo: só a base pública da empresa e a tabela de pacotes (nada de regras internas, equipe nem dados ao vivo).
  if (publicOnly) return `# BASE DA EMPRESA (conhecimento cadastrado)\n${companyBrief(store.settings)}${pk.length ? `\n## Pacotes (tabela)\n${pk.join('\n')}\n` : ''}`;
  // Texto fixo do grupo (o que opera e o que está em desenvolvimento) + dados ao vivo do sistema + visão geral do Migra Hub.
  const live = groupLiveBrief({ realty, finance: proposals.config, motors, catalog: serviceCatalog, crm: store.settings.crm, auth });
  // Primeiro o que é ao vivo e curto (dados do grupo e o sistema), depois a base grande: nada importante fica no fim, onde seria cortado.
  const news = portfolio.asText();
  return `${live}${news ? `\n\n${news}` : ''}\n\n${STAFF_RULES}\n\n${HUB_OVERVIEW}\n\n# BASE DA EMPRESA (conhecimento cadastrado)\n${companyBrief(store.settings)}${pk.length ? `\n## Pacotes (tabela)\n${pk.join('\n')}\n` : ''}`;
};
// Envio da ficha e do contrato ao cliente, pedido pela Maria (sai do WhatsApp do vendedor ou do principal, nunca do número interno dela).
const mariaOutbound = makeOutbound({
  publicBase, store, quotes: () => quotes.list, samePhone, lines, lineKey, wa, agent, crm, closing, contractFlow, fichaMessage,
  contractFile: (q) => {
    const signed = q.contract?.status === 'assinado' && fs.existsSync(signedFile(q));
    const file = signed ? signedFile(q) : contractFile(q);
    return fs.existsSync(file) ? { buffer: fs.readFileSync(file), name: `Contrato CT-${q.number.replace(/^ORC-/, '')}${signed ? ' assinado' : ''}.pdf` } : null;
  },
});
// Ana: assistente pessoal (agenda e financeiro pessoal de cada administrador). Os dados ficam em store.data.personal, por pessoa.
const personal = new Personal({ store });
const portfolio = new Portfolio({ store });
const ana = new Ana({
  store, auth, personal, llm,
  notify: (userId, text) => maria.notifyUser(userId, text),
  audit: (text) => securityEvent('ana_whatsapp', { name: 'Ana' }, null, text),
  log: (l) => store.addLog(l),
});
const maria = new Maria({
  ana, portfolio, crm, restartAll, receiptReader: { read: (b, m) => receipts.read(b, m), receiverOk: (r) => receipts.receiverOk(r), get maxAuto() { return receipts.maxAuto; } }, payments, saleDoc: (sale) => quotes.list.find((q) => q.id === sale.quoteId)?.contract?.client?.cpf || closing.list.find((f) => f.leadId && f.leadId === sale.leadId && f.status === 'preenchida')?.data?.cpf || '', store, auth, sales, customers: customer360, collections, cash, llm, contracts: mariaContracts, outbound: mariaOutbound, knowledge: mariaKnowledge,
  lineIdByName: (name) => lines.list().find((l) => String(l.agentName || '').trim().toLowerCase() === String(name).trim().toLowerCase())?.id || '',
  isConnected: (key) => (wa.isConnected ? wa.isConnected(key) : wa.status === 'connected'),
  stt: nina.stt, tts: nina.tts,
  send: (jid, payload) => wa.send(jid, payload),
  downloadAudio: (m) => wa.downloadAudio(m),
  contractFile: (sale) => {
    const q = sale && quotes.list.find((x) => x.id === sale.quoteId);
    if (!q) return null;
    const signed = q.contract?.status === 'assinado' && fs.existsSync(signedFile(q));
    const file = signed ? signedFile(q) : contractFile(q);
    if (!fs.existsSync(file)) return null;
    return { buffer: fs.readFileSync(file), name: `Contrato ${q.number.replace(/^ORC-/, 'CT-')}${signed ? ' assinado' : ''}.pdf`, signed };
  },
  digest: () => alerts.digestText(alerts.build({ user: { role: 'admin' } })),
  health: () => { const h = healthReport(); return `*Saúde do sistema*\n${h.tips.map((t) => `${{ ok: '✅', warn: '⚠️', bad: '🔴' }[t.level] || '•'} ${t.text}`).join('\n')}`; },
  lineName: (id) => lines.get(id)?.agentName || '',
  marcosPhone: () => marcosPhone(),
  audit: (text) => securityEvent('maria_whatsapp', { name: 'Maria' }, null, text),
  log: (l) => store.addLog(l),
});
const receipts = new ReceiptReader({
  store, payments, llm,
  download: (m) => wa.downloadAudio(m),
  send: (jid, payload) => wa.send(jid, payload),
  notifyAdmins: (text) => notifyAdmins(text),
  remember: (key, text) => { const conv = agent.conversation(key, { create: false }); if (conv) agent.remember(conv, 'assistant', text); },
  audit: (text) => securityEvent('pagamento_comprovante', 'IA', null, text),
  getConfig: agentConfig,
});
app.use('/api/cash', (req, res, next) => {
  if (!cash.booksFor(req.user).length) return res.status(403).json({ error: 'O caixa é restrito: só os administradores liberados veem.' });
  next();
});
// Qual caixa a pessoa está usando (Migra ou Contábil). Sem permissão naquele caixa: 403.
const cashBook = (req, book = req.query.book ?? req.body?.book) => {
  const b = String(book || 'migra');
  if (!CASH_BOOKS[b]) throw httpError(400, 'Caixa inválido');
  if (!cash.canAccess(req.user, b)) throw httpError(403, `Você não tem acesso ao ${CASH_BOOKS[b]}.`);
  return b;
};
const cashEntryOf = (req) => {
  const e = cash.list.find((x) => x.id === req.params.id);
  if (!e) throw httpError(404, 'Lançamento não encontrado');
  cashBook(req, e.book || 'migra');
  return e;
};
const cashRange = (period) => {
  const t = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const first = (y, m) => new Date(Date.UTC(y, m, 1));
  if (period === 'month') return { from: iso(first(t.getUTCFullYear(), t.getUTCMonth())), to: '' };
  if (period === 'last') return { from: iso(first(t.getUTCFullYear(), t.getUTCMonth() - 1)), to: iso(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0))) };
  if (period === '30') return { from: iso(new Date(t.getTime() - 30 * 86_400_000)), to: '' };
  if (period === 'year') return { from: `${t.getUTCFullYear()}-01-01`, to: '' };
  return { from: '', to: '' };
};
app.get('/api/cash', (req, res) => {
  const { from, to } = req.query.from || req.query.to ? { from: String(req.query.from || ''), to: String(req.query.to || '') } : cashRange(String(req.query.period || 'month'));
  const book = cashBook(req);
  const entries = cash.entries({ from, to, kind: req.query.kind, category: req.query.category, q: req.query.q, status: req.query.status, scope: String(req.query.scope || ''), book });
  res.json({
    from, to, count: entries.length, book,
    books: Object.fromEntries(cash.booksFor(req.user).map((b) => [b, CASH_BOOKS[b]])),
    contabilUserIds: store.settings.cash?.contabilUserIds || [],
    migratechUserIds: store.settings.cash?.migratechUserIds || [],
    partners: cash.partners,
    partnerTotals: cash.partnerTotals(entries),
    entries: entries.slice(0, 500),
    summary: cash.summary(entries),
    categories: cash.categories,
    scopes: CASH_SCOPE_LABELS,
    tithe: cash.tithe(entries),
    methods: CASH_METHODS,
    currencies: CASH_CURRENCIES,
    admins: auth.users.filter((u) => u.role === 'admin' && u.active !== false).map((u) => ({ id: u.id, name: u.name })),
    allowedUserIds: store.settings.cash?.allowedUserIds || [],
    me: { id: req.user.id, name: req.user.name },
  });
});
// Planilha (CSV) do período e filtros atuais: abre no Excel e no Google Planilhas. Fica no registro de acessos.
app.get('/api/cash/export.csv', (req, res) => {
  const { from, to } = req.query.from || req.query.to ? { from: String(req.query.from || ''), to: String(req.query.to || '') } : cashRange(String(req.query.period || 'month'));
  const book = cashBook(req);
  const entries = cash.entries({ from, to, kind: req.query.kind, category: req.query.category, q: req.query.q, status: req.query.status, scope: String(req.query.scope || ''), book });
  securityEvent('caixa_exportado', req.user, req, `${CASH_BOOKS[book]} · ${entries.length} lançamentos · ${req.query.period || 'month'}${req.query.scope ? ` · ${req.query.scope}` : ''}`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="caixa-${book === 'contabil' ? 'contabil-' : ''}${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(cashToCsv(entries));
});
// Nina lança no Caixa Migra: as telas dela exigem acesso a esse caixa.
app.use('/api/cash/assistant', (req, _res, next) => { cashBook(req, 'migra'); next(); });
// Portfólio de novidades do grupo (a Maria aprende com ele). Só administrador lê, anota e remove.
app.get('/api/portfolio', (req, res) => { needAdmin(req); res.json(portfolio.list()); });
app.post('/api/portfolio', (req, res) => {
  needAdmin(req);
  const item = portfolio.add(req.user, req.body?.text, req.body?.status);
  securityEvent('portfolio_novidade', req.user, req, `Novidade anotada (${item.status})`);
  res.json(item);
});
app.delete('/api/portfolio/:id', (req, res) => {
  needAdmin(req);
  const gone = portfolio.remove(req.user, req.params.id);
  securityEvent('portfolio_removido', req.user, req, `Novidade removida (${gone.status})`);
  res.json({ ok: true });
});
// Ana (assistente pessoal): quem pode usar e o horário do resumo da manhã. NUNCA devolve agenda nem financeiro de ninguém.
app.get('/api/ana', (req, res) => {
  needAdmin(req);
  const c = store.settings.ana || {};
  res.json({ enabled: ana.enabled, briefingTime: c.briefingTime || '04:30', users: Array.isArray(c.users) ? c.users : [], people: auth.users.filter((u) => u.active !== false).map((u) => ({ id: u.id, name: u.name, role: u.role, whatsapp: Boolean(u.whatsapp), allowed: ana.allowed(u) })) });
});
app.put('/api/ana', (req, res) => {
  needAdmin(req);
  const b = req.body || {};
  const cur = store.settings.ana || {};
  const time = b.briefingTime === undefined ? cur.briefingTime || '04:30' : String(b.briefingTime);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw httpError(400, 'Horário inválido (use HH:MM)');
  const users = b.users === undefined ? cur.users || [] : (Array.isArray(b.users) ? b.users : []).filter((id) => auth.get(id));
  store.updateSettings({ ana: { enabled: b.enabled === undefined ? cur.enabled !== false : Boolean(b.enabled), users, briefingTime: time, voice: cur.voice || 'Aoede' } });
  securityEvent('ana_ajustes', req.user, req, `Ana ${store.settings.ana.enabled ? 'ligada' : 'desligada'} · resumo às ${time} · ${users.length ? `${users.length} pessoa(s) escolhida(s)` : 'todos os administradores'}`);
  res.json({ ok: true });
});
// Maria (assessora interna no WhatsApp): quem pode o quê. Só administrador.
const mariaPeople = () => auth.users.filter((u) => u.active !== false).map((u) => ({ id: u.id, name: u.name, role: u.role, whatsapp: u.whatsapp || '', profile: maria.profileOf(u), fixed: u.role === 'admin' }));
app.get('/api/maria', (req, res) => {
  needAdmin(req);
  res.json({ enabled: maria.enabled, name: maria.name, lineId: store.settings.maria?.lineId || '', voiceReply: store.settings.maria?.voiceReply !== false, profiles: MARIA_PROFILES, people: mariaPeople(), lines: lines.list().map((l) => ({ id: l.id, label: l.label, agentName: l.agentName || '', phone: l.phone || '' })), sttReady: nina.stt?.ready || false, ttsReady: nina.tts?.ready || false });
});
app.put('/api/maria', (req, res) => {
  needAdmin(req);
  const b = req.body || {};
  const cur = store.settings.maria || {};
  const lineId = b.lineId === undefined ? cur.lineId || '' : String(b.lineId || '');
  if (lineId && !lines.list().some((l) => l.id === lineId)) throw httpError(400, 'Número não encontrado em Conexões');
  const profiles = { ...(cur.profiles || {}) };
  for (const [id, p] of Object.entries(b.profiles || {})) {
    const u = auth.get(id);
    if (!u || u.role === 'admin') continue; // administrador sempre vê tudo; id inventado é ignorado
    if (!MARIA_PROFILES[p]) throw httpError(400, 'Perfil inválido');
    profiles[id] = p;
  }
  store.updateSettings({ maria: { enabled: b.enabled === undefined ? cur.enabled !== false : Boolean(b.enabled), name: cur.name || 'Maria', lineId, voiceReply: b.voiceReply === undefined ? cur.voiceReply !== false : Boolean(b.voiceReply), wakeWords: cur.wakeWords || ['atendente'], profiles } });
  securityEvent('maria_ajustes', req.user, req, `Maria ${store.settings.maria.enabled ? 'ligada' : 'desligada'} · perfis: ${Object.entries(profiles).map(([id, p]) => `${auth.get(id)?.name || id}=${p}`).join(', ') || 'padrão'}`);
  res.json({ ok: true });
});
// Nina: ajustes e estado da voz (só quem vê o caixa).
app.get('/api/cash/assistant', (_req, res) => res.json({
  ...store.settings.assistant,
  sttReady: nina.stt.ready,
  ttsReady: nina.tts.ready,
  geminiVoices: GEMINI_VOICES,
  lines: lines.list().map((l) => ({ id: l.id, label: l.label })),
}));
// Teste da Nina dentro do painel (sem WhatsApp): mostra o que ela entendeu, toca a voz e diz o motivo se algo falhar.
app.post('/api/cash/assistant/test', async (req, res) => {
  const text = String(req.body?.text || '').slice(0, 400);
  const out = { hears: nina.stt.ready, speaks: nina.tts.ready, reply: '', voice: null, voiceError: '' };
  out.reply = await nina.process(req.user, nina.stripWake(text).rest || text, { phone: `painel:${req.user.id}`, dry: true });
  if (typeof out.reply !== 'string') out.reply = out.reply.text;
  if (req.body?.speak !== false) {
    try {
      const v = await nina.speakText(out.reply);
      out.voice = { mimetype: v.mimetype, base64: v.buffer.toString('base64') };
    } catch (e) {
      out.voiceError = e.message;
    }
  }
  res.json(out);
});
app.put('/api/cash/assistant', (req, res) => {
  const b = req.body || {};
  const lineId = String(b.lineId || '');
  if (lineId && !lines.list().some((l) => l.id === lineId)) throw httpError(400, 'Número não encontrado em Conexões');
  store.updateSettings({ assistant: {
    enabled: Boolean(b.enabled),
    wakeWord: String(b.wakeWord || 'nina').trim().slice(0, 20) || 'nina',
    voiceReply: Boolean(b.voiceReply),
    voice: ['pf_dora', 'pm_alex', 'pm_santa'].includes(b.voice) || GEMINI_VOICES[b.voice] ? b.voice : 'Laomedeia',
    voiceStyle: String(b.voiceStyle || '').trim().slice(0, 300),
    lineId,
  } });
  securityEvent('caixa_nina_ajustes', req.user, req, b.enabled ? 'ligada' : 'desligada');
  res.json({ ok: true });
});
app.get('/api/cash/:id/history', (req, res) => {
  const e = cashEntryOf(req);
  res.json({ history: e.history, deleted: e.deleted || null });
});
app.post('/api/cash', (req, res) => {
  cashBook(req, req.body?.book);
  const e = cash.add(req.user, req.body || {});
  securityEvent('caixa_lancamento', req.user, req, `${CASH_BOOKS[e.book]} · ${e.kind} · ${e.amount} ${e.currency} · ${e.category}`);
  res.json(e);
});
app.patch('/api/cash/:id', (req, res) => {
  cashEntryOf(req);
  if (req.body?.book !== undefined) cashBook(req, req.body.book); // mover para outro caixa: precisa ter acesso aos dois
  const e = cash.update(req.user, req.params.id, req.body || {});
  securityEvent('caixa_alterado', req.user, req, `${e.id} · ${e.kind} · ${e.amount} ${e.currency}`);
  res.json(e);
});
app.delete('/api/cash/:id', (req, res) => {
  cashEntryOf(req);
  cash.remove(req.user, req.params.id, req.body?.reason);
  securityEvent('caixa_apagado', req.user, req, `${req.params.id} · ${req.body?.reason || ''}`);
  res.json({ ok: true });
});
app.put('/api/cash/settings', (req, res) => {
  const categories = (Array.isArray(req.body?.categories) ? req.body.categories : []).map((c) => String(c).trim().slice(0, 80)).filter(Boolean).slice(0, 40);
  const adminIds = new Set(auth.users.filter((u) => u.role === 'admin' && u.active !== false).map((u) => u.id));
  const allowed = (Array.isArray(req.body?.allowedUserIds) ? req.body.allowedUserIds : []).filter((id) => adminIds.has(id));
  if (!cash.canAccess(req.user, 'migra')) throw httpError(403, 'Só quem vê o Caixa Migra muda as categorias e quem vê os caixas.');
  if (allowed.length && !allowed.includes(req.user.id)) throw httpError(400, 'Você não pode se tirar da lista de quem vê o caixa.');
  const contabilIds = (Array.isArray(req.body?.contabilUserIds) ? req.body.contabilUserIds : store.settings.cash?.contabilUserIds || []).filter((id) => adminIds.has(id));
  const migratechIds = (Array.isArray(req.body?.migratechUserIds) ? req.body.migratechUserIds : store.settings.cash?.migratechUserIds || []).filter((id) => adminIds.has(id));
  store.updateSettings({ cash: { categories, allowedUserIds: allowed, contabilUserIds: contabilIds, migratechUserIds: migratechIds } });
  store.settings.cash.allowedUserIds = allowed; // updateSettings junta listas por substituição; garante o valor exato
  store.settings.cash.contabilUserIds = contabilIds;
  store.settings.cash.migratechUserIds = migratechIds;
  store.save();
  securityEvent('caixa_acesso', req.user, req, `Caixa Migra: ${allowed.length ? `${allowed.length} administrador(es)` : 'todos os administradores'} · Caixa Contábil: ${contabilIds.length ? `${contabilIds.length} administrador(es)` : 'mesma regra do Caixa Migra'} · Caixa Migratech: ${migratechIds.length ? `${migratechIds.length} administrador(es)` : 'mesma regra do Caixa Migra'}`);
  res.json({ ok: true });
});
// ---- Migratech Soluções: só quem vê o Caixa Migratech (é tudo dinheiro e clientes dessa empresa) ----
app.use('/api/migratech', (req, res, next) => {
  if (!cash.canAccess(req.user, 'migratech')) return res.status(403).json({ error: 'A Migratech é restrita a quem vê o Caixa Migratech Soluções.' });
  next();
});
app.get('/api/migratech', (req, res) => {
  const range = cashRange(String(req.query.period || 'month'));
  const entries = cash.entries({ ...range, book: 'migratech' });
  res.json({ ...migratech.overview(), cash: cash.summary(entries), partners: cash.partners, partnerTotals: cash.partnerTotals(entries), period: range });
});
const MT_LISTS = { clients: ['addClient', 'updateClient', 'cliente'], contracts: ['addContract', 'updateContract', 'contrato'], services: ['addService', 'updateService', 'serviço'] };
app.post('/api/migratech/:list', (req, res) => {
  const m = MT_LISTS[req.params.list];
  if (!m) throw httpError(404, 'Rota não encontrada');
  const x = migratech[m[0]](req.user, req.body || {});
  audit.record({ user: req.user, ip: clientIp(req), action: 'criou', entity: `migratech ${m[2]}`, label: x.name || x.title || x.description });
  res.json(x);
});
app.patch('/api/migratech/:list/:id', (req, res) => {
  const m = MT_LISTS[req.params.list];
  if (!m) throw httpError(404, 'Rota não encontrada');
  const x = migratech[m[1]](req.user, req.params.id, req.body || {});
  audit.record({ user: req.user, ip: clientIp(req), action: 'alterou', entity: `migratech ${m[2]}`, label: x.name || x.title || x.description });
  res.json(x);
});
app.delete('/api/migratech/:list/:id', (req, res) => {
  const m = MT_LISTS[req.params.list];
  if (!m) throw httpError(404, 'Rota não encontrada');
  migratech.remove(req.user, req.params.list, req.params.id, req.body?.reason);
  audit.record({ user: req.user, ip: clientIp(req), action: 'excluiu', entity: `migratech ${m[2]}`, label: `${req.params.id} · ${req.body?.reason || ''}` });
  res.json({ ok: true });
});
// Saque de sócio (Marcos ou Manderson): vira uma saída no Caixa Migratech, categoria "Retirada de sócio".
app.post('/api/migratech-withdrawals', (req, res) => {
  if (!cash.canAccess(req.user, 'migratech')) throw httpError(403, 'Só quem vê o Caixa Migratech Soluções.');
  const b = req.body || {};
  if (!String(b.partner || '').trim()) throw httpError(400, `Diga qual sócio fez o saque (${cash.partners.join(' ou ')})`);
  const e = cash.add(req.user, { kind: 'saida', amount: b.amount, currency: b.currency || 'BRL', date: b.date, description: String(b.description || '').trim() || `Saque do sócio ${b.partner || ''}`.trim(), category: 'Retirada de sócio', partner: b.partner, method: b.method, notes: b.notes, book: 'migratech' });
  securityEvent('caixa_lancamento', req.user, req, `Caixa Migratech Soluções · saque de sócio ${e.partner} · ${e.amount} ${e.currency}`);
  res.json(e);
});

// ---- Migra Contábil Paraguay: empresas clientes, obrigações do mês, documentos e honorários ----
// Só quem vê o Caixa Migra Contábil Paraguay (são dados e dinheiro dos clientes do escritório).
app.use('/api/contabil', (req, res, next) => {
  if (!cash.canAccess(req.user, 'contabil')) return res.status(403).json({ error: 'O painel da Migra Contábil Paraguay é restrito a quem vê o caixa dela.' });
  next();
});
app.get('/api/contabil', (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : undefined;
  res.json(contabil.overview(month));
});
const CT_ACTIONS = {
  companies: { add: 'addCompany', update: 'updateCompany', label: 'empresa' },
  obligations: { add: 'addObligation', update: 'updateObligation', label: 'obrigação' },
  requests: { add: 'addRequest', update: 'updateRequest', label: 'documento pedido' },
  tasks: { update: 'updateTask', label: 'obrigação do mês' },
  fees: { update: 'updateFee', label: 'honorário' },
};
app.post('/api/contabil/:list', (req, res) => {
  const a = CT_ACTIONS[req.params.list];
  if (!a?.add) throw httpError(404, 'Rota não encontrada');
  const x = contabil[a.add](req.user, req.body || {});
  audit.record({ user: req.user, ip: clientIp(req), action: 'criou', entity: `contábil ${a.label}`, label: x.name || x.title || '' });
  res.json(x);
});
app.patch('/api/contabil/:list/:id', (req, res) => {
  const a = CT_ACTIONS[req.params.list];
  if (!a?.update) throw httpError(404, 'Rota não encontrada');
  const x = contabil[a.update](req.user, req.params.id, req.body || {});
  audit.record({ user: req.user, ip: clientIp(req), action: 'alterou', entity: `contábil ${a.label}`, label: `${x.name || x.title || x.key || x.id}${req.body?.status ? ` → ${req.body.status}` : ''}` });
  res.json(x);
});
app.delete('/api/contabil/:list/:id', (req, res) => {
  const a = CT_ACTIONS[req.params.list];
  if (!a) throw httpError(404, 'Rota não encontrada');
  contabil.remove(req.user, req.params.list, req.params.id, req.body?.reason);
  audit.record({ user: req.user, ip: clientIp(req), action: 'excluiu', entity: `contábil ${a.label}`, label: `${req.params.id} · ${req.body?.reason || ''}` });
  res.json({ ok: true });
});
app.put('/api/contabil-ruc-days', (req, res) => {
  if (!cash.canAccess(req.user, 'contabil')) throw httpError(403, 'Só quem vê o painel da Contábil.');
  const days = contabil.setRucDays(req.body?.days || {});
  audit.record({ user: req.user, ip: clientIp(req), action: 'alterou', entity: 'contábil vencimentos por RUC', label: Object.entries(days).map(([d, v]) => `${d}→${v}`).join(' ') });
  res.json(days);
});

// ---- Migra Devocional (e outros apps): quantos usuários se cadastraram ----
app.get('/api/app-signups/:app', (req, res) => {
  needAdmin(req);
  res.json(appSignups.stats(req.params.app));
});
app.post('/api/app-signups/:app/key', (req, res) => {
  needAdmin(req);
  const key = appSignups.newKey(req.params.app, req.user);
  securityEvent('app_chave_criada', req.user, req, `${SIGNUP_APPS[req.params.app]}: chave nova (a anterior deixou de valer)`);
  res.json({ key, note: 'Copie agora: esta chave não aparece de novo. Cole nas configurações do aplicativo, nunca em conversas.' });
});
app.delete('/api/app-signups/:app/key', (req, res) => {
  needAdmin(req);
  appSignups.revokeKey(req.params.app);
  securityEvent('app_chave_revogada', req.user, req, `${SIGNUP_APPS[req.params.app] || req.params.app}: chave desligada`);
  res.json({ ok: true });
});

app.put('/api/sales/settings', (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Só o administrador');
  const pct = Number(req.body?.commissionPct);
  if (!(pct >= 0 && pct <= 100)) throw httpError(400, 'Percentual inválido');
  const affPct = req.body?.affiliateSellerPct;
  if (affPct !== undefined && affPct !== '' && affPct !== null && !(Number(affPct) >= 0 && Number(affPct) <= 100)) throw httpError(400, 'Percentual com indicação inválido');
  store.updateSettings({ sales: { commissionPct: pct, ...(affPct !== undefined ? { affiliateSellerPct: affPct === '' || affPct === null ? null : Number(affPct) } : {}) } });
  // Percentual próprio de cada vendedor (vazio = usa o padrão).
  for (const [id, v] of Object.entries(req.body?.perSeller || {})) {
    const u = auth.get(id);
    if (u) u.commissionPct = v === '' || v === null ? null : Number(v);
  }
  for (const [id, v] of Object.entries(req.body?.perSellerAffiliate || {})) {
    const u = auth.get(id);
    if (u) u.affiliateCommissionPct = v === '' || v === null ? null : Number(v);
  }
  store.save();
  securityEvent('comissao_padrao', req.user, req, `${pct}%`);
  res.json({ ok: true });
});
app.get('/api/quotes/:id/pdf', (req, res) => {
  const q = quotes.list.find((x) => x.id === req.params.id);
  if (!q || !canSeeQuote(req.user, q) || !fs.existsSync(quotes.file(q))) throw httpError(404, 'Orçamento não encontrado');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${q.number} - ${q.client.replace(/[^\w À-ú-]/g, '')}.pdf"`);
  res.sendFile(quotes.file(q));
});
// Visitas ao escritório.
app.get('/api/visits', (_req, res) => res.json([...visits.list].reverse().map((v) => {
  const lead = v.leadId ? crm.byId(v.leadId) : null;
  return { ...v, refundDue: visits.refundsDue().some((x) => x.id === v.id), leadCode: lead?.code || '', ownerName: lead?.ownerId ? auth.get(lead.ownerId)?.name || '' : '' };
})));
// Passa o pedido de visita para um vendedor: vira o responsável e recebe o resumo no WhatsApp (enviado do número conectado).
app.post('/api/visits/:id/forward', async (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Só o administrador');
  const v = visits.get(req.params.id);
  if (!v) throw httpError(404, 'Pedido de visita não encontrado');
  const seller = auth.get(req.body?.ownerId);
  if (!seller || seller.active === false) throw httpError(400, 'Escolha o vendedor');
  if (!seller.whatsapp) throw httpError(400, `${seller.name} está sem WhatsApp cadastrado (aba Equipe)`);
  if (wa.status !== 'connected') throw httpError(400, 'Conecte o WhatsApp primeiro (aba Conexões)');
  const lead = (v.leadId && crm.byId(v.leadId))
    || crm.findForConversation({ key: v.convKey, phone: v.phone })
    || crm.ensureFromConversation({ key: v.convKey || v.phone, phone: v.phone, name: v.name, channel: 'whatsapp' });
  if (lead) {
    v.leadId = lead.id;
    crm.assign(req.user, lead.id, seller.id);
  }
  const conv = v.convKey ? agent.conversation(v.convKey, { create: false }) : null;
  const first = (n) => String(n || '').trim().split(/\s+/)[0] || '';
  const preview = conv ? chatPreview(conv, 8) : '';
  const text = [
    '🏢 *Cliente para você: pediu visita ao escritório*',
    `👤 ${v.name || 'Cliente'}${v.phone ? ` · +${v.phone}` : ''}${lead?.code ? ` · ${lead.code}` : ''} · ${v.people} pessoa(s)`,
    v.phone ? `💬 Chame agora: https://wa.me/${v.phone}` : '',
    `📅 Preferência: ${v.preferred || '-'}${v.period ? ` (${v.period})` : ''}${v.status === 'confirmada' ? ` · CONFIRMADA ${String(v.date).split('-').reverse().join('/')} às ${v.time}` : ' · ainda não confirmada'}`,
    v.subject ? `🎯 Assunto: ${v.subject}` : '',
    v.prepared ? `💼 Vem preparado: ${v.prepared}` : '',
    lead?.aiSummary ? `📝 ${lead.aiSummary}` : '',
    preview ? `\n💬 *Prévia da conversa:*\n${preview}` : '',
    `\n✍️ *Como começar:*\nOi${first(v.name) ? `, ${first(v.name)}` : ''}! Aqui é ${first(seller.name)}, da Migra Paraguai. A equipe me passou o seu pedido de visita ao escritório${v.subject ? ` para ${v.subject.toLowerCase()}` : ''}. Vou cuidar do seu atendimento: qual dia fica melhor para você vir?`,
  ].filter(Boolean).join('\n');
  await wa.send(seller.whatsapp, { text, typing: false });
  Object.assign(v, { forwardedTo: seller.name, forwardedAt: new Date().toISOString() });
  if (lead) crm.addNote(req.user, lead.id, `🏢 Pedido de visita passado para ${seller.name}`);
  store.save();
  notify('visits', { id: v.id });
  res.json({ ok: true, seller: seller.name });
});
// Aviso da nova taxa para quem já pediu visita: o administrador confere a lista e a mensagem, e confirma o envio.
app.get('/api/visits/fee-notice', (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Só o administrador');
  const t = visits.noticeTargets();
  res.json({ fee: visits.fee, run: visits.noticeRun || null, count: t.length, sample: t[0] ? visits.noticeText(t[0]) : '', targets: t.map((v) => ({ id: v.id, name: v.name, phone: v.phone, status: v.status })) });
});
app.post('/api/visits/fee-notice/send', (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Só o administrador');
  if (wa.status !== 'connected') throw httpError(400, 'Conecte o WhatsApp primeiro (aba Conexões)');
  const ids = Array.isArray(req.body?.ids) && req.body.ids.length ? req.body.ids.map(String) : null;
  if (!visits.noticeTargets().some((v) => !ids || ids.includes(v.id))) throw httpError(400, 'Ninguém para avisar');
  securityEvent('visitas_aviso_taxa', req.user, req, `${ids ? ids.length : 'todos'} destinatário(s)`);
  visits.sendNotices(ids, { by: req.user.name }).catch((e) => store.addLog({ type: 'error', message: `Aviso da taxa: ${e.message}` }));
  res.json({ ok: true });
});
app.post('/api/visits/:id/refunded', (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Só o administrador');
  const v = visits.markRefunded(req.params.id, { by: req.user.name, note: req.body?.note });
  if (cash.canAccess(req.user) && req.body?.cash) cash.add(req.user, { kind: 'saida', amount: v.feeAmount || visits.fee, description: `Estorno da taxa de assessoria presencial · ${v.name || 'cliente'}`, category: 'Outros', payee: v.name || '', date: new Date().toISOString().slice(0, 10) });
  res.json(v);
});
app.post('/api/visits/:id/confirm', async (req, res) => res.json(await visits.confirm(req.params.id, { ...req.body, by: req.user.name })));
app.post('/api/visits/:id/reschedule', async (req, res) => res.json(await visits.reschedule(req.params.id, req.body)));
app.post('/api/visits/:id/cancel', async (req, res) => res.json(await visits.cancel(req.params.id, req.body)));
app.post('/api/visits/:id/done', (req, res) => res.json(visits.done(req.params.id)));
app.post('/api/leads/:id/confirm', (req, res) => res.json(crm.confirmSale(req.user, req.params.id)));
app.delete('/api/leads/:id', (req, res) => {
  crm.remove(req.user, req.params.id);
  res.json({ ok: true });
});

// CRM: retornos e números
// Retomada antecipada dos retornos marcados para o futuro (botão em Retornos, só o administrador).
let reconfirmJob = null;
app.get('/api/followups/reconfirm', (_req, res) => res.json({ job: reconfirmJob, pending: followups.futureList().length, far: followups.futureList({ minDays: 31 }).length }));
app.post('/api/followups/reconfirm', (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Só o administrador');
  if (reconfirmJob?.running) throw httpError(409, 'A retomada já está em andamento');
  const minDays = req.body?.scope === 'far' ? 31 : 1;
  const total = Math.min(25, followups.futureList({ minDays }).length);
  if (!total) throw httpError(400, 'Não há clientes com retorno futuro para retomar');
  reconfirmJob = { running: true, total, sent: 0, skipped: [], startedAt: new Date().toISOString(), by: req.user.name };
  followups.reconfirm({ minDays, onProgress: (o) => Object.assign(reconfirmJob, { sent: o.sent.length, skipped: o.skipped }) })
    .then((o) => Object.assign(reconfirmJob, { running: false, sent: o.sent.length, skipped: o.skipped, erro: o.erro || null, endedAt: new Date().toISOString() }))
    .catch((e) => Object.assign(reconfirmJob, { running: false, erro: e.message }))
    .finally(() => notify('crm', {}));
  res.json(reconfirmJob);
});
app.get('/api/crm/agenda', (req, res) => res.json(crm.agenda(req.user)));
app.get('/api/crm/handoffs', (req, res) => {
  const ownerId = req.user.role === 'admin' ? req.query.owner || undefined : req.user.id;
  res.json(crm.handoffs({ from: req.query.from, to: req.query.to, ownerId }));
});
app.get('/api/crm/stats', (req, res) => {
  const ownerId = req.user.role === 'admin' ? req.query.owner || undefined : req.user.id;
  res.json(crm.stats({ from: req.query.from, to: req.query.to, ownerId, office: req.office !== 'all' ? req.office : '' }));
});
// Dados de exemplo (só o administrador)
app.get('/api/demo', (_req, res) => res.json({ loaded: hasDemo(store) }));
app.post('/api/demo', async (req, res) => {
  const r = await loadDemo({ store, auth, crm, router, admin: req.user });
  notify('crm', {});
  res.json(r);
});
app.delete('/api/demo', (_req, res) => {
  clearDemo(store);
  notify('crm', {});
  res.json({ ok: true });
});
app.get('/api/crm/ranking', (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? req.query.month : currentMonth();
  // Cada escritório tem o próprio ranking (a equipe de um não vê os números do outro).
  res.json(buildRanking({ leads: crm.leads.filter((l) => inOffice(req, crm.officeOf(l))), users: auth.users.filter((u) => inOffice(req, u.role === 'admin' ? 'py' : u.office)), settings: store.settings, month, today: toDateStr(new Date()) }));
});
app.post('/api/brand/logo', multer({ storage: multer.memoryStorage(), limits: { fileSize: 2_000_000 } }).single('file'), (req, res) => {
  if (!req.file || !/^image\/(png|jpeg|webp|svg\+xml)$/.test(req.file.mimetype)) throw httpError(400, 'Envie uma imagem PNG, JPG, WEBP ou SVG');
  fs.writeFileSync(BRAND_LOGO, req.file.buffer);
  fs.writeFileSync(`${BRAND_LOGO}.type`, req.file.mimetype);
  res.json({ ok: true });
});
app.delete('/api/brand/logo', (_req, res) => {
  fs.rmSync(BRAND_LOGO, { force: true });
  fs.rmSync(`${BRAND_LOGO}.type`, { force: true });
  res.json({ ok: true });
});
app.get('/api/crm/insights', (_req, res) => res.json(store.data.crmInsights || null));
app.post('/api/crm/insights', async (req, res) => {
  const stats = crm.stats({ from: req.body.from, to: req.body.to });
  const today = toDateStr(new Date());
  const stuck = crm.leads
    .filter((l) => ['novo', 'em_contato', 'proposta'].includes(l.stage) && Date.now() - Date.parse(l.updatedAt) > 7 * 86_400_000)
    .slice(0, 15)
    .map((l) => ({ etapa: l.stage, interesse: l.interest, responsavel: crm.ownerName(l.ownerId) || 'sem responsável', parado_desde: l.updatedAt.slice(0, 10) }));
  res.json(await crmAi.advise(stats, { ownerName: req.user.name, context: { hoje: today, prospectos_parados_ha_7_dias: stuck } }));
});

// Agenda
app.get('/api/appointments', (req, res) => {
  const from = String(req.query.from || toDateStr(new Date()));
  const list = store.data.appointments
    .filter((a) => a.date >= from && (req.query.all || a.status === 'confirmed'))
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  res.json(list);
});
app.get('/api/agenda/slots', async (req, res) => res.json(await calendar.getSlots(String(req.query.date || ''))));
app.post('/api/appointments', async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (!phone) throw httpError(400, 'Telefone inválido');
  if (!req.body.name) throw httpError(400, 'Informe o nome');
  res.json(await calendar.book({ ...req.body, phone }));
});
app.post('/api/appointments/:id/cancel', async (req, res) => {
  res.json(await calendar.cancel(req.params.id, null));
});

// Histórico
app.get('/api/logs', (req, res) => {
  const type = req.query.type;
  const limit = Math.min(Number(req.query.limit || 300), 2000);
  const logs = type ? store.data.logs.filter((l) => l.type === type) : store.data.logs;
  res.json(logs.slice(-limit).reverse());
});
app.delete('/api/logs', (_req, res) => {
  store.data.logs = [];
  store.save();
  res.json({ ok: true });
});

app.use('/api', (_req, _res, next) => next(httpError(404, 'Rota não encontrada')));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || (err instanceof multer.MulterError ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Erro interno' });
});

export { app, store, wa, agent, crm, auth };

const isLoopback = ['127.0.0.1', 'localhost', '::1'].includes(HOST);
// O painel tem login próprio (administrador e vendedores); PANEL_PASSWORD é uma senha extra opcional.

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, HOST, () => {
    const url = `http://${isLoopback || HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`;
    console.log(`🚀 Painel em ${url}`);
    if (process.env.OPEN_BROWSER) {
      // Usado pelos atalhos de dois cliques: abre o painel no navegador.
      const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
      exec(cmd, () => {});
    }
  });
  wa.start().catch((err) => console.error('Erro ao iniciar o WhatsApp:', err));
  instagram.start().catch((err) => console.error('Erro ao iniciar o Instagram:', err));
  lines.startAll().catch((err) => console.error('Erro ao ligar os números da equipe:', err.message));
  if (tunnelWanted()) tunnel.start().catch((err) => { console.error('Erro ao ligar o túnel:', err.message); restartTunnelSoon(); });
  scheduler.start();
  // Retornos agendados: confere a cada 10 minutos.
  setInterval(() => notifyFollowUps().catch((err) => store.addLog({ type: 'error', message: `Retornos: ${err.message}` })), 10 * 60_000).unref();
  setTimeout(() => notifyFollowUps().catch(() => {}), 60_000).unref();
  // Pix pelo Mercado Pago: confere a cada minuto se foi pago.
  setInterval(() => payments.checkPending().catch(() => {}), 60_000).unref();
  // Treinamento semanal dos vendedores: a cada 7 dias a IA cria um novo e os vendedores são avisados no WhatsApp.
  setInterval(() => runWeeklyTraining().catch((e) => store.addLog({ type: 'error', message: `Treinamento semanal: ${e.message}` })), 6 * 3_600_000).unref();
  setTimeout(() => runWeeklyTraining().catch(() => {}), 5 * 60_000).unref();
  // Resumo diário no WhatsApp dos administradores (uma vez por dia, a partir das 9h): vencidos, vencimentos, renovações, assinaturas.
  setInterval(() => {
    const d = new Date(); const day = d.toISOString().slice(0, 10);
    if (d.getHours() < 9 || d.getHours() >= 19 || store.data.alertsDigestDay === day || wa.status !== 'connected') return;
    store.data.alertsDigestDay = day; store.save();
    const text = alerts.digestText(alerts.build({ user: { role: 'admin' } }));
    if (text) notifyAdmins(text).catch(() => {});
  }, 10 * 60_000).unref();
  // Horários marcados com clientes (calendário e videochamadas): chama na hora combinada e lembra antes. Nada fica esquecido.
  const commitments = new Commitments({ store, agent, videocalls, send: (key, text) => wa.send(key, { text }), canSend: (key) => (key && wa.isConnected ? wa.isConnected(key) : wa.status === 'connected') && agent.active, log: (l) => store.addLog(l) });
  setInterval(() => { commitments.tickAppointments().catch((e) => store.addLog({ type: 'error', message: `Compromissos: ${e.message}` })); commitments.tickVideocalls().catch(() => {}); }, 3 * 60_000).unref();
  // Videochamadas reservadas que não foram pagas voltam a ficar livres.
  setInterval(() => videocalls.expirePending(), 5 * 60_000).unref();
  // Lembretes de tarefas da equipe (WhatsApp de cada pessoa), a cada 10 minutos, só no horário comercial.
  setInterval(() => { const h = new Date().getHours(); if (wa.status === 'connected' && h >= 8 && h < 19) tasks.remind((phone, text) => wa.send(phone, { text, typing: false })).catch(() => {}); }, 10 * 60_000).unref();
  // Cobrança aprovada: manda uma mensagem por vez, respeitando limite, horário e intervalo.
  setInterval(() => collections.tick().catch((e) => store.addLog({ type: 'error', message: `Cobrança: ${e.message}` })), 20_000).unref();
  // Cliente parado: entregue ao vendedor e sem nenhuma ação dele no prazo (só no horário comercial). Lembra o vendedor; se continuar, avisa a administração.
  const slaTick = async () => {
    const cfg = store.settings.crm?.sla || {};
    if (cfg.enabled === false) return;
    const r = slaCheck({ leads: crm.leads, convOf: convOfLead, now: new Date(), slaHours: Number(cfg.hours) || 2 });
    for (const n of r.nudge) {
      n.lead.slaNudgedAt = new Date().toISOString();
      const first = String(auth.get(n.sellerId)?.name || '').split(' ')[0];
      await maria.notifyUser(n.sellerId, `⏰ ${first}, o cliente *${n.lead.name || n.lead.phone || 'novo'}* foi entregue a você há cerca de ${n.hours} h e ainda não tem contato seu registrado. Fale com ele agora: cliente que espera esfria. Se não puder atender, avise a administração para passar para outra pessoa.`).catch(() => {});
    }
    // Cliente que continua parado: a administração NÃO recebe aviso. O próprio sistema recomeça o atendimento (a IA retoma de onde parou).
    for (const e of r.escalate) {
      e.lead.slaEscalatedAt = new Date().toISOString();
      if (e.lead.conversationKey) restartAll({ onlyKeys: [e.lead.conversationKey], minSilentHours: 0, resumeOwnerPauseHours: 0, includeMarcos: true });
      store.addLog({ type: 'system', message: `🔁 Cliente parado com ${auth.get(e.sellerId)?.name || 'vendedor'} há ${e.hours} h (${e.lead.name || e.lead.phone || 'novo'}): atendimento recomeçado pela IA` });
    }
    if (r.nudge.length || r.escalate.length) store.save();
  };
  // Nov/2026: quem saiu da área de corretores passa os atendimentos em aberto para o Diego (uma vez, assim que o Diego existir na Equipe).
  try {
    const moved = moveOldCorretorLeads({ store, auth, crm });
    if (moved?.done && moved.transferred) {
      store.addLog({ type: 'system', message: `🔁 ${moved.transferred} atendimento(s) em aberto do ${moved.from} passaram para o ${moved.to}` });
      securityEvent('atendimentos_corretor_trocado', { name: 'Sistema' }, null, `${moved.transferred} prospecto(s) em aberto passaram de ${moved.from} para ${moved.to}`);
    }
  } catch (e) { store.addLog({ type: 'error', message: `Troca de corretor: ${e.message}` }); }
  // Rede de segurança: a cada 15 minutos, dentro do horário de trabalho, quem ficou esperando e não está na fila entra nela (últimos dias do prazo escolhido). Silenciosos só pelo botão.
  setInterval(() => { try { if (agent.active && isWithinWorkHours(store.settings.agent?.workHours)) restartAll({ days: Number(store.settings.agent?.pendingMaxDays) || 30, includeSilent: false, includeMarcos: false }); } catch (e) { store.addLog({ type: 'error', message: `Recomeçar parados: ${e.message}` }); } }, 15 * 60_000).unref();
  // Orçamento a vencer (hoje ou amanhã): avisa uma vez, no horário de trabalho, pela conversa do cliente. Desligue com quoteExpiry.auto = false.
  setInterval(() => { try { if (agent.active && store.settings.agent?.quoteExpiry?.auto !== false && isWithinWorkHours(store.settings.agent?.workHours)) { const r = noticeQuotes({}); if (r.queued) store.addLog({ type: 'system', message: `Orçamentos a vencer: ${r.queued} cliente(s) avisados pela fila da IA.` }); } } catch (e) { store.addLog({ type: 'error', message: `Aviso de orçamento a vencer: ${e.message}` }); } }, 30 * 60_000).unref();
  // Conversa que a atendente respondeu e ficou sem prospecto no CRM: cria o que faltou (últimos 3 dias), a cada 30 minutos.
  setInterval(() => { try { if (agent.active) { const r = repairLeads({}); if (r.created) store.addLog({ type: 'system', message: `Prospectos que faltavam: ${r.created} conversa(s) respondida(s) pela IA ganharam registro no CRM.` }); } } catch (e) { store.addLog({ type: 'error', message: `Reparo de prospectos: ${e.message}` }); } }, 30 * 60_000).unref();
  setInterval(() => slaTick().catch((e) => store.addLog({ type: 'error', message: `Cliente parado: ${e.message}` })), 10 * 60_000).unref();
  // Ana: resumo da manhã (04:30) e lembretes pessoais na hora marcada.
  setInterval(() => ana.tick().catch((e) => store.addLog({ type: 'error', message: `Ana: ${e.message}` })), 60_000).unref();

  const shutdown = async () => {
    scheduler.stop();
    tunnel.stop();
    store.flush();
    await wa.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
