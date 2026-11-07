// Conversas sem resposta: clientes cuja última mensagem ainda não foi respondida.
// Vêm do histórico que o celular envia ao conectar e de mensagens que o agente
// não respondeu (agente desligado ou em modo de teste).
import { randomBetween } from './utils.js';

import { senderOf, profileFor } from './send-profiles.js';
import { workHourRange, isWithinWorkHours } from './utils.js';
import { buildOpening, wantsOpening } from './opening.js';
export { senderOf };

/** A mensagem de retorno (agradecimento, demanda alta, imprevistos) já foi enviada: a IA não repete e segue direto ao assunto. */
const OPENED_NOTE = (p) => `# RETORNO JÁ ENVIADO (regra da direção)
A mensagem de retorno (agradecimento por aguardar, demanda alta, imprevistos e continuidade do atendimento) JÁ foi enviada a este contato agora. NÃO repita saudação, agradecimento nem explicação, e nunca peça desculpas. ${p.texts?.length ? 'Responda direto o que ele perguntou, e conduza ao próximo passo.' : `Em UMA mensagem curta, retome o assunto de onde pararam (leia as últimas mensagens, sem repetir o que ele já respondeu) e faça uma pergunta simples que avance o atendimento${p.reason ? ` (o retorno combinado era: ${p.reason})` : ''}.`}`;

/** Instrução da retomada: o cliente parou de responder (ou o retorno combinado chegou) e a IA recomeça a conversa. */
const RESUME_NOTE = (p) => `# RETOMADA DO ATENDIMENTO (regra da direção)
Este contato parou de responder${p.silentDays ? ` há cerca de ${p.silentDays} dia(s)` : ''}${p.reason ? ` e o retorno combinado era: ${p.reason}` : ''}. Leia as últimas mensagens da conversa e RETOME o atendimento com UMA mensagem curta, calorosa e humana: cumprimente pelo horário, lembre em que ponto pararam (sem repetir o que ele já respondeu), pergunte se ainda tem interesse e qual o melhor próximo passo. Sem pressão, sem desconto novo, sem inventar preço, prazo ou promessa. Se a conversa mostrar que ele não quer mais ou não é assunto da empresa, não insista: despeça-se com educação em uma frase.`;

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
    // As 20 mensagens de antes (cliente e Marcos/equipe), para a IA entender a conversa.
    const before = list.slice(0, list.length - trailing.length).filter((m) => m.text).slice(-20)
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

/**
 * Conversas que esfriaram: a última mensagem foi nossa (do robô ou da equipe) e o cliente parou de
 * responder. Só entram quem escreveu algo de próprio (não só clicou num botão automático) e a
 * conversa parada há pelo menos minHours. Serve para retomar o contato de forma humana.
 */
const BUTTONS = /^(quero saber o valor|sim,? manda a[ií]|me envie o link|sim|ok)$/i;
export function extractStalled(messages, { now = Date.now(), maxDays = 15, minHours = 24 } = {}) {
  const byJid = new Map();
  for (const m of messages) {
    if (!m || m.isGroup || !m.text) continue;
    if (!byJid.has(m.jid)) byJid.set(m.jid, []);
    byJid.get(m.jid).push(m);
  }
  const out = [];
  for (const [jid, list] of byJid) {
    list.sort((a, b) => a.timestamp - b.timestamp);
    const last = list.at(-1);
    if (!last.fromMe) continue; // quem falou por último foi o cliente: é "sem resposta", outro fluxo
    if (last.timestamp > now - minHours * 3_600_000 || last.timestamp < now - maxDays * 86_400_000) continue;
    const mine = list.filter((m) => !m.fromMe && !BUTTONS.test(String(m.text).trim()));
    if (!mine.length) continue;
    const lastClient = [...list].reverse().find((m) => !m.fromMe);
    out.push({
      jid,
      phone: list.find((m) => m.phone)?.phone || null,
      name: list.find((m) => m.name)?.name || '',
      username: list.find((m) => m.username)?.username || '',
      texts: mine.map((m) => m.text).slice(-3),
      context: list.slice(-20).map((m) => ({ role: m.fromMe ? 'assistant' : 'user', content: m.text, at: new Date(m.timestamp).toISOString() })),
      at: lastClient.timestamp,
      lastOurAt: last.timestamp,
    });
  }
  return out;
}

