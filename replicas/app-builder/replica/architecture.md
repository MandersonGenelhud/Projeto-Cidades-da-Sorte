# Architecture: criador de apps com IA (refaz as funções principais do Emergent)

Nome provisório: "app-builder". O nome e a marca definitivos saem no `/replica-brand`.

## Stack

| layer | choice | why |
| --- | --- | --- |
| web | Next.js (App Router) + TypeScript | uma base só para o site, as telas e a API |
| styling | Tailwind + tokens do replica-design | rápido, consistente |
| agente | API do Claude (Messages API com tool use, streaming) | escreve e edita os arquivos do app gerado |
| database | Postgres no Supabase | gerenciado, plano grátis, tem login embutido |
| auth | Supabase Auth (email + Google) | não precisamos construir login do zero |
| arquivos | Supabase Storage | anexos do chat |
| preview | iframe com `sandbox` e `srcdoc`, montado no navegador | roda o app gerado isolado, sem servidor, custo zero |
| publish | rota pública `/p/[slug]` servindo os arquivos da versão publicada | um link permanente sem infra extra |
| payments | Stripe Checkout (depois) | créditos e planos; fora do MVP |
| hosting | Vercel | deploy automático a partir do GitHub |

### Sem chave da Anthropic no início

O agente fica atrás de uma interface `AgentProvider` com duas implementações:

- `MockAgent`: não chama IA; devolve um app de exemplo (um site de sorteio) em
  passos, com streaming. Dá para construir e testar todas as telas sem chave e sem custo.
- `ClaudeAgent`: o de verdade. Liga sozinho quando a variável `ANTHROPIC_API_KEY`
  existe no servidor.

A chave nunca vai para o navegador, para o chat nem para o Git. Fica só nas variáveis
de ambiente (`.env.local` no computador, Settings → Environment Variables na Vercel).

## Schema

Tabelas: 7. Regras de acesso: RLS do Postgres (cada usuário só enxerga as próprias linhas).
SQL completo em `schema.sql`.

| tabela | o que guarda |
| --- | --- |
| profiles | dados do usuário e saldo de créditos (1-1 com auth.users) |
| projects | grupos de jobs |
| jobs | um app sendo construído (título, tipo, status) |
| messages | o chat de cada job |
| file_versions | cada versão do código: um snapshot de todos os arquivos, ligado à mensagem que o gerou |
| deployments | versão publicada, slug e domínio |
| credit_ledger | cada consumo ou compra de créditos |

Segredos dos apps gerados (secrets) ficam para depois do MVP. O MVP só gera frontend,
que não deve ter segredo nenhum.

## API

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| GET /api/jobs | lista os jobs | dono | — | jobs[] | F08 |
| POST /api/jobs | cria um job a partir do prompt | logado | prompt, app_type, mode | job | F01 |
| PATCH /api/jobs/:id | renomeia ou arquiva | dono | title?, archived? | job | — |
| DELETE /api/jobs/:id | apaga | dono | — | 204 | — |
| POST /api/jobs/:id/fork | copia o job com a última versão | dono | — | job | F08 |
| GET /api/jobs/:id/messages | histórico do chat | dono | — | messages[] | F03 |
| POST /api/jobs/:id/messages | envia uma mensagem e roda o agente; resposta em streaming (SSE) | dono, com crédito | content, mode, attachments[] | eventos: texto, arquivo escrito, versão pronta, erro | F01 F02 F03 |
| GET /api/jobs/:id/files | arquivos da versão atual ou de `?version=` | dono | — | {path: content} | F03 |
| POST /api/jobs/:id/restore | volta para uma versão anterior | dono | version_id | file_version | F03 |
| POST /api/jobs/:id/publish | publica ou re-publica a versão atual | dono | slug? | deployment | F04 F05 |
| DELETE /api/jobs/:id/publish | tira do ar | dono | — | 204 | F04 |
| GET /p/:slug/[...path] | serve o app publicado | público | — | html/css/js | F04 |
| POST /api/uploads | sobe um anexo | logado | arquivo (≤ 10 MB, imagem/pdf/csv/txt) | url | F03 |

Ferramentas que o agente recebe (tool use): `write_file(path, content)`,
`edit_file(path, old, new)`, `delete_file(path)`, `read_file(path)`, `list_files()`.
Elas atuam numa cópia em memória dos arquivos; no fim da resposta a cópia vira uma nova `file_version`.

Webhooks de entrada: Stripe (depois). Jobs em segundo plano: nenhum no MVP.

## The parts that bite

- **Rodar código gerado por IA:** o preview usa `<iframe sandbox="allow-scripts">`, sem
  `allow-same-origin`, então o app gerado não lê os cookies do builder. O app publicado
  roda num subdomínio separado (`*.apps.<dominio>`) pelo mesmo motivo.
- **Streaming e tempo limite:** uma resposta do agente pode levar minutos. Usamos SSE e
  o runtime Node da Vercel com `maxDuration` alto, e salvamos cada passo, para não perder
  trabalho se a conexão cair.
- **Créditos:** debitar depois de cada chamada, pelo uso real de tokens, numa transação
  que não deixa o saldo ficar negativo. Com saldo zero o job pausa (como no original);
  não existe cobrança surpresa.
- **Idempotência:** mensagem dupla (clique duplo) é barrada por um `client_id` único por mensagem.
- **Corrida:** duas abas no mesmo job: só um agente roda por job de cada vez (status `working` + trava).
- **Tamanho:** limite de arquivos e de bytes por versão, para o agente não gerar algo gigante.
- **LGPD:** apagar a conta apaga jobs, mensagens, arquivos e anexos.

## Build order

1. **Vertical slice (MockAgent, sem chave):** login → home com composer → criar job →
   chat em streaming → arquivos gerados → preview no iframe. Telas S01, S02, S03, S04, S05.
   Tabelas: profiles, jobs, messages, file_versions.
2. **Must-haves:** sidebar de jobs (S12), modo Plan, anexos, publicar e re-publicar
   (S09, `/p/:slug`), trocar MockAgent por ClaudeAgent quando houver chave.
3. **Should-haves:** visualizador de código (S06), voltar versão, fork, créditos, domínio
   próprio, GitHub, Supabase para os apps gerados.
4. **Diferencial Cidades da Sorte:** template "site de sorteio por cidade" na home.
5. **Fixes do replica-entrepreneur:** depois que ele rodar. A queixa pública já conhecida é
   "créditos gastos mesmo quando o resultado falha"; uma ideia é não cobrar respostas que terminam em erro.
