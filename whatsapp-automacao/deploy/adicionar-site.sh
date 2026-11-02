#!/usr/bin/env bash
# Liga o domínio do SITE PÚBLICO da Migra (separado do painel) nesta VPS.
# Uso (na VPS):  bash /opt/migra/app/whatsapp-automacao/deploy/adicionar-site.sh meusite.com.br
# Antes: no painel do registro do domínio, crie o registro A (nome @ e também www) apontando para o IP desta VPS.
# No endereço do site só aparecem as páginas públicas: o painel e o login continuam só no endereço do sistema.
set -euo pipefail
DOM="${1:-}"
[ -n "$DOM" ] || { echo "Informe o domínio. Ex.: bash adicionar-site.sh meusite.com.br"; exit 1; }
DOM="${DOM#https://}"; DOM="${DOM#http://}"; DOM="${DOM#www.}"; DOM="${DOM%%/*}"
cd /opt/migra/app/whatsapp-automacao
if ! grep -q "reverse_proxy zapauto:3000" Caddyfile; then echo "Caddyfile inesperado. Rode antes o trocar-dominio.sh."; exit 1; fi
if ! grep -q "^$DOM, www.$DOM {" Caddyfile; then
  printf '\n%s, www.%s {\n\treverse_proxy zapauto:3000\n}\n' "$DOM" "$DOM" >> Caddyfile
fi
HOSTS="$DOM,www.$DOM"
if grep -q '^SITE_HOSTS=' .env; then sed -i "s#^SITE_HOSTS=.*#SITE_HOSTS=$HOSTS#" .env; else echo "SITE_HOSTS=$HOSTS" >> .env; fi
docker compose up -d
sleep 3
docker compose logs --tail 8 caddy
echo "Pronto. Abra https://$DOM (o HTTPS pode levar 1 a 2 minutos depois que o DNS estiver certo)."
