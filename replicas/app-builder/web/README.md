# app-builder (web)

O criador de apps: você descreve um app em português, o agente monta, e o preview mostra ao vivo.
Planejamento em `../replica/` (recon, arquitetura, design, build log).

## Rodar no computador

Precisa do Node.js 22 ou mais novo.

```bash
npm install
npm run dev
```

Abra http://localhost:3000. Sem nenhuma configuração, o app usa:

- um usuário local (o login com Supabase vem depois);
- os dados num arquivo `.data/db.json` (fica fora do Git);
- o **agente de demonstração**, que monta um site de sorteio por cidade e troca a cor principal.
  Não chama nenhuma IA e não custa nada.

Variáveis opcionais (em `.env.local`, que nunca vai para o Git):

| variável | para que serve |
| --- | --- |
| `DATA_FILE` | outro caminho para o arquivo de dados |
| `MOCK_AGENT_DELAY_MS` | velocidade do agente de demonstração (padrão 300) |

## Verificar

```bash
npm run check      # TypeScript, ESLint e testes de unidade
npm run build      # build de produção
npm run test:e2e   # testes no navegador (precisa do build)
```

## Onde está cada coisa

| pasta | o que tem |
| --- | --- |
| `src/app` | páginas (`/`, `/job/[id]`) e rotas da API (`/api/jobs/...`) |
| `src/components` | interface: sidebar, home, workspace, botões |
| `src/lib/store` | camada de dados (`DataStore`; hoje `FileStore`) |
| `src/lib/agent` | o agente: interface, `runAgent`, `MockAgent` e o modelo do site de sorteio |
| `src/lib/preview.ts` | junta os arquivos gerados numa página para o preview |
| `e2e` | testes Playwright |
