// Cliente ANTIGO que recebeu, sem precisar, uma chamada automática nossa ("dar continuidade ao seu atendimento"…) e respondeu.
// Para não parecer fraude (e não gerar denúncia), quando a pessoa já é cliente (contrato, venda, Pix pago, cliente ganho, pagamento ou
// documentos nas últimas mensagens) a resposta NÃO é da IA de vendas: é um pedido de desculpas fixo, e a conversa passa para a equipe.
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const DAY = 86_400_000;

// Frases das nossas chamadas de iniciativa (retorno automático, "você está aí?", encerramento, orçamento vencendo, recomeço).
const OUTREACH = /(dar continuidade (ao|no) seu atendimento|agradecemos muito por aguardar|voce ainda esta por ai|vou precisar finalizar o seu atendimento|dar a vez a quem esta aguardando|seu orcamento (vence|esta (perto de )?vencer)|retomando (a nossa|nossa) conversa|estou entrando em contato)/;

/** A mensagem do cliente respondeu a uma chamada de iniciativa nossa (últimos `days` dias)? */
export function answeredOurOutreach(conv, { now = Date.now(), days = 7 } = {}) {
  if (conv?.lastProactiveAt && now - conv.lastProactiveAt <= days * DAY) return true;
  const msgs = conv?.messages || [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role === 'user') continue; // só olha a última fala nossa antes da resposta dele
    return now - (Date.parse(m.at) || 0) <= days * DAY && OUTREACH.test(fold(m.content));
  }
  return false;
}

/** Documentos já enviados para o contrato: o cliente mandou foto/documento depois de a equipe pedir RG, meio corpo, ficha ou contrato. */
export function detectDocsSent(conv, { last = 40 } = {}) {
  const msgs = (conv?.messages || []).slice(-last);
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].role !== 'user' || !/\[(foto|documento|imagem|pdf)[^\]]*\]/i.test(String(msgs[i].content))) continue;
    if (msgs.slice(Math.max(0, i - 6), i).some((m) => m.role !== 'user' && /(rg\b|meio corpo|ficha|contrato|reserva|documento)/.test(fold(m.content)))) return 'ele já enviou documentos para a elaboração do contrato';
  }
  return '';
}

export function apologyText(name = '') {
  const first = String(name || '').trim().split(/\s+/)[0];
  const who = first && !/^@|^\+?\d+$/.test(first) ? `, ${first}` : '';
  return `Olá${who}! Peço perdão pela mensagem que você recebeu. Estamos automatizando o nosso sistema devido à grande alta de procura pelos serviços da Migra e, sem querer, o sistema enviou uma mensagem para você, que buscava clientes antigos que ficaram sem resposta. Peço que desconsidere essa mensagem, porque você já é um dos nossos clientes. Qualquer dúvida sobre o seu processo, é só falar por aqui que a nossa equipe atende você. Obrigado pela compreensão!`;
}

/** Instrução para a IA quando NÃO foi possível provar que é cliente: ler as 20 mensagens antes de continuar. */
export const READ_BEFORE_CONTINUING = `# CLIENTE RESPONDEU A UMA CHAMADA AUTOMÁTICA NOSSA (regra da direção: cuidado máximo)
Antes de qualquer coisa, LEIA as últimas 20 mensagens desta conversa. Se elas mostrarem que ele JÁ É CLIENTE (pagamento confirmado, documentos enviados para o contrato, contrato assinado, "vamos dar continuidade ao seu processo", agradecimento pelo pagamento) ou que já fechou com outra pessoa: NÃO venda nada, peça perdão em UMA frase pela mensagem automática ("estamos automatizando o sistema e a mensagem chegou por engano"), diga que a equipe segue com o processo dele e use transferir_para_humano. Esse cliente pode achar que é golpe: seja breve, simpática e transparente. Se for mesmo um interessado que parou de responder, siga o atendimento normal.`;
