# Migra Negócios: contexto do projeto

Documento de passagem. Reúne tudo o que foi construído e decidido no projeto "Migra Automação" (Migra Hub) e a visão da plataforma "Migra Negócios". Anexe este arquivo e o `whatsapp-automacao/SEGURANCA.md` como contexto do projeto. Data de referência: 30/10/2026.

> Este documento não contém nem deve conter senhas, códigos ou chaves. Veja `CLAUDE.md`.

---

## 1. A empresa

- **Grupo Migra**, fundado por **Marcos Miguel**, que mora e trabalha no Paraguai. Escritório em **Santa Rita, Alto Paraná**. Instagram: **@migraparaguayassessoria** (mais de 239 mil seguidores). Os depoimentos ficam nos destaques "Clientes".
- **Empresas do grupo:**
  - **Migra Paraguai Assessoria**: residência, cédula, RUC, licença de condução, abertura de empresa (7 pacotes) e outros temas migratórios.
  - **Migra Imobiliária**: compra, venda e aluguel. É a responsável pelos investimentos e pela venda dos lotes. Atua em Santa Rita e no Loteamento Novo Brasil, em Hernandarias.
  - **Migra Motors**: compra, venda, intermediação e importação de veículos dos EUA para o Paraguai.
  - **Migra Contabilidade**: abertura de empresa, RUC e contabilidade.
  - **Migra Soluções Empresariais e Financeiras**.
  - **Migra School** (em lançamento): espanhol por aplicativo, com valor acessível para clientes.
- **Recebimento:** Pix da **Migra Paraguai Assessoria LTDA**, CNPJ **58.521.546/0001-78** (chave Pix: o CNPJ).
- **Frase institucional:** "Seu projeto no Paraguai começa aqui!"

### Pacotes (valores por pessoa)

| Pacote | Inclui | Valor |
| --- | --- | --- |
| Inicial | Residência precária, admissão temporária e cédula | R$ 10.997 |
| Prata | Cédula + RUC | R$ 11.997 |
| Ouro | Cédula + RUC + licença (carro **ou** moto) | R$ 12.997 |
| Empresa Unipersonal | Ouro + empresa unipersonal | R$ 17.997 |
| Empresa EAS | Ouro + EAS | R$ 20.997 |
| Empresa S.A. | Ouro + S.A. | R$ 25.997 |
| Estudantil | Admissão Temporária Mercosul (sem cédula) | R$ 5.997 |

### Pagamento

- **Entrada na reserva:**
  - **R$ 1.000** de sinal de contratação dos serviços;
  - **R$ 800 por adulto** das certidões da Interpol e da Informática da Polícia Nacional do Paraguai, sem as quais não é possível iniciar o processo.
  - A entrada é descontada do total.
- **Saldo:** 50% com 15 dias (1ª vinda), 30% com 90 dias (2ª vinda) e 20% com 120 dias (retirada dos documentos). Prazo que cai em sábado ou domingo passa para a segunda-feira.
- **Exemplo:** 2 pessoas no Prata = R$ 23.994; entrada R$ 2.600; parcelas R$ 10.697, R$ 6.418,20 e R$ 4.278,80.
- **Fechamento, sempre nesta ordem:** ficha de dados (link) → Pix da reserva → **termo da reserva** assinado no celular. Use "termo", nunca "contrato".
- **Processo:**
  - certidões levam de 7 a 15 dias;
  - 1ª vinda: protocolo;
  - 60 a 70 dias úteis depois: 2ª vinda, para as digitais;
  - a cédula sai em média 20 a 30 dias depois. Total: 90 a 120 dias úteis, que é estimativa.
- **Para começar:** foto do RG (frente e verso) ou passaporte e uma foto de meio corpo.

### Orçamentos

- **Numeração:** ORC-AAAA-NNNNN. A Migra emitia até a 09766; o sistema continua a partir da 09767, ajustável no painel. A validade padrão é de 7 dias.
- **Formato da mensagem de WhatsApp:**
  - "*Orçamento ORC-…* 🇵🇾 / *Serviços* / • PACOTE × N / *Total* / *Pagamento no PIX* / Válido até / *PDF do orçamento:* link".
- **No PDF original:** o telefone +5561999999999 era fictício e o texto "5.000 clientes" não batia com os números reais. Use "centenas de clientes".

## 2. Regras da atendente (IA)

