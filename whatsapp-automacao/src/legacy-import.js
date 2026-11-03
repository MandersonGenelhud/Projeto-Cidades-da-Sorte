// Contratos do sistema antigo (do Marcos): lê o arquivo capturado pela ferramenta
// `tools/capturar-sistema`, reconhece sozinho as colunas (número, cliente, valor, data…),
// junta duplicados e guarda tudo no arquivo de contratos antigos (só administrador vê).
import crypto from 'node:crypto';

import { normalizePhone } from './utils.js';
const normalizePhoneLoose = (v) => normalizePhone(v) || normalizePhone(`+${String(v || '').replace(/\D/g, '')}`) || null;
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

const PAID = /(pago|paga|quitad|recebid|liquidad|confirmad)/;
const OPENISH = /(pend|abert|vencid|atras|aguard|nao pag)/;
/** Tabelas de parcelas (colunas de vencimento e valor) → [{label, due, value, status, paidAt}]. */
export function parcelsFromTables(tables = []) {
  const out = [];
  for (const t of tables) {
    const h = (t.headers || []).map((x) => norm(x));
    const iDue = h.findIndex((x) => /venc/.test(x));
    const iVal = h.findIndex((x) => /valor|total/.test(x));
    if (iDue < 0 || iVal < 0) continue;
    const iSt = h.findIndex((x) => /status|situacao/.test(x));
    const iPaidAt = h.findIndex((x, i) => i !== iDue && /(pago em|data (do )?pagamento|pagamento em|baixa|data pag)/.test(x));
    const iLabel = h.findIndex((x, i) => i !== iDue && i !== iVal && /(parcela|descri|^n|^#)/.test(x));
    t.rows.forEach((r, k) => {
      const value = parseMoney(r[iVal]);
      const due = parseDate(r[iDue]);
      if (value === null || !due) return;
      const st = norm(iSt >= 0 ? r[iSt] : '');
      const paidAt = iPaidAt >= 0 ? parseDate(r[iPaidAt]) : '';
      const paid = PAID.test(st) && !/nao pag/.test(st) ? true : OPENISH.test(st) ? false : Boolean(paidAt);
      out.push({ label: String((iLabel >= 0 ? r[iLabel] : '') || `Parcela ${k + 1}`).slice(0, 40), due, value, paid, paidAt: paid ? paidAt || due : '' });
    });
  }
  return out;
}

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
    const parcels = parcelsFromTables(p.tables);
    if (Object.keys(f).length >= 3 || parcels.length) {
      const rec = normalizeRecord(f, { source: p.url });
      if (rec) { if (parcels.length) rec.parcels = parcels; out.push(rec); }
    }
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
    for (const f of Object.keys(r)) if (f !== 'raw' && f !== 'source' && f !== 'parcels' && (cur[f] === '' || cur[f] === null) && r[f] !== '' && r[f] !== null) cur[f] = r[f];
    if (!cur.parcels?.length && r.parcels?.length) cur.parcels = r.parcels;
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

export function parcelStats(records, today = new Date().toISOString().slice(0, 10)) {
  const all = records.flatMap((r) => r.parcels || []);
  const late = all.filter((p) => !p.paid && p.due < today);
  const sum = (l) => Math.round(l.reduce((a, p) => a + p.value, 0) * 100) / 100;
  return { comParcelas: records.filter((r) => r.parcels?.length).length, parcelas: all.length, parcelasAtrasadas: late.length, valorAtrasado: sum(late), valorAReceber: sum(all.filter((p) => !p.paid)) };
}

export function summarize(records) {
  const withNum = records.filter((r) => r.number).length;
  return {
    total: records.length, comNumero: withNum, comCliente: records.filter((r) => r.client).length, comValor: records.filter((r) => r.value !== null).length,
    comData: records.filter((r) => r.date).length, ultimoNumero: lastNumber(records),
    valorTotal: Math.round(records.reduce((a, r) => a + (r.value || 0), 0) * 100) / 100,
    ...parcelStats(records),
    exemplo: records.slice(0, 5).map(({ raw, source, ...r }) => r),
  };
}

const digits = (v) => String(v || '').replace(/\D/g, '');
/** Chaves para reconhecer a mesma pessoa: documento, telefone ou nome (a primeira que bater junta os cadastros). */
const clientKeys = (c) => [c.doc && `d:${norm(c.doc)}`, digits(c.phone).length >= 8 && `p:${digits(c.phone)}`, c.name && `n:${norm(c.name)}`].filter(Boolean);
function mergeClient(index, list, c) {
  const hit = clientKeys(c).map((k) => index.get(k)).find(Boolean);
  if (hit) {
    for (const f of ['name', 'doc', 'phone', 'email']) if (!hit[f] && c[f]) hit[f] = c[f];
    hit.extra = { ...(c.extra || {}), ...(hit.extra || {}) };
    for (const k of clientKeys(hit)) if (!index.has(k)) index.set(k, hit);
    return null;
  }
  const rec = { ...c, extra: { ...(c.extra || {}) } };
  list.push(rec);
  for (const k of clientKeys(rec)) index.set(k, rec);
  return rec;
}
const ENTITY = { clientes: /(client|customer|cliente)/, contratos: /(contract|contrato)/, processos: /(process)/, documentos: /(document)/, orcamentos: /(quote|budget|orcamento)/, leads: /(lead)/ };
const entityOf = (text) => Object.entries(ENTITY).find(([, re]) => re.test(norm(text)))?.[0] || '';
const n2 = (v) => Number(String(v).replace(/\./g, '').replace(',', '.')) || 0;

/**
 * Auditoria da cópia: o que o sistema antigo diz que tem (números nas telas: "Mostrando 1 a 10 de 371", "371 clientes")
 * contra o que foi realmente copiado, mais as páginas que não abriram e os arquivos baixados.
 */
export function auditCapture(captura, { contracts = [], clients = [] } = {}) {
  const pages = captura?.pages || [];
  const expected = {};
  const bump = (ent, n) => { if (ent && n > 0 && n > (expected[ent] || 0) && n < 5_000_000) expected[ent] = n; };
  for (const p of pages) {
    const urlEnt = entityOf(new URL(p.url, 'http://x').pathname);
    for (const line of String(p.texto || '').split('\n')) {
      let m = /(?:mostrando|exibindo|showing)[^\d]{0,15}\d[\d.]*\s*(?:a|-|–|até|to)\s*\d[\d.]*\s*(?:de|of)\s*(\d[\d.]*)/i.exec(line);
      if (m) bump(entityOf(line) || urlEnt, n2(m[1]));
      m = /(\d[\d.]*)\s+(clientes?|customers?|contratos?|contracts?|processos?|processes|documentos?|documents?|or[çc]amentos?|quotes?|leads?)\b/i.exec(line);
      if (m && n2(m[1]) >= 2) bump(entityOf(m[2]), n2(m[1]));
    }
  }
  // O que foi copiado: linhas de tabela das páginas de cada assunto.
  const rows = {};
  for (const p of pages) {
    const ent = entityOf(new URL(p.url, 'http://x').pathname);
    if (!ent) continue;
    const seen = (rows[ent] ||= new Set());
    for (const t of p.tables || []) for (const r of t.rows || []) seen.add(r.join('\u0001'));
  }
  const got = { contratos: contracts.length, clientes: clients.length };
  for (const [ent, set] of Object.entries(rows)) got[ent] = Math.max(got[ent] || 0, set.size);
  const items = Object.keys({ ...expected, ...got }).map((ent) => {
    const esperado = expected[ent] ?? null; const copiado = got[ent] ?? 0;
    return { entity: ent, esperado, copiado, status: esperado === null ? 'sem referência' : copiado >= esperado * 0.98 ? 'ok' : 'faltam', faltam: esperado === null ? null : Math.max(0, esperado - copiado) };
  });
  const files = pages.reduce((a, p) => a + (p.arquivos?.length || 0), 0);
  return {
    at: new Date().toISOString(), paginas: pages.length, falhas: (captura?.falhas || []).slice(0, 100), arquivos: files, respostasJson: (captura?.api || []).length,
    contratosSemParcelas: contracts.filter((r) => !r.parcels?.length).length, contratosSemCliente: contracts.filter((r) => !r.client).length, items,
    ok: items.every((i) => i.status !== 'faltam') && !(captura?.falhas || []).length,
  };
}

const ADDR = /^(endereco|cidade|pais|nacionalidade|estado civil|profissao|data de nascimento|nascimento)$/;
/** Clientes: de listas de clientes (nome + telefone/e-mail/documento, sem número de contrato) e dos próprios contratos. */
export function extractClients(captura, contracts = []) {
  const index = new Map(); const list = [];
  const add = (c) => { if (c.name && (c.phone || c.email || c.doc)) mergeClient(index, list, c); };
  const row = (raw) => {
    const c = { name: '', doc: '', phone: '', email: '', extra: {} };
    for (const [label, v] of Object.entries(raw || {})) {
      if (v === null || v === undefined || typeof v === 'object') continue;
      const text = String(v).trim();
      if (!text || text.length > 200) continue;
      const f = field(label);
      if (f === 'client' && !c.name) c.name = text.slice(0, 120);
      else if (f === 'doc' && !c.doc) c.doc = text.slice(0, 40);
      else if (f === 'phone' && !c.phone) c.phone = text.slice(0, 40);
      else if (f === 'email' && !c.email) c.email = text.slice(0, 120);
      else if (ADDR.test(norm(label))) c.extra[String(label).slice(0, 30)] = text;
    }
    return c;
  };
  for (const a of captura?.api || []) for (const o of objectsIn(a.json)) add(row(flat(o)));
  for (const p of captura?.pages || []) {
    for (const t of p.tables || []) {
      const headers = (t.headers || []).map((h) => String(h || '').trim());
      if (!headers.some((h) => field(h) === 'client')) continue;
      for (const r of t.rows || []) add(row(Object.fromEntries(headers.map((h, i) => [h || `col${i}`, r[i]]))));
    }
    const f = Object.fromEntries((p.fields || []).map((x) => [x.label, x.value]));
    if (Object.keys(f).length >= 3) add(row(f));
  }
  // Quem tem contrato é cliente mesmo sem telefone ou documento cadastrados.
  for (const r of contracts) if (r.client) mergeClient(index, list, { name: r.client, doc: r.doc, phone: r.phone, email: r.email, extra: {} });
  return list;
}

export class LegacyContracts {
  constructor({ store }) {
    this.store = store;
    store.data.legacyContracts ||= [];
    store.data.legacyClients ||= [];
  }

  get clients() {
    return this.store.data.legacyClients;
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
    // Clientes (lista de clientes + os dos contratos), sem repetir.
    const index = new Map();
    for (const c of this.clients) for (const k of clientKeys(c)) if (!index.has(k)) index.set(k, c);
    let newClients = 0;
    for (const c of extractClients(captura, records)) {
      const made = mergeClient(index, this.clients, c);
      if (made) { made.id = crypto.randomBytes(6).toString('hex'); made.importedAt = new Date().toISOString(); newClients += 1; }
    }
    const audit = auditCapture(captura, { contracts: this.list, clients: this.clients });
    (this.store.data.legacyAudits ||= []).push(audit);
    this.store.data.legacyAudits = this.store.data.legacyAudits.slice(-10);
    this.store.save();
    return { added, updated, total: this.list.length, ultimoNumero: lastNumber(this.list), clients: this.clients.length, newClients, audit, ...parcelStats(this.list) };
  }

  /**
   * Leva o que foi importado para o sistema novo: contratos com parcelas viram vendas (para os vencimentos, os
   * atrasos e o painel executivo) e clientes viram prospectos no CRM. Nada é enviado a ninguém, e comissão fica zerada.
   */
  apply({ sales, crm, user, doSales = true, doClients = true }) {
    const out = { sales: 0, salesSkipped: 0, noParcels: 0, clients: 0, clientsSkipped: 0 };
    const hasContract = new Set();
    if (doSales) {
      for (const r of this.list) {
        if (!r.parcels?.length) { out.noParcels += 1; continue; }
        if (sales.list.some((s) => s.legacyNumber === r.number && s.legacy)) { out.salesSkipped += 1; continue; }
        const total = r.value ?? Math.round(r.parcels.reduce((a, p) => a + p.value, 0) * 100) / 100;
        const created = r.date ? `${r.date}T12:00:00.000Z` : new Date().toISOString();
        sales.list.push({
          id: crypto.randomBytes(6).toString('hex'), number: `ANT-${r.number || r.id.slice(0, 6)}`, legacy: true, legacyNumber: r.number, quoteId: null, quoteNumber: '', leadId: null,
          client: { nome: r.client, phone: String(r.phone || '').replace(/\D/g, ''), doc: r.doc || '' }, sellerId: null, sellerName: r.seller || '',
          items: [{ name: r.service || 'Contrato do sistema antigo', qty: 1, price: total, total }], total,
          parcels: r.parcels.map((p) => ({ label: p.label, value: p.value, due: p.due, status: p.paid ? 'pago' : 'pendente', ...(p.paid ? { paidAt: p.paidAt, method: 'Sistema antigo', confirmedBy: 'Importação' } : {}) })),
          commission: { pct: 0, value: 0, manual: true, status: 'paga', paidAt: null, note: 'Contrato do sistema antigo: sem comissão pelo sistema novo' }, affiliate: null,
          status: /cancel|rescind|distrat/i.test(r.status || '') ? 'cancelada' : 'ativa', office: 'py', createdAt: created, createdBy: user?.name || 'Importação', history: [{ at: new Date().toISOString(), by: user?.name || 'Importação', text: `Importado do sistema antigo (contrato ${r.number})` }],
        });
        hasContract.add(String(r.phone || '').replace(/\D/g, '') || norm(r.client));
        out.sales += 1;
      }
    } else for (const r of this.list) hasContract.add(String(r.phone || '').replace(/\D/g, '') || norm(r.client));
    if (doClients) {
      for (const c of this.clients) {
        const phone = normalizePhoneLoose(c.phone);
        if ((phone && crm.leads.some((l) => l.phone === phone)) || (!phone && crm.leads.some((l) => l.legacy && norm(l.name) === norm(c.name)))) { out.clientsSkipped += 1; continue; }
        let lead;
        try {
          lead = crm.byId(crm.create({ name: user?.name || 'Importação', role: 'admin' }, { name: c.name, phone, email: c.email, source: 'manual', category: 'migracao', office: 'py', ownerId: null, stage: hasContract.has(String(c.phone || '').replace(/\D/g, '')) || hasContract.has(norm(c.name)) ? 'ganho' : 'novo' }).id);
        } catch { out.clientsSkipped += 1; continue; }
        const cr = this.list.find((r) => norm(r.client) === norm(c.name));
        if (cr?.date) lead.createdAt = lead.updatedAt = `${cr.date}T12:00:00.000Z`;
        lead.legacy = true;
        out.clients += 1;
      }
    }
    this.store.save();
    return out;
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
