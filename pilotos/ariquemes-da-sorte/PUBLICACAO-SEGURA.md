# Ariquemes da Sorte — experiência cinematográfica: caminho para publicação

## Status (18/10/2026)
- Código cinematográfico no piloto isolado: modo Bento preservado, modo Cinematográfico com sticky scroll, WebGL de órbitas/partículas, indicadores Empresas locais / Indicações, tipografia e cores originais, `prefers-reduced-motion` e CSS leve no celular. Não depende de upgrades de IA nem de pagamento.
- Prévia isolada Vercel: https://fs-ariquemes-cinematic-preview.vercel.app/ — READY no Vercel, mas pode pedir autenticação. Deploy por upload de arquivos, não Git automático.
- A logo está referenciada remotamente em https://www.ariquemesdasorte.com/assets/logo.png apenas no laboratório; exige asset local autorizado antes de ir para produção.
- PR #3 baseia-se no **PR #1, em branch de piloto**, e **não** contém necessariamente o site hospedado. Não fazer merge em main ou deploy direto sem migrar e reconciliar.

## Bloqueios de lançamento
1. Obter/identificar código real do site em https://www.ariquemesdasorte.com (provável Hostinger a confirmar em hPanel) e mapear CSS, JS, scripts PHP, formulário de pré-cadastro e integrações existentes.
2. Backup completo e rollback do domínio (incluindo eventual backend) antes de editar.
3. Adicionar somente o design aprovado ao frontend real, preservando o formulário e qualquer integração existente. Não ativar coleta ou campanhas a partir do piloto por engano.
4. Incorporar logo local com direitos autorizados. Validar conteúdo das campanhas, privacidade e situação jurídica/regulatória de qualquer sorteio e pagamento, separadamente do design.
5. Homologar no mobile, computador, WebGL com/sem suporte, movimento reduzido, SEO (remover noindex somente do site oficial, manter em preview), LCP/CLS/INP, CTAs e formulários reais.
6. Aprovar preview e então publicar por canal de implantação do site real, mantendo rollback imediato.

## O que o titular precisa fornecer
- Captura do hPanel mostrando o domínio e o diretório de hospedagem ou código/repositório que realmente alimenta a home do Ariquemes da Sorte.
- Logo original em PNG/SVG com autorização de uso e arquivos frontend do site atual se diferentes do piloto (NÃO compartilhar senhas, .env, chaves, dados pessoais ou banco privado).
- Aprovação do visual e, separadamente, do lançamento operacional quando for o momento.

## Aviso
Este PR é **visual**, com dados de demonstração. Sem novos cadastros, APIs, checkout, publicação de prêmio ou campanha. Nenhum teste multíagente autônomo nem QA de navegador completo foi certificado.
