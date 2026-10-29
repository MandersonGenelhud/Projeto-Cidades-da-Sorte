// Servidor HTTP: API REST + painel web + webhook da Meta.
// Fuso do negócio: agenda, horários e "hoje" do agente usam este fuso.
process.env.TZ ||= 'America/Sao_Paulo';

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { Store } from './store.js';
import { WhatsAppClient } from './transports/whatsapp-web.js';
import { CloudApiClient } from './transports/cloudapi.js';
import { InstagramClient } from './transports/instagram.js';
import { ConnectionManager } from './connection.js';
import { CampaignRunner } from './campaigns.js';
import { AutoReply } from './autoreply.js';
import { Scheduler } from './scheduler.js';
import { PendingInbox, extractPending } from './pending.js';
import { LeadRouter } from './routing.js';
import { buildRanking, currentMonth } from './ranking.js';
import { clearDemo, hasDemo, loadDemo } from './demo.js';
import { Tunnel } from './tunnel.js';
import { Payments } from './payments.js';
import { LineManager, parseLineKey } from './lines.js';
import { Updater, RESTART_EXIT_CODE } from './updater.js';
import { Auth, publicUser } from './auth.js';
import { Crm, STAGES } from './crm.js';
import { CrmAi } from './crm-ai.js';
import { LLMClient } from './agent/llm.js';
import { createCalendar, toDateStr } from './agent/calendar.js';
import { Agent, STRESS_TESTS } from './agent/agent.js';
import { buildSystemPrompt } from './agent/prompt.js';
import { PRESETS, presetSettings } from './agent/presets.js';
import { csvToContacts, normalizePhone, renderTemplate, uid } from './utils.js';

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
  const provider = a.provider === 'openrouter' ? 'openrouter' : 'gemini';
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

// Números da equipe (até 6 WhatsApps, um por vendedor).
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
const campaigns = new CampaignRunner({ store, wa, notify });
const autoReply = new AutoReply({ store, wa, notify, agent });
const scheduler = new Scheduler({ store, wa, campaigns, notify });
const pending = new PendingInbox({ store, agent, wa, autoReply, notify });
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
agent.routeSpecialist = (conv, args, opts) => router.routeSpecialist(conv, args, opts);
// Pix no fechamento: cobra, confirma, fecha a venda, manda recibo e avisa o dono.
const payments = new Payments({
  store,
  crm,
  dataDir: DATA_DIR,
  secret: auth.secret,
  notify,
  sendTo: (key, payload) => wa.send(key, { ...payload, typing: false }),
  notifyAdmins: async (text) => {
    if (wa.status !== 'connected') return;
    const phones = new Set(auth.users.filter((u) => u.role === 'admin' && u.active !== false && u.whatsapp).map((u) => u.whatsapp));
    const extra = normalizePhone(store.settings.payments?.notifyPhone);
    if (extra) phones.add(extra);
    for (const phone of phones) await wa.send(phone, { text, typing: false }).catch(() => {});
  },
});
agent.createPix = async (conv, args, { dryRun } = {}) => {
  const adults = Math.max(1, Number(args.adultos) || 1);
  const amount = payments.reservationAmount(adults);
  const money = (v) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  if (dryRun || String(conv.key).startsWith('sim:')) {
    return { ok: true, simulacao: true, valor: money(amount), instrucao: 'Simulação: nenhum Pix foi gerado. No atendimento real o QR Code e o código copia e cola são enviados ao cliente antes desta resposta.' };
  }
  const lead = crm.findForConversation({ key: conv.key, phone: conv.phone })
    || crm.ensureFromConversation({ key: conv.key, phone: conv.phone, name: conv.name, username: conv.username, channel: String(conv.key).startsWith('ig:') ? 'instagram' : 'whatsapp' });
  const desc = `${store.settings.payments?.reservation?.description || 'reserva'} - ${adults} adulto(s)`;
  const p = await payments.create({ convKey: conv.key, leadId: lead?.id, amount, description: desc, payerName: args.nome_pagador, payerDoc: args.cpf_pagador, by: 'IA' });
  await payments.sendCharge(p);
  return { ok: true, valor: money(amount), instrucao: 'O QR Code e o código Pix copia e cola já foram enviados ao cliente em mensagens separadas, logo acima. Diga o valor, explique que é só copiar o código e colar no app do banco (Pix copia e cola) e que o recibo chega aqui assim que o pagamento for confirmado.' };
};
agent.claimPaid = async (conv, args, { dryRun } = {}) => {
  if (dryRun || String(conv.key).startsWith('sim:')) return { ok: true, simulacao: true };
  const r = await payments.clientClaimsPaid(conv.key, args.observacao || '');
  return r.ok
    ? { ...r, instrucao: r.automatico ? 'A confirmação é automática e chega em alguns minutos, junto com o recibo.' : 'A equipe foi avisada para conferir. Diga que, assim que confirmar, o recibo chega aqui.' }
    : r;
};

