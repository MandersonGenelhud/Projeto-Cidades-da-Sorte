// Proteção do número contra bloqueio do WhatsApp: cada número (conta) envia com intervalo mínimo variável entre mensagens, um teto por minuto
// e um teto de CONTATOS NOVOS por hora (gente que nunca falou com este número nem recebeu dele nas últimas 24 h). Respostas a quem acabou de
// escrever seguem rápidas; o que passa do teto espera a vez (por minuto) ou é recusado com explicação (contatos novos), para o chamador registrar.
const MIN = 60_000; const HOUR = 60 * MIN; const DAY = 24 * HOUR;

export const SAFETY_DEFAULTS = { enabled: true, minGapMs: 1500, jitterMs: 2500, perMinute: 12, newPerHour: 30 };

export class SendGuard {
  /** isKnown(account, to): o destinatário já escreveu para este número alguma vez (fica guardado nas conversas, sobrevive a reinícios)? */
  constructor({ config = () => SAFETY_DEFAULTS, now = () => Date.now(), random = Math.random, isKnown = () => false } = {}) {
    Object.assign(this, { config, now, random, isKnown });
    this.sent = new Map(); // conta → [instantes dos envios]
    this.lastAt = new Map(); // conta → último envio
    this.known = new Map(); // conta → Map(destino → último contato em qualquer direção)
    this.newSent = new Map(); // conta → [instantes de envios a contatos novos]
  }

  get cfg() { return { ...SAFETY_DEFAULTS, ...(this.config() || {}) }; }

  #knownOf(account) { return this.known.get(account) || this.known.set(account, new Map()).get(account); }

  /** O cliente escreveu para este número: ele não é "contato novo". */
  noteInbound(account, to) { if (account && to) this.#knownOf(account).set(String(to), this.now()); }

  isNew(account, to) {
    const t = this.#knownOf(account).get(String(to));
    if (t && this.now() - t <= DAY) return false;
    try { return !this.isKnown(account, String(to)); } catch { return true; }
  }

  /** Quanto esperar antes de enviar agora (ms). Lança erro se for contato novo além do teto da hora. */
  plan(account, to, { team = false } = {}) {
    const c = this.cfg;
    if (!c.enabled) return 0;
    const now = this.now();
    if (!team && this.isNew(account, to)) {
      const list = (this.newSent.get(account) || []).filter((t) => now - t < HOUR);
      this.newSent.set(account, list);
      if (list.length >= c.newPerHour) throw Object.assign(new Error(`Proteção do número: limite de ${c.newPerHour} contatos novos por hora atingido neste WhatsApp. A mensagem não foi enviada para não arriscar bloqueio; tente mais tarde.`), { code: 'limite_contatos_novos' });
    }
    const recent = (this.sent.get(account) || []).filter((t) => now - t < MIN);
    this.sent.set(account, recent);
    let wait = 0;
    if (recent.length >= c.perMinute) wait = Math.max(wait, recent[0] + MIN - now);
    const gap = c.minGapMs + Math.floor(this.random() * c.jitterMs);
    const last = this.lastAt.get(account) || 0;
    wait = Math.max(wait, last + gap - now);
    return Math.max(0, wait);
  }

  /** Registra o envio feito (chamar logo depois de enviar). */
  record(account, to, { team = false } = {}) {
    const now = this.now();
    if (!team && this.isNew(account, to)) (this.newSent.get(account) || this.newSent.set(account, []).get(account)).push(now);
    (this.sent.get(account) || this.sent.set(account, []).get(account)).push(now);
    this.lastAt.set(account, now);
    this.#knownOf(account).set(String(to), now);
  }
}
