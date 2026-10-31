#!/usr/bin/env bash
# Troca o endereço do Migra Hub na VPS (ex.: de 187-41-108-131.sslip.io para app.migraparaguai.tech).
# Uso (na VPS):  bash /opt/migra/app/whatsapp-automacao/deploy/trocar-dominio.sh app.migraparaguai.tech
# O novo endereço precisa já apontar para o IP desta VPS (registro A), senão o HTTPS não liga.
set -euo pipefail
NOVO="${1:-}"
[ -n "$NOVO" ] || { echo "Informe o novo endereço. Ex.: bash trocar-dominio.sh app.migraparaguai.tech"; exit 1; }
cd /opt/migra/app/whatsapp-automacao
printf '%s {\n\treverse_proxy zapauto:3000\n}\n' "$NOVO" > Caddyfile
if grep -q '^PUBLIC_URL=' .env; then sed -i "s#^PUBLIC_URL=.*#PUBLIC_URL=https://$NOVO#" .env; else echo "PUBLIC_URL=https://$NOVO" >> .env; fi
docker compose up -d
sleep 3
docker compose logs --tail 8 caddy
echo "Pronto. Abra https://$NOVO (o HTTPS pode levar 1 a 2 minutos). Lembre de colar o novo endereço do webhook na Meta."