export class PendingInbox {
  constructor({ store, agent, wa, autoReply, notify, delay = [45, 90], careful = true, backoffUnitMs = 60_000, now = () => new Date(), senderLabel = (k) => k }) {
    this.senderLabel = senderLabel; // nome de cada número no painel (ex.: WhatsApp da Franciely)
    this.store = store;
    this.agent = agent;
    this.wa = wa;
    this.autoReply = autoReply;
    this.notify = notify || (() => {});
    this.delay = delay; // segundos entre uma resposta e outra
    // Modo cuidadoso (só para quem ficou esperando): limite por hora e só em horário comercial,
    // para o WhatsApp não estranhar um número que de repente responde centenas de conversas.
    this.careful = careful;
    this.now = now;
    this.sentAt = []; // horários das respostas da última hora (todos os números juntos, só para o painel)
    this.sentBy = {}; // número → horários das respostas da última hora (o limite vale por número)
    this.nextBy = {}; // número → quando pode mandar a próxima (intervalo entre uma e outra, por número)
    this.waitingBy = {}; // número → por que ele está esperando (aparece no painel)
    this.sentDay = {}; // número → { day, n }: respostas de hoje (limite diário por número)
    this.queue = [];
    this.workers = new Map(); // número → true: cada número tem a sua própria fila andando, sem esperar pelos outros
    this.wakeUps = new Map();
    this.backoffN = {};
    this.backoffUnitMs = backoffUnitMs;
    store.data.pending ||= {};
  }

  get running() {
    return this.workers.size > 0;
  }

  get waiting() {
    return [...new Set(Object.values(this.waitingBy).filter(Boolean))].join(' · ');
  }

  /** Perfil de envio daquele número (o dele por cima do padrão geral). */
  profile(sender) {
    return profileFor(this.store.settings, sender, { delay: this.delay });
  }

