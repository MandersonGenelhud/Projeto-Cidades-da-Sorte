#!/usr/bin/env bash
# Junta os dados do computador com os que já estão na VPS, SEM apagar nada da VPS: só acrescenta o que falta
# (clientes, conversas, mensagens, vendas, pagamentos, equipe, arquivos). Configurações e chaves da VPS ficam como estão.
# Uso (na VPS):  bash /opt/migra/app/whatsapp-automacao/deploy/mesclar-dados.sh /root/migra-data
# ANTES: feche o Migra Hub no computador e copie a pasta "data" para a VPS (scp -r data root@IP:/root/migra-data).
set -euo pipefail
ORIGEM="${1:-}"
[ -f "$ORIGEM/db.json" ] || { echo "Não achei $ORIGEM/db.json. Copie a pasta 'data' do computador inteira para a VPS."; exit 1; }
cd "$(dirname "$0")/.."
VOL="$(docker volume ls -q | grep 'zapauto_data$' | head -1)"
[ -n "$VOL" ] || { echo "Volume de dados da VPS não encontrado."; exit 1; }
STAMP="$(date +%Y%m%d-%H%M%S)"
echo "==> Parando o sistema e guardando uma cópia do que existe na VPS (/root/data-antes-merge-$STAMP.tgz)"
docker compose stop zapauto
docker run --rm -v "$VOL":/data -v /root:/out alpine sh -c "tar czf /out/data-antes-merge-$STAMP.tgz -C /data ."
echo "==> Juntando banco de dados"
docker run --rm -v "$VOL":/data -v "$ORIGEM":/src:ro -v "$PWD":/app-src:ro -v "$PWD/deploy":/s:ro node:22-alpine node /s/mesclar-dados.mjs /data/db.json /src/db.json
echo "==> Trazendo arquivos que faltam (contratos, orçamentos, recibos, fotos...). Nada é sobrescrito; a sessão do WhatsApp e as chaves da VPS não são mexidas"
for d in contratos orcamentos fechamento payments uploads realty brand-logo; do
  [ -d "$ORIGEM/$d" ] && docker run --rm -v "$VOL":/data -v "$ORIGEM":/src:ro alpine sh -c "mkdir -p /data/$d && cp -rn /src/$d/. /data/$d/ && chown -R 1000:1000 /data/$d" || true
done
docker run --rm -v "$VOL":/data alpine chown 1000:1000 /data/db.json
echo "==> Ligando o sistema"
docker compose up -d zapauto
sleep 5
docker compose logs --tail 8 zapauto
echo "Pronto. Abra o painel e confira. Se algo ficou errado, a cópia anterior está em /root/data-antes-merge-$STAMP.tgz"
