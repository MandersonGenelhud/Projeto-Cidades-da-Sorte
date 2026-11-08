// Oferta relâmpago com VAGAS LIMITADAS de verdade: só as próximas N pessoas (padrão 20), que fecharem até a data, em plano Prata ou Ouro,
// pagando à vista, ganham o brinde. O sistema conta as vagas; a IA só fala de escassez com o número real daqui (nunca inventado).
// Vaga "reservada" (cliente disse que paga à vista) vale 48 h ou até a data; a equipe CONFIRMA quando o pagamento à vista cair, ou LIBERA a vaga.
import crypto from 'node:crypto';

const HOUR = 3_600_000;
const iso = (ms) => new Date(ms).toISOString();
const dayOf = (ms) => iso(ms).slice(0, 10);

export class FlashOffer {
  constructor({ store, now = () => Date.now(), holdHours = 48 }) {
    Object.assign(this, { store, now, holdHours });
    store.data.flashClaims ||= [];
  }

  get cfg() { return this.store.settings.crm?.flashOffer || {}; }

  get claims() { return this.store.data.flashClaims; }

  /** A oferta está valendo? (ligada, com texto e dentro da data) */
  get open() { const c = this.cfg; return c.enabled !== false && Boolean(c.title) && Boolean(c.validUntil) && c.validUntil >= dayOf(this.now()); }

  #expire() {
    const t = this.now();
    for (const c of this.claims) if (c.status === 'reservada' && (t - Date.parse(c.at) > this.holdHours * HOUR || (this.cfg.validUntil && dayOf(t) > this.cfg.validUntil))) c.status = 'expirada';
  }

  /** { total, taken, left, open } com os números reais. */
  status() {
    this.#expire();
    const total = Math.max(0, Math.round(Number(this.cfg.spots)) || 0);
    const unlimited = total === 0; // spots = 0: sem limite de pessoas (todos que pagarem a entrada até a data ganham)
    const live = (c) => ['reservada', 'confirmada'].includes(c.status);
    const taken = this.claims.filter((c) => live(c) && c.tier !== 'semestre').length; // só o brinde de 12 meses (à vista) é limitado
    const semestre = this.claims.filter((c) => live(c) && c.tier === 'semestre').length;
    return { open: this.open, unlimited, total, taken, left: unlimited ? null : Math.max(0, total - taken), confirmed: this.claims.filter((c) => c.status === 'confirmada').length, semestre, months: Number(this.cfg.semesterMonths) || 6 };
  }

  /** O cliente disse que paga à vista: guarda uma vaga (uma por conversa). Devolve { ok, left, ... }. */
  claim({ convKey, leadId = null, name = '', phone = '', pacote = '', tier = 'ano' }) {
    const s = this.status();
    if (!s.open) return { ok: false, motivo: 'encerrada', left: 0 };
    tier = tier === 'semestre' ? 'semestre' : 'ano';
    const mine = this.claims.find((c) => c.convKey === convKey && ['reservada', 'confirmada'].includes(c.status));
    if (mine) {
      // Quem tinha o brinde de 6 meses e depois fecha à vista (com vaga livre) sobe para os 12 meses.
      if (mine.tier === 'semestre' && tier === 'ano' && (s.unlimited || s.left > 0)) { mine.tier = 'ano'; this.store.save(); return { ok: true, tier: 'ano', left: s.unlimited ? null : s.left - 1, status: mine.status, subiu: true }; }
      return { ok: true, ja: true, tier: mine.tier || 'ano', left: s.left, status: mine.status };
    }
    if (tier === 'ano' && !s.unlimited && s.left <= 0) return { ok: false, motivo: 'esgotada', left: 0 };
    const rec = { id: crypto.randomBytes(5).toString('hex'), convKey, leadId, name: String(name || '').slice(0, 100), phone: String(phone || '').replace(/\D/g, ''), pacote: String(pacote || '').slice(0, 60), tier, status: 'reservada', at: iso(this.now()) };
    this.claims.push(rec);
    this.store.save();
    return { ok: true, tier, left: s.unlimited ? null : (tier === 'ano' ? s.left - 1 : s.left), status: 'reservada', id: rec.id };
  }

  #find(id) { const c = this.claims.find((x) => x.id === id); if (!c) throw Object.assign(new Error('Vaga não encontrada'), { status: 404 }); return c; }

  confirm(id, by = 'Administrador') { const c = this.#find(id); if (c.status === 'liberada') throw Object.assign(new Error('Esta vaga já foi liberada'), { status: 400 }); Object.assign(c, { status: 'confirmada', confirmedAt: iso(this.now()), by }); this.store.save(); return c; }

  release(id, by = 'Administrador') { const c = this.#find(id); if (c.status === 'confirmada') throw Object.assign(new Error('Esta vaga já foi confirmada (pagamento recebido)'), { status: 400 }); Object.assign(c, { status: 'liberada', releasedAt: iso(this.now()), by }); this.store.save(); return c; }

  list() { this.#expire(); return [...this.claims].reverse(); }
}

/** "Mais de X pessoas": arredonda PARA BAIXO para a centena (1.101 → 1.100; 1.099 → 1.000; 999 → 900), para nunca prometer mais do que existe. */
export const roundedPeople = (n) => Math.max(0, Math.floor(Number(n) / 100) * 100);
export const peopleLabel = (n) => { const r = roundedPeople(n); return r >= 100 ? `mais de ${r.toLocaleString('pt-BR')} pessoas` : ''; };

/** Legenda curta para postar a arte nos grupos, com os destaques do WhatsApp (*negrito*). Oferta para TODOS que pagarem a entrada até a data. */
export function buildCaption({ people = 0, link = '', until = '2026-11-12' } = {}) {
  const [, m, d] = String(until).split('-');
  const label = peopleLabel(people);
  return [
    `*OFERTA RELÂMPAGO ATÉ QUINTA-FEIRA, ${d}/${m}*`,
    '',
    `${label ? `Somos ${label} nos nossos grupos, e ` : ''}*quem fechar com a Migra e der a entrada até quinta-feira* ganha *1 ano de curso de idiomas* (espanhol na prática, do dia a dia) de presente.`,
    '',
    'Um ano de curso de idiomas em escola tradicional custa, em média, de R$ 3 mil a R$ 10 mil.',
    '',
    'Você pode fechar à vista ou em até *3x no cartão* (os juros da operadora ficam por conta do cliente).',
    '',
    '*Quer garantir o seu brinde? Clique aqui:*',
    link,
  ].join('\n');
}
