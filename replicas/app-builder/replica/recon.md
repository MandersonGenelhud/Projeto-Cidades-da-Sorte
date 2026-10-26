# Recon map: Emergent, criador de apps com IA (web)

Escopo: o loop principal do criador de apps. Você descreve um app no chat, o agente
gera o código, você vê o preview ao vivo, ajusta conversando e publica num link.
Ficam de fora do MVP o app mobile (Expo/EAS), os agentes customizados e o MCP.
For: Manderson. Primeiro uso interno, para gerar os sites de sorteio de cada cidade
(Cidades da Sorte). Depois, talvez, um produto próprio.
Date: 2026-10-26

## Regras desta recon

- Fontes: só páginas públicas (central de ajuda, preços, landing, reviews e vídeos públicos).
- Os Termos de Uso do Emergent (app.emergent.sh/terms-of-service, cláusula 2.2 e
  seção 5) proíbem engenharia reversa, decompilação, scraping/bots e usar o serviço
  ou o output para desenvolver um produto concorrente. Então:
  - não usamos REA nem nenhuma outra ferramenta no código, nos bundles JS ou na rede do Emergent;
  - não usamos a conta do Manderson no Emergent para estudar o produto e construir o clone;
  - todo o código é escrito do zero (clean room), com nome, marca e textos próprios.
- A skill REA continua instalada para outros usos legítimos, por exemplo binários e
  apps que são seus ou de código aberto.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | help center: começar | https://help.emergent.sh/start-with-your-idea | tipos de app, Build/Plan, Job, Preview, Publish, créditos |
| 2 | help center: tour do workspace | https://help.emergent.sh/a-tour-of-the-workspace | 5 áreas: chat, preview, secrets, GitHub, publish; anexos |
| 3 | help center: glossário | https://help.emergent.sh/glossary-of-emergent-terms | ECU, Re-publish vs Replace, Universal LLM Key, Maxx, Mongo, object store |
| 4 | help center: conversar antes | https://help.emergent.sh/talk-it-through | modo Plan/discussão é mais barato que construir |
| 5 | help center: o que é um Job | https://help.emergent.sh/what-is-a-job | Job = 1 app; sidebar; fork; Projects agrupam jobs |
| 6 | help center: publicar | https://help.emergent.sh/put-your-app-live | Publish / Re-publish / Replace, tirar do ar, domínio |
| 7 | help center: tipos de app | https://help.emergent.sh/what-kind-of-apps-you-can-build | web, mobile, landing, integrações |
| 8 | pricing | https://emergent.sh/pricing | Free 10 créditos, Standard US$20, Pro US$200 |
| 9 | landing | https://emergent.sh | "Describe your idea", login Google/Apple/Email/Phone/SSO |
| 10 | termos | https://app.emergent.sh/terms-of-service | restrições acima |
| 11 | review Geekflare | https://geekflare.com/guides/emergent-ai-review/ | fluxo real, Universal LLM Key, GitHub |
| 12 | Reddit r/vibecoding | https://www.reddit.com/r/vibecoding/comments/1mpxsea/ | queixa: caro e instável, créditos gastos mesmo quando falha |

## Core loop

Digitar uma ideia → o agente constrói um app full-stack funcionando → ver e testar
no preview ao vivo → pedir mudanças no chat → publicar num link permanente.

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Landing / login | `/` deslogado | prompt "descreva sua ideia" + login | composer grande, botões OAuth (Google, Apple, Email, Phone, SSO) | vazio |
| S02 | Home | `/` logado | começar um job novo | seletor de tipo (Full Stack, Mobile, Landing, Brainstorm), composer, chave Build/Plan, anexos, lista de jobs recentes | vazio, com jobs |
| S03 | Workspace do job | `/job/:id` | construir e iterar | painel de chat + painel de preview lado a lado | gerando, pronto, erro, sem créditos (pausado) |
| S04 | Painel de chat | dentro de S03 | conversar com o agente | mensagens, passos/ferramentas do agente, anexos, composer, chave Build/Plan/Maxx | streaming, ocioso, erro |
| S05 | Painel de preview | dentro de S03 | app ao vivo num iframe | iframe, recarregar, abrir em nova aba, URL do preview | carregando, rodando, dormindo (30 min), erro |
| S06 | Código / arquivos | aba dentro de S03 | ver os arquivos gerados | árvore de arquivos, visualizador de código, terminal | vazio, com arquivos |
| S07 | Secrets / Env | Preview → Manage → Secrets | chaves de API do app | lista de chaves, editar valor (sem adicionar ou apagar pela UI) | vazio, com chaves |
| S08 | Database manager | Preview → Manage → Database | ver e editar dados do app | coleções, tabela de documentos, editar | vazio, com dados |
| S09 | Painel de publicação | botão Publish em S03 | colocar no ar | Publish / Re-publish / Replace, escolha de plano, URL, domínio próprio, tirar do ar | não publicado, publicando, no ar, falhou |
| S10 | Domínio próprio | dentro de S09 | apontar domínio | instruções de DNS (A/CNAME), status de verificação | pendente, verificado, erro |
| S11 | GitHub | controles em S03 | salvar o código num repositório | conectar, escolher repo, commit | desconectado, salvando, salvo |
| S12 | Sidebar de jobs / Projects | lateral de S02/S03 | navegar entre jobs | lista, renomear, arquivar, apagar, fork, agrupar em projeto | vazio, com itens |
| S13 | Créditos e plano | conta → billing | saldo e compra | saldo, uso por job, planos, top-up | com saldo, zerado |
| S14 | Integrações | Preview → Manage → Integrations | conectar Stripe, Resend, Twilio... | catálogo, chaves | — |

