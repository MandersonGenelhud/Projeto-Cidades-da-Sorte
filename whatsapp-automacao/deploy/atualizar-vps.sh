#!/usr/bin/env bash
# Atualiza o Migra Hub na VPS com a versão mais nova do projeto. Guarda uma cópia dos dados antes.
# Uso (na VPS):  bash /opt/migra/app/whatsapp-automacao/deploy/atualizar-vps.sh
set -euo pipefail
BRANCH="${BRANCH:-claude/whatsapp-automation-tool-247je5}"
KEY=/root/.ssh/migra_deploy
cd /opt/migra/app/whatsapp-automacao
echo "==> Cópia de segurança antes de atualizar"
bash deploy/backup-vps.sh
echo "==> Baixando a versão nova"
GIT_SSH_COMMAND="ssh -i $KEY -o StrictHostKeyChecking=accept-new" git -C /opt/migra/app fetch origin "$BRANCH"
# O Caddyfile (domínios do servidor) vem do Git só como modelo: guarda o seu e devolve depois, senão a atualização apaga os domínios.
CADDY_KEEP="/opt/migra/Caddyfile.local"
if [ -f Caddyfile ] && ! grep -q '^SEU_DOMINIO' Caddyfile; then cp Caddyfile "$CADDY_KEEP"; fi
git -C /opt/migra/app reset --hard "origin/$BRANCH"
if [ -f "$CADDY_KEEP" ]; then cat "$CADDY_KEEP" > Caddyfile; fi
# Guarda a versão instalada (o painel compara com a mais nova do GitHub em "Verificar atualização").
SHA="$(git -C /opt/migra/app rev-parse HEAD)"
DATA="$(git -C /opt/migra/app log -1 --format=%cI)"
VOL="$(docker volume ls -q | grep 'zapauto_data$' | head -1 || true)"
[ -n "$VOL" ] && docker run --rm -v "$VOL":/data alpine sh -c "printf '{\"sha\":\"$SHA\",\"date\":\"$DATA\"}' > /data/version.json && chown 1000:1000 /data/version.json" || true
echo "==> Reconstruindo e religando"
docker compose up -d --build
# O Caddy só relê o Caddyfile ao reiniciar.
docker compose restart caddy >/dev/null 2>&1 || true
docker image prune -f >/dev/null 2>&1 || true
docker compose logs --tail 10 zapauto
bash "$(dirname "$0")/ativar-atualizacao-painel.sh" >/dev/null 2>&1 || true
echo "Pronto. Os dados (contratos, vendas, WhatsApp) não foram mexidos."
