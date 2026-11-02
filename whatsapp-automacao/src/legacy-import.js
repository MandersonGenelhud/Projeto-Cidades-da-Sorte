// Contratos do sistema antigo (do Marcos): lê o arquivo capturado pela ferramenta
// `tools/capturar-sistema`, reconhece sozinho as colunas (número, cliente, valor, data…),
// junta duplicados e guarda tudo no arquivo de contratos antigos (só administrador vê).
import crypto from 'node:crypto';

const err = (status, message) => Object.assign(new Error(message), { status });
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Cada campo do Migra Hub e os nomes que o sistema antigo pode ter usado (sem acento, minúsculo).
const SYN = {
  number: [/^(n|no|num|numero|nro|n o)( do)?( contrato)?$/, /^(numero|codigo|cod|id)( do)? contrato$/, /^contrato( n.*)?$/, /^codigo$/, /^cod$/, /^id$/],
  client: [/^(nome|cliente|contratante|comprador|titular)( completo| do cliente)?$/, /^razao social$/],
  doc: [/^(cpf|cnpj|cedula|ci|rg|documento|ruc|cpf cnpj|cedula de identidade)( do cliente)?$/, /^(numero do )?documento$/],
  phone: [/^(telefone|celular|whatsapp|fone|tel|contato)( do cliente)?$/],
  email: [/^e ?mail( do cliente)?$/],
  value: [/^(valor|total|preco|valor total|valor do contrato|valor liquido|valor bruto)$/, /^valor( .*)?$/],
  date: [/^(data|emissao|data de emissao|data do contrato|assinatura|data de assinatura|criado em|data de criacao|cadastro|data de cadastro)$/, /^data( .*)?$/],
  status: [/^(status|situacao|estado)( do contrato)?$/],
  service: [/^(servico|servicos|pacote|produto|plano|descricao|objeto|tipo)( do contrato)?$/],
  installments: [/^(parcelas|n de parcelas|numero de parcelas|qtd parcelas|quantidade de parcelas)$/],
  seller: [/^(vendedor|consultor|responsavel|atendente|comercial)$/],
};
const field = (label) => {
  const k = norm(label);
  for (const [name, list] of Object.entries(SYN)) if (list.some((re) => re.test(k))) return name;
  return null;
};

/** "R$ 1.234,56" | "1,234.56" | "1234.5" → número. */
export function parseMoney(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '').replace(/[^\d.,-]/g, '');
  if (!/\d/.test(s)) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let n;
  if (lastComma > lastDot) n = s.replace(/\./g, '').replace(',', '.');
  else if (lastDot > lastComma && /\.\d{1,2}$/.test(s)) n = s.replace(/,/g, '');
  else n = s.replace(/[.,]/g, '');
  const out = Number(n);
  return Number.isFinite(out) ? out : null;
}
/** "25/12/2024" | "2024-12-25T10:00" → "2024-12-25". */
export function parseDate(v) {
  const s = String(v ?? '').trim();
  let m = s.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}
const currencyOf = (v) => (/us\$|usd|\$ ?\d/i.test(String(v)) && !/r\$/i.test(String(v)) ? 'USD' : /gs|₲|guarani/i.test(String(v)) ? 'PYG' : 'BRL');

