// Relatórios em planilha (CSV): vendas, parcelas em aberto, contratos cancelados e auditoria. Só administrador.
import { toCsv, brNumber, brDate } from './csv.js';

const inRange = (d, from, to) => { const s = String(d || '').slice(0, 10); return (!from || s >= from) && (!to || s <= to); };
const sum = (l, f) => Math.round(l.reduce((a, x) => a + Number(f(x) || 0), 0) * 100) / 100;

export const REPORTS = {
  vendas: { file: 'vendas', title: 'Vendas' },
  parcelas: { file: 'parcelas-em-aberto', title: 'Parcelas em aberto' },
  cancelados: { file: 'contratos-cancelados', title: 'Contratos cancelados (desativados)' },
};

/** sales: lista de vendas já filtrada pelo escritório. from/to: AAAA-MM-DD (data de lançamento da venda; vencimento nas parcelas). */
export function reportCsv(kind, sales, { from = '', to = '', seller = '', today = new Date().toISOString().slice(0, 10) } = {}) {
  const mine = sales.filter((s) => !seller || s.sellerId === seller || s.sellerName === seller);
  if (kind === 'vendas') {
    const rows = mine.filter((s) => s.status !== 'cancelada' && inRange(s.createdAt, from, to));
    const paid = (s) => sum((s.parcels || []).filter((p) => p.status === 'pago'), (p) => p.value);
    return toCsv(rows, [
      { label: 'Número', key: 'number' }, { label: 'Data', get: (s) => brDate(s.createdAt) }, { label: 'Cliente', get: (s) => s.client?.nome || '' },
      { label: 'Vendedor', key: 'sellerName' }, { label: 'Serviços', get: (s) => (s.items || []).map((i) => `${i.name} x${i.qty}`).join(' + ') },
      { label: 'Total (R$)', get: (s) => brNumber(s.total) }, { label: 'Recebido (R$)', get: (s) => brNumber(paid(s)) }, { label: 'Em aberto (R$)', get: (s) => brNumber(Number(s.total || 0) - paid(s)) },
      { label: 'Comissão (R$)', get: (s) => brNumber(s.commission?.value) }, { label: 'Comissão paga', get: (s) => (s.commission?.status === 'paga' ? 'sim' : 'não') }, { label: 'Situação', key: 'status' },
    ]);
  }
  if (kind === 'parcelas') {
    const rows = [];
    for (const s of mine.filter((x) => x.status !== 'cancelada')) for (const p of s.parcels || []) if (p.status !== 'pago' && p.due && inRange(p.due, from, to)) rows.push({ s, p });
    rows.sort((a, b) => a.p.due.localeCompare(b.p.due));
    return toCsv(rows, [
      { label: 'Vencimento', get: ({ p }) => brDate(p.due) }, { label: 'Número', get: ({ s }) => s.number }, { label: 'Cliente', get: ({ s }) => s.client?.nome || '' },
      { label: 'Telefone', get: ({ s }) => s.client?.phone || '' }, { label: 'Parcela', get: ({ p }) => p.label }, { label: 'Valor (R$)', get: ({ p }) => brNumber(p.value) },
      { label: 'Dias de atraso', get: ({ p }) => Math.max(0, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${p.due}T12:00:00Z`)) / 86_400_000)) },
      { label: 'Vendedor', get: ({ s }) => s.sellerName || '' },
    ]);
  }
  if (kind === 'cancelados') {
    const rows = mine.filter((s) => s.status === 'cancelada' && inRange(s.createdAt, from, to));
    const reason = (s) => (s.history || []).filter((h) => /cancelad/i.test(h.text)).at(-1);
    return toCsv(rows, [
      { label: 'Número', key: 'number' }, { label: 'Cliente', get: (s) => s.client?.nome || '' }, { label: 'Vendedor', key: 'sellerName' }, { label: 'Total (R$)', get: (s) => brNumber(s.total) },
      { label: 'Recebido antes do cancelamento (R$)', get: (s) => brNumber(sum((s.parcels || []).filter((p) => p.status === 'pago'), (p) => p.value)) },
      { label: 'Cancelado em', get: (s) => brDate(reason(s)?.at) }, { label: 'Por', get: (s) => reason(s)?.by || '' }, { label: 'Motivo', get: (s) => (reason(s)?.text || '').replace(/^Venda cancelada:\s*/i, '') },
    ]);
  }
  return null;
}

export function auditCsv(items) {
  return toCsv(items, [
    { label: 'Quando', get: (e) => new Date(e.at).toLocaleString('pt-BR') }, { label: 'Quem', key: 'user' }, { label: 'Perfil', key: 'role' }, { label: 'Ação', key: 'action' },
    { label: 'Tipo', key: 'entity' }, { label: 'Referência', key: 'label' }, { label: 'Mudanças', get: (e) => (e.changes || []).map((c) => `${c.label}: ${c.from || '-'} -> ${c.to || '-'}`).join(' | ') || e.note || '' },
    { label: 'Sensível', get: (e) => (e.sensitive ? 'sim' : '') }, { label: 'IP', key: 'ip' },
  ]);
}
