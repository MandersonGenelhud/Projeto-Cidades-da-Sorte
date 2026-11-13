// "Clientes da Migra esperando no WhatsApp do vendedor": acha, no número de cada vendedor, quem escreveu sobre a Migra e ainda não foi
// respondido (inclusive a conversa em que o vendedor só disse "Só um momento") e a IA daquele número começa a atender, um de cada vez.
// Conversa pessoal (família, amigos, grupos) fica de fora: só entra quem tem um sinal claro de que é cliente da Migra.
import { isMomentPhrase } from '../seller-commands.js';
import { isCentralLine } from '../lines.js';

const LINE_KEY = /^l:([^:]+):(\d+)@s\.whatsapp\.net$/;
const DAY = 86_400_000;
// Sinais fortes: veio pela Central (link com a mensagem pronta) ou trouxe um código de atendimento da Migra.
const CENTRAL_RE = /vim pela central|central da migra|vim (pelo|do) (instagram|site|an[uú]ncio) da migra/i;
const CODE_RE = /c[oó]digo( de atendimento)?( [eé])?:?\s*[A-Z0-9-]{3,}/i;
// Assuntos da Migra (serviços e contratos).
const TOPIC_RE = /\b(migra|resid[eê]ncia|c[eé]dula|radica[cç][aã]o|\bruc\b|empresa no paraguai|morar no paraguai|paraguai|contrato|parcela|or[cç]amento|documenta[cç][aã]o|loteamento|lote|terreno|im[oó]ve(l|is)|ve[ií]culo|financiamento|quanto custa|valor do servi[cç]o|migra school)/i;

const last9 = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 8 ? d.slice(-9) : ''; };
const atMs = (m) => { const t = Date.parse(m?.at || ''); return Number.isFinite(t) ? t : 0; };

/** Por que achamos que é cliente da Migra (texto curto) ou '' quando não há sinal. */
export function migraSignal({ texts = [], lead = null, conv = null }) {
  const all = texts.join('\n');
  if (lead?.handoff?.linkAt || CENTRAL_RE.test(all)) return { forte: true, motivo: 'veio pela Central da Migra' };
  if (CODE_RE.test(all)) return { forte: true, motivo: 'mandou o código de atendimento da Migra' };
  if (lead) return { forte: true, motivo: 'é prospecto no CRM da Migra' };
  const m = all.match(TOPIC_RE);
  if (m && !/pessoal|fam[ií]lia/i.test(conv?.handoffReason || '')) return { forte: false, motivo: `falou de ${m[0].toLowerCase()}` };
  return null;
}

/**
 * Lista quem está esperando resposta nos números dos vendedores.
 * conversations: store.data.conversations · pendingItems: pending.items · lineIds: Set de linhas (null = todas)
 * Devolve { esperando: [...], ignorados: [{ key, nome, motivo }] }.
 */
