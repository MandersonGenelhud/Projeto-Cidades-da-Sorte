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
    const taken = this.claims.filter((c) => ['reservada', 'confirmada'].includes(c.status)).length;
    return { open: this.open, total, taken, left: Math.max(0, total - taken), confirmed: this.claims.filter((c) => c.status === 'confirmada').length };
  }

  /** O cliente disse que paga à vista: guarda uma vaga (uma por conversa). Devolve { ok, left, ... }. */
  claim({ convKey, leadId = null, name = '', phone = '', pacote = '' }) {
    const s = this.status();
    if (!s.open) return { ok: false, motivo: 'encerrada', left: 0 };
    const mine = this.claims.find((c) => c.convKey === convKey && ['reservada', 'confirmada'].includes(c.status));
    if (mine) return { ok: true, ja: true, left: s.left, status: mine.status };
    if (s.left <= 0) return { ok: false, motivo: 'esgotada', left: 0 };
    const rec = { id: crypto.randomBytes(5).toString('hex'), convKey, leadId, name: String(name || '').slice(0, 100), phone: String(phone || '').replace(/\D/g, ''), pacote: String(pacote || '').slice(0, 60), status: 'reservada', at: iso(this.now()) };
    this.claims.push(rec);
    this.store.save();
    return { ok: true, left: s.left - 1, status: 'reservada', id: rec.id };
  }

  #find(id) { const c = this.claims.find((x) => x.id === id); if (!c) throw Object.assign(new Error('Vaga não encontrada'), { status: 404 }); return c; }

  confirm(id, by = 'Administrador') { const c = this.#find(id); if (c.status === 'liberada') throw Object.assign(new Error('Esta vaga já foi liberada'), { status: 400 }); Object.assign(c, { status: 'confirmada', confirmedAt: iso(this.now()), by }); this.store.save(); return c; }

  release(id, by = 'Administrador') { const c = this.#find(id); if (c.status === 'confirmada') throw Object.assign(new Error('Esta vaga já foi confirmada (pagamento recebido)'), { status: 400 }); Object.assign(c, { status: 'liberada', releasedAt: iso(this.now()), by }); this.store.save(); return c; }

  list() { this.#expire(); return [...this.claims].reverse(); }
}

/** "Mais de X pessoas": arredonda PARA BAIXO para a centena (1.101 → 1.100; 1.099 → 1.000; 999 → 900), para nunca prometer mais do que existe. */
export const roundedPeople = (n) => Math.max(0, Math.floor(Number(n) / 100) * 100);
export const peopleLabel = (n) => { const r = roundedPeople(n); return r >= 100 ? `mais de ${r.toLocaleString('pt-BR')} pessoas` : ''; };

/** Legenda curta para postar a arte nos grupos, com os destaques do WhatsApp (*negrito*). */
export function buildCaption({ people = 0, link = '', spots = 20, until = '2026-11-12' } = {}) {
  const [y, m, d] = String(until).split('-');
  const label = peopleLabel(people);
  return [
    `*OFERTA RELÂMPAGO ATÉ QUINTA-FEIRA, ${d}/${m}*`,
    '',
    `${label ? `Entre ${label} dos nossos grupos, ` : 'Dos nossos grupos, '}*só ${spots}* vão ganhar *1 ano de curso de idiomas* (espanhol na prática, do dia a dia) fechando com a Migra nos planos *Prata ou Ouro*.`,
    '',
    'Um ano de curso de idiomas em escola tradicional custa, em média, de R$ 3 mil a R$ 10 mil.',
    '',
    '*À vista* ou em até *3x no cartão* (os juros da operadora ficam por conta do cliente).',
    '',
    `*Quer garantir a sua vaga? Clique aqui:*`,
    link,
  ].join('\n');
}
