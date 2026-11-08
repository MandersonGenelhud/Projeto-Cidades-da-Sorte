// Entrega do orçamento ao cliente: uma MENSAGEM DE VOZ alegre e calma (no lugar do texto que acompanhava o PDF) e o PDF timbrado, com o botão
// "Pronto para dar entrada? Clique aqui". Sem voz disponível (ou no Instagram, que não recebe arquivo) cai para o texto curto de antes.
// Nunca derruba o envio: se a voz falhar, o PDF e o texto saem do mesmo jeito.
export const DEFAULT_QUOTE_VOICE = 'Sulafat'; // calorosa

/** deps: { quotes, wa, agent, tts, store, speakable, style, quoteLink, log } */
export function makeQuoteDelivery({ quotes, wa, agent, tts = null, getTts = null, store, speakable = (t) => t, style = '', quoteLink = () => '', log = () => {}, pause = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  /** Devolve { voice: boolean, caption } e grava na memória da atendente o que foi enviado. */
  async function deliver({ convKey, q, name = '' }) {
    const ig = String(convKey).startsWith('ig:');
    const reserveLink = quotes.reserveLink ? quotes.reserveLink(q) : '';
    const full = quotes.caption(q, { link: ig ? quoteLink(q) : '', name, reserveLink });
    let voice = false;
    const vcfg = store.settings.quotes?.voice || {};
    const engine = getTts ? getTts() : tts; // o serviço de voz pode ser criado depois deste módulo
    if (!ig && vcfg.enabled !== false && engine?.ready) {
      try {
        const spoken = speakable(quotes.voiceScript(q, { name }));
        const r = await engine.speak(spoken, vcfg.voice || DEFAULT_QUOTE_VOICE, vcfg.style || style);
        await wa.send(convKey, { text: '', media: { buffer: r.buffer, mimetype: r.mimetype, ptt: true }, typing: false });
        voice = true;
        await pause(1800); // uma pessoa manda o áudio e, em seguida, o arquivo
      } catch (e) {
        log({ type: 'error', message: `Voz do orçamento ${q.number}: ${e.message} (seguiu só com o PDF e o texto)` });
      }
    }
    const caption = voice ? quotes.captionShort(q, { reserveLink }) : full;
    await wa.send(convKey, ig ? { text: caption, typing: false } : { text: caption, media: { path: quotes.file(q), mimetype: 'application/pdf', fileName: `Orçamento ${q.number}.pdf` }, typing: false });
    const conv = agent.conversation(convKey, { create: false });
    if (conv) agent.remember(conv, 'assistant', `${voice ? '[mensagem de voz com a apresentação do orçamento] ' : ''}${caption}\n${quotes.memo(q)}`);
    return { voice, caption };
  }
  return { deliver };
}
