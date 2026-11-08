// Índice de tudo o que a empresa sabe sobre cada pessoa, lendo TODO o histórico (não só o que chega daqui para frente): vendas, orçamentos e
// contratos, prospectos, conversas, fichas de cadastro, Pix, contratos e clientes do sistema antigo e documentos. A Maria usa este índice para
// achar cliente, CPF, telefone e contrato. É montado na hora a partir dos dados guardados (nada fica desatualizado) e SÓ LÊ.
// Duas pessoas só viram uma quando têm o MESMO CPF, o MESMO telefone ou a MESMA conversa; nome igual sozinho não junta (existem homônimos, como "João Batista").
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const digits = (s) => String(s ?? '').replace(/\D/g, '');
const cents = (v) => Math.round(Number(v || 0) * 100) / 100;
const phoneKey = (p) => { const d = digits(p); return d.length >= 8 ? d.slice(-9) : ''; };
const docKey = (d) => { const x = digits(d); return x.length >= 6 ? x : ''; };
const ctNumber = (n) => `CT-${String(n || '').replace(/^ORC-/, '')}`;

const SOURCES = ['sale', 'quote', 'lead', 'conversation', 'closing', 'payment', 'legacyContract', 'legacyClient', 'document'];

/**
 * src: listas JÁ filtradas para quem está perguntando (a Maria não mostra a um vendedor o que não é dele).
 * { sales, quotes, leads, conversations, closing, payments, legacyContracts, legacyClients, documents, docOf }
 */
