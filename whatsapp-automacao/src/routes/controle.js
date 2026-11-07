// Rotas de CONTROLE das conversas e do atendimento (só administrador): quadros por pessoa, auditoria dos números, envio por número,
// controle do rodízio e dos fechamentos, baixas feitas pela Maria e o botão "recomeçar atendimentos parados".
// Estas rotas saíram do server.js para ficarem isoladas: o servidor só chama registerControleRoutes(app, ctx) e usa o que ela devolve.
import { conversationBoards } from '../attendants.js';
import { auditMessaging } from '../messaging-audit.js';
import { cleanProfile, profileFor } from '../send-profiles.js';
import { distributionReport } from '../distribution.js';
import { noticeExpiringQuotes } from '../quote-expiry.js';
import { restartStalled } from '../restart.js';

/** ctx: { needAdmin, httpError, inOffice, store, auth, crm, agent, pending, lines, wa, sales, quotes, securityEvent, conversationOffice, convLabel, lineOwnerOf } */
export function registerControleRoutes(app, ctx) {
  const { needAdmin, httpError, inOffice, store, auth, crm, agent, pending, lines, wa, sales, securityEvent, conversationOffice, convLabel, lineOwnerOf } = ctx;
// Quadros: um por pessoa da equipe, um da IA ainda sem direcionar e um por número da equipe sem dono, com "como está respondendo" (só administrador).
app.get('/api/conversations-boards', (req, res) => {
  needAdmin(req);
  const convs = agent.listConversations().filter((c) => inOffice(req, conversationOffice(c)));
  res.json({ boards: conversationBoards({ conversations: convs.map((c) => ({ ...c, channelLabel: convLabel(c.key) })), users: auth.users, lineOwner: lineOwnerOf, findLead: (x) => crm.findForConversation({ key: x.key, phone: x.phone, username: x.username }) }) });
});
// Recomeçar os atendimentos parados dos últimos 30 dias (todos os números): a IA lê as últimas 20 mensagens, confere se é assunto da Migra e retoma.
// Orçamentos que vencem hoje ou amanhã: ver quem seria avisado (GET) e avisar pela fila da IA (POST). Cada orçamento é avisado uma vez só.
const noticeQuotes = (opts = {}) => noticeExpiringQuotes({
  store, agent, pending, quotes: quotes.list, sales: sales.list, now: Date.now(),
  leadOf: (c) => crm.findForConversation({ key: c.key, phone: c.phone, username: c.username }), isBlocked: (p) => store.isBlacklisted(p), ...opts,
});
app.get('/api/quotes-expiring', (req, res) => {
  needAdmin(req);
  res.json(noticeQuotes({ dryRun: true }));
});
app.post('/api/quotes-expiring/notify', (req, res) => {
  needAdmin(req);
  const r = noticeQuotes({ dryRun: false });
  securityEvent('avisar_orcamentos_vencendo', req.user, req, `${r.total} orçamento(s) vencendo: ${r.queued} avisos entraram na fila da IA`);
  res.json(r);
});
const restartAll = (opts = {}) => restartStalled({
  store, agent, pending, now: Date.now(),
  leadOf: (c) => crm.findForConversation({ key: c.key, phone: c.phone, username: c.username }), isBlocked: (p) => store.isBlacklisted(p), ...opts,
});
app.post('/api/restart-stalled', (req, res) => {
  needAdmin(req);
  const b = req.body || {};
  const r = restartAll({ days: Math.min(60, Math.max(1, Number(b.days) || 30)), includeSilent: b.includeSilent !== false, dryRun: b.dryRun === true });
  if (!r.dryRun) securityEvent('recomecar_atendimentos', req.user, req, `${r.total} conversa(s) paradas: ${r.queued} entraram na fila da IA`);
  res.json(r);
});
// Baixas de pagamento feitas pela Maria a partir do comprovante (só administrador): quem mandou, de quem era, e se foi baixa direta ou ficou para conferir.
app.get('/api/maria-receipts', (req, res) => {
  needAdmin(req);
  res.json({ items: [...(store.data.mariaReceipts || [])].reverse().slice(0, 100).map(({ file, hash, ...r }) => ({ ...r, hasFile: Boolean(file) })) });
});
// Controle do rodízio e dos fechamentos: quantos clientes a central entregou a cada vendedor, por onde chegaram, quanto demoraram a atender,
// quantos viraram proposta e contrato, e quem está com cliente parado (só administrador, só leitura).
const convOfLead = (l) => (l.conversationKey ? agent.conversation(l.conversationKey, { create: false }) : null);
app.get('/api/distribution', (req, res) => {
  needAdmin(req);
  const today = new Date().toISOString().slice(0, 10);
  const days = Math.min(60, Math.max(1, Number(req.query.days) || 14));
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || '')) ? String(req.query.from) : new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || '')) ? String(req.query.to) : today;
  const leads = crm.leads.filter((l) => inOffice(req, crm.officeOf(l)));
  const convs = agent.listConversations().filter((c) => !c.simulation);
  res.json(distributionReport({
    leads, users: auth.users, rotation: crm.rotation(), sales: sales.listFor(req.user, { from, to }), convOf: convOfLead, from, to, days,
    slaHours: Number(store.settings.crm?.sla?.hours) || 2, conversations: convs.filter((c) => { const d = String(c.updatedAt || '').slice(0, 10); return d >= from && d <= to; }).length,
  }));
});
// Auditoria das conversas e mapa de mensagens por número e por cliente (só administrador, só leitura).
app.get('/api/audit/messaging', (req, res) => {
  needAdmin(req);
  const days = Math.min(60, Math.max(1, Number(req.query.days) || 14));
  const convs = Object.values(store.data.conversations || {}).filter((c) => inOffice(req, conversationOffice(c)));
  const lineList = lines.list();
  const report = auditMessaging({
    conversations: convs, lines: lineList, settings: store.settings, days,
    findLead: (c) => { const l = crm.findForConversation({ key: c.key, phone: c.phone, username: c.username }); return l ? crm.view(l) : null; },
    ownerName: (id) => auth.get(id)?.name || '',
    senderLabel: (k) => pending.senderLabel(k),
    isConnected: (key) => (wa.isConnected ? wa.isConnected(key) : wa.status === 'connected'),
    blacklisted: (phone) => Boolean(phone) && store.isBlacklisted(phone),
    llmOn: Boolean(agent.active),
  });
  const only = String(req.query.sender || '');
  res.json(only ? { ...report, map: report.map.filter((m) => m.sender === only) } : report);
});
// Configuração de envio de cada número (principal, Instagram e o WhatsApp de cada vendedor): cada um com o seu limite, intervalo, horário e ritmo humano.
const sendSenders = () => [
  { key: 'principal', label: pending.senderLabel('principal') },
  { key: 'instagram', label: pending.senderLabel('instagram') },
  ...lines.list().map((l) => ({ key: `linha:${l.id}`, label: pending.senderLabel(`linha:${l.id}`) })),
];
app.get('/api/send-profiles', (req, res) => {
  needAdmin(req);
  res.json({ defaults: profileFor({ agent: store.settings.agent }, 'principal', { delay: pending.delay }), senders: sendSenders().map((x) => ({ ...x, own: store.settings.sendProfiles?.[x.key] || {}, effective: profileFor(store.settings, x.key, { delay: pending.delay }), sentToday: pending.status().bySender.find((b) => b.key === x.key)?.sentLastHour ?? 0 })) });
});
app.put('/api/send-profiles/:key', (req, res) => {
  needAdmin(req);
  const key = String(req.params.key);
  if (!sendSenders().some((x) => x.key === key)) throw httpError(404, 'Número não encontrado');
  const own = cleanProfile(req.body || {});
  store.data.settings.sendProfiles = { ...(store.settings.sendProfiles || {}) };
  if (Object.keys(own).length) store.data.settings.sendProfiles[key] = own; else delete store.data.settings.sendProfiles[key];
  store.save();
  securityEvent('envio_por_numero', req.user, req, `${pending.senderLabel(key)}: ${Object.keys(own).length ? JSON.stringify(own) : 'voltou ao padrão geral'}`);
  res.json({ key, own, effective: profileFor(store.settings, key, { delay: pending.delay }) });
});
  return { restartAll, convOfLead, noticeQuotes };
}
