# Lacunas do nosso CRM e plano de melhoria

> Comparação de recursos com o que os CRMs de código aberto e os apps de atendimento mais usados costumam oferecer (por exemplo Twenty, EspoCRM, SuiteCRM, Odoo CRM e Chatwoot). Serve de inspiração de **funções**: não copiamos código. Antes de reaproveitar qualquer código de GitHub, confira a licença (algumas, como a AGPL, obrigam a abrir o seu código).

## O que já temos
Funil de prospectos com histórico e retornos, conversas de WhatsApp com IA e passagem para a equipe, orçamentos, contratos com assinatura no celular, vendas com parcelas e comissões, Pix e recibo, caixa, ranking e metas, auditoria, escritórios separados (Paraguai e Paraná), indicadores (afiliados), sites por marca, retomada de contatos, painel executivo, importação do sistema antigo e banco de currículos.

## O que falta (por prioridade)
| # | Função | Por que importa | Esforço |
|---|--------|-----------------|---------|
| 1 | **Cobrança de vencidos** (mensagem gentil, Pix, boleto, histórico de cobrança) | Recupera dinheiro parado, já temos os atrasos importados | Médio |
| 2 | **Ficha única do cliente (visão 360)**: contratos, parcelas, conversas, arquivos e documentos juntos | Quem atende vê tudo sem procurar | Médio |
| 3 | **Duplicados**: achar e juntar o mesmo cliente repetido (telefone, documento, nome) | A importação trouxe milhares de cadastros | Pequeno |
| 4 | **Tarefas e agenda da equipe** (separadas do retorno do prospecto), com lembrete no WhatsApp | Nada se perde | Médio |
| 5 | **Etapas do funil e campos personalizados por empresa** | Contabilidade, Motors e School terão funis próprios | Médio |
| 6 | **Caixa de entrada de atendimento**: etiquetas, respostas prontas, nota interna, tempo de primeira resposta | Qualidade e velocidade de atendimento | Médio |
| 7 | **Pesquisa de satisfação (NPS)** depois do contrato concluído | Número real de satisfação para o site | Pequeno |
| 8 | **Automações configuráveis** (se acontecer X, fazer Y), sem programar | A equipe monta sozinha | Grande |
| 9 | **Portal do cliente** (ver contrato, parcelas, pagar Pix, enviar documentos) | Menos atendimento repetitivo | Grande |
| 10 | **Privacidade (LGPD e lei paraguaia)**: registro de consentimento, exportar e apagar dados de uma pessoa | Proteção legal | Pequeno |
| 11 | **Webhooks e chaves de integração** | Ligar outros sistemas das empresas do grupo | Pequeno |
| 12 | **Aplicativo instalável (PWA) com notificações** | Equipe no celular | Médio |
| 13 | **Contabilidade com faturamento eletrônico (SIFEN)** | Nova empresa do grupo | Grande |
| 14 | **Marketing**: calendário de posts com aprovação, publicação e anúncios com teto de gasto | Equipe de IA de marketing | Grande |

## Ordem sugerida
1. Cobrança de vencidos (2) e ficha única do cliente (3), porque usam o que acabou de ser importado.
2. Duplicados e pesquisa de satisfação (rápidos e de muito valor).
3. Tarefas, caixa de entrada e funis por empresa.
4. Portal do cliente, automações, contabilidade e marketing.
