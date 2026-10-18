# Ariquemes da Sorte — módulo de Embaixadores (laboratório)

**Estado:** código piloto independente, não instalado no site oficial nem conectado ao banco da Hostinger. Não efetua cadastros, cobranças, pagamentos de comissão ou sorteios reais. O site de produção é PHP/MySQL e seu código e schema atual não estão neste repositório. Este módulo não substitui o sistema existente.

## Regra central — exclusivamente indicação direta

- Cadastro gratuito e verificado: **uma pessoa validada = uma indicação**, não links enviados, cliques ou dispositivos.
- **Uma única conta por WhatsApp verificado**; hash HMAC do telefone para unicidade; jamais expor telefone ao indicador. Confirmação de WhatsApp/SMS deve ser feita pelo backend autenticado existente. O navegador **não** informa que a identidade foi verificada.
- Indicação vinculada ao **primeiro clique rastreável nesse navegador**, se o cadastro ocorrer em até 30 dias. Não existe API que prove quem enviou primeiro uma mensagem externa do WhatsApp/Instagram. Depois do primeiro cadastro validado, outros cliques não transferem a vinculação.
- Somente compras **diretas** do indicado geram comissão ao embaixador; compras feitas por pessoas indicadas pelo indicado **nunca** geram ganhos ao primeiro embaixador.
- Recompras do indicado e compras com créditos de comissão continuam elegíveis, **se o regulamento e o orçamento legalmente aprovados permitirem**. Valores de comissão são reservados **antes** do início do pagamento, de modo que as obrigações não surjam sem cobertura.
- Compras pendentes capturam o vínculo de indicação no checkout, para que eventual liberação posterior não altere a autoria da compra.
- O embaixador pode **desvincular** um indicado sem apagar a conta nem o histórico. O indicado pode aceitar outro convite **depois** de desvinculado, de forma autenticada. Comissões históricas ficam com o indicador de origem; sem reatribuição retroativa.
- Privacidade: painel usa somente IDs e aliases pseudônimos, data, canal, status e agregados; nunca nome completo, número do WhatsApp, CPF ou lista de contatos.

## Três rankings distintos

1. Cadastros válidos **ativos** de indicados diretos.
2. Pessoas distintas indicadas que fizeram >= 1 compra confirmada.
3. Valor das compras confirmadas diretas, com devoluções abatidas e compras com créditos identificadas separadamente.

Podem ser aplicados filtros semanais/mensais/geral e por campanha; histórico de alterações deve ficar registrado para auditoria. Conquistas não devem recompensar quantidade de disparos.

## Métricas e honestidade de medição

- **Compartilhamentos iniciados:** eventos de clique no botão compartilhar, não envios reais nem contatos únicos. Eventos podem ser repetidos.
- **Acessos únicos estimados:** identificadores de navegador (cookies) distintos, não pessoas únicas; vários navegadores e limpeza de cookies impactam o total.
- **Cadastros válidos:** uma conta/WhatsApp verificado; 2 navegadores da mesma pessoa continuam sendo **1 conta**.
- **Compradores:** usuários distintos com compras confirmadas; **vendas**: total de compras; **receita nova**: apenas pagamentos externos, créditos circulando não entram como nova receita.
- Canais dos links: **WhatsApp, Instagram, outros ou desconhecido**; origem etiquetada por link não é prova de qual aplicativo efetivamente entregou a mensagem.
- Nenhuma plataforma pode provar que “o indicador enviou primeiro” a mensagem fora dela; a regra auditável possível é **primeiro acesso identificável com código** (30 dias), depois cadastro validado. Em troca de navegador ou cookie, o primeiro acesso pode não ser recuperável. A atribuição é fixada ao cadastro confirmado.

## Segurança / integração

