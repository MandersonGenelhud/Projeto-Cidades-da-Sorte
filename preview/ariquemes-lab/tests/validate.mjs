import assert from 'node:assert/strict';
import { readFileSync,existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const load=f=>readFileSync(join(root,f),'utf8');
const a=load('index.html'),b=load('rotas.html'),cssA=load('styles.css'),cssB=load('rotas.css'),jsA=load('app.js'),jsB=load('rotas.js');
for(const [filename,text] of [['index.html',a],['rotas.html',b]]) {
 assert.match(text,/<html lang="pt-BR">/i,filename);
 assert.match(text,/name="viewport"/,filename);
 assert.match(text,/name="robots" content="noindex,nofollow"/,filename);
 assert.match(text,/Ariquemes da Sorte|ARIQUEMES/i,filename);
 assert.match(text,/NÃO|não|sem campanhas|SEM CAMPANHAS|sem sorteios/i,filename);
 assert.doesNotMatch(text,/<form\b|type="submit"/i,filename);
 assert.doesNotMatch(text,/meta name="google-site-verification"|gtag\(/,filename);
 assert.doesNotMatch(text,/<script[^>]+src="https?:/i,filename);
 assert.ok((text.match(/<a\b/g)||[]).length >= 6,filename+' navigation');
 for(const m of text.matchAll(/(?:href|src)="(\.\/?[^"#]+)"/g)) {
   assert.ok(existsSync(join(root,m[1])),filename+' local link missing: '+m[1]);
 }
}
assert.notEqual(a,b);
assert.match(a,/story-grid/);
assert.match(a,/prize-ticket/);
assert.match(a,/plataforma de sorteios/);
assert.match(a,/não anunciam prêmios/);
assert.match(a,/regras, valores, condições e resultados/);
assert.match(a,/VISUAL ILUSTRATIVO/);
assert.match(a,/PRÉVIA CRIATIVA/);
assert.match(cssA,/#6748ff/i);
assert.match(cssA,/#ff4eb8/i);
assert.match(cssA,/#24c5ff/i);
assert.match(cssA,/joy-ribbon/);
assert.match(cssA,/ticketFloat/);
assert.match(b,/route-selector/);
assert.match(cssB, /colorful future/);
assert.match(cssB, /#7150fe/i);
assert.match(jsB,/aria-pressed/);
assert.match(cssA,/prefers-reduced-motion:reduce/);
assert.match(cssB,/prefers-reduced-motion:reduce/);
assert.match(jsA,/IntersectionObserver/);
assert.match(a,/href="\.\/rotas\.html"/);
assert.match(b,/href="\.\/index\.html"/);
console.log('PASS: 2 paginas, links, acessibilidade basica e ausencia de cadastro real');
