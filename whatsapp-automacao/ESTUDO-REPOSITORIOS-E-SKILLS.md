# Estudo: repositórios, skills e conectores do dossiê (05/11/2026)

Este estudo responde ao dossiê "Comparativo de skills, GitHub e MCPs". Ele é **análise**: nada foi instalado, conectado, publicado ou enviado. Qualquer adoção depende de decisão do Marcos e do Manderson.

## 1. O que foi (e o que não foi) estudado

- **Estudados com leitura da página pública do repositório (8):** Comp AI CRM, Frappe CRM, Postiz, n8n-MCP, Kapso (WhatsApp Cloud API), Impeccable, Anthropic Skills e Semgrep. Os números (estrelas, licença) são os que a página mostrou em 05/11/2026 e podem mudar.
- **Experimento local (Semgrep):** instalei o Semgrep só no ambiente de trabalho e rodei 10 regras de segurança escritas por mim no código do Migra Hub. O catálogo oficial de regras do Semgrep estava bloqueado pela rede, então **não é uma auditoria completa**. Resultado: 16 pontos para olhar, **nenhum problema real** (ver seção 4).
- **Não estudados (cerca de 75 itens):** o dossiê tem 85 referências. Eu não li as demais e não vou afirmar nada sobre elas. Priorize o que o negócio pedir.
- **Twenty CRM** já foi estudado em outra etapa (`ESTUDO-MELHORIAS.md`).
- **Itens sem repositório confirmado** (o dossiê já avisa): Colibrì, nexos-shared-memory, "Replic", Elmo, GEO-AEO Tracker, Atoms.dev, DeepSeek Superagent. Não vou procurar "parecidos": instalar uma imitação é risco.

## 2. O que o Migra Hub já tem (evidência no código)

CRM com funil, retornos, ficha 360 e duplicados; atendente de IA (WhatsApp e Instagram) com memória e transferência para humano; WhatsApp pelo número do consultor (conexão por QR) e também pela API oficial (Cloud API); orçamento, contrato com assinatura no celular, ficha de dados; cobrança com aprovação e limite diário; comissões com Jornada do Consultor e saques; indicadores com escritório virtual; catálogo de serviços; suporte com prazo; projetos e sócios; atalhos no WhatsApp; auditoria e planilhas; site público e painel por escritório. As automações estão **no próprio código** (não existe n8n).

## 3. Quadro comparativo (modelo do dossiê)

| Frente | Já existe no Migra | Lacuna comprovada | Referência | Decisão sugerida | Licença e risco | Confiança |
|---|---|---|---|---|---|---|
| CRM com agente | CRM próprio completo e agente que lê a conversa e preenche o CRM | Ainda não registra **evidência** de cada informação nem "reconfere" um dado antigo | Comp AI CRM (MIT) | **Pegar ideias, não o código.** Stack diferente (Bun, Vercel, Next, NestJS, Postgres); trocar o CRM jogaria fora o que já funciona | MIT permite estudo e uso. Risco: migração e custo de operar outra base | Alta |
| CRM visual | Funil, lista e ficha 360 | Visão Kanban com arrastar e soltar e "visões salvas" por usuário | Frappe CRM (AGPL-3.0) | **Só referência de usabilidade.** Não copiar código | AGPL: código copiado obriga abrir o nosso. Uso interno separado é possível, mas não é o caso | Alta |
| Redes sociais | Material para indicadores e retomada de contatos; **não publica** nem agenda posts | Calendário e publicação em Instagram, Facebook, TikTok, YouTube | Postiz (AGPL-3.0) e Metricool | **Complementar, como serviço separado** e só com as contas da própria Migra. Decisão humana | AGPL (rodar sem alterar para uso próprio é tranquilo; alterar e oferecer a terceiros obriga publicar). Exige Postgres, Redis e armazenamento. Conta de Instagram em recurso de bloqueio: priorizar API oficial | Média |
| Automações | Tudo no código (timers, atalhos, filas) | Fluxos que a equipe monte sem programar | n8n-MCP (MIT) | **Descartar por ora.** Só faz sentido se adotarem o n8n, que não usam | MIT. O próprio projeto avisa para não editar fluxo de produção com IA e oferece modo somente leitura | Alta |
| WhatsApp oficial | Cloud API conectada; envio, webhook e assinatura | Gestão de **templates** (modelos aprovados) e botões/carrossel para falar fora da janela de 24h | Kapso SDK (MIT, TypeScript) | **Estudar a fundo antes de decidir.** Útil para retomada de contatos. O que ele faz de melhor que o nosso cliente HTTP não está claro na página | MIT. Maturidade não informada na página | Média |
| Qualidade visual (front-end) | Visual atual dourado/escuro, sem verificação automática | Checagem de acessibilidade, espaçamento, responsivo e "cara de IA" | Impeccable (Apache-2.0) | **Boa candidata para a fase do front-end.** Roda localmente sobre HTML (`detect` em pasta ou URL, 62 regras, auditoria P0 a P3) | Instala por `npx` (código de terceiros): rodar só com autorização e em ambiente isolado | Alta |
| Skills próprias | O conhecimento da atendente está no código | Conhecimento versionado em texto simples, editável pela equipe | Anthropic Skills (Apache-2.0; docx/pdf/pptx/xlsx são "source-available", não livres) | **Adotar o formato**: uma pasta com `SKILL.md` (nome, descrição, instruções) para cada fluxo da Migra | Apache-2.0. Cuidado com as partes não livres | Alta |
| Segurança do código | Testes de segurança próprios e `SEGURANCA.md` | Varredura estática sistemática | Semgrep (LGPL-2.1) | **Complementar.** Roda local, sem enviar código. Regras da comunidade (2.000+) no CI | LGPL no motor. Regras "Pro" são pagas e proprietárias | Alta |

