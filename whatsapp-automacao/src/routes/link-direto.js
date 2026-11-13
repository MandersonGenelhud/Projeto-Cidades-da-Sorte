// LINK DIRETO PARA O VENDEDOR (rodízio sem passar pela atendente): o anúncio aponta para https://<painel>/v (ou /v/<campanha>).
// Quem clica é levado na hora ao WhatsApp do PRÓXIMO vendedor do rodízio de documentação (o Diego, que é só de imóveis, fica fora),
// com a mensagem pronta e um código de anúncio ("AN-7K3Q"). O cliente só toca em "enviar": não há botão extra nem atendente no meio.
// Quando ele escreve no número do vendedor, o sistema reconhece o código: marca a chegada, liga o prospecto ao vendedor e ao anúncio.
// Cuidados: o robô que monta a miniatura do link (Meta, WhatsApp) não conta como clique; a mesma pessoa que clica de novo (24 h) volta
// para o MESMO vendedor e o mesmo código; sem vendedor disponível, vai para a Central (nunca fica sem destino).
import crypto from 'node:crypto';

const LINK_BOT = /whatsapp|facebookexternalhit|facebot|meta-externalagent|twitterbot|telegrambot|slackbot|linkedinbot|discordbot|bot\b|crawler|spider|preview/i;
const CODE_RE = /\bAN-[A-Z0-9]{4}\b/i;
const COOKIE = 'mg_v';
const DAY = 86_400_000;
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const digits = (p) => String(p || '').replace(/\D/g, '');
const clean = (s, n = 60) => String(s || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, n);

/** Texto pronto que o cliente manda ao vendedor. */
export const directText = (seller, code) => `Olá${firstName(seller?.name) ? ` ${firstName(seller.name)}` : ''}, vim pelo anúncio da Migra e quero atendimento. Meu código é ${code}.`;
export const waLink = (phone, text) => `https://wa.me/${digits(phone)}?text=${encodeURIComponent(text)}`;
export const codeIn = (text) => (String(text || '').match(CODE_RE)?.[0] || '').toUpperCase();

/**
 * ctx: { store, auth, crm, lines, wa, pool(u) (quem entra no rodízio), centralPhone(), needAdmin, httpError, publicBase(), now() }
 * Devolve { onIncoming(msg, lead), click(req) } para o servidor ligar no recebimento de mensagens e nos testes.
 */
