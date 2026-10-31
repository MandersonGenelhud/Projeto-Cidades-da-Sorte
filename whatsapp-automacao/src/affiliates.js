// Indicadores (afiliados): pessoas comuns que indicam clientes para a Migra e
// ganham comissão quando a venda fecha. Quem fecha é sempre a equipe da Migra.
// Regra do primeiro indicador: o cliente fica para sempre com quem indicou primeiro.
import crypto from 'node:crypto';
import { hashPassword, checkPassword } from './auth.js';
import { normalizePhone } from './utils.js';

const COOKIE = 'migra_parceiro';
const REF_COOKIE = 'migra_ref';
const VISITOR_COOKIE = 'migra_v';
const err = (status, message) => Object.assign(new Error(message), { status });
export const CATEGORY_LABEL = { migracao: 'Migra Soluções (migração)', imoveis: 'Migra Imóveis', veiculos: 'Migra Motors (veículos)' };
const catLabel = (c) => CATEGORY_LABEL[c] || String(c || 'migracao').replace(/^./, (x) => x.toUpperCase());

/** Serviços que podem ser indicados (o administrador acrescenta novos em Indicadores). */
export const DEFAULT_SERVICES = [
  { label: 'Residência e cédula paraguaia', category: 'migracao' },
  { label: 'Abrir empresa no Paraguai', category: 'migracao' },
  { label: 'Terreno ou loteamento', category: 'imoveis' },
  { label: 'Casa, apartamento ou outro imóvel', category: 'imoveis' },
  { label: 'Veículos (Migra Motors)', category: 'veiculos' },
  { label: 'Outro assunto', category: 'migracao' },
];
const STARTED = new Set(['em_contato', 'proposta', 'aguardando', 'ganho', 'perdido']);
/** Senha do portal: mínimo 8 caracteres, com letras e números (mesma regra da equipe). */
function checkNewPassword(p) {
  const s = String(p || '');
  if (s.length < 8 || !/[a-z]/i.test(s) || !/\d/.test(s)) throw err(400, 'A senha precisa ter pelo menos 8 caracteres, com letras e números');
}
/** Dados para receber a comissão: Pix (Brasil) ou conta bancária (Paraguai). */
function payoutFrom(src, current = {}) {
  const pick = (f) => (src[f] !== undefined ? String(src[f] || '').trim().slice(0, 120) : current[f] || '');
  const country = (src.country ?? current.country) === 'PY' ? 'PY' : 'BR';
  return { country, pixKey: pick('pixKey'), cpf: pick('cpf'), bank: pick('bank'), account: pick('account'), holder: pick('holder'), doc: pick('doc') };
}
function checkPayout(p) {
  if (p.country === 'PY') {
    if (!p.bank || !p.account || !p.holder || !p.doc) throw err(400, 'Para receber no Paraguai, informe o banco, o número da conta, o titular e a cédula (CI) ou RUC do titular');
  } else if (!p.pixKey) throw err(400, 'Informe a chave Pix para receber as comissões');
}
export function payoutText(a) {
  if (!a) return '';
  if (a.country === 'PY') return `🇵🇾 ${[a.bank, a.account && `conta ${a.account}`, a.holder && `titular ${a.holder}`, a.doc && `CI/RUC ${a.doc}`].filter(Boolean).join(' · ')}`;
  return a.pixKey ? `🇧🇷 Pix ${a.pixKey}${a.cpf ? ` · CPF ${a.cpf}` : ''}` : '';
}

const STAGE_FRIENDLY = {
  novo: 'Cadastrado', em_contato: 'Em atendimento', proposta: 'Negociando', aguardando: 'Vai decidir depois', ganho: 'Fechou negócio 🎉', perdido: 'Não fechou',
};

export const moneyIn = (v, currency = 'BRL') => `${{ USD: 'US$', PYG: 'Gs.', BRL: 'R$' }[currency] || currency} ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: currency === 'PYG' ? 0 : 2, maximumFractionDigits: currency === 'PYG' ? 0 : 2 })}`;

export function readCookie(req, name) {
  const raw = String(req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  return raw ? decodeURIComponent(raw.slice(name.length + 1)) : null;
}

/** "Ana Paula" → "ana482" (curto, fácil de falar e de digitar). */
function makeCode(name, taken) {
  const base = String(name || 'parceiro').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 8) || 'parceiro';
  let code;
  do code = `${base}${Math.floor(100 + Math.random() * 900)}`;
  while (taken(code));
  return code;
}

