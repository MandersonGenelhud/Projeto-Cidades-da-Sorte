// Aprendizados de vendas: a cada venda confirmada, a IA lê a conversa e anota o que funcionou
// (argumento, objeção vencida, forma de fechar). Nada entra no atendimento sem o Marcos aprovar:
// assim a atendente aprende com casos reais sem inventar regra nova.
import crypto from 'node:crypto';

const err = (status, message) => Object.assign(new Error(message), { status });
const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 240);
const MAX_APPROVED = 25;

export class Learnings {
  constructor({ store, llm = null }) {
    this.store = store;
    this.llm = llm;
    store.data.learnings ||= [];
  }

  get list() {
    return this.store.data.learnings;
  }

  /** Texto que vai para a atendente: só os aprovados (os mais recentes). */
  approvedText() {
    return this.list.filter((l) => l.status === 'aprovado').slice(-MAX_APPROVED).map((l) => `- ${l.text}`).join('\n');
  }

  add(text, { by = 'Administrador', status = 'aprovado', source = 'manual', leadId = null } = {}) {
    const t = clean(text);
    if (t.length < 10) throw err(400, 'Escreva o aprendizado com pelo menos uma frase');
    const same = this.list.find((l) => l.text.toLowerCase() === t.toLowerCase() && l.status !== 'recusado');
    if (same) return same;
    const l = { id: crypto.randomBytes(6).toString('hex'), text: t, status, source, leadId, by, at: new Date().toISOString() };
    this.list.push(l);
    if (this.list.length > 500) this.list.splice(0, this.list.length - 500);
    this.store.save();
    return l;
  }

  #set(id, status, by) {
    const l = this.list.find((x) => x.id === id);
    if (!l) throw err(404, 'Aprendizado não encontrado');
    Object.assign(l, { status, decidedBy: by, decidedAt: new Date().toISOString() });
    this.store.save();
    return l;
  }

  approve(id, by, text) {
    if (text !== undefined) {
      const l = this.list.find((x) => x.id === id);
      if (l && clean(text).length >= 10) l.text = clean(text);
    }
    return this.#set(id, 'aprovado', by);
  }

  reject(id, by) {
    return this.#set(id, 'recusado', by);
  }

  remove(id) {
    const i = this.list.findIndex((x) => x.id === id);
    if (i < 0) throw err(404, 'Aprendizado não encontrado');
    this.list.splice(i, 1);
    this.store.save();
  }

  /**
   * Venda confirmada: a IA lê a conversa e sugere até 3 aprendizados (ficam pendentes).
   * Sem nomes, telefones ou dados do cliente: só a técnica que funcionou.
   */
  async fromWon(lead, messages = []) {
    if (!this.llm?.configured || !lead) return [];
    if (this.list.some((l) => l.leadId === lead.id)) return [];
    const talk = messages.filter((m) => m.role === 'user' || m.role === 'assistant').slice(-40);
    if (talk.length < 4) return [];
    const transcript = talk.map((m) => `${m.role === 'user' ? 'Cliente' : 'Atendente'}: ${String(m.content || '').slice(0, 500)}`).join('\n');
    const reply = await this.llm.chat({ tools: [], messages: [
      { role: 'system', content: 'Você analisa uma conversa de WhatsApp que terminou em venda fechada da Migra Paraguai. Escreva até 3 aprendizados curtos (uma frase cada, no máximo 200 caracteres) sobre o que fez o cliente decidir: a objeção que apareceu e o argumento que funcionou, ou a forma de conduzir ao fechamento. Use só o que está na conversa; não invente preço, prazo ou promessa. Não escreva nomes, telefones, cidades ou qualquer dado pessoal. Responda só com JSON: {"licoes": ["...", "..."]}.' },
      { role: 'user', content: transcript },
    ] });
    let items = [];
    try {
      const m = String(reply?.content || '').match(/\{[\s\S]*\}/);
      items = JSON.parse(m ? m[0] : '{}').licoes || [];
    } catch {
      items = [];
    }
    return items.filter((t) => typeof t === 'string' && clean(t).length >= 10).slice(0, 3)
      .map((t) => this.add(t, { by: 'IA', status: 'pendente', source: 'venda', leadId: lead.id }));
  }
}
