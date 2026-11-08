// Sinais de "já é nosso cliente" lidos das ÚLTIMAS 20 MENSAGENS da conversa (de quem for: cliente, equipe, IA, áudio transcrito).
// O banco de dados já diz quem tem contrato, venda ou Pix pago; mas muita venda foi fechada pelo celular, sem lançamento. Nesses casos a conversa
// tem frases como "pagamento confirmado", "recebemos o comprovante", "bem-vindo à Migra", "vamos dar continuidade ao seu processo".
// Quem tem esses sinais NUNCA recebe chamada de iniciativa nossa: seria conflito de interesse e o cliente acharia que é golpe.
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Frases fortes: sozinhas já indicam venda fechada.
const FORTES = [
  /\bpagamento (foi )?(confirmado|recebido|identificado|aprovado)\b/,
  /\b(recebemos|recebi|identificamos|confirmamos) (o |seu |sua |a )?(pagamento|pix|comprovante|entrada|sinal|reserva)\b/,
  /\bobrigad[oa] (pelo|pela) (pagamento|confianca|preferencia|reserva)\b/,
  /\b(agradecemos|agradeco) (pelo|pela|a) (pagamento|confianca|preferencia|escolha)\b/,
  /\bseja bem[- ]vind[oa] (a|ao) (migra|nosso)\b/,
  /\b(contrato|documento) (foi )?assinad[oa]\b/,
  /\bcontrato assinado\b/,
  /\bvamos (dar )?(continuidade|seguir|iniciar|comecar) (com |ao |no |na |a )?(seu|sua|o|a)? ?(processo|documentacao|atendimento|cadastro)\b/,
  /\b(sua|a) reserva (esta|foi|ficou) (confirmada|garantida|feita)\b/,
  /\bja pagu?ei\b|\bja fiz o pix\b|\bpix (feito|enviado|realizado)\b|\bpaguei (a |o )?(entrada|reserva|pix)\b/,
  /\bja sou cliente\b|\bja fechei com (voces|a migra|o marcos)\b/,
];
// Frases fracas: só contam juntas (duas diferentes).
const FRACAS = [
  /\bcomprovante\b/, /\bjuntar (os )?documentos\b/, /\bseu processo (ja )?(esta|foi) (em andamento|iniciado)\b/, /\benviar (os )?documentos\b/,
  /\bnumero do (seu )?contrato\b/, /\bparabens pela (decisao|escolha)\b/,
];

/** Devolve '' (sem sinais) ou o motivo em português simples. Lê só as últimas `last` mensagens. */
export function detectClosedByMessages(conv, { last = 20 } = {}) {
  const msgs = (conv?.messages || []).slice(-last);
  let weak = new Set();
  for (const m of msgs) {
    const t = fold(m.content);
    if (!t) continue;
    for (const r of FORTES) if (r.test(t)) return 'a conversa mostra pagamento ou contrato fechado';
    FRACAS.forEach((r, i) => { if (r.test(t)) weak.add(i); });
  }
  return weak.size >= 2 ? 'a conversa mostra que o atendimento já avançou (documentos/comprovante)' : '';
}
