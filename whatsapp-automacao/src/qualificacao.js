// Termômetro de venda: a IA registra, ao longo da conversa, se o cliente TEM CONDIÇÕES de fechar e o que fazer com cada resposta dele.
// Capacidade (tem dinheiro para a entrada?): sim | parcial | nao | desconhecida. Urgência, quem decide, objeções e próximo passo.
// A regra é simples: tem condições → partir para o fechamento (orçamento, ficha, contrato, Pix); parcial → ajustar (pacote menor, parcelas, entrada
// na data certa); não → não pressionar, combinar dia e hora exatos para voltar. Só se registra o que o cliente disse (com a frase dele).
const clip = (s, n = 200) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const CAP = ['sim', 'parcial', 'nao', 'desconhecida'];
const URG = ['agora', 'este_mes', 'depois', 'indefinida'];
const DECISOR = ['ele_mesmo', 'conjuge_familia', 'outra_pessoa', 'indefinido'];

export const QUALIFY_TOOL = {
  type: 'function',
  function: {
    name: 'registrar_qualificacao',
    description: 'Registre (sem avisar o cliente) o que você descobriu sobre ele: se TEM CONDIÇÕES de fechar, quando quer começar, quem decide e o que o trava. Use toda vez que o cliente revelar algo novo (valor que tem, prazo, "preciso falar com minha esposa", "tá caro"). O sistema devolve a estratégia certa para a resposta dele. Preencha só com o que ele realmente disse, copiando a frase em "evidencia".',
    parameters: {
      type: 'object',
      properties: {
        capacidade: { type: 'string', enum: CAP, description: 'sim = disse que tem ou aceitou a entrada; parcial = tem parte, precisa de data ou ajuste; nao = sem recursos agora; desconhecida = ainda não sabemos' },
        evidencia: { type: 'string', description: 'A frase do cliente que mostra isso, nas palavras dele' },
        urgencia: { type: 'string', enum: URG, description: 'agora = quer começar já; este_mes; depois = mais para frente; indefinida' },
        decisor: { type: 'string', enum: DECISOR, description: 'Quem decide: ele mesmo, cônjuge/família, outra pessoa, ou ainda não sabemos' },
        objecoes: { type: 'string', description: 'O que ainda trava (valor, prazo, segurança, família…), nas palavras dele' },
        proximo_passo: { type: 'string', description: 'O próximo passo concreto que você vai propor' },
        previsao: { type: 'string', description: 'Quando ele acredita que terá o valor da entrada (nas palavras dele, ou a data combinada)' },
        oferta_relampago: { type: 'string', enum: ['interessou', 'vai_a_vista', 'vai_parcelado', 'nao_a_vista'], description: 'Só se houver oferta relâmpago em vigor: interessou; vai_a_vista (à vista ou cartão em até 3x); vai_parcelado (vai fechar hoje pagando a entrada e parcelando as etapas); nao_a_vista (não vai fechar agora)' },
      },
      required: ['capacidade'],
    },
  },
};

/** Guarda a qualificação na conversa e devolve a estratégia (texto para a IA) conforme o caso. */
export function applyQualification(conv, args = {}, { now = Date.now(), dryRun = false } = {}) {
  const pick = (v, list, d) => (list.includes(v) ? v : d);
  const q = {
    capacidade: pick(args.capacidade, CAP, 'desconhecida'), evidencia: clip(args.evidencia), urgencia: pick(args.urgencia, URG, conv?.qualificacao?.urgencia || 'indefinida'),
    decisor: pick(args.decisor, DECISOR, conv?.qualificacao?.decisor || 'indefinido'), objecoes: clip(args.objecoes || conv?.qualificacao?.objecoes), proximoPasso: clip(args.proximo_passo), previsao: clip(args.previsao || conv?.qualificacao?.previsao, 160), oferta: ['interessou', 'vai_a_vista', 'vai_parcelado', 'nao_a_vista'].includes(args.oferta_relampago) ? args.oferta_relampago : (conv?.qualificacao?.oferta || ''), at: now,
  };
  // "Tem condições" sem uma frase do cliente não vale: vira desconhecida (a IA não pode supor dinheiro).
  if (q.capacidade === 'sim' && !q.evidencia) q.capacidade = 'desconhecida';
  if (!dryRun && conv) conv.qualificacao = q;
  return { ok: true, qualificacao: q.capacidade, instrucao: strategyFor(q) };
}

