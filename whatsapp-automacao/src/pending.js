// Conversas sem resposta: clientes cuja última mensagem ainda não foi respondida.
// Vêm do histórico que o celular envia ao conectar e de mensagens que o agente
// não respondeu (agente desligado ou em modo de teste).
import { randomBetween } from './utils.js';

/**
 * A partir de mensagens normalizadas (de várias conversas), devolve as conversas
 * em que o cliente falou por último, com as mensagens que ficaram sem resposta.
 */
export function extractPending(messages, { now = Date.now(), maxDays = 7 } = {}) {
  const byJid = new Map();
  for (const m of messages) {
    if (!m || m.isGroup) continue;
    if (!byJid.has(m.jid)) byJid.set(m.jid, []);
    byJid.get(m.jid).push(m);
  }
  const limit = now - maxDays * 86_400_000;
  const out = [];
  for (const [jid, list] of byJid) {
    list.sort((a, b) => a.timestamp - b.timestamp);
    const trailing = [];
    for (let i = list.length - 1; i >= 0 && !list[i].fromMe; i--) trailing.unshift(list[i]);
    const withText = trailing.filter((m) => m.text);
    if (!withText.length) continue;
    const last = withText.at(-1);
    if (last.timestamp < limit) continue;
    // As 10 mensagens de antes (cliente e atendimento), para a IA entender a conversa.
    const before = list.slice(0, list.length - trailing.length).filter((m) => m.text).slice(-10)
      .map((m) => ({ role: m.fromMe ? 'assistant' : 'user', content: m.text, at: new Date(m.timestamp).toISOString() }));
    out.push({
      context: before,
      jid,
      phone: withText.find((m) => m.phone)?.phone || null,
      name: withText.find((m) => m.name)?.name || '',
      texts: withText.map((m) => m.text).slice(-5),
      at: last.timestamp,
    });
  }
  return out;
}

export class PendingInbox {
  constructor({ store, agent, wa, autoReply, notify, delay = [20, 45] }) {
    this.store = store;
    this.agent = agent;
    this.wa = wa;
    this.autoReply = autoReply;
    this.notify = notify || (() => {});
    this.delay = delay; // segundos entre uma resposta e outra
    this.queue = [];
    this.running = false;
    this.wakeUp = null;
    store.data.pending ||= {};
  }

  get items() {
    return this.store.data.pending;
  }

