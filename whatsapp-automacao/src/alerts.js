// Avisos do painel (sininho) e resumo diário no WhatsApp do administrador:
// parcelas vencidas e a vencer, documentos para renovar, contratos esperando assinatura, orçamentos que vencem e tarefas atrasadas.
const money = (v) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
const br = (d) => String(d).split('-').reverse().join('/');
const DAY = 86_400_000;

export class Alerts {
  constructor({ cards, collections, documents, quotes = () => [], tasks = null, today = () => new Date().toISOString().slice(0, 10), now = () => new Date() }) {
    Object.assign(this, { cards, collections, documents, quotes, tasks, today, now });
  }
  build({ user = { role: 'admin' }, inOffice = () => true } = {}) {
    const t = this.today(); const items = [];
    const push = (id, level, title, text, tab, count = 1) => items.push({ id: `${id}:${t}`, level, title, text, tab, count });
    if (user.role === 'admin') {
      const over = this.collections.overdue({ inOffice });
      if (over.length) { const sum = this.collections.summary(over); push('atraso', 'urgente', `${over.length} parcela(s) vencida(s)`, `${money(sum.valor)} em atraso de ${sum.clientes} cliente(s). ${sum.faixas.firme.n} com mais de 60 dias.`, 'collections', over.length); }
      const soon = []; const limit = new Date(this.now().getTime() + 3 * DAY).toISOString().slice(0, 10);
      for (const c of this.cards.all()) if (c.status !== 'cancelado' && c.next && c.next.due >= t && c.next.due <= limit && c.next.value) soon.push(c);
      if (soon.length) push('vence3', 'atencao', `${soon.length} parcela(s) vencem em até 3 dias`, `${money(soon.reduce((s, c) => s + c.next.value, 0))} a receber: ${soon.slice(0, 3).map((c) => `${c.client.split(' ')[0]} (${br(c.next.due)})`).join(', ')}${soon.length > 3 ? '…' : ''}.`, 'contractcards', soon.length);
      const ren = this.cards.all().filter((c) => c.renewal && ['vencido', 'renovar'].includes(c.renewal.state));
      if (ren.length) push('renovar', 'atencao', `${ren.length} documento(s) para renovar`, `${ren.slice(0, 3).map((c) => `${c.client.split(' ')[0]} (${br(c.renewal.at)})`).join(', ')}${ren.length > 3 ? '…' : ''}. Abra Documentos e avise o cliente.`, 'documents', ren.length);
      const wait = this.cards.all().filter((c) => c.signature === 'aguardando' && c.status !== 'cancelado');
      if (wait.length) push('assinar', 'info', `${wait.length} contrato(s) aguardando assinatura`, `${wait.slice(0, 3).map((c) => c.client.split(' ')[0]).join(', ')}${wait.length > 3 ? '…' : ''} ainda não assinaram.`, 'contractcards', wait.length);
      const exp = this.quotes().filter((q) => !q.contract && q.validUntil >= t && q.validUntil <= new Date(this.now().getTime() + DAY).toISOString().slice(0, 10) && !this.cards.sales().some((s) => s.quoteId === q.id));
      if (exp.length) push('orcamento', 'info', `${exp.length} orçamento(s) vencem até amanhã`, `${exp.slice(0, 3).map((q) => q.client).join(', ')}. Depois do prazo ficam desativados.`, 'quotes', exp.length);
    }
    if (this.tasks) { const c = this.tasks.counts(user); if (c.late) push('tarefas', 'atencao', `${c.late} tarefa(s) atrasada(s)`, 'Abra Tarefas para ver o que ficou para trás.', 'tasks', c.late); }
    const rank = { urgente: 0, atencao: 1, info: 2 };
    return items.sort((a, b) => rank[a.level] - rank[b.level]);
  }
  digestText(items) {
    if (!items.length) return '';
    return `🔔 *Resumo do dia da Migra*\n${items.map((i) => `${i.level === 'urgente' ? '🔴' : i.level === 'atencao' ? '🟠' : '🔵'} ${i.title}\n   ${i.text}`).join('\n')}\n\nAbra o painel para ver os detalhes.`;
  }
}
