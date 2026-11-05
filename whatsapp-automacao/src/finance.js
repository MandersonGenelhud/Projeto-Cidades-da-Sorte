// Financiamento próprio de lotes (Migra Imobiliária): simulador de parcelas com
// juros por faixa (quanto mais parcelas, maior o percentual), entrada que abate
// do saldo, e a proposta/reserva em PDF. Os percentuais são do Marcos: o sistema
// não inventa nenhum, começa tudo em 0% até ele definir (Imobiliária → Financiamento).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PdfCanvas, PAGE } from './pdfdoc.js';

const LOGO = fileURLToPath(new URL('../public/img/migra-logo-escuro-ouro.jpg', import.meta.url));
const C = { green: '#0B2A1E', gold: '#D4AF37', ink: '#1d1d1f', gray: '#6b6b70', soft: '#F2F6F3', line: '#dfe5e1', red: '#b3261e' };
const err = (status, message) => Object.assign(new Error(message), { status });
const cents = (v) => Math.round(Number(v) * 100) / 100;
const pct = (v) => Math.min(500, Math.max(0, Number(v) || 0));

export const DEFAULT_FINANCE = {
  minEntryPct: 10,          // entrada mínima, % do valor do lote
  reserveFee: 0,            // taxa de reserva (valor), abatida da entrada
  maxInstallments: 120,
  maxEntryParts: 6,         // entrada pode ser dividida em até N vezes
  validDays: 3,             // validade da proposta até o pagamento da reserva
  // Juros totais (% sobre o saldo financiado) conforme o número de parcelas.
  bands: [
    { upTo: 12, interestPct: 0 },
    { upTo: 36, interestPct: 0 },
    { upTo: 60, interestPct: 0 },
    { upTo: 120, interestPct: 0 },
  ],
};

export function cleanConfig(input, base = DEFAULT_FINANCE) {
  const out = { ...base };
  if (input.minEntryPct !== undefined) out.minEntryPct = Math.min(100, pct(input.minEntryPct));
  if (input.reserveFee !== undefined) out.reserveFee = Math.max(0, cents(input.reserveFee) || 0);
  if (input.maxInstallments !== undefined) out.maxInstallments = Math.min(360, Math.max(1, Math.floor(Number(input.maxInstallments)) || 1));
  if (input.maxEntryParts !== undefined) out.maxEntryParts = Math.min(24, Math.max(1, Math.floor(Number(input.maxEntryParts)) || 1));
  if (input.validDays !== undefined) out.validDays = Math.min(60, Math.max(1, Math.floor(Number(input.validDays)) || 1));
  if (input.bands !== undefined) {
    if (!Array.isArray(input.bands) || !input.bands.length || input.bands.length > 12) throw err(400, 'Informe de 1 a 12 faixas de juros');
    const bands = input.bands.map((b) => ({ upTo: Math.floor(Number(b.upTo)), interestPct: pct(b.interestPct) }));
    if (bands.some((b) => !(b.upTo >= 1))) throw err(400, 'Cada faixa precisa de um número de parcelas');
    bands.sort((a, b) => a.upTo - b.upTo);
    for (let i = 1; i < bands.length; i++) {
      if (bands[i].upTo === bands[i - 1].upTo) throw err(400, 'Há duas faixas com o mesmo número de parcelas');
    }
    out.bands = bands;
  }
  return out;
}

export const isConfigured = (cfg) => cfg.bands.some((b) => b.interestPct > 0);

/** Juros (%) da faixa que cobre esse número de parcelas. */
export function interestFor(cfg, n) {
  const band = cfg.bands.find((b) => n <= b.upTo) || cfg.bands.at(-1);
  return band.interestPct;
}

/**
 * Simula um lote. entry = entrada em dinheiro (já inclui a taxa de reserva).
 * A entrada abate do saldo antes dos juros. entryParts divide a entrada em vezes.
 */
