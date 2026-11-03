# Estudo: sistema antigo (prints) x nosso sistema x grandes CRMs

Base do estudo: os prints que você mandou nesta conversa (49 imagens vistas por mim: Documentos, Orçamentos, Gerador de contrato, Serviços, Reunião ao vivo, Reuniões gravadas, Prospecção de leads, Financeiro, Cobrança, Caixa & Despesas, Comissões, Saques, Contabilidade, Relatórios, Modelos, Marketing, Auditoria de vendas, Auditoria, Guia de Cidades, Tutoriais, Curso, Despachante) e o que você descreveu por escrito e por áudio. Os prints de conversas anteriores eu conheço pelo resumo, não os revi um a um.

Sobre os CRMs do GitHub: consegui **ler o código do Twenty** (`twentyhq/twenty`, licença AGPL: serve para estudar as ideias, **não vamos copiar código**). Dos demais (HubSpot, Pipedrive, Salesforce, Zoho, Odoo, EspoCRM, SuiteCRM, Chatwoot, n8n, Metabase) uso o que conheço de uso geral, **sem ter lido o código deles**.

## 1. Tela por tela: onde estamos

| Tela do sistema antigo | O que o antigo tem | Nosso sistema hoje | O que fazer |
|---|---|---|---|
| Dashboard / Painel | Totais do mês | **Painel executivo** (hoje, semana, mês, ano; cobranças e vencimentos) | Mais completo: manter. Falta gráfico de projeção de recebimento por mês |
| Distribuição de leads, Leads Quiz, Cadastro no site, Leads do grupo | Fila de leads, quiz, formulário, grupo | Retomar contatos, formulário do site, **Grupos do WhatsApp** (atendidos x não atendidos) | Falta fila de distribuição com meta por vendedor; quiz passa a entrar pelo nosso site |
| Clientes | Cadastro de clientes | Clientes copiados no CRM | Falta a **ficha única (360)**: contratos, parcelas, conversas, arquivos e documentos juntos |
| Contratos / Gerador | 314 links públicos, wizard, status jurídico (assinado / aguardando) | Contrato com assinatura no celular, modelo aprovado pelo Marcos | Falta lista de links gerados com validade e status; modelos Migra Med, Migra Brasil e RUC (preciso do texto) |
| Processos | Kanban e lista (Iniciado, Em análise, Cancelado), valor, pago, próximo prazo | Cópia lê a lista e leva para Vendas | Falta etapa do processo (funil pós-venda) com prazo |
| Documentos | 8 tipos, emissão, 1º aviso, renovação, entrega, responsável | **Aba Documentos** com aviso de renovação (só envia se clicar) | Falta conferir o leitor com os dados reais |
| Orçamentos | 7 dias, rascunho, vendedor | Orçamento 7 dias, **desativado** depois, reativar, IA reconhece cliente antigo | Pronto. Melhoria: lembrete automático no dia 5 |
| Serviços | 51 serviços, preço base, prazo, comissão %, categoria | Pacotes fixos da base | **Falta catálogo de serviços editável** (preço, prazo, comissão) usado em orçamento e contrato |
| Financeiro | Total a receber, recebido, em aberto; Receber, Débito, Histórico por contrato | Contratos e vendas (parcelas, confirmar recebimento), painel | Falta "Débito" (acréscimo/multa) e histórico por contrato em uma tela |
| Cobrança / Vencimentos | 617 parcelas, vencidas, mês, próximas, Baixa | Cópia agora lê a Cobrança e leva as datas reais | Falta **cobrança automática com aprovação** (mensagem gentil + Pix/cartão) |
| Caixa & Despesas / Contabilidade | Entradas, saídas, saldo; contabilidade separada | Caixa (só administradores), cópia do caixa antigo | Falta caixa da contabilidade separado e categorias de despesa fixas |
| Comissões / Saques | Comissão por nível do vendedor, pendente x liberada, solicitações de saque | Comissões por venda, só liberada quando o recebimento é confirmado | **Falta o saque**: vendedor pede, administrador aprova e marca pago; níveis por meta do mês |
| Relatórios | Projeção, financeiro, contratos, pagamentos, desativados | Painel executivo | Falta exportar CSV por período e relatório de contratos desativados |
| Auditoria / Auditoria de vendas | Quem criou/alterou, por tipo | **Auditoria** (quem, o quê, quando, IP) | Falta filtro por tipo e exportar CSV |
| Marketing (Direção) | Campanhas, funil impressões→contratos (zerado) | **Aba Marketing** com os números da Meta e custo por venda | Falta ligar com a conta real; funil completo até o contrato |
| Prospecção (Apify) | Busca empresários no Google/Instagram | Não fazemos | Deixar de fora (risco de bloqueio e spam) |
| Reunião ao vivo / Gravadas | Abre Google Meet | **Live** (página pública), **Videochamadas** (agenda), **Reuniões gravadas** | Pronto |
| Guia de Cidades | Cadastro vazio | **Guia de Cidades** com 45 cidades e envio ao cliente | Falta levantar os contatos reais de cada cidade |
| Tutoriais / Curso | Vazio / 13 aulas do YouTube | **Tutoriais** + treinamento semanal por IA | Falta trazer as 13 aulas para o School |
| Despachante | 0 processos | Não fazemos | Sem dados: deixar de fora |

