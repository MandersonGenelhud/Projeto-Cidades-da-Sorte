// Retomada de contatos: pessoas que pediram atendimento (Instagram, Facebook, site, quiz) e ainda não
// foram atendidas. Cruza com as conversas do WhatsApp e com o CRM, separa quem JÁ falou com a gente de
// quem NÃO, e manda a primeira mensagem só depois do administrador conferir e aprovar, com limite por dia,
// intervalo entre mensagens e horário comercial, para proteger o número.
import crypto from 'node:crypto';
import { normalizePhone } from './utils.js';
import { norm, objectsIn, flat } from './legacy-import.js';
const err = (status, message) => Object.assign(new Error(message), { status });
const SOURCES = { instagram: 'Instagram', facebook: 'Facebook', site: 'Cadastro no site', quiz: 'Quiz', grupo: 'Grupo de WhatsApp', outro: 'Outro' };
const OPEN_STATUS = new Set(['novo']);
const DAY = 86400000;

export const TEMPLATES = {
  instagram: 'Oi, {nome}! Eu vi que você entrou em contato com a gente lá no Instagram. O nosso Instagram está com um probleminha no momento, então, se você quiser, podemos dar continuidade ao seu atendimento por aqui mesmo. 😊 Como posso te ajudar?\n\nSe preferir não receber mensagens nossas, é só me avisar que eu paro.',
  facebook: 'Oi, {nome}! Eu vi que você entrou em contato com a gente pelo Facebook. Para você não ficar esperando, podemos continuar o seu atendimento por aqui mesmo. 😊 Como posso te ajudar?\n\nSe preferir não receber mensagens nossas, é só me avisar que eu paro.',
  site: 'Oi, {nome}! Eu vi que você se cadastrou no nosso site e queria te atender com calma por aqui. 😊 Como posso te ajudar?\n\nSe preferir não receber mensagens nossas, é só me avisar que eu paro.',
  quiz: 'Oi, {nome}! Eu vi que você respondeu ao nosso questionário e queria te ajudar com os próximos passos por aqui. 😊 Posso te fazer uma pergunta rápida?\n\nSe preferir não receber mensagens nossas, é só me avisar que eu paro.',
  outro: 'Oi, {nome}! Vi que você entrou em contato com a gente e quero continuar o seu atendimento por aqui. 😊 Como posso te ajudar?\n\nSe preferir não receber mensagens nossas, é só me avisar que eu paro.',
};
// Quem só está em grupo nunca pediu atendimento: não recebe mensagem automática (só se o administrador incluir de propósito).
const GROUP_NOTE = 'Participa de um grupo e não pediu atendimento: não é enviado automaticamente.';

const FIELD_SYN = {
  phone: [/^(telefone|celular|whatsapp|fone|tel|contato|numero|phone|whats)( .*)?$/],
  name: [/^(nome|name|cliente|lead|contato nome)( completo)?$/],
  email: [/^e ?mail$/],
  source: [/^(origem|fonte|canal|source|campanha|midia|plataforma|rede)( .*)?$/],
};
const pick = (raw, key) => {
  for (const [label, v] of Object.entries(raw)) if (v !== null && typeof v !== 'object' && FIELD_SYN[key].some((re) => re.test(norm(label)))) return String(v).trim();
  return '';
};
export function guessSource(text, fallback = 'outro') {
  const t = norm(text);
  if (/instagram|insta\b|\big\b/.test(t)) return 'instagram';
  if (/facebook|\bface\b|\bfb\b|meta ads/.test(t)) return 'facebook';
  if (/quiz|questionario/.test(t)) return 'quiz';
  if (/grupo|group/.test(t)) return 'grupo';
  if (/site|cadastro|landing|formulario/.test(t)) return 'site';
  return fallback;
}

