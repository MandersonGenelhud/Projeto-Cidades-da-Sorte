// Atalhos que o consultor digita no WhatsApp dele, na conversa do cliente. Hoje: "/contrato".
// O sistema lê a conversa, descobre o pacote, gera o contrato (ou manda a ficha de dados) e apaga o comando da conversa do cliente.
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const COMMANDS = {
  contrato: { admin: false, help: '/contrato [pacote 2 pessoas]: gera o contrato e manda para assinar (ou a ficha de dados, se faltar algo)' },
  orcamento: { admin: false, help: '/orcamento [pacote 2 pessoas]: gera e envia o orçamento em PDF' },
  ficha: { admin: false, help: '/ficha: envia o link da ficha de dados pessoais' },
  ia: { admin: false, help: '/ia: devolve esta conversa para a atendente de IA' },
  pausa: { admin: false, help: '/pausa: a IA para de responder esta conversa' },
  lembrar: { admin: false, help: '/lembrar amanhã 14h ligar para ele: cria uma tarefa com aviso para você' },
  status: { admin: false, help: '/status: mostra para você o contrato e as parcelas deste cliente' },
  ajuda: { admin: false, help: '/ajuda: lista os atalhos' },
  resumo: { admin: true, help: '/resumo (administrador): vencidos, vencimentos e avisos do dia' },
  saude: { admin: true, help: '/saude (administrador): como está o WhatsApp, a IA e a fila' },
};
const ALIAS = { orçamento: 'orcamento', orcamentos: 'orcamento', 'orçamentos': 'orcamento', saúde: 'saude', contract: 'contrato', contratos: 'contrato', fichas: 'ficha', lembrete: 'lembrar' };

/** "/contrato cédula 2 pessoas" → { cmd: 'contrato', rest: 'cédula 2 pessoas' }. Texto comum ou comando desconhecido → null. */
export function parseCommand(text) {
  const m = String(text || '').match(/^\s*\/([a-zA-ZçÇãÃéÉíÍóÓúÚ]{2,12})\b\s*([\s\S]*)$/);
  if (!m) return null;
  const raw = m[1].toLowerCase();
  const cmd = ALIAS[raw] || fold(raw);
  return COMMANDS[cmd] ? { cmd, rest: m[2].trim() } : null;
}