## 2. O que as grandes empresas fazem (e o que aprendi lendo o Twenty)

No código do Twenty, a **oportunidade** tem: valor, data de fechamento prevista, etapa, dono, pessoa de contato e empresa. O mais importante: **tarefas, notas, anexos, mensagens e reuniões se ligam ao mesmo registro**, e tudo cai em uma **linha do tempo única**. Ou seja, a "ficha 360" é o centro do sistema. Os fluxos de automação têm **gatilhos** (evento no banco, manual, horário, webhook) e **ações** (criar ou alterar registro, enviar e-mail, chamar uma URL, perguntar a um formulário, rodar um agente de IA, condição, esperar).

O que os líderes têm em comum (conhecimento geral):
- **HubSpot / Pipedrive**: previsão de vendas por etapa (valor x probabilidade), meta por vendedor com placar, sequência automática de acompanhamento, e-mail e WhatsApp dentro da ficha.
- **Salesforce / Zoho**: regras de distribuição de leads, aprovação de desconto, campos por segmento.
- **Odoo / EspoCRM / SuiteCRM**: cotação que vira pedido e fatura; permissões por equipe.
- **Chatwoot**: caixa de entrada com etiquetas, nota interna, respostas prontas, tempo de primeira resposta.
- **n8n / Metabase**: automações sem programar e painéis que a própria equipe monta.

## 3. Onde já somos melhores
- **IA que fecha venda no WhatsApp de cada vendedor**, com a memória da conversa anterior e link de cartão com taxa por conta do cliente.
- **Videochamada só para quem tem condições**, para não gastar tempo da equipe.
- **Treinamento semanal por IA** com os números da própria equipe e aviso no WhatsApp.
- **Recebimento confirmado só pelo administrador**; o vendedor só avisa.
- **Dois escritórios** (Paraguai e Paraná) no mesmo sistema, com a IA de cada um.
- **Custo da IA por escritório** medido, para calcular o preço do serviço.

## 4. Roteiro para ficar à frente (por ordem de ganho)
1. **Ficha 360 do cliente** com linha do tempo única (contrato, parcelas, conversas, documentos, tarefas). É o que mais ajuda quem atende.
2. **Cobrança automática de vencidos**: lista dos 328 atrasados, mensagem gentil por faixa de atraso, Pix ou link de cartão, **com a sua aprovação** e limite diário.
3. **Catálogo de serviços** (preço, prazo, comissão) e **comissão por nível** com **saques**.
4. **Tarefas e lembretes da equipe** (inclui os retornos combinados), com aviso no WhatsApp.
5. **Previsão de recebimento** por mês e **meta por vendedor** com placar (já temos o Ranking).
6. **Duplicados**: juntar o mesmo cliente repetido (telefone, documento, nome).
7. **NPS** depois do contrato concluído (número real de satisfação para o site).
8. **Automações configuráveis** no estilo "gatilho e ação", começando pelas que você já pediu (orçamento vencido, documento a renovar, aviso de treinamento).
9. **Portal do cliente** (ver contrato e parcelas, pagar, enviar documentos).
10. **Privacidade**: consentimento, exportar e apagar os dados de uma pessoa.

## 5. Cuidados
- Não copiar código de projetos com licença AGPL (Twenty, SuiteCRM): só ideias.
- Tudo que manda mensagem a cliente em massa (cobrança, retomada) continua com **aprovação** e limite diário, por causa do risco de bloqueio do número.
- Chaves (Meta, Mercado Pago, IA) só no painel, nunca no chat.
