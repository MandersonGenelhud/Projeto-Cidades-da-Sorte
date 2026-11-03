// Documentos emitidos para os clientes (admissão temporária, cédula, RUC, licença…): quando saiu, quando foi entregue,
// quem cuida e quando avisar o cliente da renovação. Nada é enviado sozinho: o aviso sai quando alguém clica em "Avisar".
import crypto from 'node:crypto';

export const TYPES = {
  admissao_temporaria: 'Admissão Temporária', cedula_identidade: 'Cédula Paraguaia', cedula_tributaria: 'RUC',
  licenca_conducao: 'Licença de Condução', abertura_empresa: 'Empresa', interpol: 'Interpol', policia_nacional: 'Polícia Nacional', outros: 'Outros',
};
// Regra vista no sistema antigo: 1º aviso 15 meses e renovação 20 meses depois da emissão (o administrador ajusta em Regras).
export const DEFAULT_RULES = { admissao_temporaria: { notice: 15, renewal: 20 }, cedula_identidade: { notice: 15, renewal: 20 } };
const STATUS = ['emitido', 'entregue'];
const iso = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !Number.isNaN(Date.parse(d)) ? d : '';
const br = (d) => (d ? d.split('-').reverse().join('/') : '');
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const brToIso = (s) => { const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };
export function addMonths(date, n) {
  const m = String(date).match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + n, 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(Number(m[3]), last));
  return d.toISOString().slice(0, 10);
}

/** Lê as páginas /documentos da cópia do sistema antigo (cartões de texto) e devolve os documentos. */
export function parseDocumentPages(captura) {
  const typeNames = Object.entries(TYPES).sort((a, b) => b[1].length - a[1].length);
  const out = []; const seen = new Set();
  for (const p of captura?.pages || []) {
    if (!/\/documentos/i.test(String(p.url || ''))) continue;
    const flat = String(p.texto || '').replace(/\s+/g, ' ');
    for (let chunk of flat.split(/\bEditar\s+Avisar\b/)) {
      chunk = chunk.replace(/^.*Todos os respons[aá]veis/i, '').replace(/^.*Agrupar por contrato/i, '').trim();
      const em = chunk.match(/Emiss[ãa]o\s+(\d{2}\/\d{2}\/\d{4})/);
      if (!em) continue;
      const tagAt = chunk.search(/\b(Entregue|Emitido|Dependente|Com renova[çc][ãa]o)\b/);
      const typeHit = typeNames.map(([k, label]) => [k, label, chunk.indexOf(label)]).filter((x) => x[2] >= 0).sort((a, b) => a[2] - b[2])[0];
      const cut = [tagAt, typeHit?.[2] ?? -1].filter((x) => x > 0).sort((a, b) => a - b)[0] ?? chunk.indexOf('Emiss');
      const name = clip(chunk.slice(0, cut), 120);
      if (!name) continue;
      let dep = '';
      const depAt = chunk.search(/Dependente\s*·?\s*contrato de\s+/i);
      if (depAt >= 0) {
        const after = chunk.slice(depAt).replace(/^Dependente\s*·?\s*contrato de\s+/i, '');
        const stops = [after.search(/\b(Entregue|Emitido|Com renova)/), ...typeNames.map(([, l]) => after.indexOf(l))].filter((x) => x > 0);
        dep = after.slice(0, stops.length ? Math.min(...stops) : 120);
      }
      const number = (chunk.match(/N[ºo°]\s*([^·]+?)\s*·/) || [])[1] || '';
      const contract = (chunk.match(/\b(\d{4}-\d{5,7})\b/) || [])[1] || '';
      const resp = (chunk.match(/Resp\.?:\s*([^·]+?)(?:\s+Emiss|\s*·|$)/) || [])[1] || '';
      const delivered = brToIso((chunk.match(/Entreg(?:ue|a|ue em)?\s+(\d{2}\/\d{2}\/\d{4})/) || [])[1]);
      const renewal = brToIso((chunk.match(/Renova[çc][ãa]o\s+(\d{2}\/\d{2}\/\d{4})/) || [])[1]);
      const notice = brToIso((chunk.match(/1[ºo°]?\s*aviso\s+(\d{2}\/\d{2}\/\d{4})/) || [])[1]);
      const rec = {
        clientName: name, dependentOf: clip(dep, 120), type: typeHit?.[0] || 'outros', number: clip(number, 40), contractNumber: contract, responsible: clip(resp, 60),
        issuedAt: brToIso(em[1]), noticeAt: notice, renewalAt: renewal, deliveredAt: delivered, status: delivered || /\bEntregue\b/.test(chunk.slice(0, 200)) ? 'entregue' : 'emitido',
      };
      const key = [rec.type, norm(rec.clientName), rec.number, rec.contractNumber, rec.issuedAt].join('|');
      if (seen.has(key)) continue;
      seen.add(key); out.push(rec);
    }
  }
  return out;
}

