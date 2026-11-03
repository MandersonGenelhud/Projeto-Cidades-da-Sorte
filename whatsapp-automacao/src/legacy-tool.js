// Monta o arquivo único CAPTURAR-CONTRATOS.bat que o administrador baixa pelo painel:
// ele instala o que faltar, grava a ferramenta e roda, sem abrir pasta nem PowerShell.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const MARKER = '::MIGRA_JS_INICIO';
const SOURCE = fileURLToPath(new URL('../tools/capturar-sistema/capturar.mjs', import.meta.url));

const HEAD = [
  '@echo off',
  'chcp 65001 >nul',
  'setlocal',
  'title Copiar contratos do sistema antigo',
  'set "DIR=%LOCALAPPDATA%\\MigraCaptura"',
  'if not exist "%DIR%" mkdir "%DIR%"',
  'where node >nul 2>nul',
  'if errorlevel 1 goto semnode',
  // Grava a ferramenta (o texto depois do marcador deste arquivo) na pasta de trabalho.
  `powershell -NoProfile -Command "$t=Get-Content -LiteralPath '%~f0' -Raw -Encoding UTF8; $m='::MIGRA_JS_'+'INICIO'; $i=$t.IndexOf($m); $js=$t.Substring($t.IndexOf([char]10,$i)+1); [IO.File]::WriteAllText('%DIR%\\capturar.mjs',$js,(New-Object Text.UTF8Encoding($false)))"`,
  'if not exist "%DIR%\\package.json" echo {"type":"module","private":true,"dependencies":{"playwright-core":"latest"}}> "%DIR%\\package.json"',
  'cd /d "%DIR%"',
  'if not exist "%DIR%\\node_modules\\playwright-core" echo Preparando a ferramenta, so na primeira vez. Aguarde...',
  'if not exist "%DIR%\\node_modules\\playwright-core" call npm install --no-audit --no-fund',
  'echo.',
  'node capturar.mjs --saida "%USERPROFILE%\\Desktop"',
  'if errorlevel 1 echo Ocorreu um erro. Tire uma foto desta tela e me mande.',
  'echo.',
  'pause',
  'exit /b 0',
  ':semnode',
  'echo O Node.js nao esta instalado. Vou instalar agora. Se pedir permissao, clique em Sim.',
  'winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements',
  'echo.',
  'echo Depois que terminar, FECHE esta janela e de dois cliques neste arquivo de novo.',
  'pause',
  'exit /b 1',
  MARKER,
];

export function buildBat(js = fs.readFileSync(SOURCE, 'utf8'), { url = '', token = '' } = {}) {
  // Com endereço e chave de envio, o programa manda tudo sozinho para o sistema novo no fim da cópia.
  const send = /^https?:\/\/[\w.:\-]+$/.test(url) && /^[\w-]{20,80}$/.test(token)
    ? [`set "MIGRA_URL=${url}"`, `set "MIGRA_TOKEN=${token}"`]
    : [];
  const head = HEAD.flatMap((l) => (l.startsWith('node capturar.mjs') ? [...send, l] : [l]));
  return `${head.join('\r\n')}\r\n${js.replace(/\r?\n/g, '\r\n')}`;
}
