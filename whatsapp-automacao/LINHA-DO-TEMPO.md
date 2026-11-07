# Linha do tempo do Migra Hub

Gerado por `npm run linha-do-tempo`. Não edite à mão: os marcos ficam em `docs/marcos.md`.

## Marcos (escritos à mão)

- **Maria**: assistente de vendas/coach, perfis completo, básico, próprio e parceiro (`src/maria.js`, `src/sales-coach.js`).
- **Contratos e pacotes**: vários pacotes por cliente, desconto até 15%, cláusula de dependentes, assinatura da contratada só autorizada (`src/contract.js`, `src/routes/assinatura-contratada.js`).
- **Envio por número**: fila paralela por número, perfis de envio, auditoria (`src/pending.js`, `src/send-profiles.js`, `src/messaging-audit.js`).
- **Rodízio e SLA**: distribuição entre vendedores e controle de parados (`src/distribution.js`).
- **Recomeço de atendimentos parados**: 30 dias, mensagem de retorno automática (`src/restart.js`, `src/opening.js`).
- **IA 07h–23h**: horário de funcionamento para todos os números (`src/utils.js`).
- **Baixa por comprovante**: Maria lê comprovantes (`src/maria-baixa.js`).
- **Memória do projeto**: mapa, snapshot de exportações, teste de arquitetura (`tools/mapa.js`, `test/arquitetura.test.js`).


## Histórico de mudanças (do Git)

### 2026-11-07
- `13165d3` Retorno automatico para quem esperou: mensagem fixa (agradece, demanda alta, imprevistos, continuidade) antes da IA, sem pedir desculpas
- `87aa413` IA recomeca os atendimentos parados (30 dias, todos os numeros), sem avisar a administracao; uma mensagem por vez em cada numero; memoria por agente; atendimentos do Gabriel passam para o Diego
- `48376f2` Maria: suporte do sistema com o Manderson (link do WhatsApp), aviso fixo aos vendedores e orientacao na ajuda
- `235bb73` Maria le o comprovante e da baixa no pagamento (cliente pelo WhatsApp ou CPF quando outra pessoa paga); regra fixa de aprimorar os pedidos no CLAUDE.md
- `3e66b73` Teste: horario de trabalho da IA vale para o WhatsApp de cada vendedor e Instagram
- `47bd77b` IA de atendimento trabalha todos os dias das 7h as 23h (horario configuravel no painel, fila de quem esperou segue o mesmo horario)
- `cf6a776` Controle do rodizio e dos fechamentos: entregas por vendedor, tempo de atendimento, contratos, rodizio justo e alerta de cliente parado
- `740f2cb` IA do numero principal nao continuava: id da mensagem carimbado antes do envio (eco da propria IA nao pausa mais) e protecao extra no agente
- `f2bc2dc` Liberar acesso bloqueado por tentativas: botao na Equipe, troca de senha libera na hora, aviso ao administrador com o caminho
- `32241b7` Maria: voz mais suave e tranquila (Achernar, estilo calmo e devagar) e digitando com ritmo humano
- `cdf7175` Maria: pergunta em audio responde so em audio (oferece resumo por texto); texto responde em texto e oferece audio mais explicado
- `a7e52a6` Imoveis: so o Diego (Gabriel saiu); atendente e Maria nao citam mais o Gabriel; migracao para instalacoes existentes
- `daa003a` Contrato com clausula de dependentes; pedido de dados por escrito e link sozinho (duas mensagens)
- `0dcc8f2` Maria: link de preenchimento para reserva e contrato do cliente certo (ultimo atendimento, telefone quando ha homonimos); e-mail opcional
- `50bdb53` Assinatura da empresa (contratada) nos contratos, cadastrada e autorizada pela propria pessoa; Maria envia o link do contrato para o cliente preencher e assinar
- `1c2abd9` Fila de respostas por numero (paralela), perfil de envio por numero, auditoria das conversas e mapa de mensagens
- `fbe7d85` Conversas em quadros por pessoa e acesso temporario com desativacao automatica

