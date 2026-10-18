# Processo integrado FS + Agentes + Atoms-inspired (Ariquemes da Sorte)

**Data:** 18 de outubro de 2026.
**Status:** protocolo versionado no PR #2. Nenhum agente realmente executado em paralelo pelo GitHub apenas por adicionar arquivos de perfil.

## Fontes e incorporação responsável
- PR #17 FS Brasil: sete agentes (Director, UI, Frontend, Backend, Security, QA, Growth).
- PR #21 FS Brasil: 48 funcionalidades Atoms catalogadas, oito *papéis propostos*, e arquitetura NEXOS central com produtos independentes; nenhum desses módulos está implantado. Aplicar apenas conceitos relevantes ao Ariquemes, não replicar interface nem código do Atoms.
- PR #16 FS Brasil: Pattern Kit, /FS-WEB-PREMIUM, Apple Design, Impeccable. Pattern Kit é referência em branch separada.
- PR #1 Ariquemes: Bento e Cinematográfico no piloto visual.
- PR #2 Ariquemes: regras de indicação direta, páginas demo, carteira de crédito em MySQL de teste, testes automatizados e plano de lançamento.

## Matriz de papéis e evidências para este módulo
| Papel | Responsabilidade | Evidência atual | Estado |
|---|---|---|---|
| FS Director | Recorte: cadastro fundador grátis antes de operações pagas | `modulos/embaixadores/PLANO-DE-LANCAMENTO-2026-10-18.md` | Plano criado |
| Pesquisa / Replica Recon | Atoms e referências públicas, requisitos de autorização | docs de PR #21 | Pesquisa arquivada, não execução autônoma |
| UI + Frontend | Design system, convite e área mobile | `painel-demo.html`, `convite-demo.html`, `regras-demo.html` | Protótipos não publicados |
| Backend | Cadastro e atribuição direta + comissão por recompra | `ReferralService.php`, `schema.mysql.sql` | Laboratório, sem sistema real |
| Security | LGPD, segregação de dados, pagamentos bloqueados | `README.md`, `AGENTS.md` | Checklist; auditoria dedicada por concluir |
| Quality | PHP lint, testes em MySQL descartável, JS syntax | workflow `embaixadores-checks.yml` e GitHub Actions | Automação aprovada em PR #2; QA manual/browser pendente |
| Growth | Convite pré-lançamento, regras, conversão, canais | `painel-demo.html`, `convite-demo.html` | Copy no protótipo, não campanha real |

## Contrato de workflow (Atoms → NEXOS/FS)
Para cada nova feature:
1. Abrir tarefa com problema e benefício real.
2. Identificar repositório implantado, fontes e dados autorizados.
3. Fazer análise Recon e Gap/Diff; decidir o que reaproveitar do Atoms, FS Pattern Kit e Apple Design.
4. Escrever objetivos, custo e critérios de aceite antes de implementar.
5. Selecionar somente especialistas necessários; registrar se foram realmente invocados.
6. Código original e pequeno PR por módulo, com segregação de dados e rollback.
7. Gate Security/QA: CI, interface mobile, navegação, LGPD, antifraude e, para sorteios, autorização regulatória.
8. Preview e revisão explícita antes do deploy.
9. Após publicação, medir cadastro, conversão e custos sem expor dados dos clientes.

## Próxima etapa
Conectar uma cópia autorizada de `public_html` e do esquema do MySQL da Hostinger em ambiente seguro e comparar com os protótipos. Sem isso, não é possível afirmar integração publicada. Todas as features do Atoms permanecem como referência arquitetural até haver código e teste próprios com evidência.