// O que o CRM já sabe do cliente que veio de outro canal (ex.: Instagram → WhatsApp do vendedor).
agent.contextFor = (conv) => {
  const lead = crm.findForConversation({ key: conv.key, phone: conv.phone });
  if (!lead || lead.conversationKey === conv.key) return '';
  const q = lead.qualification || {};
  const origin = lead.conversationKey ? agent.conversation(lead.conversationKey, { create: false }) : null;
  const before = (origin?.messages || []).slice(-8).map((m) => `${m.role === 'user' ? 'Cliente' : 'Atendimento'}: ${m.content}`).join('\n');
  return [
    `Nome: ${lead.name || '-'} · código ${lead.code}${lead.instagram ? ` · Instagram @${lead.instagram}` : ''}`,
    lead.interest ? `Interesse: ${lead.interest}${lead.people > 1 ? ` para ${lead.people} pessoas` : ''}` : '',
    q.temperature ? `Peneira: cliente ${q.temperature}${q.start ? `, quer começar ${q.start}` : ''}${q.moneyEvidence ? `, sobre o dinheiro disse: "${q.moneyEvidence}"` : ''}` : '',
    q.objections ? `Dúvidas que ficaram: ${q.objections}` : '',
    lead.aiSummary ? `Resumo: ${lead.aiSummary}` : '',
    lead.contractData ? 'Os dados para o contrato já foram passados.' : '',
    before ? `Últimas mensagens da conversa anterior (${String(lead.conversationKey).startsWith('ig:') ? 'Instagram' : 'outro canal'}):\n${before}` : '',
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
  for (const p of extractPending(msgs, { maxDays: 30 })) {
    if (p.at >= dayAgo) continue;
    const username = msgs.find((m) => m.jid === p.jid && m.username)?.username || '';
    const lead = crm.ensureFromConversation({ key: p.jid, name: p.name, username, channel: 'instagram' });
    if (lead && !lead.igOldNoted) {
      lead.igOldNoted = true;
      crm.addNote({ name: 'Sistema', role: 'admin' }, lead.id, `Mandou mensagem no Direct em ${new Date(p.at).toLocaleDateString('pt-BR')} e ficou sem resposta: "${p.texts.join(' / ').slice(0, 200)}". Passou de 24h, então o robô não pode responder: responda pelo app do Instagram.`);
      old++;
    }
  }
  store.addLog({ type: 'system', message: `📸 Direct verificado: ${recent} conversa(s) para o agente responder e ${old} antiga(s) enviada(s) ao CRM` });
  return { recent, old, total: new Set(msgs.map((m) => m.jid)).size };
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
  if (state.status === 'connected') console.log(`✅ WhatsApp conectado: ${state.me?.phone}`);
  if (state.error) console.log(`⚠️  Conexão: ${state.error}`);
  if (state.status === 'qr') console.log(`📱 Abra http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT} e escaneie o QR Code`);
});
wa.on('log', (entry) => store.addLog(entry));
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
  pending.resolve(msg.jid);
  agent.ownerReplied({ key: msg.jid, phone: msg.phone, text: msg.text });
});
wa.on('history', (msgs) => pending.ingestHistory(msgs));
wa.on('sent', ({ to, jid }) => {
  pending.resolve(jid);
  pending.resolve(to);
});
wa.on('lineStatus', (state) => notify('lineStatus', state));
wa.on('message', (msg) => {
  pending.onIncoming(msg);
  if (!msg.isGroup) {
    try {
      // Chegou no WhatsApp do vendedor com o código do Instagram: liga ao prospecto.
      if (msg.line) crm.linkByCode({ text: msg.text, key: msg.jid, phone: msg.phone });
      crm.ensureFromConversation({ key: msg.jid, phone: msg.phone, name: msg.name, username: msg.username, channel: msg.channel || 'whatsapp', referral: msg.referral, ownerId: msg.ownerId });
    } catch (err) {
      store.addLog({ type: 'error', message: `CRM: ${err.message}` });
    }
  }
  notify('message', msg);
  autoReply.handle(msg).catch((err) => store.addLog({ type: 'error', message: err.message }));
});

