# Auditoria somente leitura — ariquemesdasorte.com

Data: 17 de outubro de 2026  
Alvos: `https://www.ariquemesdasorte.com/` e `https://ariquemesdasorte.com/`  
**Origem das evidências:** consulta pública HTTP com renderização externa, extração de HTML e consulta DNS ao serviço público dns.google; nenhum POST foi enviado.

## Disponibilidade, nome e SEO
- Ambos os endereços forneceram documento HTML com título de pré-lançamento, sem confirmação de redirecionamento canônico entre apex e www.
- Resposta observada para www: HTTP 200, `text/html; charset=UTF-8`, idioma `pt-BR`.
- `<title>`: "Pré-lançamento | Ariquemes da Sorte".
- Description: "Entre para a primeira geração de Embaixadores Fundadores do Ariquemes da Sorte."
- OG title: "Ariquemes da Sorte — Pré-lançamento"; OG description: "Sua indicação tem valor. Entre para a lista pioneira."; OG image aponta para `https://ariquemesdasorte.com/assets/logo.png`.
- Na captura do `<head>` não foi encontrada tag `rel="canonical"`. Validar configuração de SEO e redirecionamento em infraestrutura apropriada antes de alterar.

## Identidade visual e recursos publicamente observados
- Logo oficial: `https://www.ariquemesdasorte.com/assets/logo.png` — o endpoint retornou HTTP 200, `image/png`. O arquivo binário **não foi copiado para este repositório**. Laboratório referencia a imagem remotamente, apenas para revisão.
- Favicon: `https://www.ariquemesdasorte.com/assets/favicon.png`.
- Frontend usa CSS e JS personalizados: `/assets/prelaunch.css?v=5.0.0` e `/assets/prelaunch.js?v=5.0.0`.
- A extração de branding identifica Inter como família tipográfica e tema escuro, com `#090318`, `#120729`; valores de outras cores precisam ser confirmados no CSS real.
- Hero contém logo, proposta "SUA INDICAÇÃO TEM VALOR", título interrogativo sobre indicações de empresas em Ariquemes, CTA para `#cadastro`, botão de vídeo e cenário visual animado.
- Componentes: cards Empresas locais / Indicações / Resultados; jornada em quatro etapas; bloco de posicionamento; seção Embaixadores Fundadores; rodapé, Instagram, YouTube e WhatsApp.

## Fluxo de cadastro (HTML somente, sem enviar dados)
- Formulário HTML tem `method="post"` e não define atributo `action` explícito.
- Campos observados: `name` obrigatório, `phone` obrigatório, `email` opcional, três campos `companies[]`, `consent_whatsapp` obrigatório.
- Texto de finalidade: "Seus dados serão usados para comunicações relacionadas ao projeto."
- Link de política de privacidade não foi identificado no trecho examinado do formulário. Validar política, retenção, dados dos participantes e opt-out, além da efetividade do consentimento.
- **Não foi realizado nenhum envio** e não se sabe o destino da persistência, tecnologia backend ou isolamento do banco.
- Um número `004` e o texto "pessoas já entraram" aparecem no HTML bruto da captura. Isso não permite concluir se é contagem real, mock estático ou HTML gerado pelo servidor; confirmar origem antes de usar como prova social.

## Contatos e vínculos (não validados como contas oficiais)
- Botão WhatsApp aponta para `https://wa.me/5569993051671`.
- Instagram: `https://www.instagram.com/ariquemesdasorte`.
- Link de YouTube da página: `https://www.youtube.com/@BrasilRifas`. Conferir se é o canal pretendido.
- Modal de vídeo aponta para embed de YouTube `lmfQf7JfZM4`, descrito no HTML como provisório.

## DNS público (observado via Google Public DNS)
- NS: `ns1.dns-parking.com`, `ns2.dns-parking.com`.
- A (apex): `195.35.41.163`.
- CNAME (www): `ariquemesdasorte.com.`.
- Esses indicadores são compatíveis com serviços de DNS associados à Hostinger, **não certificam titularidade de hospedagem de arquivos nem localizam o código-fonte original**.
- Nenhuma conta hPanel, FTP/SFTP, banco de dados ou diretório `public_html` foi acessado.

## Recomendações priorizadas para o próximo teste, sem agir na produção
1. Confirmar onde reside o HTML/CSS/JS e o backend da página oficial (hPanel → Sites → Gerenciar/Arquivos; ou deploy de origem), sem compartilhar senhas.
2. Solicitar cópia autorizada da logo em arquivo e integrar à branch de teste, removendo dependência de URL externa.
3. Adaptar texto das propostas Bento e Cinematográfica aos pilares, fluxo de indicações e Embaixadores Fundadores observados — já iniciado nesta branch.
4. Validar política de privacidade, armazenamento, consentimento, contagem `004` e canais externos antes de mudanças no formulário publicado.
5. Verificar canonical e preferência de www versus sem-www.
6. Comparar responsividade, acessibilidade, movimento e performance em navegador real antes de considerar qualquer preview público.
7. Não inferir backend como PHP, React, Next.js ou Supabase apenas pelo HTML entregue.

## Distinção entre estágios
- **Site oficial:** possui um formulário de pré-cadastro publicamente observável; funcionamento do POST e do banco não comprovados.
- **Laboratório GitHub:** não coleta dados nem integra o backend, apresenta as duas direções visuais e mostra aviso quando um visitante tenta avançar para cadastro. A imagem da logo é carregada do domínio oficial em modo somente leitura.

**Nenhuma mudança de DNS, conteúdo hospedado, banco, cadastro ou produção ocorreu nesta auditoria.**