export function buildDirectory(src = {}) {
  const records = [];
  const add = (r) => { records.push({ names: [], docs: [], phones: [], emails: [], convKeys: [], items: [], ...r }); };
  const docOf = src.docOf || (() => '');

  for (const s of src.sales || []) {
    const paid = cents((s.parcels || []).filter((p) => p.status === 'pago').reduce((a, p) => a + Number(p.value || 0), 0));
    add({ source: 'sale', names: [s.client?.nome], docs: [docOf(s) || s.client?.doc], phones: [s.client?.phone], items: [{ kind: s.legacy ? 'venda do sistema antigo' : 'venda', number: s.legacyNumber || s.number, status: s.status, total: cents(s.total), paid, open: cents(Number(s.total || 0) - paid), seller: s.sellerName || '', saleId: s.id, quoteId: s.quoteId || null }] });
  }
  for (const q of src.quotes || []) {
    const c = q.contract?.client || {};
    const items = [{ kind: 'orçamento', number: q.number, status: q.validUntil && q.validUntil < new Date().toISOString().slice(0, 10) ? 'vencido' : 'ativo', total: cents(q.plan?.total), validUntil: q.validUntil, quoteId: q.id }];
    if (q.contract) items.push({ kind: 'contrato', number: ctNumber(q.number), status: q.contract.status === 'assinado' ? 'assinado pelo cliente' : q.contract.status === 'enviado' ? 'enviado, sem assinatura' : 'gerado', total: cents(q.plan?.total), quoteId: q.id, signed: q.contract.status === 'assinado' });
    add({ source: 'quote', names: [c.nome, q.client], docs: [c.cpf], phones: [q.phone, c.whatsapp], emails: [c.email], convKeys: [q.convKey], items });
  }
  for (const l of src.leads || []) add({ source: 'lead', names: [l.name], phones: [l.phone], emails: [l.email], instagram: l.instagram, convKeys: [l.conversationKey, l.whatsappKey], items: [{ kind: 'prospecto', number: l.code || l.id, status: l.stage, seller: l.ownerName || '', leadId: l.id }] });
  for (const c of src.conversations || []) {
    const msgs = c.messages?.length || 0;
    add({ source: 'conversation', names: [c.name], phones: [c.phone], instagram: c.username, convKeys: [c.key], items: [{ kind: String(c.key).startsWith('ig:') ? 'conversa no Instagram' : 'conversa no WhatsApp', number: '', status: `${msgs} mensagem(ns)`, convKey: c.key }] });
  }
  for (const f of src.closing || []) {
    const d = f.data || {};
    add({ source: 'closing', names: [d.nome], docs: [d.cpf], phones: [d.whatsapp, d.telefone], emails: [d.email], convKeys: [f.convKey], items: [{ kind: 'ficha de cadastro', number: '', status: f.status === 'preenchida' ? 'preenchida pelo cliente' : 'enviada, sem preencher', formId: f.id }] });
  }
  for (const p of src.payments || []) {
    const keyPhone = p.convKey && /@s\.whatsapp\.net$/.test(String(p.convKey)) ? String(p.convKey).split('@')[0] : '';
    add({ source: 'payment', names: [p.payerName], docs: [p.payerDoc], phones: [p.payerPhone, keyPhone], convKeys: [p.convKey], items: [{ kind: p.purpose ? 'Pix avulso' : 'Pix', number: p.id, status: p.status === 'paid' ? 'pago' : p.status === 'pending' ? 'em aberto' : p.status, total: cents(p.amount), description: p.description || '' }] });
  }
  for (const r of src.legacyContracts || []) add({ source: 'legacyContract', names: [r.client], docs: [r.doc], phones: [r.phone], emails: [r.email], items: [{ kind: 'contrato do sistema antigo', number: String(r.number || ''), status: r.status || '', total: r.value ?? null, paid: r.paid ?? null }] });
  for (const c of src.legacyClients || []) add({ source: 'legacyClient', names: [c.name], docs: [c.doc], phones: [c.phone], emails: [c.email], items: [{ kind: 'cliente do sistema antigo', number: '', status: '' }] });
  for (const d of src.documents || []) add({ source: 'document', names: [d.clientName], phones: [d.phone], items: [{ kind: 'documento', number: '', status: d.type || d.title || '' }] });

  // Junta quem tem o mesmo CPF ou o mesmo telefone (união de conjuntos).
  const parent = records.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const seen = new Map();
  records.forEach((r, i) => {
    // Mesma conversa (chave do WhatsApp ou do Instagram) também liga: o prospecto do Instagram, o Pix e a ficha da mesma conversa são a mesma pessoa.
    const keys = [...r.docs.map(docKey).filter(Boolean).map((k) => `d:${k}`), ...r.phones.map(phoneKey).filter(Boolean).map((k) => `p:${k}`), ...r.convKeys.filter(Boolean).map((k) => `c:${k}`)];
    for (const k of keys) { if (seen.has(k)) parent[find(i)] = find(seen.get(k)); else seen.set(k, i); }
  });
  const groups = new Map();
  records.forEach((r, i) => { const g = find(i); (groups.get(g) || groups.set(g, []).get(g)).push(r); });

  const people = [...groups.values()].map((rs) => {
    const names = [...new Set(rs.flatMap((r) => r.names).map((n) => String(n || '').replace(/\s+/g, ' ').trim()).filter(Boolean))];
    // O nome "bom" é o mais completo (mais palavras), sem ser um @ ou número.
    const nice = names.filter((n) => !/^[@+\d]/.test(n)).sort((a, b) => b.split(' ').length - a.split(' ').length)[0] || names[0] || '';
    const cpfs = [...new Set(rs.flatMap((r) => r.docs).map(digits).filter((d) => d.length === 11 || d.length === 14))];
    const phones = [...new Set(rs.flatMap((r) => r.phones).map(digits).filter((d) => d.length >= 8))];
    const items = rs.flatMap((r) => r.items);
    return {
      name: nice, names, cpfs, phones, emails: [...new Set(rs.flatMap((r) => r.emails).filter(Boolean))],
      instagram: rs.map((r) => r.instagram).find(Boolean) || '', sources: [...new Set(rs.map((r) => r.source))], items,
      contracts: items.filter((i) => ['contrato', 'venda', 'venda do sistema antigo', 'contrato do sistema antigo'].includes(i.kind)),
    };
  });
  return { people, count: people.length, records: records.length, bySource: SOURCES.reduce((m, s) => ({ ...m, [s]: records.filter((r) => r.source === s).length }), {}) };
}

/**
 * Procura por nome (todas as palavras, início de palavra), CPF (completo ou parte), telefone (qualquer formato, com ou sem 55) ou
 * número de contrato/orçamento/venda (CT-2026-09767, ORC-..., ANT-..., 09767). Devolve as pessoas mais prováveis primeiro.
 */