/** "amanhã 14h ligar" → { due: '2026-11-06', time: '14:00', title: 'ligar' }. Sem data, due fica vazio. */
export function parseWhen(text, now = new Date()) {
  let t = ` ${String(text || '')} `;
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const plus = (n) => { const d = new Date(now); d.setDate(d.getDate() + n); return d; };
  let due = '';
  const strip = (re, fn) => { const m = t.match(re); if (m) { due = fn(m); t = t.replace(re, ' '); } };
  strip(/\s(hoje)\s/i, () => iso(now));
  if (!due) strip(/\s(amanh[ãa])\s/i, () => iso(plus(1)));
  if (!due) strip(/\s(depois de amanh[ãa])\s/i, () => iso(plus(2)));
  if (!due) strip(/\s(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s/, (m) => { const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : now.getFullYear(); const d = new Date(y, Number(m[2]) - 1, Number(m[1])); if (!m[3] && d < new Date(now.getFullYear(), now.getMonth(), now.getDate())) d.setFullYear(y + 1); return Number.isNaN(d.getTime()) ? '' : iso(d); });
  if (!due) {
    const days = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
    const m = fold(t).match(new RegExp(`\\s(${days.join('|')})(?:-feira)?\\s`));
    if (m) { const idx = days.indexOf(m[1]); const n = ((idx - now.getDay() + 7) % 7) || 7; due = iso(plus(n)); t = t.replace(new RegExp(`\\s${m[1].replace('terca', 'ter[çc]a').replace('sabado', 's[áa]bado')}(?:-feira)?\\s`, 'i'), ' '); }
  }
  let time = '';
  const hm = t.match(/\s(?:às |as )?(\d{1,2})(?::(\d{2})|h(\d{2})?)\s/i);
  if (hm && Number(hm[1]) < 24) { time = `${String(hm[1]).padStart(2, '0')}:${hm[2] || hm[3] || '00'}`; t = t.replace(hm[0], ' '); }
  return { due, time, title: t.replace(/\s+/g, ' ').trim() };
}

/** Pacote e número de pessoas: primeiro do que o consultor escreveu depois do comando; senão a IA lê a conversa. */
export async function extractContractArgs({ llm, conv, packages = [], rest = '' }) {
  const names = packages.map((p) => p.name).filter(Boolean);
  const f = fold(rest);
  const out = {};
  // Pacote citado inteiro ou por palavras do nome (ex.: "cédula" acha "Cédula de Identidade"); empate entre dois pacotes não escolhe nenhum.
  const score = (n) => (f.includes(fold(n)) ? 99 : fold(n).split(/\s+/).filter((w) => w.length >= 4 && f.includes(w)).length);
  const ranked = names.map((n) => [n, score(n)]).filter(([, sc]) => sc > 0).sort((a, b) => b[1] - a[1]);
  if (ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1])) out.pacote = ranked[0][0];
  const pessoas = f.match(/(\d{1,2})\s*pessoa/); if (pessoas) out.pessoas = Number(pessoas[1]);
  const adultos = f.match(/(\d{1,2})\s*adult/); if (adultos) out.adultos = Number(adultos[1]);
  if (out.pacote || !llm?.configured || !names.length || !(conv?.messages || []).length) return out;
  try {
    const chat = conv.messages.slice(-30).map((m) => `${m.role === 'user' ? 'CLIENTE' : 'CONSULTOR'}: ${String(m.content || '').replace(/\s+/g, ' ').slice(0, 300)}`).join('\n');
    const r = await llm.chat({ messages: [
      { role: 'system', content: `Você lê uma conversa de WhatsApp entre um consultor e um cliente e diz qual pacote foi combinado. Pacotes válidos: ${names.join(' | ')}. Responda SÓ um JSON: {"pacote": "<nome exato da lista ou null>", "pessoas": <número ou null>, "adultos": <número ou null>}. Se não ficou claro, use null. Não invente.` },
      { role: 'user', content: chat },
    ] });
    const j = JSON.parse(String(r.content || '').replace(/```json|```/g, '').trim());
    const pick = names.find((n) => fold(n) === fold(j.pacote));
    if (pick) out.pacote = pick;
    if (!out.pessoas && Number(j.pessoas) > 0) out.pessoas = Math.min(20, Number(j.pessoas));
    if (!out.adultos && Number(j.adultos) > 0) out.adultos = Math.min(20, Number(j.adultos));
  } catch { /* sem leitura da conversa: o consultor escreve o pacote depois do comando */ }
  return out;
}

/**
 * deps: agent, llm, packages() → [{name}], contractFlow.sendContract, say(convKey, texto) → manda ao cliente,
 * tell(owner, texto) → avisa o consultor, revoke(jid, id), ownerOf(msg) → usuário { name, role, whatsapp, id? },
 * sendQuote(conv, args), sendForm(conv, args), setHandoff(key, valor, motivo), addTask(user, dados),
 * contractSummary(phone), digest(), health(), audit(texto), now().
 */