### 2026-11-06
- `483b2a3` Maria: perfil parceiro (cliente e vendedor externo, sem regras internas nem dados da empresa)
- `21112f5` Maria: varios pacotes e desconto no mesmo pedido (contrato, orcamento e envio ao cliente)
- `06d5e16` Maria como vendedora: prioridades do dia e coach de venda por cliente (so orienta, sem enviar nem alterar)
- `15db0e9` Migra School: preço de tabela (R$ 59,99) e finalidade no conhecimento; cortesia de 1 ano do Marcos só nas regras internas da Maria; oferta vigente do aplicativo ao vivo
- `8b2123f` Maria conhece o Migra Tech (núcleo de inovação e tecnologia) e ganha o portfólio de novidades: a direção anota pelo WhatsApp e ela já passa a saber
- `a853ebb` Maria conhece o Grupo Migra inteiro: visão completa (o que opera e o que está em desenvolvimento), dados ao vivo do sistema (imóveis, loteamentos, financiamento de lotes, veículos, serviços) e visão do Migra Hub
- `c74f0af` Trava: Maria e Ana nunca excluem nem alteram (avisam o Marcos com quem pediu, número e alvo); Ana: lista de compras por loja (aprende), contas recorrentes, metas, comparação com mês anterior e projeção
- `39bae33` Ana: assistente pessoal (agenda, lembretes até 5 anos, financeiro pessoal separado, parcelas, orçamento, resumo das 04:30), privada por pessoa e no mesmo número da Maria
- `df00bb5` Maria: um assunto de cada vez (cliente em foco, 'para ele' com aviso do nome, 'novo assunto'); corrige vazamento de dados de um cliente para outro em rascunhos e a busca por 'cliente Fulano'
- `ccde905` Maria como vendedora: cadastra cliente, faz orçamento com PDF e link da ficha, avisa o vendedor (com a prévia) quando o cliente preenche e envia o contrato em PDF com o link de assinatura
- `5290e9d` Maria: envia a ficha e o contrato direto ao cliente (com confirmação, lista de bloqueio, limites e registro); corrige teste intermitente da fila por número
- `77f517e` Maria: secretária do escritório (bate-papo com a base da empresa e o resumo do contrato, trata cada pessoa pelo nome, bom dia uma vez por dia)
- `de53213` Maria: gera contrato pelo WhatsApp (PDF e link para quem pediu) ou envia o link da ficha de dados quando faltam informações, sem enviar nada ao cliente
- `6a06d42` Maria: relatório de contratos por período (fechados, quitados, em andamento, sem pagamento), com períodos em linguagem natural e resumo falado
- `f13e46b` Maria: trava do nome (só age quando chamada por Maria ou atendente no começo da mensagem, em texto, foto ou áudio)
- `2052286` Maria: assessora interna no WhatsApp (número exclusivo, perfis, consulta de contratos, clientes, faturamento, caixa e saúde, resposta em áudio)
- `fa807d9` Atendente: conhecimento sobre a crise do Paraguai atualizado (Ueno Bank é fintech, bancos tradicionais normais, instituições reagindo)
- `29b6389` Segurança: trava contra pedidos de outro site (CSRF), política de conteúdo, contêineres sem privilégios extras e auditoria da VPS
- `22072e4` Atualizador da VPS preserva o Caddyfile (domínios) em vez de restaurar o modelo
- `31c35c8` Scripts de domínio reiniciam o Caddy para ele pedir o certificado do endereço novo (antes ficava com o endereço antigo e dava ERR_SSL_PROTOCOL_ERROR)

