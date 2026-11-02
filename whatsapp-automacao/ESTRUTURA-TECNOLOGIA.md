# Separação da tecnologia e das empresas (roteiro para sócios e advogado)

> Documento de organização técnica e de negócio. **Não é parecer jurídico nem contábil.** Todos os pontos de contrato, tributo e regulação precisam ser validados por advogado e contador, no Paraguai e no Brasil.

## 1. A ideia em três camadas
1. **Tecnologia (a plataforma).** O Migra Hub: código, automação de WhatsApp, IA de atendimento, CRM, contratos, painel executivo, site, integrações. É o ativo que vocês constroem e em que o Manderson tem participação como sócio minoritário.
2. **Empresas que usam a tecnologia.** Migra Paraguai, Migra Paraná, Imobiliária, Motors, School, a futura Contabilidade e a futura Exchange. Cada uma com CNPJ ou RUC próprio, equipe, clientes, contas e responsabilidade legal próprios.
3. **Serviços compartilhados.** Domínios, servidor (VPS), contas de Meta e Google, atendimento comum. Quem paga e quem é dono de cada um deve estar escrito.

Regra de ouro: **a tecnologia é de quem a criou e é licenciada às empresas; os dados dos clientes são de cada empresa.**

## 2. O que já existe no código e ajuda nessa separação
- **Escritórios (Paraguai e Paraná):** cada equipe só vê o seu; o administrador geral vê os dois. É o primeiro passo para tratar cada empresa como uma "unidade" separada da plataforma.
- **Auditoria:** quem criou, alterou ou excluiu o quê, com antes e depois.
- **Módulos em standby:** liga e desliga partes do sistema por necessidade.
- **Histórico no Git:** cada alteração tem autor e data. Serve de prova de quando e por quem a tecnologia foi criada. **Não apagar nem reescrever esse histórico.**

## 3. O que falta construir (ordem sugerida)
1. **Empresas em vez de só escritórios:** trocar a lista fixa (Paraguai e Paraná) por uma lista de empresas configurável, cada uma com domínio, WhatsApp, IA, equipe, dados e cobrança próprios.
2. **Medição de uso por empresa:** usuários ativos, conversas, clientes novos, contratos e mensagens. É a base para qualquer cobrança de licença ou participação, sem discussão de números.
3. **Dois níveis de administrador:** administrador da plataforma (tecnologia) e administrador da empresa. A tecnologia não precisa ver dados de clientes de uma empresa sem autorização dela.
4. **Contabilidade (módulo novo):** plano de contas, lançamentos, conciliação, impostos e **faturamento eletrônico paraguaio (SIFEN/DNIT)**. Esse é o requisito central de um sistema contábil no Paraguai.
5. **CRM e gestão por segmento:** reaproveitar o núcleo (clientes, funil, contratos, financeiro) e criar telas por segmento.
6. **Exchange e banco digital:** só depois da parte regulatória (item 5 abaixo).

## 4. Propriedade e licença da tecnologia (pontos para o advogado)
- **Quem é o titular do código?** Hoje ele está no repositório pessoal do Manderson. Definir se vai para uma **empresa de tecnologia** (com os sócios e percentuais combinados) e fazer a **cessão formal** do que já foi criado.
- **Licença às empresas operacionais:** contrato de licença de uso entre a empresa de tecnologia e cada empresa (Migra Paraguai, Contabilidade etc.), com o modelo de remuneração: mensalidade fixa, percentual sobre receita, por usuário ou misto.
- **Participação do sócio minoritário:** percentual, direitos (informação, voz em decisões de tecnologia), diluição, saída (venda das cotas, recompra, avaliação).
- **Dados e privacidade:** os dados de clientes pertencem à empresa operacional; a tecnologia é operadora desses dados. Prever contrato de tratamento de dados (LGPD no Brasil e as regras de proteção de dados do Paraguai).
- **Código feito com ajuda de inteligência artificial:** confirmar com o advogado a titularidade e os termos das ferramentas usadas.
- **Segredos e acessos:** nunca ficam no código. Contas de Meta, Google, banco e servidor devem estar no nome da empresa certa, com mais de um responsável.
- **Escrow e continuidade:** cópia do código em local seguro, com regra para o caso de saída ou desacordo entre sócios.

## 5. Exchange (câmbio) e banco digital: atenção regulatória
- Atividade de câmbio, guarda de dinheiro de terceiros, cartão e saque é **atividade financeira regulada**. No Paraguai envolve o **Banco Central do Paraguai (BCP), a Superintendência de Bancos e a SEPRELAD (prevenção à lavagem de dinheiro)**, com autorização prévia, capital mínimo, identificação de clientes (KYC) e reporte de operações suspeitas.
- **Transferir capital e patrimônio de clientes para outro país (o texto falava em Bolívia; confirmar se era Paraguai) sem autorização e sem comprovar a origem do dinheiro pode ser crime** para a empresa e para os sócios. Não construir nem testar nada que mova dinheiro de clientes antes de ter licença e parecer jurídico.
- Caminho seguro: começar como **parceiro tecnológico de instituição já licenciada** (banco, casa de câmbio ou instituição de pagamento autorizada), ou obter a licença própria com assessoria especializada. A tecnologia pode entrar como o aplicativo e o CRM, e a instituição licenciada como a responsável pelo dinheiro.

## 6. Perguntas que os sócios precisam responder
1. Qual será a empresa dona da tecnologia (nome, país, sócios e percentuais)?
2. Como ela será paga pelas empresas que usam: mensalidade, percentual ou os dois?
3. O que é considerado "criado a partir de nós" (módulos novos para outras empresas, segmentos, marca própria)?
4. A Contabilidade e a Exchange serão empresas separadas? Quem são os sócios de cada uma?
5. Qual advogado e qual contador cuidarão do Paraguai e do Brasil?
