# Copiar os contratos do sistema antigo (sem tirar print)

**Quem roda:** você ou o Marcos, no computador, com o login de vocês.
**O que a ferramenta faz:** abre o Edge/Chrome, você entra no sistema (digita a senha **no navegador**, nunca aqui nem para mim), abre a lista de contratos e aperta ENTER. Ela passa por todas as páginas e páginas seguintes, lê cada contrato e baixa os PDFs.
**O que ela NÃO faz:** não clica em botões, não envia formulários e ignora links de sair, excluir, cancelar e senha. Só lê.

## Passo a passo
1. Baixe/atualize o projeto no computador e abra a pasta `whatsapp-automacao\tools\capturar-sistema`.
2. Dê dois cliques em **CAPTURAR.bat**.
3. Digite o endereço do sistema do Marcos quando pedir.
4. No navegador que abrir: faça o login e abra a lista de contratos.
5. Volte à janela preta e aperte **ENTER**. Espere terminar (pode levar vários minutos).
6. Vai aparecer a pasta `captura-...`. No painel do Migra Hub: **Contratos antigos → Importar** e escolha o `captura.json`.

## Se faltar alguma coisa
Mande o arquivo `mapa.txt` da mesma pasta. Ele mostra só a estrutura (nomes de colunas e campos), sem nenhum dado de cliente, e com ele eu ajusto o leitor.

## Segurança
- A pasta `captura-...` tem dados de clientes: não suba para o GitHub, não mande por chat. Apague depois de importar.
- Nunca digite a senha do sistema do Marcos em chat comigo ou em arquivos.