export function makeSellerCommands(deps) {
  const { agent, packages, contractFlow, say, tell, revoke, ownerOf, audit = () => {}, llm, now = () => new Date() } = deps;
  const FIX = 'Para preparar o seu contrato preciso dos seus dados. É só tocar no link, preencher (uns 2 minutos) e enviar:';
  const helpText = (admin) => `*Atalhos* (digite na conversa do cliente; o cliente não vê)\n${Object.entries(COMMANDS).filter(([, c]) => admin || !c.admin).map(([, c]) => `• ${c.help}`).join('\n')}`;

  async function handle(msg, { self = false } = {}) {
    const cmd = parseCommand(msg.text);
    if (!cmd) return false;
    const owner = ownerOf(msg);
    const isAdmin = owner?.role === 'admin';
    const reply = (t) => tell(owner, t).catch(() => {});
    // Dentro da conversa de um cliente o comando é apagado dela; na conversa "Você" não há o que apagar.
    if (!self && msg.id && revoke) await revoke(msg.jid, msg.id).catch(() => {});
    if (COMMANDS[cmd.cmd].admin && !isAdmin) { await reply('Esse atalho é só do administrador.'); return true; }
    if (cmd.cmd === 'ajuda') { await reply(helpText(isAdmin)); return true; }
    if (cmd.cmd === 'resumo') { await reply(deps.digest() || 'Nada pendente hoje.'); audit(`/resumo · ${owner?.name}`); return true; }
    if (cmd.cmd === 'saude') { await reply(deps.health()); audit(`/saude · ${owner?.name}`); return true; }
    if (self) { await reply('Para esse atalho, digite na conversa do cliente. Aqui valem /resumo, /saude e /ajuda.'); return true; }

    const conv = agent.conversation(msg.jid);
    conv.phone ||= msg.phone;
    const who = conv.name || (msg.phone ? `+${msg.phone}` : 'cliente');
    try {
      if (cmd.cmd === 'contrato') {
        const args = await extractContractArgs({ llm, conv, packages: packages(), rest: cmd.rest });
        const r = await contractFlow.sendContract(conv, args).catch((e) => ({ erro: e.message }));
        if (r.erro) await reply(`⚠️ Contrato de ${who}: não consegui. ${r.erro}\n\nDica: escreva o pacote depois do comando, por exemplo: /contrato ${packages()[0]?.name || 'Pacote'} 2 pessoas`);
        else if (r.jaAssinado) await reply(`✅ O contrato de ${who} já está assinado. Nada a fazer.`);
        else if (r.precisaDados) { await say(msg.jid, `${FIX}\n${r.link}`); await reply(`📋 Contrato de ${who}: faltam os dados pessoais dele(a). Mandei a ficha na conversa. Assim que ele preencher, o contrato sai sozinho.`); }
        else if (r.enviado) await reply(`✅ Contrato de ${who} gerado e enviado na conversa para assinar pelo celular.`);
        else await reply(`ℹ️ Contrato de ${who}: ${r.instrucao || 'concluído'}`);
      } else if (cmd.cmd === 'orcamento') {
        const args = await extractContractArgs({ llm, conv, packages: packages(), rest: cmd.rest });
        if (!args.pacote) await reply(`⚠️ Orçamento de ${who}: não achei o pacote. Escreva depois do comando, por exemplo: /orcamento ${packages()[0]?.name || 'Pacote'} 2 pessoas`);
        else {
          const r = await deps.sendQuote(conv, args);
          await reply(r.erro ? `⚠️ Orçamento de ${who}: ${r.erro}` : `✅ Orçamento ${r.numero || ''} de ${who} enviado na conversa.`);
        }
      } else if (cmd.cmd === 'ficha') {
        const r = await deps.sendForm(conv, {});
        if (r.erro) await reply(`⚠️ Ficha de ${who}: ${r.erro}`);
        else { await say(msg.jid, `Para dar continuidade, preencha seus dados neste link (é só tocar e preencher, uns 2 minutos):\n${r.link}`); await reply(`✅ Ficha de dados enviada para ${who}.`); }
      } else if (cmd.cmd === 'ia') {
        deps.setHandoff(msg.jid, false, '');
        await reply(`🤖 A IA voltou a responder ${who}.`);
      } else if (cmd.cmd === 'pausa') {
        deps.setHandoff(msg.jid, true, 'o consultor pediu pausa (/pausa)');
        await reply(`⏸️ A IA não responde mais ${who}. Para devolver, digite /ia nesta conversa.`);
      } else if (cmd.cmd === 'lembrar') {
        const w = parseWhen(cmd.rest, now());
        const task = deps.addTask(owner, { title: `${w.title || 'Retornar'} (${who})${w.time ? ` às ${w.time}` : ''}`, due: w.due, clientName: conv.name || '', notes: w.time ? `Horário combinado: ${w.time}` : '' });
        await reply(`✅ Lembrete criado${w.due ? ` para ${w.due.split('-').reverse().join('/')}${w.time ? ` às ${w.time}` : ''}` : ' (sem data)'}: ${task.title}`);
      } else if (cmd.cmd === 'status') {
        const t = deps.contractSummary(msg.phone);
        await reply(t ? `📄 *${who}*\n${t}` : `ℹ️ ${who}: nenhum contrato encontrado neste número.`);
      }
    } catch (e) {
      await reply(`⚠️ Atalho /${cmd.cmd} em ${who}: ${e.message}`);
    }
    audit(`/${cmd.cmd} · ${owner?.name || 'consultor'} → ${who}`);
    return true;
  }
  return { handle, wants: (msg) => Boolean(parseCommand(msg?.text)) };
}
