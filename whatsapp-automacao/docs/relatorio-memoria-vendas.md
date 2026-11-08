# Relatório: o que está na memória de vendas das IAs (08/11/2026)

Verificado com o prompt real montado para a IA de fechamento (Migra Paraguai): cerca de 81 mil letras no total, das quais o método novo de vendas ocupa cerca de 9 mil.

## Incluído (e como a IA usa)
1. Método de vendas consultivas: responde primeiro, uma pergunta por vez, resume e confirma, recomenda uma opção, valor antes do preço (`src/agent/vendas-playbook.js`).
2. Descoberta de condições de pagar (termômetro): sim, em parte, não, desconhecida, com a frase do cliente (`src/qualificacao.js`). Estratégia automática por resposta.
3. Leitura de cada resposta do cliente: preço, prazo, "caro", "vou pensar", família, silêncio depois do orçamento, resposta fria.
4. Protocolo OUVIR e 12 objeções: caro, vou pensar, família, confiança, já fechei, medo de errar, pesquisar mais, sem tempo, experiência ruim, concorrente mais barato, desconto.
5. Indecisão: medo de errar (simplificar, decisão pequena e reversível) x falta de convicção no valor.
6. Gatilhos honestos: reciprocidade, autoridade, prova social e escassez só com fatos cadastrados, compromisso, afinidade, contraste, ancoragem com referências reais.
7. Negociação íntegra: interesse x posição, nada de desconto próprio, concessão só autorizada.
8. Quando não vender, cliente insatisfeito, vulnerabilidade, depois do "sim" e autoavaliação silenciosa.
9. Sem condições agora: perguntar a previsão, agendar retorno, não desmerecer; depois o Plano em PDF (R$ 500, enviado só após o pagamento, Marcos avisado).
10. Oferta relâmpago até 12/11 com 20 vagas reais, Prata ou Ouro, à vista; contagem de vagas pelo sistema.
11. Tom: mensagens curtas (até ~4 linhas) com pausa.
12. Proteção de clientes antigos, plano de atendimento e painel de Fechamentos (funil, checklist, radar de objeções).
13. Versão portátil do prompt para reuso: `docs/prompt-especialista-vendas.md`.

## Não incluído de propósito
- Lista dos 25 livros, autores e cursos (a IA não cita fontes ao cliente e não afirma ter lido obras).
- Contribuições de Flávio Augusto, Caio Carneiro, Paulo Vieira, Pablo Marçal, Thiago Concer e V4 como texto próprio: foram absorvidas só como princípios gerais (iniciativa, preparo, rotina, prospecção, perguntas). Táticas agressivas ou de pressão foram descartadas.
- Níveis de evidência (A a D) e pesquisas de neurociência: viraram a regra "só fatos verificados".
- KPIs, teste A/B e nota 0 a 20 de qualidade: não são para a IA; o painel de Fechamentos cobre funil e objeções. Falta ainda uma nota automática de qualidade por conversa.
- Cadência de prospecção em D0, D+2, D+7: já existe um sistema próprio (retorno, "você está aí?", encerramento em 24 h, fim da fila); não foi duplicado.

## Defeito encontrado e corrigido nesta verificação
A ferramenta `registrar_qualificacao` (termômetro e reserva de vaga da oferta) **não era entregue à IA na Migra**, porque o filtro de ferramentas só liberava as que dependem de agenda. Corrigido e coberto por teste (`test/qualificacao.test.js`).

## Limites
O prompt é grande (custo de uso da IA sobe um pouco); o início é igual para todos os clientes, então o provedor guarda em cache. Nada disso foi testado com clientes reais.
