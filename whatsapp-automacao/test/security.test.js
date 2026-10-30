import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { base32Encode, totpCode, verifyTotp, LoginGuard } from '../src/security.js';
import { Auth } from '../src/auth.js';
import { Backups, decrypt, encrypt } from '../src/backup.js';
import { tempStore } from './helpers.js';

test('TOTP: confere com o vetor oficial da RFC 6238 e aceita só o código da janela', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(totpCode(secret, 59_000), '287082');
  assert.equal(totpCode(secret, 1111111109_000), '081804');
  const now = Date.now();
  assert.equal(verifyTotp(secret, totpCode(secret, now), now), true);
  assert.equal(verifyTotp(secret, totpCode(secret, now - 30_000), now), true, 'relógio 30s atrasado');
  assert.equal(verifyTotp(secret, totpCode(secret, now - 120_000), now), false, 'código velho não vale');
  assert.equal(verifyTotp(secret, 'abc', now), false);
});

test('limite de tentativas: 5 senhas erradas bloqueiam o login por 15 minutos', () => {
  let t = 0;
  const g = new LoginGuard({ now: () => t });
  for (let i = 0; i < 4; i++) assert.equal(g.fail({ login: 'marcos', ip: '1.1.1.1' }), 0);
  assert.equal(g.fail({ login: 'marcos', ip: '1.1.1.1' }), 15);
  assert.equal(g.blocked({ login: 'marcos', ip: '9.9.9.9' }), 15, 'trocar de IP não adianta');
  t += 16 * 60_000;
  assert.equal(g.blocked({ login: 'marcos', ip: '1.1.1.1' }), 0, 'libera depois do prazo');
});

test('sessões: sair de todos os aparelhos e trocar a senha derrubam os cookies antigos', () => {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const u = auth.create({ name: 'Marcos', login: 'marcos', password: 'segredo123', role: 'admin' });
  const cookie = (c) => ({ headers: { cookie: c.split(';')[0] } });
  const c1 = auth.sessionCookie(auth.get(u.id), { secure: true });
  assert.match(c1, /; Secure$/);
  assert.equal(auth.fromRequest(cookie(c1)).id, u.id);
  auth.revokeSessions(u.id);
  assert.equal(auth.fromRequest(cookie(c1)), null, 'cookie antigo não vale mais');
  const c2 = auth.sessionCookie(auth.get(u.id));
  auth.update(u.id, { password: 'novaSenha456' });
  assert.equal(auth.fromRequest(cookie(c2)), null, 'senha nova derruba os acessos');
  const c3 = auth.sessionCookie(auth.get(u.id));
  auth.revokeAll();
  assert.equal(auth.fromRequest(cookie(c3)), null);
  // Cookie adulterado não passa.
  const c4 = auth.sessionCookie(auth.get(u.id)).split(';')[0].replace(/\.(\d+)\./, '.999.');
  assert.equal(auth.fromRequest({ headers: { cookie: c4 } }), null);
});

test('backup criptografado: abre com a chave, não abre adulterado nem com outra chave, guarda 30', () => {
  const store = tempStore();
  store.data.leads = [{ id: 'x', name: 'Cliente secreto' }];
  const b = new Backups({ store, dataDir: store.dataDir, keep: 3 });
  const r = b.run(new Date('2026-10-30T10:00:00Z'));
  const raw = fs.readFileSync(b.file(r.name));
  assert.ok(!raw.toString('latin1').includes('Cliente secreto'), 'o arquivo não tem os dados em texto');
  assert.equal(JSON.parse(decrypt(raw, b.key)).leads[0].name, 'Cliente secreto');
  const tampered = Buffer.from(raw);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => decrypt(tampered, b.key));
  assert.throws(() => decrypt(raw, Buffer.alloc(32, 7)));
  for (let d = 1; d <= 5; d++) b.run(new Date(`2026-11-0${d}T10:00:00Z`));
  assert.equal(b.list().length, 3);
  assert.equal(b.file('../db.json'), null, 'não deixa baixar outros arquivos');
  assert.ok(encrypt(Buffer.from('a'), b.key).length > 32);
});

test('cadastro do vendedor fica aguardando: não entra até o administrador liberar', () => {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  auth.create({ name: 'Marcos', login: 'marcos', password: 'segredo123', role: 'admin' });
  const v = auth.create({ name: 'Silvane Nunes', login: 'silvane', password: 'Silvane2026', whatsapp: '+55 45 99999-0009', pending: true });
  assert.equal(v.pending, true);
  assert.equal(auth.login('silvane', 'Silvane2026'), null, 'não entra antes da liberação');
  assert.ok(auth.pendingLogin('silvane', 'Silvane2026'), 'recebe o aviso de "aguardando liberação"');
  assert.equal(auth.pendingLogin('silvane', 'errada'), null, 'senha errada não revela o cadastro');
  auth.update(v.id, { active: true });
  assert.equal(auth.login('silvane', 'Silvane2026').id, v.id);
  assert.equal(auth.get(v.id).pending, undefined);
});
