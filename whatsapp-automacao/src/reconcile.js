// Conferência dos contratos e do dinheiro: acha contratos repetidos, valores que não fecham e diferenças em relação ao sistema antigo
// (a cópia capturada), e mostra os totais (a receber, recebido no mês, em atraso) com e sem os repetidos prováveis.
// Este módulo SÓ LÊ. Quem arquiva um repetido é o administrador, um a um, pela rota própria (e dá para restaurar).
import { norm } from './legacy-import.js';

const cents = (v) => Math.round(Number(v || 0) * 100) / 100;
const digits = (s) => String(s || '').replace(/\D/g, '');
const ym = (d) => String(d || '').slice(0, 7);
const DAY = 86_400_000;
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY);

const paidOf = (s) => cents((s.parcels || []).filter((p) => p.status === 'pago').reduce((a, p) => a + Number(p.value || 0), 0));
const sumOf = (s) => cents((s.parcels || []).reduce((a, p) => a + Number(p.value || 0), 0));
/** Baixa feita por uma pessoa aqui no sistema novo (não veio só da importação). */
const humanPaid = (s) => (s.parcels || []).some((p) => p.status === 'pago' && p.confirmedBy && p.confirmedBy !== 'Importação');
const brief = (s) => ({ id: s.id, number: s.legacyNumber || s.number, client: s.client?.nome || '', total: cents(s.total), paid: paidOf(s), parcels: (s.parcels || []).length, legacy: Boolean(s.legacy), createdAt: String(s.createdAt || '').slice(0, 10) });

/** Quem é o cliente: CPF/documento, senão telefone, senão o nome sem acento. */
export function identityOf(s) {
  const doc = digits(s.client?.doc); if (doc.length >= 6) return `doc:${doc}`;
  const ph = digits(s.client?.phone); if (ph.length >= 8) return `tel:${ph.slice(-9)}`;
  return `nome:${norm(s.client?.nome)}`;
}
const signature = (s) => (s.parcels || []).map((p) => `${cents(p.value)}@${p.due || ''}`).sort().join('|');

/** Qual contrato fica: o criado aqui (não do sistema antigo), com mais baixas feitas por pessoas, mais parcelas pagas e o mais antigo. */
const keepScore = (s) => [s.legacy ? 0 : 1, humanPaid(s) ? 1 : 0, (s.parcels || []).filter((p) => p.status === 'pago').length, -Date.parse(s.createdAt || 0)];
const cmp = (a, b) => { const x = keepScore(a); const y = keepScore(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i] - x[i]; return 0; };

export function findDuplicates(sales) {
  const live = sales.filter((s) => s.status !== 'cancelada' && Number(s.total) > 0);
  const groups = new Map();
  for (const s of live) {
    const k = `${identityOf(s)}|${cents(s.total)}`;
    (groups.get(k) || groups.set(k, []).get(k)).push(s);
  }
  // O mesmo número do sistema antigo importado duas vezes também é repetido, mesmo com valor diferente.
  const byNumber = new Map();
  for (const s of live) if (s.legacy && s.legacyNumber) (byNumber.get(String(s.legacyNumber)) || byNumber.set(String(s.legacyNumber), []).get(String(s.legacyNumber))).push(s);
  const out = []; const used = new Set();
  const push = (list, reason, confidence) => {
    // Quem já foi apontado como repetido não é apontado de novo, mas ainda pode ser o contrato "que fica" de outro grupo.
    const sorted = [...list].sort(cmp);
    const [keep, ...rest] = sorted;
    const extras = rest.filter((s) => !used.has(s.id));
    if (!extras.length) return;
    extras.forEach((s) => used.add(s.id));
    out.push({
      reason, confidence, client: keep.client?.nome || '', keep: brief(keep),
      extras: extras.map((s) => {
        const canArchive = Boolean(s.legacy) && !humanPaid(s);
        return { ...brief(s), canArchive, whyNot: canArchive ? '' : s.legacy ? 'tem baixa feita por uma pessoa neste sistema: confira à mão' : 'foi criado neste sistema (com comissão e histórico): confira à mão' };
      }),
    });
  };
  for (const list of byNumber.values()) push(list, 'mesmo número de contrato do sistema antigo', 'igual');
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const sig = new Map();
    for (const s of list) (sig.get(signature(s)) || sig.set(signature(s), []).get(signature(s))).push(s);
    for (const l of sig.values()) push(l, 'mesmo cliente, mesmo valor e mesmas parcelas', 'igual');
    push(list, 'mesmo cliente e mesmo valor total (datas diferentes): confirme no contrato', 'provavel');
  }
  return out;
}