store.on('log', (log) => notify('log', log));

// Endereço na internet sem VPS (túnel gratuito da Cloudflare), para o webhook do Instagram.
const tunnel = new Tunnel({ dataDir: DATA_DIR, port: PORT });
// O túnel é um programa à parte: fecha junto com o painel (inclusive ao atualizar).
process.on('exit', () => tunnel.stop());
tunnel.on('status', (st) => {
  notify('tunnel', st);
  if (st.url) {
    store.addLog({ type: 'system', message: `🌐 Endereço na internet ligado: ${st.url} (webhook do Instagram: ${st.url}/webhook/instagram)` });
    const current = store.settings.crm?.panelUrl || '';
    if (!current || current.includes('trycloudflare.com')) store.updateSettings({ crm: { panelUrl: st.url } });
  }
});

// ---- App ----
const app = express();
app.set('trust proxy', true);
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
  app.use((req, res, next) => {
    const [scheme, encoded] = (req.headers.authorization || '').split(' ');
    const given = scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64') : Buffer.alloc(0);
    if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return next();
    res.set('WWW-Authenticate', 'Basic realm="WhatsApp Automacao"').status(401).send('Autenticação necessária');
  });
}

app.use(express.static(path.join(ROOT, 'public')));

// Recibo para o cliente (link assinado, sem login).
app.get('/recibo/:id', (req, res) => {
  const p = payments.get(req.params.id);
  if (!p || p.status !== 'paid' || req.query.t !== payments.receiptToken(p.id)) return res.status(404).send('Recibo não encontrado');
  res.type('application/pdf').set('Content-Disposition', `inline; filename="Recibo-${String(p.receiptNo).padStart(4, '0')}.pdf"`).sendFile(payments.receiptPath(p));
});

// Marca (nome e logo) — pública, usada também na tela de login.
const BRAND_LOGO = path.join(DATA_DIR, 'brand-logo');
app.get('/api/brand', (_req, res) => res.json({ ...(store.settings.brand || {}), customLogo: fs.existsSync(BRAND_LOGO) }));
app.get('/brand/logo', (_req, res) => {
  if (fs.existsSync(BRAND_LOGO)) return res.type(fs.readFileSync(`${BRAND_LOGO}.type`, 'utf8')).sendFile(BRAND_LOGO);
  res.sendFile(path.join(ROOT, 'public', 'img', 'migra-logo.png'));
});

// ---- Login (administrador e vendedores) ----
app.get('/api/auth/state', (req, res) => {
  res.json({ needsSetup: auth.needsSetup, user: publicUser(auth.fromRequest(req)) });
});
app.post('/api/auth/setup', (req, res) => {
  if (!auth.needsSetup) throw httpError(403, 'O administrador já foi criado. Entre com login e senha.');
  const user = auth.create({ ...req.body, role: 'admin' });
  res.set('Set-Cookie', auth.sessionCookie(auth.get(user.id))).json(user);
});
app.post('/api/auth/login', (req, res) => {
  const user = auth.login(req.body.login, req.body.password);
  if (!user) throw httpError(401, 'Login ou senha incorretos');
  store.addLog({ type: 'system', message: `🔑 ${user.name} entrou no painel` });
  // Guarda o endereço público do painel para o link da ficha no aviso ao vendedor.
  const host = req.get('host') || '';
  if (user.role === 'admin' && !store.settings.crm?.panelUrl && host && !/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(host)) {
    store.updateSettings({ crm: { panelUrl: `${req.protocol}://${host}` } });
  }
  res.set('Set-Cookie', auth.sessionCookie(user)).json(publicUser(user));
});
app.post('/api/auth/logout', (_req, res) => {
  res.set('Set-Cookie', auth.clearCookie()).json({ ok: true });
});

