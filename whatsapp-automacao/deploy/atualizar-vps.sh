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
git -C /opt/migra/app reset --hard "origin/$BRANCH"
echo "==> Reconstruindo e religando"
docker compose up -d --build
docker image prune -f >/dev/null 2>&1 || true
docker compose logs --tail 10 zapauto
echo "Pronto. Os dados (contratos, vendas, WhatsApp) não foram mexidos."
