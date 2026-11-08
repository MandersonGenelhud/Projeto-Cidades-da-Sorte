// Entrega do orçamento ao cliente: uma MENSAGEM DE VOZ alegre e calma (no lugar do texto que acompanhava o PDF) e o PDF timbrado, com o botão
// "Pronto para dar entrada? Clique aqui". Sem voz disponível (ou no Instagram, que não recebe arquivo) cai para o texto curto de antes.
// Nunca derruba o envio: se a voz falhar, o PDF e o texto saem do mesmo jeito.
export const DEFAULT_QUOTE_VOICE = 'Sulafat'; // calorosa

/** deps: { quotes, wa, agent, tts, store, speakable, style, quoteLink, log } */
export function makeQuoteDelivery({ quotes, wa, agent, tts = null, getTts = null, voiceOf = null, store, speakable = (t) => t, style = '', quoteLink = () => '', log = () => {}, pause = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  /** Devolve { voice: boolean, caption } e grava na memória da atendente o que foi enviado. */
  async function deliver({ convKey, q, name = '', entryAsk = false }) {
    const ig = String(convKey).startsWith('ig:');
    const reserveLink = quotes.reserveLink ? quotes.reserveLink(q) : '';
    const full = quotes.caption(q, { link: ig ? quoteLink(q) : '', name, reserveLink });
    let voice = false;
    // Voz EM ESPERA por padrão: vale para o WhatsApp (perfil) em que o administrador ligou. Perfil de vendedor: voiceOf(convKey) → { on, voice };
    // número principal: quotes.voice.enabled = true.
    const vcfg = store.settings.quotes?.voice || {};
    const own = voiceOf ? voiceOf(convKey) : null;
    const voiceOn = own ? Boolean(own.on) : vcfg.enabled === true;
    const voiceName = (own?.voice) || vcfg.voice || DEFAULT_QUOTE_VOICE;
    const engine = getTts ? getTts() : tts; // o serviço de voz pode ser criado depois deste módulo
    if (!ig && voiceOn && engine?.ready) {
      try {
        const spoken = speakable(quotes.voiceScript(q, { name }));
        const r = await engine.speak(spoken, voiceName, vcfg.style || style);
        await wa.send(convKey, { text: '', media: { buffer: r.buffer, mimetype: r.mimetype, ptt: true }, typing: false });
        voice = true;
        await pause(1800); // uma pessoa manda o áudio e, em seguida, o arquivo
      } catch (e) {
        log({ type: 'error', message: `Voz do orçamento ${q.number}: ${e.message} (seguiu só com o PDF e o texto)` });
      }
    }
    // Com o caminho "dados primeiro": o PDF vai com uma frase curta e, em seguida, vem a pergunta de dar entrada com o link explicado.
    const first = String(name || q.client || '').trim().split(/\s+/)[0];
    const nome = first && first.length > 1 && !/^[+@\d]/.test(first) && first.toLowerCase() !== 'cliente' ? `, ${first.charAt(0).toUpperCase()}${first.slice(1).toLowerCase()}` : '';
    const caption = entryAsk ? `Segue o seu orçamento ${q.number}${nome}. Ele vale até ${quotes.brDate ? quotes.brDate(q.validUntil) : q.validUntil}.` : (voice ? quotes.captionShort(q, { reserveLink }) : full);
    await wa.send(convKey, ig ? { text: reserveLink && entryAsk ? `${caption}\n${quoteLink(q)}` : caption, typing: false } : { text: caption, media: { path: quotes.file(q), mimetype: 'application/pdf', fileName: `Orçamento ${q.number}.pdf` }, typing: false });
    let ask = '';
    if (entryAsk && reserveLink) {
      ask = `Vamos dar entrada no seu processo de reserva${nome}? Para isso, preciso que você preencha os dados do seu cadastro neste link, é rapidinho: ${reserveLink}`;
      await pause(1500);
      await wa.send(convKey, { text: ask, typing: false });
    }
    const conv = agent.conversation(convKey, { create: false });
    if (conv) agent.remember(conv, 'assistant', `${voice ? '[mensagem de voz com a apresentação do orçamento] ' : ''}${caption}${ask ? `\n${ask}` : ''}\n${quotes.memo(q)}`);
    return { voice, caption, ask };
  }
  return { deliver };
}