// O que um vendedor pode acessar (o resto é só do administrador).
const SELLER_ROUTES = [
  ['GET', /^\/(status|events|me|users|pending|agent\/status|instagram\/status|crm\/agenda|crm\/stats|crm\/stages|crm\/ranking)$/],
  ['*', /^\/leads(\/|$)/],
  ['GET', /^\/conversations(\/|$)/],
  ['*', /^\/lines(\/|$)/],
  ['*', /^\/payments(\/|$)/],
  ['POST', /^\/conversations\/[^/]+\/(reply|handoff)$/],
];
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next();
  const user = auth.fromRequest(req);
  if (!user) return res.status(401).json({ error: auth.needsSetup ? 'Crie o administrador para começar' : 'Entre com seu login', login: true });
  req.user = user;
  if (user.role === 'admin') return next();
  const ok = SELLER_ROUTES.some(([method, re]) => (method === '*' || method === req.method) && re.test(req.path));
  if (!ok) return res.status(403).json({ error: 'Esta área é só do administrador' });
  if (req.method === 'DELETE' && !req.path.startsWith('/leads')) return res.status(403).json({ error: 'Esta área é só do administrador' });
  next();
});
app.get('/api/me', (req, res) => res.json(publicUser(req.user)));

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
app.get('/api/tunnel', (_req, res) => res.json({ ...tunnel.state, auto: Boolean(store.settings.instagram?.tunnel) }));
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
  ['connection', 'cloud', 'accessToken'],
  ['connection', 'cloud', 'appSecret'],
  ['agenda', 'calcom', 'apiKey'],
  ['instagram', 'accessToken'],
  ['instagram', 'appSecret'],
  ['payments', 'mercadopago', 'accessToken'],
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
app.put('/api/settings', async (req, res) => {
  const before = JSON.stringify(cloudConfig());
  const igBefore = JSON.stringify(instagramConfig());
  store.updateSettings(stripMaskedSecrets(req.body));
  // Credenciais da Meta mudaram: reconecta para validar.
  if (wa.mode === 'cloud' && JSON.stringify(cloudConfig()) !== before) wa.restart();
  if (JSON.stringify(instagramConfig()) !== igBefore) instagram.start();
  res.json(publicSettings());
});

// Agente de IA
app.get('/api/agent/status', (_req, res) => {
  const a = store.settings.agent;
  res.json({
    enabled: a.enabled,
    configured: llm.configured,
    active: agent.active,
    provider: agentConfig().provider,
    model: agentConfig().model,
    audience: a.audience,
    testNumbers: (a.testNumbers || []).length,
    business: store.settings.business.name,
    lastError: agent.lastError || null,
  });
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
  res.json(r);
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
  if (line) return lines.get(line.id)?.ownerId === user.id;
  return crm.leads.some((l) => l.ownerId === user.id && (l.conversationKey === key || l.whatsappKey === key));
}
const convLabel = (key) => {
  const line = parseLineKey(key);
  return line ? lines.get(line.id)?.label || 'Número da equipe' : String(key).startsWith('ig:') ? 'Instagram' : 'Principal';
};
app.get('/api/conversations', (req, res) => res.json(agent.listConversations().filter((c) => canSeeConv(req.user, c.key)).map((c) => ({ ...c, channelLabel: convLabel(c.key) }))));
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
  const items = pending.list().filter((p) => canSeeConv(req.user, p.jid)).map((p) => ({ ...p, channelLabel: convLabel(p.jid) }));
  res.json({ ...pending.status(), count: items.length, items });
});

