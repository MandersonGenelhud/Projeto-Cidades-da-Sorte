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
import { PendingInbox } from './pending.js';
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

const wa = new ConnectionManager({
  store,
  instagram,
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

wa.on('status', (state) => {
  notify('status', state);
  if (state.status === 'connected') console.log(`✅ WhatsApp conectado: ${state.me?.phone}`);
  if (state.error) console.log(`⚠️  Conexão: ${state.error}`);
  if (state.status === 'qr') console.log(`📱 Abra http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT} e escaneie o QR Code`);
});
wa.on('log', (entry) => store.addLog(entry));
wa.on('instagramStatus', (state) => {
  notify('instagramStatus', state);
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
wa.on('message', (msg) => {
  pending.onIncoming(msg);
  notify('message', msg);
  autoReply.handle(msg).catch((err) => store.addLog({ type: 'error', message: err.message }));
});

store.on('log', (log) => notify('log', log));

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
app.get('/api/connection/info', (req, res) => {
  const c = cloudConfig();
  res.json({
    mode: wa.mode,
    webhookUrl: `${req.protocol}://${req.get('host')}/webhook`,
    instagramWebhookUrl: `${req.protocol}://${req.get('host')}/webhook/instagram`,
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
  });
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
app.get('/api/conversations', (_req, res) => res.json(agent.listConversations()));
app.get('/api/conversations/:key', (req, res) => {
  const conv = agent.conversation(req.params.key, { create: false });
  if (!conv) throw httpError(404, 'Conversa não encontrada');
  res.json(conv);
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
  store.addLog({ type: 'sent', phone: conv.phone || conv.key, message: text });
  res.json(conv);
});
app.delete('/api/conversations/:key', (req, res) => {
  agent.clearConversation(req.params.key);
  res.json({ ok: true });
});

// Conversas sem resposta
app.get('/api/pending', (_req, res) => res.json({ ...pending.status(), items: pending.list() }));
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

export { app, store, wa, agent };

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
  scheduler.start();

  const shutdown = async () => {
    scheduler.stop();
    store.flush();
    await wa.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