export function simulate(cfg, { price, entry, installments, entryParts = 1 }) {
  price = cents(price);
  if (!(price > 0)) throw err(400, 'Informe o valor do lote');
  const n = Math.floor(Number(installments));
  if (!(n >= 1) || n > cfg.maxInstallments) throw err(400, `Parcelas de 1 a ${cfg.maxInstallments}`);
  const minEntry = cents((price * cfg.minEntryPct) / 100);
  entry = entry === undefined || entry === '' ? minEntry : cents(entry);
  if (entry < minEntry) throw err(400, `A entrada mínima é ${cfg.minEntryPct}% (${minEntry.toFixed(2)})`);
  if (entry > price) throw err(400, 'A entrada não pode ser maior que o valor do lote');
  const parts = Math.min(cfg.maxEntryParts, Math.max(1, Math.floor(Number(entryParts)) || 1));
  const balance = cents(price - entry);
  const rate = balance > 0 ? interestFor(cfg, n) : 0;
  const interest = cents((balance * rate) / 100);
  const financed = cents(balance + interest);
  const base = Math.floor((financed / n) * 100) / 100;
  const last = cents(financed - base * (n - 1)); // a última parcela absorve os centavos
  const entryBase = Math.floor((entry / parts) * 100) / 100;
  const entryLast = cents(entry - entryBase * (parts - 1));
  return {
    price, entry, minEntry, entryPct: cents((entry / price) * 100), entryParts: parts, entryPart: entryBase, entryLastPart: entryLast,
    balance, interestPct: rate, interest, financed, installments: n, installment: base, lastInstallment: last,
    total: cents(entry + financed), reserveFee: cfg.reserveFee,
  };
}

/** Várias opções de prazo lado a lado (para o vendedor mostrar ao cliente). */
export function options(cfg, { price, entry, entryParts }, counts) {
  const list = (counts || [12, 24, 36, 48, 60, 84, 96, 120]).filter((n) => n <= cfg.maxInstallments);
  return list.map((n) => simulate(cfg, { price, entry, installments: n, entryParts }));
}

/** Relatório de parcelas: quando cada parcela vence (mensal), com o saldo restante. */
export function schedule(sim, startDate = new Date()) {
  const rows = [];
  const d0 = new Date(startDate);
  for (let i = 0; i < sim.entryParts; i++) {
    const d = new Date(d0); d.setMonth(d.getMonth() + i);
    rows.push({ kind: 'entrada', n: i + 1, due: d.toISOString().slice(0, 10), amount: i === sim.entryParts - 1 ? sim.entryLastPart : sim.entryPart });
  }
  let left = sim.financed;
  for (let i = 1; i <= sim.installments; i++) {
    const d = new Date(d0); d.setMonth(d.getMonth() + sim.entryParts + i - 1);
    const amount = i === sim.installments ? sim.lastInstallment : sim.installment;
    left = cents(left - amount);
    rows.push({ kind: 'parcela', n: i, due: d.toISOString().slice(0, 10), amount, balance: Math.max(0, left) });
  }
  return rows;
}