export class Affiliates {
  constructor({ store, crm, secret, notifyAffiliate, auth = null }) {
    this.store = store;
    this.crm = crm;
    this.auth = auth || crm?.auth || null;
    this.secret = secret;
    this.notifyAffiliate = notifyAffiliate || (async () => {}); // (telefone, texto) => aviso no WhatsApp
    store.data.affiliates ||= { list: [], clicks: [], commissions: [] };
  }

  get config() {
    return this.store.settings.affiliates || {};
  }

  get data() {
    return this.store.data.affiliates;
  }

  get(id) {
    return this.data.list.find((a) => a.id === id) || null;
  }

  byCode(code) {
    const c = String(code || '').trim().toLowerCase();
    return c ? this.data.list.find((a) => a.code === c) || null : null;
  }

  get services() {
    const list = Array.isArray(this.config.services) && this.config.services.length ? this.config.services : DEFAULT_SERVICES;
    return list.filter((s) => s?.label).map((s) => ({ label: String(s.label), category: String(s.category || 'migracao') }));
  }

  /** Categorias de comissão: as dos serviços + as que já têm regra. */
  categories() {
    const keys = [...new Set(['migracao', 'imoveis', ...this.services.map((s) => s.category), ...Object.keys(this.config.rates || {})])];
    return keys.map((k) => ({ key: k, label: catLabel(k), ...this.rate(k) }));
  }

