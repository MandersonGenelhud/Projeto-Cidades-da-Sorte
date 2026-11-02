import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';

test('texto antigo "RG ou passaporte" gravado na base é corrigido uma vez', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-rg-'));
  const s1 = new Store(dir);
  s1.data.settings.agent.systemPrompt = 'Peça uma foto do RG ou passaporte e outra de meio corpo. Também: RG (ou passaporte).';
  delete s1.data.settings.agent.rgFix2026;
  s1.flush();
  const s2 = new Store(dir);
  const t = s2.data.settings.agent.systemPrompt;
  assert.ok(!/ou passaporte/i.test(t));
  assert.equal((t.match(/o passaporte não serve agora/g) || []).length, 2);
  assert.equal(s2.data.settings.agent.rgFix2026, true);
});
