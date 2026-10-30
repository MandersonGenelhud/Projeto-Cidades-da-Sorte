// Segurança do login: verificação em duas etapas (código do app autenticador, padrão TOTP/RFC 6238),
// limite de tentativas contra quem tenta adivinhar a senha e registro de acessos.
import crypto from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(crypto.randomBytes(20));

export function totpCode(secret, time = Date.now(), step = 30) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 1000 / step)));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

/** Aceita o código atual e o vizinho (relógio do celular adiantado ou atrasado ~30s). */
export function verifyTotp(secret, code, time = Date.now()) {
  const c = String(code || '').replace(/\D/g, '');
  if (!secret || c.length !== 6) return false;
  return [-1, 0, 1].some((w) => {
    const expected = totpCode(secret, time + w * 30_000);
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(c));
  });
}

export const otpauthUrl = (secret, account, issuer = 'Migra Hub') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

/**
 * Limite de tentativas: 5 erros no mesmo login ou 20 no mesmo IP em 15 minutos bloqueiam por 15 minutos.
 */
export class LoginGuard {
  constructor({ perLogin = 5, perIp = 20, windowMs = 15 * 60_000, now = () => Date.now() } = {}) {
    Object.assign(this, { perLogin, perIp, windowMs, now });
    this.fails = new Map(); // chave → [horários]
  }

  #recent(key) {
    const t = this.now();
    const list = (this.fails.get(key) || []).filter((x) => t - x < this.windowMs);
    this.fails.set(key, list);
    return list;
  }

  /** Minutos que ainda faltam de bloqueio (0 = liberado). */
  blocked({ login, ip }) {
    const l = this.#recent(`l:${login}`);
    const i = this.#recent(`i:${ip}`);
    const until = Math.max(
      l.length >= this.perLogin ? l[l.length - this.perLogin] + this.windowMs : 0,
      i.length >= this.perIp ? i[i.length - this.perIp] + this.windowMs : 0,
    );
    return until > this.now() ? Math.ceil((until - this.now()) / 60_000) : 0;
  }

  fail({ login, ip }) {
    for (const key of [`l:${login}`, `i:${ip}`]) {
      const list = this.#recent(key);
      list.push(this.now());
    }
    return this.blocked({ login, ip });
  }

  success({ login }) {
    this.fails.delete(`l:${login}`);
  }
}
