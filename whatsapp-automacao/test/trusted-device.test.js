import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { totpCode } from '../src/security.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const J = { 'content-type': 'application/json' };
const cookiesOf = (r) => Object.fromEntries(r.headers.getSetCookie().map((c) => c.split(';')[0].split(/=(.*)/s).slice(0, 2)));

test('aparelho confiável: depois do código, 30 dias só com a senha neste aparelho; outro aparelho, senha errada e "sair de todos" pedem o código de novo', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-trust-'));
  const port = 38500 + Math.floor(Math.random() * 300);
  const proc = spawn(process.execPath, ['src/server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: String(port), TUNNEL: 'off', OPEN_BROWSER: '' }, stdio: 'ignore' });
  t.after(() => proc.kill());
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) { try { await fetch(`${base}/api/auth/state`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const post = (u, body, cookie = '') => fetch(base + u, { method: 'POST', headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

  // Cria o administrador e liga as duas etapas.
  let session = cookiesOf(await post('/api/auth/setup', { name: 'Marcos', login: 'marcos', password: 'teste1234' })).zapauto_sessao;
  const ck = () => `zapauto_sessao=${session}`;
  const sec = await (await fetch(`${base}/api/security/2fa/setup`, { headers: { cookie: ck() } })).json();
  const secret = sec.secret;
  await post('/api/security/2fa/enable', { code: totpCode(secret) }, ck());

  // Sem aparelho confiável: pede o código.
  assert.equal((await (await post('/api/auth/login', { login: 'marcos', password: 'teste1234' })).json()).needs2fa, true);
  // Digita o código sem pedir para lembrar: não marca o aparelho.
  const noRemember = await post('/api/auth/login', { login: 'marcos', password: 'teste1234', code: totpCode(secret), remember: false });
  assert.equal(noRemember.status, 200);
  assert.equal(cookiesOf(noRemember).mh_trust, undefined);
  // Digita o código e pede para lembrar: recebe a marca de aparelho confiável (só para /api/auth, HttpOnly, 30 dias).
  const withRemember = await post('/api/auth/login', { login: 'marcos', password: 'teste1234', code: totpCode(secret), remember: true });
  const raw = withRemember.headers.getSetCookie().find((c) => c.startsWith('mh_trust='));
  assert.match(raw, /HttpOnly/); assert.match(raw, /Path=\/api\/auth/); assert.match(raw, /Max-Age=2592000/);
  const trust = `mh_trust=${cookiesOf(withRemember).mh_trust}`;
  session = cookiesOf(withRemember).zapauto_sessao;

  // Neste aparelho: só a senha basta.
  const again = await post('/api/auth/login', { login: 'marcos', password: 'teste1234' }, trust);
  assert.equal(again.status, 200);
  assert.ok(!(await again.json()).needs2fa);
  // Senha errada continua barrada mesmo no aparelho confiável.
  assert.equal((await post('/api/auth/login', { login: 'marcos', password: 'errada99' }, trust)).status, 401);
  // Marca adulterada não vale.
  assert.equal((await (await post('/api/auth/login', { login: 'marcos', password: 'teste1234' }, `${trust.slice(0, -3)}abc`)).json()).needs2fa, true);
  // A marca é desta pessoa: outro usuário no mesmo aparelho continua precisando do código.
  await post('/api/users', { name: 'Ana', login: 'ana', password: 'ana12345', role: 'admin' }, `zapauto_sessao=${cookiesOf(again).zapauto_sessao}`);
  const anaFirst = await post('/api/auth/login', { login: 'ana', password: 'ana12345' });
  const anaSec = await (await fetch(`${base}/api/security/2fa/setup`, { headers: { cookie: `zapauto_sessao=${cookiesOf(anaFirst).zapauto_sessao}` } })).json();
  await post('/api/security/2fa/enable', { code: totpCode(anaSec.secret) }, `zapauto_sessao=${cookiesOf(anaFirst).zapauto_sessao}`);
  assert.equal((await (await post('/api/auth/login', { login: 'ana', password: 'ana12345' }, trust)).json()).needs2fa, true);

  // "Sair de todos os aparelhos": a marca para de valer e o código volta a ser pedido.
  const s2 = cookiesOf(await post('/api/auth/login', { login: 'marcos', password: 'teste1234' }, trust)).zapauto_sessao;
  assert.equal((await post('/api/security/logout-all', {}, `zapauto_sessao=${s2}`)).status, 200);
  assert.equal((await (await post('/api/auth/login', { login: 'marcos', password: 'teste1234' }, trust)).json()).needs2fa, true);

  // Fica no registro de acessos.
  const s3 = cookiesOf(await post('/api/auth/login', { login: 'marcos', password: 'teste1234', code: totpCode(secret), remember: true })).zapauto_sessao;
  const log = await (await fetch(`${base}/api/security/log`, { headers: { cookie: `zapauto_sessao=${s3}` } })).json();
  assert.ok(log.events.some((e) => e.type === 'entrou_aparelho_confiavel'));
});
