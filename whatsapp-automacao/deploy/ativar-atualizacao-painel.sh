#!/usr/bin/env bash
# Ativa o botão "Atualizar agora" do painel na VPS (rode uma vez; o atualizar-vps.sh também chama este script).
# Como funciona: o painel só cria um arquivo de pedido dentro da pasta de dados. Um vigia da própria VPS, a cada minuto,
# vê o pedido e roda o atualizar-vps.sh. O painel nunca ganha acesso ao Docker nem ao servidor.
set -euo pipefail
APP=/opt/migra/app/whatsapp-automacao
TMP="$(mktemp)"
cat > "$TMP" <<WATCH
#!/usr/bin/env bash
VOL="\$(docker volume ls -q | grep 'zapauto_data\$' | head -1)"
[ -n "\$VOL" ] || exit 0
DIR="\$(docker volume inspect -f '{{ .Mountpoint }}' "\$VOL")"
touch "\$DIR/update-watch-alive" && chown 1000:1000 "\$DIR/update-watch-alive" 2>/dev/null || true
if [ -f "\$DIR/update-requested" ]; then
  rm -f "\$DIR/update-requested"
  echo "\$(date -Is) atualização pedida pelo painel"
  flock -n /var/lock/migra-update.lock bash $APP/deploy/atualizar-vps.sh
fi
WATCH
chmod +x "$TMP"
mv -f "$TMP" /usr/local/bin/migra-update-watch # troca o arquivo de uma vez (ele pode estar rodando agora)
echo '* * * * * root /usr/local/bin/migra-update-watch >> /var/log/migra-update.log 2>&1' > /etc/cron.d/migra-update
chmod 644 /etc/cron.d/migra-update
/usr/local/bin/migra-update-watch || true
echo "Pronto: o botão 'Atualizar agora' do painel agora atualiza esta VPS (em até 1 minuto depois do clique)."
