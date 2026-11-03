# Como precificar a automação para a Migra Paraná (e outras empresas)

> Os números de exemplo abaixo são **ilustrativos**. Os preços atuais do Google você digita na aba **Preço do serviço** do painel (fonte: ai.google.dev/pricing). Imposto, nota fiscal e preço entre empresas do mesmo grupo: validar com o contador.

## 1. A fórmula
**Preço mensal = (custo da IA + custo fixo rateado + suporte) × (1 + margem)**

- **Custo da IA** = respostas por mês × custo de uma resposta.
- **Custo de uma resposta** = (tokens de entrada × preço de entrada + tokens de saída × preço de saída) ÷ 1 milhão.
- **Custo fixo rateado** = (servidor + domínio + ferramentas) ÷ número de empresas atendidas.
- **Suporte** = horas por mês × valor da hora.
- **Margem**: regra de bolso para software como serviço, preço de 3 a 5 vezes o custo (margem bruta de 65% a 80%). Cobre risco, evolução do produto e o retorno de quem criou.

## 2. O dado mais importante do seu sistema
O texto que a IA recebe a cada resposta (instruções + base do negócio + memória da conversa) tem **cerca de 15 mil a 19 mil tokens**. A maior parte do custo é a **entrada**, não a resposta. Por isso o custo por resposta depende muito de quanto texto o modelo lê.

O sistema agora **mede o consumo real** (tokens e respostas, por escritório). Depois de uma ou duas semanas de uso do Paraná, o cálculo deixa de ser estimativa.

## 3. Exemplo ilustrativo (não use estes números!)
Suponha entrada US$ 0,50 e saída US$ 3,00 por milhão de tokens, dólar a R$ 5, 18 mil tokens de entrada e 400 de saída por resposta:
- Custo por resposta: R$ 0,051.
- 3.000 respostas por mês: R$ 153 de IA. Com custo fixo rateado de R$ 100 e suporte de R$ 100, o custo é R$ 353.
- Com margem de 200% (3 vezes o custo): mensalidade de cerca de **R$ 1.060**, e lucro de cerca de R$ 700.

## 4. Como cobrar (modelo recomendado)
1. **Implantação (única):** configurar a IA do escritório, conectar o WhatsApp, treinar a base, cadastrar a equipe.
2. **Mensalidade por plano**, com um número de respostas incluídas (por exemplo 1.500, 3.000, 6.000).
3. **Excedente** por bloco de 100 respostas, para o cliente nunca consumir sem pagar.
4. **Opcional:** percentual sobre contratos fechados por meio da IA. É uma forma de dividir o resultado, e vale se o Paraná concordar em medir de forma transparente.
5. **Contrato** com o que está incluso, o que é cobrado à parte (mensagens oficiais do WhatsApp, anúncios, voz) e o prazo mínimo.

## 5. O que reduz o seu custo (e aumenta o lucro)
- **Encurtar o texto fixo** que a IA lê a cada resposta (hoje é longo).
- **Cache de contexto** do provedor para a parte repetida do texto, quando o modelo oferecer desconto para isso (conferir na página de preços).
- **Modelo mais barato** para respostas simples e modelo melhor só para as complexas.
- **Rateio** do servidor entre mais empresas.

## 6. Cuidados
- **WhatsApp:** o sistema usa conexão por QR Code (não oficial). Para revender a outra empresa, avalie a **API oficial da Meta**, que tem custo por conversa e deve entrar no preço ou ser repassada ao cliente.
- **Preço entre empresas do mesmo grupo (Migra Paraguai e Migra Paraná):** a cobrança precisa refletir um preço de mercado e ter contrato. O contador confirma como registrar.
- **Moeda e imposto:** cobrar em reais ou guaranis muda o imposto e o câmbio. O contador define nota fiscal e retenções.
- **Dependência do Google:** reajuste de preço ou troca de modelo muda o custo. Revise o preço a cada trimestre usando o painel.

## 7. Passo a passo no painel
1. Abra **Preço do serviço**.
2. Digite os preços atuais do modelo (entrada e saída por milhão de tokens), o dólar do dia, os custos fixos, as horas de suporte e a margem.
3. Veja o **consumo real** do Paraná (filtro de escritório) e os **planos sugeridos**.
4. Clique em **Gerar proposta** no plano escolhido e copie o texto.
