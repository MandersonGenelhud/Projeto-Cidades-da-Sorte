// Tutoriais e treinamento semanal. Administrador lê o guia do administrador; vendedor lê só o dele (nunca vê a parte do administrador).
// A cada 7 dias entra um treinamento novo de fechamento de venda (feito pela IA, com os números da própria equipe) e os vendedores são avisados no WhatsApp.
import crypto from 'node:crypto';

const clip = (v, n) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, n);
const WEEK_MS = 7 * 86_400_000;
export const AUDIENCES = ['admin', 'seller', 'all'];

export const INCENTIVES = [
  'A cada treinamento você fica melhor em fechar venda, e quem fecha mais ganha mais comissão. Vale 10 minutos agora.',
  'Quem treina toda semana não fica para trás: a equipe está evoluindo e a sua comissão acompanha o seu fechamento.',
  'Mais um passo para você fechar com segurança e ganhar mais. Quem ignora o treinamento perde vendas para quem estuda.',
  'Venda é técnica e prática. Este treinamento é curto, direto e feito para o seu dia a dia aqui.',
];

const SELLER_CLOSING = `Objetivo: o cliente já foi atendido pela IA e chegou até você com as dúvidas esclarecidas. Seu trabalho é fechar: documentação, entrada e contrato. Sem enrolar.

1. Postura
- Fale como quem já decidiu ajudar, não como quem pede permissão. Frases afirmativas: "vamos iniciar", "o próximo passo é".
- Nunca demonstre dúvida, nem peça desculpa pelo preço. O valor é o que o serviço entrega: segurança, equipe e processo.
- Uma pergunta por vez. Mensagens curtas.

2. Roteiro de fechamento
- Retome o que ele já contou (a IA deixa o histórico no sistema). Mostra que você conhece o caso.
- Peça a documentação e já pergunte como prefere pagar a entrada: Pix ou cartão.
- Pix: gere a cobrança. Cartão: informe que a taxa da maquininha é do cliente e que a Migra não cobra juros.
- Peça o comprovante: "assim que pagar, me envie o comprovante para eu dar baixa e te enviar o recibo".

3. Perguntas que fecham (escolha entre duas opções, nunca "quer fechar?")
- "Prefere pagar a entrada no Pix ou no cartão?"
- "Começamos esta semana ou na próxima?"

4. Confiança
- Fale dos passos do processo com segurança. Cliente com receio precisa de clareza, não de pressão.
- Se ele disser "vou pensar", descubra o que falta: valor, prazo, segurança ou outra pessoa. Resolva essa trava e volte ao fechamento.`;

const SELLER_OBJECTIONS = `Objeção quase nunca é "não". É uma dúvida que ainda não foi resolvida. O caminho é sempre o mesmo:

1. Acolha: "Entendo, é uma decisão importante."
2. Descubra o motivo real com UMA pergunta: "Se não fosse isso, você fecharia hoje?"
3. Isole: se a resposta for sim, a objeção é só essa. Se for não, há outra por trás.
4. Contorne com fatos (processo, equipe, passos), sem prometer o que a Migra não garante (aprovação é decisão dos órgãos).
5. Volte ao fechamento com uma escolha.

Casos comuns
- "Está caro": compare com o que o cliente quer evitar (tempo perdido, erro de documentação, risco). Mostre que dá para pagar a entrada no cartão em até 12x, com a taxa do banco (a Migra não cobra juros).
- "Vou falar com meu marido/esposa": concorde, e proponha uma videochamada com o consultor para os dois tirarem as dúvidas. Dê a escolha: manhã ou tarde.
- "Preciso juntar o dinheiro": respeite, deixe o contato agendado e combine a data exata de voltar a falar. Não deixe "depois" em aberto.
- "Tenho receio": pergunte do que exatamente. Medo é falta de informação.

Nunca: pressionar, mentir prazo, prometer resultado, falar mal de concorrente.`;

