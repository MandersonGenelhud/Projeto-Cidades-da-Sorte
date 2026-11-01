// Uso (dentro do contêiner de manutenção): node mesclar-dados.mjs /data/db.json /src/db.json
import fs from 'node:fs';
const { mergeData } = await import(process.env.MERGE_LIB || '/app-src/src/merge-data.js');

const [, , destFile, srcFile] = process.argv;
const dest = JSON.parse(fs.readFileSync(destFile, 'utf8'));
const src = JSON.parse(fs.readFileSync(srcFile, 'utf8'));
const stats = mergeData(dest, src);
fs.writeFileSync(`${destFile}.tmp`, JSON.stringify(dest));
fs.renameSync(`${destFile}.tmp`, destFile);
const rows = Object.entries(stats.added).filter(([k]) => !k.includes('.') || k.startsWith('conversations.')).sort();
console.log(rows.length ? 'O que foi acrescentado:' : 'Nada novo para acrescentar: a VPS já tinha tudo.');
for (const [k, n] of Object.entries(stats.added).filter(([k]) => ['contacts', 'conversations', 'leads', 'users', 'sales', 'payments', 'cash', 'visits', 'quotes', 'learnings', 'pending'].includes(k.split('.')[0]) && k.split('.').length <= 2).sort()) console.log(`  ${k}: +${n}`);
