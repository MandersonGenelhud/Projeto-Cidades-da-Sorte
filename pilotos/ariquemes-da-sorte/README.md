# Ariquemes da Sorte — laboratório visual (não operacional)

> **Somente protótipo estático para revisão em branch isolada.** Não existe cadastro, sorteio ativo, checkout, parceiros confirmados, armazenamento de dados, banco conectado ou integração com domínio neste piloto.

## Auditoria de origem, em 17/10/2026

- Repositório GitHub examinado em leitura: `MandersonGenelhud/Projeto-Cidades-da-Sorte` (`main`); documento `README.md`: "Cidades da sorte são vários sites de sorteios de cada cidade do País!"
- Acesso do GitHub confirma que o repositório está público, mas não apresenta implementação das páginas nesta auditoria; `package.json` não foi localizado na raiz. **Não inferir que este é o código da plataforma instalada na Hostinger.**
- Branch original identificada: `main`. Nesta auditoria, não foi identificado pipeline de deploy em `.github/workflows/deploy.yml`; isso **não comprova** inexistência de outros deployments.
- O site publicado, arquivos originais da logo, ambiente Hostinger, dados de parceiros, bases Supabase e domínio público **não foram verificados**. Devem ser localizados antes de qualquer migração.
- PR FS Brasil #17 (em rascunho) define sete agentes adaptados, em `MandersonGenelhud/fs-brasil-site`, branch `feat/fs-agency-agents-pilot-20261017`: https://github.com/MandersonGenelhud/fs-brasil-site/pull/17.
- FS Brasil Pattern Kit v1.1 (referência): branch `fs/pattern-kit-reutilizavel-2026-10`, `design-system/fs-pattern-kit`, principalmente `README.md`, `CATALOGO.md`, `FS-WEB-PREMIUM.md`, `PILOTO-ARIQUEMES-DA-SORTE.md`.

## Como examinar este laboratório

Abrir `index.html` localmente em navegador (não precisa de dependências nem servidor). Alternar as opções **01 Bento local** e **02 Cinematográfica**. Testar navegação por teclado, FAQ e o aviso de pré-cadastro indisponível.

**Não publicar o HTML como campanha ou site definitivo.** A tag `noindex` é defesa adicional, não garantia contra indexação caso alguém publique o arquivo.

## O que foi implementado nesta branch

- Duas propostas visuais navegáveis na mesma página, com seletor de variante.
- Tokens locais nas cores documentadas e tipografia de sistema com composição distinta por proposta.
- Interface mobile-first e estados de foco, suporte a preferência de movimento reduzido, FAQ nativa e diálogo de aviso.
- Conteúdo fictício explicitamente sinalizado; não há marcas de terceiros, prêmios concretos nem prova social inventada.
- Placeholder **textual**, sem tentar reproduzir a logo original ausente.

## Agentes no piloto

- `fs-director` dirige o escopo e bloqueia deploy sem aprovação.
- `fs-ui-designer` audita e compara Bento/Cinematográfica, revisa identidade.
- `fs-frontend-developer` implementa sem bibliotecas externas ou backend.
- `fs-quality-checker` executa matriz de teste documentada.
- `fs-security-auditor` revisa exposição de dados e aspectos críticos de sorteios.

Os arquivos `.github/agents` serão definidos nesta branch para ferramentas compatíveis; sua presença **não prova execução autônoma** de agentes. Cada agente necessita invocação no ambiente adequado.

## Fora do escopo
- Reproduzir o app já publicado sem acesso ao código.
- Publicar, mesclar, hospedar, gerar códigos de sorteio ou processar pagamentos.
- Criar campanhas com aprovação regulatória presumida.
- Coletar CPF, nome, telefone ou qualquer cadastro pessoal.

## Próxima aprovação necessária

Confirmar onde estão o código do site atual e a logo original; decidir entre os layouts; só então testar a adaptação em ambiente de preview isolado, com autorização de uso de imagens e validação jurídica/regulatória se houver promoções.