export class Documents {
  constructor({ store, today = () => new Date().toISOString().slice(0, 10) }) {
    this.store = store; this.today = today;
    store.data.documents ||= [];
    store.data.documentRules ||= {};
  }
  get all() { return this.store.data.documents; }
  get rules() { return { ...DEFAULT_RULES, ...this.store.data.documentRules }; }
  setRules(next = {}) {
    const out = {};
    for (const [t, r] of Object.entries(next)) {
      if (!TYPES[t]) throw new Error(`Tipo desconhecido: ${t}`);
      if (!r || (r.notice === '' && r.renewal === '')) { out[t] = null; continue; }
      const notice = Math.round(Number(r.notice)); const renewal = Math.round(Number(r.renewal));
      if (!(notice >= 1 && notice <= 240 && renewal >= notice && renewal <= 240)) throw new Error(`${TYPES[t]}: o aviso precisa vir antes da renovação (em meses, de 1 a 240)`);
      out[t] = { notice, renewal };
    }
    this.store.data.documentRules = { ...this.store.data.documentRules, ...out };
    this.store.save();
    return this.rules;
  }
  #dates(d) {
    const rule = this.rules[d.type];
    if (d.issuedAt && rule) { d.noticeAt ||= addMonths(d.issuedAt, rule.notice); d.renewalAt ||= addMonths(d.issuedAt, rule.renewal); }
    return d;
  }
  #clean(b, base) {
    const d = { ...base };
    if (b.clientName !== undefined) d.clientName = clip(b.clientName, 120);
    if (b.dependentOf !== undefined) d.dependentOf = clip(b.dependentOf, 120);
    if (b.type !== undefined) { if (!TYPES[b.type]) throw new Error('Tipo de documento inválido'); d.type = b.type; }
    for (const k of ['number', 'contractNumber', 'responsible', 'phone']) if (b[k] !== undefined) d[k] = clip(b[k], 60);
    if (b.notes !== undefined) d.notes = clip(b.notes, 600);
    for (const k of ['issuedAt', 'noticeAt', 'renewalAt', 'deliveredAt']) if (b[k] !== undefined) { const v = String(b[k] || '').trim(); if (v && !iso(v)) throw new Error('Data inválida'); d[k] = v; }
    if (b.status !== undefined) { if (!STATUS.includes(b.status)) throw new Error('Situação inválida'); d.status = b.status; }
    if (!d.clientName) throw new Error('Informe o nome do cliente');
    if (b.issuedAt !== undefined && b.noticeAt === undefined && base.issuedAt !== d.issuedAt) { d.noticeAt = ''; d.renewalAt = ''; }
    return this.#dates(d);
  }
  add(b, by = '') {
    const d = this.#clean(b, { id: crypto.randomBytes(6).toString('hex'), type: 'outros', status: 'emitido', clientName: '', dependentOf: '', number: '', contractNumber: '', responsible: '', phone: '', notes: '', issuedAt: '', noticeAt: '', renewalAt: '', deliveredAt: '', noticedAt: null, createdAt: new Date().toISOString(), createdBy: by, source: 'manual', deletedAt: null });
    this.all.push(d); this.store.save(); return d;
  }
  update(id, b) {
    const i = this.all.findIndex((x) => x.id === id && !x.deletedAt);
    if (i < 0) throw new Error('Documento não encontrado');
    const next = this.#clean(b, this.all[i]);
    if (next.status === 'entregue' && !next.deliveredAt) next.deliveredAt = this.today();
    this.all[i] = next; this.store.save(); return next;
  }
  remove(id) { const d = this.all.find((x) => x.id === id && !x.deletedAt); if (!d) throw new Error('Documento não encontrado'); d.deletedAt = new Date().toISOString(); this.store.save(); return d; }
  restore(id) { const d = this.all.find((x) => x.id === id && x.deletedAt); if (!d) throw new Error('Documento não encontrado'); d.deletedAt = null; this.store.save(); return d; }
  /** Precisa de renovação: já passou do 1º aviso e ainda não passou muito da data de renovação. */
  isRenewal(d) { const t = this.today(); return Boolean(d.noticeAt && d.noticeAt <= t); }
  list({ type = '', status = '', q = '', responsible = '', trash = false } = {}) {
    const n = norm(q);
    return this.all.filter((d) => Boolean(d.deletedAt) === Boolean(trash)
      && (!type || d.type === type) && (!responsible || norm(d.responsible) === norm(responsible))
      && (!status || (status === 'renovacao' ? this.isRenewal(d) : d.status === status))
      && (!n || norm(`${d.clientName} ${d.dependentOf} ${d.number} ${d.contractNumber} ${d.phone}`).includes(n)))
      .sort((a, b) => `${b.issuedAt}${b.createdAt}`.localeCompare(`${a.issuedAt}${a.createdAt}`)).map((d) => ({ ...d, renewalDue: this.isRenewal(d) }));
  }
  counts() {
    const live = this.all.filter((d) => !d.deletedAt);
    const byType = Object.fromEntries(Object.keys(TYPES).map((t) => [t, live.filter((d) => d.type === t).length]));
    return { total: live.length, byType, trash: this.all.length - live.length, emitido: live.filter((d) => d.status === 'emitido').length, entregue: live.filter((d) => d.status === 'entregue').length, renovacao: live.filter((d) => this.isRenewal(d)).length };
  }
  /** Quem já pode ser avisado e ainda não foi. */
  toNotify() { return this.list({ status: 'renovacao' }).filter((d) => !d.noticedAt); }
  noticeText(d) {
    const first = String(d.clientName || '').trim().split(/\s+/)[0] || 'tudo bem';
    return `Olá, ${first}! Aqui é da Migra Paraguai. Passando para avisar que o seu documento (${TYPES[d.type] || 'documento'}${d.number ? `, nº ${d.number}` : ''}), emitido em ${br(d.issuedAt)}, precisa ser renovado${d.renewalAt ? ` até ${br(d.renewalAt)}` : ' em breve'}. Podemos cuidar disso para você? Me diga qual o melhor dia para conversarmos.`;
  }
  markNoticed(id) { const d = this.all.find((x) => x.id === id && !x.deletedAt); if (!d) throw new Error('Documento não encontrado'); d.noticedAt = new Date().toISOString(); this.store.save(); return d; }
  /** Importa da cópia do sistema antigo sem duplicar (mesmo tipo, número, contrato, nome e emissão). */
  importCapture(captura) {
    const found = parseDocumentPages(captura);
    const key = (d) => [d.type, norm(d.clientName), d.number, d.contractNumber, d.issuedAt].join('|');
    const have = new Set(this.all.map(key));
    let added = 0;
    for (const f of found) {
      if (have.has(key(f))) continue;
      have.add(key(f));
      this.all.push(this.#dates({ id: crypto.randomBytes(6).toString('hex'), phone: '', notes: '', noticedAt: null, createdAt: new Date().toISOString(), createdBy: 'Importação', source: 'legacy', deletedAt: null, ...f }));
      added += 1;
    }
    if (added) this.store.save();
    return { found: found.length, added };
  }
}
