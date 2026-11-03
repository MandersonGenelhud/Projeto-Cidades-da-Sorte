// Marketing: traz os números dos anúncios da Meta (Facebook e Instagram) para o painel, em português simples.
// A chave de acesso é colada pelo próprio administrador nas configurações (nunca no chat) e só é usada para LER os números: este módulo não cria nem altera anúncios.
const GRAPH = (process.env.META_GRAPH_URL || 'https://graph.facebook.com').replace(/\/+$/, '');
const VERSION = 'v21.0';
export const PRESETS = { today: 'Hoje', yesterday: 'Ontem', last_7d: 'Últimos 7 dias', last_30d: 'Últimos 30 dias', this_month: 'Este mês', last_month: 'Mês passado' };
const LEAD_TYPES = ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead'];
const CHAT_TYPES = ['onsite_conversion.messaging_conversation_started_7d'];
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const sumActions = (actions, types) => (actions || []).filter((a) => types.includes(a.action_type)).reduce((s, a) => s + num(a.value), 0);

export class Marketing {
  constructor({ store, fetchImpl = globalThis.fetch, now = () => new Date() }) {
    this.store = store; this.fetch = fetchImpl; this.now = now;
    store.data.marketing ||= { snapshot: null };
  }
  get config() { return this.store.settings.marketing || {}; }
  get configured() { return Boolean(this.config.adAccountId && this.config.metaToken); }
  get snapshot() { return this.store.data.marketing.snapshot; }
  setConfig({ adAccountId, metaToken }) {
    const patch = {};
    if (adAccountId !== undefined) {
      const id = String(adAccountId || '').replace(/^act_/i, '').trim();
      if (id && !/^\d{5,20}$/.test(id)) throw new Error('O ID da conta de anúncios tem só números (ex.: 1234567890)');
      patch.adAccountId = id;
    }
    if (metaToken !== undefined && !String(metaToken).startsWith('••')) patch.metaToken = String(metaToken || '').trim().slice(0, 600);
    this.store.updateSettings({ marketing: patch });
    return this.config;
  }
  async #get(url) {
    const res = await this.fetch(url, { headers: { Authorization: `Bearer ${this.config.metaToken}` } });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) {
      const e = new Error(`Meta: ${j.error?.message || `HTTP ${res.status}`}`);
      e.status = res.status === 401 || j.error?.code === 190 ? 401 : 502; e.auth = e.status === 401;
      throw e;
    }
    return j;
  }
  /** Busca os números por campanha. Só leitura. */
  async sync({ preset = 'last_30d' } = {}) {
    if (!this.configured) throw Object.assign(new Error('Cole o ID da conta de anúncios e a chave de acesso da Meta (Marketing → Configurar).'), { status: 400 });
    if (!PRESETS[preset]) preset = 'last_30d';
    const acct = `${GRAPH}/${VERSION}/act_${this.config.adAccountId}`;
    const info = await this.#get(`${acct}?fields=name,currency`);
    let url = `${acct}/insights?level=campaign&fields=campaign_id,campaign_name,spend,impressions,clicks,actions&date_preset=${preset}&limit=100`;
    const rows = [];
    for (let page = 0; page < 5 && url; page++) {
      const j = await this.#get(url);
      rows.push(...(j.data || []));
      const next = j.paging?.next;
      // Só segue o próximo endereço se for mesmo da Meta (nunca para outro lugar).
      url = next && new URL(next).hostname === new URL(GRAPH).hostname ? next : '';
    }
    const campaigns = rows.map((r) => {
      const spend = round(num(r.spend)); const leads = sumActions(r.actions, LEAD_TYPES); const chats = sumActions(r.actions, CHAT_TYPES);
      const results = leads + chats; const clicks = num(r.clicks); const imp = num(r.impressions);
      return { id: String(r.campaign_id || ''), name: String(r.campaign_name || 'Campanha').slice(0, 120), spend, impressions: imp, clicks, leads, chats, results, ctr: imp ? round((clicks / imp) * 100) : 0, cpl: results ? round(spend / results) : null };
    }).sort((a, b) => b.spend - a.spend);
    const sum = (k) => campaigns.reduce((s, c) => s + c[k], 0);
    const totals = { spend: round(sum('spend')), impressions: sum('impressions'), clicks: sum('clicks'), leads: sum('leads'), chats: sum('chats'), results: sum('results') };
    totals.cpl = totals.results ? round(totals.spend / totals.results) : null;
    const snap = { syncedAt: this.now().toISOString(), preset, account: { name: String(info.name || '').slice(0, 80), currency: String(info.currency || '') }, campaigns, totals };
    this.store.data.marketing.snapshot = snap; this.store.save();
    return snap;
  }
  /** Junta com o nosso CRM: quantos contatos vieram de anúncio e quantos fecharam (custo por venda real). */
  withCrm(snap, leads = []) {
    if (!snap) return null;
    const fromAds = leads.filter((l) => l.adTitle);
    const won = fromAds.filter((l) => l.stage === 'ganho');
    return { ...snap, crm: { fromAds: fromAds.length, won: won.length, costPerSale: won.length && snap.totals.spend ? round(snap.totals.spend / won.length) : null } };
  }
  /** Texto simples para quem não entende de anúncio: os números e o que olhar. Sem inventar conclusão. */
  plainSummary(view) {
    if (!view) return 'Ainda não buscamos os números da Meta.';
    const t = view.totals; const cur = view.account.currency || '';
    const money = (v) => `${cur} ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    const lines = [`Período: ${PRESETS[view.preset] || view.preset}. Gasto total em anúncios: ${money(t.spend)}.`, `Os anúncios apareceram ${t.impressions.toLocaleString('pt-BR')} vezes e tiveram ${t.clicks.toLocaleString('pt-BR')} cliques.`];
    lines.push(t.results ? `Geraram ${t.results} contato(s) (${t.chats} conversa(s) no WhatsApp/Direct e ${t.leads} formulário(s)), a ${money(t.cpl)} por contato.` : 'Não geraram contatos medidos nesse período.');
    if (view.crm?.fromAds) lines.push(`No nosso sistema, ${view.crm.fromAds} cliente(s) vieram de anúncio e ${view.crm.won} fecharam${view.crm.costPerSale ? `: cada venda custou cerca de ${money(view.crm.costPerSale)} em anúncio` : ''}.`);
    const worst = view.campaigns.filter((c) => c.spend > 0 && !c.results).slice(0, 3);
    if (worst.length) lines.push(`Atenção: ${worst.map((c) => `"${c.name}" gastou ${money(c.spend)} sem gerar contato`).join('; ')}.`);
    return lines.join('\n');
  }
}
