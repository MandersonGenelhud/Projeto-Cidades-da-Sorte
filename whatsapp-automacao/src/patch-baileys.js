// Correção da biblioteca do WhatsApp (Baileys 7.0.0-rc14) enquanto a versão nova não sai:
// o WhatsApp aposentou a identificação "WIN32" e fecha a conexão (código 428) antes do QR Code.
// Troca por "WIN_HYBRID" (Baileys#2741). Roda sozinha ao iniciar e depois do npm install.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'node_modules', '@whiskeysockets', 'baileys', 'lib', 'Utils', 'validate-connection.js');

export function patchBaileys(file = FILE) {
  try {
    const src = fs.readFileSync(file, 'utf8');
    const fixed = src.replace('Windows: proto.ClientPayload.WebInfo.WebSubPlatform.WIN32', 'Windows: proto.ClientPayload.WebInfo.WebSubPlatform.WIN_HYBRID');
    if (fixed !== src) fs.writeFileSync(file, fixed);
    return fixed.includes('WebSubPlatform.WIN_HYBRID');
  } catch {
    return false; // biblioteca não instalada ainda: o npm install roda isto de novo
  }
}

patchBaileys();
