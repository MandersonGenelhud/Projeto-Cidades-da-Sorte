// Chatbot de respostas automáticas por palavra-chave.
import { isWithinBusinessHours, renderTemplate, samePhone, uid } from './utils.js';

/** Remove acentos e padroniza para comparação. */
export function normalizeText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export function ruleMatches(rule, text) {
  if (!rule.enabled) return false;
  const msg = normalizeText(text);
  const keywords = (rule.keywords || []).map(normalizeText).filter(Boolean);
  switch (rule.matchType) {
    case 'any':
      return true;
    case 'exact':
      return keywords.includes(msg);
    case 'startsWith':
      return keywords.some((k) => msg.startsWith(k));
    case 'regex':
      return (rule.keywords || []).some((k) => {
        try {
          return new RegExp(k, 'i').test(text);
        } catch {
          return false;
        }
      });
    case 'contains':
    default:
      return keywords.some((k) => new RegExp(`(^|\\W)${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|\\W)`).test(msg));
  }
}

export class AutoReply {
  constructor({ store, wa, notify, agent = null }) {
    this.store = store;
    this.wa = wa;
    this.agent = agent;
    this.notify = notify || (() => {});
    this.lastReply = new Map(); // jid -> timestamp
    this.seenContacts = new Set(store.data.contacts.map((c) => c.phone));
  }

  list() {
    return [...this.store.data.rules].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  }

  save(input) {
    const rules = this.store.data.rules;
    const rule = {
      id: input.id || uid(),
      name: input.name?.trim() || 'Regra',
      matchType: input.matchType || 'contains',
      keywords: (Array.isArray(input.keywords) ? input.keywords : String(input.keywords || '').split(','))
        .map((k) => String(k).trim())
        .filter(Boolean),
      response: String(input.response || ''),
      media: input.media || null,
      addTag: input.addTag?.trim() || '',
      priority: Number(input.priority ?? rules.length),
      enabled: input.enabled !== false,
    };
    if (!rule.response && !rule.media) throw new Error('A regra precisa de uma resposta');
    if (rule.matchType !== 'any' && !rule.keywords.length) throw new Error('Informe ao menos uma palavra-chave');
    const idx = rules.findIndex((r) => r.id === rule.id);
    if (idx >= 0) rules[idx] = { ...rules[idx], ...rule, media: input.media !== undefined ? input.media : rules[idx].media };
    else rules.push(rule);
    this.store.save();
    return rule;
  }

  remove(id) {
    this.store.data.rules = this.store.data.rules.filter((r) => r.id !== id);
    this.store.save();
  }

  /** Decide a resposta para uma mensagem (sem enviar). Útil para testes no painel. */
  decide(msg, now = new Date()) {
    const s = this.store.settings;
    const text = normalizeText(msg.text);
    const contact = this.#contactFor(msg);

    if (msg.phone && s.optOutKeywords.map(normalizeText).includes(text)) {
      return { kind: 'optout', text: renderTemplate(s.optOutMessage, contact) };
    }
    if (msg.phone && s.optInKeywords.map(normalizeText).includes(text)) {
      return { kind: 'optin', text: renderTemplate(s.optInMessage, contact) };
    }
    if (!s.autoReplyEnabled) return null;
    if (msg.phone && this.store.isBlacklisted(msg.phone)) return null;

    // Agente de IA ligado: regras de palavra-chave (opcionais) e depois a IA.
    if (this.agentAllowed(msg)) {
      const rule = this.store.settings.agent.rulesFirst
        ? this.list().find((r) => r.matchType !== 'any' && ruleMatches(r, msg.text))
        : null;
      if (rule) return { kind: 'rule', rule, text: renderTemplate(rule.response, contact), media: rule.media };
      return { kind: 'agent' };
    }

    if (!isWithinBusinessHours(s.businessHours, now)) {
      return { kind: 'offhours', text: renderTemplate(s.businessHours.message, contact) };
    }

    const rule = this.list().find((r) => ruleMatches(r, msg.text));
    if (rule) {
      return { kind: 'rule', rule, text: renderTemplate(rule.response, contact), media: rule.media };
    }
    if (s.welcomeEnabled && msg.phone && !this.seenContacts.has(msg.phone)) {
      return { kind: 'welcome', text: renderTemplate(s.welcomeMessage, contact) };
    }
    return null;
  }

