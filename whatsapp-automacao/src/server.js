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
import { makeContractFlow } from './autocontract.js';
import { Learnings } from './learnings.js';
import { Payments } from './payments.js';
import { Realty, PROPERTY_TYPES } from './realty.js';
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
import { buildSystemPrompt } from './agent/prompt.js';
import { PRESETS, presetSettings } from './agent/presets.js';
import { csvToContacts, normalizePhone, randomBetween, renderTemplate, samePhone, sleep, uid } from './utils.js';

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
agent.partnerLink = () => (publicBase() ? `${publicBase()}/parceiros` : '');
// Instagram → WhatsApp: o cliente passou o número e a Migra chama no WhatsApp continuando a conversa.
agent.moveToWhatsapp = async (conv, args = {}, { dryRun } = {}) => {
  const phone = normalizePhone(args.whatsapp);
  if (!phone) return { erro: 'Número inválido. Peça o WhatsApp com DDD (e o código do país, se não for do Brasil).' };
  const first = String(args.nome || conv.name || '').trim().split(' ')[0];
  const text = String(args.primeira_mensagem || '').trim().slice(0, 400)
    || `Oi${first ? `, ${first}` : ''}! Aqui é da Migra Paraguai, continuando a nossa conversa do Instagram 😊 Por aqui eu consigo te mandar o orçamento em PDF e tudo certinho para garantir a sua reserva.`;
  if (dryRun || String(conv.key).startsWith('sim:')) return { ok: true, simulacao: true, instrucao: `Simulação: no atendimento real o cliente recebe no WhatsApp (+${phone}): "${text}". Diga que acabou de chamar no WhatsApp e que seguem por lá.` };
  const main = mainWhatsapp();
  const link = main ? `https://wa.me/${main}?text=${encodeURIComponent(`Oi! Vim do Instagram da Migra${first ? `, sou ${first}` : ''}.`)}` : '';
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
setInterval(() => followups.run().catch((e) => store.addLog({ type: 'error', message: `Retornos combinados: ${e.message}` })), 10 * 60_000).unref();
// Migra Imóveis (catálogo e loteamentos) e programa de indicação.
const realty = new Realty({ store, dataDir: DATA_DIR });
const affiliates = new Affiliates({
  store,
  crm,
  auth,
  secret: auth.secret,
  notifyAffiliate: async (phone, text) => {
    if (wa.status === 'connected') await wa.send(phone, { text, typing: false });
  },
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
  closing.onPaid(p);
  setTimeout(() => salesOnPaid(p), 0); // a venda nasce com a entrada já recebida
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
const quotes = new Quotes({ store, dataDir: DATA_DIR, secret: auth.secret, matchPackage: (n) => crm.matchPackage(n) });
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
async function sendQuote({ convKey, lead, items, adults, client, consultant, start }) {
  const q = quotes.create({ items, adults, ...(/^\d{4}-\d{2}-\d{2}$/.test(String(start || '')) ? { start } : {}), client: client || lead?.name || '', phone: lead?.phone || '', consultant, leadId: lead?.id || null, convKey });
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
    const preview = new Quotes({ store: { settings: { ...store.settings, quotes: { ...store.settings.quotes } }, data: { quotes: [] }, save() {} }, dataDir: path.join(DATA_DIR, 'tmp'), secret: auth.secret, matchPackage: (n) => crm.matchPackage(n) });
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

// Contratação, parcerias e assuntos de negócio vão direto para o WhatsApp do Marcos.
// Mentoria com o Marcos (US$ 250/h, online ou presencial): paga antes de agendar; cliente da Migra não paga.
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
agent.bookMentoring = async (conv, args = {}, { dryRun } = {}) => {
  const m = store.settings.crm?.mentoring || {};
  const brl = mentoringPriceBRL();
  const money = `R$ ${brl.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const usd = `${m.currency === 'BRL' ? 'R$' : 'US$'} ${Number(m.price || 250).toLocaleString('pt-BR')}`;
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
    const p = await payments.create({ convKey: conv.key, leadId: lead?.id || null, amount: brl, description: `Mentoria com Marcos Miguel (${m.minutes || 60} min, ${args.formato === 'presencial' ? 'presencial' : 'online'}) · valor: ${usd} (dólares americanos), pago em reais pela cotação do dia`, payerName: args.nome, payerDoc: args.cpf, by: 'IA' });
    p.purpose = 'mentoria';
    p.mentoring = { formato: args.formato === 'presencial' ? 'presencial' : 'online', assunto: String(args.assunto || '').slice(0, 300), prazo_para_agendar: String(args.prazo_para_agendar || '').slice(0, 200), nome: args.nome || '' };
    store.save();
    await payments.sendCharge(p);
    return { ok: true, valor: money, instrucao: `O QR Code e o Pix copia e cola já foram enviados logo acima (${money}). Diga que a mentoria é de 250 dólares americanos (US$ 250) e que o Pix, por ser do Brasil, é pago em reais pela cotação do dia (o valor aparece no QR Code; se o cliente perguntar quanto é, diga o valor em reais sem esconder). Explique que é só copiar o código no app do banco; assim que o pagamento for confirmado, o recibo chega aqui e a assessoria do Marcos escolhe o dia e o horário na agenda dele e confirma com ele se serve. Nunca confirme nem sugira data ou horário.` };
  } catch (e) {
    return { erro: `${e.message}. Use avisar_marcos com assunto "mentoria" para a equipe cobrar.` };
  }
};
/** Quem recebe quem quer trabalhar na Migra (Prospectos → Regras): só o nome de quem está na Equipe, ou "Nome = WhatsApp". */
const jobsContact = () => resolvePeople(store.settings.crm?.jobsContact || [], auth.users)[0] || null;
agent.notifyOwner = async (conv, args, { dryRun } = {}) => {
  // Quem quer trabalhar na Migra vai direto para o Gabriel (não para o Marcos).
  const hr = args.assunto === 'contratação' ? jobsContact() : null;
  const to = hr ? hr.name.split(' ')[0] : 'Marcos';
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
  if (dryRun || String(conv.key).startsWith('sim:')) return { ok: true, simulacao: true, instrucao: `Simulação: no atendimento real ${visitDeskName()} recebe o pedido no WhatsApp. Diga que passou o pedido para a equipe do escritório, que confirma o dia e o horário por aqui.` };
  const lead = crm.findForConversation({ key: conv.key, phone: conv.phone })
    || crm.ensureFromConversation({ key: conv.key, phone: conv.phone, name: conv.name, username: conv.username, channel: String(conv.key).startsWith('ig:') ? 'instagram' : 'whatsapp' });
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
    Number(c.consultFee ?? 150) > 0 ? `Taxa da consultoria presencial: R$ ${Number(c.consultFee ?? 150).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}, só para quem não fechar nenhum pacote; quem fecha fica isento (já incluída no contrato).` : 'A visita não tem taxa.',
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
    p ? `Pix da reserva: ${p.status === 'paid' ? 'PAGO e confirmado (recibo enviado)' : `enviado (R$ ${p.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}), aguardando pagamento`}.` : f.status === 'preenchida' ? 'Pix da reserva: ainda não enviado pelo sistema (a equipe envia os dados de pagamento).' : '',
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
// No WhatsApp de um vendedor, a atendente trabalha em nome dele.
agent.channelNote = (conv) => {
  const parsed = parseLineKey(conv.key);
  const line = parsed ? lines.get(parsed.id) : null;
  const owner = line?.ownerId ? auth.get(line.ownerId) : null;
  if (!owner) return '';
  const first = owner.name.split(' ')[0];
  return `Você atende pelo WhatsApp de ${owner.name}, consultor(a) da equipe. Os clientes daqui são de ${first}. Apresente-se como a assistente de ${first} na Migra (ex.: "Oi! Aqui é a assistente de ${first}, da Migra"). ${first} acompanha as conversas e assume quando o cliente precisar. Não encaminhe para outro vendedor: este cliente já é de ${first}.`;
};
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
  // De 1 a 15 dias: a Meta não deixa o robô responder (regra das 24h). A IA escreve a resposta
  // e a equipe envia pelo app do Instagram, no quadro de Conversas.
  const manualDays = Number(store.settings.instagram?.manualDays) || 15;
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
      lead.igDraft = { status: 'pendente', kind: 'responder', clientAt: p.at, username, name: p.name || '', texts: p.texts, text: await draftInstagram(p, username).catch(() => ''), at: new Date().toISOString() };
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
    lead.igDraft = { status: 'pendente', kind: 'retomar', clientAt: p.at, lastOurAt: p.lastOurAt, username, name: p.name || '', texts: p.texts, text: await draftInstagram(p, username, 'retomar').catch(() => ''), at: new Date().toISOString() };
    stalled++;
    drafts++;
  }
  store.save();
  store.addLog({ type: 'system', message: `📸 Direct verificado: ${recent} conversa(s) para o agente responder, ${old} antiga(s) no CRM e ${drafts} resposta(s) sugerida(s) para enviar pelo app (${stalled} para retomar conversas paradas)` });
  return { recent, old, drafts, stalled, total: new Set(msgs.map((m) => m.jid)).size };
}
/** Resposta sugerida pela IA para quem escreveu no Direct há mais de 24h (a equipe envia pelo app). */
async function draftInstagram(p, username, kind = 'responder') {
  if (!llm.configured) return '';
  const conv = agent.conversation(p.jid);
  conv.name ||= p.name || '';
  conv.username ||= username;
  if (!conv.messages.length) {
    for (const m of p.context || []) agent.remember(conv, m.role, m.content);
    if (kind === 'responder') for (const t of p.texts) agent.remember(conv, 'user', t);
  }
  const days = Math.max(1, Math.round((Date.now() - p.at) / 86_400_000));
  const extraSystem = kind === 'retomar'
    ? `# Retomar uma conversa que esfriou (a equipe envia pelo app do Instagram)
Esta conversa parou há ${days} dia(s): o cliente deixou de responder, provavelmente porque o atendimento anterior foi automático e repetitivo. Leia o que ele já disse. Escreva UMA mensagem curta e humana: saudação do horário, mostre que leu e lembrou do caso dele (use o que ele contou, com as palavras dele), não peça desculpas, apenas retome com leveza, e termine com UMA pergunta fácil que leve ao próximo passo, de preferência pedindo o WhatsApp com DDD para continuar por lá e mandar o orçamento em PDF. Não liste planos, não use menu, não use markdown, não diga que é o Marcos. Não use ferramentas.`
    : `# Resposta para a equipe enviar pelo app do Instagram
O cliente escreveu há ${days} dia(s) e ficou sem resposta. Escreva UMA mensagem curta e humana: saudação do horário, agradeça por aguardar, responda o que ele perguntou e peça o WhatsApp com DDD para mandar o orçamento certinho em PDF. Não liste planos em menu, não use markdown e não use ferramentas.`;
  const r = await agent.think(conv, { dryRun: true, delayed: kind === 'responder', extraSystem });
  return String(r.text || '').slice(0, 900);
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
// A cada 5 minutos, responde quem ficou esperando (agente fora do ar, erro da IA, mensagem perdida).
setInterval(() => pending.autoAnswer(), 5 * 60_000).unref();
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
  pending.onIncoming(msg);
  if (!msg.isGroup) {
    try {
      // Chegou no WhatsApp do vendedor com o código do Instagram: liga ao prospecto.
      if (msg.line) crm.linkByCode({ text: msg.text, key: msg.jid, phone: msg.phone });
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
});

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
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
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
app.get('/r/:code', (req, res) => {
  const { cookies, affiliate, seller } = affiliates.recordClick(req, req.params.code);
  if (cookies.length) res.set('Set-Cookie', cookies);
  // Sem destino, o link leva ao pré-cadastro (é ele que garante a comissão de quem indicou).
  const code = affiliate?.code || seller?.refCode || '';
  const to = String(req.query.to || (code ? `/indicacao?ref=${code}` : '/imoveis'));
  res.redirect(to.startsWith('/') && !to.startsWith('//') ? to : '/imoveis');
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
  res.json({ ok: true, code: lead.code, seller: owner ? first(owner.name) : '', whatsappUrl: main ? `https://wa.me/${main}?text=${encodeURIComponent(text)}` : '' });
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
  if (fs.existsSync(BRAND_LOGO)) return res.type(fs.readFileSync(`${BRAND_LOGO}.type`, 'utf8')).sendFile(BRAND_LOGO);
  res.sendFile(path.join(ROOT, 'public', 'img', 'migra-logo.png'));
});

// ---- Login (administrador e vendedores) ----
const require2fa = () => store.settings.security?.require2fa !== false;
app.get('/api/auth/state', (req, res) => {
  const u = auth.fromRequest(req);
  res.json({ needsSetup: auth.needsSetup, user: u ? { ...publicUser(u), visitDesk: isVisitDesk(u) } : null, setup2fa: Boolean(u && require2fa() && !u.totpEnabled) });
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
      notifyAdmins(`🚨 *Tentativas de senha bloqueadas no painel*\nLogin tentado: ${login || '-'}\nIP: ${ip}\nHora: ${new Date().toLocaleString('pt-BR')}\n\nSe não foi alguém da equipe, alguém está tentando entrar. Troque as senhas e ligue a verificação em duas etapas (Configurações → Segurança).`).catch(() => {});
    }
    throw httpError(401, 'Login ou senha incorretos');
  }
  // Verificação em duas etapas: pede o código do app autenticador.
  if (user.totpEnabled && !verifyTotp(user.totpSecret, req.body.code)) {
    if (req.body.code) {
      loginGuard.fail({ login, ip });
      securityEvent('codigo_errado', user, req);
      throw httpError(401, 'Código incorreto. Use o código de 6 números que aparece agora no app autenticador.');
    }
    return res.json({ needs2fa: true });
  }
  loginGuard.success({ login });
  securityEvent('entrou', user, req);
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
  res.set('Set-Cookie', auth.sessionCookie(user, { secure: req.secure })).json({ ...publicUser(user), setup2fa: require2fa() && !user.totpEnabled });
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
  ['GET', /^\/realty\//],
  ['PATCH', /^\/realty\/developments\/[^/]+\/lots\/[^/]+$/],
  ['POST', /^\/conversations\/[^/]+\/(reply|handoff)$/],
  ['*', /^\/conversations\/[^/]+\/closing(\/[a-z]+)?$/],
  ['*', /^\/security\/(2fa\/(setup|enable|disable)|logout-all)$/],
  ['*', /^\/quotes(\/|$)/],
  ['POST', /^\/closing\/link$/],
  ['POST', /^\/contract\/extract$/],
  ['GET', /^\/sales(\/summary)?$/],
  ['GET', /^\/sales\/[a-f0-9]+$/],
  ['POST', /^\/quotes\/[a-f0-9]+\/sale$/],
  ['GET', /^\/referral\/(me|qr)$/],
  ['PATCH', /^\/me\/prefs$/],
];
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/') || req.path.startsWith('/public/') || req.path.startsWith('/affiliate/')) return next();
  const user = auth.fromRequest(req);
  if (!user) return res.status(401).json({ error: auth.needsSetup ? 'Crie o administrador para começar' : 'Entre com seu login', login: true });
  req.user = user;
  // Sem a verificação em duas etapas ligada, só dá para configurá-la.
  if (require2fa() && !user.totpEnabled && !/^\/(me|security\/2fa\/(setup|enable)|brand)$/.test(req.path)) {
    return res.status(403).json({ error: 'Ligue a verificação em duas etapas para usar o sistema.', setup2fa: true });
  }
  if (user.role === 'admin') return next();
  // Quem cuida das visitas (Silvani) confirma, remarca e cancela pela aba Visitas.
  if (/^\/visits(\/[a-f0-9]+\/(confirm|reschedule|cancel|done))?$/.test(req.path) && isVisitDesk(user)) return next();
  const ok = SELLER_ROUTES.some(([method, re]) => (method === '*' || method === req.method) && re.test(req.path));
  if (!ok) return res.status(403).json({ error: 'Esta área é só do administrador' });
  if (req.method === 'DELETE' && !req.path.startsWith('/leads')) return res.status(403).json({ error: 'Esta área é só do administrador' });
  next();
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
  store.save();
  securityEvent('2fa_ligada', u, req);
  res.set('Set-Cookie', auth.sessionCookie(u, { secure: req.secure })).json({ ok: true });
});
app.post('/api/security/2fa/disable', (req, res) => {
  const u = req.user;
  if (!auth.login(u.login, req.body.password) || !verifyTotp(u.totpSecret, req.body.code)) throw httpError(400, 'Senha ou código incorretos');
  u.totpEnabled = false;
  delete u.totpSecret;
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
app.put('/api/settings', async (req, res) => {
  const before = JSON.stringify(cloudConfig());
  const igBefore = JSON.stringify(instagramConfig());
  store.updateSettings(stripMaskedSecrets(req.body));
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
  store.updateSettings({ agent: patch });
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
  res.json({ ...pending.status(), count: items.length, items, maxDays: Number(store.settings.agent?.pendingMaxDays || 15) });
});

// Migra Imóveis (administração)
const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12_000_000 } }).single('file');
const imageExt = (file) => {
  if (!file || !/^image\/(png|jpeg|webp)$/.test(file.mimetype)) throw httpError(400, 'Envie uma imagem PNG, JPG ou WEBP');
  return { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[file.mimetype];
};
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
  // Vendedor só muda a situação (reservar/vender); o resto é do administrador.
  const body = req.user.role === 'admin' ? req.body : { status: req.body.status };
  if (req.user.role !== 'admin') {
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
app.get('/api/affiliates', (_req, res) => res.json(affiliates.adminList()));
app.get('/api/affiliates-meta', (_req, res) => res.json({ categories: affiliates.categories(), services: affiliates.services }));
app.patch('/api/affiliates/:id', (req, res) => res.json(affiliates.publicAffiliate(affiliates.update(req.params.id, req.body))));
app.get('/api/affiliates-commissions', (_req, res) => res.json(affiliates.adminCommissions()));
app.post('/api/affiliates-commissions/:id/paid', (req, res) => res.json(affiliates.markPaid(req.params.id, { by: req.user.name, note: req.body?.note })));
app.post('/api/affiliates-commissions/:id/cancel', (req, res) => res.json(affiliates.cancelCommission(req.params.id)));

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

// Números da equipe. O administrador gerencia todos; o vendedor conecta o dele.
const myLine = (user, id) => {
  const line = lines.get(id);
  if (!line) throw httpError(404, 'Número não encontrado');
  if (user.role !== 'admin' && line.ownerId !== user.id) throw httpError(403, 'Este número é de outro vendedor');
  return line;
};
const publicLine = (l) => {
  const owner = auth.get(l.ownerId);
  return { ...l, label: owner?.name || l.label, ownerName: owner?.name || '', ownerWhatsapp: owner?.whatsapp || '' };
};
app.get('/api/lines', (req, res) => {
  res.json(lines.list().filter((l) => req.user.role === 'admin' || l.ownerId === req.user.id).map(publicLine));
});
app.post('/api/lines', (req, res) => {
  // O vendedor conecta o próprio WhatsApp; o administrador conecta o de qualquer pessoa da equipe.
  const ownerId = req.user.role === 'admin' ? req.body.ownerId || null : req.user.id;
  const owner = ownerId ? auth.get(ownerId) : null;
  if (ownerId && !owner) throw httpError(404, 'Vendedor não encontrado');
  res.json(publicLine(lines.add({ label: owner?.name || req.body.label, ownerId })));
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
const updater = new Updater({ root: ROOT, dataDir: DATA_DIR, token: () => process.env.GITHUB_TOKEN || store.settings.updater?.token || '' });
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
app.patch('/api/users/:id', (req, res) => {
  const user = auth.update(req.params.id, req.body);
  // A conexão do vendedor leva o nome dele.
  const line = lines.byOwner(user.id);
  if (line && line.label !== user.name) lines.update(line.id, { label: user.name });
  // Trocou o WhatsApp do cadastro: confere de novo com o número conectado.
  if (line?.phone && req.body.whatsapp !== undefined) lines.update(line.id, { verified: user.whatsapp ? samePhone(user.whatsapp, line.phone) : null });
  res.json(user);
});
app.post('/api/users/:id/approve', async (req, res) => {
  const u = auth.get(req.params.id);
  if (!u) throw httpError(404, 'Usuário não encontrado');
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
  if (!u.pending) throw httpError(400, 'Só dá para recusar cadastros que aguardam liberação');
  auth.remove(u.id);
  securityEvent('cadastro_recusado', req.user, req, u.name);
  notify('users', {});
  res.json({ ok: true });
});
app.post('/api/users/:id/transfer', (req, res) => res.json(crm.transfer(req.user, req.params.id, req.body.toId || null)));

// CRM: prospectos
app.get('/api/crm/stages', (_req, res) => res.json({ stages: STAGES, packages: store.settings.crm?.packages || [] }));
app.get('/api/leads', (req, res) => res.json(crm.list(req.user, req.query)));
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
const fichaMessage = (name, url) => `Oi${name ? `, ${String(name).split(' ')[0]}` : ''}! Para eu deixar tudo pronto para você, é só tocar no link abaixo e preencher os seus dados. Leva uns 2 minutos e não precisa copiar nem colar nada: cada campo explica o que colocar, e o CEP já completa o endereço sozinho.\n\n${url}\n\nNo final, toque em "Enviar meus dados". Se travar em algum campo, me chama aqui que eu te ajudo. 😊`;
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
  // O cliente tinha pedido o contrato: com a ficha preenchida, ele sai sozinho.
  if (f.contractRequested || lead?.contractRequested) {
    await sendContractTo({ convKey: f.convKey, lead, quote: q, client: pickClient(f.data) }).catch((e) => store.addLog({ type: 'error', message: `Contrato automático: ${e.message}` }));
  }
};
// Orçamentos: cada vendedor vê os dele; o administrador vê todos.
const canSeeQuote = (user, q) => user.role === 'admin' || q.createdBy?.id === user.id;
const quoteView = (q) => ({
  id: q.id, number: q.number, client: q.client, phone: q.phone, consultant: q.consultant, total: q.plan.total, entry: q.plan.entry,
  items: q.items.map((r) => ({ name: r.name, qty: r.qty })), issued: q.issued, validUntil: q.validUntil, leadId: q.leadId,
  createdBy: q.createdBy?.name || '', createdAt: q.createdAt, custom: Boolean(q.plan.custom), hasContract: Boolean(q.contract), contractSigned: q.contract?.status === 'assinado', sale: sales.list.find((s) => s.quoteId === q.id && s.status !== 'cancelada')?.number || '',
  expired: q.validUntil < new Date().toISOString().slice(0, 10),
  url: `/api/quotes/${q.id}/pdf`, publicUrl: quoteLink(q),
});
app.get('/api/quotes', (req, res) => {
  const term = String(req.query.q || '').toLowerCase().trim();
  const list = quotes.list.filter((q) => canSeeQuote(req.user, q))
    .filter((q) => !term || [q.number, q.client, q.phone, q.consultant].some((x) => String(x || '').toLowerCase().includes(term)))
    .slice(-300).reverse().map(quoteView);
  res.json(list);
});
// Prévia ao vivo (sem número, sem gravar).
app.post('/api/quotes/preview', (req, res) => {
  const b = req.body || {};
  const r = quotes.compute({ items: b.items, adults: b.adults, start: b.start, parcels: b.parcels });
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
    consultant: req.user.name, leadId: lead?.id || null, convKey: key, start: b.start, parcels: b.parcels,
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
const pickClient = (src = {}) => Object.fromEntries(CONTRACT_FIELDS.map((k) => [k, String(src[k] ?? '').replace(/\s+/g, ' ').trim().slice(0, k === 'acompanhantes' ? 600 : 200)]));
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
app.post('/api/quotes/:id/contract', (req, res) => {
  const q = quotes.list.find((x) => x.id === req.params.id);
  if (!q || !canSeeQuote(req.user, q)) throw httpError(404, 'Orçamento não encontrado');
  const client = pickClient(req.body?.client || {});
  if (!client.nome) throw httpError(400, 'Informe o nome completo do contratante');
  if (q.contract?.status === 'assinado') throw httpError(400, 'Este contrato já foi assinado pelo cliente e não pode ser alterado. Para mudar algo, faça um novo orçamento.');
  fs.mkdirSync(contractDir, { recursive: true });
  fs.writeFileSync(contractFile(q), contractPdf({ client, quote: q, cfg: store.settings.contract || {} }));
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
    fs.writeFileSync(contractFile(q), contractPdf({ client, quote: q, cfg: store.settings.contract || {} }));
    q.contract = { ...(q.contract || {}), client, at: new Date().toISOString(), by: user?.name || 'Sistema', status: 'enviado', signedAt: null };
    store.save();
  }
  if (!q.contract?.client?.nome) throw httpError(400, 'Gere o contrato com os dados do cliente primeiro.');
  const url = contractSignUrl(q);
  const first = q.contract.client.nome.split(' ')[0];
  const ct = `CT-${q.number.replace(/^ORC-/, '')}`;
  return { url, text: `${first}, preparei o seu contrato (${ct}) com os seus dados e as condições combinadas. É só tocar no link, ler com calma e assinar pelo celular mesmo, com o dedo:\n\n${url}\n\nNo final, você recebe aqui a sua via assinada. Qualquer dúvida, me chama. 😊` };
}
// ---------- Contrato automático pela atendente de IA ----------
const contractFlow = makeContractFlow({
  store, crm, closing, auth, lines, parseLineKey, samePhone, pickClient, publicBase,
  quotes: () => quotes.list,
  prepare: (q, client) => prepareContractSign(q, client, { name: 'IA' }),
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
app.post('/api/quotes/:id/contract/sign-link', async (req, res) => {
  const q = quotes.list.find((x) => x.id === req.params.id);
  if (!q || !canSeeQuote(req.user, q)) throw httpError(404, 'Orçamento não encontrado');
  const r = prepareContractSign(q, req.body?.client ? pickClient(req.body.client) : null, req.user);
  let sent = false;
  if (req.body?.send && q.convKey && (wa.isConnected ? wa.isConnected(q.convKey) : wa.status === 'connected')) {
    await wa.send(q.convKey, { text: r.text, typing: false });
    const conv = agent.conversation(q.convKey, { create: false });
    if (conv) agent.remember(conv, 'assistant', r.text);
    sent = true;
  }
  if (q.leadId) crm.addNote(req.user, q.leadId, '✍️ Contrato enviado para assinatura pelo celular');
  res.json({ ...r, sent });
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
  fs.writeFileSync(signedFile(q), contractPdf({ client: c.client, quote: q, cfg: store.settings.contract || {}, issued: c.at?.slice(0, 10), sign }));
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
  } else if (act === 'pix') {
    const c = store.settings.payments || {};
    if (c.enabled === false || !(c.pixKey || c.mercadopago?.accessToken)) throw httpError(400, 'O Pix não está configurado (Configurações → Pagamentos).');
    const adults = Number(filled?.adultos) || quote?.plan?.adults || lead?.people || 1;
    const p = await payments.create({ convKey: conv.key, leadId: lead?.id || null, amount: payments.reservationAmount(adults), description: `${c.reservation?.description || 'reserva'} - ${adults} adulto(s)`, payerName: filled?.nome || '', payerDoc: filled?.cpf || '', by: req.user.name });
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
app.get('/api/sales', (req, res) => res.json(sales.listFor(req.user, req.query)));
app.get('/api/sales/summary', (req, res) => {
  const out = sales.summary(req.user, req.query);
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
  return { ...v, leadCode: lead?.code || '', ownerName: lead?.ownerId ? auth.get(lead.ownerId)?.name || '' : '' };
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