export function backlogCandidates({ conversations = {}, pendingItems = {}, lineIds = null, leads = [], isTeam = () => false, isBlocked = () => false, now = Date.now(), days = 7 } = {}) {
  const esperando = [];
  const ignorados = [];
  const keys = new Set([...Object.keys(conversations), ...Object.keys(pendingItems)]);
  for (const key of keys) {
    const mk = String(key).match(LINE_KEY);
    if (!mk || (lineIds && !lineIds.has(mk[1]))) continue;
    const conv = conversations[key] || null;
    if (conv?.simulation) continue;
    const phone = conv?.phone || pendingItems[key]?.phone || mk[2];
    const nome = conv?.name || pendingItems[key]?.name || '';
    const msgs = (conv?.messages || []).filter((m) => m && (m.role === 'user' || m.role === 'assistant'));
    let lastUser = -1;
    for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'user') { lastUser = i; break; }
    const tail = lastUser >= 0 ? msgs.slice(lastUser + 1) : msgs;
    const moment = lastUser >= 0 && tail.length > 0 && tail.every((m) => m.by === 'owner' && isMomentPhrase(m.content));
    let waiting = lastUser >= 0 && (tail.length === 0 || moment);
    let lastAt = lastUser >= 0 ? atMs(msgs[lastUser]) : 0;
    // Mensagem que chegou e ainda não entrou na memória da IA (fila de "sem resposta").
    const p = pendingItems[key];
    const extra = [];
    if (p?.texts?.length && Number(p.at || 0) > atMs(msgs.at(-1))) { waiting = true; lastAt = Math.max(lastAt, Number(p.at)); extra.push(...p.texts); }
    if (!waiting) continue;
    if (now - lastAt > days * DAY) continue;
    if (conv?.declined) { ignorados.push({ key, nome, motivo: 'o cliente já disse que não quer' }); continue; }
    if (isTeam(phone)) continue; // alguém da equipe: não é cliente
    if (isBlocked(phone)) { ignorados.push({ key, nome, motivo: 'número bloqueado' }); continue; }
    if (conv?.handoff && !moment && /\/pausa/.test(conv.handoffReason || '')) { ignorados.push({ key, nome, motivo: 'você pediu /pausa nesta conversa' }); continue; }
    // Só retoma pausa de "respondeu pelo celular" ou da análise de conversa; outras pausas (encaminhada, cliente já fechado…) ficam como estão.
    if (conv?.handoff && !moment && !/^Você respondeu pelo celular|^Conversa do Marcos/.test(conv.handoffReason || '')) { ignorados.push({ key, nome, motivo: `pausada: ${conv.handoffReason || 'um humano assumiu'}` }); continue; }
    const texts = [...msgs.filter((m) => m.role === 'user').slice(-15).map((m) => String(m.content || '')), ...extra];
    const lead = leads.find((l) => l.conversationKey === key || l.whatsappKey === key)
      || leads.find((l) => l.phone && last9(l.phone) && last9(l.phone) === last9(phone) && (l.handoff || l.code)) || null;
    const sig = migraSignal({ texts, lead, conv });
    if (!sig) { ignorados.push({ key, nome, motivo: 'sem sinal de assunto da Migra (pode ser conversa pessoal)' }); continue; }
    // Conversa marcada como pessoal pela análise da IA só volta se o sinal for forte (Central, código ou prospecto).
    if (conv?.handoff && !moment && /Conversa do Marcos/.test(conv.handoffReason || '') && !sig.forte) { ignorados.push({ key, nome, motivo: 'a IA tinha visto como conversa pessoal' }); continue; }
    const ultima = extra.at(-1) || msgs[lastUser]?.content || '';
    esperando.push({ key, linha: mk[1], phone, nome, motivo: sig.motivo, forte: sig.forte, soUmMomento: moment, pausada: Boolean(conv?.handoff), ultima: String(ultima).slice(0, 160), at: new Date(lastAt).toISOString(), extra });
  }
  esperando.sort((a, b) => (b.forte - a.forte) || a.at.localeCompare(b.at)); // quem veio pela Central primeiro; depois quem espera há mais tempo
  return { esperando, ignorados };
}

export const WAITING_NOTE = (moment) => (moment
  ? '# QUEM ATENDE PASSOU A CONVERSA PARA VOCÊ\nA pessoa da equipe escreveu ao cliente "Só um momento" e pediu que você continue. Continue o atendimento exatamente de onde parou, respondendo ao que o cliente perguntou por último, de forma natural, como a mesma pessoa voltando depois de um instante. NÃO se apresente de novo, NÃO diga que é outra pessoa ou uma IA: siga a conversa.'
  : '# CLIENTE ESPERANDO RESPOSTA\nEste cliente escreveu neste número e ainda não foi respondido (o dono do número estava ocupado). Responda agora ao que ele disse por último, de forma natural e curta, como a pessoa deste número. Pode começar com um "desculpe a demora" curto, sem explicações longas, e siga o atendimento conduzindo ao próximo passo.');

/**
 * Rotas: GET /api/clientes-esperando (prévia) · POST /api/clientes-esperando/start · POST /api/clientes-esperando/stop.
 * ctx: { store, agent, wa, lines, leads(), isTeam, aiOffFor, isMariaKey, isWithinWorkHours, httpError, notify, sleep }
 * Devolve { start(lineIds, by) } para o atalho /retomar no WhatsApp.
 */
