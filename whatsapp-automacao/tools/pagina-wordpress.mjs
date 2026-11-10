// Gera docs/site-wordpress/grupo-migra.html: a página inicial do Grupo Migra em um arquivo só.
// Uso: node tools/pagina-wordpress.mjs [endereço-onde-vai-ficar] [endereço-do-hub]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStandaloneFromDisk } from '../src/site-standalone.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [origin = 'https://migraparaguai.com/grupo-migra', hub = 'https://migraparaguay.com'] = process.argv.slice(2);
const out = path.join(root, 'docs', 'site-wordpress', 'grupo-migra.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, buildStandaloneFromDisk(root, { origin, hub }));
console.log(`Pronto: ${out}`);
