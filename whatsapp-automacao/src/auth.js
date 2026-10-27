// Usuários do painel: administrador (dono) e vendedores.
// Senhas com scrypt; sessão em cookie assinado (HMAC), sem dependências.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { normalizePhone, uid } from './utils.js';

const COOKIE = 'zapauto_sessao';
const SESSION_DAYS = 30;

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

const publicUser = (u) => (u ? {
  id: u.id, name: u.name, login: u.login, role: u.role, whatsapp: u.whatsapp || '', active: u.active !== false,
  receivesLeads: u.receivesLeads ?? u.role === 'seller', leadsReceived: u.leadsReceived || 0, lastLeadAt: u.lastLeadAt || null, rotationSeq: u.rotationSeq || 0,
} : null);

export class Auth {
  constructor({ store, dataDir }) {
    this.store = store;
    store.data.users ||= [];
    const secretFile = path.join(dataDir, 'secret.key');
    if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    this.secret = fs.readFileSync(secretFile, 'utf8').trim();
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

  create({ name, login, password, role = 'seller', whatsapp = '', receivesLeads }) {
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
      whatsapp: whatsapp ? normalizePhone(whatsapp) || '' : '',
      passwordHash: hashPassword(password),
      receivesLeads: receivesLeads === undefined ? role !== 'admin' : Boolean(receivesLeads),
      active: true,
      createdAt: new Date().toISOString(),
    };
    this.users.push(user);
    this.store.save();
    return publicUser(user);
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
    if (patch.whatsapp !== undefined) u.whatsapp = patch.whatsapp ? normalizePhone(patch.whatsapp) || '' : '';
    if (patch.role !== undefined) u.role = patch.role === 'admin' ? 'admin' : 'seller';
    if (patch.active !== undefined) u.active = Boolean(patch.active);
    if (patch.receivesLeads !== undefined) u.receivesLeads = Boolean(patch.receivesLeads);
    if (patch.password) {
      if (String(patch.password).length < 6) throw Object.assign(new Error('A senha precisa ter pelo menos 6 caracteres'), { status: 400 });
      u.passwordHash = hashPassword(patch.password);
    }
    this.store.save();
    return publicUser(u);
  }

  login(login, password) {
    const u = this.users.find((x) => x.login === String(login || '').trim().toLowerCase());
    if (!u || u.active === false || !checkPassword(password, u.passwordHash)) return null;
    return u;
  }

  // ---------- Sessão ----------
  #sign(value) {
    return crypto.createHmac('sha256', this.secret).update(value).digest('base64url');
  }

  sessionCookie(user) {
    const exp = Date.now() + SESSION_DAYS * 86_400_000;
    const value = `${user.id}.${exp}`;
    return `${COOKIE}=${value}.${this.#sign(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
  }

  clearCookie() {
    return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }

  /** Usuário da requisição (ou null). */
  fromRequest(req) {
    const raw = String(req.headers.cookie || '')
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${COOKIE}=`));
    if (!raw) return null;
    const [id, exp, sig] = raw.slice(COOKIE.length + 1).split('.');
    if (!id || !exp || !sig) return null;
    const expected = this.#sign(`${id}.${exp}`);
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    if (Number(exp) < Date.now()) return null;
    const u = this.get(id);
    return u && u.active !== false ? u : null;
  }
}

export { publicUser };