- **Escrita:**
  - português do Brasil, mensagens curtas (até uns 300 caracteres), uma pergunta por vez;
  - fala como quem está **no Paraguai**;
  - saudação pelo horário: 00h–12h59 "bom dia", 13h–18h59 "boa tarde", 19h–23h59 "boa noite";
  - **tom profissional**: nunca "beijo" nem apelidos carinhosos; para se despedir, no máximo "um abraço".
- **Nunca encerra o atendimento:**
  - toda mensagem termina com um próximo passo e vai até ficha → Pix → termo;
  - "mais pra frente" vira **data e hora marcadas**, e no dia a IA retoma sozinha.
- **Ela mesma fecha a venda:** contorna objeções com gatilhos verdadeiros (aversão à perda, autoridade, reciprocidade, prova social) e não inventa urgência, desconto nem números.
- **Quando passa para um humano:**
  - só se o cliente tiver receio ou insistir em falar com alguém;
  - ou se não pagou a entrada em 24h, caso em que vai para o vendedor junto com o PDF do orçamento;
  - mensagem: "Estou enviando seu contato tudo certinho para um atendente dentro do escritório para continuar seu atendimento. Qualquer coisa, fale aqui comigo."
- **História do Marcos:** usa as palavras dele, entre aspas. Pode citar a carga tributária "na entrada desse governo atual", segurança jurídica e sigilo patrimonial e bancário. **A IA não finge ser o Marcos.** Se alguém perguntar sinceramente se é IA, ela não nega.
- **Setores (painel: Nome = WhatsApp, em rodízio):**
  - loteamentos e terrenos → Migra Imobiliária ("é a responsável pelos investimentos e pela venda dos lotes, você resolve tudo por aqui");
  - veículos → Migra Motors;
  - documentação → atendentes que recebem as passagens.
- **Para o Marcos direto:** contratação, parcerias, fornecedores e imprensa (`avisar_marcos`).
- **Conversas antigas:**
  - antes de responder, lê as 20 mensagens anteriores;
  - conversa pessoal ou negociação do próprio Marcos fica com ele;
  - responde até 15 dias para trás, no máximo 30 por hora, das 7h às 21h;
  - começa com "Agradeço por aguardar, nossa demanda está muito alta…", nunca com pedido de desculpas.
- **O Marcos respondeu ou começou a conversa:** a IA sai daquele cliente.

## 3. O sistema atual: Migra Hub

- **Código:** repositório `MandersonGenelhud/Projeto-Cidades-da-Sorte`, branch `claude/whatsapp-automation-tool-247je5`, pasta `whatsapp-automacao/`.
- **Tecnologia:** Node 22, Express e Baileys (WhatsApp). Os dados ficam em JSON (`data/db.json`).
- **IA:** Gemini, OpenRouter, OpenAI ou Claude.
- **Testes:** 125 automáticos.
- **Onde roda:**
  - Windows pelo `INICIAR-WINDOWS.bat`, com o botão "Atualizar agora";
  - VPS com Docker e Caddy (HTTPS).
- **O que já faz:**
  - **WhatsApp:** número principal mais o de cada vendedor (QR por vendedor), Instagram Direct e a API oficial da Meta como opção.
  - **Atendimento:** IA humanizada (pausas de leitura, digitando, mensagens em partes); fila de quem ficou esperando, com triagem.
  - **CRM:** funil, retornos, rodízio de vendedores, ranking, metas e acompanhamento do Marcos (quem pegou cada cliente, o que trava, por que não fechou).
  - **Fechamento:** ficha de dados → Pix (QR e copia e cola) → termo assinado no celular (PDF), recibo e etapas de pagamento com datas.
  - **Calculadora e orçamentos:** calculadora de pagamento e orçamentos ORC em PDF com a marca.
  - **Atendimento presencial e equipe:** visitas ao escritório (o Marcos confirma e passa para o vendedor) e setores com atendentes.
  - **Imóveis e parceiros:** imóveis e loteamentos com mapa de lotes (formas curvas, status "reserva da loteadora") e portal de parceiros e indicadores.
  - **Segurança:** 2FA, limite de tentativas, alertas de acesso, "derrubar todos os acessos", registro de acessos e backup diário criptografado.
- **Pendências de operação:**
  - VPS;
  - repositório privado com chave de leitura;
  - 2FA de todos;
  - pasta extra do backup;
  - WhatsApp dos vendedores e setores cadastrados;
  - campo "WhatsApp que recebe os pedidos" das visitas estava preenchido com valor inválido.

## 4. Incidente de 30/10/2026

