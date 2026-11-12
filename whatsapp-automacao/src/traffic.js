// Tráfego: quantas pessoas chegam por dia em cada número (principal, Central, vendedores, Instagram), quantas vêm de anúncio, de qual anúncio,
// quão rápido são respondidas e o que acontece depois (encaminhadas ao vendedor, fechadas). Serve à equipe de gestão de tráfego e ao relatório diário.
// Só números agregados: nenhum telefone nem nome de cliente sai daqui.
const TZ = 'America/Asuncion';
const dayOf = (iso) => (iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ }) : '');
const fmtDay = (d) => d.split('-').reverse().join('/');
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
/** O que a equipe de tráfego (acesso restrito) pode chamar: só leitura do relatório e dados mínimos de tela. */
export const trafficRouteAllowed = (method, path) => method === 'GET' && /^\/(traffic(\.csv)?|me|brand|offices)$/.test(path);
const SKIP_SOURCES = new Set(['manual', 'importacao', 'legacy']);

export class Traffic {
  /** lineLabel(id) → nome do número; conversation(key) → conversa (para medir o tempo da primeira resposta). */
  constructor({ store, crm, lineLabel = () => '', conversation = () => null, mainLabel = () => 'Número principal', now = () => new Date() }) {
    Object.assign(this, { store, crm, lineLabel, conversation, mainLabel, now });
  }

  get config() { return this.store.settings.marketing?.traffic || {}; }

  /** De qual número a pessoa chegou. */
  channelOf(lead) {
    const key = String(lead.conversationKey || lead.whatsappKey || '');
    const m = /^l:([^:]+):/.exec(key);
    if (m) return this.lineLabel(m[1]) || 'WhatsApp da equipe';
    if (key.startsWith('ig:') || lead.source === 'instagram' || lead.source === 'instagram_ads' || lead.instagram) return 'Instagram';
    if (/^(site|quiz|form)/.test(String(lead.source || ''))) return 'Site e formulários';
    return this.mainLabel();
  }