  /** Agente ligado e, no modo de teste, mensagem vinda de um número de teste. */
  agentAllowed(msg) {
    if (!this.agent?.active) return false;
    const cfg = this.store.settings.agent;
    if (cfg.audience !== 'test') return true;
    return Boolean(msg.phone) && (cfg.testNumbers || []).some((n) => samePhone(n, msg.phone));
  }

  #contactFor(msg) {
    const existing = msg.phone && this.store.data.contacts.find((c) => c.phone === msg.phone);
    return existing || { phone: msg.phone || '', name: msg.name || '' };
  }

  /** Salva quem mandou mensagem como contato (origem: whatsapp). */
  #rememberContact(msg) {
    if (!msg.phone || msg.isGroup) return null;
    let contact = this.store.data.contacts.find((c) => c.phone === msg.phone);
    if (!contact) {
      contact = {
        id: uid(),
        phone: msg.phone,
        name: msg.name || '',
        tags: ['whatsapp'],
        fields: {},
        createdAt: new Date().toISOString(),
      };
      this.store.data.contacts.push(contact);
      this.store.save();
      this.notify('contacts', null);
    } else if (!contact.name && msg.name) {
      contact.name = msg.name;
      this.store.save();
    }
    return contact;
  }

  async handle(msg) {
    const s = this.store.settings;
    this.store.addLog({ type: 'received', phone: msg.phone || msg.jid, name: msg.name, message: msg.text });
    if (msg.isGroup && s.ignoreGroups) return;
    if (!msg.text) return;

    const decision = this.decide(msg);
    if (this.agent?.active && !msg.isGroup && !this.agentAllowed(msg)) {
      this.store.addLog({
        type: 'system',
        phone: msg.phone || msg.jid,
        message: `Modo de teste: o agente não respondeu ${msg.phone ? `+${msg.phone}` : msg.jid} (não está na lista de números de teste)`,
      });
    }
    const contact = this.#rememberContact(msg);
    if (msg.phone) this.seenContacts.add(msg.phone);
    if (!decision) return;

    if (decision.kind === 'agent') {
      await this.agent.handleIncoming(
        { key: msg.jid, phone: msg.phone, name: msg.name, text: msg.text },
        async (text) => {
          try {
            await this.wa.send(msg.jid, { text });
            this.store.addLog({ type: 'autoreply', phone: msg.phone || msg.jid, message: text, rule: 'Agente IA' });
          } catch (err) {
            this.store.addLog({ type: 'error', phone: msg.phone || msg.jid, message: `Agente IA: ${err.message}` });
          }
        },
      );
      return;
    }

    if (decision.kind === 'optout') this.store.addToBlacklist(msg.phone);
    if (decision.kind === 'optin') this.store.removeFromBlacklist(msg.phone);

    // Evita responder várias vezes seguidas ao mesmo contato.
    const cooldown = Number(s.replyCooldownMinutes || 0) * 60_000;
    const last = this.lastReply.get(msg.jid) || 0;
    if (decision.kind !== 'optout' && decision.kind !== 'optin' && cooldown && Date.now() - last < cooldown) return;

    if (decision.rule?.addTag && contact && !contact.tags.includes(decision.rule.addTag)) {
      contact.tags.push(decision.rule.addTag);
      this.store.save();
    }

    try {
      await this.wa.send(msg.jid, { text: decision.text, media: decision.media });
      this.lastReply.set(msg.jid, Date.now());
      this.store.addLog({
        type: 'autoreply',
        phone: msg.phone || msg.jid,
        message: decision.text,
        rule: decision.rule?.name || decision.kind,
      });
    } catch (err) {
      this.store.addLog({ type: 'error', phone: msg.phone || msg.jid, message: `Resposta automática: ${err.message}` });
    }
  }
}