const SELLER_SYSTEM = `Como usar o sistema (vendedor)

1. Seus clientes
- Em Prospectos ficam os clientes que a IA encaminhou para você, com o resumo da conversa.
- Em Conversas você vê só os seus atendimentos. A IA do seu WhatsApp já conhece o histórico do cliente.

2. Orçamento e venda
- Orçamentos: gere o orçamento do cliente (válido por 7 dias; depois ele é desativado, mas continua guardado e dá para reativar).
- Quando o cliente fechar, lance a venda. Ela entra em Contratos e vendas com as parcelas.

3. Pagamentos
- Quando o cliente pagar (entrada ou parcela), abra a venda e clique em "Cliente pagou". O Marcos recebe um aviso e confirma o recebimento. A comissão só é liberada depois dessa confirmação.

4. Contrato
- O contrato é assinado pelo cliente no celular dele. Acompanhe pelo painel.

5. Videochamada
- A IA marca videochamada com o consultor só para clientes que já têm condições de fechar. Você não precisa agendar.

6. Treinamento
- Toda semana entra um treinamento novo aqui em Tutoriais. Você recebe um aviso no WhatsApp. Leia: é o que faz a sua comissão crescer.`;

const ADMIN_SYSTEM = `Como o sistema funciona (administrador)

1. Visão geral
- Painel executivo: cobranças, vencimentos, recebido e a receber, por período.
- Contratos e vendas: todas as vendas, parcelas e comissões. Só o administrador confirma recebimento e comissão.

2. Atendimento
- A primeira IA atende, tira as dúvidas e encaminha. A segunda IA, no WhatsApp de cada vendedor, fecha a venda.
- Videochamadas: a IA só marca para quem já viu o valor e disse que tem condições de investir agora.

3. Dinheiro
- Pix: confirmação pelo comprovante ou manual. Cartão: link do Mercado Pago, com taxa por conta do cliente (cadastre as taxas em Configurações).
- O aviso de pagamento dos vendedores chega no seu WhatsApp para você conferir e confirmar.

4. Sistema antigo
- Contratos antigos: importa a cópia do sistema antigo, leva para Vendas e CRM e mostra a auditoria do que faltou.

5. Equipe e segurança
- Equipe: cadastre vendedores, setores e escritório. Auditoria registra quem mudou o quê.
- Nunca envie senhas ou chaves pelo chat. Elas ficam só nas configurações do painel.

6. Treinamentos
- O treinamento semanal dos vendedores é criado pela IA, com os números da própria equipe. Você pode editar, ocultar ou criar um à mão.`;

export const SEED = [
  { key: 'seed-seller-system', title: 'Como usar o sistema (vendedor)', audience: 'seller', category: 'Sistema', body: SELLER_SYSTEM },
  { key: 'seed-seller-closing', title: 'Fechamento: postura, roteiro e confiança', audience: 'seller', category: 'Fechamento', body: SELLER_CLOSING },
  { key: 'seed-seller-objections', title: 'Quebra de objeções, passo a passo', audience: 'seller', category: 'Fechamento', body: SELLER_OBJECTIONS },
  { key: 'seed-admin-system', title: 'Como o sistema funciona (administrador)', audience: 'admin', category: 'Sistema', body: ADMIN_SYSTEM },
];