### 2026-11-05
- `cbb02c6` Memória da atendente: como responder sobre a crise política e bancária do Paraguai (nov/2026), com cautela e sem afirmar fatos que mudam
- `8ee1cca` Memória da atendente: quem vai morar no Paraguai precisa da licença de condução paraguaia (Pacote Ouro), mesmo achando que a CNH brasileira basta
- `d1ea531` Orçamento: Assessoria Prime R$ 2.750 e R$ 1.560 nos pacotes, desconto de 1 a 15% (aparece no PDF e na mensagem) e entrada nunca maior que o total
- `792dcf0` Fila de clientes: mostra quantos esperam e quantos foram respondidos em cada número (principal e cada vendedor)
- `f948b3c` Fila de clientes esperando: limite por hora e intervalo valem por número (principal e cada vendedor); conversa pausada não gasta vaga
- `e6e23ef` Atalhos aceitam plural (/contratos, /orçamentos) e /lembrete
- `9dcfb0a` Corrige a IA pausando sozinha: a resposta da própria IA voltava do WhatsApp como 'append' e era lida como se o dono tivesse respondido; destrava as conversas pausadas por esse engano
- `a7b72df` Logo: o navegador sempre busca a versão atual (sem precisar de Ctrl+F5)
- `879a30b` Logo do Grupo Migra Paraguay no painel, login, site, ícone da aba, imagem de compartilhamento e PDFs (troca a logo da tentativa anterior)
- `e4563de` Atalhos do WhatsApp: /contrato e os outros digitados no celular voltam a funcionar quando chegam como 'append'; resposta do atalho nunca vai para o cliente
- `88460a5` Logo nova da Migra Paraguai (dourada) no painel, login, site, ícone da aba e nos PDFs (contrato, recibo, orçamento e financiamento)
- `21af8e2` Atualizações: mostra que a chave do GitHub já está salva no painel (só os 4 últimos caracteres), para ninguém precisar buscar de novo
- `ef1440f` Painel da Migra Contábil Paraguay: carteira de empresas clientes, obrigações do mês geradas sozinhas (vencimento pelo RUC ou dia fixo), documentos pedidos, honorários que entram no Caixa Contábil e configuração
- `7a5ea5b` Duas etapas: lembrar este aparelho por 30 dias (a senha continua; 'sair de todos', troca de senha e mudança nas duas etapas cancelam)
- `640b53f` Migratech Soluções (clientes, contratos, serviços prestados, caixa próprio e saques dos sócios Marcos e Manderson) e contagem de usuários do Migra Devocional recebida do aplicativo com chave própria
- `97f1a3e` Caixa separado da Migra Contábil Paraguay (lançamentos, saldos, planilha e quem pode ver próprios; vendas contábeis entram sozinhas) e botões sem texto do painel voltam a ter nome
- `ec1e739` Avisos clicáveis: painel, sininho e aviso por cima da tela (Verificar e Fechar) levam à tela certa já filtrada; Contratos com filtro 'vencem em 7 dias'; busca do menu não recebe mais a chave do GitHub do preenchimento automático
- `b1416dd` Migra Contabilidade passa a se chamar Migra Contábil Paraguay: nova logo no lugar da antiga, mesmo Instagram, nome atualizado na base da atendente
- `8338642` Portfólio: logos da Migra School, Migra Contábil Paraguay, Migratech Soluções e Migra Devocional no site (fundo preto removido, versões leves)
- `a9953b8` Fase visual: contraste corrigido (Impeccable de 105 para 0 pontos) e logos das empresas no site, servidas pelo nosso servidor
- `b817144` Contratos: quadros e lista numa tela só; Painel e Painel executivo juntos; ficha do cliente com linha do tempo única e a origem de cada dado
- `f1f0cb7` Menu enxuto: 57 telas viram 15 seções com abas no topo e busca de telas; Prospectos com filtros de retorno, temperatura e origem e visões salvas
- `1ab50b1` Estudo dos repositórios e skills do dossiê: quadro comparativo, varredura de segurança local e decisões pedidas (nada instalado)
- `33d172c` Planilhas em CSV (vendas, parcelas em aberto, contratos cancelados e auditoria) e filtro por tipo na Auditoria
- `dfb7500` Indicadores: saque em até 24h, troca de indicação com aviso ao primeiro indicador, grupos do WhatsApp rastreáveis pelo pré-cadastro e materiais de campanha com miniatura; mapa das telas reconhece os endereços do sistema antigo
- `314d7a1` Projetos e Sócios: plano de carreira em que o consultor do topo traz um projeto e ganha participação no lucro, com piloto, aquisição por etapas, resultados e pagamentos
- `040b7e0` Níveis com a cara da Migra: Jornada do Consultor (Raiz, Ponte, Horizonte, Legado) no lugar dos nomes de pedras, mantendo percentuais e metas
- `98073d1` Cópia do sistema antigo: leads na Retomada (com origem certa), modelos de contrato preenchíveis, aulas como tutoriais, contatos da equipe e logos das empresas
- `c8a75ab` Suporte interno: chamados com urgência, prazos de resposta e solução, conversa e avisos no WhatsApp; importa os chamados antigos
- `8a115cd` Níveis de comissão por meta do mês e saques de comissão (pedido, aprovação e pagamento), com saldo do sistema antigo para consulta
- `0a1f9b2` Catálogo de serviços: importa do sistema antigo, aba Serviços, orçamento e atalhos aceitam serviço ativo do catálogo
- `c4331c3` Importação lê direto as listas do sistema antigo (contratos, andamento, clientes, parcelas em aberto) e a captura passa a buscar as páginas seguintes das listas
- `a219d80` Treinamento: guia de atalhos do WhatsApp para vendedores e para a administração
- `f1d9910` Atalhos no WhatsApp do consultor (/orcamento /ficha /ia /pausa /lembrar /status /ajuda) e da administração (/resumo /saude)
- `4d5eef3` Atalho /contrato no WhatsApp do consultor: lê a conversa, gera o contrato (ou manda a ficha) e apaga o comando da conversa do cliente
- `150f3ac` Importação ignora identificadores técnicos (UUID) que viravam falsos contratos; mapa das telas do sistema antigo comparado com o Migra Hub, sem dados de clientes
- `eea55da` Botão Tornar administrador geral na Equipe, com aviso aos administradores, registro de segurança e proteção contra auto-promoção
- `8c95996` Busca por palavra em todas as conversas (só administrador, por período, sem acento nem maiúscula)
- `1e6ca45` Fila de clientes esperando informa o motivo real de quem ficou de fora (teste, Instagram 24h ou número desconectado) e testa que WhatsApp e Instagram não se misturam
- `042e94c` Registro de quando o agente é ligado, desligado ou muda entre teste e no ar