- \`schema.mysql.sql\`: tabelas isoladas, índices de unicidade, vínculo único ativo e histórico auditável. Revisar versão específica do MySQL/MariaDB e migrations antes de aplicar.
- \`ReferralService.php\`: serviços de persistência chamados **apenas do servidor após autenticação/verificação**, nunca de requisição pública com IDs arbitrários; não há rotas HTTP expostas.
- \`Rules.php\`: funções puras com testes \`php tests/rules_test.php\`.
- \`painel-demo.html\`: painel responsivo sem rede e sem dados reais, integrado apenas ao estado de exemplo.
- Uma integração real exige identificar o código publicado na Hostinger, o schema do banco, como o login verifica WhatsApp, consentimento LGPD, modelo de preços do painel Master, gateway e assinatura de webhooks. Sem isso, não declarar implantação.
- Atualizações de comissão e campanhas devem ser assinadas por administrador e configuradas com controle de acesso; dados pessoais somente em backend.
- Cadastrar participantes e enviar comunicações de marketing são operações separadas: consentimento promocional granular e opt-out; observar política da plataforma WhatsApp e enquadramento legal.
- **Atenção jurídica:** não ativar venda de números, saques nem promoções remuneradas reais até validação formal do modelo conforme normas brasileiras; referenciar Loteria Federal não substitui autorização.
- Visitas e logs precisam de janela de retenção e base legal. Usar HTTPS, cookie Secure/HttpOnly/SameSite=Lax e CSRF nos formulários de sessão.

## Integração do fluxo real

1. \`GET /convite/{codigo}?origem=whatsapp\`: backend valida código, emite cookie **assinado** com token aleatório de visitante e chama \`recordFirstTouch()\`. Se já houver toque anterior válido, não sobrescrever.
2. Após verificar WhatsApp **pelo servidor**, chamar \`registerVerifiedPerson()\` com token gerado pelo servidor; se número já existir, não conta nova indicação. Cadastro de usuário já existente não pode trocar o indicador.
3. Painel autenticado: chamar \`dashboard()\`, usar apenas os IDs pseudônimos e agregados retornados. Clique no compartilhamento chama \`recordShareAction()\`, com proteção contra spam/rate limit.
4. Antes de cobrança: checkout autenticado chama \`createPendingOrder()\`; ele captura indicador do comprador, configura percentual por campanha e reserva comissão. Se não houver orçamento aprovado, suspender checkout antes de qualquer pagamento.
5. Webhook de pagamento **validado com assinatura, valor, titularidade e idempotência no gateway** chama \`confirmPaidOrder()\`. Falha/cancelamento chama `reverseOrder()` com confirmação de estorno pelo provedor. O próprio módulo não valida webhooks.
6. Ao clicar “Liberar vínculo” o embaixador autenticado chama \`releaseDirectReferral()\`. O referido pode posteriormente confirmar nova atribuição por \`acceptInvitationAfterRelease()\` após login. Histórico de compras não muda.
7. Antes de produção: migrations reversíveis, backup, testes de concorrência, segurança (IDOR/CSRF/XSS), ledger financeiro e homologação jurídica/regulatória.

## Regra consolidada: embaixador também pode ser comprador indicado

**A -> B -> C.** B foi cadastrado via convite de A; B também se torna Embaixador da Sorte e convida C.

- C cadastra-se: B contabiliza um cadastro válido; A não ganha comissão.
- C compra R$ 100 e tem B como indicador direto: B ganha a comissão da compra de C. A ganha **zero** sobre essa compra.
- B compra R$ 5 de números com as comissões confirmadas da carteira, sem usar dinheiro novo: A ganha comissão sobre a compra **de B**, conforme percentual autorizado da campanha. Isso NÃO é comissão de segundo nível: a venda remunerada é diretamente de B.
- B pode comprar parcialmente em dinheiro e parcialmente em créditos, com o mesmo indicador direto A e mesma regra de percentual elegível. A função/status de B (participante, Embaixador da Sorte, fundador) não remove o vínculo.
- Não há remuneração pelo simples cadastro de B ou por ele se tornar embaixador; nem pelas vendas de C, que B indicou.
- Quando A libera B, novas compras de B deixam de beneficiar A, preservando o vínculo capturado em pedidos anteriores.

### Regras de carteira implantadas no laboratório

- `ads_wallets` guarda o saldo de comissões **já confirmadas**, além do crédito reservado para pedidos ainda pendentes.
- `ads_wallet_events` registra cada entrada, reserva, gasto e estorno com idempotência por pedido/pessoa/tipo.
- Ao criar o pedido, `createPendingOrder()` compara o saldo disponível com os créditos solicitados e reserva esses créditos + comissão da campanha; caso insuficiente, cancela a transação antes de cobrar.
- Ao confirmar pagamento por evento **previamente validado** do gateway, `confirmPaidOrder()` transforma reserva em gasto, deposita a comissão do indicador direto e mantém a autorização regulatória como pré-requisito.
- Em cancelamentos/reembolsos validados, `reverseOrder()` desfaz crédito reservado, devolve crédito gasto e estorna a comissão. Se alguém já gastou a comissão que foi estornada, poderá ficar com saldo negativo e não poderá consumir mais créditos até sua regularização.
- **Não contabilizar crédito reciclado como novo faturamento:** campos `cash_cents` e `credit_cents` são separados.
- **Não há saque/Pix operacional** nem integração com ledger bancário, provedor de OTP, checkout de produção ou backend da Hostinger. A validação jurídica da campanha e do programa de indicação é obrigatória. Os testes integrados usam MySQL descartável com flag de aprovação **apenas em cenário de simulação**.

### Convocação curta oficial para o pré-lançamento

🍀 *CHEGOU O ARIQUEMES DA SORTE!*

🎁 Aqui você tem a oportunidade de conquistar os *prêmios mais desejados das empresas da nossa cidade* e ainda ganhar comissões indicando amigos!

🚀 O *Ariquemes da Sorte* está em *PRÉ-LANÇAMENTO!*

🏅 Cadastre-se gratuitamente como *Embaixador da Sorte* e conquiste o exclusivo *Selo de Fundador*, reservado a quem entrar antes da inauguração.

✅ É simples: cadastre-se, receba seu link exclusivo e compartilhe!

As indicações só contam após o cadastro validado, e as comissões dependem das compras elegíveis confirmadas e das regras do programa.

🔗 *Entre agora e conheça as regras:*
{LINK}

🏅 O *Selo de Fundador* é exclusivo da fase de pré-lançamento do Ariquemes da Sorte.

🍀 *Ariquemes da Sorte — Nossa cidade, novas oportunidades!*

Compartilhar é sempre voluntário e não há importação nem disparo de listas de contatos.

## Página de regras na chegada do convite

O fluxo de destino terá CTA para cadastro, link visível **Conheça as regras** com conteúdo acessível antes de finalizar a inscrição, e confirmação separada de leitura de regras e comunicação de marketing (opt-in opcional). A referência estática está em `convite-demo.html` e `regras-demo.html`; nenhum deles cadastra pessoas nem cria comissões. O `SELO DE FUNDADOR` requer data/hora de encerramento auditável no backend para bloquear emissões após inauguração; não está ativado na produção. Antes da disponibilização real, jurídico deve aprovar o regulamento comercial e a natureza das campanhas.
