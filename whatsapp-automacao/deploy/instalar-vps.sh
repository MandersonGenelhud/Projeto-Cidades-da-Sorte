#!/usr/bin/env bash
# Instala o Migra Hub numa VPS Ubuntu 24.04 (Hostinger ou outra), com HTTPS automático.
# Uso (como root, na VPS):  bash instalar-vps.sh app.migraparaguai.tech
# Antes: no painel do domínio, crie um registro A "app" apontando para o IP da VPS.
# Este script NÃO guarda nem pede senhas ou tokens. O repositório é baixado com uma chave de leitura (deploy key).
set -euo pipefail

DOMINIO="${1:-}"
BRANCH="${BRANCH:-claude/whatsapp-automation-tool-247je5}"
REPO="${REPO:-git@github.com:MandersonGenelhud/Projeto-Cidades-da-Sorte.git}"
DIR=/opt/migra
[ -n "$DOMINIO" ] || { echo "Informe o endereço. Ex.: bash instalar-vps.sh app.migraparaguai.tech"; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo "Rode como root (sudo -i)."; exit 1; }

echo "==> 1/6 Atualizando o sistema e instalando proteções"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y ufw fail2ban unattended-upgrades git curl ca-certificates
systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades || true

echo "==> 2/6 Firewall: só SSH (22), HTTP (80) e HTTPS (443)"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> 3/6 Instalando o Docker"
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh

REPO_HTTPS="${REPO_HTTPS:-https://github.com/MandersonGenelhud/Projeto-Cidades-da-Sorte.git}"
mkdir -p "$DIR"
echo "==> 4/6 Baixando o projeto"
if [ -d "$DIR/app/.git" ]; then
  # Já instalado antes: atualiza pelo mesmo caminho que foi usado (HTTPS público ou chave de leitura).
  if GIT_TERMINAL_PROMPT=0 git -C "$DIR/app" fetch origin "$BRANCH" 2>/dev/null; then :; else
    GIT_SSH_COMMAND="ssh -i /root/.ssh/migra_deploy -o StrictHostKeyChecking=accept-new" git -C "$DIR/app" fetch origin "$BRANCH"
  fi
  git -C "$DIR/app" checkout "$BRANCH"
  git -C "$DIR/app" reset --hard "origin/$BRANCH"
elif GIT_TERMINAL_PROMPT=0 git clone -b "$BRANCH" "$REPO_HTTPS" "$DIR/app" 2>/dev/null; then
  echo "Projeto baixado (repositório público)."
else
  echo "O repositório é privado: vou criar uma chave de leitura (deploy key)."
  mkdir -p /root/.ssh && chmod 700 /root/.ssh
  KEY=/root/.ssh/migra_deploy
  [ -f "$KEY" ] || ssh-keygen -t ed25519 -N "" -C "migra-vps-deploy" -f "$KEY"
  echo
  echo "Copie a linha abaixo (é a chave PÚBLICA, pode copiar) e cadastre no GitHub:"
  echo "  GitHub > repositório Projeto-Cidades-da-Sorte > Settings > Deploy keys > Add deploy key"
  echo "  Título: VPS Migra · NÃO marque 'Allow write access' · Add key"
  echo
  cat "$KEY.pub"
  echo
  read -r -p "Depois de cadastrar a chave no GitHub, aperte ENTER para continuar... " _
  GIT_SSH_COMMAND="ssh -i $KEY -o StrictHostKeyChecking=accept-new" git clone -b "$BRANCH" "$REPO" "$DIR/app"
fi
cd "$DIR/app/whatsapp-automacao"

echo "==> 6/6 Configurando e ligando"
[ -f .env ] || cp .env.example .env
chmod 600 .env
grep -q '^PUBLIC_URL=' .env || echo "PUBLIC_URL=https://$DOMINIO" >> .env
grep -q '^TUNNEL=' .env || echo "TUNNEL=off" >> .env
# Código para criar o primeiro administrador (ninguém que ache o endereço consegue tomar o sistema antes de você).
grep -q '^SETUP_CODE=' .env || echo "SETUP_CODE=$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')" >> .env
SETUP_CODE_SHOWN="$(grep '^SETUP_CODE=' .env | cut -d= -f2)"
sed -i "s/SEU_DOMINIO/$DOMINIO/" Caddyfile
docker compose up -d --build

# Cópia diária dos dados (guarda 14 dias em /opt/migra/backups)
cat > /etc/cron.daily/migra-backup <<CRON
#!/bin/sh
bash $DIR/app/whatsapp-automacao/deploy/backup-vps.sh >> /var/log/migra-backup.log 2>&1
CRON
chmod +x /etc/cron.daily/migra-backup

echo
echo "CÓDIGO DE INSTALAÇÃO (guarde; só vale para criar o primeiro administrador): $SETUP_CODE_SHOWN"
echo "Pronto! Abra https://$DOMINIO (o HTTPS pode levar 1 a 2 minutos para aparecer)."
echo "Na primeira vez, crie o administrador e ligue a verificação em duas etapas."
echo "Para trazer os dados do computador: bash deploy/migrar-dados.sh /caminho/da/pasta/data"
echo "Para atualizar depois: bash $DIR/app/whatsapp-automacao/deploy/atualizar-vps.sh"
