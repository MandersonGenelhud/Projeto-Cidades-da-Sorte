// Baixa de pagamento pela Maria: o vendedor manda o comprovante (foto ou PDF), a Maria lê, descobre de quem é o pagamento e qual parcela ou
// cobrança ele quita, e dá a baixa depois do "sim" de quem mandou. Se o pagador não é o cliente (outra pessoa pagou), ela pede o WhatsApp ou
// o CPF do CLIENTE e dá a baixa no cliente certo. Mesmas conferências da leitura de comprovante do atendimento: valor, recebedor, data,
// pagamento concluído, número da transação único e valor dentro do limite. Qualquer dúvida vai para o administrador conferir no banco.

import { isBrazilLocal } from './utils.js';

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

/** CPF válido? (dígitos verificadores) Usado para decidir se 11 dígitos soltos são CPF ou celular. */
function cpfOk(d) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (n) => { let sum = 0; for (let i = 0; i < n; i++) sum += Number(d[i]) * (n + 1 - i); const r = (sum * 10) % 11; return r === 10 ? 0 : r; };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}
/** DDD + número do Brasil (10 ou 11 dígitos, DDD de 11 a 99). */
const localBr = (d) => isBrazilLocal(d);

/**
 * Pistas dadas por quem mandou (legenda ou resposta): telefone e CPF. Entende "+55 44 99999-1111", "(44) 9 9999-1111", "44999991111" e CPF com ou sem pontos.
 * Onze dígitos soltos que são um CPF válido valem como CPF; os que parecem celular valem como telefone (se for os dois, vale os dois).
 */
export function hintsFrom(text) {
  let t = String(text || '');
  let cpf = ''; let phone = '';
  // CPF formatado (000.000.000-00) sai primeiro, para não ser confundido com telefone.
  const fmt = t.match(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/)?.[0];
  if (fmt) { cpf = digits(fmt); t = t.replace(fmt, ' '); }
  // Sequências de números com os separadores comuns; cada uma vale como telefone ou CPF.
  for (const m of t.match(/\+?[\d()][\d\s().+-]{8,}\d/g) || []) {
    let d = digits(m);
    if (m.trim().startsWith('+')) { if (d.length >= 11 && d.length <= 15 && !phone) phone = d; continue; }
    d = d.replace(/^0+/, '');
    if (d.length === 11 && cpfOk(d) && !cpf) cpf = d;
    if (!phone && ((d.length >= 12 && d.length <= 15) || localBr(d))) phone = d;
    if (!cpf && !fmt && d.length === 11 && /^\d{11}$/.test(digits(m)) && cpfOk(d)) cpf = d;
  }
  return { cpf, phone };
}

/** Telefone que está na chave da conversa do WhatsApp (5545...@s.whatsapp.net); Instagram não tem. */
const phoneOfKey = (key) => (key && !String(key).startsWith('ig:') && /@s\.whatsapp\.net$/.test(String(key)) ? digits(String(key).split('@')[0]) : '');
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
    const name = p.payerName || lead?.name || '';
    // O telefone do cliente vem do prospecto, do que ficou gravado no próprio Pix ou da conversa (WhatsApp); o CPF, do Pix. Instagram sem telefone ainda acha pelo CPF.
    const phone = lead?.phone || p.payerPhone || phoneOfKey(p.convKey);
    const cpf = p.payerDoc || '';
    out.push({ kind: 'cobranca', payment: p, name, phone, cpf, label: p.description || 'Pix', ref: p.id, ...score(name, phone, cpf) });
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

/** Cobranças Pix em aberto de um cliente (para explicar quando o valor do comprovante é diferente do Pix). */
export function openChargesOf({ payments = [], leadOf = () => null, hints = {} }) {
  return payments.filter((p) => {
    if (p.status !== 'pending') return false;
    const lead = leadOf(p);
    const phone = lead?.phone || p.payerPhone || phoneOfKey(p.convKey);
    return (hints.phone && samePhone(hints.phone, phone)) || (hints.cpf && p.payerDoc && digits(p.payerDoc) === hints.cpf);
  });
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