export function searchDirectory(dir, query, { limit = 6 } = {}) {
  const raw = String(query || '').trim();
  const qd = digits(raw);
  const qn = fold(raw);
  if (qn.length < 2 && qd.length < 4) return [];
  const isNumberish = /^[a-z]{2,4}[- ]?\d[\d-]*$/i.test(raw) || (qd.length >= 3 && qd.length <= 7 && !/[a-z]/i.test(raw.replace(/\s/g, '')));
  const out = [];
  for (const p of dir.people) {
    let score = 0; const why = [];
    for (const it of p.items) {
      const num = String(it.number || '').toLowerCase();
      if (num && raw && (num === raw.toLowerCase() || (isNumberish && (digits(num).endsWith(qd) && qd.length >= 3 && digits(num).length >= qd.length)) || num.includes(raw.toLowerCase().replace(/\s+/g, '-')))) { score += 6; why.push(`número ${it.number}`); break; }
    }
    if (qd.length >= 8) {
      if (p.phones.some((ph) => ph.slice(-9) === qd.slice(-9) || ph.endsWith(qd) || qd.endsWith(ph.slice(-9)))) { score += 5; why.push('telefone'); }
      if (p.cpfs.some((c) => c === qd || c.startsWith(qd) || c.endsWith(qd))) { score += 5; why.push('CPF'); }
    } else if (qd.length >= 4 && !isNumberish) {
      if (p.cpfs.some((c) => c.includes(qd))) { score += 3; why.push('parte do CPF'); }
      if (p.phones.some((ph) => ph.endsWith(qd))) { score += 3; why.push('final do telefone'); }
    }
    if (qn.length >= 2 && /[a-z]/.test(qn)) {
      const toks = qn.split(' ').filter(Boolean);
      const hit = p.names.some((n) => { const w = fold(n).split(' '); return toks.every((t) => w.some((x) => x.startsWith(t))); });
      if (hit) { score += 2 + (p.names.some((n) => fold(n) === qn) ? 2 : 0); why.push('nome'); }
      if (p.instagram && fold(p.instagram) === qn.replace(/^ /, '')) { score += 3; why.push('@instagram'); }
    }
    if (score > 0) out.push({ person: p, score, why: [...new Set(why)] });
  }
  return out.sort((a, b) => b.score - a.score || b.person.items.length - a.person.items.length).slice(0, limit);
}

const money = (v) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
export const fmtCpf = (d) => (d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : d);
export const fmtFone = (d) => (/^55\d{10,11}$/.test(d) ? `+55 ${d.slice(2, 4)} ${d.slice(4, d.length - 4)}-${d.slice(-4)}` : `+${d}`);

/** Texto curto para a Maria responder sobre uma pessoa: contato, documentos e onde estão os contratos. */
export function describePerson(p, { maxItems = 6 } = {}) {
  const lines = [`*${p.name || 'Sem nome'}*${p.phones[0] ? ` · ${fmtFone(p.phones[0])}` : ''}${p.cpfs[0] ? ` · CPF ${fmtCpf(p.cpfs[0])}` : ''}${p.instagram ? ` · @${p.instagram}` : ''}`];
  const keep = p.items.filter((i) => !['conversa no Instagram', 'conversa no WhatsApp', 'cliente do sistema antigo', 'documento'].includes(i.kind) || true);
  const rank = (i) => ['contrato', 'venda', 'venda do sistema antigo', 'contrato do sistema antigo', 'orçamento', 'Pix', 'Pix avulso', 'ficha de cadastro', 'prospecto'].indexOf(i.kind);
  const shown = keep.filter((i) => rank(i) >= 0).sort((a, b) => rank(a) - rank(b)).slice(0, maxItems);
  for (const i of shown) {
    const bits = [i.number && `${i.number}`, i.status, i.total != null && i.total !== '' ? money(i.total) : '', i.paid != null && i.paid !== '' && ['venda', 'venda do sistema antigo', 'contrato do sistema antigo'].includes(i.kind) ? `pago ${money(i.paid)}` : '', i.description].filter(Boolean);
    lines.push(`   • ${i.kind}: ${bits.join(' · ')}`);
  }
  const hidden = p.items.filter((i) => rank(i) >= 0).length - shown.length;
  if (hidden > 0) lines.push(`   …e mais ${hidden} registro(s).`);
  const conv = p.items.filter((i) => i.kind.startsWith('conversa')).length;
  if (conv) lines.push(`   • ${conv} conversa(s) guardada(s)`);
  return lines.join('\n');
}
