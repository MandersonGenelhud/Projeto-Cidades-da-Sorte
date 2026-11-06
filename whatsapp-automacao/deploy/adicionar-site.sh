#!/usr/bin/env bash
# Liga o domínio de um SITE PÚBLICO da Migra (separado do painel) nesta VPS, para um dos escritórios.
# Uso (na VPS):  bash /opt/migra/app/whatsapp-automacao/deploy/adicionar-site.sh migraparaguay.com py
#                bash /opt/migra/app/whatsapp-automacao/deploy/adicionar-site.sh migraparaguay.com.br pr
# (py = escritório do Paraguai, pr = escritório do Paraná; sem o segundo parâmetro vale py)
# Antes: no painel do registro do domínio, crie o registro A (nome @ e também www) apontando para o IP desta VPS.
# No endereço do site só aparecem as páginas públicas: o painel e o login continuam só no endereço do sistema.
# Quem se cadastrar nesse site entra no CRM já marcado com o escritório do domínio.
set -euo pipefail
DOM="${1:-}"
OFF="${2:-py}"
[ -n "$DOM" ] || { echo "Informe o domínio. Ex.: bash adicionar-site.sh migraparaguay.com.br pr"; exit 1; }
case "$OFF" in py|pr) ;; *) echo "O escritório precisa ser py (Paraguai) ou pr (Paraná)."; exit 1;; esac
DOM="${DOM#https://}"; DOM="${DOM#http://}"; DOM="${DOM#www.}"; DOM="${DOM%%/*}"
cd /opt/migra/app/whatsapp-automacao
if ! grep -q "reverse_proxy zapauto:3000" Caddyfile; then echo "Caddyfile inesperado. Rode antes o trocar-dominio.sh."; exit 1; fi
if ! grep -q "^$DOM, www.$DOM {" Caddyfile; then
  printf '\n%s, www.%s {\n\treverse_proxy zapauto:3000\n}\n' "$DOM" "$DOM" >> Caddyfile
fi
# Mantém os outros domínios já ligados e troca só as linhas deste.
ATUAL="$(grep '^SITE_HOSTS=' .env | head -1 | cut -d= -f2- || true)"
NOVO=""
IFS=',' read -ra PARTES <<< "$ATUAL"
for P in "${PARTES[@]:-}"; do
  H="${P%%=*}"
  [ -z "$H" ] && continue
  [ "$H" = "$DOM" ] || [ "$H" = "www.$DOM" ] && continue
  NOVO="${NOVO:+$NOVO,}$P"
done
NOVO="${NOVO:+$NOVO,}$DOM=$OFF,www.$DOM=$OFF"
if grep -q '^SITE_HOSTS=' .env; then sed -i "s#^SITE_HOSTS=.*#SITE_HOSTS=$NOVO#" .env; else echo "SITE_HOSTS=$NOVO" >> .env; fi
docker compose up -d
# O Caddy só relê o Caddyfile ao reiniciar: sem isso ele fica com o endereço antigo e não pede o certificado do novo.
docker compose restart caddy
sleep 25
docker compose logs --tail 8 caddy
echo "Pronto. Abra https://$DOM (o HTTPS pode levar 1 a 2 minutos depois que o DNS estiver certo). Escritório deste site: $OFF."