  #changed() {
    this.store.save();
    this.notify('pending', { count: Object.keys(this.items).length, queue: this.queue.length, running: this.running });
  }

  list() {
    return Object.values(this.items)
      .filter((p) => !(p.phone && this.store.isBlacklisted(p.phone)))
      .map((p) => ({ ...p, queued: this.queue.includes(p.jid) }))
      .sort((a, b) => b.at - a.at);
  }

  status() {
    return { count: this.list().length, queue: this.queue.length, running: this.running };
  }

  /** Histórico do celular: adiciona quem estava esperando (sem apagar o que já existe). */
  // Guarda até 30 dias; quem a IA responde sozinha segue o prazo escolhido no painel (7, 15 ou 30 dias).
  ingestHistory(messages, { maxDays = Math.max(30, Number(this.store.settings.agent.pendingMaxDays || 7)), label = 'WhatsApp' } = {}) {
    let added = 0;
    for (const p of extractPending(messages, { maxDays })) {
      const current = this.items[p.jid];
      if (current && current.at >= p.at) continue;
      if (this.store.data.conversations[p.jid]?.messages?.at(-1)?.role === 'assistant') {
        // Já respondido pelo agente depois disso? Só conta se a mensagem do cliente é mais nova.
        const lastReply = Date.parse(this.store.data.conversations[p.jid].messages.at(-1).at);
        if (lastReply >= p.at) continue;
      }
      this.#seedContext(p);
      const ig = String(p.jid).startsWith('ig:');
      const { context, ...item } = p;
      this.items[p.jid] = { ...item, channel: ig ? 'instagram' : 'whatsapp', username: ig ? messages.find((m) => m.jid === p.jid && m.username)?.username || '' : '', source: 'histórico' };
      added++;
    }
    if (added) {
      this.store.addLog({ type: 'system', message: `📥 ${added} conversa(s) sem resposta encontrada(s) no histórico do ${label}` });
      this.#changed();
      // Quem estava esperando do histórico já passou do tempo: entra direto na fila.
      setTimeout(() => this.autoAnswer({ minAgeMs: 0 }), 5000).unref?.();
    }
    return added;
  }

  /** Conversa que o sistema ainda não conhecia: guarda as mensagens anteriores na memória da IA. */
  #seedContext(p) {
    if (!p.context?.length) return;
    const conv = this.agent.conversation(p.jid);
    if (conv.messages.length) return;
    conv.phone ||= p.phone;
    conv.name ||= p.name;
    conv.messages.push(...p.context);
    conv.updatedAt = new Date().toISOString();
    this.store.save();
  }

  /** Mensagem recebida agora: entra na lista até alguém responder. */
  onIncoming(msg) {
    if (!msg?.text || msg.isGroup) return;
    const current = this.items[msg.jid];
    this.items[msg.jid] = {
      jid: msg.jid,
      channel: msg.channel || 'whatsapp',
      username: msg.username || current?.username || '',
      phone: msg.phone || current?.phone || null,
      name: msg.name || current?.name || '',
      texts: [...(current?.texts || []), msg.text].slice(-5),
      at: msg.timestamp || Date.now(),
      source: 'recebida',
    };
    this.#changed();
  }

  /** Alguém (agente, painel ou o dono pelo celular) respondeu: sai da lista. */
  resolve(jid) {
    if (jid && this.items[jid]) {
      delete this.items[jid];
      this.queue = this.queue.filter((j) => j !== jid);
      this.#changed();
    }
  }

  dismiss(jids) {
    for (const jid of jids) delete this.items[jid];
    this.queue = this.queue.filter((j) => !jids.includes(j));
    this.#changed();
  }

  /** Coloca conversas na fila para o agente responder, uma de cada vez. */
  enqueue(jids) {
    if (!this.agent.config.enabled) throw new Error('O agente está desligado. Clique em "Ligar a IA agora" no aviso acima (ou marque "Agente ligado" na aba Agente IA e clique em Salvar).');
    if (!this.agent.active) throw new Error('Falta a chave da IA: cole a chave na aba Agente IA e clique em Salvar.');
    const allowed = [];
    const blocked = [];
    const isConnected = (jid) => (this.wa.isConnected ? this.wa.isConnected(jid) : this.wa.status === 'connected');
    for (const jid of jids) {
      const p = this.items[jid];
      if (!p || this.queue.includes(jid)) continue;
      // O Instagram só permite responder até 24h depois da última mensagem do cliente.
      const igExpired = jid.startsWith('ig:') && Date.now() - p.at > 24 * 3600 * 1000;
      if (isConnected(jid) && !igExpired && this.autoReply.agentAllowed({ phone: p.phone, username: p.username, channel: p.channel })) allowed.push(jid);
      else blocked.push(jid);
    }
    if (!allowed.length && !blocked.length) return { queued: 0, blocked: 0 };
    this.queue.push(...allowed);
    this.#changed();
    if (!this.running) this.#run().catch((err) => this.store.addLog({ type: 'error', message: `Fila de pendentes: ${err.message}` }));
    return { queued: allowed.length, blocked: blocked.length };
  }

  /**
   * Responde sozinho os clientes esperando (dos últimos 7 dias), um de cada vez.
   * Só pega quem está esperando há alguns minutos, para não atropelar a resposta normal.
   */
  autoAnswer({ minAgeMs = 3 * 60_000, now = Date.now() } = {}) {
    if (this.store.settings.agent?.autoAnswerPending === false || !this.agent.active) return { queued: 0, blocked: 0 };
    const maxAge = Number(this.store.settings.agent?.pendingMaxDays || 7) * 86_400_000;
    const jids = Object.values(this.items)
      .filter((p) => !this.queue.includes(p.jid) && now - p.at >= minAgeMs && now - p.at <= maxAge && !(p.phone && this.store.isBlacklisted(p.phone)))
      .map((p) => p.jid);
    if (!jids.length) return { queued: 0, blocked: 0 };
    const r = this.enqueue(jids);
    if (r.queued) this.store.addLog({ type: 'system', message: `🤖 Respondendo sozinho ${r.queued} cliente(s) que estavam esperando resposta` });
    return r;
  }

  cancel() {
    this.queue = [];
    this.wakeUp?.();
    this.#changed();
  }

  #wait(ms) {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      this.wakeUp = () => { clearTimeout(t); resolve(); };
    });
  }

  async #run() {
    this.running = true;
    this.#changed();
    try {
      while (this.queue.length) {
        const jid = this.queue[0];
        const p = this.items[jid];
        const startedAt = Date.now();
        if (p && (this.wa.isConnected ? this.wa.isConnected(jid) : this.wa.status === 'connected')) {
          await this.agent.handleIncoming(
            { key: jid, phone: p.phone, name: p.name, text: p.texts.join('\n'), delayed: true },
            async (text, { typingMs } = {}) => {
              try {
                await this.wa.send(jid, { text, typingMs });
                this.store.addLog({ type: 'autoreply', phone: p.phone || jid, message: text, rule: 'Agente IA (pendente)' });
              } catch (err) {
                this.store.addLog({ type: 'error', phone: p.phone || jid, message: `Pendente: ${err.message}` });
              }
            },
          );
        }
        if ((this.agent.errorAt || 0) >= startedAt) {
          // A IA falhou (limite do plano, chave, fora do ar): pausa a fila e mantém os clientes na lista.
          this.queue = [];
          const quota = (this.agent.quotaHitAt || 0) >= startedAt;
          this.store.addLog({ type: 'system', message: quota
            ? '⏸️ Limite de uso da IA atingido: a fila de clientes esperando foi pausada. Os clientes continuam na lista; tente de novo mais tarde (no plano gratuito, normalmente no dia seguinte).'
            : `⏸️ A IA falhou e a fila foi pausada (${this.agent.lastError?.message || 'erro'}). Os clientes continuam na lista.` });
          break;
        }
        this.queue = this.queue.filter((j) => j !== jid);
        if (this.items[jid]) delete this.items[jid];
        this.#changed();
        if (this.queue.length) await this.#wait(randomBetween(this.delay[0], this.delay[1]) * 1000);
      }
    } finally {
      this.running = false;
      this.wakeUp = null;
      this.#changed();
    }
  }
}
