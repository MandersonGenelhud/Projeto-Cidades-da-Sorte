// Pessoas da casa que usam a Ana pelo mesmo número da Maria, SEM acesso ao painel nem à empresa (ex.: a esposa do Manderson).
// Cada pessoa tem a PRÓPRIA agenda e o PRÓPRIO financeiro. O que é compartilhado, só entre as duas pessoas ligadas: a lista de compras e os avisos
// ("a Carol adicionou um lembrete para você"). O 9º dígito dos celulares brasileiros não atrapalha: 5569 9287-6716 e 5569 99287-6716 são a mesma pessoa.
import crypto from 'node:crypto';
import { normalizePhone, samePhone } from './utils.js';

const first = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export class Family {
  constructor({ store, auth }) { Object.assign(this, { store, auth }); }

  get list() { return (this.store.settings.ana?.family || []).filter((f) => f && f.id && f.whatsapp); }

  #save(list) { this.store.updateSettings({ ana: { family: list } }); this.store.settings.ana.family = list; this.store.save?.(); }

  /** O registro como "pessoa" que a Ana entende (mesma forma de um usuário, mas sem login e sem painel). */
  asUser(f) { return { id: `fam:${f.id}`, name: f.name, role: 'familia', active: true, whatsapp: f.whatsapp, linkedUserId: f.linkedUserId || null }; }

  add({ name, whatsapp, linkedUserId }) {
    const nm = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const ph = normalizePhone(whatsapp);
    if (!nm) throw Object.assign(new Error('Escreva o nome da pessoa'), { status: 400 });
    if (!ph || ph.length < 11) throw Object.assign(new Error('WhatsApp inválido: use o número completo com DDD (ex.: +55 69 99287-6716)'), { status: 400 });
    const owner = this.auth.get(linkedUserId);
    if (!owner) throw Object.assign(new Error('Escolha com quem a lista de compras e os lembretes serão compartilhados'), { status: 400 });
    if (this.auth.users.some((u) => u.whatsapp && samePhone(u.whatsapp, ph))) throw Object.assign(new Error('Este número já é de uma pessoa da equipe'), { status: 400 });
    if (this.list.some((f) => samePhone(f.whatsapp, ph))) throw Object.assign(new Error('Este número já está cadastrado'), { status: 400 });
    if (this.list.some((f) => f.linkedUserId === owner.id)) throw Object.assign(new Error('Esta pessoa já tem alguém ligado à Ana dela'), { status: 400 });
    const f = { id: crypto.randomBytes(4).toString('hex'), name: nm, whatsapp: ph, linkedUserId: owner.id, createdAt: new Date().toISOString() };
    this.#save([...this.list, f]);
    return f;
  }

  remove(id) { this.#save(this.list.filter((f) => f.id !== id)); }

  /** Quem escreveu? (pelo número, tolerando o 9º dígito). */
  personByPhone(phone) { const f = this.list.find((x) => samePhone(x.whatsapp, phone)); return f ? this.asUser(f) : null; }

  /** Pessoa (usuário do sistema ou da casa) pelo id, para enviar avisos. */
  userById(id) {
    if (String(id).startsWith('fam:')) { const f = this.list.find((x) => `fam:${x.id}` === id); return f ? this.asUser(f) : null; }
    return this.auth.get(id) || null;
  }

  /** O par (marido e esposa): quem está ligado a esta pessoa. */
  partnerOf(userId) {
    if (String(userId).startsWith('fam:')) { const f = this.list.find((x) => `fam:${x.id}` === userId); const u = f && this.auth.get(f.linkedUserId); return u ? { id: u.id, name: u.name, whatsapp: u.whatsapp, role: u.role } : null; }
    const f = this.list.find((x) => x.linkedUserId === userId);
    return f ? this.asUser(f) : null;
  }

  /** Chave da caixa compartilhada (lista de compras) deste casal, ou null. */
  shareKey(userId) {
    const p = this.partnerOf(userId);
    return p ? `casal:${[userId, p.id].sort().join('+')}` : null;
  }

  members(userId) { const p = this.partnerOf(userId); return p ? [userId, p.id] : [userId]; }

  /** "lembre a Carol / o Manderson / meu marido / minha esposa de ...": quem é o destinatário (o par) e o resto da frase. */
  crossTarget(userId, text) {
    const p = this.partnerOf(userId);
    if (!p) return null;
    const names = [first(p.name)].filter(Boolean).map((n) => fold(n).replace(/[^a-z0-9]/g, ''));
    const alias = '(?:meu marido|meu esposo|minha esposa|minha mulher|meu companheiro|minha companheira)';
    const who = `(?:${[...names, alias].join('|')})`;
    const re = new RegExp(`^\\s*(?:(?:por favor|pf)[ ,]+)?(?:lembre|lembra|lembrar|avise|avisa|avisar|anote|anota|marque|marca|agende|agenda)\\s+(?:para\\s+|pro\\s+|pra\\s+|a\\s+|o\\s+)?${who}\\s*(?:de|para|que|:|,|-)?\\s*(.*)$`, 'i');
    const flat = fold(text);
    const m = re.exec(flat);
    if (!m) return null;
    // o resto com a grafia original (a mesma posição, já que fold só tira acentos)
    const restFolded = m[1];
    const idx = flat.lastIndexOf(restFolded);
    const rest = idx >= 0 && restFolded ? String(text).slice(idx).trim() : restFolded.trim();
    return { partner: p, rest };
  }
}