- **O que aconteceu:**
  - a conta da Hostinger foi invadida (tentativa de trocar o e-mail para outro Gmail);
  - os dados de recebimentos do sistema antigo se perderam.
- **O que foi orientado:**
  - não confirmar a troca;
  - trocar a senha e ligar a 2FA;
  - pedir à Hostinger a restauração dos backups e os IPs de acesso;
  - fazer boletim de ocorrência;
  - avaliar o aviso à ANPD (LGPD).
- **Lição para todo sistema novo:** backup automático criptografado com cópia fora do servidor.

## 5. Visão: plataforma Migra Negócios

**Um único sistema e um único banco de dados.**
- **Para o público:** sites separados por marca (Migra Paraguai, Imobiliária, Motors/Carros, School), cada um com o seu domínio.
- **Para o Marcos:** uma empresa só, com um login geral e um dashboard por empresa.

### Acesso e auditoria

- **Perfis:**
  - **Marcos (geral)**;
  - **gerente por empresa**;
  - **vendedor por empresa ou área**: vê só os próprios clientes, produtos e serviços.
- **Registro de tudo:** quem criou, alterou ou excluiu, quando, valor antes e valor depois. Inclui preço, juros e status do lote.
- **Vendedor não exclui;** pode alterar valor, e isso fica registrado.

### Imobiliária e loteamentos

- **Gerente:** cadastra loteamentos, mapas e produtos.
- **Vendedor:**
  - reserva lote e move a venda no pipeline;
  - reserva só com o cadastro completo do cliente, que gera o **documento de reserva**.
- **Plano de pagamento:**
  - entrada abatida do total e parcelas;
  - **juros configuráveis pelo administrador por faixa de número de parcelas** (mais parcelas, mais juros);
  - relatório de parcelas pagas e em aberto.
- **Imóveis à venda e para aluguel**, cadastrados pelos vendedores.
- **Pesquisa a fazer:** como funcionam os sistemas públicos dos grandes loteadores e imobiliárias (simulação, reserva online, mapa interativo, carnê e boletos, área do cliente), para adotar as melhores ideias. Isso é estudo de funcionalidades: não se copia código, marca nem conteúdo de terceiros.

### Motors (veículos)

- Catálogo no estilo dos grandes portais de anúncios, como a Webmotors: filtros, fotos, ficha técnica, simulação.
- Simulação de **financiamento com bancos e financeiras que atendem no Paraguai**, e **consórcio**.
- **Pesquisa a fazer:** bancos e financeiras no Paraguai, com regras, taxas e documentação.

### School

- Alunos cadastrados, etapa de aprendizado e frequência de acesso (quem acessa e quem sumiu).

### Migração (prioridade, porque os dados se perderam)

- **"Extrair dados" no WhatsApp do vendedor:** o vendedor abre a conversa conectada, clica e os dados que o cliente mandou vão para o cadastro. A IA lê e o vendedor confere.
- **Com o cadastro:**
  - o processo etapa por etapa;
  - o orçamento editável, como uma planilha (parcelas e prazos ajustáveis pelo vendedor), gerando o PDF;
  - os documentos que o escritório consegue adiantar.
- **Documento de entrada:** marca d'água "**Documento válido somente após a confirmação do pagamento da reserva**", que some quando o Pix é confirmado.
  - É emitido pela **Migra Paraguai Assessoria** e assinado pelo Marcos.
  - A assinatura do Marcos só pode ir com a autorização dele: certificado ou assinatura digital própria, nunca uma assinatura imitada.
- **Pesquisa a fazer em fontes oficiais:**
  - Dirección Nacional de Migraciones e Lei 6984/2022;
  - Interpol e Polícia Nacional;
  - DNIT (RUC);
  - licença de condução;
  - apostila de Haia e traduções.

  Objetivo: listar, por pacote, os documentos exigidos e o que o escritório pode preparar (formulários, declarações, checklist) para não dar problema com os órgãos.

### Fases sugeridas

1. **Base:** banco de dados de verdade (PostgreSQL), perfis e permissões, auditoria e migração dos dados do Migra Hub.
2. **Migração:** extrair dados do WhatsApp, cadastro, checklist de documentos, orçamento editável → PDF com marca d'água, e site da Migra Paraguai.
3. **Imobiliária:** loteamentos, reservas, plano com juros por faixa, parcelas, imóveis e site.
4. **Motors:** catálogo, financiamento e consórcio, e site.
5. **School e Contabilidade:** dashboard geral do Marcos com todas as empresas.

Cada fase entra em produção com testes, backup e as regras do `SEGURANCA.md`.