### 2026-11-04
- `f72fe94` Aviso 'Agente salvo' volta a ficar verde: só fica vermelho quando há alerta de verdade
- `e8f8aed` Custo da IA: começo do prompt igual para todos e marcado para cache; dados da conversa vão para o fim
- `89308a0` IA não para mais se o contexto de CRM, contratos ou orçamentos falhar; ferramentas sem parâmetro ganham esquema vazio válido
- `fae2b4c` Imóveis: conhecimento do Gabriel para a IA filtrar o projeto e todo terreno/lote/apartamento direcionado só para o Gabriel
- `15895a4` Contratos em quadros com busca, sininho de avisos, resumo diário, IA consulta o contrato do próprio cliente e cópia guarda o código do app antigo

### 2026-11-03
- `6499310` Retornos e horários marcados não se perdem: contato na hora combinada com desculpas se atrasou, lembretes e recuperação dos perdidos
- `21d9088` Site público premium: cópia melhorada do site do Marcos (efeitos de rolagem, vídeos, abas, FAQ) com atendimento em rodízio
- `35166fb` Corrige o nome dos domínios do site (migraparaguay, com Y)
- `b667adb` Programa que copia o visual do site (efeitos, vídeos, telas) e pasta de referência
- `ea81193` Link de atendimento em rodízio (cada clique para um vendedor) e botão na página da live
- `970f89b` Preços novos (visita R$ 250, Marcos US$ 400), videochamada paga R$ 200 só confirmada depois do pagamento e cópia mais resistente a defeitos
- `301b6fa` Tarefas da equipe com lembrete no WhatsApp
- `f0263a7` Ficha 360 do cliente e detecção de cadastros duplicados
- `b94e9f9` Cobrança de vencidos com aprovação e previsão de recebimento por mês
- `9ebd1a0` Cópia: junta tudo em um arquivo único e guarda zips e vídeos
- `b4559a2` Estudo das telas do sistema antigo e dos grandes CRMs, com roteiro de melhorias
- `a7dbd8c` Tutoriais com treinamento semanal, Guia de Cidades e aba de Marketing com os números da Meta
- `44f097e` Orçamento desativado após 7 dias e IA com histórico, cópia da Cobrança e do caixa antigo, aviso de pagamento pelo vendedor
- `eeb0371` Aba Documentos, contratos da lista de Processos (pago e saldo), cruzamento dos grupos do WhatsApp e estudo de anúncios na Meta
- `12adce1` IA: entrada em até 12x no cartão, taxa é do banco e a Migra não cobra juros
- `c25b072` Cartão: opções de parcelas com a taxa da maquininha paga pelo cliente
- `30c87de` IA de fechamento nos WhatsApps dos vendedores, memória completa da conversa anterior e link de pagamento no cartão
- `062002e` IA: confirmação franca antes da videochamada e atendimento curto para quem não vai investir agora
- `d4afa6d` Videochamada só para quem viu o valor e confirmou ter condições financeiras
- `723807c` Reuniões gravadas (biblioteca de links) e módulos Meet/gravações marcados como feitos
- `69600f7` Página de live com Google Meet: em breve, ao vivo e grupos de WhatsApp
- `9971581` Videochamadas: IA convida casal para videochamada de 40 min, agenda espaçada e disponibilidade do consultor
- `d5517bd` Captura: espera as páginas lentas carregarem e guarda a assinatura da empresa
- `d409971` Vagas e currículos (sem avisar ninguém, banco de currículos), roteiro de lacunas do CRM
- `27680c8` Cópia mais resistente (tenta de novo, troca de aba, teto de memória) e auditoria da cópia (esperado x copiado, páginas que não abriram)
- `21309bc` Programa de cópia: endereço padrão no próprio programa (Enter aceita), pergunta de novo se vier vazio e completa o https; fim do erro 'navigating to https://'
- `871f482` Envio automático da cópia do sistema antigo: chave temporária, contratos, clientes, parcelas e arquivos (PDF, fotos, documentos) no lugar certo, vendas e CRM
- `d9dfac1` Cópia do sistema antigo: guarda o modelo de contrato (HTML e foto da tela) e amostras para copiar o modelo aprovado
- `8200a7d` Cópia do sistema antigo: lê texto das telas, sino de notificações, abas e carregar mais; importa parcelas e clientes e leva para Vendas e CRM
- `e3ae34a` Programa de cópia: corrige o erro 'invalid URL --saida' (o endereço é o primeiro argumento que não é opção)
- `e2a5fbc` Contagem de respostas da atendente no painel (total, mês, hoje), com estimativa pela memória e medição exata; gasto real informado e custo por resposta
- `35cea05` Preço: calibrar com o gasto real (mensagens da atendente no período, custo por mensagem e projeção de 30 dias)
- `0370f6a` Preço do serviço: medição do consumo da IA por escritório, calculadora de custo por resposta e planos sugeridos, guia de precificação