export class Tutorials {
  constructor({ store, now = () => new Date() }) {
    this.store = store; this.now = now;
    store.data.tutorials ||= [];
    store.data.tutorialMeta ||= {};
    this.#seed();
  }
  get all() { return this.store.data.tutorials; }
  #seed() {
    const have = new Set(this.all.map((t) => t.seedKey).filter(Boolean));
    let n = 0;
    for (const s of SEED) if (!have.has(s.key)) { this.all.push({ id: crypto.randomBytes(6).toString('hex'), seedKey: s.key, title: s.title, audience: s.audience, category: s.category, body: s.body, auto: false, hidden: false, createdAt: this.now().toISOString() }); n += 1; }
    if (n) this.store.save();
  }
  canSee(user, t) {
    if (t.hidden && user.role !== 'admin') return false;
    if (user.role === 'admin') return true;
    return t.audience === 'seller' || t.audience === 'all';
  }
  list(user) {
    return this.all.filter((t) => this.canSee(user, t)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(({ body, ...t }) => ({ ...t, preview: body.slice(0, 140) }));
  }
  get(user, id) { const t = this.all.find((x) => x.id === id); return t && this.canSee(user, t) ? t : null; }
  #clean(b, base = {}) {
    const t = { ...base };
    if (b.title !== undefined) t.title = clip(b.title, 140);
    if (b.body !== undefined) t.body = clip(b.body, 20000);
    if (b.category !== undefined) t.category = clip(b.category, 40) || 'Geral';
    if (b.audience !== undefined) { if (!AUDIENCES.includes(b.audience)) throw new Error('Público inválido'); t.audience = b.audience; }
    if (b.hidden !== undefined) t.hidden = Boolean(b.hidden);
    if (!t.title) throw new Error('Dê um título');
    if (!t.body) throw new Error('Escreva o conteúdo');
    return t;
  }
  add(b, by = '') {
    const t = this.#clean(b, { id: crypto.randomBytes(6).toString('hex'), audience: 'seller', category: 'Geral', hidden: false, auto: false, createdAt: this.now().toISOString(), createdBy: by });
    this.all.push(t); this.store.save(); return t;
  }
  update(id, b) {
    const i = this.all.findIndex((x) => x.id === id); if (i < 0) throw new Error('Tutorial não encontrado');
    this.all[i] = this.#clean(b, this.all[i]); this.store.save(); return this.all[i];
  }
  remove(id) { const t = this.all.find((x) => x.id === id); if (!t) throw new Error('Tutorial não encontrado'); this.store.data.tutorials = this.all.filter((x) => x.id !== id); this.store.save(); return t; }

  // ---- treinamento semanal ----
  get lastWeekly() { return this.all.filter((t) => t.auto).map((t) => t.createdAt).sort().at(-1) || this.store.data.tutorialMeta.lastTry || ''; }
  isDue() {
    const last = this.lastWeekly;
    const lastTry = this.store.data.tutorialMeta.lastTry || '';
    const ref = [last, lastTry].filter(Boolean).sort().at(-1);
    return !ref || this.now() - new Date(ref) >= WEEK_MS;
  }
  weeklyPrompt({ business = '', stats = {}, learnings = '', previous = [] } = {}) {
    return `Você é coordenador de treinamento comercial de uma assessoria migratória para o Paraguai (Migra). Escreva UM treinamento curto (até 350 palavras) para os vendedores, com foco único em FECHAMENTO DE VENDA, para ser lido em 5 a 10 minutos.
Regras:
- Português do Brasil, simples, direto, sem enrolação e sem emojis.
- Estrutura: ideia da semana (2 linhas), 3 a 5 passos práticos, 3 frases prontas para usar com o cliente e um exercício para fazer hoje.
- Use só técnicas de venda conhecidas (escolha entre duas opções, isolar a objeção, silêncio depois do preço, próximo passo claro, prova social real). Nunca invente número, resultado, desconto, prazo ou promessa. Aprovação de residência é decisão dos órgãos do Paraguai: não prometa.
- Adapte ao nosso processo: cliente chega da IA com dúvidas resolvidas; vendedor pede documentação, fecha a entrada (Pix ou cartão, com a taxa da maquininha por conta do cliente) e pede o comprovante.
- Não repita os temas já usados: ${previous.slice(0, 8).join('; ') || 'nenhum ainda'}.
Contexto do negócio: ${String(business).slice(0, 1200)}
Números reais da equipe nos últimos 7 dias: ${JSON.stringify(stats)}
O que já funcionou em vendas fechadas (aprovado pelo dono): ${String(learnings).slice(0, 1200) || 'sem registros ainda'}
Responda SOMENTE em JSON: {"title":"...","body":"..."}`;
  }
  async generateWeekly({ llm, business, stats, learnings, force = false } = {}) {
    if (!force && !this.isDue()) return null;
    this.store.data.tutorialMeta.lastTry = this.now().toISOString(); this.store.save();
    if (!llm?.configured) return null;
    const previous = this.all.filter((t) => t.auto).map((t) => t.title);
    const reply = await llm.chat({ tools: [], messages: [{ role: 'user', content: this.weeklyPrompt({ business, stats, learnings, previous }) }] });
    const text = String(reply?.content || '');
    const s = text.indexOf('{'); const e = text.lastIndexOf('}');
    let j = null; try { j = JSON.parse(text.slice(s, e + 1)); } catch { j = null; }
    if (!j?.title || !j?.body || String(j.body).length < 200) throw new Error('A IA não devolveu um treinamento válido');
    const t = { id: crypto.randomBytes(6).toString('hex'), title: clip(j.title, 140), body: clip(j.body, 6000), audience: 'seller', category: 'Treinamento da semana', hidden: false, auto: true, createdAt: this.now().toISOString(), createdBy: 'IA' };
    this.all.push(t); this.store.save();
    return t;
  }
  noticeText(t, i = 0) {
    return `📚 *Treinamento novo para você*\n${t.title}\n\n${INCENTIVES[i % INCENTIVES.length]}\n\nAbra o painel → Tutoriais para ler.`;
  }
}
