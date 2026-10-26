# Build log

| data | tela/fatia | status | o que falta | o que foi mais difícil que o esperado |
| --- | --- | --- | --- | --- |
| 2026-10-26 | Vertical slice: S02 home, S03 workspace, S04 chat, S05 preview, S06 código, S12 sidebar | done | login real (S01), anexos, publicar (S09), agente Claude | Next 16 com Cache Components: leitura de URL e params só dentro de `<Suspense>`; telas ficam montadas escondidas ao navegar (a home precisou limpar o formulário) |

## Vertical slice (2026-10-26)

Funciona de ponta a ponta sem nenhuma conta externa:

1. Home: escolher o tipo de app, escrever a ideia, Construir ou Planejar.
2. Cria o job e abre o workspace.
3. O agente (MockAgent) responde em streaming. Cada arquivo escrito aparece no chat.
4. O preview monta o site no iframe isolado. O cadastro do site gerado funciona.
5. Pedido de mudança ("deixa o botão verde") edita `styles.css` e gera uma nova versão.
6. Histórico, arquivos e versões ficam salvos e sobrevivem a recarregar a página.
7. Sidebar: lista, status ao vivo, renomear, apagar com confirmação.
8. Celular: abas Conversa/App e menu em gaveta.

Decisões:
- **Dados:** `DataStore` com `FileStore` (um JSON local, escritas em fila). O Supabase entra com os mesmos métodos.
- **Agente:** `Agent` + `runAgent`. O agente trabalha numa cópia dos arquivos; a versão só é salva se a rodada terminar bem. Se falhar, o app não muda e o chat diz isso.
- **Trava por job:** só uma rodada por vez; uma trava esquecida expira em 5 min.
- **Mensagem duplicada:** `clientId` por mensagem; um reenvio não roda o agente duas vezes.
- **Aba fechada:** a rodada continua no servidor e é salva; o streaming só para de ser enviado.
- **Login:** `getUserId()` devolve um usuário local. É a única função que muda quando o Supabase Auth entrar.

Verificação:
- `npm run check`: TypeScript, ESLint e 22 testes de unidade (preview, store, agente).
- `npm run test:e2e`: 8 testes Playwright (desktop + celular), com axe sem violações sérias, sem erro no console e sem 5xx. 40 de 40 passaram com `--repeat-each=5`.
- `npm run build`: build de produção ok.

Paridade (`parity.py`): 41,3 / 100. Must-haves: 7 de 12.
