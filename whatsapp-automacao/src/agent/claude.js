// Claude (Anthropic) como cérebro da atendente, pelo SDK oficial.
// O agente conversa no formato "chat completions" (mensagens system/user/assistant/tool);
// aqui a conversa é traduzida para a API de Mensagens da Anthropic e a resposta volta
// no mesmo formato ({ content, tool_calls }).
import Anthropic from '@anthropic-ai/sdk';

export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (o mais inteligente · US$ 4 / 20 por milhão de tokens)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (equilibrado · US$ 2 / 10)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (rápido e barato · US$ 0,10 / 0,50)' },
];

const text = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => b.text || '').join('') : String(c ?? ''));

/** Converte as mensagens do agente para system + messages da Anthropic. */
export function toAnthropic(messages) {
  const system = messages.filter((m) => m.role === 'system').map((m) => text(m.content)).join('\n\n');
  const out = [];
  const push = (role, blocks) => {
    const last = out.at(-1);
    // Mensagens seguidas do mesmo papel viram uma só (ex.: vários resultados de ferramenta).
    if (last && last.role === role && Array.isArray(last.content) && !last.raw) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      push('user', [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: text(m.content) }]);
    } else if (m.role === 'assistant' && m._anthropic) {
      // A resposta do Claude volta exatamente como veio (inclusive os blocos de raciocínio).
      out.push({ role: 'assistant', content: m._anthropic, raw: true });
    } else if (m.role === 'assistant') {
      const blocks = [];
      if (text(m.content).trim()) blocks.push({ type: 'text', text: text(m.content) });
      for (const c of m.tool_calls || []) {
        let input = {};
        try {
          input = JSON.parse(c.function.arguments || '{}');
        } catch {
          input = {};
        }
        blocks.push({ type: 'tool_use', id: c.id, name: c.function.name, input });
      }
      if (blocks.length) push('assistant', blocks);
    } else if (text(m.content).trim()) {
      push('user', [{ type: 'text', text: text(m.content) }]);
    }
  }
  return { system, messages: out.map(({ role, content }) => ({ role, content })) };
}

/** Ferramentas no formato da Anthropic. */
export function toAnthropicTools(tools = []) {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description || '',
    input_schema: t.function.parameters || { type: 'object', properties: {} },
  }));
}

export class ClaudeChat {
  constructor({ apiKey, model, client = null }) {
    this.client = client || new Anthropic({ apiKey });
    this.model = model || 'claude-opus-5-5';
  }

  async chat({ messages, tools }) {
    const { system, messages: msgs } = toAnthropic(messages);
    let response;
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: 16000,
        system,
        messages: msgs,
        ...(tools?.length ? { tools: toAnthropicTools(tools) } : {}),
        // Conversa de WhatsApp: esforço baixo responde rápido e gasta menos.
        output_config: { effort: 'low' },
      });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw new Error('Claude: a chave está errada ou foi desativada. Confira a chave na aba "Agente IA".');
      if (err instanceof Anthropic.PermissionDeniedError) throw new Error(`Claude: a conta não tem acesso a este modelo (${this.model}).`);
      if (err instanceof Anthropic.NotFoundError) throw new Error(`Claude: modelo não encontrado (${this.model}). Escolha outro na aba "Agente IA".`);
      if (err instanceof Anthropic.RateLimitError) throw Object.assign(new Error('Claude: limite de uso atingido. Espere um minuto ou confira os créditos em console.anthropic.com.'), { quota: true });
      if (err instanceof Anthropic.BadRequestError && /credit|billing/i.test(err.message)) throw Object.assign(new Error('Claude: sem créditos. Adicione créditos em console.anthropic.com → Billing.'), { quota: true });
      if (err instanceof Anthropic.APIError) throw new Error(`Claude: ${err.message}`);
      throw err;
    }
    if (response.stop_reason === 'refusal') throw new Error('Claude recusou responder esta mensagem');
    const content = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const tool_calls = response.content
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input || {}) } }));
    return { content, tool_calls, _anthropic: response.content, model: response.model };
  }
}
