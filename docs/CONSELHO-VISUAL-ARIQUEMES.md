# Conselho Visual FS — Ariquemes da Sorte (avaliação preliminar)

**Data:** 18/10/2026. **Ambiente:** PR #1 (propostas visuais) e PR #2 (painel embaixadores). Nenhum dos dois está mesclado ou publicado na Hostinger. Este documento **não representa reunião real de agentes**, aprovação visual em navegador ou comparação de desempenho medida.

## Problema e finalidade
Lançar a etapa gratuita de Embaixadores Fundadores de Ariquemes. O usuário mobile deve entender em segundos os benefícios, as regras, o pré-cadastro e a segurança. Preserve o logo original e identidade `#090318`, `#120729`, `#8F49B7`, `#F3A849`, `#5EB14F`.

## Fontes de decisão
- PR #16 FS Brasil, `design-system/fs-pattern-kit/CONSELHO-DE-DESIGN.md`, `CATALOGO.md`, `FS-WEB-PREMIUM.md`.
- PR #17 FS Brasil, perfis Agency Agents e `docs/agency-agents/CONSELHO-OPERACIONAL.md`.
- PR #21 FS Brasil, análise pública Atoms.dev → NEXOS: **processo**, não direção estética.
- PR #1 Ariquemes, `pilotos/ariquemes-da-sorte/DECISAO-VISUAL.md` e `index.html`.
- PR #2 Ariquemes, `modulos/embaixadores/painel-demo.html`, `convite-demo.html`, `regras-demo.html`.
- Apple Design e Impeccable conforme nossas definições documentadas; nenhum plugin de design foi invocado autonomamente nesta revisão.

## Candidatos documentados (sem medição visual real)

### A — Bento local
**Hipótese:** superior para ler benefícios, transparência, explicações e CTA de pré-cadastro no celular; modular no painel dos embaixadores. Base na família principal recomendada em `CATALOGO.md` para Ariquemes.
**Objeções a validar:** excesso de cartões pode cansar; hero pode ficar pouco memorável; métricas podem parecer dashboard frio.
**Melhorias propostas:** reduzir blocos, uma hierarquia clara de CTA, destacar selo fundador, cards com informação útil e evitar números fictícios.

### B — Cinemático regional
**Hipótese:** superior para impacto inicial da campanha e identidade memorável quando houver mídia própria e autorizada.
**Objeções a validar:** peso de imagem/vídeo afeta mobile; narrativa longa pode esconder CTA; estilo pode lembrar apostas se houver excesso de efeitos.
**Melhorias propostas:** hero estático leve como fallback, CTA já no primeiro viewport, movimentos interrompíveis, elementos 3D apenas quando justificam custo/performance.

## Parecer por papéis (análise do assistente; nenhum subagente foi executado)

- **Diretor FS:** site de entrada e painel não precisam da mesma família; objetivos distintos.
- **UI Designer / Pattern Kit:** Bento é **direção inicial sugerida**, não vencedora validada; manter logo e cores. Cinematic pode emprestar composição de hero se a mídia for boa.
- **Impeccable (critérios):** hierarquia tipográfica editorial e refinamento de espaçamento nos dois candidatos, sem overload de cards/glows.
- **Apple Design (critérios):** estados de cadastro, feedback de validação e interações fluidas e interrompíveis; animação não substitui clareza.
- **Frontend:** recomenda diminuir assets e dependências de animação em mobile; **sem medições reais**.
- **QA:** inspeção browser mobile/desktop e acessibilidade **não executada**; todos os critérios de nota permanecem não avaliados.
- **Growth:** testar compreensão da promessa “suas indicações têm valor”, percepção de gratuidade, regra do Selo Fundador e clareza da CTA; **sem dados de conversão**.
- **Segurança/Legal:** não publicar recompensas pagas/comissão ativa sem enquadramento autorizado; não inventar prêmios/parceiros ou exibir contatos pessoais.

## Status da arbitragem

**Direção provisória sugerida:** Bento informativo na página de pré-cadastro e painel de Embaixadores; possível **hero** mais narrativo com linguagem cinematográfica leve, desde que otimizado e autorizado. **Não é decisão homologada**, porque ainda não houve comparação visual real, teste com usuários, pontuação com evidência ou aceitação de produção.

| Critério | Peso | A | B | Motivo do status |
|---|---:|---|---|---|
| Identidade/Originalidade | 20 | não avaliado | não avaliado | Testar capturas e marca |
| Clareza/CTA | 20 | não avaliado | não avaliado | Testar com fluxo de cadastro |
| Mobile | 20 | não avaliado | não avaliado | Inspecionar breakpoints |
| Tipografia/hierarquia | 15 | não avaliado | não avaliado | Revisão Impeccable |
| Acessibilidade | 10 | não avaliado | não avaliado | Foco/contraste/motion |
| Performance | 10 | não avaliado | não avaliado | Medir LCP/CLS/INP |
| Manutenção | 5 | não avaliado | não avaliado | Analisar CSS/componentes |

## Gates para selecionar versão definitiva
1. Ter assets oficiais permitidos e telas comparáveis (mesmo conteúdo/CTA).
2. Gerar screenshots 320/360/390/768/1024/1440 e testes de teclado e redução de movimento.
3. Medir performance (não inventar resultados).
4. Coletar objeções independentes de cada perfil de agente, quando o runner permitir, com seus respectivos logs.
5. Preencher matriz com evidências; corrigir vetos; escolher e registrar a decisão humana; somente depois implementar no repositório de produção via staging/autorização.