### 2026-11-02
- `0404da0` Roteiro de separação da tecnologia e das empresas (para sócios e advogado)
- `0ca1a19` Dois escritórios (Paraguai e Paraná) no mesmo sistema: visibilidade por escritório, administrador do escritório, seletor do administrador geral, IA própria, comparativo e domínio do site por escritório
- `af399af` Site: número confirmado (1.500+ clientes atendidos), sem índice de satisfação sem pesquisa; captura lista os endereços dos vídeos da página
- `745a9af` Site da Migra: identidade verde e dourado com títulos serifados, números e vídeos de depoimento editáveis pelo painel, perguntas com dados estruturados para o Google
- `07cc754` Site da Migra em domínio próprio: página inicial (empresas, como funciona, destaques ao vivo, indicação, perguntas), SEO, bloqueio do painel nesse endereço e script para ligar o domínio
- `58cb759` Retomar contatos: começa com 15 por dia (ajustável, teto 30) e mostra a taxa de resposta para decidir quando aumentar
- `8497a71` Visual executivo: remove emojis do painel e dos sites, ícones próprios para todas as telas, fundo da Migra visível através do vidro e painel executivo sóbrio no tema de vidro
- `3d299dd` Retomar contatos: texto novo ('Instagram da Migra, para ver a possibilidade de migrar para o Paraguai'), limite de 30 por dia e intervalo de 30 a 65 segundos
- `53c730c` Painel executivo (cobranças e vencimentos, recebido x vendido, atrasos, funil) e Módulos em standby com o mapa do que foi aproveitado do sistema antigo
- `cf641d7` Retomar contatos (leads de Instagram/Facebook/site/quiz cruzados com WhatsApp e CRM, envio aprovado e limitado) e captura do sistema inteiro com paginação segura
- `fadc186` Programa de cópia: corrige a partida no Windows (comparação de caminho) e avisa quando dá erro
- `b922dbc` Atendente: documentos necessários = RG de 10 anos para cá (passaporte não serve agora); corrige 'RG ou passaporte' no fechamento, no preset e nos textos já gravados
- `af65263` Contratos antigos: programa de cópia em um único arquivo .bat baixado pelo painel (instala o que faltar, roda e abre a pasta do resultado)
- `1d8403d` Contratos antigos: ferramenta de captura automática do sistema do Marcos (login só no navegador) e importação no painel
- `06bf047` Sites públicos por marca (Migra Paraguai, Motors, School, hub de empresas) com formulário de interesse que cai no atendente da área
- `73ff7e6` Conversas separadas por atendente na aba Conversas do administrador; teste de isolamento entre vendedores
- `01c46df` Atendentes: quem a IA ainda não direcionou fica numa triagem única (sem canal 'principal' nem 'Instagram sem dono')
- `45a80ea` Aba Atendentes: conversas e funil separados por pessoa, com origem dos clientes; layout próprio para computador e celular
- `4408c49` Migra Motors, Migra School, abas de Financiamento e Auditoria, perfil gerente na Equipe, testes de permissões
- `dc64ad1` Auditoria (quem criou/alterou/excluiu) e financiamento de lotes: simulador com juros por faixa, proposta de reserva em PDF, perfil gerente
- `06ebe0a` Atendente: RG pode ser antigo, no máximo 10 anos; com mais de 10 não dá; de 7 a 9 anos não precisa renovar
- `c9a2b65` Atendente: RG é essencial (nunca 'não precisa'), a Migra ajuda a providenciar; suporte da fronteira até o escritório nos fatos
- `839e1e9` Atendente: 'milhares de clientes' na frase de confiança
- `1e60cb9` Atendente: frase final do gatilho de confiança e oferta de clientes referência (só pela equipe, com autorização)
- `109960f` Atendente: nova frase do gatilho 'confie em mim pelos meus erros'

