// Envio em massa com fila, intervalos aleatórios e pausas automáticas.
import { normalizePhone, randomBetween, renderTemplate, sleep, uid } from './utils.js';

export class CampaignRunner {
  constructor({ store, wa, notify }) {
    this.store = store;
    this.wa = wa;
    this.notify = notify || (() => {});
    this.activeId = null;
    this.wakeUp = null;

    // Campanhas que estavam rodando quando o servidor caiu ficam pausadas.
    for (const c of store.data.campaigns) {
      if (c.status === 'running') c.status = 'paused';
    }
    store.save();
  }

  list() {
    return this.store.data.campaigns.map((c) => this.summary(c));
  }

  get(id) {
    return this.store.data.campaigns.find((c) => c.id === id);
  }

  summary(c) {
    const counts = { pending: 0, sent: 0, failed: 0, skipped: 0 };
    for (const r of c.recipients) counts[r.status] = (counts[r.status] || 0) + 1;
    const { recipients, ...rest } = c;
    return { ...rest, total: recipients.length, counts };
  }

  /** Monta a lista de destinatários a partir do alvo escolhido. */
  resolveRecipients(target = {}) {
    const contacts = this.store.data.contacts;
    let list = [];
    if (target.type === 'tags') {
      const tags = (target.tags || []).map((t) => t.toLowerCase());
      list = contacts.filter((c) => c.tags?.some((t) => tags.includes(t.toLowerCase())));
    } else if (target.type === 'manual' || target.type === 'group') {
      list = (target.phones || [])
        .map((p) => normalizePhone(p))
        .filter(Boolean)
        .map((phone) => contacts.find((c) => c.phone === phone) || { phone, name: '' });
    } else {
      list = contacts;
    }
    const seen = new Set();
    return list
      .filter((c) => c.phone && !seen.has(c.phone) && seen.add(c.phone))
      .map((c) => ({
        phone: c.phone,
        name: c.name || '',
        city: c.city || '',
        fields: c.fields || {},
        status: 'pending',
      }));
  }

  create(input) {
    const messages = (Array.isArray(input.messages) ? input.messages : [input.message])
      .map((m) => String(m || '').trim())
      .filter(Boolean);
    if (!messages.length && !input.media) throw new Error('Informe ao menos uma mensagem ou um arquivo');
    const recipients = this.resolveRecipients(input.target);
    if (!recipients.length) throw new Error('Nenhum destinatário encontrado para esse filtro');

    const s = this.store.settings;
    const campaign = {
      id: uid(),
      name: input.name?.trim() || `Campanha ${new Date().toLocaleString('pt-BR')}`,
      messages,
      media: input.media || null,
      target: input.target || { type: 'all' },
      delayMin: Number(input.delayMin ?? s.defaultDelayMin),
      delayMax: Number(input.delayMax ?? s.defaultDelayMax),
      pauseEvery: Number(input.pauseEvery ?? 30),
      pauseMinutes: Number(input.pauseMinutes ?? 5),
      status: 'draft',
      recipients,
      createdAt: new Date().toISOString(),
    };
    if (campaign.delayMin < 1) campaign.delayMin = 1;
    this.store.data.campaigns.unshift(campaign);
    this.store.save();
    return campaign;
  }

  remove(id) {
    if (this.activeId === id) this.cancel(id);
    this.store.data.campaigns = this.store.data.campaigns.filter((c) => c.id !== id);
    this.store.save();
  }

  start(id) {
    const c = this.get(id);
    if (!c) throw new Error('Campanha não encontrada');
    if (c.status === 'done' || c.status === 'canceled') throw new Error('Campanha já finalizada');
    if (this.activeId && this.activeId !== id) {
      throw new Error('Já existe uma campanha em andamento. Pause-a antes de iniciar outra.');
    }
    c.status = 'running';
    c.startedAt ||= new Date().toISOString();
    this.store.save();
    this.#emit(c);
    if (!this.activeId) this.#run(c).catch((err) => this.store.addLog({ type: 'error', message: err.message }));
    return c;
  }

  pause(id) {
    const c = this.get(id);
    if (c?.status === 'running') {
      c.status = 'paused';
      this.store.save();
      this.wakeUp?.();
      this.#emit(c);
    }
    return c;
  }

  cancel(id) {
    const c = this.get(id);
    if (c && c.status !== 'done') {
      c.status = 'canceled';
      c.finishedAt = new Date().toISOString();
      this.store.save();
      this.wakeUp?.();
      this.#emit(c);
    }
    return c;
  }

  /** Espera interrompível (pausar/cancelar acorda imediatamente). */
  #wait(ms) {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      this.wakeUp = () => { clearTimeout(t); resolve(); };
    });
  }

  #emit(c) {
    this.notify('campaign', this.summary(c));
  }

  async #run(c) {
    this.activeId = c.id;
    let sentSinceBreak = 0;
    try {
      for (const r of c.recipients) {
        if (c.status !== 'running') break;
        if (r.status !== 'pending') continue;

        if (this.store.isBlacklisted(r.phone)) {
          r.status = 'skipped';
          r.error = 'Descadastrado (opt-out)';
          this.store.save();
          this.#emit(c);
          continue;
        }

        // Aguarda a reconexão se o WhatsApp cair no meio da campanha.
        while (this.wa.status !== 'connected' && c.status === 'running') await this.#wait(5000);
        if (c.status !== 'running') break;

        const template = c.messages.length
          ? c.messages[Math.floor(Math.random() * c.messages.length)]
          : '';
        const text = renderTemplate(template, r);
        try {
          await this.wa.send(r.phone, { text, media: c.media });
          r.status = 'sent';
          r.at = new Date().toISOString();
          this.store.addLog({ type: 'sent', phone: r.phone, campaign: c.name, message: text });
        } catch (err) {
          r.status = 'failed';
          r.error = err.message;
          r.at = new Date().toISOString();
          this.store.addLog({ type: 'error', phone: r.phone, campaign: c.name, message: err.message });
        }
        this.store.save();
        this.#emit(c);

        if (!c.recipients.some((x) => x.status === 'pending')) break;

        sentSinceBreak++;
        if (c.pauseEvery > 0 && sentSinceBreak >= c.pauseEvery) {
          sentSinceBreak = 0;
          this.store.addLog({ type: 'system', campaign: c.name, message: `Pausa de segurança de ${c.pauseMinutes} min` });
          await this.#wait(c.pauseMinutes * 60_000);
        } else {
          await this.#wait(randomBetween(c.delayMin, c.delayMax) * 1000);
        }
      }
      if (c.status === 'running' && !c.recipients.some((x) => x.status === 'pending')) {
        c.status = 'done';
        c.finishedAt = new Date().toISOString();
        this.store.addLog({ type: 'system', campaign: c.name, message: 'Campanha concluída' });
      }
    } finally {
      this.activeId = null;
      this.wakeUp = null;
      this.store.save();
      this.#emit(c);
    }
    // Se outra campanha foi iniciada enquanto esta terminava, roda em seguida.
    const next = this.store.data.campaigns.find((x) => x.status === 'running');
    if (next) await sleep(1000).then(() => this.#run(next));
  }
}
