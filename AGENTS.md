# Ariquemes da Sorte — protocolo único FS Brasil + Agency Agents + Atoms-inspired

**Escopo:** diretrizes para código de laboratório. Este arquivo não ativa agentes autônomos nem coloca funcionalidades em produção. O repositório principal publicado está na Hostinger, e o código PHP/MySQL de produção ainda não foi mapeado aqui.

## Fontes internas e verdade operacional

1. **Perfis Agency Agents:** `.github/agents/*.agent.md` neste PR e origem em `MandersonGenelhud/fs-brasil-site` PR #17 (adaptado de `msitarzewski/agency-agents`, MIT).
2. **Padrões inspirados no Atoms:** projeto-matriz `MandersonGenelhud/fs-brasil-site`, PR #21, branch `research/atoms-nexos-replica-20261018`, em `docs/replica-atoms/` e `docs/nexos/ATOMS-INSPIRED-IMPLEMENTATION.md`. É PESQUISA + ARQUITETURA, não código instalado.
3. **Método visual:** `FS Pattern Kit` e `/FS-WEB-PREMIUM` em `MandersonGenelhud/fs-brasil-site`, PR #16, branch `fs/pattern-kit-reutilizavel-2026-10`; Apple Design, Impeccable. Consultar antes de desenhar e preservar identidade Ariquemes, logo original e paleta `#090318 #120729 #8F49B7 #F3A849 #5EB14F`.
4. **Evidências Ariquemes:** PR #1 (direções Bento/Cinematográfica), PR #2 (módulo PHP/MySQL de embaixadores). Ambos em draft, não são produção. Não confundir testes da branch com verificação de deploy.

## Pipeline obrigatório para toda entrega

1. **FS Director:** confirmar pedido, produto, ambiente, versão atual, funcionalidades que já existem e dependências. Classificar fatos em confirmado / hipótese / bloqueado.
2. **Replica Recon (referências públicas):** estudar experiências, arquitetura aparente e fluxo de produtos comparáveis, inclusive Atoms.dev apenas por documentação pública e licença válida. **Não copiar código proprietário, visuais ou ativos Atoms.**
3. **Replica Diff:** comparar requisitos aprovados com o repositório real e registrar lacunas. Nunca alegar paridade apenas com base em descrição.
4. **Replica Entrepreneur / pesquisa:** avaliar demanda, conversão, custos, viabilidade e pertinência comercial, com evidências; não importar funcionalidades irrelevantes.
5. **Produto + UX + Designer:** definir fluxo, critérios de aceite, identidade e design system antes das telas; Apple Design + Impeccable; conteúdo brasileiro, mobile-first, sem aparência de IA, SEO local e WhatsApp quando permitido.
6. **Frontend + Backend Architect:** implementar apenas os módulos aprovados, em branch isolada, com dados reais protegidos, autenticação, autorização e ledger quando houver saldo, créditos ou comissões.
7. **Security Auditor + Quality Checker:** revisar riscos LGPD e regulatórios, testes, responsividade 320/360/390/768/1024/1440px, teclado, acessibilidade e movimento reduzido. Guardar evidências de CI/QA, ou declarar que não foi executado.
8. **Growth Marketer:** revisar convites, SEO e conversão; promessas de ganhos condicionadas a campanhas elegíveis; anúncios e disparos dependem de autorização, política da plataforma e consentimento.
9. **Release:** PR → CI → preview em ambiente separado → revisão humana específica → merge e publicação específicos, rollback, monitoramento. Nunca tocar produção sem autorização explícita.

## Regras inegociáveis Ariquemes

- Cadastro gratuito no pré-lançamento, Selo de Fundador com janela de emissão auditável. Não prometer comissão real ainda desativada.
- **Um nível de indicação:** A indica B, B indica C; A não ganha pelas compras de C, mas pode ganhar pelas compras próprias de B, mesmo que B seja embaixador e pague com crédito de comissão confirmado, se campanha autorizada.
- WhatsApp único com verificação real no servidor; múltiplos navegadores não aumentam cadastros. Rastreamento do primeiro acesso observável não prova quem enviou primeiro mensagem externa.
- Dashboard só mostra identificadores privados e agregados, não telefone/CPF. Separar compartilhamentos iniciados, cliques estimados, cadastros e compradores.
- Saldos de comissões não viram dinheiro novo no caixa. Testar limites, duplicidade, estornos, reserva de crédito e orçamento.
- **Financeiro e sorteios DESLIGADOS** até parecer jurídico/regulatório, contrato com operador autorizado quando exigido, testes com provedor, confirmação de backup e release aprovada.
- Não publicar identidade de parceiros não divulgados. Não criar valor de prêmio, resultado ou comissões reais fictícias.
- Completude de implementação avaliada por PR + teste + ambiente real verificado. Perfil de agente escrito ≠ agente executado.

## Como relatar resultados

Entregar sempre: **repositório/branch e estado**, **quem fez o quê (real/instrução de agente)**, **módulos encontrados e entregues**, **testes com links**, **lacunas e riscos**, **próxima ação e aprovação exigida**. Se não houver ferramenta de delegação ativa, a revisão por papel é um checklist analítico e não execução autônoma em paralelo.

Consultar `docs/PROCESSO-FS-ATOMS-AGENTES.md` para aplicação desse fluxo no PR #2.