### 2026-11-01
- `a79469f` IA volta a atender conversas pausadas (retomar, auto-retomada após horas), fila avisa em vez de pular em silêncio, atualização pelo painel na VPS via vigia
- `b416f77` Atendente: oferta do aplicativo só como última carta (depois do fechamento, objeções e do dinheiro), documentação por etapas para famílias e brinde escolhido pelo Marcos
- `421767f` Oferta de Natal do aplicativo de idiomas: 50% para quem pagar a reserva até 25/12/2026
- `62ab775` Atendente: gatilho 'confie em mim pelos meus erros' (humildade, sem prometer aprovação)
- `b44d495` Atendente: amarrar a decisão (chamada de vídeo com o casal, outras travas) e oferta do aplicativo de idiomas com data escolhida pelo Marcos
- `747b572` Atendente: gatilhos mentais para quem compara preço menor, profissional independente ou quer fazer sozinho
- `2211e82` Conversas: controle de respostas por hora da fila de clientes esperando
- `6220043` Mesclagem de dados do computador na VPS sem apagar nada (só acrescenta o que falta)
- `9831c14` Chave da IA inválida ou desativada: avisa os administradores no WhatsApp (uma vez a cada 6 horas)
- `a9b883b` Fila de clientes esperando: erro em um cliente não derruba a fila, vigia religa fila caída e o motivo da parada aparece no painel
- `2c9547f` Fila de clientes esperando: mostra ritmo, enviadas na última hora, última resposta e tempo estimado; saúde avisa fila parada
- `12f9952` Vistoria: painel Saúde do sistema, teste de envio, vigia de envio com reinício automático, pausa contra briga entre computador e VPS, healthcheck
- `964c9c4` Segurança: painel só para quem está logado (sem clarão) e código de instalação para o primeiro administrador na VPS
- `c821192` Instalador da VPS: baixa pelo HTTPS quando o repositório é público e só pede chave se for privado
- `09878b1` Recibo em PDF no padrão visual da Migra: faixa com logo, marca d'água, selo de pago, detalhes e rodapé

