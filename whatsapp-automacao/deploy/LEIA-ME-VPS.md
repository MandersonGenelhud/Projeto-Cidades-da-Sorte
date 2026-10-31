# Colocar o Migra Hub na VPS (Ubuntu 24.04)

Você faz cada passo na sua conta. Senhas e tokens nunca vão para o chat nem para o Git.

## 1. Apontar o endereço para a VPS
No painel de DNS do domínio (migraparaguai.tech), crie um registro **A**:
- Nome: `app`
- Aponta para: o **IP da VPS** (aparece no painel da Hostinger)

## 2. Entrar na VPS
No Windows, abra o **PowerShell** e rode (troque pelo IP):
```
ssh root@IP_DA_VPS
```
A senha de root é a que você criou na Hostinger. Digite só nessa tela.

## 3. Instalar
Na VPS, rode (uma linha por vez):
```
curl -fsSL -o instalar-vps.sh https://raw.githubusercontent.com/MandersonGenelhud/Projeto-Cidades-da-Sorte/claude/whatsapp-automation-tool-247je5/whatsapp-automacao/deploy/instalar-vps.sh
bash instalar-vps.sh app.migraparaguai.tech
```
Se o repositório for privado e o `curl` não baixar, copie o conteúdo do arquivo `deploy/instalar-vps.sh` e cole num arquivo criado com `nano instalar-vps.sh`.

O script mostra uma **chave pública**: copie e cadastre em GitHub → repositório → Settings → **Deploy keys** → Add deploy key (sem marcar "Allow write access"). Depois aperte ENTER.

## 4. Trazer os dados do computador (contratos, vendas, WhatsApp)
1. **Feche o Migra Hub no computador** (a janela preta).
2. No PowerShell do computador, na pasta do sistema:
   ```
   scp -r data root@IP_DA_VPS:/root/migra-data
   ```
3. Na VPS:
   ```
   cd /opt/migra/app/whatsapp-automacao
   bash deploy/migrar-dados.sh /root/migra-data
   ```
4. Abra `https://app.migraparaguai.tech`, entre com o seu login e confira os contratos e as vendas.

Depois de confirmar tudo, apague a cópia: `rm -rf /root/migra-data`. Ela contém as chaves do sistema.

## 5. Instagram
Com o endereço fixo, siga o passo a passo do Instagram. O webhook é:
`https://app.migraparaguai.tech/webhook/instagram`

## Depois de tudo funcionando
- Ative os **snapshots** da VPS no painel da Hostinger (grátis) e tire um antes de mudanças grandes.
- Configure a cópia extra dos backups em **Configurações → Segurança**.
- Entre na VPS só com chave SSH e desligue o login por senha (peça o passo a passo).
