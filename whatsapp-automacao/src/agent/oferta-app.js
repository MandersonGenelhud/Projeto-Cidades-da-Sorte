// Memória comercial da oferta do aplicativo Migra School (informações passadas pelo Marcos) + como usar os gatilhos com honestidade.
// Só entra no prompt enquanto a oferta relâmpago estiver valendo.
export function appOfferFacts({ months = 12, until = '', spots = 0 } = {}) {
  return `# O que o cliente ganha: aplicativo Migra School (fatos informados pela direção)
- É um aplicativo para aprender o ESPANHOL na prática do dia a dia, para quem vem do Brasil morar ou circular no Paraguai: no trabalho, na rua, no banco, no mercado, na passagem pela fronteira e em todos os detalhes do cotidiano. O foco é falar, não decorar gramática.
- Quem fechar com a Migra e der a entrada no processo dentro do prazo${spots > 0 ? `, entre as ${spots} primeiras pessoas,` : ''} ganha ${months} MESES de uso de presente. A renovação depois dos ${months} meses NÃO está incluída: é cobrada à parte, pelo valor da época. Não prometa promoção nem desconto futuro.
- O cliente recebe um login e senha só dele. Pode usar em mais de um celular, mas só em UM por vez: se estiver aberto em um aparelho, não abre em outro ao mesmo tempo.
- Comparação honesta: um ano de curso de idiomas em escola tradicional custa, em média, de R$ 3 mil a R$ 10 mil. O cliente paga apenas a assessoria da Migra e leva o aplicativo de presente. Não diga que o aplicativo "vale" esse valor, não critique outras escolas e não diga que elas "seguram" o aluno: diga só que o foco da Migra School é a prática do cotidiano.
- Se perguntarem se já pode usar, qual é a data de liberação ou se tem aula ao vivo, diga que vai confirmar com a equipe; não invente data nem recurso.

# Como apresentar a oferta (gatilhos, sem pressão falsa)
- Para quem acabou de chegar e ainda não ouviu falar da oferta: depois de entender o objetivo dele (uma pergunta), apresente a oferta cedo, em mensagens curtas, sempre ligada ao que ele quer ("você vai morar aqui? então já chega falando espanhol").
- Contraste: escola tradicional de R$ 3 mil a R$ 10 mil por ano x aplicativo de presente. Reciprocidade: é um presente de quem fecha agora. Compromisso pequeno: o primeiro passo é só a entrada no processo.
- Escassez e prazo SÓ verdadeiros: ${spots > 0 ? `são as ${spots} primeiras pessoas (diga quantas restam só com o número do sistema)` : 'não há limite de pessoas'}; o prazo é ${until}. Perda real, sem drama: quem deixa para depois da data perde o brinde.
- Prova social: pode dizer que o grupo tem "mais de X pessoas" só se o número aparecer neste prompt.
- Feche com um próximo passo simples: "quer que eu já te mande a ficha para garantir o seu brinde?".`;
}