### 2026-10-31
- `8e393a1` VPS: instalação com endereço provisório (sslip.io) e script para trocar de domínio depois
- `fba08f7` Relatório do Migra Hub (o que foi feito, onde clicar e pendências)
- `499f006` Painel: testar a Nina (entendimento e voz) sem WhatsApp, com o motivo de qualquer falha
- `81a084c` Nina na conversa com você mesmo: diagnóstico nos registros, avisa quando não consegue ouvir e aceita mensagens entregues como append
- `eb214ed` Nina atende a conversa do Marcos consigo mesmo (áudio com 'Nina' e resposta em voz no mesmo chat)
- `4d6230a` Taxa de reserva do atendimento presencial corrigida para R$ 150 (estornada se fechar)
- `6c8f08d` Mentoria com o Marcos nunca é estornada: só a taxa da visita volta se o cliente fechar
- `c662b48` Pagamentos: a IA lê o comprovante enviado pelo cliente, confere e dá baixa como pago; dono notificado
- `d8cb32c` Visita presencial: taxa de reserva de R$ 125 paga antes pelo Pix e estornada se fechar; aviso único para quem já pediu visita
- `ed5b78a` VPS pré-configurada: ffmpeg na imagem, backup diário, script de atualização, voz com plano B
- `9a530b2` Cada WhatsApp de vendedor tem o nome da própria atendente de IA
- `adfa036` Equipe: conectar o WhatsApp de cada vendedor e ligar a IA também pela aba Equipe
- `4afface` Equipe: botões de área por pessoa (documentação, terrenos, veículos) que valem para IA, Nina, Instagram e indicações
- `0e636d7` Windows: instala o ffmpeg embutido nas atualizações (voz da Nina)
- `4bc61c8` Nina responde em voz animada do Gemini (com ffmpeg embutido), com escolha de voz e jeito de falar
- `c0eeaa4` Nina ouve áudio pelo Gemini quando não há serviço de voz local
- `9e0d56c` Nina lê comprovantes de pagamento; um único aviso por cliente ao setor, vendedor e Marcos
- `3829642` Caixa: escopo empresa/pessoal/dízimo, consulta e planilha pela Nina, dízimo, voz mais natural; corretor e parceria imobiliária vão para Gabriel e Diego
- `c65ac5e` Nina: secretária financeira do Marcos por texto e áudio (WhatsApp → Caixa)
- `be50836` Controle de caixa (só administradores liberados)
- `bf77ba6` WhatsApp: uma conexão por número (evita duas conexões brigando e derrubando uma à outra)
- `1d3f80d` WhatsApp: reconexão com espera crescente nas oscilações, status âmbar em vez de vermelho e histórico das quedas
- `9c4f38b` Instalação na VPS: scripts de instalação e de migração dos dados; endereço fixo vence o provisório
- `b5898a0` Sequência de fechamento do Marcos: orçamento, fotos, formulário, contrato e Pix por último; gatilho 'se você fosse'
- `64d6783` Visita ao escritório e mentoria com o Marcos explicitamente separadas; cliente com reserva paga não paga nenhuma
- `efbd78b` Corrige conflito: pedido de falar direto com o Marcos vai para a mentoria, não para visita
- `f17c337` Retorno pedido pelo cliente: a atendente retoma sozinha (à noite, amanhã, mês que vem, até 12 meses)
- `bbf9d18` Instagram → WhatsApp: link com o código da pessoa, reconhecimento no número principal e histórico para a atendente
- `465f2f1` Retomada do Instagram: abertura fixa (demanda alta, perdão e agradecimento) e continuação do atendimento anterior
- `af13813` Instagram: seletor de dias para retomar conversas (padrão 30)
- `058c216` Instagram humanizado e retomada de conversas que esfriaram
- `68ee53e` Mentoria: valor sempre por extenso em dólares (250 dólares americanos, US$ 250), inclusive no Pix e no recibo
- `ce2bb8b` Mentoria: a atendente fala sempre US$ 250, sem converter
- `1f353b5` Mentoria: a equipe do Marcos escolhe dia e horário; o cliente só informa o prazo
- `e367cb3` Mentoria: o cliente escolhe dia e horário e a assessoria do Marcos confirma a agenda
- `94b123e` Mentoria com o Marcos: online ou presencial, paga antes de agendar (Pix ou cartão), grátis para cliente
- `143a152` Mentoria de 1 hora com o Marcos Miguel (US$ 250) oferecida pela atendente
- `51bd165` Quem quer trabalhar na Migra vai para o Gabriel
- `f3c683f` Instagram: não responde os perfis do Grupo Migra e trata corretores como parceiros
- `0ff0cf2` Nova divisão da equipe: nada de vendas nem visitas para o Marcos; lista de documentos do Marcos para a visita
- `ad91c86` Instagram: busca até 150 conversas do Direct (Principal, Geral e Pedidos)
- `61e5d63` Reserva com valor separado, Instagram leva para o WhatsApp e Direct de até 15 dias com resposta sugerida
- `e018503` Retomada antecipada: a IA chama quem marcou retorno para o futuro
- `79da94d` Atendente fechadora: escolha em vez de sim/não, sem aceitar 'depois', taxa da visita e aprendizados aprovados

### 2026-10-30
- `b7d0760` Contrato automático pela atendente de IA
- `afb6080` Endereço provisório automático: liga sozinho, religa se cair e avisa a equipe do endereço novo
- `e51516f` Ecossistema de indicação: pré-cadastro pelo link, pagamento BR/PY, chave do vendedor, comissões editáveis e Divulgar
- `d5d5722` Contrato assinado pelo celular
- `dbbc26d` Contratos e vendas: lançamento, parcelas, recebimentos, comissões e painel
- `2ce6134` Fechamento pela conversa: um botão por etapa, com o que já foi feito
- `8da9606` Contrato de assessoria migratória gerado pelo sistema a partir do orçamento
- `25456fa` Painel com visual claro de vidro (branco + azul-bebê) e modo noite opcional
- `9a68556` Ficha de dados fácil para o cliente: vendedor envia, orientação simples e orçamento com o nome completo
- `ca49ce9` Portal de orçamentos: cadastro com liberação, 2FA obrigatória e PDF Prime
- `4d284df` Visitas: lista com todos os vendedores da Equipe e botão "Passar para o vendedor"
- `8cc9ac1` Visitas: mostra com quem está o cliente e passa para o vendedor pelo WhatsApp
- `ca014e9` Marcos assume: conversa que ele começa já fica sem IA
- `bd3d722` A IA nunca encerra o atendimento: próximo passo sempre e retorno com data marcada
- `da60ce6` Tom profissional: a IA não manda beijo (no máximo "um abraço")
- `4ea155e` Repositório pronto para ficar privado e regras de segurança para IA
- `7da0144` Segurança: 2FA, limite de tentativas, sessões revogáveis, alertas e backup criptografado
- `5f173fa` Setores com atendentes: loteamentos, documentação e veículos
- `63f0d62` Fila antiga: IA lê 20 mensagens e não entra em conversa do Marcos
- `0e504ca` Modo cuidadoso para proteger o número: fila antiga com limite por hora e horário
- `19d621d` Reenvio dos encaminhados: resumo de cada cliente para o vendedor ou para o Marcos
- `3070fac` WhatsApp: corrige o código 428 antes do QR Code
- `48342d9` WhatsApp: QR Code não ficava preso em "Conectando…"
- `59834a8` IA responde sozinha quem esperou até 15 dias (padrão), com opção de 10 dias
- `a503e26` IA lê as 10 mensagens anteriores das conversas que vêm do histórico do celular
- `0ab792a` Saudação pelo horário, orçamento ao vendedor quando o Pix não vem e acompanhamento do Marcos
- `afaf070` Orçamentos ORC em PDF, IA fecha a venda sozinha e responde quem ficou esperando