export function registerClientesEsperandoRoutes(app, ctx) {
  const { store, agent, wa, lines, httpError, sleep } = ctx;
  const job = { running: false, stop: false, total: 0, iniciados: 0, pulados: 0, by: '', startedAt: null, finishedAt: null, atual: '' };

  const linesFor = (user) => {
    // Central e Maria têm as próprias regras (a Central encaminha; a Maria é da equipe): aqui só os números dos vendedores.
    const all = lines.list().filter((l) => !ctx.isMariaKey(`l:${l.id}:1@s.whatsapp.net`) && !isCentralLine(l));
    if (user?.role === 'admin') return all;
    const own = lines.byOwner?.(user?.id);
    return own ? all.filter((l) => l.id === own.id) : [];
  };
  const preview = (lineList, days = 7) => {
    const r = backlogCandidates({
      conversations: store.data.conversations || {},
      pendingItems: ctx.pendingItems() || {},
      lineIds: new Set(lineList.map((l) => l.id)),
      leads: ctx.leads(),
      isTeam: ctx.isTeam,
      isBlocked: (ph) => store.isBlacklisted?.(ph),
      days,
    });
    for (const x of r.esperando) {
      if (ctx.aiOffFor(x.key)) x.bloqueio = 'a IA está desligada neste número (Equipe → Conexões)';
      else if (!wa.isConnected(x.key)) x.bloqueio = 'número desconectado';
    }
    return r;
  };

  async function run(list) {
    job.running = true; job.stop = false; job.total = list.length; job.iniciados = 0; job.pulados = 0; job.startedAt = new Date().toISOString(); job.finishedAt = null;
    try {
      for (const x of list) {
        if (job.stop) break;
        job.atual = x.nome || `+${x.phone}`;
        if (ctx.aiOffFor(x.key) || !wa.isConnected(x.key)) { job.pulados += 1; continue; }
        const conv = agent.conversation(x.key);
        conv.phone ||= x.phone;
        if (x.nome) conv.name ||= x.nome;
        for (const t of x.extra || []) agent.remember(conv, 'user', t); // a mensagem que ainda não estava na memória da IA
        if (conv.handoff) agent.setHandoff(x.key, false, '');
        store.addLog({ type: 'system', phone: x.phone, message: `▶️ Atender agora: a IA começou a responder ${x.nome || `+${x.phone}`} (${x.soUmMomento ? 'depois de "Só um momento"' : x.motivo})` });
        const p = agent.handleIncoming({ key: x.key, phone: conv.phone, name: conv.name, text: '', resume: WAITING_NOTE(x.soUmMomento) }, async (text, { typingMs } = {}) => {
          await wa.send(x.key, { text, typingMs });
          store.addLog({ type: 'autoreply', phone: conv.phone || x.key, message: text, rule: 'Atendente de IA (cliente da Migra que estava esperando)' });
        });
        job.iniciados += 1;
        await Promise.resolve(p).catch((e) => store.addLog({ type: 'error', phone: x.phone, message: `Atender agora (${x.nome || x.phone}): ${e.message}` }));
        // Intervalo entre um cliente e outro (além do ritmo humano da própria IA e da proteção do número).
        if (!job.stop) await sleep(20_000 + Math.floor(Math.random() * 20_000));
      }
    } finally {
      job.running = false; job.atual = ''; job.finishedAt = new Date().toISOString();
      store.addLog({ type: 'system', message: `▶️ Atender agora: ${job.iniciados} cliente(s) atendido(s)${job.pulados ? `, ${job.pulados} pulado(s)` : ''}` });
      ctx.notify?.('clientesEsperando', { running: false });
    }
  }

  /** Começa a atender. Devolve { total } ou lança erro com o motivo. */
  function start(lineList, by, { keys = null, days = 7 } = {}) {
    if (job.running) throw httpError(409, 'Já está atendendo os clientes que estavam esperando. Aguarde terminar.');
    if (!agent.active) throw httpError(409, 'A IA está desligada ou sem a chave (aba Agente IA).');
    if (!ctx.isWithinWorkHours()) throw httpError(409, 'Fora do horário da IA (Agente IA → horário de trabalho). Tente de novo no horário.');
    let list = preview(lineList, days).esperando.filter((x) => !x.bloqueio);
    if (keys?.length) list = list.filter((x) => keys.includes(x.key));
    if (!list.length) throw httpError(404, 'Nenhum cliente da Migra esperando resposta (ou a IA está desligada / o número desconectado).');
    job.by = by || '';
    run(list).catch((e) => store.addLog({ type: 'error', message: `Atender agora: ${e.message}` }));
    return { total: list.length, nomes: list.map((x) => x.nome || `+${x.phone}`) };
  }

  app.get('/api/clientes-esperando', (req, res) => {
    const ls = linesFor(req.user);
    const days = Math.min(30, Math.max(1, Number(req.query.days) || 7));
    const r = preview(ls, days);
    const label = Object.fromEntries(ls.map((l) => [l.id, l.label || l.name || l.id]));
    res.json({ days, job, linhas: ls.map((l) => ({ id: l.id, label: label[l.id] })), esperando: r.esperando.map(({ extra, ...x }) => ({ ...x, linhaNome: label[x.linha] || x.linha })), ignorados: r.ignorados.length });
  });
  app.post('/api/clientes-esperando/start', (req, res) => {
    let ls = linesFor(req.user);
    if (req.body?.lineId) ls = ls.filter((l) => l.id === req.body.lineId);
    if (!ls.length) throw httpError(403, 'Você não tem um número de WhatsApp conectado ao sistema.');
    res.json(start(ls, req.user?.name, { keys: Array.isArray(req.body?.keys) ? req.body.keys.map(String) : null, days: Math.min(30, Math.max(1, Number(req.body?.days) || 7)) }));
  });
  app.post('/api/clientes-esperando/stop', (req, res) => { job.stop = true; res.json({ ok: true }); });

  return { start, linesFor, preview, job };
}