/** O que fazer com a resposta do cliente. */
export function strategyFor(q) {
  const dec = q.decisor === 'conjuge_familia' ? ' Ele decide junto com a família: já proponha a videochamada com o casal (consultor do escritório) antes de a objeção "vou falar com minha esposa" aparecer.' : q.decisor === 'outra_pessoa' ? ' Quem decide é outra pessoa: peça para incluí-la na conversa ou na videochamada.' : '';
  if (q.capacidade === 'sim') return `TEM CONDIÇÕES: parta para o fechamento agora, sem mais rodeios. Confirme pacote e quantas pessoas, mande o orçamento (gerar_orcamento) e, ao primeiro sim, as fotos e a ficha (enviar_ficha_de_dados). Contrato e Pix o sistema envia na ordem certa.${q.urgencia === 'agora' ? ' Ele quer começar já: aproveite o momento e feche hoje.' : ''}${dec}`;
  if (q.capacidade === 'parcial') return `TEM PARTE: não perca a venda. Mostre que para começar é só a entrada (sinal + certidões) e o restante acompanha as etapas; se ainda pesar, ofereça o pacote menor para evoluir depois, ou combine a data exata em que terá a entrada (agendar_retorno). Pergunte: "Quando você consegue a entrada: esta semana ou na próxima?".${dec}`;
  if (q.capacidade === 'nao') return `SEM CONDIÇÕES AGORA, MAS PODE TER DEPOIS: não pressione, não desmereça e não fale de contrato nem Pix. Acolha e pergunte com naturalidade: "já que agora não faz sentido investir, você tem uma previsão de quando consegue ter esse valor? Assim eu retorno o contato na data certa." Anote o que ele disser em "previsao" e combine dia e hora exatos para retomar (agendar_retorno). Sugira que ele reserve o valor da entrada até lá e deixe a Migra à disposição. Só depois, UMA vez, ofereça o Plano em PDF (oferecer_plano_pdf) como alternativa para começar sozinho.${q.previsao ? ` Previsão dele: ${q.previsao}.` : ''}${dec}`;
  return `AINDA NÃO SABEMOS SE ELE TEM CONDIÇÕES: descubra com naturalidade, sem parecer interrogatório. Primeiro explique o valor e a forma de pagamento (para começar é só a entrada), depois pergunte "se você fosse fechar, como preferiria pagar a entrada?". Registre a resposta em registrar_qualificacao.${dec}`;
}

/** Bloco que entra no prompt de cada resposta: o que já sabemos desta conversa. */
export function qualBlock(conv) {
  const q = conv?.qualificacao;
  if (!q) return '';
  const cap = { sim: 'TEM condições de fechar', parcial: 'tem condições em parte', nao: 'sem condições agora', desconhecida: 'condições ainda desconhecidas' }[q.capacidade];
  return `# Termômetro de venda desta conversa (já registrado: não pergunte de novo)
Condições: ${cap}${q.evidencia ? ` ("${q.evidencia}")` : ''}. Urgência: ${q.urgencia}. Decisão: ${q.decisor}.${q.objecoes ? ` Trava: ${q.objecoes}.` : ''}${q.previsao ? ` Previsão de ter o valor: ${q.previsao}.` : ''}${q.oferta ? ` Oferta relâmpago: ${q.oferta.replace(/_/g, ' ')}.` : ''}${q.proximoPasso ? ` Próximo passo planejado: ${q.proximoPasso}.` : ''}
Estratégia: ${strategyFor(q)}`;
}

/** Regras gerais: como ler cada resposta do cliente. Entra no prompt de quem fecha venda. */
export const READ_ANSWERS = `# Leia cada resposta e saiba o que fazer (profissional de vendas)
Toda resposta do cliente é um sinal. Interprete, registre em registrar_qualificacao e aja:
- Pergunta preço, prazo, forma de pagamento ou "como faço": SINAL DE COMPRA. Responda e avance para o orçamento e a ficha.
- "Tenho o valor", "posso pagar", "quero começar": TEM CONDIÇÕES. Feche agora.
- "Estou apertado", "só depois do salário", "não tenho tudo agora": TEM PARTE. Entrada pequena, pacote menor ou data exata para a entrada.
- "Tá caro": não é "não". Descubra comparado a quê, recapitule o que ele ganha e ofereça opções, não desconto.
- "Vou pensar", "depois", "mais pra frente": há uma objeção escondida. Pergunte qual, contorne com fatos e, só então, trave data e hora.
- "Preciso falar com minha esposa/família": decisor em grupo. Proponha a videochamada com o casal e o consultor.
- Resposta curta e fria depois de várias mensagens: o interesse esfriou. Mude a abordagem (pergunta de benefício, história do Marcos), não repita o que já disse.
- Silêncio depois do orçamento: retome com a vantagem de começar agora e o custo real de adiar, sem pressão falsa.
Antes de empurrar o fechamento, saiba se ele TEM CONDIÇÕES. Quem tem: feche sem demora. Quem não tem: não pressione, combine o retorno. Nunca invente o que o cliente disse.`;

/** Quanto mais perto de fechar, mais cedo é chamado. */
export const qualRank = (conv) => ({ sim: 0, parcial: 1, desconhecida: 2, nao: 3 }[conv?.qualificacao?.capacidade] ?? 2);
