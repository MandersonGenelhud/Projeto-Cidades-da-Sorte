#!/usr/bin/env bash
# Copia a pasta "data" do computador (banco, contratos, sessão do WhatsApp, chaves) para a VPS.
# Uso (na VPS, dentro de /opt/migra/app/whatsapp-automacao):
#   bash deploy/migrar-dados.sh /root/migra-data
# ANTES: feche o Migra Hub no computador. Dois sistemas com o mesmo WhatsApp respondem o cliente em duplicidade.
set -euo pipefail
ORIGEM="${1:-}"
[ -d "$ORIGEM" ] || { echo "Informe a pasta com os dados copiados do computador. Ex.: bash deploy/migrar-dados.sh /root/migra-data"; exit 1; }
[ -f "$ORIGEM/db.json" ] || { echo "Não achei db.json em $ORIGEM. Copie a pasta 'data' inteira."; exit 1; }
cd "$(dirname "$0")/.."

echo "==> Parando o sistema na VPS"
docker compose stop zapauto
VOL="$(docker volume ls -q | grep 'zapauto_data$' | head -1 || true)"
[ -n "$VOL" ] || { docker compose up -d --no-start zapauto; VOL="$(docker volume ls -q | grep 'zapauto_data$' | head -1)"; }

STAMP="$(date +%Y%m%d-%H%M%S)"
echo "==> Guardando uma cópia do que já existe na VPS (antes-$STAMP)"
docker run --rm -v "$VOL":/data -v /root:/out alpine sh -c "tar czf /out/data-antes-$STAMP.tgz -C /data . || true"

echo "==> Copiando os dados do computador"
docker run --rm -v "$VOL":/data -v "$ORIGEM":/src:ro alpine sh -c 'cp -a /src/. /data/ && chown -R 1000:1000 /data'

echo "==> Ligando o sistema"
docker compose up -d zapauto
sleep 5
docker compose logs --tail 15 zapauto
echo
echo "Pronto. Entre no painel e confira: contratos, vendas, prospectos e o WhatsApp."
echo "Se o WhatsApp pedir o QR Code, é só ler de novo uma vez."
