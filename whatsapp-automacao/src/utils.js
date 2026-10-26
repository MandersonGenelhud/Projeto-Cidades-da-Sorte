// Funções utilitárias compartilhadas pelos módulos.

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function randomBetween(min, max) {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Math.floor(lo + Math.random() * (hi - lo + 1));
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Normaliza um telefone para o formato internacional só com dígitos.
 * Números brasileiros sem DDI (10 ou 11 dígitos) recebem o prefixo 55.
 * Retorna null quando o número é inválido.
 */
export function normalizePhone(raw, defaultCountry = '55') {
  if (raw === undefined || raw === null) return null;
  const hasPlus = String(raw).trim().startsWith('+');
  let digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (hasPlus) {
    // Com "+" o DDI já foi informado.
  } else if (digits.length === 10 || digits.length === 11) {
    digits = defaultCountry + digits.replace(/^0/, '');
  } else if (digits.length === 12 && digits.startsWith('0')) {
    // 0 + DDD + número (ex.: 021987654321)
    digits = defaultCountry + digits.slice(1);
  }
  if (digits.length < 11 || digits.length > 15) return null;
  return digits;
}

export const phoneToJid = (phone) => `${phone}@s.whatsapp.net`;

export function jidToPhone(jid) {
  if (!jid) return null;
  const [user] = jid.split('@');
  return user.split(':')[0];
}

/**
 * Resolve spintax ({Olá|Oi|E aí}) escolhendo uma opção aleatória,
 * deixando as mensagens diferentes entre si.
 */
export function spin(text) {
  let out = text;
  const re = /\{([^{}]*\|[^{}]*)\}/;
  let guard = 0;
  while (re.test(out) && guard++ < 100) {
    out = out.replace(re, (_, group) => {
      const options = group.split('|');
      return options[Math.floor(Math.random() * options.length)];
    });
  }
  return out;
}

/**
 * Substitui variáveis {nome}, {primeiro_nome}, {telefone}, {cidade} e
 * qualquer campo extra do contato, e depois resolve o spintax.
 */
export function renderTemplate(template, contact = {}) {
  const name = (contact.name || '').trim();
  const vars = {
    ...(contact.fields || {}),
    nome: name,
    primeiro_nome: name.split(/\s+/)[0] || '',
    telefone: contact.phone || '',
    cidade: contact.city || contact.fields?.cidade || '',
    data: new Date().toLocaleDateString('pt-BR'),
    hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
  };
  const replaced = String(template || '').replace(/\{(\w+)\}/g, (match, key) => {
    const k = key.toLowerCase();
    return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k] ?? '') : match;
  });
  return spin(replaced);
}

/** Parser de CSV simples com suporte a aspas e separador ',' ou ';'. */
export function parseCSV(text) {
  const clean = String(text).replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/)[0] || '';
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

/**
 * Converte linhas de CSV em contatos. Detecta cabeçalho com colunas
 * como nome/name, telefone/phone/whatsapp/celular, tags, cidade.
 */
export function csvToContacts(text) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const phoneKeys = ['telefone', 'phone', 'whatsapp', 'celular', 'numero', 'número', 'fone'];
  const nameKeys = ['nome', 'name', 'cliente'];
  const hasHeader = header.some((h) => phoneKeys.includes(h) || nameKeys.includes(h));
  const phoneIdx = hasHeader ? header.findIndex((h) => phoneKeys.includes(h)) : -1;
  const nameIdx = hasHeader ? header.findIndex((h) => nameKeys.includes(h)) : -1;
  const tagsIdx = hasHeader ? header.indexOf('tags') : -1;
  const body = hasHeader ? rows.slice(1) : rows;

  return body.map((cols) => {
    let phone;
    let name = '';
    const fields = {};
    if (hasHeader) {
      phone = cols[phoneIdx];
      name = nameIdx >= 0 ? cols[nameIdx] : '';
      header.forEach((h, i) => {
        if (i !== phoneIdx && i !== nameIdx && i !== tagsIdx && h) fields[h] = (cols[i] || '').trim();
      });
    } else {
      // Sem cabeçalho: a coluna que parece telefone é o telefone, a outra o nome.
      const pi = cols.findIndex((c) => normalizePhone(c));
      phone = cols[pi];
      name = cols.find((c, i) => i !== pi) || '';
    }
    const tags = tagsIdx >= 0
      ? (cols[tagsIdx] || '').split(/[|,]/).map((t) => t.trim()).filter(Boolean)
      : [];
    return { phone: normalizePhone(phone), name: (name || '').trim(), tags, fields };
  }).filter((c) => c.phone);
}

/** Verifica se agora está dentro do horário comercial configurado. */
export function isWithinBusinessHours(cfg, now = new Date()) {
  if (!cfg || !cfg.enabled) return true;
  const days = cfg.days || [1, 2, 3, 4, 5];
  if (!days.includes(now.getDay())) return false;
  const [sh, sm] = String(cfg.start || '08:00').split(':').map(Number);
  const [eh, em] = String(cfg.end || '18:00').split(':').map(Number);
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes >= sh * 60 + sm && minutes < eh * 60 + em;
}

/**
 * Compara telefones tolerando o 9º dígito dos celulares brasileiros
 * (o WhatsApp às vezes identifica 55 41 9xxxx-xxxx como 55 41 xxxx-xxxx).
 */
export function samePhone(a, b) {
  const x = normalizePhone(a);
  const y = normalizePhone(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const br = (p) => (p.startsWith('55') && (p.length === 12 || p.length === 13) ? p.slice(2, 4) + p.slice(-8) : null);
  return Boolean(br(x)) && br(x) === br(y);
}
