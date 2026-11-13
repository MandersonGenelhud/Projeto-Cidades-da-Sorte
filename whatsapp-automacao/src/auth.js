// Usuários do painel: administrador (dono) e vendedores.
// Senhas com scrypt; sessão em cookie assinado (HMAC), sem dependências.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { normalizePhone, samePhone, uid } from './utils.js';

const COOKIE = 'zapauto_sessao';
const SESSION_DAYS = 7; // depois disso, entra de novo
// Aparelho confiável: depois de digitar o código das duas etapas, este aparelho não pede o código por 30 dias
// (a senha continua sendo pedida). "Sair de todos os aparelhos" e "Derrubar todos os acessos" cancelam.
const TRUST_DAYS = 30;
const TRUST_COOKIE = 'mh_trust';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function checkPassword(password, stored) {
  const [scheme, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const test = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === test.length && crypto.timingSafeEqual(expected, test);
}

/** Áreas em que a pessoa atende (recebe clientes da IA, da Nina, do Instagram e das indicações). */
import { normOffice } from './offices.js';
export const SECTOR_IDS = ['documentacao', 'loteamentos', 'veiculos'];
const cleanSectors = (v) => [...new Set((Array.isArray(v) ? v : []).filter((x) => SECTOR_IDS.includes(x)))];

/** Acesso temporário: "2026-11-08" vale até o fim desse dia (horário de Brasília/Paraguai); data completa vale como está; vazio tira o prazo. */
const cleanExpiry = (v) => {
  const x = String(v ?? '').trim();
  if (!x) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(x) ? `${x}T23:59:59-03:00` : x;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) throw Object.assign(new Error('Data do acesso temporário inválida'), { status: 400 });
  return new Date(t).toISOString();
};
export const accessExpired = (u, now = Date.now()) => Boolean(u?.expiresAt) && Date.parse(u.expiresAt) <= now;

const publicUser = (u) => (u ? {
  expiresAt: u.expiresAt || null, expiredAt: u.expiredAt || null,
  id: u.id, name: u.name, login: u.login, role: u.role, whatsapp: u.whatsapp || '', active: u.active !== false,
  receivesLeads: u.receivesLeads ?? u.role === 'seller', leadsReceived: u.leadsReceived || 0, lastLeadAt: u.lastLeadAt || null, rotationSeq: u.rotationSeq || 0,
  twoFactor: Boolean(u.totpEnabled), pending: Boolean(u.pending), requestedAt: u.requestedAt || null, commissionPct: u.commissionPct ?? null, affiliateCommissionPct: u.affiliateCommissionPct ?? null,
  receivesAffiliateLeads: Boolean(u.receivesAffiliateLeads), refCode: u.refCode || '', sectors: cleanSectors(u.sectors),
  manager: Boolean(u.manager) && u.role !== 'admin',
  office: u.role === 'admin' ? null : normOffice(u.office) || 'py',
  officeAdmin: Boolean(u.officeAdmin) && u.role !== 'admin',
  trafficOnly: Boolean(u.trafficOnly) && u.role !== 'admin',
} : null);

export class Auth {
  constructor({ store, dataDir }) {
    this.store = store;
    store.data.users ||= [];
    const secretFile = path.join(dataDir, 'secret.key');
    if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    this.secret = fs.readFileSync(secretFile, 'utf8').trim();
    // Quem já existia (antes dos escritórios) é do Paraguai.
    let changed = false;
    for (const u of this.users) if (u.role !== 'admin' && !normOffice(u.office)) { u.office = 'py'; changed = true; }
    if (changed) store.save();
  }

  get users() {
    return this.store.data.users;
  }

  get needsSetup() {
    return !this.users.some((u) => u.role === 'admin' && u.active !== false);
  }

  list() {
    return this.users.map(publicUser);
  }

  get(id) {
    return this.users.find((u) => u.id === id) || null;
  }

  activeSellers() {
    return this.users.filter((u) => u.active !== false);
  }

