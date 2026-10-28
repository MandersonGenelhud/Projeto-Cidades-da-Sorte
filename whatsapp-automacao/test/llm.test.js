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
