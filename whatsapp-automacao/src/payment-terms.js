// Regra de vencimento das parcelas (plano padrão): 1ª com vencimento ou pagamento na primeira vinda ao Paraguai; 2ª entre 60 e 90 dias após a
// primeira vinda; 3ª 30 dias após o pagamento da 2ª. Os VALORES não mudam. Aqui ficam os textos novos e a troca, uma vez, dos textos antigos
// que já estavam guardados (conhecimento da IA, planos enviados, orçamentos). Só troca o texto exato antigo: o que o Marcos editou fica como está.

export const NEW_STEPS = [
  { when: 'Na 1ª vinda ao Paraguai', note: 'Com vencimento ou data de pagamento na primeira vinda ao Paraguai' },
  { when: 'De 60 a 90 dias após a 1ª vinda', note: 'Vencimento previsto entre 60 e 90 dias após a primeira vinda ao Paraguai' },
  { when: '30 dias após pagar a 2ª parcela', note: 'Vencimento 30 dias após o pagamento da segunda parcela' },
];
const OLD_NOTES = ['Na sua primeira vinda ao Paraguai', 'Na sua segunda vinda ao Paraguai', 'Quando retirar os documentos'];

const SPLIT = '1ª parcela (50%) com vencimento ou data de pagamento na primeira vinda ao Paraguai; 2ª parcela (30%) com vencimento previsto entre 60 e 90 dias após a primeira vinda ao Paraguai; 3ª parcela (20%) com vencimento 30 dias após o pagamento da segunda parcela. As datas são confirmadas pela equipe.';
const SHORT = '50% com vencimento ou pagamento na primeira vinda ao Paraguai, 30% entre 60 e 90 dias após a primeira vinda e 20% 30 dias após o pagamento da segunda parcela';

/** [texto antigo, texto novo] */
export const REPLACEMENTS = [
  ['1ª parcela (50%) com cerca de 15 dias, na primeira vinda ao Paraguai; 2ª parcela (30%) com cerca de 90 dias, na segunda vinda; 3ª parcela (20%) com cerca de 120 dias, quando retirar os documentos. As datas das viagens e da retirada são confirmadas pela equipe.', SPLIT],
  ['50% na 1ª vinda (cerca de 15 dias), 30% na 2ª vinda (cerca de 90 dias) e 20% na retirada dos documentos (cerca de 120 dias)', SHORT],
  ['50% na primeira vinda (cerca de 15 dias), 30% na segunda vinda (cerca de 90 dias) e 20% na retirada dos documentos (cerca de 120 dias)', SHORT],
  ['50% na primeira vinda, 30% na segunda vinda e 20% na retirada dos documentos', SHORT],
  ['parcelas ligadas às etapas (primeira vinda, segunda vinda, retirada dos documentos)', 'parcelas com vencimento ligado à primeira vinda ao Paraguai (1ª na primeira vinda, 2ª entre 60 e 90 dias depois dela, 3ª 30 dias após o pagamento da 2ª)'],
];

/** Troca os textos antigos em qualquer texto guardado nas configurações. Devolve quantos textos mudaram. */
export function applyTermsToSettings(node) {
  let n = 0;
  const walk = (o) => {
    for (const k of Object.keys(o || {})) {
      const v = o[k];
      if (typeof v === 'string') {
        let t = v;
        for (const [a, b] of REPLACEMENTS) if (t.includes(a)) t = t.split(a).join(b);
        if (t !== v) { o[k] = t; n += 1; }
      } else if (v && typeof v === 'object') walk(v);
    }
  };
  walk(node);
  return n;
}

/** Planos de pagamento já guardados (enviados a clientes ou dentro de orçamentos): só os do plano padrão de 3 parcelas, com o texto antigo. */
export function applyTermsToPlan(plan) {
  if (!plan || plan.custom || plan.parcels?.length !== 3) return false;
  if (plan.parcels.every((x) => x.trip)) return false;
  if (!plan.parcels.every((x, i) => x.note === OLD_NOTES[i])) return false;
  plan.parcels.forEach((x, i) => { x.when = NEW_STEPS[i].when; x.note = NEW_STEPS[i].note; x.trip = true; });
  return true;
}
