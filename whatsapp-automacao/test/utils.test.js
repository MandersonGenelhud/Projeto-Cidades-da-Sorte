import test from 'node:test';
import assert from 'node:assert/strict';
import { csvToContacts, isWithinBusinessHours, normalizePhone, renderTemplate, spin } from '../src/utils.js';

test('normalizePhone adiciona DDI do Brasil e valida', () => {
  assert.equal(normalizePhone('(21) 98765-4321'), '5521987654321');
  assert.equal(normalizePhone('21 3333-4444'), '552133334444');
  assert.equal(normalizePhone('+55 11 91234-5678'), '5511912345678');
  assert.equal(normalizePhone('021987654321'), '5521987654321');
  assert.equal(normalizePhone('+1 415 555 2671'), '14155552671');
  assert.equal(normalizePhone('123'), null);
  assert.equal(normalizePhone(''), null);
});

test('renderTemplate substitui variáveis e mantém as desconhecidas', () => {
  const out = renderTemplate('Oi {primeiro_nome}, seu nome é {nome} ({telefone}) {xyz}', { name: 'Maria Silva', phone: '5521' });
  assert.equal(out, 'Oi Maria, seu nome é Maria Silva (5521) {xyz}');
});

test('spin escolhe uma das opções, inclusive aninhadas', () => {
  for (let i = 0; i < 20; i++) {
    assert.ok(['Olá', 'Oi'].includes(spin('{Olá|Oi}')));
    assert.ok(['a1', 'a2', 'b'].includes(spin('{a{1|2}|b}')));
  }
});

test('csvToContacts com cabeçalho, ; e aspas', () => {
  const csv = '﻿Nome;Telefone;Tags;Cidade\n"Silva; Maria";21987654321;vip|rio;Niterói\nJoão;inválido;;\n';
  const list = csvToContacts(csv);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0], { phone: '5521987654321', name: 'Silva; Maria', tags: ['vip', 'rio'], fields: { cidade: 'Niterói' } });
});

test('csvToContacts sem cabeçalho detecta a coluna de telefone', () => {
  const list = csvToContacts('11912345678,Ana\nBruno,21987654321');
  assert.deepEqual(list.map((c) => [c.name, c.phone]), [['Ana', '5511912345678'], ['Bruno', '5521987654321']]);
});

test('isWithinBusinessHours', () => {
  const cfg = { enabled: true, days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00' };
  assert.equal(isWithinBusinessHours(cfg, new Date(2026, 9, 26, 10, 0)), true); // segunda 10h
  assert.equal(isWithinBusinessHours(cfg, new Date(2026, 9, 26, 18, 0)), false);
  assert.equal(isWithinBusinessHours(cfg, new Date(2026, 9, 25, 10, 0)), false); // domingo
  assert.equal(isWithinBusinessHours({ enabled: false }, new Date()), true);
});

test('queda do WhatsApp explicada em português no painel', async () => {
  const { describeClose } = await import('../src/transports/whatsapp-web.js');
  assert.match(describeClose(408), /internet do computador ou firewall/);
  assert.match(describeClose(440), /outro computador ou a VPS/);
  assert.match(describeClose(999, 'xyz'), /conexão caiu \(código 999\): xyz/);
});

test('correção da biblioteca do WhatsApp: troca a identificação WIN32 aposentada por WIN_HYBRID', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { patchBaileys } = await import('../src/patch-baileys.js');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pb-')), 'validate-connection.js');
  fs.writeFileSync(file, "const PLATFORM_MAP = {\n    'Mac OS': proto.ClientPayload.WebInfo.WebSubPlatform.DARWIN,\n    Windows: proto.ClientPayload.WebInfo.WebSubPlatform.WIN32\n};");
  assert.equal(patchBaileys(file), true);
  assert.match(fs.readFileSync(file, 'utf8'), /Windows: proto\.ClientPayload\.WebInfo\.WebSubPlatform\.WIN_HYBRID/);
  assert.equal(patchBaileys(file), true, 'rodar de novo não estraga');
  assert.equal(patchBaileys(path.join(os.tmpdir(), 'nao-existe.js')), false);
});