## Flows

```
F01 Criar um app a partir de uma ideia
    S02 (tipo + prompt + Build) -> S03 (agente trabalha, preview atualiza) -> S05 testar
    happy path clicks: 2 (escolher tipo, enviar)
    edge: prompt vago, créditos acabam no meio, erro de build, preview não sobe

F02 Planejar antes de construir
    S02 (modo Plan) -> S04 (agente propõe plano) -> aprovar -> F01
    happy path clicks: 3
    edge: o agente começa a codar cedo demais e o usuário pede para voltar a discutir

F03 Iterar no app
    S04 (pedir mudança, com anexo opcional) -> agente edita -> S05 atualiza
    happy path clicks: 1
    edge: a mudança quebra o app, o usuário quer desfazer (rollback)

F04 Publicar
    S03 -> S09 Publish -> URL permanente -> (S10 domínio)
    happy path clicks: 2
    edge: falha de build na publicação, variáveis de ambiente diferentes entre preview e produção

F05 Re-publicar uma atualização
    S04 mudanças -> S09 Re-publish
    happy path clicks: 2

F06 Configurar segredos
    S07 -> editar valor -> agente usa a chave pelo nome
    edge: o usuário cola a chave no chat (o produto avisa para não fazer isso)

F07 Salvar no GitHub
    S11 -> conectar -> commit

F08 Fork de um job
    S12 -> fork -> novo job independente com o mesmo estado
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Composer | grande (home), compacto (chat) | vazio, digitando, enviando, desabilitado (sem créditos) | S01, S02, S04 |
| Chave de modo | Build / Plan (/ Maxx) | ativo, inativo | S02, S04 |
| Seletor de tipo de app | 4 cartões/abas | selecionado | S02 |
| Mensagem do chat | usuário, agente, passo de ferramenta, erro | streaming, concluída | S04 |
| Iframe de preview | desktop, mobile | carregando, rodando, dormindo, erro | S05 |
| Árvore de arquivos | — | recolhida, expandida, arquivo ativo | S06 |
| Visualizador de código | somente leitura | — | S06 |
| Item da lista de jobs | — | ativo, hover, menu aberto | S02, S12 |
| Modal | publicar, confirmar exclusão | aberto, enviando | S09, S12 |
| Badge de status | gerando, pronto, publicado, erro | — | S03, S09, S12 |
| Toast | sucesso, erro | — | todas |
| Botão | primário, secundário, ghost, perigo | default, hover, focus, disabled, loading | todas |

## Inferred data model

```
User        id, email, name, avatar, auth_provider, plan, credits_balance
            evidence: login S01, pricing, glossário (créditos)
            confidence: high

Project     id, user_id, name
            evidence: "Projects agrupam jobs" (what-is-a-job)
            confidence: medium

Job         id, user_id, project_id?, title, app_type (fullstack|mobile|landing|brainstorm),
            status (idle|working|error|paused), forked_from_job_id?, archived_at, created_at
            evidence: what-is-a-job, start-with-your-idea
            confidence: high

Message     id, job_id, role (user|assistant|tool), content, attachments[], mode (build|plan),
            credits_used, created_at
            evidence: S04, "o chat é persistente"
            confidence: high

FileVersion id, job_id, path, content, message_id (que mudança gerou)
            evidence: S06, GitHub snapshot, rollback
            confidence: medium (pode ser um repositório git por job)

Secret      id, job_id, environment (preview|production), key, value_encrypted
            evidence: S07, "preview e produção separados após o primeiro publish"
            confidence: high

Deployment  id, job_id, url, subdomain, custom_domain?, tier, status, published_at, version
            evidence: S09, glossário (Re-publish vs Replace)
            confidence: high

CreditLedger id, user_id, job_id?, delta, reason, created_at
            evidence: créditos por uso, "sem cobrança de excedente, job pausa em zero"
            confidence: medium
```

Relacionamentos: User 1-n Project, User 1-n Job, Project 1-n Job, Job 1-n Message,
Job 1-n FileVersion, Job 1-n Secret, Job 1-n Deployment, User 1-n CreditLedger.

## Feature matrix

Veja `features.csv`. Must: 12, should: 10, could: 8, skip: 4.

## Out of scope (não pode ou não deve ser clonado)

- A marca, o nome, o logo, a paleta e os textos do Emergent.
- Os modelos e prompts internos do agente: usamos a API do Claude com prompts nossos.
- A "Universal LLM Key" como revenda de tokens: no começo usamos a chave da Anthropic do próprio usuário.
- O build mobile gerenciado (contas Expo/EAS e certificados Apple/Google do Emergent).
- A infraestrutura deles (Mongo gerenciado, Cloudflare Custom Hostnames, object store).
  Usamos serviços gerenciados nossos: Supabase/Postgres, Vercel e afins.

## Size

Telas 14, fluxos 8, entidades 8.
Partes difíceis:
1. Rodar com segurança o código gerado pela IA. Começamos com apps só de frontend
   (HTML/React) rodando num iframe com sandbox no navegador; o backend real fica para
   uma sandbox (Vercel Sandbox/E2B).
2. O loop do agente: tool use que escreve e edita arquivos, com streaming do progresso.
3. Publicação com subdomínio por app e domínio próprio.
4. Medição e cobrança de créditos.

Tamanho: L no total. O MVP (F01, F02, F03, F04 só para sites estáticos/frontend, F06) é M, algumas semanas.