  #today() {
    const d = this.now();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  #sentToday(sender) {
    const e = this.sentDay[sender];
    return e && e.day === this.#today() ? e.n : 0;
  }

  /** Liga a fila de cada número que tem cliente esperando e ainda não está andando. */
  #startWorkers() {
    for (const sender of new Set(this.queue.map(senderOf))) {
      if (this.workers.has(sender)) continue;
      this.workers.set(sender, true);
      this.#run(sender).catch((err) => this.store.addLog({ type: 'error', message: `Fila de pendentes (${sender}): ${err.message}` }));
    }
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
    const { perHour, from, to } = this.#limits();
    const nowMs = this.now().getTime();
    const sentLastHour = this.sentAt.filter((t) => nowMs - t < 3_600_000).length;
    const senders = new Set(this.queue.map(senderOf)).size || 1;
    // Quantos esperam e quantos já foram respondidos na última hora, em cada número.
    const by = {};
    for (const it of this.list()) { const k = senderOf(it.jid); (by[k] ||= { waiting: 0, queued: 0, sentLastHour: 0 }).waiting += 1; if (it.queued) by[k].queued += 1; }
    for (const [k, list] of Object.entries(this.sentBy)) { const n = list.filter((t) => nowMs - t < 3_600_000).length; if (n) (by[k] ||= { waiting: 0, queued: 0, sentLastHour: 0 }).sentLastHour = n; }
    const bySender = Object.entries(by).map(([key, v]) => {
      let label = key;
      try { label = this.senderLabel(key) || key; } catch { /* sem nome: mostra a chave */ }
      return { key, label, ...v };
    }).sort((a, b) => b.waiting - a.waiting);
    return {
      bySender,
      count: this.list().length, queue: this.queue.length, running: this.running, waiting: this.waiting, perHour, from, to,
      lastError: this.lastError || null, sentLastHour, lastSentAt: this.lastSentAt || null, lastProgressAt: this.lastProgressAt || null,
      senders, etaMin: this.careful && this.queue.length ? Math.ceil((this.queue.length / (perHour * senders)) * 60) : null,
    };
  }

  /** Histórico do celular: adiciona quem estava esperando (sem apagar o que já existe). */
  // Guarda até 30 dias; quem a IA responde sozinha segue o prazo escolhido no painel (7, 15 ou 30 dias).
  ingestHistory(messages, { maxDays = Math.max(30, Number(this.store.settings.agent.pendingMaxDays || 15)), label = 'WhatsApp' } = {}) {
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
    // Por que alguém ficou de fora (cada canal segue a sua regra: só o Instagram tem a janela de 24 horas).
    const reasons = { teste: 0, instagram24h: 0, desconectado: 0 };
    const isConnected = (jid) => (this.wa.isConnected ? this.wa.isConnected(jid) : this.wa.status === 'connected');
    for (const jid of jids) {
      const p = this.items[jid];
      if (!p || this.queue.includes(jid)) continue;
      // O Instagram só permite responder até 24h depois da última mensagem do cliente.
      const igExpired = jid.startsWith('ig:') && Date.now() - p.at > 24 * 3600 * 1000;
      const connected = isConnected(jid);
      const permitted = this.autoReply.agentAllowed({ phone: p.phone, username: p.username, channel: p.channel });
      if (connected && !igExpired && permitted) allowed.push(jid);
      else {
        blocked.push(jid);
        if (igExpired) reasons.instagram24h += 1;
        else if (!connected) reasons.desconectado += 1;
        else reasons.teste += 1;
      }
    }
    if (!allowed.length && !blocked.length) return { queued: 0, blocked: 0, reasons };
    this.queue.push(...allowed);
    this.#changed();
    this.#startWorkers();
    return { queued: allowed.length, blocked: blocked.length, reasons };
  }

  /**
   * Responde sozinho os clientes esperando (dos últimos 7 dias), um de cada vez.
   * Só pega quem está esperando há alguns minutos, para não atropelar a resposta normal.
   */
  autoAnswer({ minAgeMs = 3 * 60_000, now = Date.now() } = {}) {
    if (this.store.settings.agent?.autoAnswerPending === false || !this.agent.active) return { queued: 0, blocked: 0 };
    const maxAge = Number(this.store.settings.agent?.pendingMaxDays || 15) * 86_400_000;
    const jids = Object.values(this.items)
      .filter((p) => !this.queue.includes(p.jid) && now - p.at >= minAgeMs && now - p.at <= maxAge && !(p.phone && this.store.isBlacklisted(p.phone)))
      .map((p) => p.jid);
    if (!jids.length) return { queued: 0, blocked: 0 };
    const r = this.enqueue(jids);
    if (r.queued) this.store.addLog({ type: 'system', message: `🤖 Respondendo sozinho ${r.queued} cliente(s) que estavam esperando resposta` });
    return r;
  }

  /** Vigia: se há clientes na fila mas nada está rodando (a fila caiu por algum erro), religa. */
  ensureRunning() {
    if (this.queue.length) this.#startWorkers();
  }

  cancel() {
    this.queue = [];
    for (const w of this.wakeUps.values()) w();
    this.#changed();
  }

  #wait(ms, sender = '*') {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      this.wakeUps.set(sender, () => { clearTimeout(t); resolve(); });
    });
  }

  /** A IA ou a análise falhou: o número espera (2, 5, 10 e no máximo 15 min) e volta sozinho. Nada é apagado da fila. */
  async #backoff(sender, motivo, fatal = false, quota = false) {
    const n = (this.backoffN[sender] = (this.backoffN[sender] || 0) + 1);
    const min = fatal ? 15 : quota ? Math.min(15, 5 * n) : Math.min(15, 2 ** n);
    this.lastError = { at: new Date().toISOString(), message: motivo };
    this.waitingBy[sender] = `IA indisponível (${motivo}); tenta de novo em ${min} min`;
    if (n === 1 || n % 4 === 0) this.store.addLog({ type: 'system', message: `⏸️ ${sender}: ${motivo}. A fila continua e tenta de novo sozinha em ${min} min.${fatal ? ' Confira a chave da IA em Configurações.' : ''}` });
    this.#changed();
    await this.#wait(min * this.backoffUnitMs, sender);
  }

  #limits() {
    const a = this.store.settings.agent || {};
    const [from, to] = workHourRange(a); // a fila de quem esperou responde no mesmo horário de trabalho da IA
    return { perHour: Math.max(1, Number(a.pendingPerHour) || 30), from, to };
  }

  /**
   * Espera a vez DESTE número e devolve o próximo cliente dele. Cada número tem o seu horário, o seu limite por hora e por dia
   * e o seu intervalo (perfil de envio); a espera de um número nunca atrasa os outros.
   */
  async #gate(sender) {
    const mine = () => this.queue.filter((j) => senderOf(j) === sender);
    if (!this.careful) return mine()[0] || null;
    for (;;) {
      if (!mine().length) return null;
      const prof = this.profile(sender);
      const now = this.now();
      const ms = now.getTime();
      const h = now.getHours();
      let waitMs = 60_000;
      if (h < prof.from || h >= prof.to || !isWithinWorkHours({ ...(this.store.settings.agent?.workHours || {}), start: '00:00', end: '24:00' }, now)) {
        this.waitingBy[sender] = `fora do horário (responde das ${prof.from}h às ${prof.to}h)`;
      } else if (prof.dailyLimit && this.#sentToday(sender) >= prof.dailyLimit) {
        this.waitingBy[sender] = `limite de ${prof.dailyLimit} respostas por dia atingido; continua amanhã`;
        waitMs = 5 * 60_000;
      } else {
        this.sentAt = this.sentAt.filter((t) => ms - t < 3_600_000);
        this.sentBy[sender] = (this.sentBy[sender] || []).filter((t) => ms - t < 3_600_000);
        const hourFull = this.sentBy[sender].length >= prof.perHour;
        if (!hourFull && (this.nextBy[sender] || 0) <= ms) { delete this.waitingBy[sender]; return mine()[0]; }
        const free = hourFull ? this.sentBy[sender][0] + 3_600_000 : this.nextBy[sender];
        waitMs = Math.min(60_000, Math.max(1000, free - ms));
        this.waitingBy[sender] = hourFull ? `limite de ${prof.perHour} respostas por hora atingido; continua sozinho em alguns minutos` : 'intervalo entre uma resposta e outra (para proteger o número)';
      }
      this.#changed();
      await this.#wait(waitMs, sender);
    }
  }

  async #run(sender) {
    this.#changed();
    try {
      let fails = 0;
      while (this.queue.some((j) => senderOf(j) === sender)) {
        let failedJid = this.queue.find((j) => senderOf(j) === sender);
        try {
        const chosen = await this.#gate(sender);
        if (!this.queue.length || !chosen) break;
        failedJid = chosen;
        // Conversa nova (sem nada antes) também passa pela análise: cria a memória dela aqui.
        if (this.items[chosen]) {
          const it = this.items[chosen];
          const c = this.agent.conversation(chosen);
          c.phone ||= it.phone;
          c.name ||= it.name;
        }
        const jid = chosen;
        const p = this.items[jid];
        const startedAt = this.now().getTime(); // mesmo relógio do limite por hora (e dos testes)
        let answered = false;
        let skip = false;
        const conv = this.agent.conversation(jid, { create: false });
        // Conversa pausada (ex.: "você respondeu pelo celular"): a IA não entra. Avisa em vez de pular em silêncio.
        // Recomeçar: conversa que ficou "do Marcos" é reavaliada com a regra de venda (qualquer serviço da Migra volta para a IA).
        if (conv?.handoff && p?.reTriage && /^Conversa do Marcos/.test(conv.handoffReason || '') && this.agent.triageBacklog) {
          try {
            const v = await this.agent.triageBacklog(conv, p.texts, { restart: true });
            if (v.responder) { conv.handoff = false; conv.handoffReason = ''; conv.continuity = v.continuidade; conv.triage = { ...v, at: new Date().toISOString() }; this.store.save(); }
          } catch { /* mantém pausada */ }
        }
        if (conv?.handoff) {
          this.store.addLog({ type: 'system', phone: p?.phone || jid, message: `⏸️ A IA não respondeu ${p?.name || p?.phone || jid}: conversa pausada (${conv.handoffReason || 'um humano assumiu'}). Use "Retomar com a IA" em Conversas.` });
          this.queue = this.queue.filter((j) => j !== jid);
          if (this.items[jid]) this.items[jid].skipReason = conv.handoffReason || 'um humano assumiu';
          this.#changed();
          continue;
        }
        // Antes de entrar: lê as mensagens anteriores e vê se é cliente esperando ou conversa do Marcos.
        if (p && conv && !conv.handoff && this.agent.triageBacklog && this.store.settings.agent?.triagePending !== false) {
          try {
            const v = await this.agent.triageBacklog(conv, p.texts, { restart: Boolean(p.restart) });
            conv.triage = { ...v, at: new Date().toISOString() };
            if (v.responder) conv.continuity = v.continuidade;
            else {
              skip = true;
              conv.handoff = true;
              conv.handoffReason = `Conversa do Marcos (${v.tipo.replace(/_/g, ' ')}): ${v.motivo}`;
              this.store.addLog({ type: 'system', phone: p.phone || jid, message: `🙋 IA não entrou em ${p.name || p.phone || jid}: ${v.motivo || v.tipo}. Ficou para o Marcos.` });
            }
            this.store.save();
          } catch (err) {
            // Limite do plano ou chave errada: não zera a fila. Espera uns minutos e tenta de novo sozinho (os clientes continuam na fila).
            if (!(err.quota || err.auth || /limite|quota|chave|api key|rate limit/i.test(err.message))) throw err;
            await this.#backoff(sender, `não consegui analisar as conversas (${err.message})`, err.auth);
            continue;
          }
        }
        if (!skip && p && (this.wa.isConnected ? this.wa.isConnected(jid) : this.wa.status === 'connected')) {
          // Quem esperou bastante recebe primeiro a mensagem de retorno (texto fixo da direção: agradece, demanda alta, imprevistos, continuidade).
          let opened = false;
          const cfgAg = this.store.settings.agent || {};
          if (wantsOpening({ item: p, conv: this.agent.conversation(jid, { create: false }), now: this.now().getTime(), cfg: cfgAg.backlogOpening })) {
            const c = this.agent.conversation(jid);
            const text = buildOpening({ name: p.name || c.name, date: p.scheduledFor || '', now: this.now(), cfg: cfgAg.backlogOpening });
            try {
              await this.wa.send(jid, { text });
              this.agent.remember(c, 'assistant', text);
              c.openingSentAt = this.now().getTime();
              opened = true; answered = true;
              this.lastSentAt = Date.now();
              this.store.addLog({ type: 'autoreply', phone: p.phone || jid, message: text, rule: 'Retorno automático (esperou atendimento)' });
            } catch (err) {
              this.store.addLog({ type: 'error', phone: p.phone || jid, message: `Retorno automático: ${err.message}` });
            }
          }
          await this.agent.handleIncoming(
            { key: jid, phone: p.phone, name: p.name, text: p.texts.join('\n'), delayed: true, resume: opened ? OPENED_NOTE(p) : p.kind === 'retomar' ? RESUME_NOTE(p) : '' },
            async (text, { typingMs } = {}) => {
              try {
                await this.wa.send(jid, { text, typingMs });
                this.lastSentAt = Date.now();
                answered = true;
                this.store.addLog({ type: 'autoreply', phone: p.phone || jid, message: text, rule: 'Agente IA (pendente)' });
              } catch (err) {
                this.store.addLog({ type: 'error', phone: p.phone || jid, message: `Pendente: ${err.message}` });
              }
            },
          );
        }
        if ((this.agent.errorAt || 0) >= startedAt) {
          // A IA falhou (limite do plano, chave, fora do ar): este cliente continua na fila; espera e tenta de novo sozinho.
          const quota = (this.agent.quotaHitAt || 0) >= startedAt;
          await this.#backoff(sender, quota ? 'limite de uso da IA atingido' : `a IA falhou (${this.agent.lastError?.message || 'erro'})`, false, quota);
          // Se a falha é só deste cliente (6 tentativas seguidas), tira ele da vez para não travar os outros; continua na lista.
          if ((this.backoffN[sender] || 0) >= 6) {
            this.queue = this.queue.filter((j) => j !== jid);
            this.backoffN[sender] = 0;
            this.store.addLog({ type: 'error', phone: p?.phone || jid, message: `A IA não conseguiu responder ${p?.name || p?.phone || jid} depois de várias tentativas. Ele continua na lista; os outros seguem.` });
          }
          continue;
        }
        this.backoffN[sender] = 0;
        this.lastProgressAt = Date.now();
        if (conv) delete conv.continuity; // a análise vale só para a primeira resposta
        this.queue = this.queue.filter((j) => j !== jid);
        if (this.items[jid]) delete this.items[jid];
        // Só conta no limite (e no intervalo daquele número) quando a resposta saiu de verdade.
        if (answered) {
          const at = this.now().getTime();
          this.sentAt.push(at);
          (this.sentBy[sender] ||= []).push(at);
          this.nextBy[sender] = this.now().getTime() + randomBetween(...this.profile(sender).gap) * 1000;
          const day = this.#today();
          const e = this.sentDay[sender];
          this.sentDay[sender] = e && e.day === day ? { day, n: e.n + 1 } : { day, n: 1 };
        }
        this.#changed();
        const gap = this.profile(sender).gap;
        if (this.queue.some((j) => senderOf(j) === sender) && !this.careful) await this.#wait(randomBetween(gap[0], gap[1]) * 1000, sender);
        fails = 0;
        } catch (err) {
          // Um cliente com problema não pode parar a fila inteira: registra o motivo, pula este e segue.
          fails += 1;
          this.lastError = { at: new Date().toISOString(), message: err.message, jid: failedJid };
          this.queue = this.queue.filter((j) => j !== failedJid);
          const who = this.items[failedJid]?.name || this.items[failedJid]?.phone || failedJid;
          this.store.addLog({ type: 'error', message: `Fila de clientes: não consegui responder ${who} (${err.message}). Pulei e segui com os próximos.` });
          this.#changed();
          if (fails >= 3) {
            fails = 0;
            await this.#backoff(sender, `3 falhas seguidas (última: ${err.message})`);
          }
        }
      }
    } finally {
      this.workers.delete(sender);
      delete this.waitingBy[sender];
      this.wakeUps.delete(sender);
      this.#changed();
    }
  }
}