const money = (v, cur = 'R$') => `${cur} ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Proposta de reserva em PDF. Fica marcada como "SEM VALOR" até a taxa de reserva
 * ser paga (paid=false); depois de paga, é emitida de novo sem a tarja.
 */
export function proposalPdf({ number, client, lot, development, sim, seller, company = 'Migra Paraguai', currency = 'R$', paid = false, validUntil, signer = 'Marcos Miguel' }) {
  const c = new PdfCanvas();
  const W = PAGE.W; const M = 50; const maxW = W - 2 * M;
  let logo = null;
  try { logo = fs.readFileSync(LOGO); } catch { /* sem logo */ }
  c.watermark(paid ? 'MIGRA PARAGUAI' : 'SEM VALOR ATÉ A RESERVA', { size: paid ? 54 : 40, color: paid ? '#EDF2EF' : '#F6E3E1' });
  c.rect(0, 0, W, 90, { fill: C.green });
  c.rect(0, 90, W, 3, { fill: C.gold });
  if (logo) c.image(logo, M - 6, 14, 140); else c.text(company.toUpperCase(), M, 34, { size: 18, bold: true, color: '#fff' });
  c.text(`PROPOSTA ${number}`, W - M, 26, { size: 15, bold: true, color: C.gold, align: 'right' });
  c.text(paid ? 'Reserva confirmada' : `Válida até ${validUntil || '—'}, só vale com a reserva paga`, W - M, 50, { size: 9, color: '#cfe0d7', align: 'right' });

  let y = 118;
  c.text('PROPOSTA DE COMPRA E RESERVA DE LOTE', W / 2, y, { size: 15, bold: true, color: C.ink, align: 'center', spacing: 0.8 });
  y += 34;
  const block = (title, rows) => {
    c.text(title, M, y, { size: 9, bold: true, color: C.green, spacing: 0.8 });
    y += 14; c.rect(M, y - 3, maxW, 0.8, { fill: C.gold });
    for (const [k, v] of rows) {
      y += 6;
      c.text(k, M + 6, y, { size: 9.5, color: C.gray });
      c.text(String(v || '—'), W - M - 6, y, { size: 9.5, bold: true, color: C.ink, align: 'right' });
      y += 14; c.rect(M, y, maxW, 0.4, { fill: C.line });
    }
    y += 16;
  };
  block('COMPRADOR', [
    ['Nome', client.name], ['Documento (CI/CPF)', client.doc], ['Telefone', client.phone], ['E-mail', client.email],
    ['Endereço', client.address], ['Nacionalidade / estado civil', [client.nationality, client.civil].filter(Boolean).join(' / ')],
  ]);
  block('IMÓVEL', [
    ['Loteamento', development], ['Lote', lot.code], ['Área', lot.area ? `${lot.area} m²` : ''], ['Valor à vista', money(sim.price, currency)],
  ]);
  block('CONDIÇÕES DE PAGAMENTO', [
    ['Entrada', `${money(sim.entry, currency)} (${sim.entryPct}%)${sim.entryParts > 1 ? ` em ${sim.entryParts}x de ${money(sim.entryPart, currency)}` : ''}`],
    ['Saldo', money(sim.balance, currency)],
    ['Parcelas', `${sim.installments}x de ${money(sim.installment, currency)}${sim.lastInstallment !== sim.installment ? ` (última ${money(sim.lastInstallment, currency)})` : ''}`],
    ['Total a pagar', money(sim.total, currency)],
    ['Taxa de reserva', sim.reserveFee ? money(sim.reserveFee, currency) : 'conforme combinado'],
  ]);
  const note = paid
    ? 'Reserva paga. O lote fica reservado em nome do comprador pelo prazo combinado, até a assinatura do contrato.'
    : 'ATENÇÃO: esta proposta NÃO tem validade até o pagamento da taxa de reserva. Sem a reserva paga, o lote continua disponível para outros compradores.';
  for (const line of c.lines(note, maxW - 20, { size: 9 })) { c.text(line, M + 10, y, { size: 9, bold: !paid, color: paid ? C.gray : C.red }); y += 13; }
  y = Math.max(y + 36, 690);
  c.rect(W - M - 200, y, 200, 0.7, { fill: C.ink });
  c.text(signer, W - M - 100, y + 6, { size: 10, bold: true, color: C.ink, align: 'center' });
  c.text(company, W - M - 100, y + 20, { size: 8.5, color: C.gray, align: 'center' });
  if (seller) c.text(`Vendedor: ${seller}`, M, y + 6, { size: 9, color: C.gray });
  return c.toBuffer();
}

/** Campos obrigatórios do comprador para gerar a reserva. */
export function missingClientData(client = {}) {
  const need = { name: 'nome completo', doc: 'documento (CI/CPF)', phone: 'telefone', address: 'endereço' };
  return Object.entries(need).filter(([k]) => !String(client[k] || '').trim()).map(([, label]) => label);
}

/** Propostas de reserva: numeração própria, validade e baixa da reserva. */
export class Proposals {
  constructor({ store, realty, audit = null }) {
    this.store = store;
    this.realty = realty;
    this.audit = audit;
    store.data.finance ||= {};
    store.data.finance.proposals ||= [];
    store.data.finance.config ||= null;
    store.data.finance.seq ||= 0;
  }

  get config() {
    return cleanConfig(this.store.data.finance.config || {}, DEFAULT_FINANCE);
  }

  saveConfig(input) {
    this.store.data.finance.config = cleanConfig(input, this.config);
    this.store.save();
    return this.config;
  }

  #refresh(p) {
    if (p.status === 'aberta' && p.validUntil < new Date().toISOString().slice(0, 10)) p.status = 'vencida';
    return p;
  }

  list({ status } = {}) {
    return this.store.data.finance.proposals.map((p) => this.#refresh(p)).filter((p) => !status || p.status === status).reverse();
  }

  get(id) {
    const p = this.store.data.finance.proposals.find((x) => x.id === id);
    return p ? this.#refresh(p) : null;
  }

  create({ devId, lotId, client = {}, entry, installments, entryParts, user }) {
    const miss = missingClientData(client);
    if (miss.length) throw err(400, `Para gerar a reserva faltam os dados do cliente: ${miss.join(', ')}.`);
    const d = this.realty.development(devId);
    const lot = d?.lots.find((l) => l.id === lotId);
    if (!lot) throw err(404, 'Lote não encontrado');
    if (lot.status !== 'disponivel') throw err(409, 'Este lote não está disponível');
    if (this.store.data.finance.proposals.some((p) => this.#refresh(p).status === 'aberta' && p.lotId === lotId && p.devId === devId)) {
      throw err(409, 'Já existe uma proposta aberta para este lote. Cancele ou espere vencer.');
    }
    const cfg = this.config;
    const sim = simulate(cfg, { price: lot.price, entry, installments, entryParts });
    const f = this.store.data.finance;
    f.seq += 1;
    const until = new Date(Date.now() + cfg.validDays * 86400000).toISOString().slice(0, 10);
    const p = {
      id: Math.random().toString(16).slice(2, 12), number: `PRP-${String(f.seq).padStart(4, '0')}`, createdAt: new Date().toISOString(),
      devId, lotId, devName: d.name, lotCode: lot.code, lotArea: lot.area || null, currency: d.currency || 'R$',
      client: Object.fromEntries(Object.entries(client).map(([k, v]) => [k, String(v || '').trim()])),
      sim, validUntil: until, status: 'aberta', sellerId: user?.id || '', seller: user?.name || '', paidAt: null,
    };
    f.proposals.push(p);
    this.store.save();
    this.audit?.record({ user, action: 'criou', entity: 'proposta', label: `${p.number} · ${p.lotCode} · ${p.client.name}`, changes: [{ field: 'price', label: 'Valor do lote', from: '', to: String(sim.price), sensitive: true }] });
    return p;
  }

  /** Reserva paga: a proposta passa a valer e o lote fica reservado. */
  markPaid(id, user) {
    const p = this.get(id);
    if (!p) throw err(404, 'Proposta não encontrada');
    if (p.status === 'reservada') return p;
    if (p.status !== 'aberta') throw err(409, `Proposta ${p.status}: gere uma nova.`);
    this.realty.updateLot(p.devId, p.lotId, { status: 'reservado', note: `Reservado por ${p.client.name} (${p.number})` });
    p.status = 'reservada';
    p.paidAt = new Date().toISOString();
    this.store.save();
    this.audit?.record({ user, action: 'alterou', entity: 'proposta', label: `${p.number} · reserva paga · ${p.lotCode}`, changes: [{ field: 'status', label: 'Situação', from: 'aberta', to: 'reservada', sensitive: false }] });
    return p;
  }

  cancel(id, user) {
    const p = this.get(id);
    if (!p) throw err(404, 'Proposta não encontrada');
    if (p.status === 'reservada') {
      this.realty.updateLot(p.devId, p.lotId, { status: 'disponivel', note: '' });
    }
    const from = p.status;
    p.status = 'cancelada';
    this.store.save();
    this.audit?.record({ user, action: 'alterou', entity: 'proposta', label: `${p.number} cancelada · ${p.lotCode}`, changes: [{ field: 'status', label: 'Situação', from, to: 'cancelada', sensitive: false }] });
    return p;
  }

  pdf(p, company) {
    return proposalPdf({
      number: p.number, client: p.client, lot: { code: p.lotCode, area: p.lotArea }, development: p.devName, sim: p.sim,
      seller: p.seller, company, currency: p.currency, paid: p.status === 'reservada', validUntil: p.validUntil.split('-').reverse().join('/'),
    });
  }

  /** Relatório: totais por situação e valor reservado. */
  report() {
    const list = this.list();
    const by = (s) => list.filter((p) => p.status === s);
    return {
      total: list.length, abertas: by('aberta').length, reservadas: by('reservada').length, vencidas: by('vencida').length, canceladas: by('cancelada').length,
      valorReservado: cents(by('reservada').reduce((a, p) => a + p.sim.price, 0)),
      entradas: cents(by('reservada').reduce((a, p) => a + p.sim.entry, 0)),
    };
  }
}
