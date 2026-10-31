#!/usr/bin/env bash
# Cópia diária dos dados (banco, contratos, sessões do WhatsApp, chaves) para /opt/migra/backups, guardando os últimos 14 dias.
# Os arquivos contêm segredos: ficam só no servidor (permissão 600). Cópia para fora da VPS: configure em Configurações → Segurança.
set -euo pipefail
OUT=/opt/migra/backups
mkdir -p "$OUT" && chmod 700 "$OUT"
VOL="$(docker volume ls -q | grep 'zapauto_data$' | head -1 || true)"
[ -n "$VOL" ] || { echo "Volume de dados não encontrado."; exit 1; }
FILE="$OUT/migra-data-$(date +%Y%m%d-%H%M%S).tgz"
docker run --rm -v "$VOL":/data:ro alpine tar czf - -C /data . > "$FILE"
chmod 600 "$FILE"
find "$OUT" -name 'migra-data-*.tgz' -mtime +14 -delete
echo "Cópia guardada: $FILE"
