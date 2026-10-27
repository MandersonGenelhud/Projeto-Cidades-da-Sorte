#!/bin/bash
# ZapAuto: clique duas vezes para iniciar (no Mac).
cd "$(dirname "$0")"
clear
echo ""
echo "  =========================================="
echo "    ZapAuto - Agente de WhatsApp"
echo "  =========================================="
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "  [!] O Node.js ainda não está instalado neste computador."
  echo "      Vou abrir o site para você baixar. Instale e depois"
  echo "      clique duas vezes neste arquivo de novo."
  open "https://nodejs.org/pt-br/download"
  read -r -p "  Pressione Enter para fechar..."
  exit 1
fi

if [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  echo "  [!] Seu Node.js é antigo. Instale a versão LTS mais nova."
  open "https://nodejs.org/pt-br/download"
  read -r -p "  Pressione Enter para fechar..."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "  Instalando os componentes. Só acontece na primeira vez"
  echo "  e pode levar alguns minutos..."
  echo ""
  if ! npm install --omit=dev; then
    echo ""
    echo "  [!] A instalação falhou. Verifique a internet e tente de novo."
    read -r -p "  Pressione Enter para fechar..."
    exit 1
  fi
fi

echo ""
echo "  Tudo pronto! O painel vai abrir no navegador."
echo "  NÃO FECHE esta janela enquanto estiver usando o agente."
echo "  Para desligar, feche esta janela."
echo ""
export OPEN_BROWSER=1
while true; do
  node src/server.js
  # Código 3 = o painel acabou de se atualizar: abre de novo sozinho.
  if [ $? -ne 3 ]; then break; fi
  unset OPEN_BROWSER
  echo ""
  echo "  Atualizado! Reabrindo o agente..."
done