  // ---------- Link do vendedor (a equipe também indica) ----------
  #codeTaken(code) {
    return Boolean(this.byCode(code)) || Boolean(this.auth?.users.some((u) => u.refCode === code));
  }

  /** Código do link do vendedor (criado na primeira vez que ele abre "Divulgar"). */
  sellerCode(user) {
    const u = this.auth?.get(user.id) || user;
    if (!u.refCode) {
      u.refCode = makeCode(u.name, (c) => this.#codeTaken(c));
      this.store.save();
    }
    return u.refCode;
  }

  sellerByCode(code) {
    const c = String(code || '').trim().toLowerCase();
    return c ? this.auth?.users.find((u) => u.refCode === c && u.active !== false && !u.pending) || null : null;
  }

  publicAffiliate(a) {
    if (!a) return null;
    const { passwordHash, ...rest } = a;
    return { ...rest, country: a.country || 'BR', payout: payoutText(a) };
  }

  // ---------- Cadastro e acesso ----------
  signup(input = {}) {
    const { whatsapp, email, password, acceptTerms } = input;
    if (this.config.enabled === false) throw err(403, 'O programa de indicação está pausado');
    const name = String(input.name || '').trim();
    const phone = normalizePhone(whatsapp, input.country === 'PY' ? '595' : '55');
    if (name.length < 3) throw err(400, 'Informe seu nome completo');
    if (!phone) throw err(400, 'Informe um WhatsApp válido, com DDD');
    checkNewPassword(password);
    const payout = payoutFrom(input);
    checkPayout(payout);
    if (!acceptTerms) throw err(400, 'Para participar, aceite as regras do programa');
    if (this.data.list.some((a) => a.whatsapp === phone)) throw err(400, 'Esse WhatsApp já está cadastrado. Entre com sua senha.');
    const a = {
      id: crypto.randomBytes(6).toString('hex'),
      code: makeCode(name, (c) => this.#codeTaken(c)),
      name,
      whatsapp: phone,
      email: String(email || '').trim().toLowerCase(),
      ...payout,
      passwordHash: hashPassword(password),
      status: 'ativo',
      createdAt: new Date().toISOString(),
      acceptedTermsAt: new Date().toISOString(),
    };
    this.data.list.push(a);
    this.store.save();
    this.store.addLog({ type: 'system', message: `🤝 Novo indicador cadastrado: ${a.name} (código ${a.code})` });
    return a;
  }

  login(whatsapp, password) {
    const phone = normalizePhone(whatsapp);
    const a = this.data.list.find((x) => x.whatsapp === phone);
    if (!a || !checkPassword(password, a.passwordHash)) throw err(401, 'WhatsApp ou senha incorretos');
    if (a.status !== 'ativo') throw err(403, 'Seu cadastro está bloqueado. Fale com a Migra.');
    return a;
  }

  #sign(v) {
    return crypto.createHmac('sha256', this.secret).update(`parceiro:${v}`).digest('base64url');
  }

  sessionCookie(a) {
    const exp = Date.now() + 60 * 86_400_000;
    const v = `${a.id}.${exp}`;
    return `${COOKIE}=${v}.${this.#sign(v)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 86400}`;
  }

  clearCookie() {
    return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }

  fromRequest(req) {
    const raw = readCookie(req, COOKIE);
    if (!raw) return null;
    const [id, exp, sig] = raw.split('.');
    if (!sig || sig !== this.#sign(`${id}.${exp}`) || Number(exp) < Date.now()) return null;
    const a = this.get(id);
    return a && a.status === 'ativo' ? a : null;
  }

  update(id, patch) {
    const a = this.get(id);
    if (!a) throw err(404, 'Indicador não encontrado');
    if (patch.status !== undefined) a.status = patch.status === 'bloqueado' ? 'bloqueado' : 'ativo';
    for (const f of ['name', 'email']) if (patch[f] !== undefined) a[f] = String(patch[f]).trim();
    if (['country', 'pixKey', 'cpf', 'bank', 'account', 'holder', 'doc'].some((f) => patch[f] !== undefined)) {
      const payout = payoutFrom(patch, a);
      checkPayout(payout);
      Object.assign(a, payout);
    }
    if (patch.password) {
      checkNewPassword(patch.password);
      a.passwordHash = hashPassword(patch.password);
    }
    this.store.save();
    return a;
  }

  // ---------- Link de indicação ----------
  /**
   * Alguém abriu o link /r/<código>. Devolve os cookies a gravar no navegador.
   * O cookie de indicação só é gravado se ainda não existir (primeiro indicador vale).
   */
  recordClick(req, code) {
    const a = this.byCode(code);
    const seller = a ? null : this.sellerByCode(code);
    if ((!a || a.status !== 'ativo') && !seller) return { cookies: [] };
    const owner = a ? { affId: a.id } : { sellerId: seller.id };
    const cookies = [];
    let visitor = readCookie(req, VISITOR_COOKIE);
    if (!visitor) {
      visitor = crypto.randomBytes(8).toString('hex');
      cookies.push(`${VISITOR_COOKIE}=${visitor}; Path=/; SameSite=Lax; Max-Age=${365 * 86400}`);
    }
    const days = Number(this.config.cookieDays || 180);
    if (!readCookie(req, REF_COOKIE)) cookies.push(`${REF_COOKIE}=${a ? a.code : seller.refCode}; Path=/; SameSite=Lax; Max-Age=${days * 86400}`);
    const today = new Date().toISOString().slice(0, 10);
    const same = (c) => (a ? c.affId === a.id : c.sellerId === seller.id);
    const dup = this.data.clicks.some((c) => same(c) && c.visitor === visitor && c.at.startsWith(today));
    if (!dup) {
      this.data.clicks.push({ ...owner, visitor, at: new Date().toISOString() });
      if (this.data.clicks.length > 50_000) this.data.clicks.splice(0, this.data.clicks.length - 50_000);
      this.store.save();
    }
    return { cookies, affiliate: a, seller };
  }

  /** Quem indicou o visitante deste navegador (cookie do link). */
  refFromRequest(req) {
    return this.byCode(readCookie(req, REF_COOKIE));
  }

  /**
   * Dono da indicação deste visitante: o cookie do link vale primeiro (primeiro indicador);
   * sem cookie (navegador bloqueou), vale o código que veio no endereço da página.
   */
  referrer(req, fallbackCode = '') {
    const code = readCookie(req, REF_COOKIE) || fallbackCode;
    const a = this.byCode(code);
    if (a && a.status === 'ativo') return { affiliate: a, seller: null };
    const seller = this.sellerByCode(code);
    return seller ? { affiliate: null, seller } : { affiliate: null, seller: null };
  }

  /** Acha um código de indicação numa mensagem ("código de indicação: ana482"). */
  codeInText(text) {
    const m = String(text || '').match(/indica[cç][aã]o[^a-z0-9]{0,5}([a-z]{2,8}\d{3})\b/i);
    return m ? this.byCode(m[1]) : null;
  }

  /**
   * Liga o cliente ao indicador. Regra do primeiro indicador: se o cliente já
   * tem indicador, nada muda (mesmo que outra pessoa indique depois).
   */
  attach(lead, affiliate, how = 'link') {
    if (!lead || !affiliate || affiliate.status !== 'ativo') return false;
    if (lead.affiliateId) {
      if (lead.affiliateId !== affiliate.id) {
        (lead.timeline ||= []).push({ at: new Date().toISOString(), by: 'Sistema', type: 'nota', text: `${affiliate.name} também tentou indicar este cliente, mas a indicação fica com o primeiro indicador.` });
        this.store.save();
      }
      return false;
    }
    lead.affiliateId = affiliate.id;
    lead.affiliateAt = new Date().toISOString();
    (lead.timeline ||= []).push({ at: lead.affiliateAt, by: 'Sistema', type: 'nota', text: `🤝 Indicado por ${affiliate.name} (${affiliate.code}) · via ${how}` });
    this.store.save();
    return true;
  }

  // ---------- Pré-cadastro pelo link ----------
  /**
   * A pessoa indicada preencheu o pré-cadastro. Vira prospecto no CRM ligado a quem indicou e
   * vai para um vendedor: o próprio vendedor, se o link era dele; senão, o próximo do rodízio
   * entre os vendedores que aceitam indicações de parceiros (chave no perfil de cada um).
   * Devolve { lead, owner, affiliate, selfReferral }.
   */
  preRegister(input = {}, { affiliate = null, seller = null } = {}) {
    const name = String(input.name || '').trim().slice(0, 80);
    const phone = normalizePhone(input.whatsapp);
    if (name.length < 2) throw err(400, 'Informe seu nome');
    if (!phone) throw err(400, 'Informe um WhatsApp válido, com DDD (e o código do país, se não for do Brasil)');
    if (!input.consent) throw err(400, 'Para a Migra entrar em contato, marque a autorização');
    const service = this.services.find((s) => s.label === input.interest) || this.services[0];
    // Indicar a si mesmo não gera comissão.
    const selfReferral = Boolean(affiliate && affiliate.whatsapp === phone);
    if (selfReferral) affiliate = null;
    const SYS = { name: 'Pré-cadastro', role: 'admin' };
    const open = (l) => l.phone === phone && !['ganho', 'perdido'].includes(l.stage);
    let lead = this.crm.leads.find(open);
    if (!lead) {
      lead = this.crm.byId(this.crm.create(SYS, {
        name, phone, email: input.email, city: input.city, source: affiliate ? 'indicacao' : seller ? 'link do vendedor' : 'site',
        category: service.category === 'imoveis' ? 'imoveis' : 'migracao', interest: service.label, ownerId: seller?.id || null,
      }).id);
    }
    lead.service = service.label;
    lead.commissionCategory = service.category;
    lead.precadastroAt ||= new Date().toISOString();
    if (affiliate) this.attach(lead, affiliate, 'pré-cadastro');
    const extra = [input.city && `cidade: ${String(input.city).slice(0, 60)}`, input.when && `melhor horário: ${String(input.when).slice(0, 40)}`, input.message && `mensagem: ${String(input.message).slice(0, 300)}`].filter(Boolean).join(' · ');
    (lead.timeline ||= []).push({ at: new Date().toISOString(), by: 'Sistema', type: 'nota', text: `📝 Pré-cadastro: ${service.label}${extra ? ` · ${extra}` : ''}${selfReferral ? ' · (indicação de si mesmo: sem comissão)' : ''}` });
    let owner = lead.ownerId ? this.auth?.get(lead.ownerId) : null;
    if (!owner && lead.affiliateId) {
      // A indicação vai para quem atende aquela área (terreno → Migra Imobiliária, veículo → Motors, o resto → migração); sem ninguém na área, qualquer um que aceita indicações.
      const sector = { imoveis: 'loteamentos', veiculos: 'veiculos' }[service.category] || 'documentacao';
      const accepts = (u) => Boolean(u.receivesAffiliateLeads);
      owner = this.crm.routeLead(lead, { reason: 'indicação de parceiro', pool: (u) => accepts(u) && (u.sectors || []).includes(sector) })
        || this.crm.routeLead(lead, { reason: 'indicação de parceiro', pool: (u) => accepts(u) && (!u.sectors?.length || u.sectors.includes(sector)) });
    }
    this.store.save();
    return { lead, owner: owner || null, affiliate: lead.affiliateId ? this.get(lead.affiliateId) : null, selfReferral, service, extra };
  }

  // ---------- Comissões ----------
  rate(category) {
    const r = this.config.rates?.[category || 'migracao'] || {};
    return { percent: Number(r.percent || 0), fixed: Number(r.fixed || 0) };
  }

  /** Venda confirmada: cria a comissão do indicador (uma por cliente) e avisa. */
  async onLeadWon(lead) {
    if (!lead?.affiliateId) return null;
    if (this.data.commissions.some((c) => c.leadId === lead.id && c.status !== 'cancelada')) return null;
    const a = this.get(lead.affiliateId);
    if (!a) return null;
    const category = lead.commissionCategory || lead.category || 'migracao';
    const { percent, fixed } = this.rate(category);
    const sale = Number(lead.closedValue || lead.value || 0);
    const amount = Math.round((sale * percent) / 100 * 100) / 100 + fixed;
    const c = {
      id: crypto.randomBytes(6).toString('hex'),
      affId: a.id,
      leadId: lead.id,
      clientName: lead.name || 'Cliente',
      category,
      saleValue: sale,
      currency: lead.currency || 'BRL',
      percent,
      fixed,
      amount,
      status: 'a_pagar',
      createdAt: new Date().toISOString(),
    };
    this.data.commissions.push(c);
    this.store.save();
    this.store.addLog({ type: 'system', message: `🤝 Comissão gerada para ${a.name}: ${moneyIn(amount, c.currency)} (${c.clientName})` });
    if (amount > 0) {
      await this.notifyAffiliate(a.whatsapp, `🎉 Parabéns, ${a.name.split(' ')[0]}! Uma indicação sua fechou negócio com a ${this.store.settings.business?.name || 'Migra'}.\n\nCliente: ${c.clientName}\nSua comissão: ${moneyIn(amount, c.currency)}\n\nAcompanhe no seu escritório virtual. O pagamento é feito pela Migra nos dados de recebimento do seu cadastro.`).catch(() => {});
    }
    return c;
  }

  markPaid(id, { by, note = '' } = {}) {
    const c = this.data.commissions.find((x) => x.id === id);
    if (!c) throw err(404, 'Comissão não encontrada');
    c.status = 'paga';
    c.paidAt = new Date().toISOString();
    c.paidBy = by || 'Administrador';
    c.note = note;
    this.store.save();
    const a = this.get(c.affId);
    if (a && c.amount > 0) this.notifyAffiliate(a.whatsapp, `💸 Comissão paga: ${moneyIn(c.amount, c.currency)} referente a ${c.clientName}. Obrigado pela parceria!`).catch(() => {});
    return c;
  }

  cancelCommission(id) {
    const c = this.data.commissions.find((x) => x.id === id);
    if (!c) throw err(404, 'Comissão não encontrada');
    c.status = 'cancelada';
    this.store.save();
    return c;
  }

  // ---------- Números ----------
  stats(a) {
    const clicks = this.data.clicks.filter((c) => c.affId === a.id);
    const leads = this.crm.leads.filter((l) => l.affiliateId === a.id);
    const comms = this.data.commissions.filter((c) => c.affId === a.id && c.status !== 'cancelada');
    // Soma por moeda (imóveis costumam ser em US$; migração em R$).
    const sum = (list) => {
      const by = {};
      for (const c of list) by[c.currency || 'BRL'] = (by[c.currency || 'BRL'] || 0) + c.amount;
      return Object.entries(by).map(([cur, v]) => moneyIn(v, cur)).join(' + ') || moneyIn(0, 'BRL');
    };
    return {
      clicks: clicks.length,
      visitors: new Set(clicks.map((c) => c.visitor)).size,
      leads: leads.length,
      precadastros: leads.filter((l) => l.precadastroAt).length,
      attending: leads.filter((l) => STARTED.has(l.stage) && l.stage !== 'ganho' && l.stage !== 'perdido').length,
      won: leads.filter((l) => l.stage === 'ganho').length,
      toReceive: sum(comms.filter((c) => c.status === 'a_pagar')),
      paid: sum(comms.filter((c) => c.status === 'paga')),
    };
  }

  /** O que o indicador vê sobre os clientes dele (sem telefone, por privacidade). */
  myLeads(a) {
    return this.crm.leads
      .filter((l) => l.affiliateId === a.id)
      .sort((x, y) => String(y.affiliateAt).localeCompare(String(x.affiliateAt)))
      .map((l) => ({
        name: l.name || 'Cliente',
        since: l.affiliateAt,
        category: l.service || catLabel(l.commissionCategory || l.category || 'migracao'),
        precadastro: Boolean(l.precadastroAt),
        status: STAGE_FRIENDLY[l.stage] || l.stage,
        stage: l.stage,
        // Quem da Migra está atendendo (só o primeiro nome).
        seller: l.ownerId ? String(this.auth?.get(l.ownerId)?.name || '').split(' ')[0] : '',
      }));
  }

  myCommissions(a) {
    return this.data.commissions.filter((c) => c.affId === a.id && c.status !== 'cancelada').reverse();
  }

  adminList() {
    return this.data.list.map((a) => ({ ...this.publicAffiliate(a), stats: this.stats(a) }));
  }

  adminCommissions() {
    return [...this.data.commissions].reverse().map((c) => ({ ...c, affName: this.get(c.affId)?.name || '—', affPix: payoutText(this.get(c.affId)) }));
  }
}
