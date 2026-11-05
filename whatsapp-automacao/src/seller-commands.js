// Atalhos que o consultor digita no WhatsApp dele, na conversa do cliente. Hoje: "/contrato".
// O sistema lê a conversa, descobre o pacote, gera o contrato (ou manda a ficha de dados) e apaga o comando da conversa do cliente.
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** "/contrato cédula 2 pessoas" → { cmd: 'contrato', rest: 'cédula 2 pessoas' }. Outro texto → null. */
export function parseCommand(text) {
  const m = String(text || '').match(/^\s*\/(contrato)\b\s*([\s\S]*)$/i);
  return m ? { cmd: m[1].toLowerCase(), rest: m[2].trim() } : null;
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
 * deps: agent, packages() → [{name}], contractFlow.sendContract, say(convKey, texto) → manda ao cliente,
 * tell(owner, texto) → avisa o consultor, revoke(jid, id), ownerOf(msg) → { name, whatsapp } | null, audit(texto).
 */
export function makeSellerCommands(deps) {
  const { agent, packages, contractFlow, say, tell, revoke, ownerOf, audit = () => {}, llm } = deps;
  const FIX = 'Para preparar o seu contrato preciso dos seus dados. É só tocar no link, preencher (uns 2 minutos) e enviar:';

  async function handle(msg) {
    const cmd = parseCommand(msg.text);
    if (!cmd) return false;
    const owner = ownerOf(msg);
    const reply = (t) => tell(owner, t).catch(() => {});
    // O comando some da conversa do cliente (apagar para todos); se não der, o consultor apaga com um toque.
    if (msg.id && revoke) await revoke(msg.jid, msg.id).catch(() => {});
    const conv = agent.conversation(msg.jid);
    conv.phone ||= msg.phone;
    const args = await extractContractArgs({ llm, conv, packages: packages(), rest: cmd.rest });
    const who = conv.name || (msg.phone ? `+${msg.phone}` : 'cliente');
    let r;
    try { r = await contractFlow.sendContract(conv, args); } catch (e) { r = { erro: e.message }; }
    if (r.erro) { await reply(`⚠️ Contrato de ${who}: não consegui. ${r.erro}\n\nDica: escreva o pacote depois do comando, por exemplo: /contrato ${packages()[0]?.name || 'Pacote'} 2 pessoas`); return true; }
    if (r.jaAssinado) { await reply(`✅ O contrato de ${who} já está assinado. Nada a fazer.`); return true; }
    if (r.precisaDados) {
      await say(msg.jid, `${FIX}\n${r.link}`);
      await reply(`📋 Contrato de ${who}: faltam os dados pessoais dele(a). Mandei a ficha na conversa. Assim que ele preencher, o contrato sai sozinho.`);
    } else if (r.enviado) {
      await reply(`✅ Contrato de ${who} gerado e enviado na conversa para assinar pelo celular.`);
    } else {
      await reply(`ℹ️ Contrato de ${who}: ${r.instrucao || 'concluído'}`);
    }
    audit(`${owner?.name || 'consultor'} → ${who}`);
    return true;
  }
  return { handle, wants: (msg) => Boolean(parseCommand(msg?.text)) };
}
