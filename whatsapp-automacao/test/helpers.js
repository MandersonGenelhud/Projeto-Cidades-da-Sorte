import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Store } from '../src/store.js';

export function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-test-'));
  const store = new Store(dir);
  // Nos testes o agente responde na hora (o ritmo humano tem testes próprios).
  store.updateSettings({ agent: { humanize: { enabled: false }, workHours: { enabled: false } } }); // testes não dependem da hora do relógio (o horário 7h–23h tem testes próprios)
  return store;
}

/** WhatsApp falso que só registra as mensagens enviadas. */
export class FakeWA extends EventEmitter {
  constructor() {
    super();
    this.status = 'connected';
    this.sent = [];
    this.failFor = new Set();
  }
  async send(to, payload) {
    if (this.failFor.has(to)) throw new Error('falha simulada');
    this.sent.push({ to, ...payload });
    return { id: String(this.sent.length) };
  }
}
