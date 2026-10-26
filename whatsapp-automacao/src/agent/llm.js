// Cliente do OpenRouter (API compatível com OpenAI): uma chave, qualquer modelo.
const OPENROUTER_URL = `${process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'}/chat/completions`;

export class LLMClient {
  constructor({ getConfig, fetchImpl = globalThis.fetch }) {
    this.getConfig = getConfig; // () => { apiKey, model, temperature }
    this.fetch = fetchImpl;
  }

  get configured() {
    return Boolean(this.getConfig().apiKey);
  }

  /**
   * Envia a conversa e devolve a mensagem do assistente
   * ({ content, tool_calls }).
   */
  async chat({ messages, tools }) {
    const { apiKey, model, temperature } = this.getConfig();
    if (!apiKey) {
      const err = new Error('Configure a chave do OpenRouter na aba "Agente IA"');
      err.status = 400;
      throw err;
    }

    const body = {
      model,
      messages,
      temperature: Number(temperature ?? 0.4),
      max_tokens: 800,
    };
    if (tools?.length) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    let res;
    try {
      res = await this.fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/MandersonGenelhud/Projeto-Cidades-da-Sorte',
          'X-Title': 'ZapAuto - Agente de WhatsApp',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(err.name === 'AbortError' ? 'A IA demorou demais para responder' : `Falha ao chamar a IA: ${err.message}`);
    } finally {
      clearTimeout(timeout);
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      const msg = data.error?.message || `HTTP ${res.status}`;
      throw new Error(`OpenRouter: ${msg}`);
    }
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error('OpenRouter não retornou resposta');
    return { content: message.content || '', tool_calls: message.tool_calls || [], usage: data.usage };
  }
}
