// Endereço na internet (https) para o próprio computador, sem VPS:
// usa o túnel gratuito da Cloudflare (cloudflared). O Instagram precisa de um
// endereço público para entregar as mensagens do Direct no webhook.
// O endereço "trycloudflare.com" muda toda vez que o túnel é ligado de novo.
import { spawn, execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

const RELEASES = 'https://github.com/cloudflare/cloudflared/releases/latest/download';
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

/** Nome do arquivo do cloudflared para este sistema. */
export function downloadName(platform = process.platform, arch = process.arch) {
  const a = arch === 'arm64' ? 'arm64' : 'amd64';
  if (platform === 'win32') return { file: 'cloudflared-windows-amd64.exe', bin: 'cloudflared.exe' };
  if (platform === 'darwin') return { file: `cloudflared-darwin-${a}.tgz`, bin: 'cloudflared', tgz: true };
  return { file: `cloudflared-linux-${a}`, bin: 'cloudflared' };
}

/** Procura o endereço público nas mensagens que o cloudflared escreve. */
export function findTunnelUrl(text) {
  return String(text || '').match(URL_RE)?.[0] || null;
}

export class Tunnel extends EventEmitter {
  constructor({ dataDir, port, fetchImpl = globalThis.fetch }) {
    super();
    this.binDir = path.join(dataDir, 'bin');
    this.port = port;
    this.fetch = fetchImpl;
    this.proc = null;
    this.state = { status: 'off', url: null, error: null };
  }

  #set(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('status', this.state);
  }

  async #binary() {
    const { file, bin, tgz } = downloadName();
    const target = path.join(this.binDir, bin);
    if (fs.existsSync(target)) return target;
    fs.mkdirSync(this.binDir, { recursive: true });
    this.#set({ status: 'downloading', error: null });
    const res = await this.fetch(`${RELEASES}/${file}`);
    if (!res.ok) throw new Error(`Não consegui baixar o túnel (HTTP ${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (tgz) {
      const tmp = path.join(this.binDir, file);
      fs.writeFileSync(tmp, buf);
      await new Promise((resolve, reject) => execFile('tar', ['-xzf', tmp, '-C', this.binDir], (err) => (err ? reject(err) : resolve())));
      fs.rmSync(tmp, { force: true });
    } else {
      fs.writeFileSync(target, buf);
    }
    fs.chmodSync(target, 0o755);
    return target;
  }

  async start() {
    if (this.proc) return this.state;
    this.#set({ status: 'starting', url: null, error: null });
    let bin;
    try {
      bin = await this.#binary();
    } catch (err) {
      this.#set({ status: 'error', error: err.message });
      throw err;
    }
    this.#set({ status: 'starting' });
    const proc = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${this.port}`], { windowsHide: true });
    this.proc = proc;
    const onData = (chunk) => {
      const url = findTunnelUrl(chunk);
      if (url && url !== this.state.url) this.#set({ status: 'on', url, error: null });
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (err) => this.#set({ status: 'error', error: err.message }));
    proc.on('exit', (code) => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.#set({ status: code === 0 || this.stopping ? 'off' : 'error', url: null, error: this.stopping ? null : `O túnel fechou (código ${code})` });
      this.stopping = false;
    });
    // Espera o endereço aparecer (normalmente em 5 a 15 segundos).
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 30_000);
      const check = (st) => {
        if (st.url || st.status === 'error' || st.status === 'off') {
          clearTimeout(t);
          this.off('status', check);
          resolve();
        }
      };
      this.on('status', check);
    });
    if (!this.state.url && this.state.status !== 'error') this.#set({ status: 'error', error: 'O túnel não informou o endereço. Confira a internet e tente de novo.' });
    return this.state;
  }

  stop() {
    if (!this.proc) return this.state;
    this.stopping = true;
    this.proc.kill();
    return this.state;
  }
}
