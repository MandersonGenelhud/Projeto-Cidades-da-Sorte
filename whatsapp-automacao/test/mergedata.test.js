import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mergeData } from '../src/merge-data.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('mesclar dados: acrescenta só o que falta, sem sobrescrever a VPS e sem repetir mensagens', () => {
  const vps = {
    settings: { agent: { geminiKey: 'CHAVE-NOVA-DA-VPS', enabled: true } },
    users: [{ id: 'u1', name: 'Marcos (VPS)' }],
    contacts: [{ phone: '5511900000001', name: 'Ana' }],
    leads: [{ id: 'L1', name: 'Lead da VPS', stage: 'proposta' }],
    conversations: { 'a@s.whatsapp.net': { messages: [{ role: 'user', content: 'oi', at: '2026-11-01T10:00:00Z' }, { role: 'assistant', content: 'olá', at: '2026-11-01T10:01:00Z' }] } },
    logs: [{ at: 'x', message: 'log da VPS' }],
  };
  const pc = {
    settings: { agent: { geminiKey: 'CHAVE-VELHA-DO-PC', enabled: false, novaOpcao: 1 }, novo: { a: 1 } },
    users: [{ id: 'u1', name: 'Marcos (PC)' }, { id: 'u2', name: 'Camila' }],
    contacts: [{ phone: '5511900000001', name: 'Ana (PC)' }, { phone: '5511900000002', name: 'Bia' }],
    leads: [{ id: 'L1', name: 'Lead do PC', stage: 'novo' }, { id: 'L2', name: 'Lead só do PC' }],
    conversations: {
      'a@s.whatsapp.net': { messages: [{ role: 'user', content: 'oi', at: '2026-11-01T10:00:00Z' }, { role: 'user', content: 'quanto custa?', at: '2026-11-01T09:59:00Z' }] },
      'b@s.whatsapp.net': { messages: [{ role: 'user', content: 'bom dia', at: '2026-11-01T08:00:00Z' }] },
    },
    logs: [{ at: 'y', message: 'log do PC' }],
    sales: [{ id: 'S1', number: 'V-1' }],
  };
  const stats = mergeData(vps, pc);
  assert.equal(vps.settings.agent.geminiKey, 'CHAVE-NOVA-DA-VPS', 'a chave e as configurações da VPS não são sobrescritas');
  assert.equal(vps.settings.agent.enabled, true);
  assert.equal(vps.settings.agent.novaOpcao, 1, 'opção que não existia na VPS é acrescentada');
  assert.deepEqual(vps.users.map((u) => u.name), ['Marcos (VPS)', 'Camila'], 'o usuário da VPS fica; o que só existe no PC entra');
  assert.deepEqual(vps.contacts.map((c) => c.name), ['Ana', 'Bia']);
  assert.deepEqual(vps.leads.map((l) => l.name), ['Lead da VPS', 'Lead só do PC']);
  assert.deepEqual(vps.conversations['a@s.whatsapp.net'].messages.map((m) => m.content), ['quanto custa?', 'oi', 'olá'], 'sem repetir e em ordem de horário');
  assert.equal(vps.conversations['b@s.whatsapp.net'].messages.length, 1, 'conversa que só existia no PC entra');
  assert.equal(vps.sales.length, 1, 'lista que a VPS nem tinha');
  assert.equal(vps.logs.length, 1, 'registros do PC não são trazidos');
  assert.equal(stats.added.users, 1);
  // Rodar de novo não duplica nada.
  const again = mergeData(vps, pc);
  assert.equal(Object.values(again.added).reduce((a, b) => a + b, 0), 0);
});

test('script de mesclagem lê e grava o banco de verdade', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-merge-'));
  const dest = path.join(dir, 'dest.json');
  const src = path.join(dir, 'src.json');
  fs.writeFileSync(dest, JSON.stringify({ users: [{ id: 'a' }], conversations: {} }));
  fs.writeFileSync(src, JSON.stringify({ users: [{ id: 'a' }, { id: 'b' }], conversations: { 'x@s.whatsapp.net': { messages: [{ role: 'user', content: 'oi' }] } } }));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'deploy/mesclar-dados.mjs'), dest, src], { env: { ...process.env, MERGE_LIB: path.join(ROOT, 'src/merge-data.js') }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(fs.readFileSync(dest, 'utf8'));
  assert.deepEqual(out.users.map((u) => u.id), ['a', 'b']);
  assert.ok(out.conversations['x@s.whatsapp.net']);
});
