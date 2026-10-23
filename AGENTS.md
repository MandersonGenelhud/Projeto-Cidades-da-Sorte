# Ariquemes da Sorte — guia para agentes de design e frontend

## Estado do trabalho
Este repositório contém laboratório de interface e uma homologação separada. A versão oficial hospedada na Hostinger/PHP/MySQL **não** é modificada aqui. A branch de referência para este experimento é `feat/ariquemes-livre-editorial-preview-20261020`.

## Skill obrigatória ao revisar interface
Leia `.agents/skills/apple-design/SKILL.md` antes de modificar comportamento touch, transições, carrosséis, modais ou animações; fonte Emil Kowalski (licença MIT anexada).
Ela é um conjunto de **princípios**, não um tema visual nem uma dependência de produção. Preserve marca e a última direção aprovada documentada em `preview/ariquemes-lab/README.md`: predominância de branco, roxo #6535C7, azul de confiança #1877F2, laranja #F18A35, verde #42A95B e legibilidade premium. Não resgatar versões multicoloridas/infantis ou escuras rejeitadas.

## Guardrails
- Prioridade mobile-first (320, 360, 390, 430px), acessibilidade de teclado e leitores de tela, áreas de toque >= 44px, foco visível e fluidez para Android de entrada.
- Feedback instantâneo ao pressionar, animações reversíveis onde pertinente e sem delays artificiais. Respeitar `prefers-reduced-motion`, `prefers-reduced-transparency` e `prefers-contrast`.
- Não inventar prêmios, campanhas, patrocinadores, vencedores, preços, probabilidades nem operação de sorteios. Interface demonstrativa sem coleta de dados.
- Não conectar cadastro real, cookies de rastreio, banco, WhatsApp comercial, pagamentos, painel administrativo ou API sem ambiente isolado, revisão de segurança/LGPD e aprovação específica.
- Não publicar, executar merge nem alterar domínio/Hostinger a partir desta branch. Submeter revisão em PR separado com testes documentados.