  /** Cada WhatsApp é de UMA pessoa só (a Maria, a Ana e o rodízio reconhecem a pessoa pelo número). */
  #uniquePhone(ph, exceptId) {
    if (!ph) return ph;
    const other = this.users.find((x) => x.id !== exceptId && x.active !== false && x.whatsapp && samePhone(x.whatsapp, ph));
    if (other) throw Object.assign(new Error(`Este WhatsApp já está no cadastro de ${other.name}. Tire o número de lá primeiro: cada número é de uma pessoa só.`), { status: 400 });
    return ph;
  }

  create({ name, login, password, role = 'seller', whatsapp = '', receivesLeads, pending = false, sectors = [], office = 'py', officeAdmin = false, expiresAt = '', trafficOnly = false }) {
    name = String(name || '').trim();
    login = String(login || '').trim().toLowerCase();
    if (!name) throw Object.assign(new Error('Informe o nome'), { status: 400 });
    if (!/^[a-z0-9._@-]{3,60}$/.test(login)) throw Object.assign(new Error('Login: use de 3 a 60 letras, números, ponto, @ ou traço (sem espaços)'), { status: 400 });
    if (String(password || '').length < 6) throw Object.assign(new Error('A senha precisa ter pelo menos 6 caracteres'), { status: 400 });
    if (this.users.some((u) => u.login === login)) throw Object.assign(new Error('Esse login já existe'), { status: 400 });
    const user = {
      id: uid(),
      name,
      login,
      role: role === 'admin' ? 'admin' : 'seller',
      whatsapp: this.#uniquePhone(whatsapp ? normalizePhone(whatsapp) || '' : '', null),
      passwordHash: hashPassword(password),
      receivesLeads: trafficOnly && role !== 'admin' ? false : receivesLeads === undefined ? role !== 'admin' : Boolean(receivesLeads),
      ...(trafficOnly && role !== 'admin' ? { trafficOnly: true } : {}),
      active: !pending,
      sectors: cleanSectors(sectors),
      office: role === 'admin' ? null : normOffice(office) || 'py',
      officeAdmin: role !== 'admin' && Boolean(officeAdmin),
      ...(cleanExpiry(expiresAt) && role !== 'admin' ? { expiresAt: cleanExpiry(expiresAt) } : {}),
      ...(pending ? { pending: true, requestedAt: new Date().toISOString() } : {}),
      createdAt: new Date().toISOString(),
    };
    this.users.push(user);
    this.store.save();
    return publicUser(user);
  }

  /** Desativa quem passou do prazo do acesso temporário (derruba as sessões abertas). Devolve quem foi desativado. */
  sweepExpired(now = Date.now()) {
    const out = [];
    for (const u of this.users) {
      if (u.active !== false && accessExpired(u, now)) {
        u.active = false; u.expiredAt = new Date(now).toISOString(); delete u.expiresAt;
        u.sessionVersion = (u.sessionVersion || 0) + 1;
        out.push(publicUser(u));
      }
    }
    if (out.length) this.store.save();
    return out;
  }

  update(id, patch) {
    const u = this.get(id);
    if (!u) throw Object.assign(new Error('Usuário não encontrado'), { status: 404 });
    const losesAdmin = (patch.role !== undefined && patch.role !== 'admin') || patch.active === false;
    const otherAdmins = this.users.filter((x) => x.id !== u.id && x.role === 'admin' && x.active !== false);
    if (u.role === 'admin' && losesAdmin && !otherAdmins.length) {
      throw Object.assign(new Error('Precisa existir pelo menos um administrador ativo'), { status: 400 });
    }
    if (patch.name !== undefined) u.name = String(patch.name).trim() || u.name;
    if (patch.whatsapp !== undefined) u.whatsapp = this.#uniquePhone(patch.whatsapp ? normalizePhone(patch.whatsapp) || '' : '', u.id);
    if (patch.role !== undefined) u.role = patch.role === 'admin' ? 'admin' : 'seller';
    if (patch.active !== undefined) {
      u.active = Boolean(patch.active);
      if (u.active) delete u.pending; // liberado pelo administrador
    }
    if (patch.expiresAt !== undefined) {
      const e = cleanExpiry(patch.expiresAt);
      if (e && u.role === 'admin') throw Object.assign(new Error('Administrador não tem acesso temporário'), { status: 400 });
      if (e) u.expiresAt = e; else delete u.expiresAt;
      if (e && patch.active === undefined && u.active === false && u.expiredAt) { u.active = true; delete u.expiredAt; } // novo prazo reabre quem tinha vencido
    }
    if (patch.trafficOnly !== undefined) { u.trafficOnly = u.role !== 'admin' && Boolean(patch.trafficOnly); if (u.trafficOnly) { u.receivesLeads = false; u.receivesAffiliateLeads = false; u.sectors = []; } }
    if (patch.receivesLeads !== undefined && !u.trafficOnly) u.receivesLeads = Boolean(patch.receivesLeads);
    if (patch.sectors !== undefined) u.sectors = cleanSectors(patch.sectors);
    if (patch.manager !== undefined) u.manager = Boolean(patch.manager);
    if (patch.office !== undefined && u.role !== 'admin') u.office = normOffice(patch.office) || u.office || 'py';
    if (patch.officeAdmin !== undefined) u.officeAdmin = u.role !== 'admin' && Boolean(patch.officeAdmin);
    if (patch.receivesAffiliateLeads !== undefined) u.receivesAffiliateLeads = Boolean(patch.receivesAffiliateLeads);
    if (patch.password) {
      if (String(patch.password).length < 6) throw Object.assign(new Error('A senha precisa ter pelo menos 6 caracteres'), { status: 400 });
      u.passwordHash = hashPassword(patch.password);
      u.sessionVersion = (u.sessionVersion || 0) + 1; // senha nova derruba os outros acessos
      u.trustVersion = (u.trustVersion || 0) + 1; // e esquece os aparelhos confiáveis
    }
    this.store.save();
    return publicUser(u);
  }

  /** Cadastro aguardando liberação (para avisar a pessoa em vez de dizer "senha errada"). */
  pendingLogin(login, password) {
    const u = this.users.find((x) => x.login === String(login || '').trim().toLowerCase());
    return u?.pending && checkPassword(password, u.passwordHash) ? u : null;
  }

  remove(id) {
    const i = this.users.findIndex((u) => u.id === id);
    if (i >= 0) this.users.splice(i, 1);
    this.store.save();
  }

  login(login, password) {
    const u = this.users.find((x) => x.login === String(login || '').trim().toLowerCase());
    if (!u || u.active === false || accessExpired(u) || !checkPassword(password, u.passwordHash)) return null;
    return u;
  }

  // ---------- Sessão ----------
  #sign(value) {
    return crypto.createHmac('sha256', this.secret).update(value).digest('base64url');
  }

  get cookieName() { return COOKIE; }

  /** secure: só manda o cookie por HTTPS (na VPS). */
  sessionCookie(user, { secure = false } = {}) {
    const exp = Date.now() + SESSION_DAYS * 86_400_000;
    const value = `${user.id}.${user.sessionVersion || 0}.${exp}`;
    return `${COOKIE}=${value}.${this.#sign(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`;
  }

  /** Cookie assinado que marca este aparelho como confiável para este usuário (30 dias). */
  trustCookie(user, { secure = false } = {}) {
    const exp = Date.now() + TRUST_DAYS * 86_400_000;
    const value = `${user.id}.${user.trustVersion || 0}.${exp}`;
    return `${TRUST_COOKIE}=${value}.${this.#sign(`trust:${value}`)}; Path=/api/auth; HttpOnly; SameSite=Strict; Max-Age=${TRUST_DAYS * 86400}${secure ? '; Secure' : ''}`;
  }

  /** Este aparelho foi marcado como confiável por este usuário e a marca ainda vale? */
  trustedDevice(req, user) {
    if (!user) return false;
    const raw = String(req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${TRUST_COOKIE}=`));
    if (!raw) return false;
    const [id, ver, exp, sig] = raw.slice(TRUST_COOKIE.length + 1).split('.');
    if (!id || ver === undefined || !exp || !sig || id !== user.id) return false;
    const expected = this.#sign(`trust:${id}.${ver}.${exp}`);
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
    return Number(exp) > Date.now() && Number(ver) === (user.trustVersion || 0);
  }

  /** Esquece todos os aparelhos confiáveis desta pessoa (volta a pedir o código em todos). */
  forgetDevices(id) {
    const u = this.get(id);
    if (!u) return;
    u.trustVersion = (u.trustVersion || 0) + 1;
    this.store.save();
  }

  clearCookie() {
    return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }

  /** Sai de todos os aparelhos (este usuário) — os cookies antigos param de valer. */
  revokeSessions(id) {
    const u = this.get(id);
    if (!u) return;
    u.sessionVersion = (u.sessionVersion || 0) + 1;
    u.trustVersion = (u.trustVersion || 0) + 1;
    this.store.save();
  }

  /** Derruba todo mundo (invasão): todos precisam entrar de novo. */
  revokeAll() {
    for (const u of this.users) { u.sessionVersion = (u.sessionVersion || 0) + 1; u.trustVersion = (u.trustVersion || 0) + 1; }
    this.store.save();
  }

  /** Usuário da requisição (ou null). */
  fromRequest(req) {
    const raw = String(req.headers.cookie || '')
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${COOKIE}=`));
    if (!raw) return null;
    const [id, ver, exp, sig] = raw.slice(COOKIE.length + 1).split('.');
    if (!id || !ver || !exp || !sig) return null;
    const expected = this.#sign(`${id}.${ver}.${exp}`);
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    if (Number(exp) < Date.now()) return null;
    const u = this.get(id);
    if (!u || u.active === false || accessExpired(u) || Number(ver) !== (u.sessionVersion || 0)) return null;
    return u;
  }
}

export { publicUser };
