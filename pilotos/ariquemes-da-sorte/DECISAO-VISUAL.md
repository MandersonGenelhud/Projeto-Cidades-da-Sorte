# Decisão visual — Ariquemes da Sorte

**Data:** 17/10/2026  
**Estado:** duas propostas para avaliação, nenhuma selecionada, nenhuma homologada.  
**Papel dos agentes:** `fs-director` define escopo; `fs-ui-designer` faz direção de arte; `fs-frontend-developer` implementa; `fs-quality-checker` audita; `fs-security-auditor` avalia riscos.

## Identidade do cliente

Preservar **a logo original do trevo/coração verde**, não recebida nesta auditoria. A área marcada como placeholder será substituída apenas após obter o ativo autorizado, preferencialmente PNG/SVG da marca; **não inventar vetor semelhante**.

Paleta, derivada do piloto existente:
- Noite profunda `#090318` — fundo primário.
- Roxo profundo `#120729` — superfícies.
- Roxo `#8F49B7` — acentos narrativos.
- Dourado `#F3A849` — destaques discretos.
- Verde `#5EB14F` — CTA de apresentação.

Tipografia: stack de sistema para manter carregamento rápido neste laboratório; em evolução aprovar família licenciada e pesos exatos. Hierarquia, contraste, grids e espaçamento revisáveis sob princípios Apple Design e Impeccable.

## Público e objetivo

Pessoas de Ariquemes que desejam entender o projeto e comércios interessados em futuras parcerias. Objetivo **desta etapa**: transmitir proposta regional sem prometer participações, premiações, autorizações ou serviços não verificados. Pré-cadastro **não pode coletar dados** neste teste.

## Proposta A: Bento local (principal)

Narrativa: valor da cidade → visão do projeto → categorias de negócios como exemplos → esclarecimento. Layout de cards assimétricos, zonas de informação claras, CTA "Conhecer o conceito", botão explícito "Pré-cadastro em preparação".

**Vantagens esperadas a validar:** leitura rápida, foco em informações, flexibilidade para adicionar parceiros reais depois. **Cuidado:** evitar excesso de cards ou aparência de dashboard.

## Proposta B: Cinematográfica regional (alternativa)

Narrativa: uma cidade, novas possibilidades → conexão com a região → estágio e transparência do projeto. Hero grande, tipografia editorial, composição abstrata original **enquanto não há fotografia regional licenciada/confirmada**.

**Vantagens esperadas a validar:** memorabilidade e narrativa. **Cuidado:** peso da mídia futura, performance e entendimento do pré-cadastro. Não usar 3D excessivo, confetes, rodas de cassino ou estética de aposta.

## Componentes e estados

Header com placeholder da logo; seletor de propostas com `aria-pressed`; hero e CTAs de apresentação; cards de categoria marcados "demonstração"; FAQ; diálogo de cadastro indisponível; footer e aviso persistente de laboratório. Não há formulário ou API.

## Estilos descartados

- Cassino, neon de apostas, contagem regressiva, jackpots e provas falsas.
- Clonagem exata de sites de concorrentes ou de templates pagos sem licença.
- Marcar qualquer prêmio, empresa ou campanha como disponível no mundo real.
- Uso direto do padrão visual de outro cliente sem ajuste para esta marca.

## Critérios de escolha

Comparar 320/360/390/768/1024/1440 px; leitura, foco do CTA, identidade e contraste, navegação por teclado, usuário com `prefers-reduced-motion`, carregamento mobile, peso de assets, ausência de overflow e compreensão de que o projeto não está operacional. Escolher somente depois de obter feedback e evidências.

## Dependências

1. Origem e acesso do site publicado (Hostinger/GitHub/outro).
2. Logo original e direitos de uso dos demais assets.
3. Conteúdo confirmado e condições legais/regulatórias de qualquer promoção.
4. Fluxo de consentimento e privacidade para futuro pré-cadastro real.
5. Autorização de preview/deploy separada deste protótipo.