### 2026-10-29
- `a8e0a4b` Fechamento com humano mastigado, moradia no processo e Migra School
- `2264305` Aviso claro quando a IA não responde, botão para ligar e opção de ChatGPT ou Claude
- `e87fab8` Calculadora de orçamento com as datas das parcelas
- `9c86fb2` Visitas ao escritório com o Marcos, etapas de pagamento e base do Grupo Migra
- `4587d74` História do Marcos com a fala sobre o governo e sigilo bancário e patrimonial
- `2a2f3ba` Atendente conta a história do Marcos e usa a prova social dos clientes
- `e763407` Pix da Migra pré-configurado, argumento de valor e simulador no ritmo humano
- `e12bfc5` WhatsApp de cada vendedor com o nome dele, conferência do número e botão da IA
- `578c43f` Fechamento pela atendente: ficha de dados, Pix da reserva e termo assinado no celular
- `9e5c492` Mapas que acompanham a planta, lote cinza da loteadora e 6 WhatsApps na Conexão
- `fb48876` Fase 2: site de imóveis, mapa de loteamentos e programa de indicação
- `abf7afc` Pix no fechamento: cobrança, confirmação, recibo em nome da empresa e aviso ao dono
- `f83b61b` Painel com visual profissional (padrão shadcn/ui)
- `9dc22a4` Hub v5: técnicas de fechamento, argumentos de venda verdadeiros, especialistas e 6 números da equipe

### 2026-10-28
- `38a93aa` Instagram sem VPS: endereço na internet pelo túnel gratuito da Cloudflare
- `73c1352` Agente nunca manda mensagem de erro ao cliente; corrige respostas vazias do Gemini
- `d96ba33` Migra v4: atendente humanizada e vendas consultivas com ética

### 2026-10-27
- `2b2a27c` Botão de dados de exemplo para demonstrar o Migra Hub
- `ba857fb` Migra Hub: peneira da IA no Instagram, rodízio de vendedores e ranking com metas
- `79bd845` CRM: telas de Vendas, Prospectos (quadro/lista), Retornos e Equipe com login
- `9378b13` Adiciona CRM de vendas com login de administrador e vendedores
- `e746462` Atualiza a base da Migra Paraguai com pacotes, preços e prazos
- `1c97ca2` Aceita no painel o novo formato de chave do Gemini (AQ.)
- `79781d5` Adiciona atualização com um clique pelo painel
- `7922f5c` Responde no ritmo de uma pessoa
- `f5cfdc1` Lista como pendentes as mensagens recebidas com o sistema desligado
- `ba38be1` Pausa a fila de pendentes quando acaba o limite da IA
- `41cb0eb` Adiciona Instagram Direct com o mesmo agente
- `c4e9fd3` Adiciona "Clientes esperando resposta" para responder pendentes
- `195af6f` Adiciona conexão por código e pausa quando o dono responde

### 2026-10-26
- `e1a3e59` Adiciona Google Gemini (gratuito) como provedor de IA
- `fe1e9a8` Adiciona atalhos de dois cliques para Windows e Mac
- `8ce2b5c` Adiciona base da Migra Paraguai e modo de teste pelo WhatsApp
- `dceaaf6` Traduz caminho do menu do Cal.com no painel e no README
- `0df9b79` Adiciona ZapAuto: automação de WhatsApp com agente de IA

