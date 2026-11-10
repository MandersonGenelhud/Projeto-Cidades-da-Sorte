# Mapa do sistema (gerado por `npm run mapa`; não edite à mão)

> Esta é a memória de **onde cada coisa está e quem depende de quem**. Antes de mexer em um módulo, veja aqui quem o usa
> (`npm run quem-usa -- src/<arquivo>.js`), faça a mudança **sem apagar o que já é usado** (acrescente) e rode `npm run mapa` e `npm test`.
> A história de tudo o que foi feito, na ordem, está em `LINHA-DO-TEMPO.md`. As regras de segurança, em `SEGURANCA.md`.

## Números
- Módulos em `src/`: **149** · testes automatizados (arquivos): **149** · scripts do painel: **47**
- Rotas da API em `server.js`: **528** · tarefas agendadas (`setInterval`): **21** (todas com `unref`: sim)
- Ciclos de importação (um módulo depender dele mesmo por outro): **0**
- Módulos que ninguém usa: **0**

## Como o sistema é montado (de baixo para cima)
1. **`src/server.js`** liga tudo (é o único arquivo que conhece todos os módulos) e expõe a API e o painel. Funcionalidade nova entra num **módulo próprio** e o servidor só a liga, sem copiar a lógica para dentro dele.
2. **Módulos de regra** (`crm.js`, `sales.js`, `quotes.js`, `payments.js`, `closing.js`...) guardam os dados em `store` (um arquivo JSON em `data/`, fora do Git) e não conhecem WhatsApp nem painel.
3. **IA do atendimento** (`agent/`): conversa com o cliente, usa ferramentas, é chamada por `autoreply.js` e pela fila `pending.js`.
4. **Assistentes internos**: `maria.js` (secretária da equipe), `ana.js` (pessoal), `assistant.js` (Nina, caixa).
5. **Conexões** (`connection.js`, `lines.js`, `transports/`): um número principal, um por vendedor e o Instagram; cada conta envia **uma mensagem por vez**.
6. **Painel** (`public/`): uma página (`index.html`) e um script por área; scripts novos entram na lista abaixo e **não alteram** os antigos.

## Regras para não quebrar o que já funciona
- Acrescente, não substitua: função, rota ou campo que já existe só some depois de conferir `quem-usa` e os testes.
- Cada funcionalidade nova: módulo novo em `src/`, teste novo em `test/`, rota registrada no servidor, linha em `SEGURANCA.md` quando mexe em dinheiro, acesso ou dado de cliente.
- Configuração nova vai em `settings` com **valor padrão** em `store.js`; mudança em dado já existente usa **migração de uma vez** com selo (veja abaixo), nunca sobrescreve o que o painel salvou.
- Nada de segredo no código. Dados reais ficam em `data/` e nunca no Git.

