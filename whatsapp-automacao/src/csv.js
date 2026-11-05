// Planilhas (CSV para Excel brasileiro): ponto e vírgula, acentos corretos e proteção contra "fórmula" injetada no texto
// (um nome começando com = + - @ viraria uma fórmula ao abrir no Excel).
export const csvCell = (v) => {
  let s = v instanceof Date ? v.toISOString() : String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};
/** columns: [{ key, label, get?(row) }] */
export function toCsv(rows, columns) {
  const head = columns.map((c) => csvCell(c.label)).join(';');
  const body = rows.map((r) => columns.map((c) => csvCell(c.get ? c.get(r) : r[c.key])).join(';'));
  return `﻿${[head, ...body].join('\r\n')}`;
}
export const brNumber = (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }));
export const brDate = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
