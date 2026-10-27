# ZapAuto: seu WhatsApp atendendo sozinho 🤖💬

Ferramenta completa de automação de WhatsApp com **agente de IA**. Ele conversa com o cliente, **lembra da conversa**, **responde sobre o seu negócio** e **age**: consulta a agenda, marca, lista e cancela horários, e chama um humano quando precisa.

Também traz o que costuma faltar num robô de atendimento: envio em massa, respostas por palavra-chave, mensagens agendadas, gestão de contatos e um painel web para controlar tudo.

```
WhatsApp ──▶ Servidor ──▶ IA (Gemini/OpenRouter) ──▶ Ferramentas (Agenda / Cal.com)
                │              ▲
                └── Memória ───┘   + Base do negócio
```

## O que vem pronto

| Recurso | O que faz |
|---|---|
| 🧠 **Agente de IA** | Atende 24h com qualquer modelo do OpenRouter (Claude, GPT, Gemini…), usando só as informações do seu negócio |
| 🧩 **Memória** | Guarda o histórico de cada cliente e envia junto com cada mensagem nova |
| 📅 **Agenda** | Agenda interna ou **Cal.com**. O agente mostra os horários livres e marca sozinho |
| 🙋 **Transferência para humano** | O agente pausa e avisa a equipe. Você responde pelo painel e depois devolve ao robô |
| 🧪 **Testar até quebrar** | Simulador de conversa e bateria de mensagens estranhas ("kkkkk", "me dá 100% de desconto"…) |
| 📱 **Duas conexões** | **API oficial da Meta** (webhook, como no vídeo) ou **QR Code** (WhatsApp Web, sem burocracia) |
| 🚀 **Envio em massa** | Campanhas com variáveis (`{nome}`), variações de texto, anexos, intervalos aleatórios e pausas de segurança |
| 🤖 **Respostas por palavra-chave** | Menus (1, 2, 3), respostas rápidas, etiquetas automáticas e horário de atendimento |
| ⏰ **Mensagens agendadas** | Uma vez, diárias, semanais ou mensais |
| 👥 **Contatos** | Importação por CSV, etiquetas, importação de grupos, exportação e descadastro (LGPD) |
| 📈 **CRM de vendas** | Prospectos em funil (quadro e lista), histórico de cada cliente, retornos agendados ("me chama em novembro", "daqui 2 anos"), motivos de perda, vendedores com login próprio e painel do dono com consultor de IA |

## Não entende nada de programação? Comece por aqui

Existe um **guia ilustrado, passo a passo**: https://claude.ai/artifact/UQbmf53avveh2wuAB976v4

Resumo: instale o [Node.js](https://nodejs.org/pt-br/download), baixe e extraia este projeto e clique duas vezes em **`INICIAR-WINDOWS.bat`** (Windows) ou **`INICIAR-MAC.command`** (Mac). O painel abre sozinho no navegador.

## Começando (5 minutos)

Precisa do **Node.js 22.9+**.

```bash
cd whatsapp-automacao
npm install
cp .env.example .env    # opcional: as chaves também podem ser coladas no painel
npm start
```

Abra **http://localhost:3000**.

---

## O passo a passo do vídeo, dentro da ferramenta

### Passo 1: Planeje o agente
Antes de configurar, responda: **o que o negócio faz**, **quem são os clientes**, **o que eles precisam resolver** e **que ações o agente pode tomar**. O exemplo que já vem preenchido é a *Clínica Sorriso* (clínica odontológica, pacientes no WhatsApp, dúvidas e agendamentos; ações: ver agenda e marcar horário).

### Passo 2: Conecte o WhatsApp
Na aba **Conexão**, escolha o modo:

**A) API oficial da Meta (recomendado para o agente)**
1. Acesse [developers.facebook.com](https://developers.facebook.com) → **Criar app** → tipo *Empresa* → adicione o produto **WhatsApp**.
2. Em *WhatsApp → Configuração da API*, copie o **Token de acesso** e o **ID do número de telefone**. Para produção, gere um **token permanente** (Configurações do negócio → Usuários do sistema).
3. Cole no painel, invente um **Token de verificação** e salve.
4. Em *WhatsApp → Configuração → Webhook*, cole a **URL do webhook** que o painel mostra (`https://seu-dominio/webhook`) e o mesmo token de verificação. Assine o campo **messages**.
5. Opcional, mas recomendado: cole o **App Secret** (Configurações do app → Básico) para validar a assinatura de cada mensagem.

> A Meta só chama URLs **HTTPS públicas**. Na VPS (passo 8) isso já fica pronto. Para testar no seu computador, use um túnel: `cloudflared tunnel --url http://localhost:3000` ou `ngrok http 3000`.

**B) QR Code (WhatsApp Web)**: escaneie com o celular em *Aparelhos conectados*. É mais rápido e permite grupos e envio em massa, mas é uma conexão **não oficial**. Use com moderação para não ter o número bloqueado.

