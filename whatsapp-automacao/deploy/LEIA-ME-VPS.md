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

## Atualizar e cópias de segurança
- **Atualizar** (na VPS): `bash /opt/migra/app/whatsapp-automacao/deploy/atualizar-vps.sh`. Ele guarda uma cópia dos dados, baixa a versão nova e religa. O botão "Atualizar agora" do painel fica desligado na VPS.
- **Cópia diária** automática dos dados em `/opt/migra/backups` (últimos 14 dias). Esses arquivos têm segredos: não envie para ninguém. Para uma cópia fora da VPS, use Configurações → Segurança.

## Depois de tudo funcionando
- Ative os **snapshots** da VPS no painel da Hostinger (grátis) e tire um antes de mudanças grandes.
- Configure a cópia extra dos backups em **Configurações → Segurança**.
- Entre na VPS só com chave SSH e desligue o login por senha (peça o passo a passo).

## Voz da Nina e das atendentes
Se o provedor da IA for o **Google Gemini**, a Nina já ouve e responde com a voz animada do Gemini, sem instalar nada. O serviço `voz` abaixo é o **plano B local**: ouve com o faster-whisper e fala com o Kokoro, sem enviar áudio para fora; ele entra sozinho se o Gemini falhar.

## Voz local da Nina (opcional, na VPS)
A Nina entende **áudios** e responde **falando**, com dois programas livres que rodam na própria VPS (nenhum áudio sai dela):
- **faster-whisper** (SYSTRAN, licença MIT): transforma o áudio em texto. Modelo `small`, só processador.
- **kokoro-onnx** (licença MIT; modelo Apache 2.0): voz em português do Brasil (Dora, Alex ou Santa).

Eles ficam no serviço `voz` do `docker-compose.yml`. Na primeira vez que a Nina receber um áudio, o serviço baixa os modelos (uns 1 GB) e guarda no volume `voz_models`; a primeira resposta por voz demora mais. Para conferir:
```
cd /opt/migra/app/whatsapp-automacao
docker compose up -d --build voz
docker compose logs --tail 20 voz
docker compose exec zapauto wget -qO- http://voz:9000/health
```
Se a VPS tiver pouca memória, troque `WHISPER_MODEL: small` por `base` no `docker-compose.yml`.

## Número só da Nina (opcional)
Hoje o Marcos fala com a Nina pelo número principal da Migra, começando a frase com "Nina". Para ter um número só dela:
1. Consiga um **chip de verdade ou eSIM com SMS** (o WhatsApp recusa a maioria dos números virtuais/VoIP e eSIMs só de dados; landline só no WhatsApp Business, por ligação).
2. Instale o **WhatsApp Business** em um celular com esse número.
3. No Migra Hub, em **Conexões WhatsApp**, crie um número da equipe com o nome "Nina" e leia o QR Code (é um aparelho conectado, como o WhatsApp Web).
4. No **Caixa → ⚙️ → Nina**, escolha esse número em "Número só da Nina". Dali em diante o Marcos não precisa dizer "Nina".
O número oficial pela API da Meta também serve, mas hoje o sistema usa a API oficial para o número principal inteiro; misturar exige uma mudança maior.