## 4. Semgrep no Migra Hub: o que apareceu

Regras: comando de sistema com texto montado, eval/new Function, hash fraco, TLS desligado, Math.random, caminho de arquivo vindo do pedido, redirecionamento aberto, RegExp com dado de fora.

- **Comando de sistema (3):** abrir o navegador com o endereço local (`server.js`), o túnel (`tunnel.js`) e o conversor de áudio (`voice.js`). Os argumentos são fixos ou vêm da configuração do servidor, nunca de cliente. Sem risco real.
- **Hash fraco (2):** SHA-1 só para dar nome a arquivos nos programas de cópia. Não é segurança.
- **Math.random (11):** pausas entre mensagens, sorteio de saudação, códigos públicos de cliente (MIG-XXXX) e de indicador, número de proposta (a proposta só abre com login). Nenhum é senha, token ou chave. Os segredos usam `crypto`.
- **Sem achados:** eval, TLS desligado, caminho de arquivo ou redirecionamento vindos do pedido, RegExp com dado de fora.

Limite: 10 regras minhas. Para cobertura de verdade, rodar as regras da comunidade (precisa de acesso ao catálogo do Semgrep).

## 5. Ideias que valem aproveitar (sem copiar código)

1. **Evidência em cada dado do cliente** (Comp AI): guardar de onde veio ("disse no WhatsApp em 03/11", "veio do contrato") e nunca "chutar" quem a pessoa é. Combina com as regras de não inventar.
2. **Reconferência agendada** (Comp AI `schedule_recheck`): lembrar de checar de novo um dado que muda (por exemplo, documento a renovar). Já temos avisos de renovação; falta ligar à ficha.
3. **Permissões "somente leitura" por ferramenta** (Comp AI e n8n-MCP): hoje a atendente tem ferramentas de enviar e de consultar misturadas. Separar reduz o risco de erro.
4. **Templates do WhatsApp e botões** (Kapso): para falar com quem está fora da janela de 24h e para respostas por botão.
5. **Skills em texto** (Anthropic): mover regras de venda e atendimento para arquivos `SKILL.md` versionados, que o administrador entende e revisa.
6. **Auditoria visual automática** (Impeccable): checar acessibilidade e responsivo antes de publicar cada site.

## 6. O que NÃO fazer

- Trocar o CRM próprio por Comp AI, Twenty ou Frappe: o ganho não está demonstrado e a migração é cara.
- Usar OpenWA: já descartado no dossiê.
- Instalar n8n-MCP, Postiz ou qualquer MCP sem decisão humana, conta autorizada e permissão mínima.
- Copiar código AGPL (Frappe CRM, Postiz) para dentro do Migra Hub.
- Coletar dados de concorrentes por raspagem. A biblioteca pública de anúncios mostra criativos, não conversão nem gasto de terceiros.

## 7. Atenção ao próprio sistema

O WhatsApp dos consultores usa conexão por QR Code (não oficial), que tem risco de bloqueio do número se houver volume ou denúncias. A API oficial (Cloud API) já existe no código e é o caminho para o número central de atendimento e para mensagens ativas. Os templates do Kapso ajudam nesse caminho.

## 8. Decisões humanas pedidas

1. Aprovar a **fase de front-end com Impeccable** (rodar só em ambiente isolado e sobre os nossos HTML)?
2. Aprovar o **formato de skills** (`SKILL.md`) para as regras de venda da atendente?
3. Estudar o **Kapso e os templates do WhatsApp** a fundo para a retomada de contatos?
4. Querem **publicação em redes** (Postiz ou Metricool)? Com qual conta e quem aprova cada post?
5. Quais dos outros ~75 itens do dossiê devo estudar em seguida? Sugestão de ordem: Twenty (já visto), Metricool, Playwright, Lighthouse e Formance Ledger (caixa).