  #firstReplyMin(lead) {
    const conv = this.conversation(lead.conversationKey || lead.whatsappKey);
    const msgs = conv?.messages || [];
    const first = msgs.find((m) => m.role === 'user' && m.at);
    if (!first) return { answered: null, min: null };
    const reply = msgs.find((m) => m.role === 'assistant' && m.at && m.at >= first.at);
    return reply ? { answered: true, min: Math.max(0, Math.round((new Date(reply.at) - new Date(first.at)) / 60000)) } : { answered: false, min: null };
  }

  /** Relatório do período (inclusive). from/to = AAAA-MM-DD no horário do Paraguai. */
  report({ from, to } = {}) {
    const today = dayOf(this.now().toISOString());
    to = /^\d{4}-\d{2}-\d{2}$/.test(to || '') ? to : today;
    from = /^\d{4}-\d{2}-\d{2}$/.test(from || '') ? from : dayOf(new Date(this.now().getTime() - 6 * 86_400_000).toISOString());
    if (from > to) [from, to] = [to, from];
    const leads = this.crm.leads.filter((l) => !SKIP_SOURCES.has(l.source || 'manual') && l.createdAt && dayOf(l.createdAt) >= from && dayOf(l.createdAt) <= to);
    const days = new Map();
    const get = (d) => days.get(d) || days.set(d, { dia: d, novos: 0, deAnuncio: 0, organicos: 0, encaminhados: 0, fechados: 0, semResposta: 0, tempos: [], porNumero: {} }).get(d);
    const ads = new Map(); const nums = new Map(); const tempos = [];
    for (const l of leads) {
      const d = get(dayOf(l.createdAt)); const ch = this.channelOf(l); const ad = Boolean(l.adTitle) || /_ads$/.test(String(l.source || ''));
      d.novos += 1; if (ad) d.deAnuncio += 1; else d.organicos += 1;
      if (l.handoff) d.encaminhados += 1;
      if (l.stage === 'ganho') d.fechados += 1;
      d.porNumero[ch] = (d.porNumero[ch] || 0) + 1;
      const n = nums.get(ch) || nums.set(ch, { numero: ch, novos: 0, deAnuncio: 0, encaminhados: 0, fechados: 0 }).get(ch);
      n.novos += 1; if (ad) n.deAnuncio += 1; if (l.handoff) n.encaminhados += 1; if (l.stage === 'ganho') n.fechados += 1;
      if (ad) {
        const t = String(l.adTitle || 'Anúncio sem nome').slice(0, 80);
        const a = ads.get(t) || ads.set(t, { anuncio: t, novos: 0, encaminhados: 0, fechados: 0 }).get(t);
        a.novos += 1; if (l.handoff) a.encaminhados += 1; if (l.stage === 'ganho') a.fechados += 1;
      }
      const r = this.#firstReplyMin(l);
      if (r.answered === false) d.semResposta += 1;
      if (r.min !== null) { d.tempos.push(r.min); tempos.push(r.min); }
    }
    const rows = [...days.values()].sort((a, b) => a.dia.localeCompare(b.dia)).map((d) => ({ ...d, tempoMedianoMin: median(d.tempos), tempos: undefined }));
    const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
    const novos = sum('novos');
    return {
      from, to,
      totais: {
        novos, deAnuncio: sum('deAnuncio'), organicos: sum('organicos'), encaminhados: sum('encaminhados'), fechados: sum('fechados'), semResposta: sum('semResposta'),
        conversao: novos ? Math.round((sum('fechados') / novos) * 100) : 0,
        tempoMedianoMin: median(tempos), respondidosEm5min: tempos.length ? Math.round((tempos.filter((x) => x <= 5).length / tempos.length) * 100) : null,
      },
      dias: rows, numeros: [...nums.values()].sort((a, b) => b.novos - a.novos), anuncios: [...ads.values()].sort((a, b) => b.novos - a.novos),
    };
  }

  csv(r) {
    const head = ['Data', 'Novos contatos', 'De anúncio', 'Orgânicos', 'Encaminhados ao vendedor', 'Fechados', 'Sem resposta', 'Tempo mediano da 1ª resposta (min)'];
    const lines = r.dias.map((d) => [d.dia, d.novos, d.deAnuncio, d.organicos, d.encaminhados, d.fechados, d.semResposta, d.tempoMedianoMin ?? ''].join(';'));
    return `${head.join(';')}\n${lines.join('\n')}\n`;
  }

  /** Texto do relatório diário (WhatsApp). */
  dailyText(day = dayOf(this.now().toISOString())) {
    const r = this.report({ from: day, to: day });
    const t = r.totais;
    if (!t.novos) return `📊 *Tráfego de ${fmtDay(day)}*\nNenhum contato novo chegou hoje.`;
    return [
      `📊 *Tráfego de ${fmtDay(day)}*`,
      `Chegaram *${t.novos}* pessoa(s): ${t.deAnuncio} de anúncio e ${t.organicos} orgânicas.`,
      r.numeros.length ? `Por número: ${r.numeros.map((n) => `${n.numero} ${n.novos}`).join(' · ')}` : '',
      r.anuncios.length ? `Por anúncio: ${r.anuncios.slice(0, 6).map((a) => `${a.anuncio} ${a.novos}`).join(' · ')}` : '',
      `Encaminhadas ao vendedor: ${t.encaminhados} · fechadas: ${t.fechados}${t.novos ? ` (${t.conversao}%)` : ''}`,
      t.tempoMedianoMin !== null ? `Primeira resposta: mediana de ${t.tempoMedianoMin} min${t.respondidosEm5min !== null ? ` · ${t.respondidosEm5min}% em até 5 min` : ''}` : '',
      t.semResposta ? `⚠️ ${t.semResposta} pessoa(s) ainda sem resposta.` : '',
    ].filter(Boolean).join('\n');
  }
}
