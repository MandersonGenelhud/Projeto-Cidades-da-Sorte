import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Updater } from '../src/updater.js';

test('atualiza o código a partir do GitHub sem tocar na pasta data', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-'));
  // Pacote "publicado": Projeto-abc123/whatsapp-automacao/...
  const pub = path.join(tmp, 'pub', 'Projeto-abc123', 'whatsapp-automacao');
  fs.mkdirSync(path.join(pub, 'src'), { recursive: true });
  fs.mkdirSync(path.join(pub, 'public'), { recursive: true });
  fs.writeFileSync(path.join(pub, 'src', 'server.js'), '// versão nova');
  fs.writeFileSync(path.join(pub, 'public', 'app.js'), '// painel novo');
  fs.writeFileSync(path.join(pub, 'package-lock.json'), '{}');
  fs.writeFileSync(path.join(pub, 'INICIAR-WINDOWS.bat'), 'NÃO DEVE SER COPIADO');
  const tgz = path.join(tmp, 'pkg.tar.gz');
  execFileSync('tar', ['-czf', tgz, '-C', path.join(tmp, 'pub'), 'Projeto-abc123']);

  // Instalação atual
  const root = path.join(tmp, 'app');
  const data = path.join(root, 'data');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'server.js'), '// versão velha');
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
  fs.writeFileSync(path.join(root, 'INICIAR-WINDOWS.bat'), 'atalho original');
  fs.writeFileSync(path.join(data, 'db.json'), '{"meus":"dados"}');

  const auth = [];
  const fetchImpl = async (url, opts = {}) => {
    auth.push(opts.headers?.Authorization || '');
    if (url.includes('/commits/')) return { ok: true, json: async () => ({ sha: 'abc123', commit: { message: 'Melhora o ritmo humano\n\ndetalhes', committer: { date: '2026-10-27T12:00:00Z' } } }) };
    return { ok: true, arrayBuffer: async () => fs.readFileSync(tgz) };
  };
  const up = new Updater({ root, dataDir: data, fetchImpl, token: () => 'github_pat_leitura' });
  assert.equal((await up.check()).updateAvailable, true);

  const r = await up.update();
  assert.equal(r.updated, true);
  assert.equal(r.depsChanged, false);
  assert.equal(fs.readFileSync(path.join(root, 'src', 'server.js'), 'utf8'), '// versão nova');
  assert.equal(fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8'), '// painel novo');
  assert.equal(fs.readFileSync(path.join(root, 'INICIAR-WINDOWS.bat'), 'utf8'), 'atalho original');
  assert.equal(fs.readFileSync(path.join(data, 'db.json'), 'utf8'), '{"meus":"dados"}');
  assert.ok(auth.every((a) => a === 'Bearer github_pat_leitura'), 'repositório privado: usa a chave de leitura');
  // Privado sem chave: mensagem clara.
  const priv = new Updater({ root, dataDir: data, fetchImpl: async () => ({ ok: false, status: 404 }) });
  await assert.rejects(() => priv.check(), /repositório está privado/);
  assert.equal((await up.check()).updateAvailable, false);
  assert.equal(fs.existsSync(path.join(data, 'update')), false);
});
