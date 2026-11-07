#!/usr/bin/env node
// Uso: npm run quem-usa -- src/pending.js   -> lista quem importa esse arquivo (impacto de mexer nele)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const alvo = process.argv[2];
if (!alvo) { console.log('Uso: npm run quem-usa -- src/arquivo.js'); process.exit(1); }
const base = path.basename(alvo);
const dirs = ['src', 'src/routes', 'src/agent', 'test', 'tools', 'deploy'];
const achados = [];
for (const d of dirs) {
  const dir = path.join(ROOT, d);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!/\.(m?js)$/.test(f)) continue;
    const rel = `${d}/${f}`;
    const txt = fs.readFileSync(path.join(dir, f), 'utf8');
    if (new RegExp(`from\\s+['"][^'"]*${base.replace('.', '\\.')}['"]|import\\(['"][^'"]*${base.replace('.', '\\.')}['"]`).test(txt)) achados.push(rel);
  }
}
console.log(`Quem usa ${alvo}:`);
for (const a of achados) console.log(' -', a);
if (!achados.length) console.log(' (ninguém importa - pode ser ponto de entrada ou código sem uso)');
