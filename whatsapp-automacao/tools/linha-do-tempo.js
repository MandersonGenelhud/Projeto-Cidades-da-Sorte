#!/usr/bin/env node
// Gera LINHA-DO-TEMPO.md a partir do git log (uma linha por commit) + marcos escritos à mão em docs/marcos.md
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const log = execFileSync('git', ['log', '--date=short', '--pretty=format:%ad|%h|%s', '--', '.'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
const marcosFile = path.join(ROOT, 'docs/marcos.md');
const marcos = fs.existsSync(marcosFile) ? fs.readFileSync(marcosFile, 'utf8') : '';
const porDia = new Map();
for (const l of log) { const [d, h, ...s] = l.split('|'); if (!porDia.has(d)) porDia.set(d, []); porDia.get(d).push(`- \`${h}\` ${s.join('|')}`); }
let out = '# Linha do tempo do Migra Hub\n\nGerado por `npm run linha-do-tempo`. Não edite à mão: os marcos ficam em `docs/marcos.md`.\n\n';
if (marcos) out += `## Marcos (escritos à mão)\n\n${marcos}\n\n`;
out += '## Histórico de mudanças (do Git)\n\n';
for (const [d, ls] of porDia) out += `### ${d}\n${ls.join('\n')}\n\n`;
fs.writeFileSync(path.join(ROOT, 'LINHA-DO-TEMPO.md'), out);
console.log(`LINHA-DO-TEMPO.md: ${log.length} commits em ${porDia.size} dias.`);