/** Objeto cru (rótulo → valor) → registro normalizado. Devolve null se não parece um contrato. */
export function normalizeRecord(raw, { source = '' } = {}) {
  const rec = { number: '', client: '', doc: '', phone: '', email: '', value: null, currency: 'BRL', date: '', status: '', service: '', installments: null, seller: '', source, raw: {} };
  let valueText = '';
  for (const [label, val] of Object.entries(raw || {})) {
    if (val === null || val === undefined || typeof val === 'object') continue;
    const text = String(val).trim();
    if (!text || text.length > 500) continue;
    rec.raw[String(label).slice(0, 60)] = text;
    const f = field(label);
    if (!f || rec[f] === '' || rec[f] === null) {
      if (f === 'value') { const n = parseMoney(text); if (n !== null && rec.value === null) { rec.value = n; valueText = text; } }
      else if (f === 'date') { const d = parseDate(text); if (d && !rec.date) rec.date = d; }
      else if (f === 'installments') { const n = parseMoney(text); if (n !== null) rec.installments = Math.round(n); }
      else if (f && !rec[f]) rec[f] = text.slice(0, 160);
    }
  }
  if (valueText) rec.currency = currencyOf(valueText);
  // Parece contrato? Precisa de número ou (cliente e valor).
  if (!rec.number && !(rec.client && rec.value !== null)) return null;
  rec.number = String(rec.number).replace(/^#/, '').trim();
  return rec;
}

export function* objectsIn(json, depth = 0) {
  if (depth > 4 || json === null) return;
  if (Array.isArray(json)) {
    for (const x of json) {
      if (x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length >= 3) yield x;
      else yield* objectsIn(x, depth + 1);
    }
  } else if (typeof json === 'object') for (const v of Object.values(json)) yield* objectsIn(v, depth + 1);
}
export const flat = (o, prefix = '') => Object.entries(o).reduce((acc, [k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? { ...acc, ...flat(v, `${prefix}${k} `) } : { ...acc, [`${prefix}${k}`]: v }), {});

/** captura = { pages: [{url, title, tables:[{headers, rows}], fields:[{label,value}]}], api: [{url, json}] } */
export function extractRecords(captura) {
  const out = [];
  const push = (raw, source) => { const r = normalizeRecord(raw, { source }); if (r) out.push(r); };
  for (const a of captura?.api || []) for (const o of objectsIn(a.json)) push(flat(o), a.url);
  for (const p of captura?.pages || []) {
    for (const t of p.tables || []) {
      const headers = (t.headers || []).map((h) => String(h || '').trim());
      if (headers.filter(Boolean).length < 2) continue;
      for (const row of t.rows || []) push(Object.fromEntries(headers.map((h, i) => [h || `col${i}`, row[i]])), p.url);
    }
    const f = Object.fromEntries((p.fields || []).map((x) => [x.label, x.value]));
    if (Object.keys(f).length >= 3) push(f, p.url);
  }
  return mergeRecords(out);
}

const keyOf = (r) => (r.number ? `n:${norm(r.number)}` : `c:${norm(r.client)}|${r.value}|${r.date}`);
/** Junta duplicados (a mesma venda vista na lista e na ficha): campos vazios são completados. */
export function mergeRecords(list) {
  const map = new Map();
  for (const r of list) {
    const k = keyOf(r);
    const cur = map.get(k);
    if (!cur) { map.set(k, { ...r, raw: { ...r.raw } }); continue; }
    for (const f of Object.keys(r)) if (f !== 'raw' && f !== 'source' && (cur[f] === '' || cur[f] === null) && r[f] !== '' && r[f] !== null) cur[f] = r[f];
    Object.assign(cur.raw, r.raw);
  }
  return [...map.values()];
}

/** Maior número de contrato (só os que são puramente numéricos ou terminam em número). */
export function lastNumber(records) {
  let max = 0;
  for (const r of records) {
    const m = String(r.number).match(/(\d+)\s*$/);
    if (m && Number(m[1]) > max && Number(m[1]) < 10_000_000) max = Number(m[1]);
  }
  return max;
}

export function summarize(records) {
  const withNum = records.filter((r) => r.number).length;
  return {
    total: records.length, comNumero: withNum, comCliente: records.filter((r) => r.client).length, comValor: records.filter((r) => r.value !== null).length,
    comData: records.filter((r) => r.date).length, ultimoNumero: lastNumber(records),
    valorTotal: Math.round(records.reduce((a, r) => a + (r.value || 0), 0) * 100) / 100,
    exemplo: records.slice(0, 5).map(({ raw, source, ...r }) => r),
  };
}

export class LegacyContracts {
  constructor({ store }) {
    this.store = store;
    store.data.legacyContracts ||= [];
  }

  get list() {
    return this.store.data.legacyContracts;
  }

  preview(captura) {
    const records = extractRecords(captura);
    if (!records.length) throw err(400, 'Não encontrei contratos neste arquivo. Mande o arquivo "mapa.txt" para eu ajustar o leitor ao sistema.');
    return summarize(records);
  }

  /** Grava os registros novos (por número) e completa os que já existem. */
  import(captura, user) {
    const records = extractRecords(captura);
    if (!records.length) throw err(400, 'Não encontrei contratos neste arquivo.');
    let added = 0; let updated = 0;
    const byKey = new Map(this.list.map((r) => [keyOf(r), r]));
    for (const r of records) {
      const cur = byKey.get(keyOf(r));
      if (cur) {
        for (const f of Object.keys(r)) if (f !== 'raw' && (cur[f] === '' || cur[f] === null) && r[f] !== '' && r[f] !== null) cur[f] = r[f];
        cur.raw = { ...r.raw, ...cur.raw };
        updated += 1;
      } else {
        const rec = { id: crypto.randomBytes(6).toString('hex'), importedAt: new Date().toISOString(), importedBy: user?.name || '', ...r };
        this.list.push(rec);
        byKey.set(keyOf(rec), rec);
        added += 1;
      }
    }
    this.store.save();
    return { added, updated, total: this.list.length, ultimoNumero: lastNumber(this.list) };
  }

  search({ q = '', limit = 200 } = {}) {
    const n = norm(q);
    return this.list
      .filter((r) => !n || norm(`${r.number} ${r.client} ${r.doc} ${r.phone} ${r.service} ${r.seller}`).includes(n))
      .sort((a, b) => (Number(b.number.match(/\d+/)?.[0]) || 0) - (Number(a.number.match(/\d+/)?.[0]) || 0))
      .slice(0, Math.min(Number(limit) || 200, 1000));
  }

  get(id) {
    return this.list.find((r) => r.id === id) || null;
  }

  csv() {
    const cols = ['number', 'client', 'doc', 'phone', 'email', 'value', 'currency', 'date', 'status', 'service', 'installments', 'seller'];
    const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
    return `﻿${[cols.join(';'), ...this.list.map((r) => cols.map((c) => cell(r[c])).join(';'))].join('\r\n')}`;
  }
}
