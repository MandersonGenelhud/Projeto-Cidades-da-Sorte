// Encaminhar em lote os atendimentos que a IA está conduzindo: cada pessoa recebe a mensagem "vou te encaminhar para um de nossos vendedores" e o vendedor
// do segmento (documentação = rodízio dos vendedores; imóveis = corretor; veículos = setor de veículos) recebe o resumo para dar continuidade.
// O administrador vê a prévia (quantos, por segmento) e só então inicia. Envio devagar (intervalo aleatório) para não arriscar o número no WhatsApp.
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const BULK_MESSAGE = 'Vou te encaminhar para um de nossos vendedores para dar continuidade ao seu atendimento. Em instantes você recebe o contato dele. 🙂';

/** documentacao (padrão) | loteamentos (imóvel) | veiculos. Só pelo que a PESSOA disse e pelo interesse registrado. */
export function segmentOf(lead, conv) {
  const said = (conv?.messages || []).filter((m) => m.role === 'user' && typeof m.content === 'string').slice(-12).map((m) => m.content);
  const n = fold([lead?.interest, lead?.objective, ...said].join(' '));
  if (/\b(lote|lotes|terreno|terrenos|loteamento|apartamento|imovel|imoveis|corretor|corretora|construir|comprar casa|comprar um terreno)\b/.test(n)) return 'loteamentos';
  if (/\b(carro|carros|moto|motos|veiculo|veiculos|caminhonete|automovel|importar carro|comprar carro)\b/.test(n)) return 'veiculos';
  return 'documentacao';
}

export class BulkHandoff {
  /**
   * conversations(): todas as conversas; isClient(lead); humanSpoke(conv); isTeamPhone(phone); canSend(key); send(key, text); forward({ conv, lead, segment }) → Promise.
   */
  constructor({ store, crm, conversations, isClient = () => false, humanSpoke = () => false, isTeamPhone = () => false, canSend = () => true, send, forward, remember = () => {}, audit = () => {}, now = () => new Date(), sleep = (ms) => new Promise((r) => setTimeout(r, ms).unref?.()), delay = () => 20_000 + Math.random() * 25_000 }) {
    Object.assign(this, { store, crm, conversations, isClient, humanSpoke, isTeamPhone, canSend, send, forward, remember, audit, now, sleep, delay });
    this.running = false; this.stopFlag = false;
    store.data.bulkHandoff ||= { done: {}, last: null };
  }

  get state() { return this.store.data.bulkHandoff; }

  /** Quem entra no lote: conversa de WhatsApp com a IA, sem pessoa, sem recusa, sem encaminhamento anterior, cliente ainda em aberto. */
  candidates({ days = 30 } = {}) {
    const since = this.now().getTime() - days * 86_400_000;
    const out = [];
    for (const conv of this.conversations()) {
      const key = String(conv?.key || '');
      if (!conv || conv.simulation || key.startsWith('sim:') || key.startsWith('ig:') || key.includes('@g.us') || conv.isGroup) continue;
      if (this.state.done[key]) continue;
      const msgs = (conv.messages || []).filter((m) => m.role === 'user');
      if (!msgs.length || new Date(conv.updatedAt || 0).getTime() < since) continue;
      if (conv.handoff || conv.declined || this.humanSpoke(conv)) continue;
      if (conv.phone && this.isTeamPhone(conv.phone)) continue;
      const lead = this.crm.findForConversation({ key, phone: conv.phone });
      if (!lead || lead.handoff?.at || ['ganho', 'perdido'].includes(lead.stage) || this.isClient(lead)) continue;
      out.push({ key, conv, lead, segment: segmentOf(lead, conv) });
    }
    return out;
  }

  preview(opts) {
    const c = this.candidates(opts);
    const bySeg = { documentacao: 0, loteamentos: 0, veiculos: 0 };
    for (const x of c) bySeg[x.segment] += 1;
    return { total: c.length, porSegmento: bySeg, exemplos: c.slice(0, 8).map((x) => ({ nome: String(x.lead.name || '').split(' ')[0] || 'Cliente', segmento: x.segment })), rodando: this.running, ultimo: this.state.last };
  }

  stop() { this.stopFlag = true; }

  /** Inicia o envio em segundo plano. Devolve na hora; o andamento fica em state.last. */
  start({ limit = 200, days = 30 } = {}) {
    if (this.running) throw Object.assign(new Error('O encaminhamento já está rodando'), { status: 409 });
    const list = this.candidates({ days }).slice(0, Math.max(1, Math.min(500, Number(limit) || 200)));
    if (!list.length) return { total: 0 };
    this.running = true; this.stopFlag = false;
    this.state.last = { startedAt: this.now().toISOString(), total: list.length, enviados: 0, falhas: 0, pulados: 0, terminou: null };
    this.store.save();
    this.#run(list).catch((e) => this.store.addLog({ type: 'error', message: `Encaminhamento em lote: ${e.message}` })).finally(() => {
      this.running = false; this.state.last.terminou = this.now().toISOString(); this.store.save();
    });
    return { total: list.length };
  }

  async #run(list) {
    const st = this.state.last;
    for (const c of list) {
      if (this.stopFlag) { st.interrompido = true; break; }
      if (!this.canSend(c.key)) { st.pulados += 1; continue; }
      // Reconfere na hora do envio: se uma pessoa falou ou o cliente já foi encaminhado enquanto esperava, não manda.
      const fresh = this.crm.findForConversation({ key: c.key, phone: c.conv.phone });
      if (!fresh || fresh.handoff?.at || this.humanSpoke(c.conv) || c.conv.handoff || c.conv.declined) { st.pulados += 1; continue; }
      try {
        await this.send(c.key, BULK_MESSAGE);
        this.remember(c.conv, 'assistant', BULK_MESSAGE);
        await this.forward({ conv: c.conv, lead: fresh, segment: c.segment });
        this.state.done[c.key] = this.now().toISOString();
        st.enviados += 1;
      } catch (e) {
        st.falhas += 1;
        this.store.addLog({ type: 'error', message: `Encaminhamento em lote (${c.lead.name || c.key}): ${e.message}` });
      }
      this.store.save();
      await this.sleep(this.delay());
    }
    this.audit(`${st.enviados} enviados, ${st.falhas} falhas, ${st.pulados} pulados de ${st.total}`);
  }
}
