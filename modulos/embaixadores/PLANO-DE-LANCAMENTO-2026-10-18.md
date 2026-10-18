# Ariquemes da Sorte — plano de entrada em operação (18/10/2026)

> **Objetivo imediato:** evoluir o pré-lançamento GRATUITO dos Embaixadores Fundadores, sem cobranças, sorteios, saldos resgatáveis ou comissões reais até a autorização jurídico-regulatória e os testes em produção. Manter a identidade original e o site existente.

## Evidências verificadas (não presumir o que não foi testado)

- Em 18/10/2026 os endereços `https://www.ariquemesdasorte.com/` e `https://ariquemesdasorte.com/` responderam em consulta pública e exibiram a página de pré-lançamento, convite à lista pioneira e informações de que o pré-cadastro é gratuito. O site público aponta Instagram Ariquemes da Sorte, WhatsApp e link YouTube `@BrasilRifas` (conferir se ainda é intencional).
- A `main` de `MandersonGenelhud/Projeto-Cidades-da-Sorte` possui apenas `README.md`; **não contém o backend PHP/MySQL da Hostinger**.
- PR #1: laboratório visual com duas direções, ainda draft. PR #2: painel de embaixadores e serviço PHP/MySQL isolados, ainda draft, com CI de lint/regras/integração em banco efêmero aprovada; **nenhum módulo implantado na Hostinger**.
- Guia antigo de instalação Hostinger (arquivo na Library de 09/08/2026) prevê `public_html/index.php`, `setup.php`, `admin/`, `inc/config.php`, MySQL, PagBank e sandbox. **É documentação histórica, não prova que esses componentes existam na hospedagem atual.**
- **Não está confirmado** se o formulário público está salvando no banco, se a exclusão de duplicados funciona, se há política/consentimentos vinculados e se o contador é verdadeiro.
- Status jurídico: **não há evidência de autorização de campanha, parceria com operadora ou aprovação do modelo remunerado**. A Secretaria de Prêmios e Apostas caracteriza rifas privadas pagas como proibidas e promoções comerciais como distribuição gratuita de prêmios com autorização prévia, quando aplicável. Avaliar modalidade específica com advogado.

## Etapa A — lançamento funcional do pré-cadastro (sem operação de sorteio)

- [ ] Acessar arquivos e banco atuais no hPanel por canal autenticado. Identificar raiz real, formulários, campos, credenciais, tabelas, políticas, integrações e logs (NÃO colar credenciais em chats).
- [ ] Backup testado de `public_html` e MySQL; preparar subdomínio/staging e versão de retorno.
- [ ] Confirmar que o formulário efetivamente **persiste** usuários únicos e registra timestamp, termo e origem (não basta exibir "enviado").
- [ ] Validar WhatsApp por serviço de OTP real e única inscrição por identidade; proteger endpoint contra abuso, replay, CSRF, automações e duplicidade.
- [ ] Definir regras de primeiro convite rastreável no dispositivo e vínculo fixo no cadastro verificado; mostrar limitações entre dispositivos e contestação; permitir liberação e novo aceite autenticado, sem apagar histórico.
- [ ] Criar ou integrar `Embaixador Fundador` com selo único, data/hora oficial de corte auditável no servidor, não prometendo privilégio financeiro não estipulado.
- [ ] Criar painel autenticado com funil (compartilhamentos iniciados ≠ mensagens entregues; cliques estimados ≠ pessoas), canais etiquetados, cadastros e rankings sem exposição de telefone/CPF.
- [ ] Página no destino do convite com **Regras**, Termos, Privacidade e confirmação de leitura antes do cadastro; marketing opcional e separado; suporte/descadastro.
- [ ] Aplicar mensagem oficial curta de pré-lançamento no botão Compartilhar, com cópias alternativa WhatsApp/Instagram.
- [ ] Verificar logo, acessibilidade mobile, CTA, certificados, links externos, redirects, backup, desempenho e analytics. Conferir destino do YouTube `@BrasilRifas`.
- [ ] Testar com 2-3 contas simuladas: indicação A→B→C; B vira embaixador, A não recebe compras de C; cadastros repetidos; outros navegadores; origem dos links; liberação de vínculo.
- [ ] Publicar **somente** o pré-cadastro validado após QA em staging e conciliação do banco existente. Não executar os scripts isolados diretamente em produção.

## Etapa B — lançamento de campanhas, compras e comissões: bloqueado até liberação

- [ ] Parecer jurídico por modalidade (promoção comercial autorizada gratuita, estrutura regulada com parceiro habilitado ou outra expressamente permitida); identidade e responsabilidades da pessoa jurídica promotora; contrato com parceiros; regulamento aprovado; autorizações e documentos.
- [ ] Rever anúncios e copys para não oferecer promessa de remuneração ou números pagos antes da definição regulatória.
- [ ] Validar calculadora Master existente/histórica: valor do prêmio/desconto parceiro, impostos, taxas, comissão direta, mídia, custo fixo, reserva, saldo reciclado, margens e ponto de equilíbrio.
- [ ] Definir comissão de 1 nível por campanha e regras sobre recompras do indicado que também é embaixador, inclusive comissões reinvestidas, saldo devedor/estornos e reservas suficientes.
- [ ] Aprovar provedor de pagamentos, taxa, políticas de operação e usar SANDBOX; verificar webhook assinado, idempotência, antifraude, conciliação, cancelamentos, auditoria e segurança.
- [ ] Em staging, executar simulação ponta a ponta: Carlos compra→Maria ganha comissão→Maria compra com crédito→João recebe comissão SOMENTE pela compra da Maria (sem comissão para João na compra de Carlos).
- [ ] Só então decidir ativação de campanhas autorizadas e comissões reais, com flags bloqueadas por padrão, treinamento e monitoramento.

## Cópias curtas de convite — três aberturas opcionais

**Principal — reconhecimento:** “🍀 E se as recomendações que você sempre fez para empresas e serviços da nossa cidade também pudessem gerar comissões? Conheça o Ariquemes da Sorte! Pré-lançamento com cadastro gratuito para Embaixadores da Sorte e Selo de Fundador. Saiba como funciona e confira as regras: {LINK}”

**Comércio local:** “🤝 Você já indica lojas, serviços e empresas de Ariquemes. Agora conheça uma proposta que valoriza essas conexões! O Ariquemes da Sorte está em pré-lançamento. Inscreva-se gratuitamente como Embaixador Fundador e conheça as regras: {LINK}”

**Curiosidade:** “🏅 Suas indicações podem valer mais! O Ariquemes da Sorte chegou ao pré-lançamento com o Selo exclusivo de Embaixador Fundador. Entre gratuitamente, conheça as oportunidades futuras e veja as regras do programa: {LINK}”

**Nota de comunicação:** Antes da confirmação jurídica do programa, falar em comissões apenas como possibilidade futura sujeita a campanhas autorizadas, nunca como rendimento existente, participação no lucro das empresas ou ganho garantido.

## Dependência decisiva

O arquivo de produção e o dump do banco **ainda não estão conectados ao repositório**. É preciso acesso autorizado ao hPanel/backup através de canal seguro para comparar o esquema real e efetuar integração. Não assumir que um PR com CI verde equivale a publicação. Não mesclar na `main` nem realizar deploy antes de backup, testes e autorização.