// Pagamentos (Pix)
const canSeePayment = (user, p) => user.role === 'admin' || (p.leadId && crm.leads.some((l) => l.id === p.leadId && l.ownerId === user.id));
const publicPayment = (p) => {
  const lead = p.leadId ? crm.leads.find((l) => l.id === p.leadId) : null;
  return { ...p, leadName: lead?.name || '', leadCode: lead?.code || '', ownerName: crm.ownerName(lead?.ownerId), receiptUrl: p.status === 'paid' ? payments.receiptUrl(p) : '' };
};
app.get('/api/payments', (req, res) => {
  res.json(payments.list.filter((p) => canSeePayment(req.user, p)).map(publicPayment).reverse());
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
app.get('/api/payments/:id/receipt', (req, res) => {
  const p = payments.get(req.params.id);
  if (!p || p.status !== 'paid' || !canSeePayment(req.user, p)) throw httpError(404, 'Recibo não encontrado');
  res.type('application/pdf').sendFile(payments.receiptPath(p));
});

// Números da equipe (até 6). Administrador gerencia todos; o vendedor conecta o dele.
const myLine = (user, id) => {
  const line = lines.get(id);
  if (!line) throw httpError(404, 'Número não encontrado');
  if (user.role !== 'admin' && line.ownerId !== user.id) throw httpError(403, 'Este número é de outro vendedor');
  return line;
};
const publicLine = (l) => ({ ...l, ownerName: auth.get(l.ownerId)?.name || '' });
app.get('/api/lines', (req, res) => {
  res.json(lines.list().filter((l) => req.user.role === 'admin' || l.ownerId === req.user.id).map(publicLine));
});
app.post('/api/lines', (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Só o administrador adiciona números');
  res.json(lines.add(req.body));
});
app.patch('/api/lines/:id', (req, res) => {
  myLine(req.user, req.params.id);
  const patch = req.user.role === 'admin' ? req.body : { agent: req.body.agent };
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
const updater = new Updater({ root: ROOT, dataDir: DATA_DIR });
app.get('/api/update/check', async (_req, res) => res.json(await updater.check()));
app.post('/api/update', async (_req, res) => {
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
app.get('/api/users', (req, res) => {
  const list = auth.list();
  res.json(req.user.role === 'admin' ? list : list.filter((u) => u.active).map(({ id, name }) => ({ id, name })));
});
app.post('/api/users', (req, res) => res.json(auth.create(req.body)));
app.patch('/api/users/:id', (req, res) => res.json(auth.update(req.params.id, req.body)));
app.post('/api/users/:id/transfer', (req, res) => res.json(crm.transfer(req.user, req.params.id, req.body.toId || null)));

// CRM: prospectos
app.get('/api/crm/stages', (_req, res) => res.json({ stages: STAGES, packages: store.settings.crm?.packages || [] }));
app.get('/api/leads', (req, res) => res.json(crm.list(req.user, req.query)));
app.post('/api/leads', (req, res) => res.json(crm.create(req.user, req.body)));
app.post('/api/leads/from-conversation', (req, res) => {
  const conv = agent.conversation(String(req.body.key || ''), { create: false });
  if (!conv) throw httpError(404, 'Conversa não encontrada');
  const lead = crm.findForConversation({ key: conv.key, phone: conv.phone }) ||
    crm.leads.find((l) => l.id === crm.create(req.user, {
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
  const lead = crm.get(req.user, req.params.id);
  const conv = lead.conversationKey ? agent.conversation(lead.conversationKey, { create: false }) : null;
  res.json({ ...lead, conversation: conv ? conv.messages.slice(-40) : [] });
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
app.post('/api/leads/:id/confirm', (req, res) => res.json(crm.confirmSale(req.user, req.params.id)));
app.delete('/api/leads/:id', (req, res) => {
  crm.remove(req.user, req.params.id);
  res.json({ ok: true });
});

// CRM: retornos e números
app.get('/api/crm/agenda', (req, res) => res.json(crm.agenda(req.user)));
app.get('/api/crm/stats', (req, res) => {
  const ownerId = req.user.role === 'admin' ? req.query.owner || undefined : req.user.id;
  res.json(crm.stats({ from: req.query.from, to: req.query.to, ownerId }));
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
  res.json(buildRanking({ leads: crm.leads, users: auth.users, settings: store.settings, month, today: toDateStr(new Date()) }));
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
if (process.env.NODE_ENV === 'production' && !isLoopback && !PANEL_PASSWORD) {
  console.error('❌ Defina PANEL_PASSWORD no .env: o painel controla seu WhatsApp e não pode ficar aberto na internet.');
  process.exit(1);
}

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, HOST, () => {
    const url = `http://${isLoopback || HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`;
    console.log(`🚀 Painel em ${url}`);
    if (process.env.OPEN_BROWSER) {
      // Usado pelos atalhos de dois cliques: abre o painel no navegador.
      const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
      exec(cmd, () => {});
    }
    if (!PANEL_PASSWORD && !isLoopback) {
      console.warn('⚠️  Defina PANEL_PASSWORD: o painel está exposto na rede sem senha.');
    }
  });
  wa.start().catch((err) => console.error('Erro ao iniciar o WhatsApp:', err));
  instagram.start().catch((err) => console.error('Erro ao iniciar o Instagram:', err));
  lines.startAll().catch((err) => console.error('Erro ao ligar os números da equipe:', err.message));
  if (store.settings.instagram?.tunnel) tunnel.start().catch((err) => console.error('Erro ao ligar o túnel:', err.message));
  scheduler.start();
  // Retornos agendados: confere a cada 10 minutos.
  setInterval(() => notifyFollowUps().catch((err) => store.addLog({ type: 'error', message: `Retornos: ${err.message}` })), 10 * 60_000).unref();
  setTimeout(() => notifyFollowUps().catch(() => {}), 60_000).unref();
  // Pix pelo Mercado Pago: confere a cada minuto se foi pago.
  setInterval(() => payments.checkPending().catch(() => {}), 60_000).unref();

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
