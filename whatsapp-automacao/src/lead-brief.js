// Ficha do vendedor: a conversa COMPLETA que o cliente teve antes de chegar a ele (Instagram, site ou WhatsApp, em ordem de tempo) e um resumo
// "Conheça o cliente" só com FATOS tirados dos registros: o que ele disse quando foi perguntado, a peneira da IA, orçamento, contrato e Pix.
// Nada é inventado aqui. Quem pode ver é decidido por crm.get (dono do prospecto, administrador do escritório ou administrador).
const DAY = 86_400_000;
const HOUR = 3_600_000;
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const channelOf = (key) => (String(key || '').startsWith('ig:') ? 'Instagram' : 'WhatsApp');
/** Mensagens que o sistema grava só como aviso interno (não são fala de ninguém). */
const isMarker = (m) => /^\[(Pix|arquivo|áudio|imagem|documento)[^\]]*\]/i.test(String(m.content || '').trim());

/** Conversa completa do prospecto: todas as conversas ligadas a ele, em ordem de tempo, com o canal de cada mensagem. */
export function fullConversation(lead, getConv, { max = 400 } = {}) {
  const keys = [...new Set([lead.conversationKey, lead.whatsappKey].filter(Boolean))];
  const all = [];
  for (const key of keys) {
    const conv = getConv(key);
    for (const m of conv?.messages || []) all.push({ role: m.role, content: m.content, at: m.at, channel: channelOf(key), who: m.role === 'user' ? 'cliente' : 'atendimento' });
  }
  all.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return { messages: all.slice(-max), total: all.length, channels: keys.map(channelOf) };
}

/** Pergunta da atendente + o que o cliente respondeu (é aqui que o vendedor vê "o que ela falou quando foi questionada"). */
export function questionAnswers(messages, { max = 10 } = {}) {
  const out = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== 'assistant' || isMarker(m) || !String(m.content || '').includes('?')) continue;
    const answers = [];
    for (let j = i + 1; j < messages.length && messages[j].role === 'user'; j++) answers.push(clip(messages[j].content, 200));
    if (answers.length) out.push({ question: clip(m.content.split(/(?<=[.!?])\s+/).filter((x) => x.includes('?')).pop() || m.content, 180), answer: answers.join(' / '), at: messages[i + 1].at });
  }
  return out.slice(-max);
}

export function clientBrief({ lead, messages, quotes = [], payments = [], now = Date.now() }) {
  const client = messages.filter((m) => m.who === 'cliente');
  const first = messages[0];
  const lastClient = client.at(-1);
  const q = lead.qualification || {};
  const facts = [];
  if (first) facts.push({ label: 'Primeiro contato', value: `${new Date(first.at).toLocaleDateString('pt-BR')} pelo ${[...new Set(messages.map((m) => m.channel))].join(' e ')}${lead.adTitle ? ` (anúncio: ${lead.adTitle})` : ''}` });
  if (client[0]) facts.push({ label: 'Primeira frase dele', value: `"${clip(client[0].content, 160)}"` });
  if (lead.interest) facts.push({ label: 'Interesse', value: `${lead.interest}${lead.people > 1 ? ` · ${lead.people} pessoas` : ''}${lead.value ? ` · R$ ${Number(lead.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : ''}` });
  if (q.money) facts.push({ label: 'Dinheiro', value: `${q.money}${q.moneyEvidence ? ` — disse: "${clip(q.moneyEvidence, 140)}"` : ''}` });
  if (q.start) facts.push({ label: 'Quer iniciar', value: q.start });
  if (q.objections) facts.push({ label: 'Dúvidas e objeções', value: q.objections });
  if (lead.city) facts.push({ label: 'Cidade', value: lead.city });
  if (lead.contractData) facts.push({ label: 'Dados para formalizar', value: lead.contractData });
  if (lead.aiSummary) facts.push({ label: 'Resumo da IA', value: lead.aiSummary });

  // Situação do negócio, só com o que está registrado.
  const status = [];
  const mine = quotes.filter((x) => x.leadId === lead.id || (lead.conversationKey && x.convKey === lead.conversationKey));
  const quote = mine.at(-1);
  if (!quote) status.push('Ainda não recebeu orçamento.');
  else {
    const left = Math.round((Date.parse(`${quote.validUntil}T12:00:00Z`) - now) / DAY);
    status.push(`Orçamento ${quote.number} de R$ ${Number(quote.plan?.total || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}: ${left < 0 ? 'vencido' : left === 0 ? 'vence hoje' : `vence em ${left} dia(s)`}.`);
    if (quote.contract?.status === 'assinado') status.push('Contrato já assinado.');
    else if (quote.contract?.status) status.push('Contrato enviado, ainda sem assinatura.');
  }
  const pays = payments.filter((p) => p.leadId === lead.id || (lead.conversationKey && p.convKey === lead.conversationKey));
  const paid = pays.filter((p) => p.status === 'paid'); const open = pays.filter((p) => p.status === 'pending');
  if (paid.length) status.push(`Pix pago: ${paid.map((p) => `R$ ${p.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`).join(' + ')}.`);
  if (open.length) status.push(`Pix em aberto: R$ ${open.at(-1).amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`);
  if (lastClient) {
    const gone = now - Date.parse(lastClient.at);
    status.push(gone < HOUR ? 'Falou com a gente há menos de 1 hora.' : gone < DAY ? `Última mensagem dele: há ${Math.round(gone / HOUR)} h.` : `Última mensagem dele: há ${Math.round(gone / DAY)} dia(s).`);
    if (messages.at(-1)?.who === 'atendimento' && gone > 2 * HOUR) status.push('A última mensagem é nossa: ele ainda não respondeu.');
  }
  return {
    counts: { total: messages.length, cliente: client.length, atendimento: messages.length - client.length },
    facts, status, qa: questionAnswers(messages), channels: [...new Set(messages.map((m) => m.channel))],
  };
}