## Módulos (149)
| Módulo | Linhas | Para que serve | Quem usa | Testes |
|---|---:|---|---|---:|
| `affiliate-extras.js` | 202 | Escritório virtual do indicador, parte 2: | `server.js` | 1 |
| `affiliates.js` | 440 | Indicadores (afiliados): pessoas comuns que indicam clientes para a Migra e | `server.js` | 3 |
| `agent/agent.js` | 756 | Agente de IA: conversa, lembra da conversa, responde sobre o negócio e age. | `atendimento-plano.js`, `quote-expiry.js`, `restart.js`, `server.js` | 26 |
| `agent/calendar.js` | 231 | Agenda usada pelo agente: agenda interna (padrão) ou Cal.com. | `agent/prompt.js`, `crm-ai.js`, `crm.js`, `server.js`, `videocalls.js` | 7 |
| `agent/central.js` | 24 | Orientação da CENTRAL DE ATENDIMENTO (o número que recebe quem chega, apresenta a Migra, tira as dúvidas e leva ao vendedor certo). | `server.js` | 2 |
| `agent/claude.js` | 97 | Claude (Anthropic) como cérebro da atendente, pelo SDK oficial. | `agent/llm.js` | 1 |
| `agent/greeting.js` | 50 | Saudação certa pelo horário (regra da Migra): | `agent/agent.js`, `agent/prompt.js`, `humanize.js`, `server.js` | 1 |
| `agent/llm.js` | 181 | Cliente de IA no formato da API da OpenAI (chat completions + ferramentas). | `server.js` | 4 |
| `agent/oferta-app.js` | 18 | Memória comercial da oferta do aplicativo Migra School (informações passadas pelo Marcos) + como usar os gatilhos com honestidade. | `agent/agent.js` | **0** |
| `agent/presets.js` | 422 | Perfis prontos de negócio. "Carregar perfil" no painel copia estes dados | `server.js`, `store.js` | 19 |
| `agent/prompt.js` | 136 | Monta o prompt de sistema a partir da base do negócio (passo 5 do vídeo). | `agent/agent.js`, `server.js` | 8 |
| `agent/tools.js` | 596 | Ferramentas que o agente pode usar (passo 6 do vídeo: "o agente age"). | `agent/agent.js` | 6 |
| `agent/vendas-playbook.js` | 58 | Playbook de vendas das IAs da Migra: síntese original dos princípios de vendas consultivas (diagnóstico, escuta, objeções, decisão informada, ética), | `agent/agent.js` | 2 |
| `ai-stalls.js` | 31 | "Por que a atendente parou de falar?": para cada conversa em que a última mensagem é do cliente e a IA não respondeu, mostra o MOTIVO. | `routes/controle.js` | 1 |
| `alerts.js` | 38 | Avisos do painel (sininho) e resumo diário no WhatsApp do administrador: | `server.js` | 1 |
| `ana-dates.js` | 131 | Datas e horas ditas em português ("amanhã às 14h", "dia 15", "daqui a 2 anos", "15 de dezembro de 2027"). | `ana.js`, `assistant-guard.js`, `personal.js`, `shopping.js` | 1 |
| `ana-family.js` | 79 | Pessoas da casa que usam a Ana pelo mesmo número da Maria, SEM acesso ao painel nem à empresa (ex.: a esposa do Manderson). | `server.js` | 1 |
| `ana.js` | 869 | Ana: a assistente PESSOAL e financeira de cada administrador (Marcos, Manderson...). Ela é diferente da Maria (que é da empresa): | `server.js` | 4 |
| `app-signups.js` | 109 | Cadastros de aplicativos da Migra (hoje: Migra Devocional) chegando no Migra Hub para acompanhar quantos usuários há. | `server.js` | 1 |
| `assistant-guard.js` | 42 | Trava de segurança da Maria e da Ana: elas só CRIAM (cadastro novo, orçamento, contrato) e ENVIAM. Nunca excluem nem alteram | `maria.js` | 1 |
| `assistant.js` | 449 | Nina: a secretária financeira do Marcos (e dos administradores liberados no Caixa). | `ana.js`, `server.js` | 1 |
| `atendimento-plano.js` | 31 | Plano de atendimento: separa TODAS as conversas dos últimos dias em grupos claros, para o administrador saber o que o botão "Começar" vai fazer. | `routes/controle.js` | 2 |
| `attendants.js` | 122 | Visão por atendente: separa as conversas e os prospectos de cada pessoa (e do | `routes/controle.js`, `server.js` | 1 |
| `audit.js` | 125 | Trilha de auditoria: registra QUEM criou, alterou ou excluiu cada coisa | `server.js` | 1 |
| `auth.js` | 265 | Usuários do painel: administrador (dono) e vendedores. | `affiliates.js`, `maria.js`, `server.js` | 59 |
| `autocontract.js` | 115 | Contrato automático pela atendente de IA: o cliente pede o contrato na conversa. | `server.js` | 2 |
| `autoreply.js` | 250 | Chatbot de respostas automáticas por palavra-chave. | `server.js` | 7 |
| `backup.js` | 111 | Backup automático e criptografado dos dados do painel (clientes, conversas, vendas, configurações). | `server.js` | 1 |
| `campaigns.js` | 211 | Envio em massa com fila, intervalos aleatórios e pausas automáticas. | `server.js` | 1 |
| `campanhas-funil.js` | 44 | Relatório de uma campanha: quantas pessoas vieram (por variante A, B… e "sem código"), quantas receberam orçamento, preencheram a ficha, assinaram, | `server.js` | 1 |
| `campanhas.js` | 99 | Controle de campanhas de marketing: quantas pessoas vieram falar da oferta/promoção, de qual arte ou legenda (variante A, B…) e quantas fecharam. | `server.js` | 1 |
| `cash.js` | 301 | Controle de caixa: o que entra (recebimentos dos clientes, já conhecidos pelo sistema) e o que sai | `assistant.js`, `server.js` | 6 |
| `cities.js` | 119 | Guia de Cidades: números e endereços úteis de cada cidade do Paraguai para o cliente que está chegando. | `server.js` | 1 |
| `closed-signals.js` | 40 | Sinais de "já é nosso cliente" lidos das ÚLTIMAS 20 MENSAGENS da conversa (de quem for: cliente, equipe, IA, áudio transcrito). | `agent/agent.js`, `atendimento-plano.js`, `outreach-guard.js`, `restart.js` | 2 |
| `closing.js` | 407 | Fechamento da reserva, na ordem combinada com a Migra: | `server.js` | 5 |
| `collections.js` | 138 | Cobrança de vencidos e previsão de recebimento. | `server.js` | 2 |
| `commissions.js` | 184 | Níveis de comissão (por meta de vendas do mês) e saques de comissão. | `server.js` | 2 |
| `commitments.js` | 78 | Compromissos marcados com clientes (horários do calendário e videochamadas): a atendente chama o cliente NA HORA marcada | `server.js` | 1 |
| `connection.js` | 163 | Gerencia as conexões: WhatsApp (QR Code ou API oficial da Meta, um de cada vez) | `server.js` | 3 |
| `contabil.js` | 320 | Painel da Migra Contábil Paraguay: a carteira de empresas clientes do escritório contábil. | `server.js` | 1 |
| `contract-cards.js` | 96 | Quadros dos contratos (um por contrato, com prévia), busca, filtros e a consulta que a IA faz sobre o contrato do PRÓPRIO cliente. | `server.js` | 1 |
| `contract-pix.js` | 56 | REGRA: o Pix do que foi combinado (normalmente a reserva/entrada) vai ao cliente DEPOIS que ele assina o contrato (ordem do Marcos: ficha, assinatura, Pix). | `server.js` | 2 |
| `contract.js` | 341 | Contrato de prestação de serviços de assessoria migratória, preenchido sozinho com os dados | `server.js` | 3 |
| `convsearch.js` | 37 | Busca por palavra nas conversas guardadas (WhatsApp e Instagram, de todos os números): ignora acentos e maiúsculas. | `server.js` | 1 |
| `crm-ai.js` | 99 | IA a serviço do CRM: lê as conversas para preencher os prospectos e | `agent/agent.js`, `ana.js`, `assistant.js`, `maria.js`, `receipts.js`, `server.js` | 1 |
| `crm.js` | 698 | CRM de vendas: prospectos (leads), funil, histórico, retornos agendados e números. | `attendants.js`, `server.js` | 33 |
| `csrf.js` | 16 | Segunda trava contra pedidos forjados por outros sites (CSRF). O cookie de sessão já é SameSite=Lax; | `server.js` | 1 |
| `csv.js` | 16 | Planilhas (CSV para Excel brasileiro): ponto e vírgula, acentos corretos e proteção contra "fórmula" injetada no texto | `reports-csv.js` | 1 |
| `customer360.js` | 136 | Ficha única do cliente (visão 360): tudo o que existe sobre uma pessoa em um lugar só, em ordem de data. | `server.js` | 1 |
| `demo.js` | 65 | Dados de exemplo: enche o painel (vendedores, clientes, rodízio, vendas e ranking) | `server.js` | 1 |
| `digest.js` | 80 | Reenvio dos encaminhamentos: cada cliente que a IA passou para um humano vira uma | `server.js` | 1 |
| `directory.js` | 133 | Índice de tudo o que a empresa sabe sobre cada pessoa, lendo TODO o histórico (não só o que chega daqui para frente): vendas, orçamentos e | `maria.js`, `server.js` | 2 |
| `distribution.js` | 134 | Controle do rodízio e dos fechamentos: para cada vendedor, quantos clientes a central entregou (e por onde chegaram), quantos já foram | `routes/controle.js`, `server.js` | 1 |
| `documents.js` | 156 | Documentos emitidos para os clientes (admissão temporária, cédula, RUC, licença…): quando saiu, quando foi entregue, | `server.js` | 1 |
| `executive.js` | 117 | Painel executivo: cobranças e vencimentos por período, recebimentos, vendas, atrasos e semanas a receber. | `server.js` | 2 |
| `fechamentos.js` | 68 | Painel de FECHAMENTOS: quem continuou a conversa DEPOIS de receber o orçamento (todo mundo recebe orçamento, então o orçamento sozinho não mede nada). | `routes/fechamentos.js` | 1 |
| `ficha-text.js` | 24 | A ficha de dados em TEXTO: muita gente tem medo de tocar num link, então o pedido sempre vai também escrito, para a pessoa | `maria-outbound.js`, `maria.js`, `server.js` | 1 |
| `finance.js` | 283 | Financiamento próprio de lotes (Migra Imobiliária): simulador de parcelas com | `server.js` | 2 |
| `flash-offer.js` | 88 | Oferta relâmpago com VAGAS LIMITADAS de verdade: só as próximas N pessoas (padrão 20), que fecharem até a data, em plano Prata ou Ouro, | `routes/fechamentos.js`, `server.js` | 2 |
| `followups-done.js` | 49 | Retornos ATRASADOS que na verdade já foram feitos: se depois da data do retorno a equipe ou a IA já falaram com o cliente, | `server.js` | 1 |
| `followups.js` | 203 | Retorno combinado: quando o cliente pede "mais pra frente", a atendente marca dia e hora | `server.js` | 2 |
| `group-brief.js` | 120 | Resumo AO VIVO do Grupo Migra para a Maria (a secretária da equipe): imóveis e loteamentos, financiamento de lotes, veículos, | `server.js` | 2 |
| `group-broadcast.js` | 107 | Envio da MESMA postagem (texto + imagem ou vídeo) para vários grupos do WhatsApp, UM DE CADA VEZ, com pausa aleatória entre eles. | `server.js` | 1 |
| `humanize.js` | 82 | Ritmo humano: quanto tempo uma pessoa levaria para ver, ler e digitar. | `agent/agent.js`, `pending.js`, `server.js` | 2 |
| `lead-brief.js` | 77 | Ficha do vendedor: a conversa COMPLETA que o cliente teve antes de chegar a ele (Instagram, site ou WhatsApp, em ordem de tempo) e um resumo | `server.js` | 1 |
| `lead-repair.js` | 56 | Conversas que a atendente respondeu mas não viraram prospecto no CRM (nada gravado para o vendedor ver): cria o prospecto que faltou. | `routes/controle.js` | 1 |
| `learnings.js` | 90 | Aprendizados de vendas: a cada venda confirmada, a IA lê a conversa e anota o que funcionou | `server.js` | 1 |
| `legacy-extras.js` | 78 | O que mais veio da cópia do sistema antigo: modelos de contrato (Migra Paraguai, Migra Med, Migra Brasil, RUC), | `server.js` | 1 |
| `legacy-import.js` | 620 | Contratos do sistema antigo (do Marcos): lê o arquivo capturado pela ferramenta | `legacy-ingest.js`, `reconcile.js`, `reengage.js`, `server.js` | 6 |
| `legacy-ingest.js` | 116 | Envio automático da cópia do sistema antigo: o programa de cópia (no computador de quem tem o login do sistema antigo) | `server.js` | **0** |
| `legacy-map.js` | 94 | Mapa das telas do sistema antigo (sem nenhum dado de cliente) e comparação com o que o Migra Hub já tem. | `server.js` | 1 |
| `legacy-tool.js` | 62 | Monta o arquivo único CAPTURAR-CONTRATOS.bat que o administrador baixa pelo painel: | `server.js` | 3 |
| `lines.js` | 220 | Números da equipe: um WhatsApp por vendedor (com o nome dele), cada um com o seu | `connection.js`, `send-profiles.js`, `server.js` | 5 |
| `live.js` | 69 | Página de live: o Meet que a equipe já usa, com frase de "em breve" / "ao vivo", botão de entrar e botões dos grupos de WhatsApp. | `server.js` | 1 |
| `maintenance.js` | 22 | Ajustes únicos de equipe, aplicados sozinhos na inicialização (cada um só uma vez). | `server.js` | 1 |
| `maria-baixa.js` | 150 | Baixa de pagamento pela Maria: o vendedor manda o comprovante (foto ou PDF), a Maria lê, descobre de quem é o pagamento e qual parcela ou | `maria.js` | 1 |
| `maria-items.js` | 62 | Vários pacotes no mesmo pedido ("5 Ouro, 1 Estudantil e 1 Inicial, com 10% de desconto"): lê a lista e o desconto do texto, sem IA. | `maria.js` | 1 |
| `maria-outbound.js` | 127 | Envio ao cliente pedido pela Maria: a ficha de dados e o contrato saem pelo WhatsApp que o cliente já conhece | `server.js` | 2 |
| `maria.js` | 1600 | Maria: a assessora interna da Migra no WhatsApp (número exclusivo, só da equipe). | `server.js` | 23 |
| `marketing.js` | 88 | Marketing: traz os números dos anúncios da Meta (Facebook e Instagram) para o painel, em português simples. | `server.js` | 1 |
| `merge-data.js` | 54 | Junta os dados de duas instalações (ex.: o computador e a VPS) SEM apagar nada da instalação de destino: | — | 1 |
| `messaging-audit.js` | 97 | Auditoria das conversas e mapa de mensagens por número: para cada WhatsApp (principal, Instagram e o de cada vendedor) mostra | `routes/controle.js` | 1 |
| `migratech.js` | 197 | Migratech Soluções: clientes, contratos e serviços prestados, separados da Migra. | `server.js` | 1 |
| `motors.js` | 137 | Migra Motors: estoque de veículos + simulador de financiamento por banco/financeira | `server.js` | 2 |
| `offices.js` | 17 | Escritórios: o mesmo sistema atende dois escritórios separados (Paraguai e Paraná). | `auth.js`, `crm.js`, `sales.js`, `sectors.js`, `server.js` | 1 |
| `opening.js` | 40 | Mensagem de retorno para quem ficou esperando: agradece por aguardar, diz que a demanda está alta mas todos estão sendo atendidos, que o | `pending.js`, `silence.js` | 2 |
| `outreach-apology.js` | 41 | Cliente ANTIGO que recebeu, sem precisar, uma chamada automática nossa ("dar continuidade ao seu atendimento"…) e respondeu. | `agent/agent.js`, `closed-signals.js`, `restart.js` | 2 |
| `outreach-guard.js` | 146 | Guarda de contato: o sistema NÃO procura de novo quem já disse que fechou com outra pessoa, que não quer mais, que pediu para não ser chamado, | `agent/agent.js`, `autoreply.js`, `pending.js`, `restart.js`, `routes/controle.js`, `server.js` | 4 |
| `partner-projects.js` | 224 | Migra Sócios de Projeto: plano de carreira em que o consultor que chegou ao topo traz um projeto novo | `server.js` | 1 |
| `patch-baileys.js` | 23 | Correção da biblioteca do WhatsApp (Baileys 7.0.0-rc14) enquanto a versão nova não sai: | — | 1 |
| `payment-terms.js` | 49 | Regra de vencimento das parcelas (plano padrão): 1ª com vencimento ou pagamento na primeira vinda ao Paraguai; 2ª entre 60 e 90 dias após a | `store.js` | 1 |
| `payments.js` | 425 | Cobrança por Pix no fechamento: gera o Pix (copia e cola + QR Code), confirma o | `server.js` | 10 |
| `payplan.js` | 118 | Etapas de pagamento do processo (o "fluxograma" que o cliente recebe). | `contract.js`, `quotes.js`, `server.js` | 8 |
| `pdfdoc.js` | 268 | PDF de várias páginas, sem dependências: títulos, parágrafos com quebra de linha | `closing.js`, `contract.js`, `finance.js`, `payments.js`, `plano-pdf.js`, `quotes.js` | 2 |
| `pending.js` | 586 | Conversas sem resposta: clientes cuja última mensagem ainda não foi respondida. | `server.js` | 4 |
| `personal.js` | 528 | Agenda e financeiro PESSOAL de cada pessoa (a assistente pessoal "Ana"). Fica separado da empresa: não entra no Caixa Migra, | `ana.js`, `server.js` | 4 |
| `phone-fix.js` | 48 | Telefones de clientes já gravados sem o +55 (só DDD + número): acrescenta o 55 do Brasil, só quando o número é claramente brasileiro | `routes/controle.js`, `store.js` | 1 |
| `pix.js` | 154 | Pix "copia e cola" (BR Code, padrão EMV do Banco Central) e recibo em PDF, | `payments.js`, `receipts.js` | 1 |
| `plano-pdf.js` | 48 | "Plano para dar entrada sozinho": para quem não tem condições de contratar a assessoria. O cliente paga um valor simples (padrão R$ 500) | `routes/fechamentos.js`, `server.js` | 1 |
| `portfolio.js` | 57 | Portfólio de novidades do Grupo Migra: a direção vai anotando cada coisa nova que o grupo cria ou lança, e a Maria já fica sabendo. | `maria.js`, `server.js` | 1 |
| `qualificacao.js` | 79 | Termômetro de venda: a IA registra, ao longo da conversa, se o cliente TEM CONDIÇÕES de fechar e o que fazer com cada resposta dele. | `agent/agent.js`, `agent/tools.js`, `restart.js` | 2 |
| `queue-priority.js` | 49 | Prioridade da fila de atendimento: quem acabou de chegar (cliente novo escrevendo agora) passa na frente; os antigos (retomadas, recomeços, | `pending.js` | 1 |
| `quote-delivery.js` | 49 | Entrega do orçamento ao cliente: uma MENSAGEM DE VOZ alegre e calma (no lugar do texto que acompanhava o PDF) e o PDF timbrado, com o botão | `server.js` | 1 |
| `quote-expiry.js` | 79 | Aviso de orçamento que vai vencer: quem recebeu a proposta e ainda não fechou é lembrado, com o prazo REAL do orçamento, | `pending.js`, `routes/controle.js` | 2 |
| `quote-request.js` | 78 | "Dados para o orçamento": quando o cliente pede um orçamento (ou a atendente vai mandar um), ele recebe um link curto para preencher os dados básicos | `server.js` | 1 |
| `quotes.js` | 507 | Orçamentos da Migra (ORC-AAAA-NNNNN): PDF com a marca + mensagem de WhatsApp no formato da equipe. | `server.js` | 6 |
| `ranking.js` | 93 | Ranking da equipe: pontos, metas do mês, níveis de bonificação e conquistas. | `server.js` | 1 |
| `realty.js` | 273 | Migra Imóveis: imóveis avulsos (casas, terrenos, galpões…) e loteamentos com | `server.js` | 3 |
| `receipts.js` | 179 | Comprovante de pagamento enviado pelo cliente na conversa: a IA abre o arquivo, lê, confere com a cobrança | `server.js` | 1 |
| `reconcile.js` | 139 | Conferência dos contratos e do dinheiro: acha contratos repetidos, valores que não fecham e diferenças em relação ao sistema antigo | `routes/controle.js` | 1 |
| `recordings.js` | 38 | Reuniões gravadas: biblioteca de links (Drive, YouTube, Meet) com título, data e assunto. Não guarda vídeo, só o endereço. | `server.js` | 1 |
| `reengage.js` | 272 | Retomada de contatos: pessoas que pediram atendimento (Instagram, Facebook, site, quiz) e ainda não | `server.js` | 2 |
| `reports-csv.js` | 56 | Relatórios em planilha (CSV): vendas, parcelas em aberto, contratos cancelados e auditoria. Só administrador. | `server.js` | 1 |
| `restart.js` | 91 | Recomeçar os atendimentos parados: varre as conversas guardadas dos últimos 30 dias (de todos os números e do Instagram) e põe na fila da IA | `atendimento-plano.js`, `routes/controle.js` | 4 |
| `resumes.js` | 108 | Banco de currículos: quem pergunta por vaga ou manda currículo fica guardado aqui (com o arquivo), | `server.js` | 1 |
| `routes/assinatura-contratada.js` | 88 | Assinatura da empresa (CONTRATADA) nos contratos: a própria pessoa cadastra a imagem da assinatura e autoriza o uso (nunca é desenhada nem imitada). | `server.js` | **0** |
| `routes/controle.js` | 206 | Rotas de CONTROLE das conversas e do atendimento (só administrador): quadros por pessoa, auditoria dos números, envio por número, | `server.js` | **0** |
| `routes/fechamentos.js` | 69 | Rotas do painel de FECHAMENTOS (só administrador): funil depois do orçamento, checklist de acompanhamento, radar de objeções | `server.js` | **0** |
| `routing.js` | 177 | Encaminhamento: a IA fez a peneira no Direct/WhatsApp, o cliente está pronto | `digest.js`, `sectors.js`, `server.js` | 4 |
| `sale-receipts.js` | 92 | Recibo da PARCELA de uma venda/contrato: quando uma parcela é dada como recebida (pelo painel, pela Maria lendo o comprovante ou pelo Pix automático), | `server.js` | 1 |
| `sales-coach.js` | 77 | A Maria como vendedora da equipe: roteiro de venda (o mesmo espírito do atendente de IA) e leitura do CRM para dizer | `maria.js` | 1 |
| `sales.js` | 353 | Contratos e vendas: cada venda fechada (a partir do orçamento), as parcelas com o que já entrou, | `server.js` | 13 |
| `scheduler.js` | 117 | Mensagens agendadas (única vez, diária, semanal ou mensal). | `server.js` | 1 |
| `school.js` | 91 | Migra School: alunos de idiomas, etapa em que estão e frequência de acesso. | `server.js` | 1 |
| `sectors.js` | 159 | Setores do Grupo Migra: cada assunto tem os seus atendentes (cadastrados no painel). | `server.js` | 3 |
| `security.js` | 119 | Segurança do login: verificação em duas etapas (código do app autenticador, padrão TOTP/RFC 6238), | `server.js` | 28 |
| `seller-commands.js` | 147 | Atalhos que o consultor digita no WhatsApp dele, na conversa do cliente. Hoje: "/contrato". | `server.js` | 3 |
| `seller-pipeline.js` | 67 | Pipeline por vendedor: para cada pessoa da equipe (Eliezer, Giovana, Diego, Fran, Marcos…), quem ela está atendendo, quem recebeu orçamento, | `campanhas-funil.js`, `server.js` | 1 |
| `send-profiles.js` | 57 | Configuração de envio POR NÚMERO (principal, Instagram e o WhatsApp de cada vendedor): limite por hora, limite por dia, | `agent/agent.js`, `lead-repair.js`, `messaging-audit.js`, `pending.js`, `routes/controle.js` | 2 |
| `server.js` | 5676 | Servidor HTTP: API REST + painel web + webhook da Meta. | — | **0** |
| `services.js` | 118 | Catálogo de serviços: cada serviço com preço base, prazo, comissão e categoria. | `server.js` | 2 |
| `shopping.js` | 92 | Lista de compras da Ana: cada item vai sozinho para o tipo de loja onde se compra | `ana.js`, `personal.js` | 1 |
| `silence.js` | 98 | Cliente que SUMIU: o sistema chama de volta, como uma pessoa faria. | `pending.js`, `server.js` | 2 |
| `site-content.js` | 90 | Conteúdo editável da página inicial do site (título, números confirmados, vídeos de depoimento e perguntas), | `server.js` | 1 |
| `site-host.js` | 43 | Domínio próprio do site público da Migra (ex.: www.migraparaguay.com): no domínio do site só aparecem | `server.js` | 3 |
| `store.js` | 611 | Banco de dados simples em arquivo JSON (sem dependências nativas). | `server.js` | 16 |
| `support.js` | 135 | Suporte interno: qualquer pessoa da equipe abre um chamado (problema no sistema, dúvida, pedido), | `server.js` | 1 |
| `tasks.js` | 65 | Tarefas da equipe: o que cada pessoa precisa fazer, com prazo e lembrete no WhatsApp (uma vez, no dia do prazo ou quando atrasar). | `server.js` | 1 |
| `transports/cloudapi.js` | 208 | WhatsApp Cloud API (API oficial da Meta): envio via Graph API e recebimento via webhook. | `server.js` | 1 |
| `transports/instagram.js` | 283 | Instagram Direct pela API oficial (Instagram API com login do Instagram). | `connection.js`, `server.js` | 1 |
| `transports/whatsapp-web.js` | 556 | Conexão com o WhatsApp via Baileys (protocolo do WhatsApp Web, sem navegador). | `server.js` | 7 |
| `tunnel.js` | 112 | Endereço na internet (https) para o próprio computador, sem VPS: | `server.js` | 1 |
| `tutorials.js` | 225 | Tutoriais e treinamento semanal. Administrador lê o guia do administrador; vendedor lê só o dele (nunca vê a parte do administrador). | `server.js` | 2 |
| `updater.js` | 120 | Atualização com um clique: baixa a versão mais nova do GitHub e troca só o código. | `server.js` | 1 |
| `usage.js` | 199 | Consumo da IA por escritório (tokens e respostas) e calculadora de preço do serviço. | `server.js` | 1 |
| `utils.js` | 224 | Funções utilitárias compartilhadas pelos módulos. | `affiliates.js`, `agent/agent.js`, `agent/calendar.js`, `ai-stalls.js`, `ana-family.js`, `assistant.js`, `auth.js`, `autoreply.js`, `campaigns.js`, `closing.js`, `crm.js`, `humanize.js`, `legacy-import.js`, `maria-baixa.js`, `maria.js`, `pending.js`, `phone-fix.js`, `quote-request.js`, `quotes.js`, `recordings.js`, `reengage.js`, `scheduler.js`, `sectors.js`, `send-profiles.js`, `server.js`, `transports/cloudapi.js`, `transports/whatsapp-web.js`, `videocalls.js` | 6 |
| `videocalls.js` | 228 | Agenda de videochamadas com a equipe: a IA marca quando o cliente diz que vai falar com marido, esposa ou família. | `server.js` | 1 |
| `visits.js` | 235 | Visitas ao escritório da Migra no Paraguai (consultoria presencial com a equipe). | `server.js` | 3 |
| `voice.js` | 234 | Voz da Nina: clientes HTTP para o serviço de voz local (deploy/voz): faster-whisper entende o áudio | `assistant.js`, `lines.js`, `maria.js`, `server.js` | 3 |

## Migrações de uma vez (selos em `store.js`)
- `central2026`
- `centralFix2026`
- `cnhMemory2026`
- `corretorDiego2026`
- `crisisMemory2026`
- `crisisMemory2026b`
- `flash2026b`
- `flash2026c`
- `flash2026d`
- `flash2026e`
- `flash2026f`
- `groupMemory2026`
- `humanRule2026`
- `lotsGabriel2026`
- `ownerResume2026`
- `pendingDays2026`
- `primePackages2026`
- `rgFix2026`
- `schoolMemory2026`
- `teamRouting2026`
- `techMemory2026`
- `termsMigration2026`
- `triggers2026`
- `workHours2026`

## Scripts do painel (`public/index.html`, na ordem de carga)
- `ui.js`
- `app.js`
- `crm.js`
- `/site/lotgeo.js`
- `realty-admin.js`
- `hub-areas.js`
- `atendentes.js`
- `contratos-antigos.js`
- `retomar.js`
- `executivo.js`
- `site-admin.js`
- `escritorios.js`
- `preco.js`
- `curriculos.js`
- `videochamadas.js`
- `live-admin.js`
- `gravacoes.js`
- `documentos.js`
- `grupos.js`
- `fechamentos.js`
- `enviar-grupos.js`
- `ana-familia.js`
- `campanhas.js`
- `pipeline-vendedores.js`
- `tutoriais.js`
- `cidades.js`
- `marketing.js`
- `cobranca.js`
- `cliente360.js`
- `tarefas.js`
- `auditoria.js`
- `recomecar.js`
- `orcamentos-vencendo.js`
- `conferencia.js`
- `telefone55.js`
- `assinatura-contratada.js`
- `distribuicao.js`
- `horario-ia.js`
- `servicos.js`
- `comissoes.js`
- `suporte.js`
- `projetos.js`
- `indicadores-admin.js`
- `contratos-quadros.js`
- `empresas-apps.js`
- `contabil-painel.js`
- `nav-hubs.js`

## Rotas da API (528)
- `GET /webhook`
- `GET /webhook/instagram`
- `POST /webhook/instagram`
- `POST /webhook`
- `GET /robots.txt`
- `GET /sitemap.xml`
- `GET /api/public/site`
- `GET /imoveis`
- `GET /imoveis/p/:slug`
- `GET /imoveis/l/:slug`
- `GET /parceiros`
- `GET /parceiros/painel`
- `GET /indicacao`
- `GET /imoveis/fotos/:name`
- `GET /r/:code`
- `GET /m/img/:name`
- `GET /api/public/ref`
- `POST /api/public/precadastro`
- `GET /api/public/catalog`
- `GET /api/public/property/:slug`
- `GET /api/public/development/:slug`
- `POST /api/public/interest`
- `GET /migra`
- `GET /motors`
- `GET /school`
- `GET /marcas`
- `GET /live`
- `GET /api/public/live`
- `GET /api/public/vehicles`
- `POST /api/public/lead`
- `POST /api/affiliate/signup`
- `POST /api/affiliate/login`
- `POST /api/affiliate/logout`
- `GET /api/affiliate/me`
- `GET /api/affiliate/qr`
- `PATCH /api/affiliate/me`
- `GET /api/affiliate/extras`
- `POST /api/affiliate/payout`
- `POST /api/affiliate/transfers/:id/:action`
- `POST /api/affiliate/cede`
- `GET /recibo/:id`
- `GET /ficha/:id`
- `GET /etapas/:id`
- `GET /api/public/etapas/:id`
- `GET /termo/:id`
- `GET /termo/:id/pdf`
- `GET /api/public/ficha/:id`
- `POST /api/public/ficha/:id`
- `GET /api/public/termo/:id`
- `POST /api/public/termo/:id/assinar`
- `GET /api/brand`
- `GET /brand/logo`
- `GET /api/auth/state`
- `POST /api/auth/signup`
- `POST /api/auth/setup`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/integrations/:app/users`
- `USE /api`
- `USE /api`
- `GET /api/audit`
- `GET /api/audit.csv`
- `GET /api/reports/:kind.csv`
- `GET /api/me`
- `PATCH /api/me/prefs`
- `GET /api/referral/me`
- `GET /api/referral/qr`
- `GET /api/system/links`
- `GET /api/security/2fa/setup`
- `POST /api/security/2fa/enable`
- `POST /api/security/2fa/disable`
- `POST /api/security/logout-all`
- `POST /api/security/revoke-everyone`
- `GET /api/security/log`
- `POST /api/security/backup`
- `GET /api/security/backup/:name`
- `GET /api/security/backup-key`
- `GET /api/status`
- `GET /api/health/detail`
- `POST /api/health/test-send`
- `POST /api/connection/logout`
- `POST /api/connection/restart`
- `POST /api/connection/pairing-code`
- `POST /api/connection/mode`
- `GET /api/instagram/status`
- `POST /api/instagram/sync`
- `GET /api/instagram/manual`
- `POST /api/instagram/manual/:id/done`
- `GET /api/wa/drops`
- `GET /api/tunnel`
- `POST /api/tunnel/start`
- `POST /api/tunnel/stop`
- `GET /api/connection/info`
- `GET /api/events`
- `GET /api/stats`
- `POST /api/uploads`
- `GET /api/contacts`
- `GET /api/tags`
- `POST /api/contacts`
- `PUT /api/contacts/:id`
- `DELETE /api/contacts/:id`
- `POST /api/contacts/bulk-delete`
- `POST /api/contacts/import`
- `GET /api/contacts/export`
- `POST /api/contacts/check`
- `GET /api/blacklist`
- `POST /api/blacklist`
- `DELETE /api/blacklist/:phone`
- `GET /api/groups`
- `GET /api/groups/:id/coverage`
- `POST /api/groups/:id/import`
- `POST /api/send`
- `GET /api/campaigns`
- `GET /api/campaigns/:id`
- `POST /api/campaigns`
- `POST /api/campaigns/preview`
- `POST /api/campaigns/:id/start`
- `POST /api/campaigns/:id/pause`
- `POST /api/campaigns/:id/cancel`
- `POST /api/campaigns/:id/retry-failed`
- `DELETE /api/campaigns/:id`
- `GET /api/rules`
- `POST /api/rules`
- `DELETE /api/rules/:id`
- `POST /api/rules/test`
- `GET /api/schedules`
- `POST /api/schedules`
- `DELETE /api/schedules/:id`
- `GET /api/settings`
- `PUT /api/settings`
- `GET /api/agent/status`
- `POST /api/agent/enable`
- `POST /api/agent/check`
- `GET /api/agent/presets`
- `POST /api/agent/presets/:id/apply`
- `POST /api/agent/simulate`
- `DELETE /api/agent/simulate/:session`
- `GET /api/agent/stress-tests`
- `POST /api/agent/stress-test`
- `GET /api/agent/prompt`
- `GET /api/attendants`
- `GET /api/sellers-pipeline`
- `GET /api/conversations`
- `GET /api/campanhas`
- `GET /api/campanhas/:id`
- `POST /api/campanhas`
- `POST /api/campanhas/:id/situacao`
- `POST /api/campanhas/:id/escanear`
- `GET /api/group-broadcasts`
- `POST /api/group-broadcasts`
- `POST /api/group-broadcasts/:id/:action`
- `DELETE /api/group-broadcasts/:id`
- `GET /api/declined`
- `POST /api/declined/scan`
- `GET /api/silence`
- `POST /api/silence/run`
- `GET /api/search/conversations`
- `USE /api/conversations/:key`
- `GET /api/conversations/:key`
- `POST /api/conversations/:key/handoff`
- `POST /api/conversations/:key/reply`
- `DELETE /api/conversations/:key`
- `GET /api/pending`
- `POST /api/pending/resume-paused`
- `GET /api/executive`
- `GET /api/offices`
- `GET /api/offices/:id`
- `PUT /api/offices/:id`
- `GET /api/offices-compare`
- `GET /api/pricing`
- `GET /api/usage/summary`
- `GET /api/pricing/history`
- `PUT /api/pricing`
- `GET /api/modules`
- `PUT /api/modules`
- `POST /api/reengage/import`
- `GET /api/reengage`
- `POST /api/reengage/send`
- `PUT /api/reengage/limit`
- `POST /api/reengage/stop`
- `PATCH /api/reengage/:id`
- `PUT /api/reengage/templates`
- `GET /api/site`
- `PUT /api/site`
- `GET /api/documents`
- `POST /api/documents`
- `PUT /api/documents/rules`
- `PATCH /api/documents/:id`
- `DELETE /api/documents/:id`
- `POST /api/documents/:id/restore`
- `GET /api/documents/:id/notice`
- `POST /api/documents/:id/notify`
- `GET /api/tutorials`
- `GET /api/tutorials/:id`
- `POST /api/tutorials`
- `PATCH /api/tutorials/:id`
- `DELETE /api/tutorials/:id`
- `POST /api/tutorials/weekly/run`
- `GET /api/cities`
- `GET /api/cities/:id`
- `POST /api/cities`
- `POST /api/cities/:id/items`
- `PATCH /api/cities/:id/items/:itemId`
- `DELETE /api/cities/:id/items/:itemId`
- `POST /api/cities/:id/import`
- `POST /api/cities/:id/send`
- `GET /api/marketing`
- `PUT /api/marketing/config`
- `POST /api/marketing/sync`
- `GET /api/collections`
- `POST /api/collections/enqueue`
- `DELETE /api/collections/queue`
- `PUT /api/collections/config`
- `GET /api/customers/search`
- `GET /api/customers/duplicates`
- `POST /api/customers/duplicates/merge`
- `GET /api/customers/360`
- `GET /api/services`
- `POST /api/services`
- `PATCH /api/services/:id`
- `GET /api/commissions/me`
- `GET /api/commissions/overview`
- `PUT /api/commissions/levels`
- `POST /api/commissions/recalc`
- `POST /api/withdrawals`
- `POST /api/withdrawals/:id/:action`
- `GET /api/contract-templates`
- `GET /api/contract-templates/:key`
- `POST /api/contract-templates/:key/render`
- `GET /api/team-contacts`
- `GET /api/projects`
- `PUT /api/projects/config`
- `POST /api/projects/invite/:userId`
- `POST /api/projects`
- `GET /api/projects/:id`
- `PATCH /api/projects/:id`
- `POST /api/projects/:id/decide`
- `POST /api/projects/:id/goals`
- `POST /api/projects/:id/results`
- `POST /api/projects/:id/payments`
- `GET /api/support`
- `POST /api/support`
- `GET /api/support/:id`
- `POST /api/support/:id/messages`
- `POST /api/support/:id/resolve`
- `GET /api/tasks`
- `POST /api/tasks`
- `PATCH /api/tasks/:id`
- `DELETE /api/tasks/:id`
- `GET /api/contract-cards`
- `GET /api/alerts`
- `GET /api/recordings`
- `POST /api/recordings`
- `PATCH /api/recordings/:id`
- `DELETE /api/recordings/:id`
- `GET /atendimento`
- `GET /api/links/stats`
- `GET /api/live`
- `PUT /api/live`
- `GET /api/videocall`
- `PUT /api/videocall/config`
- `POST /api/videocall/hosts`
- `GET /api/videocall/me`
- `POST /api/videocall/me`
- `POST /api/videocall/:id/cancel`
- `GET /api/resumes`
- `GET /api/resumes/export.csv`
- `GET /api/resumes/:id/files/:fid`
- `PATCH /api/resumes/:id`
- `DELETE /api/resumes/:id`
- `POST /api/legacy/preview`
- `POST /api/legacy/screen-map`
- `POST /api/legacy/import`
- `POST /api/legacy/ingest/captura`
- `POST /api/legacy/ingest/arquivos`
- `POST /api/legacy/ingest/fim`
- `GET /api/legacy/files/:id`
- `GET /api/legacy/ferramenta.bat`
- `GET /api/legacy/ferramenta-site.bat`
- `GET /api/legacy/audit`
- `POST /api/legacy/apply`
- `POST /api/legacy/purge-noise`
- `GET /api/legacy`
- `GET /api/legacy/export.csv`
- `GET /api/legacy/:id`
- `GET /api/motors/vehicles`
- `POST /api/motors/vehicles`
- `PATCH /api/motors/vehicles/:id`
- `DELETE /api/motors/vehicles/:id`
- `GET /api/motors/lenders`
- `POST /api/motors/lenders`
- `PATCH /api/motors/lenders/:id`
- `DELETE /api/motors/lenders/:id`
- `POST /api/motors/compare`
- `USE /api/school`
- `GET /api/school/summary`
- `GET /api/school/students`
- `POST /api/school/students`
- `PATCH /api/school/students/:id`
- `DELETE /api/school/students/:id`
- `POST /api/school/students/:id/access`
- `GET /api/finance/config`
- `PUT /api/finance/config`
- `POST /api/finance/simulate`
- `POST /api/finance/options`
- `POST /api/finance/proposals`
- `GET /api/finance/proposals`
- `GET /api/finance/proposals/:id/pdf`
- `GET /api/finance/proposals/:id/schedule`
- `POST /api/finance/proposals/:id/paid`
- `POST /api/finance/proposals/:id/cancel`
- `GET /api/finance/report`
- `GET /api/realty/properties`
- `POST /api/realty/properties`
- `PATCH /api/realty/properties/:id`
- `DELETE /api/realty/properties/:id`
- `POST /api/realty/upload`
- `GET /api/realty/developments`
- `GET /api/realty/developments/:id`
- `POST /api/realty/developments`
- `PATCH /api/realty/developments/:id`
- `DELETE /api/realty/developments/:id`
- `POST /api/realty/developments/:id/plan`
- `POST /api/realty/developments/:id/lots`
- `POST /api/realty/developments/:id/lots/bulk`
- `POST /api/realty/developments/:id/block`
- `PATCH /api/realty/developments/:id/lots/:lotId`
- `DELETE /api/realty/developments/:id/lots/:lotId`
- `GET /api/learnings`
- `POST /api/learnings`
- `POST /api/learnings/:id/approve`
- `POST /api/learnings/:id/reject`
- `DELETE /api/learnings/:id`
- `GET /api/affiliates-payouts`
- `POST /api/affiliates-payouts/:id/:action`
- `GET /api/affiliates-transfers`
- `POST /api/affiliates-transfers`
- `POST /api/affiliates-transfers/:id/decide`
- `GET /api/affiliates-groups`
- `PUT /api/affiliates-groups`
- `GET /api/affiliates-materials`
- `POST /api/affiliates-materials`
- `PATCH /api/affiliates-materials/:id`
- `GET /api/affiliates`
- `GET /api/affiliates-meta`
- `PATCH /api/affiliates/:id`
- `GET /api/affiliates-commissions`
- `POST /api/affiliates-commissions/:id/paid`
- `POST /api/affiliates-commissions/:id/cancel`
- `GET /api/payments`
- `POST /api/payments`
- `POST /api/payments/:id/confirm`
- `POST /api/payments/:id/cancel`
- `POST /api/payments/:id/resend`
- `GET /api/payments/:id/qr`
- `GET /api/payments/:id/proof`
- `GET /api/payments/:id/receipt`
- `GET /api/lines`
- `POST /api/lines`
- `GET /api/voice-sample`
- `PATCH /api/lines/:id`
- `DELETE /api/lines/:id`
- `POST /api/lines/:id/restart`
- `POST /api/lines/:id/logout`
- `POST /api/lines/:id/pairing-code`
- `POST /api/pending/reply`
- `POST /api/pending/cancel`
- `POST /api/pending/dismiss`
- `GET /api/update/check`
- `POST /api/update`
- `GET /api/users`
- `POST /api/users/:id/unlock`
- `POST /api/users`
- `PATCH /api/users/:id`
- `POST /api/users/:id/approve`
- `POST /api/users/:id/reject`
- `POST /api/users/:id/transfer`
- `GET /api/crm/stages`
- `GET /api/leads`
- `POST /api/leads`
- `POST /api/leads/from-conversation`
- `GET /api/leads/:id`
- `PATCH /api/leads/:id`
- `POST /api/leads/:id/notes`
- `POST /api/leads/:id/followup`
- `POST /api/leads/:id/assign`
- `POST /api/leads/:id/ai`
- `GET /api/closing/template`
- `GET /api/leads/:id/closing`
- `POST /api/leads/:id/closing`
- `POST /api/payments/calc`
- `POST /api/leads/:id/payplan`
- `GET /api/handoffs/digest`
- `POST /api/handoffs/digest`
- `GET /orcamento/:id`
- `POST /api/closing/link`
- `GET /api/quotes`
- `POST /api/quotes/:id/reactivate`
- `POST /api/quotes/preview`
- `POST /api/quotes`
- `GET /api/quotes/:id/contract-data`
- `POST /api/contract/extract`
- `POST /api/quotes/:id/contract`
- `POST /api/quotes/:id/contract/sign-link`
- `GET /reservar/:id`
- `GET /orcamento-dados/:id`
- `GET /api/public/orcamento-dados/:id`
- `POST /api/public/orcamento-dados/:id`
- `GET /contrato/:id`
- `GET /api/public/contrato/:id`
- `GET /api/public/contrato/:id/pdf`
- `POST /api/public/contrato/:id/assinar`
- `GET /api/quotes/:id/contract.pdf`
- `GET /api/conversations/:key/closing`
- `POST /api/conversations/:key/closing/:action`
- `GET /api/sales`
- `GET /api/sales/summary`
- `GET /api/sales/:id`
- `POST /api/quotes/:id/sale`
- `POST /api/sales/:id/parcel/:index`
- `POST /api/sales/:id/parcel/:index/claim`
- `GET /api/sales/:id/parcel/:index/receipt`
- `POST /api/sales/:id/parcel/:index/receipt`
- `POST /api/sales/:id/commission`
- `POST /api/sales/:id/seller`
- `POST /api/sales/:id/cancel`
- `USE /api/cash`
- `GET /api/cash`
- `GET /api/cash/export.csv`
- `USE /api/cash/assistant`
- `GET /api/portfolio`
- `POST /api/portfolio`
- `DELETE /api/portfolio/:id`
- `GET /api/ana`
- `PUT /api/ana`
- `GET /api/ana/family`
- `POST /api/ana/family`
- `DELETE /api/ana/family/:id`
- `GET /api/maria`
- `PUT /api/maria`
- `GET /api/cash/assistant`
- `POST /api/cash/assistant/test`
- `PUT /api/cash/assistant`
- `GET /api/cash/:id/history`
- `POST /api/cash`
- `PATCH /api/cash/:id`
- `DELETE /api/cash/:id`
- `PUT /api/cash/settings`
- `USE /api/migratech`
- `GET /api/migratech`
- `POST /api/migratech/:list`
- `PATCH /api/migratech/:list/:id`
- `DELETE /api/migratech/:list/:id`
- `POST /api/migratech-withdrawals`
- `USE /api/contabil`
- `GET /api/contabil`
- `POST /api/contabil/:list`
- `PATCH /api/contabil/:list/:id`
- `DELETE /api/contabil/:list/:id`
- `PUT /api/contabil-ruc-days`
- `GET /api/app-signups/:app`
- `POST /api/app-signups/:app/key`
- `DELETE /api/app-signups/:app/key`
- `PUT /api/sales/cutoff`
- `PUT /api/sales/settings`
- `GET /api/quotes/:id/pdf`
- `GET /api/visits`
- `POST /api/visits/:id/forward`
- `GET /api/visits/fee-notice`
- `POST /api/visits/fee-notice/send`
- `POST /api/visits/:id/refunded`
- `POST /api/visits/:id/confirm`
- `POST /api/visits/:id/reschedule`
- `POST /api/visits/:id/cancel`
- `POST /api/visits/:id/done`
- `POST /api/leads/:id/confirm`
- `DELETE /api/leads/:id`
- `GET /api/followups/reconfirm`
- `POST /api/followups/reconfirm`
- `GET /api/crm/agenda`
- `POST /api/followups/reconcile-overdue`
- `POST /api/leads/:id/contact-decision`
- `GET /api/crm/handoffs`
- `GET /api/crm/stats`
- `GET /api/demo`
- `POST /api/demo`
- `DELETE /api/demo`
- `GET /api/crm/ranking`
- `POST /api/brand/logo`
- `DELETE /api/brand/logo`
- `GET /api/crm/insights`
- `POST /api/crm/insights`
- `GET /api/appointments`
- `GET /api/agenda/slots`
- `POST /api/appointments`
- `POST /api/appointments/:id/cancel`
- `GET /api/logs`
- `DELETE /api/logs`
- `USE /api`
- `GET /api/contract-signers`
- `GET /api/conversations-boards`
- `GET /api/health/data`
- `POST /api/leads-repair`
- `GET /api/directory`
- `GET /api/ai-stalls`
- `GET /api/phones-fix`
- `POST /api/phones-fix`
- `GET /api/reconcile`
- `POST /api/reconcile/archive`
- `POST /api/reconcile/restore`
- `GET /api/quotes-expiring`
- `POST /api/quotes-expiring/notify`
- `POST /api/restart-stalled`
- `GET /api/atendimento/plano`
- `POST /api/atendimento/comecar`
- `POST /api/atendimento/pausa`
- `GET /api/maria-receipts`
- `GET /api/distribution`
- `GET /api/audit/messaging`
- `GET /api/send-profiles`
- `PUT /api/send-profiles/:key`
- `GET /api/fechamentos`
- `GET /api/plano-pdf`
- `POST /api/plano-pdf`
- `GET /api/flash-offer`
- `POST /api/flash-offer/claims/:id/:action`
- `POST /api/flash-offer/count-groups`
- `GET /api/flash-offer/legenda`
