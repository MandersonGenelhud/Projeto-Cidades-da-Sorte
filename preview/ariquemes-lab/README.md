# Ariquemes da Sorte — direção criativa independente / prévia online

Status: laboratório visual isolado. Não representa a versão PHP/MySQL do domínio oficial `ariquemesdasorte.com`.

## Duas direções realmente independentes
- **01 Alegria Futurista** (`index.html`): cores vibrantes, bilhete digital futurista, movimento leve, elementos em profundidade, narrativa positiva e três pilares sem inventar prêmios; não herda roxo/neon/bento dos pilotos.
- **02 Rotas Vivas Coloridas** (`rotas.html`): experiência clara e vibrante com cartografia abstrata, pontos de conexão, tipografia imersiva e seletor de rota acessível com atualização de conteúdo.

Ambas têm interação real de interface, navegação por âncoras, zero formulário, zero banco, zero chamadas de API, zero promoção ativa. A arte cartográfica é imaginária, não representa localização ou dados geográficos reais.

## Auditoria independente de proposta
| Critério | Editorial Vivo | Rotas Vivas |
|---|---|---|
| Clareza da proposta | Texto na dobra e CTA de descoberta | Texto em hero e CTA de rotas |
| Escaneabilidade no celular | 3 pilares com elementos gráficos | Rota seletora e painel expansivo |
| Originalidade | Linguagem futurista com alegria de celebração e informação responsável | Topografia colorida das relações |
| Riscos | Bilhete gráfico pode disputar atenção com CTA em smartphones menores | Mapa pode ser interpretado literalmente |
| Melhor para | Primeira visita e comunicação de pré-lançamento | Conteúdo de comunidade e storytelling |

Parecer técnico inicial (sem testes visuais completos em navegadores reais): primeira direção prioriza compreensão imediata, segunda explora interação contextual. Não existe escolha obrigatória: a avaliação definitiva exige feedback do proprietário e teste mobile.

## Referências de princípios, sem cópia de template
- https://21st.dev/ — diversidade de componentes e heróis experimentais para benchmark, sem copiar código/arte.
- https://motion.dev/docs/react-scroll-animations — conceitos de entrada/scroll-linked (aqui implementados sem dependências).
- https://github.com/msitarzewski/agency-agents — métodos de crítica UX/design, apenas referência.
- https://github.com/anthropics/skills/tree/main/skills/frontend-design — referência de direção independente.

## Segurança e limites
- Não há inscrição, pagamento, campanha real, cronômetro, prêmios não confirmados ou exibição de empresas parceiras.
- O logo é **referenciado** como imagem read-only do domínio oficial, com fallback tipográfico, porque ainda não existe cópia local licenciada no repositório.
- O protótipo é um mini site estático, sem sessão, cookies, SDK de terceiros nem dados de usuários.
- Fontes carregadas de Google Fonts, exceto quando bloqueadas pelo navegador; existem fontes fallback.
- `<meta name="robots" content="noindex,nofollow">` limita indexação voluntária (não protege URL por senha).
- A avaliação final requer captura visual real em 360/390/768/1440 px, teste de contraste, teclado, latência e telefone Android.
- Anexar ao PHP/Hostinger só com backup, cópia do código efetivo, migrações/integrações em staging, aprovação e rollback. O pré-cadastro atual e a API de homologação não são conectados.

## Implantação Render
Projeto estático isolado: source GitHub branch `feat/ariquemes-livre-editorial-preview-20261020`; publishPath `preview/ariquemes-lab`; nenhum build necessário; `autoDeploy:no`. O domínio oficial permanece em Hostinger. A URL definitiva só deve ser informada após confirmação de status READY/LIVE.