/** Linhas {name, phone, email, source} a partir de um CSV (texto), de uma lista de objetos ou do captura.json. */
export function rowsFrom(input, { source = '' } = {}) {
  const out = [];
  const add = (raw, origin) => {
    const phone = normalizePhone(pick(raw, 'phone'));
    if (!phone && !pick(raw, 'email')) return;
    out.push({ name: pick(raw, 'name'), phone: phone || '', email: pick(raw, 'email'), source: source || guessSource(`${pick(raw, 'source')} ${origin || ''}`) });
  };
  if (typeof input === 'string') {
    const lines = input.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return [];
    const delim = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
    const split = (l) => { const cells = []; let cur = ''; let q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === delim && !q) { cells.push(cur); cur = ''; } else cur += ch; } cells.push(cur); return cells.map((c) => c.trim()); };
    const head = split(lines[0]);
    for (const l of lines.slice(1)) { const c = split(l); add(Object.fromEntries(head.map((h, i) => [h, c[i]])), ''); }
    return out;
  }
  if (input?.pages || input?.api) {
    for (const a of input.api || []) for (const o of objectsIn(a.json)) add(flat(o), a.url);
    for (const p of input.pages || []) {
      for (const t of p.tables || []) {
        const headers = (t.headers || []).map((h) => String(h || '').trim());
        for (const row of t.rows || []) add(Object.fromEntries(headers.map((h, i) => [h || `col${i}`, row[i]])), p.url);
      }
      const f = Object.fromEntries((p.fields || []).map((x) => [x.label, x.value]));
      if (Object.keys(f).length >= 2) add(f, p.url);
    }
    return out;
  }
  for (const o of Array.isArray(input) ? input : []) add(flat(o), '');
  return out;
}

export class Reengage {
  constructor({ store, crm, agent, send, now = () => Date.now() }) {
    Object.assign(this, { store, crm, agent, send, now });
    store.data.reengage ||= { contacts: [], run: null };
  }

  get contacts() {
    return this.store.data.reengage.contacts;
  }

  get config() {
    return { perDay: 40, from: 8, to: 20, minDelayMs: 25_000, maxDelayMs: 55_000, templates: {}, ...(this.store.settings.reengage || {}) };
  }

  template(source) {
    return this.config.templates?.[source] || TEMPLATES[source] || TEMPLATES.outro;
  }

  message(c) {
    const first = String(c.name || '').trim().split(/\s+/)[0];
    const hello = this.template(c.source).replace('{nome}', first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : '').replace('Oi, !', 'Oi!');
    return hello;
  }