export function registerLinkDiretoRoutes(app, ctx) {
  const { store, crm, lines } = ctx;
  const now = () => (ctx.now ? ctx.now() : Date.now());
  const cfg = () => store.settings.crm?.directLink || {};
  const clicks = () => (store.data.directClicks ||= {}); // código → { code, sellerId, sellerName, phone, campanha, at, arrivedAt, key }

  const newCode = () => {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (;;) { const c = `AN-${Array.from(crypto.randomBytes(4), (b) => A[b % A.length]).join('')}`; if (!clicks()[c]) return c; }
  };
  /** Telefone para onde mandar o cliente: o WhatsApp do vendedor conectado ao sistema (para a conversa aparecer no Hub) ou o do cadastro. */
  const phoneOf = (u) => {
    const line = lines.byOwner?.(u.id);
    return digits(line?.phone || u.whatsapp);
  };
  const connected = (u) => { const line = lines.byOwner?.(u.id); return Boolean(line && ctx.wa?.isConnected?.(`l:${line.id}:1@s.whatsapp.net`)); };

  /** Próximo do rodízio (prefere quem tem o WhatsApp conectado ao sistema) e já avança a vez dele. */
  function nextSeller() {
    const ok = (u) => ctx.pool(u) && phoneOf(u).length >= 10;
    const seller = crm.nextSeller((u) => ok(u) && connected(u)) || crm.nextSeller(ok);
    if (!seller) return null;
    store.data.rotationSeq = (store.data.rotationSeq || 0) + 1;
    seller.rotationSeq = store.data.rotationSeq;
    seller.lastLeadAt = new Date(now()).toISOString();
    seller.leadsReceived = (seller.leadsReceived || 0) + 1;
    return seller;
  }

  /** Um clique no link. Devolve { url, code, seller } (sem gravar nada se for robô). */
  function click({ ua = '', cookie = '', campanha = '' } = {}) {
    const central = digits(ctx.centralPhone?.());
    const toCentral = () => ({ url: central ? waLink(central, 'Olá! Vim pelo anúncio da Migra e quero atendimento.') : '', code: '', seller: null });
    if (cfg().enabled === false) return toCentral();
    if (LINK_BOT.test(ua)) return toCentral(); // miniatura do link: não conta, não gasta a vez de ninguém
    // A mesma pessoa clicou de novo (até 24 h): mesmo vendedor e mesmo código.
    const prev = cookie && clicks()[cookie];
    if (prev && now() - Date.parse(prev.at) < DAY) {
      const u = ctx.auth.get(prev.sellerId);
      if (u && ctx.pool(u)) return { url: waLink(prev.phone, directText(u, prev.code)), code: prev.code, seller: u, repeat: true };
    }
    const seller = nextSeller();
    if (!seller) { store.addLog({ type: 'error', message: 'Link direto do anúncio: nenhum vendedor no rodízio. O cliente foi para a Central.' }); return toCentral(); }
    const code = newCode();
    const phone = phoneOf(seller);
    clicks()[code] = { code, sellerId: seller.id, sellerName: seller.name, phone, campanha: clean(campanha), at: new Date(now()).toISOString(), arrivedAt: null, key: '' };
    // Limpa cliques com mais de 60 dias.
    for (const [c, x] of Object.entries(clicks())) if (now() - Date.parse(x.at) > 60 * DAY) delete clicks()[c];
    store.save();
    return { url: waLink(phone, directText(seller, code)), code, seller };
  }

  /** Mensagem recebida: se traz um código de anúncio, liga o cliente ao vendedor e ao anúncio. */
  function onIncoming(msg, lead) {
    if (!msg || msg.isGroup || msg.fromMe) return null;
    const code = codeIn(msg.text);
    const c = code && clicks()[code];
    if (!c || c.arrivedAt) return null;
    c.arrivedAt = new Date(now()).toISOString();
    c.key = msg.jid;
    if (lead) {
      if (!lead.ownerId || lead.ownerId !== c.sellerId) {
        try { crm.assign?.({ name: 'Sistema', role: 'admin' }, lead.id, c.sellerId, 'link direto do anúncio (rodízio)'); } catch { lead.ownerId = c.sellerId; }
      }
      if (!lead.adTitle) lead.adTitle = c.campanha ? `Link direto: ${c.campanha}` : 'Link direto do anúncio';
      if (!lead.source || lead.source === 'whatsapp') lead.source = 'link_anuncio';
      try { crm.addNote({ name: 'Sistema', role: 'admin' }, lead.id, `O cliente veio pelo link direto do anúncio${c.campanha ? ` (${c.campanha})` : ''} e falou com ${c.sellerName} (código ${code}).`); } catch { /* a nota nunca derruba o recebimento */ }
    }
    store.save();
    return c;
  }

  // Link público (vai no anúncio). /v e /v/<campanha>.
  const handler = (req, res) => {
    const cookie = String(req.headers.cookie || '').split(/;\s*/).find((x) => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || '';
    const r = click({ ua: String(req.get('user-agent') || ''), cookie: decodeURIComponent(cookie), campanha: req.params.campanha || req.query.c || req.query.utm_campaign || '' });
    if (r.code && !r.repeat) res.append('Set-Cookie', `${COOKIE}=${encodeURIComponent(r.code)}; Max-Age=86400; Path=/v; SameSite=Lax; HttpOnly${req.secure ? '; Secure' : ''}`);
    if (!r.url) return res.status(503).type('text/plain').send('Atendimento indisponível no momento. Tente de novo em instantes.');
    res.set('Cache-Control', 'no-store').redirect(302, r.url);
  };
  app.get('/v', handler);
  app.get('/v/:campanha', handler);

  // Painel (administrador): o link, quem está no rodízio e os números de hoje.
  app.get('/api/link-direto', (req, res) => {
    ctx.needAdmin(req);
    const base = ctx.publicBase();
    const today = new Date(now()).toLocaleDateString('en-CA', { timeZone: 'America/Asuncion' });
    const per = {};
    for (const x of Object.values(clicks())) {
      if (new Date(x.at).toLocaleDateString('en-CA', { timeZone: 'America/Asuncion' }) !== today) continue;
      const p = (per[x.sellerName] ||= { vendedor: x.sellerName, cliques: 0, chegaram: 0 });
      p.cliques += 1; if (x.arrivedAt) p.chegaram += 1;
    }
    const rodizio = ctx.auth.users.filter((u) => ctx.pool(u)).map((u) => ({ nome: u.name, conectado: connected(u), temNumero: phoneOf(u).length >= 10 }));
    res.json({ enabled: cfg().enabled !== false, url: base ? `${base}/v` : '/v', rodizio, hoje: Object.values(per).sort((a, b) => b.cliques - a.cliques) });
  });
  app.put('/api/link-direto', (req, res) => {
    ctx.needAdmin(req);
    store.updateSettings({ crm: { directLink: { enabled: req.body?.enabled !== false } } });
    res.json({ enabled: req.body?.enabled !== false });
  });

  return { onIncoming, click };
}
