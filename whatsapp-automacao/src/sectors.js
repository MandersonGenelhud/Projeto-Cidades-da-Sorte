// Setores do Grupo Migra: cada assunto tem os seus atendentes (cadastrados no painel).
// A atendente virtual direciona o cliente; o atendente do setor recebe o resumo no WhatsApp
// e entra em contato. Com mais de um atendente no setor, vai um de cada vez (rodízio).
import { chatPreview } from './routing.js';
import { normalizePhone, samePhone } from './utils.js';

export const SECTORS = {
  loteamentos: {
    label: 'Loteamentos e terrenos (Migra Imobiliária)',
    hint: 'terreno, lote, loteamento, casa, imóvel, aluguel, quer falar com o dono de um loteamento',
  },
  documentacao: {
    label: 'Documentação e migração (Migra Paraguai)',
    hint: 'residência, cédula, RUC, empresa, mudar para o Paraguai',
  },
  veiculos: {
    label: 'Veículos (Migra Motors)',
    hint: 'carro, moto, comprar, vender ou importar veículo',
  },
};

const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/**
 * Atendente cadastrado só com o nome (sem WhatsApp): usa o WhatsApp de quem tem esse nome na Equipe.
 * Quem não tem WhatsApp em lugar nenhum fica de fora até ser cadastrado.
 */
export function resolvePeople(list, users = []) {
  return (list || []).map((p) => {
    if (p?.whatsapp || !p?.name) return p;
    const n = norm(p.name);
    const u = users.find((x) => x.active !== false && !x.pending && x.whatsapp && (norm(x.name) === n || norm(x.name).startsWith(`${n} `)));
    return u ? { name: p.name, whatsapp: u.whatsapp } : p;
  }).filter((p) => p?.name && p.whatsapp);
}

/** É o Marcos? (WhatsApp do dono em Prospectos → Regras, ou o nome na Equipe). Ele não recebe mais vendas nem visitas. */
export function isOwner(user, ownerPhone = '') {
  if (!user) return false;
  if (ownerPhone && user.whatsapp && samePhone(user.whatsapp, normalizePhone(ownerPhone) || '')) return true;
  return /^marcos\b/.test(norm(user.name));
}

/** "Nome = WhatsApp" por linha → [{ name, whatsapp }]. */
export function parsePeople(text) {
  return String(text || '').split('\n').map((line) => line.split(/[=:]/).map((x) => x.trim()))
    .filter(([name]) => name)
    .map(([name, phone = '']) => ({ name, whatsapp: normalizePhone(phone) || '' }));
}

export class Sectors {
  /** send(phone, text) manda no WhatsApp; notifyAdmins(text) avisa o Marcos quando o setor não tem ninguém. */
  constructor({ store, crm, auth, send = async () => {}, canSend = () => true, notifyAdmins = async () => {} }) {
    Object.assign(this, { store, crm, auth, send, canSend, notifyAdmins });
    store.data.sectorSeq ||= {};
  }

  get config() {
    return this.store.settings.crm?.sectors || {};
  }

  people(id) {
    return resolvePeople(this.config[id]?.people, this.auth?.users);
  }

  /** Próximo atendente do setor (rodízio). Devolve { name, whatsapp, id } (id = usuário do painel com o mesmo WhatsApp). */
  next(id) {
    const list = this.people(id);
    if (!list.length) return null;
    const i = (this.store.data.sectorSeq[id] || 0) % list.length;
    this.store.data.sectorSeq[id] = i + 1;
    this.store.save();
    const p = list[i];
    const user = this.auth?.users?.find((u) => u.whatsapp && samePhone(u.whatsapp, p.whatsapp)) || null;
    return { name: p.name, whatsapp: p.whatsapp, id: user?.id || null };
  }

  /** Ferramenta da IA: direciona o cliente para o setor. */
  async route(conv, args, { dryRun = false } = {}) {
    const id = SECTORS[args.setor] ? args.setor : 'loteamentos';
    const label = this.config[id]?.label || SECTORS[id].label;
    const say = 'Diga que, para um melhor atendimento, você está direcionando para o correspondente do interesse dele e que ele vai entrar em contato com você por aqui em instantes. Não mande link nem número de ninguém.';
    if (dryRun || String(conv.key).startsWith('sim:')) {
      const who = this.people(id)[0];
      return { ok: true, simulacao: true, setor: label, atendente: who?.name || 'o Marcos (setor sem atendente cadastrado)', instrucao: say };
    }
    const lead = this.crm.findForConversation({ key: conv.key, phone: conv.phone, username: conv.username })
      || this.crm.ensureFromConversation({ key: conv.key, phone: conv.phone || normalizePhone(args.telefone) || null, name: args.nome || conv.name, username: conv.username, channel: String(conv.key).startsWith('ig:') ? 'instagram' : 'whatsapp' });
    const person = this.next(id);
    const phone = conv.phone || normalizePhone(args.telefone) || lead?.phone || '';
    const who = args.nome || lead?.name || conv.name || (phone ? `+${phone}` : conv.username ? `@${conv.username}` : 'Cliente');
    const preview = chatPreview(conv, 8);
    const text = [
      `🏷️ *Cliente para você: ${label}*`,
      `👤 ${who}${phone ? ` · +${phone}` : conv.username ? ` · @${conv.username} (Instagram)` : ''}${lead?.code ? ` · ${lead.code}` : ''}`,
      phone ? `💬 Chame agora: https://wa.me/${phone}` : '💬 Cliente do Instagram: responda pelo painel (Conversas)',
      `📝 *O que ele quer:* ${args.resumo || '-'}`,
      args.detalhes ? `📍 *Detalhes:* ${args.detalhes}` : '',
      preview ? `\n💬 *Prévia da conversa:*\n${preview}` : '',
      '\nA atendente virtual avisou que você vai entrar em contato. Chame o cliente o quanto antes.',
    ].filter(Boolean).join('\n');
    if (lead) {
      if (person?.id) this.crm.update({ name: 'IA', role: 'admin' }, lead.id, { ownerId: person.id });
      lead.handoff = { toId: person?.id || null, toName: person?.name || 'Marcos', at: new Date().toISOString(), reason: `${label}: ${args.resumo || ''}`.slice(0, 300), sector: id, auto: false };
      this.crm.addNote({ name: 'IA', role: 'admin' }, lead.id, `🏷️ Direcionado para ${person?.name || 'o Marcos'} (${label}): ${args.resumo || ''}`);
      this.store.save();
    }
    if (person && this.canSend()) await this.send(person.whatsapp, text).catch(() => {});
    else if (id === 'loteamentos') {
      // Terreno, corretor e parceria imobiliária nunca vão para o Marcos nem para os administradores: ficam no CRM até o Gabriel e o Diego terem WhatsApp cadastrado.
      this.store.addLog({ type: 'error', message: `⚠️ ${label}: ninguém com WhatsApp cadastrado (Gabriel e Diego em Prospectos → Regras → Setores ou na Equipe). O contato ficou só no CRM.` });
    } else await this.notifyAdmins(`${text}\n\n⚠️ O setor "${label}" ainda não tem atendente cadastrado (Prospectos → Regras → Setores).`).catch(() => {});
    this.store.addLog({ type: 'system', message: `🏷️ ${who} direcionado para ${person?.name || 'o Marcos'} (${label})` });
    return { ok: true, setor: label, instrucao: say };
  }
}