  /** O que já existe desta pessoa: conversa no WhatsApp e/ou prospecto no CRM. */
  #history(phone) {
    if (!phone) return { talked: false };
    const conv = Object.values(this.store.data.conversations || {}).find((c) => !c.simulation && (c.phone === phone || String(c.key).startsWith(`${phone}@`) || String(c.key).includes(`:${phone}@`)) && (c.messages || []).length);
    const lead = this.crm.leads.find((l) => l.phone === phone);
    return {
      talked: Boolean(conv || (lead && lead.stage !== 'novo')),
      conversation: Boolean(conv),
      lastAt: conv?.updatedAt || lead?.updatedAt || null,
      leadId: lead?.id || null,
      leadCode: lead?.code || '',
      owner: lead?.ownerId || null,
      stage: lead?.stage || '',
    };
  }

  import(rows) {
    const stats = { lidas: rows.length, novos: 0, jaAtendidos: 0, grupo: 0, semTelefone: 0, repetidos: 0, naoIncomodar: 0 };
    const byPhone = new Map(this.contacts.filter((c) => c.phone).map((c) => [c.phone, c]));
    for (const r of rows) {
      if (!r.phone) { stats.semTelefone += 1; continue; }
      if (byPhone.has(r.phone)) { stats.repetidos += 1; continue; }
      const h = this.#history(r.phone);
      const blocked = this.store.isBlacklisted(r.phone);
      const c = {
        id: crypto.randomBytes(5).toString('hex'), name: r.name || '', phone: r.phone, email: r.email || '', source: SOURCES[r.source] ? r.source : 'outro',
        addedAt: new Date(this.now()).toISOString(), status: blocked ? 'nao_incomodar' : h.talked ? 'ja_atendido' : 'novo', history: h, sentAt: null, repliedAt: null,
      };
      if (blocked) stats.naoIncomodar += 1; else if (h.talked) stats.jaAtendidos += 1; else stats.novos += 1;
      if (c.source === 'grupo' && c.status === 'novo') { c.hold = GROUP_NOTE; stats.grupo += 1; }
      this.contacts.push(c);
      byPhone.set(c.phone, c);
    }
    this.store.save();
    return stats;
  }

  /** Atualiza quem já respondeu depois da mensagem enviada. */
  refresh() {
    for (const c of this.contacts) {
      if (c.status !== 'enviado') continue;
      const conv = Object.values(this.store.data.conversations || {}).find((x) => x.phone === c.phone || String(x.key).startsWith(`${c.phone}@`));
      if (conv?.messages?.some((m) => m.role === 'user' && m.at > c.sentAt)) { c.status = 'respondeu'; c.repliedAt = conv.messages.filter((m) => m.role === 'user' && m.at > c.sentAt)[0].at; }
    }
  }

  list({ status = '', source = '', q = '' } = {}) {
    this.refresh();
    const n = norm(q);
    return this.contacts.filter((c) => (!status || c.status === status) && (!source || c.source === source) && (!n || norm(`${c.name} ${c.phone} ${c.email}`).includes(n)))
      .map((c) => ({ ...c, message: c.status === 'novo' ? this.message(c) : undefined }));
  }

  summary() {
    this.refresh();
    const count = (s) => this.contacts.filter((c) => c.status === s).length;
    const sentToday = this.#sentToday();
    return { total: this.contacts.length, novo: count('novo'), jaAtendido: count('ja_atendido'), enviado: count('enviado'), respondeu: count('respondeu'), naoIncomodar: count('nao_incomodar'), ignorado: count('ignorado'), sentToday, perDay: this.config.perDay, run: this.store.data.reengage.run };
  }

  #sentToday() {
    const start = new Date(this.now()); start.setHours(0, 0, 0, 0);
    return this.contacts.filter((c) => c.sentAt && Date.parse(c.sentAt) >= start.getTime()).length;
  }

  mark(id, status) {
    if (!['ignorado', 'nao_incomodar', 'novo'].includes(status)) throw err(400, 'Situação inválida');
    const c = this.contacts.find((x) => x.id === id);
    if (!c) throw err(404, 'Contato não encontrado');
    if (c.status === 'enviado' || c.status === 'respondeu') throw err(409, 'Este contato já recebeu a mensagem');
    c.status = status;
    if (status === 'nao_incomodar' && c.phone) this.store.addToBlacklist(c.phone);
    this.store.save();
    return c;
  }

  inHours() {
    const h = new Date(this.now()).getHours();
    return h >= this.config.from && h < this.config.to;
  }

  /** Envia só aos contatos que o administrador escolheu (e que ainda estão "novo"), um de cada vez. */
  async sendApproved(ids, { by = 'Administrador', delay = () => this.config.minDelayMs + Math.random() * (this.config.maxDelayMs - this.config.minDelayMs), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    const run0 = this.store.data.reengage.run;
    if (run0?.running) throw err(409, 'Já existe um envio em andamento');
    if (!this.inHours()) throw err(400, `Só envio entre ${this.config.from}h e ${this.config.to}h, para parecer atendimento normal.`);
    const room = this.config.perDay - this.#sentToday();
    if (room <= 0) throw err(400, `O limite de hoje (${this.config.perDay} mensagens) já foi usado. Continue amanhã.`);
    const targets = this.contacts.filter((c) => ids.includes(c.id) && c.status === 'novo' && c.phone).slice(0, room);
    if (!targets.length) throw err(400, 'Nenhum contato novo entre os escolhidos.');
    const run = (this.store.data.reengage.run = { running: true, stop: false, total: targets.length, sent: 0, failed: 0, by, startedAt: new Date(this.now()).toISOString() });
    for (const c of targets) {
      if (run.stop) break;
      try {
        const text = this.message(c);
        await this.send(c.phone, { text });
        // A conversa já nasce com a mensagem, para a atendente continuar de onde parou quando a pessoa responder.
        const key = `${c.phone}@s.whatsapp.net`;
        const conv = this.agent.conversation(key);
        conv.phone ||= c.phone;
        if (c.name && !conv.name) conv.name = c.name;
        this.agent.remember(conv, 'assistant', text);
        let lead = this.crm.leads.find((l) => l.phone === c.phone);
        if (!lead) lead = this.crm.byId(this.crm.create({ name: by, role: 'admin' }, { name: c.name, phone: c.phone, email: c.email, source: c.source, interest: '', conversationKey: key }).id);
        this.crm.addNote({ name: by, role: 'admin' }, lead.id, `📨 Retomada de contato (${SOURCES[c.source]}): mensagem enviada pelo WhatsApp`);
        c.leadId = lead.id;
        c.status = 'enviado';
        c.sentAt = new Date(this.now()).toISOString();
        run.sent += 1;
      } catch (e) {
        run.failed += 1;
        c.lastError = e.message;
        this.store.addLog?.({ type: 'error', message: `Retomada: não enviei para ${c.name || c.phone}: ${e.message}` });
        // Se o WhatsApp está fora do ar, não adianta insistir.
        if (/conectad|connection|WhatsApp/i.test(e.message) && run.failed >= 3) break;
      }
      this.store.save();
      if (c !== targets.at(-1) && !run.stop) await sleep(delay());
    }
    run.running = false;
    run.finishedAt = new Date(this.now()).toISOString();
    this.store.save();
    return run;
  }

  stop() {
    const r = this.store.data.reengage.run;
    if (r?.running) r.stop = true;
    return r;
  }
}
