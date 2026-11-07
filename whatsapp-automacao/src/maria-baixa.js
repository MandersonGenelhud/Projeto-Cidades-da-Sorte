// Baixa de pagamento pela Maria: o vendedor manda o comprovante (foto ou PDF), a Maria lê, descobre de quem é o pagamento e qual parcela ou
// cobrança ele quita, e dá a baixa depois do "sim" de quem mandou. Se o pagador não é o cliente (outra pessoa pagou), ela pede o WhatsApp ou
// o CPF do CLIENTE e dá a baixa no cliente certo. Mesmas conferências da leitura de comprovante do atendimento: valor, recebedor, data,
// pagamento concluído, número da transação único e valor dentro do limite. Qualquer dúvida vai para o administrador conferir no banco.

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['de', 'da', 'do', 'dos', 'das', 'e', 'ltda', 'me', 'eireli', 'sa']);
const toks = (s) => fold(s).split(' ').filter((t) => t.length > 1 && !STOP.has(t));
export const digits = (s) => String(s ?? '').replace(/\D/g, '');
export const money = (v) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
const brDate = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

/** Mesmo nome? (dois nomes ou 60% das palavras em comum). */
export function nameMatches(a, b) {
  const x = toks(a); const y = toks(b);
  if (!x.length || !y.length) return false;
  const hit = x.filter((t) => y.some((u) => u === t || (t.length > 3 && (u.startsWith(t) || t.startsWith(u))))).length;
  return hit >= Math.min(2, x.length, y.length) || hit / Math.min(x.length, y.length) >= 0.6;
}

/** CPF do comprovante costuma vir mascarado (***.123.456-**): compara os dígitos que aparecem. */
export function cpfMatches(shown, full) {
  const s = digits(shown); const f = digits(full);
  if (!f || s.length < 5) return false;
  if (s.length >= 11) return s.slice(0, 11) === f.slice(0, 11);
  return f.includes(s);
}

/** Pistas dadas por quem mandou (legenda ou resposta): telefone e CPF. */
export function hintsFrom(text) {
  const t = String(text || '');
  const cpf = t.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/)?.[0] || '';
  const phone = t.replace(cpf, ' ').match(/(?:\+?\d{2}\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/)?.[0] || '';
  return { cpf: digits(cpf), phone: digits(phone) };
}

const samePhone = (a, b) => { const x = digits(a); const y = digits(b); return x.length >= 8 && y.length >= 8 && x.slice(-8) === y.slice(-8); };

/**
 * Candidatos que o valor do comprovante quita, entre o que a PESSOA enxerga: parcelas em aberto de vendas e cobranças Pix pendentes.
 * Cada um recebe pontos: telefone ou CPF informado (3), pagador com o nome do cliente (2), cliente em foco (1).
 */
export function findCandidates({ sales = [], payments = [], leadOf = () => null, docOf = () => '', amount, payer = '', payerDoc = '', hints = {}, focusName = '' }) {
  const out = [];
  const score = (name, phone, cpf) => {
    let pts = 0; const why = [];
    if (hints.phone && samePhone(hints.phone, phone)) { pts += 3; why.push('telefone informado'); }
    if (hints.cpf && cpf && digits(cpf) === hints.cpf) { pts += 3; why.push('CPF informado'); }
    if (payerDoc && cpf && cpfMatches(payerDoc, cpf)) { pts += 2; why.push('CPF do pagador'); }
    if (payer && nameMatches(payer, name)) { pts += 2; why.push('pagador é o cliente'); }
    if (focusName && nameMatches(focusName, name)) { pts += 1; why.push('cliente em foco'); }
    return { pts, why };
  };
  for (const s of sales) {
    if (s.status === 'cancelada') continue;
    const name = s.client?.nome || ''; const phone = s.client?.phone || ''; const cpf = docOf(s);
    (s.parcels || []).forEach((p, index) => {
      if (p.status === 'pago' || Math.abs(Number(p.value) - amount) >= 0.005) return;
      out.push({ kind: 'parcela', sale: s, index, parcel: p, name, phone, cpf, label: p.label, ref: s.number, ...score(name, phone, cpf) });
    });
  }
  for (const p of payments) {
    if (p.status !== 'pending' || Math.abs(Number(p.amount) - amount) >= 0.005) continue;
    const lead = leadOf(p);
    const name = p.payerName || lead?.name || ''; const phone = lead?.phone || '';
    out.push({ kind: 'cobranca', payment: p, name, phone, cpf: '', label: p.description || 'Pix', ref: p.id, ...score(name, phone, '') });
  }
  // Com telefone ou CPF informado, só vale quem bate com eles.
  const filtered = hints.phone || hints.cpf ? out.filter((c) => (hints.phone && samePhone(hints.phone, c.phone)) || (hints.cpf && c.cpf && digits(c.cpf) === hints.cpf)) : out;
  return filtered.sort((a, b) => b.pts - a.pts);
}

/** Parcelas em aberto de um cliente (para mostrar quando o valor do comprovante não bate com nenhuma). */
export function openParcelsOf({ sales = [], hints = {}, docOf = () => '' }) {
  const out = [];
  for (const s of sales) {
    if (s.status === 'cancelada') continue;
    if (!((hints.phone && samePhone(hints.phone, s.client?.phone)) || (hints.cpf && docOf(s) && digits(docOf(s)) === hints.cpf))) continue;
    (s.parcels || []).forEach((p, index) => { if (p.status !== 'pago') out.push({ sale: s, index, parcel: p }); });
  }
  return out;
}

/** Conferências do comprovante. Devolve a lista de problemas (vazia = pode dar baixa direta). */
export function receiptProblems({ r, receiverOk, registry = [], hash = '', maxAuto = 5000, now = new Date() }) {
  const problems = [];
  const amount = Math.round(Number(r.valor) * 100) / 100;
  if (r.moeda && r.moeda !== 'BRL') problems.push(`moeda ${r.moeda}`);
  if (r.situacao !== 'concluido') problems.push(`o comprovante não mostra pagamento concluído (${r.situacao || 'sem situação'})`);
  if (!receiverOk(r)) problems.push(`o recebedor (${r.recebedor || 'não aparece'}) não confere com o da Migra`);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(r.data || '') ? r.data : null;
  if (!day) problems.push('data ilegível');
  else {
    const today = now.toISOString().slice(0, 10);
    if (day > new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10)) problems.push(`data ${brDate(day)} no futuro`);
    else if (day < new Date(now.getTime() - 60 * 86_400_000).toISOString().slice(0, 10)) problems.push(`comprovante antigo (${brDate(day)}, mais de 60 dias)`);
    void today;
  }
  const ref = String(r.id_transacao || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (ref.length < 10) problems.push('sem número de transação legível');
  if (r.parece_adulterado) problems.push('a imagem parece editada');
  if (amount > maxAuto) problems.push(`valor acima do limite de baixa automática (${money(maxAuto)})`);
  return { problems, ref, hash };
}

/** Já lançado antes? (mesmo número de transação ou mesmo arquivo) → o lançamento antigo. */
export function alreadyUsed(registry, { ref, hash }) {
  return registry.find((x) => (ref && ref.length >= 10 && x.ref === ref) || (hash && x.hash === hash)) || null;
}
