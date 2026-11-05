// Quadros dos contratos (um por contrato, com prévia), busca, filtros e a consulta que a IA faz sobre o contrato do PRÓPRIO cliente.
// Junta as vendas do sistema novo e os contratos copiados do sistema antigo (sem repetir o mesmo contrato).
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const digits = (v) => String(v || '').replace(/\D/g, '');
const round = (v) => Math.round(v * 100) / 100;
const DAY = 86_400_000;
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY);

export class ContractCards {
  constructor({ sales, legacy, quotes = () => [], documents = () => [], legacyClients = () => [], today = () => new Date().toISOString().slice(0, 10) }) {
    Object.assign(this, { sales, legacy, quotes, documents, legacyClients, today });
  }
  #phoneOf(name, doc) {
    const c = this.legacyClients().find((x) => (doc && x.doc && digits(x.doc) === digits(doc)) || (name && norm(x.name) === norm(name)));
    return digits(c?.phone);
  }
  #renewal(name) {
    const t = this.today(); const n = norm(name);
    const docs = this.documents().filter((d) => !d.deletedAt && (norm(d.clientName) === n || norm(d.dependentOf) === n) && d.renewalAt);
    if (!docs.length) return null;
    const next = docs.map((d) => ({ at: d.renewalAt, notice: d.noticeAt || d.renewalAt, type: d.type, number: d.number })).sort((a, b) => a.at.localeCompare(b.at))[0];
    const days = daysBetween(t, next.at);
    return { ...next, days, state: days < 0 ? 'vencido' : next.notice <= t ? 'renovar' : days <= 60 ? 'proximo' : 'ok' };
  }

  /** Todos os contratos como quadros. */
  all() {
    const t = this.today(); const cards = []; const taken = new Set();
    for (const s of this.sales()) {
      const num = s.legacyNumber || s.number; if (s.legacyNumber) taken.add(String(s.legacyNumber));
      const live = s.status !== 'cancelada';
      const open = s.parcels.filter((p) => p.status !== 'pago');
      const paid = round(s.parcels.filter((p) => p.status === 'pago').reduce((a, p) => a + p.value, 0));
      const overdue = open.filter((p) => p.due && p.due < t);
      const nextOpen = open.filter((p) => p.due && p.due >= t).sort((a, b) => a.due.localeCompare(b.due))[0] || null;
      const q = s.quoteId ? this.quotes().find((x) => x.id === s.quoteId) : null;
      const signed = q?.contract?.status === 'assinado' ? 'assinado' : q?.contract ? 'aguardando' : s.legacy ? 'antigo' : '';
      cards.push({
        key: `v:${s.id}`, kind: 'venda', saleId: s.id, number: num, client: s.client?.nome || '', doc: s.client?.doc || '', phone: digits(s.client?.phone) || this.#phoneOf(s.client?.nome, s.client?.doc),
        service: s.items?.[0]?.name || '', total: s.total, paid, open: round(s.total - paid), pct: s.total ? Math.min(100, Math.round((paid / s.total) * 100)) : 0,
        status: !live ? 'cancelado' : open.length === 0 ? 'quitado' : overdue.length ? 'em_atraso' : 'ativo',
        overdueValue: round(overdue.reduce((a, p) => a + p.value, 0)), overdueParcels: overdue.length, overdueDays: overdue.length ? daysBetween(overdue.map((p) => p.due).sort()[0], t) : 0,
        next: nextOpen ? { label: nextOpen.label, due: nextOpen.due, value: nextOpen.value } : null, parcels: s.parcels.length, parcelsPaid: s.parcels.filter((p) => p.status === 'pago').length,
        signature: signed, seller: s.sellerName || '', legacy: Boolean(s.legacy), date: (s.createdAt || '').slice(0, 10), renewal: this.#renewal(s.client?.nome), claimed: open.some((p) => p.claim),
      });
    }
    // Contratos antigos que ainda não viraram venda (por exemplo, sem parcelas): aparecem também, com o que se sabe.
    for (const r of this.legacy()) {
      if (taken.has(String(r.number))) continue;
      const total = r.value ?? 0; const paid = r.paid ?? 0;
      cards.push({
        key: `a:${r.id}`, kind: 'antigo', number: r.number, client: r.client || '', doc: r.doc || '', phone: digits(r.phone) || this.#phoneOf(r.client, r.doc), service: r.service || '', total, paid, open: round(Math.max(0, total - paid)), pct: total ? Math.min(100, Math.round((paid / total) * 100)) : 0,
        status: /cancel|rescind|distrat/i.test(r.status || '') ? 'cancelado' : total && paid >= total ? 'quitado' : 'ativo', overdueValue: 0, overdueParcels: 0, overdueDays: 0, next: r.nextDue ? { label: 'Próximo prazo', due: r.nextDue, value: null } : null, parcels: (r.parcels || []).length, parcelsPaid: (r.parcels || []).filter((p) => p.paid).length,
        signature: 'antigo', seller: r.seller || '', legacy: true, date: r.date || '', renewal: this.#renewal(r.client), statusText: r.status || '', claimed: false,
      });
    }
    return cards;
  }

  /** Busca por nome, nº do contrato, CPF, telefone, serviço ou vendedor + filtro + ordem. */
  search({ q = '', filter = '', sort = 'recente', page = 1, per = 24, canSee = () => true } = {}) {
    const n = norm(q); const d = digits(q);
    let list = this.all().filter((c) => canSee(c));
    if (n || d.length >= 3) list = list.filter((c) => norm(`${c.number} ${c.client} ${c.service} ${c.seller} ${c.statusText || ''}`).includes(n) || (d.length >= 3 && (digits(c.doc).includes(d) || c.phone.includes(d) || digits(c.number).includes(d))));
    // "Vencem em 7 dias": a próxima parcela cai entre hoje e daqui a 7 dias.
    const t = this.today();
    const lim = new Date(new Date(`${t}T12:00:00Z`).getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
    const dueSoon = (c) => c.status !== 'cancelado' && Boolean(c.next?.due) && c.next.due >= t && c.next.due <= lim;
    const counts = { todos: list.length, em_atraso: 0, vencendo: 0, a_renovar: 0, ativo: 0, quitado: 0, cancelado: 0, aguardando: 0 };
    for (const c of list) { if (c.status in counts) counts[c.status] += 1; if (dueSoon(c)) counts.vencendo += 1; if (c.renewal && ['renovar', 'vencido', 'proximo'].includes(c.renewal.state)) counts.a_renovar += 1; if (c.signature === 'aguardando') counts.aguardando += 1; }
    const f = {
      vencendo: dueSoon,
      em_atraso: (c) => c.status === 'em_atraso', a_renovar: (c) => c.renewal && ['renovar', 'vencido', 'proximo'].includes(c.renewal.state), ativo: (c) => c.status === 'ativo',
      quitado: (c) => c.status === 'quitado', cancelado: (c) => c.status === 'cancelado', aguardando: (c) => c.signature === 'aguardando', antigo: (c) => c.legacy, novo: (c) => !c.legacy,
    }[filter];
    if (f) list = list.filter(f);
    const order = { recente: (a, b) => String(b.date).localeCompare(String(a.date)) || String(b.number).localeCompare(String(a.number)), atraso: (a, b) => b.overdueValue - a.overdueValue, valor: (a, b) => b.total - a.total, nome: (a, b) => a.client.localeCompare(b.client, 'pt'), renovacao: (a, b) => (a.renewal?.at || '9999').localeCompare(b.renewal?.at || '9999'), vencimento: (a, b) => (a.next?.due || '9999').localeCompare(b.next?.due || '9999') }[sort] || ((a, b) => 0);
    list.sort(order);
    const p = Math.max(1, Number(page) || 1);
    return { counts, total: list.length, page: p, per, items: list.slice((p - 1) * per, p * per) };
  }

  /** Contratos que pertencem a este telefone (só a própria pessoa): é o que a IA enxerga. */
  forPhone(phone) {
    const p = digits(phone); if (p.length < 8) return [];
    return this.all().filter((c) => c.phone && (c.phone === p || c.phone.slice(-9) === p.slice(-9)) && c.status !== 'cancelado');
  }
  /** Resumo em texto simples dos contratos da pessoa (para a IA e para o prompt). */
  summarizeFor(phone) {
    const list = this.forPhone(phone); if (!list.length) return '';
    const money = (v) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    const br = (d) => String(d).split('-').reverse().join('/');
    return list.slice(0, 5).map((c) => `Contrato ${c.number} (${c.service || 'assessoria'}${c.legacy ? ', do sistema antigo' : ''}): total ${money(c.total)}, pago ${money(c.paid)} (${c.pct}%), em aberto ${money(c.open)}; ${c.overdueParcels ? `EM ATRASO: ${c.overdueParcels} parcela(s), ${money(c.overdueValue)}, desde ${c.overdueDays} dia(s)` : c.next ? `próxima parcela ${c.next.value ? money(c.next.value) : ''} em ${br(c.next.due)}` : c.status === 'quitado' ? 'quitado' : 'sem parcela futura registrada'}${c.renewal ? `; documento a renovar até ${br(c.renewal.at)}` : ''}.`).join('\n');
  }
}
