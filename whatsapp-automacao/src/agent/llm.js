// Cliente de IA no formato da API da OpenAI (chat completions + ferramentas).
// Funciona com o Google Gemini (tem cota gratuita), a OpenAI (ChatGPT) e o OpenRouter.
// O Claude (Anthropic) usa o SDK oficial, em ./claude.js.
import { ClaudeChat } from './claude.js';

export const PROVIDERS = {
  gemini: {
    label: 'Google Gemini',
    url: () => `${process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai'}/chat/completions`,
    keyHint: 'Crie grátis em aistudio.google.com/apikey',
    headers: {},
    // Os modelos Gemini 3 "pensam" antes de responder; "low" deixa a resposta rápida
    // e evita que o raciocínio gaste todo o limite e a resposta venha vazia.
    extraBody: { reasoning_effort: 'low' },
    // Se o modelo escolhido falhar (fora do ar, sem cota grátis, nome errado), tenta estes.
    fallbackModels: ['gemini-3.5-flash-lite', 'gemini-2.5-flash'],
  },
  openai: {
    label: 'OpenAI (ChatGPT)',
    url: () => `${process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'}/chat/completions`,
    keyHint: 'Crie em platform.openai.com/api-keys (cobrança separada do plano do ChatGPT)',
    headers: {},
    // Os modelos novos da OpenAI não aceitam temperatura e usam max_completion_tokens.
    noTemperature: true,
    maxTokensKey: 'max_completion_tokens',
  },
  anthropic: {
    label: 'Claude (Anthropic)',
    keyHint: 'Crie em console.anthropic.com → API Keys',
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
    const { provider = 'gemini', apiKey, model } = this.getConfig();
    const p = PROVIDERS[provider] || PROVIDERS.gemini;
    if (!apiKey) {
      const err = new Error(`Configure a chave do ${p.label} na aba "Agente IA"`);
      err.status = 400;
      throw err;
    }
    if (provider === 'anthropic') {
      const claude = new ClaudeChat({ apiKey, model, client: this.claudeClient || null });
      return claude.chat({ messages, tools });
    }
    // Modelo escolhido e, se ele falhar por motivo que não seja a chave, os reservas.
    const models = [model, ...(p.fallbackModels || []).filter((m) => m !== model)];
    let lastErr;
    for (const m of models) {
      try {
        const reply = await this.#call(p, provider, apiKey, m, { messages, tools });
        if (m !== model) reply.fallbackModel = m;
        return reply;
      } catch (err) {
        lastErr = err;
        if (err.auth) break; // chave errada: trocar de modelo não resolve
      }
    }
    throw lastErr;
  }

  async #call(p, provider, apiKey, model, { messages, tools }) {
    const { temperature } = this.getConfig();
    const body = {
      model,
      // O campo _anthropic só existe na conversa com o Claude.
      messages: messages.map(({ _anthropic, ...m }) => m),
      ...(p.noTemperature ? {} : { temperature: Number(temperature ?? 0.4) }),
      [p.maxTokensKey || 'max_tokens']: p.maxTokensKey ? 4096 : 2048,
      ...(p.extraBody || {}),
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
      const raw = data.error?.message || `HTTP ${res.status}`;
      const err = new Error(`${friendlyError(provider, res.status, raw)} [modelo ${model}]`);
      err.quota = res.status === 429 || /quota|rate limit|resource_exhausted/i.test(raw);
      err.auth = res.status === 401 || res.status === 403 || /api key not valid|invalid api key|unauthorized|permission/i.test(raw);
      throw err;
    }
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error(`${p.label} não retornou resposta [modelo ${model}]`);
    if (!message.content && !message.tool_calls?.length) {
      const reason = data.choices?.[0]?.finish_reason;
      throw new Error(`${p.label} devolveu uma resposta vazia${reason ? ` (${reason})` : ''} [modelo ${model}]`);
    }
    // Garante um id em cada chamada de ferramenta (nem todo provedor envia).
    const toolCalls = (message.tool_calls || []).map((c, i) => ({ ...c, id: c.id || `call_${Date.now()}_${i}`, type: c.type || 'function' }));
    return { content: message.content || '', tool_calls: toolCalls, usage: data.usage };
  }
}
