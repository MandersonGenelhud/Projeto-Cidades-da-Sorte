import test from 'node:test';
import assert from 'node:assert/strict';
import { LLMClient } from '../src/agent/llm.js';

function fake(status, body) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, ...opts, json: JSON.parse(opts.body) });
    return { ok: status < 400, status, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

test('Gemini: endpoint compatível, chave no Authorization e id gerado para a ferramenta', async () => {
  const fetch = fake(200, { choices: [{ message: { content: null, tool_calls: [{ function: { name: 'transferir_para_humano', arguments: '{"motivo":"preço"}' } }] } }] });
  const llm = new LLMClient({ getConfig: () => ({ provider: 'gemini', apiKey: 'AIzaTeste', model: 'gemini-3.8-flash' }), fetchImpl: fetch });
  const r = await llm.chat({ messages: [{ role: 'user', content: 'oi' }], tools: [{ type: 'function', function: { name: 'x' } }] });
  assert.equal(fetch.calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  assert.equal(fetch.calls[0].headers.Authorization, 'Bearer AIzaTeste');
  assert.equal(fetch.calls[0].headers['HTTP-Referer'], undefined);
  assert.equal(fetch.calls[0].json.model, 'gemini-3.8-flash');
  assert.equal(r.content, '');
  assert.ok(r.tool_calls[0].id);
  assert.equal(r.tool_calls[0].type, 'function');
});

test('OpenRouter: endpoint próprio', async () => {
  const fetch = fake(200, { choices: [{ message: { content: 'Olá' } }] });
  const llm = new LLMClient({ getConfig: () => ({ provider: 'openrouter', apiKey: 'sk-or', model: 'm' }), fetchImpl: fetch });
  assert.equal((await llm.chat({ messages: [] })).content, 'Olá');
  assert.equal(fetch.calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
});

test('erros viram mensagens em português', async () => {
  const cfg = () => ({ provider: 'gemini', apiKey: 'k', model: 'm' });
  const quota = new LLMClient({ getConfig: cfg, fetchImpl: fake(429, [{ error: { message: 'Resource has been exhausted' } }]) });
  await assert.rejects(quota.chat({ messages: [] }), /limite de uso atingido/);
  const badKey = new LLMClient({ getConfig: cfg, fetchImpl: fake(400, [{ error: { message: 'API key not valid. Please pass a valid API key.' } }]) });
  await assert.rejects(badKey.chat({ messages: [] }), /chave está errada/);
  const noKey = new LLMClient({ getConfig: () => ({ provider: 'gemini', apiKey: '' }) });
  await assert.rejects(noKey.chat({ messages: [] }), /chave do Google Gemini/);
});

test('Gemini: pensa pouco, resposta vazia vira erro e o modelo reserva assume', async () => {
  const calls = [];
  const fetch = async (url, opts) => {
    const json = JSON.parse(opts.body);
    calls.push(json);
    if (json.model === 'gemini-3.8-flash') return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '' }, finish_reason: 'length' }] }) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Oi! Tudo bem?' } }] }) };
  };
  const llm = new LLMClient({ getConfig: () => ({ provider: 'gemini', apiKey: 'AQ.x', model: 'gemini-3.8-flash' }), fetchImpl: fetch });
  const r = await llm.chat({ messages: [{ role: 'user', content: 'oi' }] });
  assert.equal(calls[0].reasoning_effort, 'low');
  assert.equal(calls[1].model, 'gemini-3.5-flash-lite');
  assert.equal(r.content, 'Oi! Tudo bem?');
  assert.equal(r.fallbackModel, 'gemini-3.5-flash-lite');
});

test('chave errada não fica trocando de modelo', async () => {
  const fetch = fake(400, { error: { message: 'API key not valid. Please pass a valid API key.' } });
  const llm = new LLMClient({ getConfig: () => ({ provider: 'gemini', apiKey: 'errada', model: 'gemini-3.8-flash' }), fetchImpl: fetch });
  await assert.rejects(llm.chat({ messages: [{ role: 'user', content: 'oi' }] }), /chave está errada/);
  assert.equal(fetch.calls.length, 1);
});

test('Claude: converte a conversa e as ferramentas e devolve no formato do agente', async () => {
  const { toAnthropic, ClaudeChat } = await import('../src/agent/claude.js');
  const conv = [
    { role: 'system', content: 'Você é a atendente.' },
    { role: 'user', content: 'Quero o Ouro' },
    { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'enviar_ficha_de_dados', arguments: '{"adultos":2}' } }] },
    { role: 'tool', tool_call_id: 't1', content: '{"ok":true}' },
  ];
  const { system, messages } = toAnthropic(conv);
  assert.equal(system, 'Você é a atendente.');
  assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.deepEqual(messages[1].content[0], { type: 'tool_use', id: 't1', name: 'enviar_ficha_de_dados', input: { adultos: 2 } });
  assert.equal(messages[2].content[0].type, 'tool_result');

  // Resposta do Claude preservada como veio, no próximo envio.
  const raw = [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'tool_use', id: 't9', name: 'consultar', input: {} }];
  const again = toAnthropic([{ role: 'user', content: 'oi' }, { role: 'assistant', content: null, tool_calls: [], _anthropic: raw }]);
  assert.equal(again.messages[1].content, raw);

  const sent = [];
  const fake = { messages: { create: async (body) => { sent.push(body); return { model: body.model, stop_reason: 'tool_use', content: [{ type: 'text', text: 'Perfeito!' }, { type: 'tool_use', id: 'tu1', name: 'enviar_ficha_de_dados', input: { adultos: 2 } }] }; } } };
  const claude = new ClaudeChat({ model: 'claude-opus-5-5', client: fake });
  const r = await claude.chat({ messages: conv.slice(0, 2), tools: [{ type: 'function', function: { name: 'enviar_ficha_de_dados', description: 'x', parameters: { type: 'object', properties: {} } } }] });
  assert.equal(r.content, 'Perfeito!');
  assert.equal(r.tool_calls[0].function.name, 'enviar_ficha_de_dados');
  assert.equal(r.tool_calls[0].function.arguments, '{"adultos":2}');
  assert.equal(sent[0].model, 'claude-opus-5-5');
  assert.equal(sent[0].tools[0].input_schema.type, 'object');
  assert.ok(!('temperature' in sent[0]), 'os modelos novos do Claude não aceitam temperatura');
});

test('ChatGPT (OpenAI): sem temperatura e com max_completion_tokens', async () => {
  const { LLMClient } = await import('../src/agent/llm.js');
  let body;
  let url;
  const llm = new LLMClient({
    getConfig: () => ({ provider: 'openai', apiKey: 'sk-teste', model: 'gpt-5-mini', temperature: 0.4 }),
    fetchImpl: async (u, opts) => { url = u; body = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Oi!' } }] }) }; },
  });
  const r = await llm.chat({ messages: [{ role: 'user', content: 'oi', _anthropic: [] }] });
  assert.equal(r.content, 'Oi!');
  assert.match(url, /api\.openai\.com\/v1\/chat\/completions/);
  assert.ok(!('temperature' in body));
  assert.equal(body.max_completion_tokens, 4096);
  assert.ok(!('_anthropic' in body.messages[0]));
});
