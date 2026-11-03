// Ficha única do cliente (visão 360): tudo o que existe sobre uma pessoa em um lugar só, em ordem de data.
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const digits = (v) => String(v || '').replace(/\D/g, '');
const round = (v) => Math.round(v * 100) / 100;

export class Customer360 {
  /** deps: funções que devolvem as listas (assim a ficha lê sempre o dado atual). */
  constructor({ sales, quotes, leads, conversations, documents, legacyClients, legacyContracts, collectionsLog = () => [], today = () => new Date().toISOString().slice(0, 10) }) {
    Object.assign(this, { sales, quotes, leads, conversations, documents, legacyClients, legacyContracts, collectionsLog, today });
  }
  #same(a, b) { const x = digits(a); const y = digits(b); return x.length >= 8 && y.length >= 8 && (x === y || x.slice(-9) === y.slice(-9)); }
  #matcher({ phone = '', doc = '', name = '' }) {
    const d = digits(doc); const n = norm(name);
    return (o) => (d.length >= 6 && digits(o.doc) === d) || (phone && this.#same(o.phone, phone)) || (n.length >= 5 && norm(o.name) === n);
  }

  /** Procura por nome, telefone ou documento em todas as fontes e junta quem é a mesma pessoa. */
  search(q, limit = 30) {
    const t = norm(q); const td = digits(q);
    if (t.length < 2 && td.length < 4) return [];
    const groups = [];
    const add = (name, phone, doc, source) => {
      const keys = [digits(doc).length >= 6 ? `d:${digits(doc)}` : '', digits(phone).length >= 8 ? `p:${digits(phone).slice(-9)}` : '', norm(name).length >= 5 ? `n:${norm(name)}` : ''].filter(Boolean);
      if (!keys.length) return;
      const hit = (norm(name).includes(t) && t.length >= 2) || (td.length >= 4 && (digits(phone).includes(td) || digits(doc).includes(td)));
      // Junta com quem já apareceu por qualquer chave em comum (mesmo documento, telefone ou nome).
      let g = groups.find((x) => keys.some((k) => x.keys.has(k)));
      if (!g) { g = { keys: new Set(), name: '', phone: '', doc: '', sources: new Set(), hit: false }; groups.push(g); }
      keys.forEach((k) => g.keys.add(k));
      g.name ||= name || ''; g.phone ||= digits(phone); g.doc ||= doc || ''; g.sources.add(source); g.hit ||= hit;
    };
    for (const c of this.legacyClients()) add(c.name, c.phone, c.doc, 'cliente antigo');
    for (const l of this.leads()) add(l.name, l.phone, '', 'CRM');
    for (const s of this.sales()) add(s.client?.nome, s.client?.phone, s.client?.doc, 'venda');
    for (const d of this.documents()) add(d.clientName, d.phone, '', 'documento');
    return groups.filter((g) => g.hit).slice(0, limit).map((g) => ({ key: [...g.keys][0], name: g.name, phone: g.phone, doc: g.doc, sources: [...g.sources] }));
  }

