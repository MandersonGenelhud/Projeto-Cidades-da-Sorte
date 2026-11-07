import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, render, exportsSnapshot } from '../tools/mapa.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const a = analyze();

test('arquitetura: sem dependência circular entre módulos', () => {
  assert.deepEqual(a.cycles, []);
});

test('arquitetura: nenhuma exportação foi perdida (docs/exports.json)', () => {
  const antes = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/exports.json'), 'utf8'));
  const agora = JSON.parse(exportsSnapshot(a));
  const perdidas = [];
  for (const [mod, nomes] of Object.entries(antes)) for (const n of nomes) if (!(agora[mod] || []).includes(n)) perdidas.push(`${mod}:${n}`);
  assert.deepEqual(perdidas, [], 'Rode "npm run mapa" se removeu de propósito; senão restaure.');
});

test('arquitetura: tarefas agendadas do servidor não seguram o processo (unref)', () => {
  assert.equal(a.intervals, a.intervalsUnref);
});

test('arquitetura: mapa do sistema está atualizado', () => {
  const atual = fs.readFileSync(path.join(ROOT, 'MAPA-DO-SISTEMA.md'), 'utf8');
  assert.equal(atual, render(a), 'MAPA-DO-SISTEMA.md desatualizado: rode "npm run mapa".');
});

test('arquitetura: nenhum módulo sem uso', () => {
  assert.deepEqual(a.orphans, []);
});
