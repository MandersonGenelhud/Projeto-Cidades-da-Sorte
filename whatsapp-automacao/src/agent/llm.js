// Cliente de IA no formato da API da OpenAI (chat completions + ferramentas).
// Funciona com o Google Gemini (tem cota gratuita) e com o OpenRouter (pago, qualquer modelo).

export const PROVIDERS = {
  gemini: {
    label: 'Google Gemini',
    url: () => `${process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai'}/chat/completions`,
    keyHint: 'Crie grátis em aistudio.google.com/apikey',
    headers: {},
  },
  openrouter: {
    label: 'OpenRouter',
    url: () => `${process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'}/chat/completions`,
    keyHint: 'Crie em openrouter.ai → Keys',
    headers: {
      'HTTP-Referer': 'https://github.com/MandersonGenelhud/Projeto-Cidades-da-Sorte',
      'X-Title': 'ZapAuto - Agente de WhatsApp',
    },
  },
};

/** Traduz os erros mais comuns para algo que o dono do negócio entenda. */
function friendlyError(provider, status, message) {
  const label = PROVIDERS[provider].label;
  if (status === 401 || status === 403 || /api key not valid|invalid api key|unauthorized/i.test(message)) {
    return `${label}: a chave está errada ou foi desativada. Confira a chave na aba "Agente IA".`;
  }
  if (status === 429 || /quota|rate limit|resource_exhausted/i.test(message)) {
    return `${label}: limite de uso atingido (${message}). No plano gratuito, espere um minuto ou até amanhã, ou escolha um modelo "lite".`;
  }
  if (status === 402 || /insufficient credits|credits/i.test(message)) {
    return `${label}: sem créditos. Adicione créditos ou use o Google Gemini (gratuito).`;
  }
  return `${label}: ${message}`;
}

export class LLMClient {
  constructor({ getConfig, fetchImpl = globalThis.fetch }) {
    this.getConfig = getConfig; // () => { provider, apiKey, model, temperature }
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
    const { provider = 'gemini', apiKey, model, temperature } = this.getConfig();
    const p = PROVIDERS[provider] || PROVIDERS.gemini;
    if (!apiKey) {
      const err = new Error(`Configure a chave do ${p.label} na aba "Agente IA"`);
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
      res = await this.fetch(p.url(), {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...p.headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(err.name === 'AbortError' ? 'A IA demorou demais para responder' : `Falha ao chamar a IA: ${err.message}`);
    } finally {
      clearTimeout(timeout);
    }

    let data = await res.json().catch(() => ({}));
    if (Array.isArray(data)) data = data[0] || {}; // o Gemini às vezes devolve o erro dentro de uma lista
    if (!res.ok || data.error) {
      throw new Error(friendlyError(provider, res.status, data.error?.message || `HTTP ${res.status}`));
    }
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error(`${p.label} não retornou resposta`);
    // Garante um id em cada chamada de ferramenta (nem todo provedor envia).
    const toolCalls = (message.tool_calls || []).map((c, i) => ({ ...c, id: c.id || `call_${Date.now()}_${i}`, type: c.type || 'function' }));
    return { content: message.content || '', tool_calls: toolCalls, usage: data.usage };
  }
}