  /** Cadastros repetidos: mesma pessoa (documento, telefone ou nome igual) escrita mais de uma vez na mesma lista. Só detecta; juntar é decisão de uma pessoa. */
  duplicates({ source = 'clients' } = {}) {
    const items = (source === 'leads' ? this.leads().map((l) => ({ id: l.id, name: l.name, phone: l.phone, doc: '', email: '', extra: l.stage })) : this.legacyClients().map((c) => ({ id: c.id, name: c.name, phone: c.phone, doc: c.doc, email: c.email, extra: '' }))).filter((x) => x.id);
    const parent = new Map(items.map((x) => [x.id, x.id]));
    const find = (a) => { while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); } return a; };
    const seen = new Map(); const why = new Map();
    for (const x of items) {
      for (const [k, label] of [[digits(x.doc).length >= 6 ? `d:${digits(x.doc)}` : '', 'mesmo documento'], [digits(x.phone).length >= 8 ? `p:${digits(x.phone).slice(-9)}` : '', 'mesmo telefone'], [norm(x.name).split(' ').length >= 2 && norm(x.name).length >= 8 ? `n:${norm(x.name)}` : '', 'mesmo nome']]) {
        if (!k) continue;
        if (seen.has(k)) { parent.set(find(x.id), find(seen.get(k))); why.set(find(x.id), new Set([...(why.get(find(x.id)) || []), label])); } else seen.set(k, x.id);
      }
    }
    const out = new Map();
    for (const x of items) { const r = find(x.id); if (!out.has(r)) out.set(r, []); out.get(r).push(x); }
    return [...out.values()].filter((g) => g.length > 1).map((g) => ({ reasons: [...new Set(g.flatMap((x) => [...(why.get(find(x.id)) || [])]))], members: g })).sort((a, b) => b.members.length - a.members.length);
  }

  build({ phone = '', doc = '', name = '' }) {
    const match = this.#matcher({ phone, doc, name });
    const sales = this.sales().filter((s) => match({ doc: s.client?.doc, phone: s.client?.phone, name: s.client?.nome }));
    // Quem já aparece em uma venda traz o documento e o nome certos para achar o resto.
    const ids = { phone, doc: doc || sales.find((s) => s.client?.doc)?.client.doc || '', name: name || sales[0]?.client?.nome || '' };
    const m2 = this.#matcher(ids);
    const legacy = this.legacyClients().filter((c) => m2(c));
    const person = { name: ids.name || legacy[0]?.name || '', phone: digits(phone) || digits(legacy.find((c) => c.phone)?.phone) || digits(sales.find((s) => s.client?.phone)?.client.phone), doc: ids.doc || legacy.find((c) => c.doc)?.doc || '', email: legacy.find((c) => c.email)?.email || '' };
    const m3 = this.#matcher(person);
    const leads = this.leads().filter((l) => m3({ phone: l.phone, name: l.name }));
    const quotes = this.quotes().filter((q) => m3({ phone: q.phone, name: q.client }) || leads.some((l) => l.id === q.leadId));
    const docs = this.documents().filter((d) => m3({ name: d.clientName, phone: d.phone }) || (person.name && norm(d.dependentOf) === norm(person.name)));
    const convs = this.conversations().filter((c) => c.phone && this.#same(c.phone, person.phone));
    const contracts = this.legacyContracts().filter((r) => m3({ doc: r.doc, phone: r.phone, name: r.client }));

    const t = this.today();
    const parcels = sales.filter((s) => s.status !== 'cancelada').flatMap((s) => s.parcels.map((p, i) => ({ ...p, saleNumber: s.legacyNumber || s.number, saleId: s.id, index: i })));
    const sum = (l) => round(l.reduce((a, p) => a + p.value, 0));
    const money = { sold: round(sales.filter((s) => s.status !== 'cancelada').reduce((a, s) => a + s.total, 0)), received: sum(parcels.filter((p) => p.status === 'pago')), open: sum(parcels.filter((p) => p.status !== 'pago')), overdue: sum(parcels.filter((p) => p.status !== 'pago' && p.due && p.due < t)), overdueParcels: parcels.filter((p) => p.status !== 'pago' && p.due && p.due < t).length, parcelsTotal: parcels.length, parcelsPaid: parcels.filter((p) => p.status === 'pago').length };

    const tl = [];
    const ev = (date, kind, text) => { if (date) tl.push({ date: String(date), kind, text }); };
    for (const s of sales) { ev(s.createdAt, 'venda', `Venda ${s.legacyNumber || s.number} lançada: R$ ${s.total.toLocaleString('pt-BR')}${s.status === 'cancelada' ? ' (cancelada)' : ''}`); for (const p of s.parcels) if (p.status === 'pago') ev(p.paidAt, 'pagamento', `${p.label} recebida: R$ ${p.value.toLocaleString('pt-BR')}${p.method ? ` (${p.method})` : ''}`); }
    for (const q of quotes) ev(q.createdAt || q.issued, 'orçamento', `Orçamento ${q.number}: R$ ${q.plan.total.toLocaleString('pt-BR')} (válido até ${q.validUntil.split('-').reverse().join('/')})`);
    for (const d of docs) { ev(d.issuedAt, 'documento', `${d.type.replace(/_/g, ' ')} emitido${d.number ? ` (nº ${d.number})` : ''}`); ev(d.deliveredAt, 'documento', 'Documento entregue'); }
    for (const l of leads) { ev(l.createdAt, 'crm', `Entrou no CRM (${l.stage})`); for (const e of (l.timeline || []).slice(-30)) ev(e.at, 'crm', String(e.text || e.type || '').slice(0, 160)); }
    for (const c of convs) { const m = c.messages || []; if (m.length) { ev(m[0].at, 'conversa', `Primeira mensagem: "${String(m[0].content || '').slice(0, 80)}"`); ev(m.at(-1).at, 'conversa', `Última mensagem: "${String(m.at(-1).content || '').slice(0, 80)}"`); } }
    for (const l of this.collectionsLog()) if (l.ok && sales.some((s) => s.id === l.saleId)) ev(l.at, 'cobrança', 'Aviso de cobrança enviado');
    tl.sort((a, b) => b.date.localeCompare(a.date));

    return {
      person, money,
      sales: sales.map((s) => ({ id: s.id, number: s.legacyNumber || s.number, legacy: Boolean(s.legacy), status: s.status, total: s.total, seller: s.sellerName || '', createdAt: s.createdAt, parcels: s.parcels.map((p) => ({ label: p.label, value: p.value, due: p.due, status: p.status, paidAt: p.paidAt || '', late: p.status !== 'pago' && Boolean(p.due) && p.due < t, claimed: Boolean(p.claim) })) })),
      quotes: quotes.map((q) => ({ number: q.number, total: q.plan.total, validUntil: q.validUntil, issued: q.issued })),
      documents: docs.map((d) => ({ type: d.type, number: d.number, status: d.status, issuedAt: d.issuedAt, renewalAt: d.renewalAt })),
      leads: leads.map((l) => ({ id: l.id, stage: l.stage, owner: l.ownerName || '', interest: l.interest || '', code: l.code })),
      contracts: contracts.map((r) => ({ number: r.number, value: r.value, status: r.status, date: r.date, files: (r.files || []).length })),
      conversations: convs.map((c) => ({ key: c.key, messages: (c.messages || []).slice(-12).map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 300), at: m.at })) })),
      timeline: tl.slice(0, 80),
    };
  }
}
