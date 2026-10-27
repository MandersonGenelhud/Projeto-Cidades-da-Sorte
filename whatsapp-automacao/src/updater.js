// Atualização com um clique: baixa a versão mais nova do GitHub e troca só o código.
// A pasta data/ (configurações, conversas, conexão do WhatsApp) nunca é tocada.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const UPDATE_SOURCE = {
  owner: 'MandersonGenelhud',
  repo: 'Projeto-Cidades-da-Sorte',
  branch: 'claude/whatsapp-automation-tool-247je5',
  folder: 'whatsapp-automacao',
};

// O que é substituído na atualização (tudo o mais fica como está). Os atalhos INICIAR
// ficam de fora: o Windows e o Mac leem esses arquivos enquanto eles estão rodando.
const UPDATED_PATHS = ['src', 'public', 'package.json', 'package-lock.json', 'README.md'];

export const RESTART_EXIT_CODE = 3; // os atalhos INICIAR reabrem o programa com este código

export class Updater {
  constructor({ root, dataDir, fetchImpl = globalThis.fetch, source = UPDATE_SOURCE }) {
    this.root = root;
    this.dir = path.join(dataDir, 'update');
    this.versionFile = path.join(dataDir, 'version.json');
    this.fetch = fetchImpl;
    this.source = source;
    this.busy = false;
  }

  currentVersion() {
    try {
      return JSON.parse(fs.readFileSync(this.versionFile, 'utf8'));
    } catch {
      return { sha: null, date: null };
    }
  }

  /** Consulta o último commit publicado no GitHub. */
  async latestVersion() {
    const { owner, repo, branch } = this.source;
    const res = await this.fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'zapauto-updater' },
    });
    if (!res.ok) throw new Error(`Não foi possível consultar o GitHub (HTTP ${res.status})`);
    const data = await res.json();
    return { sha: data.sha, date: data.commit?.committer?.date || null, message: (data.commit?.message || '').split('\n')[0] };
  }

  async check() {
    const current = this.currentVersion();
    const latest = await this.latestVersion();
    return { current, latest, updateAvailable: !current.sha || current.sha !== latest.sha };
  }

  /** Baixa, extrai, copia o código novo e instala dependências se mudaram. */
  async update() {
    if (this.busy) throw new Error('Já existe uma atualização em andamento');
    this.busy = true;
    try {
      const latest = await this.latestVersion();
      const { owner, repo, folder } = this.source;
      fs.rmSync(this.dir, { recursive: true, force: true });
      fs.mkdirSync(this.dir, { recursive: true });

      const res = await this.fetch(`https://codeload.github.com/${owner}/${repo}/tar.gz/${latest.sha}`);
      if (!res.ok) throw new Error(`Falha ao baixar a atualização (HTTP ${res.status})`);
      const archive = path.join(this.dir, 'latest.tar.gz');
      fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()));

      // O "tar" já vem no Windows 10/11, no Mac e no Linux.
      const out = path.join(this.dir, 'x');
      fs.mkdirSync(out);
      await run('tar', ['-xzf', archive, '-C', out]);
      const [top] = fs.readdirSync(out);
      const src = path.join(out, top, folder);
      if (!top || !fs.existsSync(path.join(src, 'src', 'server.js'))) throw new Error('Arquivo de atualização inválido');

      const lockBefore = this.#read(path.join(this.root, 'package-lock.json'));
      for (const item of UPDATED_PATHS) {
        const from = path.join(src, item);
        if (!fs.existsSync(from)) continue;
        fs.cpSync(from, path.join(this.root, item), { recursive: true, force: true });
      }
      const depsChanged = lockBefore !== this.#read(path.join(this.root, 'package-lock.json'));
      if (depsChanged) {
        const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
        await run(npm, ['install', '--omit=dev'], { cwd: this.root, shell: process.platform === 'win32', timeout: 10 * 60_000 });
      }

      fs.writeFileSync(this.versionFile, JSON.stringify({ sha: latest.sha, date: latest.date, message: latest.message }, null, 2));
      fs.rmSync(this.dir, { recursive: true, force: true });
      return { updated: true, version: latest, depsChanged };
    } finally {
      this.busy = false;
    }
  }

  #read(file) {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return '';
    }
  }
}
