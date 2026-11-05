// Escritório virtual do indicador, parte 2:
// - saque da comissão em até 24 horas (o indicador pede; o Marcos deposita e marca como pago);
// - cessão da indicação (o primeiro indicador cede o cliente para outro, se o cliente pedir);
// - links de grupo do WhatsApp rastreáveis (a pessoa faz o pré-cadastro antes de entrar no grupo);
// - materiais de campanha (texto + imagem) com o link de cada indicador e miniatura no WhatsApp.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const err = (status, message) => Object.assign(new Error(message), { status });
const clip = (v, n) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, n);
const cents = (v) => Math.round(Number(v || 0) * 100) / 100;
const DAY = 86_400_000;
const brl = (v, cur = 'BRL') => `${{ USD: 'US$', PYG: 'Gs.', BRL: 'R$' }[cur] || cur} ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
export const CHANNELS = { instagram: 'Post do Instagram', status: 'Status / Stories', whatsapp: 'Mensagem de WhatsApp', grupo: 'Grupo de WhatsApp' };
const IMG = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export class AffiliateExtras {
  constructor({ store, affiliates, crm, dataDir, notifyAffiliate = async () => {}, notifyAdmins = async () => {}, now = () => new Date() }) {
    Object.assign(this, { store, affiliates, crm, notifyAffiliate, notifyAdmins, now });
    this.dir = path.join(dataDir, 'materiais');
    const d = store.data.affiliates;
    d.payouts ||= []; d.transfers ||= []; d.materials ||= [];
  }
  get d() { return this.store.data.affiliates; }
  get config() { const c = this.store.settings.affiliates || {}; return { holdDays: Number.isFinite(Number(c.holdDays)) ? Number(c.holdDays) : 7, payoutHours: Number(c.payoutHours || 24), groups: Array.isArray(c.groups) ? c.groups : [], transferDays: Number(c.transferDays || 7) }; }

  // ---------- Saque ----------
  /** Comissões que já podem ser sacadas: a pagar, fora do prazo de segurança (estorno) e ainda não pedidas. */
  #ready(a) {
    const hold = this.config.holdDays * DAY;
    return this.d.commissions.filter((c) => c.affId === a.id && c.status === 'a_pagar' && !c.payoutId && c.amount > 0 && this.now().getTime() - Date.parse(c.createdAt) >= hold);
  }
  balance(a) {
    const by = (list) => list.reduce((o, c) => ({ ...o, [c.currency || 'BRL']: cents((o[c.currency || 'BRL'] || 0) + c.amount) }), {});
    const pendingHold = this.d.commissions.filter((c) => c.affId === a.id && c.status === 'a_pagar' && !c.payoutId && !this.#ready(a).includes(c));
    return {
      available: by(this.#ready(a)),
      waiting: by(pendingHold),
      holdDays: this.config.holdDays,
      payoutHours: this.config.payoutHours,
      requests: this.d.payouts.filter((p) => p.affId === a.id).slice(-30).reverse(),
    };
  }
  async requestPayout(a, { currency = 'BRL' } = {}) {
    if (!a.pixKey && !a.account) throw err(400, 'Cadastre primeiro onde quer receber (chave Pix ou conta), em "Meus dados"');
    const list = this.#ready(a).filter((c) => (c.currency || 'BRL') === currency);
    if (!list.length) throw err(400, 'Não há comissão disponível para saque nesta moeda');
    const amount = cents(list.reduce((s, c) => s + c.amount, 0));
    const p = { id: crypto.randomBytes(6).toString('hex'), affId: a.id, affName: a.name, currency, amount, commissionIds: list.map((c) => c.id), payout: a.country === 'PY' ? `Conta ${a.bank || ''} ${a.account || ''} · ${a.holder || ''}` : `Pix ${a.pixKey}${a.cpf ? ` · CPF ${a.cpf}` : ''}`, status: 'pedido', createdAt: this.now().toISOString(), dueAt: new Date(this.now().getTime() + this.config.payoutHours * 3_600_000).toISOString() };
    for (const c of list) c.payoutId = p.id;
    this.d.payouts.push(p); this.store.save();
    await this.notifyAdmins(`💸 *Saque de indicador*\n👤 ${a.name} (${a.code})\nValor: ${brl(amount, currency)}\n${p.payout}\nPagar até ${new Date(p.dueAt).toLocaleString('pt-BR')} e marcar como pago em Indicadores.`).catch(() => {});
    return p;
  }
  async payPayout(user, id, { note = '' } = {}) {
    if (user.role !== 'admin') throw err(403, 'Só o administrador paga saques');
    const p = this.d.payouts.find((x) => x.id === id); if (!p) throw err(404, 'Saque não encontrado');
    if (p.status !== 'pedido') throw err(400, `Este saque já está ${p.status}`);
    const at = this.now().toISOString();
    for (const c of this.d.commissions.filter((x) => p.commissionIds.includes(x.id))) Object.assign(c, { status: 'paga', paidAt: at, paidBy: user.name, note: clip(note, 200) || `Saque ${p.id}` });
    Object.assign(p, { status: 'pago', paidAt: at, paidBy: user.name, note: clip(note, 200) });
    this.store.save();
    const a = this.affiliates.get(p.affId);
    if (a) await this.notifyAffiliate(a.whatsapp, `💸 Seu saque de ${brl(p.amount, p.currency)} foi pago. Confira na sua conta. Obrigado pela parceria!`).catch(() => {});
    return p;
  }
  async rejectPayout(user, id, { reason = '' } = {}) {
    if (user.role !== 'admin') throw err(403, 'Só o administrador recusa saques');
    const p = this.d.payouts.find((x) => x.id === id); if (!p) throw err(404, 'Saque não encontrado');
    if (p.status !== 'pedido') throw err(400, `Este saque já está ${p.status}`);
    if (!clip(reason, 200)) throw err(400, 'Diga o motivo (o indicador recebe)');
    for (const c of this.d.commissions.filter((x) => p.commissionIds.includes(x.id))) delete c.payoutId;
    Object.assign(p, { status: 'recusado', reason: clip(reason, 200), decidedAt: this.now().toISOString(), decidedBy: user.name });
    this.store.save();
    const a = this.affiliates.get(p.affId);
    if (a) await this.notifyAffiliate(a.whatsapp, `Seu pedido de saque de ${brl(p.amount, p.currency)} não foi pago: ${p.reason}. O valor voltou para o seu saldo.`).catch(() => {});
    return p;
  }
  payouts() { return this.d.payouts.slice(-300).reverse().map((p) => ({ ...p, late: p.status === 'pedido' && this.now().getTime() > Date.parse(p.dueAt) })); }

  // ---------- Cessão da indicação ----------
  #lead(ref) { return this.crm.leads.find((l) => l.id === ref || l.code === ref) || null; }
  #canMove(lead) {
    const cs = this.d.commissions.filter((c) => c.leadId === lead.id && c.status !== 'cancelada');
    if (cs.some((c) => c.status === 'paga')) throw err(400, 'A comissão deste cliente já foi paga: a indicação não pode mais mudar');
    if (cs.some((c) => c.payoutId)) throw err(400, 'A comissão deste cliente está num pedido de saque: resolva o saque antes');
  }
  #move(t, by) {
    const lead = this.#lead(t.leadId);
    const to = this.affiliates.get(t.toAffId);
    lead.affiliateId = to.id;
    lead.affiliateAt = this.now().toISOString();
    (lead.timeline ||= []).push({ at: lead.affiliateAt, by, type: 'nota', text: `🤝 Indicação cedida por ${this.affiliates.get(t.fromAffId)?.name || '—'} para ${to.name} (${to.code})${t.reason ? `: ${t.reason}` : ''}` });
    for (const c of this.d.commissions.filter((x) => x.leadId === lead.id && x.status === 'a_pagar')) c.affId = to.id;
  }
  /** A equipe registra que o cliente pediu outro indicador: o primeiro indicador é avisado e decide no escritório virtual. */
  async requestTransfer(user, { lead: ref, toCode, reason } = {}) {
    const lead = this.#lead(ref); if (!lead) throw err(404, 'Cliente não encontrado');
    if (!lead.affiliateId) throw err(400, 'Este cliente não tem indicador');
    const to = this.affiliates.byCode(toCode);
    if (!to || to.status !== 'ativo') throw err(400, 'Código do novo indicador não encontrado');
    if (to.id === lead.affiliateId) throw err(400, 'Esse já é o indicador do cliente');
    this.#canMove(lead);
    if (this.d.transfers.some((t) => t.leadId === lead.id && t.status === 'aguardando')) throw err(400, 'Já existe um pedido de troca aguardando resposta');
    const from = this.affiliates.get(lead.affiliateId);
    const t = { id: crypto.randomBytes(6).toString('hex'), leadId: lead.id, leadName: lead.name || 'Cliente', fromAffId: from.id, toAffId: to.id, reason: clip(reason, 300), requestedBy: user.name, status: 'aguardando', createdAt: this.now().toISOString(), deadline: new Date(this.now().getTime() + this.config.transferDays * DAY).toISOString() };
    this.d.transfers.push(t); this.store.save();
    await this.notifyAffiliate(from.whatsapp, `Olá, ${from.name.split(' ')[0]}. ${String(lead.name || 'Um cliente').split(' ')[0]}, que você indicou, pediu que a indicação fique com outra pessoa${t.reason ? ` (${t.reason})` : ''}. Você pode ceder ou manter no seu escritório virtual, em "Pedidos de troca", até ${new Date(t.deadline).toLocaleDateString('pt-BR')}. Se não responder, a diretoria decide.`).catch(() => {});
    return t;
  }
  async respond(a, id, accept) {
    const t = this.d.transfers.find((x) => x.id === id && x.fromAffId === a.id);
    if (!t) throw err(404, 'Pedido não encontrado');
    if (t.status !== 'aguardando') throw err(400, 'Este pedido já foi resolvido');
    if (accept) { this.#canMove(this.#lead(t.leadId)); this.#move(t, a.name); }
    Object.assign(t, { status: accept ? 'cedida' : 'mantida', decidedAt: this.now().toISOString(), decidedBy: a.name });
    this.store.save();
    await this.notifyAdmins(`🤝 ${a.name} ${accept ? 'CEDEU' : 'MANTEVE'} a indicação de ${t.leadName}.`).catch(() => {});
    if (accept) { const to = this.affiliates.get(t.toAffId); if (to) await this.notifyAffiliate(to.whatsapp, `🤝 ${t.leadName.split(' ')[0]} agora é indicação sua: ${a.name.split(' ')[0]} cedeu a indicação.`).catch(() => {}); }
    return t;
  }
  /** O primeiro indicador cede por conta própria (o cliente pediu direto para ele). */
  async cede(a, { lead: ref, toCode, reason } = {}) {
    const lead = this.#lead(ref);
    if (!lead || lead.affiliateId !== a.id) throw err(404, 'Cliente não encontrado entre as suas indicações');
    const to = this.affiliates.byCode(toCode);
    if (!to || to.status !== 'ativo' || to.id === a.id) throw err(400, 'Código do novo indicador inválido');
    this.#canMove(lead);
    const t = { id: crypto.randomBytes(6).toString('hex'), leadId: lead.id, leadName: lead.name || 'Cliente', fromAffId: a.id, toAffId: to.id, reason: clip(reason, 300), requestedBy: a.name, status: 'cedida', createdAt: this.now().toISOString(), decidedAt: this.now().toISOString(), decidedBy: a.name };
    this.#move(t, a.name);
    this.d.transfers.push(t); this.store.save();
    await this.notifyAdmins(`🤝 ${a.name} cedeu a indicação de ${t.leadName} para ${to.name}.`).catch(() => {});
    await this.notifyAffiliate(to.whatsapp, `🤝 ${t.leadName.split(' ')[0]} agora é indicação sua (cedida por ${a.name.split(' ')[0]}).`).catch(() => {});
    return t;
  }
  /** Sem resposta no prazo (ou caso especial), a diretoria decide. */
  async decide(user, id, accept, note = '') {
    if (user.role !== 'admin') throw err(403, 'Só a diretoria decide');
    const t = this.d.transfers.find((x) => x.id === id); if (!t) throw err(404, 'Pedido não encontrado');
    if (t.status !== 'aguardando') throw err(400, 'Este pedido já foi resolvido');
    if (accept) { this.#canMove(this.#lead(t.leadId)); this.#move(t, user.name); }
    Object.assign(t, { status: accept ? 'cedida' : 'mantida', decidedAt: this.now().toISOString(), decidedBy: `${user.name} (diretoria)`, note: clip(note, 300) });
    this.store.save();
    const from = this.affiliates.get(t.fromAffId);
    if (from) await this.notifyAffiliate(from.whatsapp, `A diretoria decidiu o pedido de troca da indicação de ${t.leadName.split(' ')[0]}: ${accept ? 'a indicação passou para outra pessoa' : 'a indicação continua com você'}.${note ? ` ${note}` : ''}`).catch(() => {});
    return t;
  }
  transfersFor(a) {
    const name = (id) => this.affiliates.get(id)?.name?.split(' ')[0] || '—';
    return this.d.transfers.filter((t) => t.fromAffId === a.id || t.toAffId === a.id).slice(-50).reverse().map((t) => ({ id: t.id, leadName: t.leadName, from: name(t.fromAffId), to: name(t.toAffId), reason: t.reason, status: t.status, deadline: t.deadline, mine: t.fromAffId === a.id }));
  }
  transfers() { const name = (id) => this.affiliates.get(id)?.name || '—'; return this.d.transfers.slice(-200).reverse().map((t) => ({ ...t, fromName: name(t.fromAffId), toName: name(t.toAffId), overdue: t.status === 'aguardando' && this.now().getTime() > Date.parse(t.deadline) })); }

  // ---------- Grupos do WhatsApp (rastreáveis) ----------
  setGroups(user, groups = []) {
    if (user.role !== 'admin') throw err(403, 'Só o administrador cadastra grupos');
    const list = groups.slice(0, 20).map((g, i) => ({ key: clip(g.key, 20).toLowerCase().replace(/[^a-z0-9-]/g, '') || `g${i + 1}`, label: clip(g.label, 80), url: clip(g.url, 300) })).filter((g) => g.label && /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+$/.test(g.url));
    this.store.settings.affiliates = { ...(this.store.settings.affiliates || {}), groups: list };
    this.store.save();
    return list;
  }
  group(key) { return this.config.groups.find((g) => g.key === String(key || '').toLowerCase()) || null; }

  // ---------- Materiais de campanha ----------
  materials({ all = false } = {}) { return this.d.materials.filter((m) => all || m.active !== false).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); }
  material(id) { return this.d.materials.find((m) => m.id === id) || null; }
  saveMaterial(user, id, b = {}, file = null) {
    if (user.role !== 'admin') throw err(403, 'Só o administrador cadastra materiais');
    let m = id ? this.material(id) : null;
    if (id && !m) throw err(404, 'Material não encontrado');
    if (!m) { m = { id: crypto.randomBytes(6).toString('hex'), createdAt: this.now().toISOString(), createdBy: user.name, active: true }; this.d.materials.push(m); }
    if (b.title !== undefined) m.title = clip(b.title, 120);
    if (b.text !== undefined) m.text = clip(b.text, 2200);
    if (b.channel !== undefined) m.channel = CHANNELS[b.channel] ? b.channel : 'whatsapp';
    if (b.category !== undefined) m.category = clip(b.category, 30) || 'migracao';
    if (b.to !== undefined) m.to = String(b.to || '').startsWith('/') && !String(b.to).startsWith('//') ? clip(b.to, 200) : '';
    if (b.group !== undefined) m.group = clip(b.group, 20);
    if (b.active !== undefined) m.active = String(b.active) !== 'false' && b.active !== false;
    if (!m.title) { if (!id) this.d.materials.pop(); throw err(400, 'Dê um título ao material'); }
    if (file) {
      const ext = IMG[file.mimetype];
      if (!ext) { if (!id) this.d.materials.pop(); throw err(400, 'Imagem em PNG, JPG ou WEBP'); }
      fs.mkdirSync(this.dir, { recursive: true });
      const name = `${m.id}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(this.dir, name), file.buffer);
      if (m.image) fs.rmSync(path.join(this.dir, m.image), { force: true });
      m.image = name;
    }
    m.updatedAt = this.now().toISOString();
    this.store.save();
    return m;
  }
  imagePath(name) { return /^[a-f0-9]{12}-[a-f0-9]{6}\.(png|jpg|webp)$/.test(String(name)) && fs.existsSync(path.join(this.dir, name)) ? path.join(this.dir, name) : null; }
  /** Material com o link e o nome de quem divulga. */
  forAffiliate(m, { base, code, name }) {
    const link = `${base}/r/${code}?m=${m.id}`;
    const text = String(m.text || '').replaceAll('{link}', link).replaceAll('{nome}', String(name || '').split(' ')[0]);
    return { id: m.id, title: m.title, channel: m.channel, channelLabel: CHANNELS[m.channel] || m.channel, category: m.category, image: m.image ? `${base}/m/img/${m.image}` : '', text: text.includes(link) ? text : `${text}${text ? '\n\n' : ''}${link}`, link };
  }
}
