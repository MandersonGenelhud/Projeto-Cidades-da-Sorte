#!/usr/bin/env bash
# Auditoria de segurança da VPS: SÓ LÊ e mostra (não muda nada, não pede nem mostra senhas ou chaves).
# Uso (na VPS):  bash /opt/migra/app/whatsapp-automacao/deploy/auditar-vps.sh
APP=/opt/migra/app/whatsapp-automacao
ok() { echo "  [OK]      $*"; }
warn() { echo "  [ATENÇÃO] $*"; }
echo "== 1. Firewall (só 22, 80 e 443 devem estar abertas)"
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ok "firewall ligado"; ufw status | grep -E "ALLOW" | sed 's/^/            /'; else warn "firewall DESLIGADO. Rode: ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable"; fi
echo "== 2. Entrada por SSH"
SSHD="$(sshd -T 2>/dev/null)"
echo "$SSHD" | grep -q "^passwordauthentication yes" && warn "SSH aceita SENHA (invasores tentam adivinhar). O ideal é só chave." || ok "SSH não aceita senha"
echo "$SSHD" | grep -q "^permitrootlogin yes" && warn "SSH aceita entrar direto como root com senha" || ok "root não entra com senha"
echo "== 3. Bloqueio automático de quem força senha (fail2ban)"
systemctl is-active --quiet fail2ban && ok "fail2ban ligado" || warn "fail2ban desligado: apt-get install -y fail2ban && systemctl enable --now fail2ban"
echo "== 4. Atualizações automáticas do sistema"
systemctl is-enabled --quiet unattended-upgrades 2>/dev/null && ok "ligadas" || warn "desligadas: apt-get install -y unattended-upgrades"
[ -f /var/run/reboot-required ] && warn "o servidor pede reinício para concluir atualizações de segurança (faça num horário calmo: reboot)"
echo "== 5. Portas abertas para a internet (esperado: 22, 80, 443)"
ss -tlnH 2>/dev/null | awk '{print $4}' | grep -vE '^(127\.|\[::1\]|::1)' | sed 's/^/            /'
echo "== 6. Contêineres e portas publicadas"
docker ps --format '            {{.Names}}  {{.Ports}}' 2>/dev/null
docker ps --format '{{.Ports}}' 2>/dev/null | grep -E '0\.0\.0\.0:(3000|9000)->' >/dev/null && warn "porta interna do sistema ou da voz exposta para a internet" || ok "só o Caddy (80/443) está publicado"
echo "== 7. Arquivos secretos"
[ -f "$APP/.env" ] && { P="$(stat -c %a "$APP/.env")"; [ "$P" = "600" ] && ok ".env só o dono lê" || warn ".env com permissão $P (deveria ser 600): chmod 600 $APP/.env"; }
echo "== 8. Cópias de segurança"
LAST="$(ls -1t /opt/migra/backups/migra-data-*.tgz 2>/dev/null | head -1)"
if [ -n "$LAST" ]; then AGE=$(( ( $(date +%s) - $(stat -c %Y "$LAST") ) / 3600 )); [ "$AGE" -le 26 ] && ok "última cópia há ${AGE}h" || warn "última cópia há ${AGE}h (era pra ser diária)"; else warn "nenhuma cópia em /opt/migra/backups"; fi
warn "as cópias ficam no MESMO servidor: se a VPS for perdida ou invadida, elas vão junto. Ligue os backups/snapshots da Hostinger e baixe uma cópia por semana para o seu computador."
echo "== 9. Disco"
df -h / | tail -1 | awk '{print "            usado: "$5" ("$3" de "$2")"}'
echo; echo "Pronto. Nada foi alterado."
