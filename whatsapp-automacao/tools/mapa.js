// Mapa do sistema: lê o código e gera (1) MAPA-DO-SISTEMA.md, a "memória" de onde cada coisa está e quem depende de quem, e
// (2) docs/exports.json, a lista do que cada módulo oferece (o teste de arquitetura avisa quando algo some). Não usa dados de cliente.
// Uso: npm run mapa        (gera os arquivos)      node tools/mapa.js --check   (só confere se estão em dia)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const walk = (dir, ext) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name), ext) : e.name.endsWith(ext) ? [path.join(dir, e.name)] : []));

export function analyze() {
  const src = walk('src', '.js').sort();
  const tests = walk('test', '.js').sort();
  const mods = Object.fromEntries(src.map((f) => {
    const text = read(f);
    const imports = [...text.matchAll(/(?:import|export)[^'"`;]*?from\s*['"](\.[^'"]+)['"]/g), ...text.matchAll(/import\(\s*['"](\.[^'"]+)['"]\s*\)/g)]
      .map((m) => path.normalize(path.join(path.dirname(f), m[1]))).filter((p) => src.includes(p));
    const exports = [...new Set([...text.matchAll(/^export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z0-9_$]+)/gm)].map((m) => m[1]).concat([...text.matchAll(/^export\s*\{([^}]+)\}/gm)].flatMap((m) => m[1].split(',').map((x) => x.trim().split(/\s+as\s+/).pop()).filter(Boolean))), /^export default/m.test(text) ? ['default'] : [])].sort();
    const first = text.split('\n').find((l) => l.startsWith('//')) || '';
    return [f, { lines: text.split('\n').length, imports: [...new Set(imports)].sort(), exports, about: first.replace(/^\/\/\s*/, '').slice(0, 160), importedBy: [], tests: [] }];
  }));
  for (const [f, m] of Object.entries(mods)) for (const i of m.imports) mods[i].importedBy.push(f);
  for (const t of tests) {
    const text = read(t);
    for (const m of [...text.matchAll(/['"]\.\.\/(src\/[^'"]+\.js)['"]/g)]) if (mods[m[1]] && !mods[m[1]].tests.includes(t)) mods[m[1]].tests.push(t);
  }
  // Ciclos de importação (A → B → A): quebram a regra "um módulo não atrapalha o outro".
  const cycles = new Set();
  const visit = (node, stack) => {
    if (stack.includes(node)) { const c = stack.slice(stack.indexOf(node)); const min = c.indexOf([...c].sort()[0]); cycles.add([...c.slice(min), ...c.slice(0, min)].join(' → ')); return; }
    for (const n of mods[node].imports) visit(n, [...stack, node]);
  };
  for (const f of Object.keys(mods)) visit(f, []);
  const server = read('src/server.js');
  const routeSrc = [server, ...fs.readdirSync(path.join(ROOT, 'src/routes')).map((f) => read('src/routes/' + f))].join('\n');
  const routes = [...routeSrc.matchAll(/^\s*app\.(get|post|put|patch|delete|use)\(\s*'([^']+)'/gm)].map((m) => `${m[1].toUpperCase()} ${m[2]}`);
  const intervals = [...server.matchAll(/(?<!const ping = )setInterval\(/g)].length;
  const intervalsUnref = [...server.matchAll(/setInterval\([\s\S]*?\.unref\(\)/g)].length;
  const store = read('src/store.js');
  const flags = [...new Set([...store.matchAll(/\b([A-Za-z]+\d{4}[a-z]?)\b\s*(?:=|\))/g)].map((m) => m[1]).filter((f) => /20\d\d/.test(f)))].sort();
  const front = [...read('public/index.html').matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  const entry = new Set(['src/server.js', 'src/patch-baileys.js', 'src/merge-data.js']);
  const orphans = Object.entries(mods).filter(([f, m]) => !m.importedBy.length && !entry.has(f)).map(([f]) => f);
  return { src, tests, mods, cycles: [...cycles].sort(), routes, intervals, intervalsUnref, flags, front, orphans };
}

export function render(a) {
  const area = (f) => (f.startsWith('src/agent/') ? 'IA do atendimento' : f.startsWith('src/transports/') ? 'Conexões' : f === 'src/server.js' ? 'Servidor' : 'Módulos');
  const rows = Object.entries(a.mods).map(([f, m]) => `| \`${f.replace(/^src\//, '')}\` | ${m.lines} | ${m.about.replace(/\|/g, '/')} | ${m.importedBy.length ? m.importedBy.map((x) => `\`${x.replace(/^src\//, '')}\``).join(', ') : '—'} | ${m.tests.length ? m.tests.length : '**0**'} |`);
  return `# Mapa do sistema (gerado por \`npm run mapa\`; não edite à mão)

> Esta é a memória de **onde cada coisa está e quem depende de quem**. Antes de mexer em um módulo, veja aqui quem o usa
> (\`npm run quem-usa -- src/<arquivo>.js\`), faça a mudança **sem apagar o que já é usado** (acrescente) e rode \`npm run mapa\` e \`npm test\`.
> A história de tudo o que foi feito, na ordem, está em \`LINHA-DO-TEMPO.md\`. As regras de segurança, em \`SEGURANCA.md\`.

## Números
- Módulos em \`src/\`: **${a.src.length}** · testes automatizados (arquivos): **${a.tests.length}** · scripts do painel: **${a.front.length}**
- Rotas da API em \`server.js\`: **${a.routes.length}** · tarefas agendadas (\`setInterval\`): **${a.intervals}** (todas com \`unref\`: ${a.intervals === a.intervalsUnref ? 'sim' : `NÃO, só ${a.intervalsUnref}`})
- Ciclos de importação (um módulo depender dele mesmo por outro): **${a.cycles.length}**${a.cycles.length ? `\n${a.cycles.map((c) => `  - ${c}`).join('\n')}` : ''}
- Módulos que ninguém usa: **${a.orphans.length}**${a.orphans.length ? ` (${a.orphans.map((o) => `\`${o}\``).join(', ')})` : ''}

## Como o sistema é montado (de baixo para cima)
1. **\`src/server.js\`** liga tudo (é o único arquivo que conhece todos os módulos) e expõe a API e o painel. Funcionalidade nova entra num **módulo próprio** e o servidor só a liga, sem copiar a lógica para dentro dele.
2. **Módulos de regra** (\`crm.js\`, \`sales.js\`, \`quotes.js\`, \`payments.js\`, \`closing.js\`...) guardam os dados em \`store\` (um arquivo JSON em \`data/\`, fora do Git) e não conhecem WhatsApp nem painel.
3. **IA do atendimento** (\`agent/\`): conversa com o cliente, usa ferramentas, é chamada por \`autoreply.js\` e pela fila \`pending.js\`.
4. **Assistentes internos**: \`maria.js\` (secretária da equipe), \`ana.js\` (pessoal), \`assistant.js\` (Nina, caixa).
5. **Conexões** (\`connection.js\`, \`lines.js\`, \`transports/\`): um número principal, um por vendedor e o Instagram; cada conta envia **uma mensagem por vez**.
6. **Painel** (\`public/\`): uma página (\`index.html\`) e um script por área; scripts novos entram na lista abaixo e **não alteram** os antigos.

## Regras para não quebrar o que já funciona
- Acrescente, não substitua: função, rota ou campo que já existe só some depois de conferir \`quem-usa\` e os testes.
- Cada funcionalidade nova: módulo novo em \`src/\`, teste novo em \`test/\`, rota registrada no servidor, linha em \`SEGURANCA.md\` quando mexe em dinheiro, acesso ou dado de cliente.
- Configuração nova vai em \`settings\` com **valor padrão** em \`store.js\`; mudança em dado já existente usa **migração de uma vez** com selo (veja abaixo), nunca sobrescreve o que o painel salvou.
- Nada de segredo no código. Dados reais ficam em \`data/\` e nunca no Git.

## Módulos (${a.src.length})
| Módulo | Linhas | Para que serve | Quem usa | Testes |
|---|---:|---|---|---:|
${rows.join('\n')}

## Migrações de uma vez (selos em \`store.js\`)
${a.flags.map((f) => `- \`${f}\``).join('\n')}

## Scripts do painel (\`public/index.html\`, na ordem de carga)
${a.front.map((f) => `- \`${f}\``).join('\n')}

## Rotas da API (${a.routes.length})
${a.routes.map((r) => `- \`${r}\``).join('\n')}
`;
}

export function exportsSnapshot(a) {
  return `${JSON.stringify(Object.fromEntries(Object.entries(a.mods).map(([f, m]) => [f, m.exports])), null, 1)}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = analyze();
  const map = render(a);
  const snap = exportsSnapshot(a);
  if (process.argv.includes('--check')) {
    const ok = read('MAPA-DO-SISTEMA.md') === map && read('docs/exports.json') === snap;
    console.log(ok ? 'Mapa em dia.' : 'O mapa está desatualizado: rode "npm run mapa".');
    process.exit(ok ? 0 : 1);
  }
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'MAPA-DO-SISTEMA.md'), map);
  fs.writeFileSync(path.join(ROOT, 'docs', 'exports.json'), snap);
  console.log(`Mapa gerado: ${a.src.length} módulos, ${a.routes.length} rotas, ${a.cycles.length} ciclo(s), ${a.orphans.length} módulo(s) sem uso, ${a.intervals} tarefas agendadas (${a.intervalsUnref} com unref).`);
}