export function findIssues(sales, today) {
  const out = [];
  const add = (s, kind, text, severity = 'atencao') => out.push({ saleId: s.id, number: s.legacyNumber || s.number, client: s.client?.nome || '', kind, text, severity });
  for (const s of sales) {
    if (s.status === 'cancelada') continue;
    const parcels = s.parcels || [];
    if (!(Number(s.total) > 0)) add(s, 'valor', 'Contrato sem valor total.', 'urgente');
    const diff = cents(sumOf(s) - Number(s.total || 0));
    if (Math.abs(diff) > 0.05) add(s, 'soma', `A soma das parcelas (R$ ${sumOf(s).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}) não fecha com o total do contrato (diferença de R$ ${Math.abs(diff).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}).`, 'urgente');
    if (parcels.some((p) => p.status !== 'pago' && !p.due)) add(s, 'sem_data', 'Tem parcela em aberto sem data de vencimento: não entra na cobrança nem na previsão.');
    if (parcels.some((p) => p.status === 'pago' && !p.paidAt)) add(s, 'sem_pagamento', 'Tem parcela paga sem a data do pagamento: não entra em "recebido no mês".');
    if (parcels.some((p) => !(Number(p.value) > 0))) add(s, 'parcela_zero', 'Tem parcela com valor zero ou negativo.', 'urgente');
    if (s.legacySynthetic) add(s, 'aproximado', 'O sistema antigo trouxe só "pago" e "saldo": as parcelas e a data do saldo são aproximadas. Confira no contrato original.', 'info');
    const old = parcels.filter((p) => p.status !== 'pago' && p.due && daysBetween(p.due, today) > 365);
    if (old.length) add(s, 'muito_antiga', `${old.length} parcela(s) vencida(s) há mais de 1 ano: confirme se ainda vale cobrar ou se o contrato foi cancelado/quitado.`, 'info');
    if (parcels.some((p) => p.status !== 'pago' && p.due && p.due < today) && !digits(s.client?.phone)) add(s, 'sem_telefone', 'Tem parcela vencida e o cliente está sem telefone: não dá para cobrar por aqui.');
  }
  return out;
}

/** Compara a cópia do sistema antigo (legacy) com as vendas criadas a partir dela. */
export function legacyDiff(sales, legacy) {
  const out = [];
  const byNum = new Map(); for (const s of sales) if (s.legacy && s.legacyNumber) (byNum.get(String(s.legacyNumber)) || byNum.set(String(s.legacyNumber), []).get(String(s.legacyNumber))).push(s);
  const seen = new Set();
  for (const r of legacy) {
    const num = String(r.number || ''); if (!num) continue;
    seen.add(num);
    const list = byNum.get(num) || [];
    const cancelledOld = /cancel|rescind|distrat/i.test(r.status || '');
    const base = { number: num, client: r.client || '', legacy: { value: r.value ?? null, paid: r.paid ?? null, status: r.status || '' } };
    if (!list.length) { if (!cancelledOld && Number(r.value) > 0) out.push({ ...base, kind: 'sem_venda', text: 'Está no sistema antigo, mas não virou contrato aqui (a cópia não trouxe parcelas).' }); continue; }
    const s = list.find((x) => x.status !== 'cancelada') || list[0];
    const sale = { total: cents(s.total), paid: paidOf(s), status: s.status };
    if (r.value != null && Math.abs(cents(r.value) - sale.total) > 0.05) out.push({ ...base, sale, kind: 'valor_diferente', text: 'O valor do contrato é diferente do sistema antigo.' });
    if (r.paid != null && Math.abs(cents(r.paid) - sale.paid) > 0.05) out.push({ ...base, sale, kind: 'pago_diferente', text: humanPaid(s) ? 'O pago é diferente porque houve baixa aqui depois da importação: confira se a baixa está certa.' : 'O valor pago é diferente do sistema antigo.' });
    if (cancelledOld && s.status !== 'cancelada') out.push({ ...base, sale, kind: 'status_diferente', text: 'Está cancelado no sistema antigo e ativo aqui.' });
  }
  for (const s of sales) if (s.legacy && s.legacyNumber && legacy.length && !seen.has(String(s.legacyNumber)) && s.status !== 'cancelada') out.push({ number: String(s.legacyNumber), client: s.client?.nome || '', kind: 'fora_da_copia', sale: { total: cents(s.total), paid: paidOf(s), status: s.status }, text: 'Está aqui, mas não aparece na última cópia do sistema antigo.' });
  return out;
}

/** Os totais usados nos painéis: a receber no mês, recebido no mês, em atraso e em aberto. */
export function totals(sales, today, { exclude = new Set() } = {}) {
  const month = ym(today);
  const t = { month, recebidoMes: 0, aReceberMes: 0, atraso: 0, atrasoParcelas: 0, aberto: 0 };
  for (const s of sales) {
    if (s.status === 'cancelada' || exclude.has(s.id)) continue;
    for (const p of s.parcels || []) {
      const v = Number(p.value || 0);
      if (p.status === 'pago') { if (ym(p.paidAt) === month) t.recebidoMes += v; continue; }
      t.aberto += v;
      if (!p.due) continue;
      if (p.due < today) { t.atraso += v; t.atrasoParcelas += 1; } else if (ym(p.due) === month) t.aReceberMes += v;
    }
  }
  for (const k of ['recebidoMes', 'aReceberMes', 'atraso', 'aberto']) t[k] = cents(t[k]);
  return t;
}

export function reconcile({ sales, legacy = [], today = new Date().toISOString().slice(0, 10) }) {
  const duplicates = findDuplicates(sales);
  const removable = new Set(duplicates.flatMap((g) => g.extras.filter((e) => e.canArchive).map((e) => e.id)));
  const issues = findIssues(sales, today);
  const diffs = legacyDiff(sales, legacy);
  const count = (list, key) => list.reduce((m, x) => ({ ...m, [x[key]]: (m[x[key]] || 0) + 1 }), {});
  return {
    today, totals: totals(sales, today), totalsWithoutDuplicates: totals(sales, today, { exclude: removable }),
    contracts: sales.filter((s) => s.status !== 'cancelada').length, legacyRecords: legacy.length,
    duplicates, issues, diffs, issueCounts: count(issues, 'kind'), diffCounts: count(diffs, 'kind'),
  };
}
