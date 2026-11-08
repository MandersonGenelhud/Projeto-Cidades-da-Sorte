// Rotas do painel de FECHAMENTOS (só administrador): funil depois do orçamento, checklist de acompanhamento, radar de objeções
// e o Plano em PDF (valor, arquivo oficial ou PDF-base). Isoladas do server.js: o servidor só chama registerFechamentosRoutes(app, ctx).
import fs from 'node:fs';
import { buildClosings } from '../fechamentos.js';
import { planPdfPrice, loadPlanPdf, hasOfficialPlanPdf, planPdfFile } from '../plano-pdf.js';

/** ctx: { needAdmin, httpError, securityEvent, store, crm, quotes, payments, dataDir } */
export function registerFechamentosRoutes(app, ctx) {
  const { needAdmin, httpError, securityEvent, store, crm, quotes, payments, dataDir, flashOffer, wa } = ctx;
  app.get('/api/fechamentos', (req, res) => {
    needAdmin(req);
    const days = Math.min(180, Math.max(7, Number(req.query.days) || 60));
    const r = buildClosings({ store, quotes: quotes.list, payments: payments.list, leadOf: (c) => crm.findForConversation({ key: c.key, phone: c.phone, username: c.username }), days });
    const plano = payments.list.filter((p) => p.purpose === 'plano_pdf');
    res.json({ ...r, planoPdf: { preco: planPdfPrice(store.settings), oficial: hasOfficialPlanPdf(dataDir), vendidos: plano.filter((p) => p.status === 'paid').length, aguardando: plano.filter((p) => p.status === 'pending').length } });
  });
  app.get('/api/plano-pdf', (req, res) => {
    needAdmin(req);
    const { buffer } = loadPlanPdf({ dataDir, company: store.settings.business?.name });
    res.set('Cache-Control', 'no-store').type('application/pdf').set('Content-Disposition', 'inline; filename="plano-entrada-sozinho.pdf"').send(buffer);
  });
  // Troca o PDF-base pelo arquivo oficial (base64 em JSON, até ~3,5 MB) ou volta ao PDF-base (remove: true).
  app.post('/api/plano-pdf', (req, res) => {
    needAdmin(req);
    if (req.body?.remove === true) { try { fs.unlinkSync(planPdfFile(dataDir)); } catch { /* já não existia */ } securityEvent('plano_pdf_base', req.user, req, 'Voltou ao PDF-base do plano'); return res.json({ oficial: false });
    }
    const buf = Buffer.from(String(req.body?.base64 || ''), 'base64');
    if (buf.length < 200 || buf.slice(0, 5).toString() !== '%PDF-') throw httpError(400, 'Envie um arquivo PDF válido.');
    if (buf.length > 3_500_000) throw httpError(400, 'O PDF passou de 3,5 MB. Reduza o arquivo.');
    fs.writeFileSync(planPdfFile(dataDir), buf, { mode: 0o600 });
    securityEvent('plano_pdf_oficial', req.user, req, `Arquivo oficial do plano em PDF cadastrado (${Math.round(buf.length / 1024)} KB)`);
    res.json({ oficial: true });
  });
  // Oferta relâmpago: vagas reais, quem reservou, confirmar (pagamento à vista recebido) ou liberar; contar as pessoas dos grupos (só leitura).
  app.get('/api/flash-offer', (req, res) => {
    needAdmin(req);
    res.json({ ...flashOffer.status(), config: { validUntil: flashOffer.cfg.validUntil, spots: flashOffer.cfg.spots, groupPeople: flashOffer.cfg.groupPeople || 0, title: flashOffer.cfg.title }, claims: flashOffer.list().slice(0, 100) });
  });
  app.post('/api/flash-offer/claims/:id/:action', (req, res) => {
    needAdmin(req);
    const a = req.params.action;
    if (!['confirm', 'release'].includes(a)) throw httpError(404, 'Ação desconhecida');
    const c = a === 'confirm' ? flashOffer.confirm(req.params.id, req.user.name) : flashOffer.release(req.params.id, req.user.name);
    securityEvent(a === 'confirm' ? 'oferta_vaga_confirmada' : 'oferta_vaga_liberada', req.user, req, `${a === 'confirm' ? 'Pagamento à vista confirmado' : 'Vaga liberada'}: ${c.name || c.phone}`);
    res.json(c);
  });
  app.post('/api/flash-offer/count-groups', async (req, res) => {
    needAdmin(req);
    const groups = await wa.getGroups();
    const all = new Set();
    for (const g of groups) { try { for (const p of await wa.getGroupParticipants(g.id)) { const d = String(p).replace(/\D/g, ''); if (d.length >= 8) all.add(d); } } catch { /* grupo que não abriu: segue */ } }
    store.updateSettings({ crm: { flashOffer: { groupPeople: all.size } } });
    securityEvent('oferta_contar_grupos', req.user, req, `${all.size} pessoas únicas em ${groups.length} grupos`);
    res.json({ groups: groups.length, people: all.size });
  });
}