### Passo 3: Conecte a IA (Google Gemini grátis ou OpenRouter)
Na aba **Agente IA**, em **Qual IA usar**:
- **Google Gemini (padrão, tem plano gratuito):** crie a chave em [aistudio.google.com/apikey](https://aistudio.google.com/apikey) com uma conta Google, sem cartão. O plano gratuito tem limite de mensagens por minuto e por dia, e o Google pode usar as conversas para melhorar os produtos dele. Para atender clientes de verdade, avalie ativar o faturamento (com ele, os dados não são usados).
- **OpenRouter (pago):** uma chave dá acesso a qualquer modelo (Claude, GPT…). Crie em [openrouter.ai/keys](https://openrouter.ai/keys) e adicione créditos.

### Passo 4: Memória
Já funciona sozinha. Cada mensagem vai para a IA junto com as últimas mensagens da conversa (o padrão é 20, ajustável). Veja e gerencie tudo na aba **Conversas**.

### Passo 5: Base do negócio
Preencha na aba **Agente IA**: serviços, preços, horários, endereço, perguntas frequentes, políticas e regras de agendamento. **O agente só responde com o que está aqui.** Ele não inventa preços nem dá descontos fora das políticas. Use **"Ver prompt completo"** para conferir o que a IA recebe.

### Passo 6: Ferramentas (o agente age)
Na aba **Agenda**, defina os horários de atendimento por dia e a duração de cada horário. Pronto: o agente passa a consultar os horários livres e a marcar sozinho. Para usar o **Cal.com**, troque o provedor e informe a chave da API (Configurações → Desenvolvedor → Chaves de API), o ID do tipo de evento e um e-mail padrão (o Cal.com exige e-mail do participante).

Ferramentas disponíveis para a IA:
- `consultar_horarios_disponiveis`: horários livres numa data
- `agendar_horario`: marca para o cliente da conversa
- `listar_meus_agendamentos` / `cancelar_agendamento`: o cliente só vê e cancela os próprios agendamentos
- `transferir_para_humano`: pausa o robô e avisa a equipe

### Passo 7: Teste até quebrar
Na aba **Testar agente**:
- **Simulador**: converse como se fosse um cliente. Em *modo teste*, nada é gravado na agenda.
- **Testa até quebrar**: roda as mensagens estranhas ("kkkkkkk", "??????", "quero marcar ontem", "me dá 100% de desconto", "vcs abrem domingo 3h da manhã?", emojis…). Leia as respostas, ajuste a base e as instruções, e rode de novo até todas ficarem boas.

Depois, marque **"Agente ligado"** e salve.

### Teste pelo WhatsApp de verdade, antes de liberar para os clientes

O agente vem em **modo de teste**: ele só responde os números que você cadastrar. Os clientes que mandarem mensagem não recebem nada dele. Passo a passo:

1. Rode no seu computador: `npm install` e depois `npm start`. Abra http://localhost:3000.
2. **Conexão** → **QR Code** → escaneie com o celular do número que vai atender (WhatsApp → *Aparelhos conectados* → *Conectar aparelho*). O número continua funcionando normalmente no celular.
3. **Agente IA**:
   - cole a chave do OpenRouter;
   - em **Quem o agente atende**, deixe **Modo de teste** e escreva o **seu** número pessoal (precisa ser *outro* celular, não o conectado);
   - marque **Agente ligado** e salve.
4. Do seu celular pessoal, mande mensagens para o número conectado, como se fosse um cliente. As respostas chegam no seu WhatsApp, e a conversa aparece na aba **Conversas**.
5. Se uma resposta não ficar boa, ajuste a base (aba **Agente IA**), salve e teste de novo. Para o agente esquecer a conversa e começar do zero, use 🗑️ na aba **Conversas**.
6. Quando tudo estiver certo, mude para **No ar: todos os clientes**.

> ⚠️ Se o número também usa o **Meta Business Agent** (a IA nativa do WhatsApp Business), desative-o durante o teste, senão os dois agentes vão responder.
> Se nada for respondido, olhe o **Histórico**: a mensagem "Modo de teste: o agente não respondeu…" mostra o número exatamente como o WhatsApp o identificou.

### Perfil pronto: Migra Paraguai

A base de conhecimento do documento *Migra Paraguai · Meta Business Agent (v1.0)* já vem carregada como perfil padrão. Para trocar de perfil: **Agente IA → Perfil do negócio**. O perfil inclui:
- serviços e pacotes, etapas do processo e documentos (orientação preliminar);
- triagem com uma pergunta por vez;
- perguntas frequentes e exemplos de tom;
- limites e quando transferir para a equipe.

Seguindo o documento:
- **preços, agendamentos, pagamentos, casos jurídicos, menores de idade e investimentos são transferidos para a equipe**, por isso a agenda do agente vem desligada;
- endereço, horários e CNPJ não são informados (ainda não foram confirmados pela direção);
- as "notas para aprovação interna" e os preços de referência **não** entram na base;
- o agente nunca pede foto de documento, CPF nem dados bancários.

Em **WhatsApp da equipe para avisos**, coloque o número do Marcos ou da equipe. Cada transferência envia um resumo para lá.

O próprio documento pede **revisão final da direção da Migra antes do uso em atendimento automático**. Use o modo de teste para essa revisão.

### Passo 8: Coloque no ar (VPS)
Seu notebook não é servidor: o agente precisa ficar online 24h. Numa VPS Linux (Hetzner, Contabo, DigitalOcean, Hostinger, Oracle Free…):

```bash
# 1. Instale o Docker
curl -fsSL https://get.docker.com | sh

# 2. Baixe o projeto
git clone https://github.com/MandersonGenelhud/Projeto-Cidades-da-Sorte.git
cd Projeto-Cidades-da-Sorte/whatsapp-automacao

# 3. Configure
cp .env.example .env
nano .env            # defina PANEL_PASSWORD (obrigatório) e as chaves
nano Caddyfile       # troque SEU_DOMINIO pelo seu domínio (DNS apontando para a VPS)

# 4. Suba
docker compose up -d
```

O Caddy gera o HTTPS automaticamente. O painel fica em `https://seu-dominio` (protegido por senha) e o webhook em `https://seu-dominio/webhook`.

**Sem Docker (PM2):**
```bash
npm ci --omit=dev
npm i -g pm2
pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
```
Nesse caso, coloque um proxy com HTTPS (Caddy ou Nginx + Certbot) na frente da porta 3000.

---

## CRM de vendas (dono e vendedores)

No **primeiro acesso** o painel pede para criar o **administrador** (o dono). Depois, em **Equipe**, ele cadastra cada vendedor com login, senha e WhatsApp.

- **Prospectos**: cada cliente que manda mensagem vira um prospecto (automático). Arraste entre as colunas *Novo → Em contato → Proposta enviada → Retomar depois → Fechado / Perdido*. Ao marcar *Perdido*, o vendedor informa o motivo; ao marcar *Retomar depois*, escolhe a data (botões +1 mês, +6 meses, +1 ano, +2 anos) e o porquê.
- **Retornos**: no dia marcado, o responsável recebe um aviso no WhatsApp e o cliente aparece em *Hoje* (os atrasados ficam em destaque).
- **IA preenchendo o CRM**: depois das respostas, a IA lê a conversa e completa nome, cidade, pacote, nº de pessoas, valor e data de retorno — sem apagar o que a equipe escreveu.
- **Vendedor saiu?** Em *Equipe → Passar carteira*, todos os prospectos em aberto dele vão para outra pessoa, com o histórico.
- **Vendas** (só o dono): vendas do mês, conversão, valor em negociação, desempenho por vendedor, motivos de perda e de espera, e o **Consultor de vendas (IA)**, que sugere o que fazer na semana.
- Vendedores só veem os próprios prospectos e os que estão sem responsável; as configurações do robô ficam só com o administrador.

Para a equipe acessar de outros computadores/celulares, o sistema precisa estar na VPS (endereço com HTTPS).

## Instagram Direct

O mesmo agente, com o mesmo conhecimento e a mesma memória, também responde o **Direct do Instagram**, ao mesmo tempo que o WhatsApp. Usa a API oficial da Meta (gratuita) e precisa de:
- perfil do Instagram **profissional** (comercial ou criador);
- um app em developers.facebook.com com o caso de uso *Gerenciar mensagens e conteúdo no Instagram* (acesso padrão, sem revisão da Meta, já que é a sua própria conta);
- URL pública com HTTPS para o webhook (`https://seu-dominio/webhook/instagram`), ou seja, a VPS.

Configure em **Conexão → Instagram Direct**. Regras do Instagram: só é possível responder até 24 horas depois da última mensagem do cliente, cada mensagem tem no máximo 1.000 bytes (o sistema divide as longas) e o agente envia só texto. Para testar, coloque `@seu.usuario` nos números de teste.

> Não use ferramentas que entram no Instagram com usuário e senha (não oficiais): o Instagram bloqueia contas que fazem isso.

## Mudar do computador para a VPS

Tudo o que o sistema guarda (configurações, conhecimento, conversas, conexão do WhatsApp) fica na pasta `data/`.
1. Feche o programa no computador.
2. Copie a pasta `data/` para a VPS, no mesmo lugar (`whatsapp-automacao/data`). Com Docker, copie para o volume: `docker compose cp ./data/. zapauto:/app/data` e reinicie.
3. Ligue na VPS. O WhatsApp continua conectado. Se pedir QR Code de novo, conecte por código.

Nunca deixe o computador e a VPS ligados ao mesmo tempo com o mesmo número: os dois responderiam o cliente.

## Como o agente decide o que responder

1. **SAIR / PARAR** → descadastra (LGPD). **VOLTAR** → recadastra. Isso sempre funciona, com ou sem IA.
2. **Respostas por palavra-chave** (se *"têm prioridade"* estiver marcado), ex.: "pix" → chave PIX.
3. **Agente de IA**, com memória, base do negócio e ferramentas.
4. Conversa transferida para humano → o robô fica em silêncio até você clicar em *"Devolver para o robô"*.

Mensagens enviadas em sequência (enquanto a IA pensa) são respondidas juntas, como uma pessoa faria.

## Envio em massa e boas práticas

- Use variáveis (`{nome}`, `{primeiro_nome}`, `{cidade}`) e variações de texto (`{Olá|Oi|E aí}`), além de várias versões da mensagem.
- Mantenha intervalos de 8 a 20 s ou mais e pausas a cada 30 mensagens.
- Envie só para quem pediu para receber (opt-in). Quem responde **SAIR** nunca mais recebe.
- **Na API oficial da Meta**, mensagens livres só podem ser enviadas até 24h depois da última mensagem do cliente. Para iniciar conversas em massa pela API oficial é preciso usar *templates aprovados* pela Meta. Por isso o envio em massa funciona melhor no modo QR Code.

## Variáveis de ambiente

| Variável | Para que serve |
|---|---|
| `PORT`, `HOST` | Porta e interface do painel (`0.0.0.0` na VPS) |
| `PANEL_USER`, `PANEL_PASSWORD` | Login do painel (**obrigatório** em produção fora do localhost) |
| `TZ` | Fuso do negócio (padrão `America/Sao_Paulo`) |
| `GEMINI_API_KEY` | Chave do Google Gemini (gratuito) |
| `OPENROUTER_API_KEY` | Chave do OpenRouter (pago) |
| `WA_CLOUD_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_VERIFY_TOKEN`, `WA_APP_SECRET` | API oficial da Meta |
| `IG_ACCESS_TOKEN`, `IG_VERIFY_TOKEN`, `IG_APP_SECRET` | Instagram Direct (API oficial) |
| `DATA_DIR` | Onde ficam os dados (padrão `./data`) |

As variáveis de ambiente têm prioridade sobre o que foi salvo no painel. Os segredos nunca voltam completos para o navegador.

## Estrutura

```
src/
  server.js              API REST, painel, webhook da Meta
  connection.js          Alterna entre QR Code e API oficial
  transports/
    whatsapp-web.js      Conexão por QR Code (Baileys)
    cloudapi.js          API oficial da Meta (Graph API + webhook)
  agent/
    agent.js             Agente: memória, ciclo de ferramentas, transferência
    llm.js               Cliente do OpenRouter
    prompt.js            Prompt montado a partir da base do negócio
    tools.js             Ferramentas que a IA pode usar
    calendar.js          Agenda interna e Cal.com
  autoreply.js           Fluxo de mensagens recebidas (descadastro, palavras-chave, IA)
  campaigns.js           Envio em massa
  scheduler.js           Mensagens agendadas
  store.js               Banco de dados em JSON (data/db.json)
public/                  Painel web (HTML/CSS/JS puro)
test/                    Testes automatizados (npm test)
```

## Testes

```bash
npm test
```

Cobrem: agenda (horários, antecedência, datas inválidas), ciclo de ferramentas do agente, memória, transferência para humano, agrupamento de mensagens, simulação sem gravar, webhook da Meta (verificação, assinatura, duplicatas, envio), campanhas, agendamentos, regras e utilitários.

## Aviso

Esta ferramenta não tem vínculo com o WhatsApp nem com a Meta. Respeite os [Termos](https://www.whatsapp.com/legal/business-policy) e a LGPD: envie mensagens apenas para quem autorizou e ofereça sempre uma forma de sair da lista.
