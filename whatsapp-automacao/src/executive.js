// Painel executivo: cobranças e vencimentos por período, recebimentos, vendas, atrasos e semanas a receber.
// Tudo calculado das vendas e parcelas que o sistema já tem (valores em R$).
const cents = (v) => Math.round(Number(v || 0) * 100) / 100;
const TZ = 'America/Sao_Paulo';
export const dayStr = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });
const parse = (s) => new Date(`${s}T12:00:00Z`);
const addDays = (s, n) => dayStr(new Date(parse(s).getTime() + n * 86400000));
const monthKey = (s) => s.slice(0, 7);

export function periods(today) {
  const dow = (parse(today).getUTCDay() + 6) % 7; // segunda = 0
  const weekStart = addDays(today, -dow);
  const [y, m] = today.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    hoje: { label: 'Hoje', from: today, to: today },
    semana: { label: 'Esta semana', from: weekStart, to: addDays(weekStart, 6) },
    mes: { label: 'Este mês', from: `${y}-${String(m).padStart(2, '0')}-01`, to: `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}` },
    ano: { label: 'Este ano', from: `${y}-01-01`, to: `${y}-12-31` },
  };
}

/** Parcelas de vendas ativas, já com o cliente, o vendedor e os dias de atraso. */
function flatParcels(sales, today) {
  const out = [];
  for (const s of sales) {
    if (s.status === 'cancelada') continue;
    (s.parcels || []).forEach((p, i) => {
      const paid = p.status === 'pago';
      out.push({
        saleId: s.id, number: s.number, client: s.client?.nome || '', phone: s.client?.phone || '', seller: s.sellerName || '', index: i, label: p.label,
        value: Number(p.value) || 0, due: p.due || '', paid, paidAt: p.paidAt || '',
        late: !paid && Boolean(p.due) && p.due < today, daysLate: !paid && p.due && p.due < today ? Math.round((parse(today) - parse(p.due)) / 86400000) : 0,
      });
    });
  }
  return out;
}

export function buildExecutive({ sales, now = Date.now(), crm = null, extras = {} }) {
  const today = dayStr(now);
  const per = periods(today);
  const parcels = flatParcels(sales, today);
  const active = sales.filter((s) => s.status !== 'cancelada');
  const sum = (arr, f) => cents(arr.reduce((a, x) => a + f(x), 0));
  const inR = (d, r) => Boolean(d) && d >= r.from && d <= r.to;

  // Cobranças e vencimentos: o que vence no período, quanto já entrou, quanto falta e quanto está atrasado.
  const cobrancas = Object.fromEntries(Object.entries(per).map(([k, r]) => {
    const vence = parcels.filter((p) => inR(p.due, r));
    return [k, {
      label: r.label, from: r.from, to: r.to, quantidade: vence.length,
      vence: sum(vence, (p) => p.value),
      recebido: sum(vence.filter((p) => p.paid), (p) => p.value),
      aReceber: sum(vence.filter((p) => !p.paid && !p.late), (p) => p.value),
      atrasado: sum(vence.filter((p) => p.late), (p) => p.value),
      entrou: sum(parcels.filter((p) => p.paid && inR((p.paidAt || '').slice(0, 10), r)), (p) => p.value),
    }];
  }));

  // Últimos 12 meses: recebido (pela data do pagamento) e vendido (pela data da venda).
  const months = [];
  const [cy, cm] = today.split('-').map(Number);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(cy, cm - 1 - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    months.push({
      key, label: d.toLocaleDateString('pt-BR', { month: 'short', timeZone: 'UTC' }).replace('.', ''),
      recebido: sum(parcels.filter((p) => p.paid && monthKey((p.paidAt || '').slice(0, 10)) === key), (p) => p.value),
      vendido: sum(active.filter((s) => monthKey(String(s.createdAt || '').slice(0, 10)) === key), (s) => s.total),
      vendas: active.filter((s) => monthKey(String(s.createdAt || '').slice(0, 10)) === key).length,
    });
  }

  // Próximas 8 semanas: quanto deve entrar.
  const semanas = [];
  const start = per.semana.from;
  for (let i = 0; i < 8; i++) {
    const from = addDays(start, i * 7); const to = addDays(from, 6);
    const w = parcels.filter((p) => !p.paid && !p.late && inR(p.due, { from, to }));
    semanas.push({ from, to, valor: sum(w, (p) => p.value), quantidade: w.length });
  }

  const atrasadas = parcels.filter((p) => p.late).sort((a, b) => b.daysLate - a.daysLate || b.value - a.value);
  const faixas = [['1 a 7 dias', 1, 7], ['8 a 30 dias', 8, 30], ['31 a 90 dias', 31, 90], ['Mais de 90 dias', 91, 99999]]
    .map(([label, lo, hi]) => { const g = atrasadas.filter((p) => p.daysLate >= lo && p.daysLate <= hi); return { label, quantidade: g.length, valor: sum(g, (p) => p.value) }; });

  const vendedores = {};
  for (const s of active) {
    const k = s.sellerName || 'Sem vendedor';
    const v = (vendedores[k] ||= { name: k, vendas: 0, vendido: 0, recebido: 0, comissaoAberta: 0 });
    if (inR(String(s.createdAt || '').slice(0, 10), per.mes)) { v.vendas += 1; v.vendido += s.total; }
    v.recebido += sum((s.parcels || []).filter((p) => p.status === 'pago' && inR((p.paidAt || '').slice(0, 10), per.mes)), (p) => p.value);
    if (s.commission && s.commission.status !== 'paga') v.comissaoAberta += Number(s.commission.value) || 0;
  }

  return {
    hoje: today,
    cobrancas,
    kpis: {
      recebidoMes: cobrancas.mes.entrou,
      aReceberTotal: sum(parcels.filter((p) => !p.paid), (p) => p.value),
      atrasadoTotal: sum(atrasadas, (p) => p.value),
      atrasadasQtd: atrasadas.length,
      vendasMes: months.at(-1).vendas,
      vendidoMes: months.at(-1).vendido,
      contratosAtivos: active.length,
      comissaoAberta: sum(active.filter((s) => s.commission && s.commission.status !== 'paga'), (s) => Number(s.commission.value) || 0),
    },
    months, semanas, faixas,
    atrasadas: atrasadas.slice(0, 15),
    vendedores: Object.values(vendedores).map((v) => ({ ...v, vendido: cents(v.vendido), recebido: cents(v.recebido), comissaoAberta: cents(v.comissaoAberta) })).sort((a, b) => b.vendido - a.vendido).slice(0, 8),
    crm,
    extras,
  };
}
