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
assert.match(a,/feature-grid/);
assert.match(a,/platform-window/);
assert.match(a,/plataforma de sorteios/);
assert.match(a,/não há prêmios anunciados/i);
assert.match(a,/condições, regras, valores, prazos e resultados/);
assert.match(a,/Prévia ilustrativa/);
assert.match(a,/PRÉVIA DE DESIGN/);
assert.match(cssA,/#6535c7/i);
assert.match(cssA,/#f18a35/i);
assert.match(cssA,/#42a95b/i);
assert.match(cssA,/#1877f2/i);
assert.match(cssA,/#ffffff|--white:#fff/i);
assert.doesNotMatch(cssA,/#ff4eb8|#24c5ff|joy-ribbon|ticketFloat/i);
assert.match(a,/O FUTURO DOS SORTEIOS LOCAIS/);
assert.match(cssA,/--white:#fff/);
assert.match(cssA,/platform-window/);
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
