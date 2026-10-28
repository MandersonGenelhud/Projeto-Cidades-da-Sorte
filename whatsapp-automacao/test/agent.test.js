import test from 'node:test';
import assert from 'node:assert/strict';
import { Agent } from '../src/agent/agent.js';
import { LocalCalendar, parseRanges } from '../src/agent/calendar.js';
import { buildSystemPrompt } from '../src/agent/prompt.js';
import { presetSettings } from '../src/agent/presets.js';
import { samePhone } from '../src/utils.js';
import { AutoReply } from '../src/autoreply.js';
import { FakeWA, tempStore } from './helpers.js';

// Segunda-feira, 26/10/2026, 09:05 (horário local)
const NOW = new Date(2026, 9, 26, 9, 5);

/** LLM falso: devolve as respostas roteirizadas em ordem e guarda o que recebeu. */
class ScriptedLLM {
  constructor(replies) {
    this.replies = replies;
    this.calls = [];
    this.configured = true;
  }
  async chat({ messages }) {
    this.calls.push(structuredClone(messages));
    const next = this.replies.shift();
    if (typeof next === 'function') return next(messages);
    return next;
  }
}
const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

function setup(replies) {
  const store = tempStore();
  store.updateSettings(presetSettings('clinica-sorriso'));
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  const calendar = new LocalCalendar({ store, getConfig: () => store.settings.agenda, now: () => NOW });
  const llm = new ScriptedLLM(replies);
  const agent = new Agent({ store, llm, calendar, now: () => NOW });
  return { store, calendar, llm, agent };
}

test('parseRanges e horários livres respeitam expediente, antecedência e ocupados', async () => {
  assert.deepEqual(parseRanges('08:00-12:00, 13:00-18:00'), [[480, 720], [780, 1080]]);
  const { store, calendar } = setup([]);
  store.updateSettings({ agenda: { slotMinutes: 60, minAdvanceMinutes: 30, hours: { 1: '08:00-12:00' } } });
  store.data.appointments.push({ id: 'x', date: '2026-10-26', time: '11:00', status: 'confirmed' });
  const today = await calendar.getSlots('2026-10-26');
  assert.deepEqual(today.slots, ['10:00']); // 08 e 09 já passaram (antecedência 30 min), 11 ocupado
  assert.equal((await calendar.getSlots('2026-11-01')).closed, true); // domingo
  assert.match((await calendar.getSlots('2026-10-25')).error, /passou/);
  assert.match((await calendar.getSlots('2026-02-31')).error, /inválida/);
  assert.match((await calendar.getSlots('2027-10-26')).error, /antecedência/);
});

test('agente consulta a agenda, marca o horário e lembra da conversa', async () => {
  const { store, llm, agent } = setup([
    { content: '', tool_calls: [call('1', 'consultar_horarios_disponiveis', { data: '2026-10-30' })] },
    { content: 'Tenho 08:00, 08:40 e 09:20 na sexta. Qual prefere?', tool_calls: [] },
    { content: '', tool_calls: [call('2', 'agendar_horario', { data: '2026-10-30', hora: '08:40', nome: 'Lucas Lima', servico: 'Limpeza' })] },
    { content: 'Agendado! Sexta, 30/10, às 08:40. 😉', tool_calls: [] },
  ]);
  const sent = [];
  const send = async (t) => sent.push(t);

  await agent.handleIncoming({ key: 'k1', phone: '5541999990000', name: 'Lucas', text: 'Quero marcar uma limpeza sexta' }, send);
  const toolMsg = llm.calls[1].find((m) => m.role === 'tool');
  assert.deepEqual(JSON.parse(toolMsg.content).horarios.slice(0, 3), ['08:00', '08:40', '09:20']);

  await agent.handleIncoming({ key: 'k1', phone: '5541999990000', name: 'Lucas', text: '8:40, Lucas Lima' }, send);
  assert.deepEqual(sent, ['Tenho 08:00, 08:40 e 09:20 na sexta. Qual prefere?', 'Agendado! Sexta, 30/10, às 08:40. 😉']);

  // Memória: a 2ª chamada inclui a conversa anterior
  const history = llm.calls[2].filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => m.content);
  assert.deepEqual(history, ['Quero marcar uma limpeza sexta', 'Tenho 08:00, 08:40 e 09:20 na sexta. Qual prefere?', '8:40, Lucas Lima']);

  const [appt] = store.data.appointments;
  assert.equal(appt.phone, '5541999990000');
  assert.equal(appt.time, '08:40');
  assert.equal(store.data.conversations.k1.messages.length, 4);
});

test('erro de ferramenta volta para a IA em vez de quebrar', async () => {
  const { llm, agent } = setup([
    { content: '', tool_calls: [call('1', 'agendar_horario', { data: '2026-10-25', hora: '10:00', nome: 'A', servico: 'B' })] },
    { content: 'Essa data já passou, quer outro dia?', tool_calls: [] },
  ]);
  const r = await agent.simulate({ text: 'quero marcar ontem' });
  assert.equal(r.text, 'Essa data já passou, quer outro dia?');
  assert.match(JSON.parse(llm.calls[1].at(-1).content).erro, /passou/);
});

test('simulação (dryRun) não grava agendamento', async () => {
  const { store, agent } = setup([
    { content: '', tool_calls: [call('1', 'agendar_horario', { data: '2026-10-30', hora: '10:00', nome: 'A', servico: 'B' })] },
    { content: 'ok', tool_calls: [] },
  ]);
  await agent.simulate({ text: 'marca' });
  assert.equal(store.data.appointments.length, 0);
});

test('transferir para humano pausa o robô naquela conversa', async () => {
  const { agent } = setup([
    { content: '', tool_calls: [call('1', 'transferir_para_humano', { motivo: 'pediu atendente' })] },
    { content: 'Um atendente já vai falar com você!', tool_calls: [] },
  ]);
  const sent = [];
  await agent.handleIncoming({ key: 'k2', phone: '5521911112222', text: 'quero falar com uma pessoa' }, async (t) => sent.push(t));
  await agent.handleIncoming({ key: 'k2', phone: '5521911112222', text: 'alô?' }, async (t) => sent.push(t));
  assert.deepEqual(sent, ['Um atendente já vai falar com você!']);
  assert.equal(agent.conversation('k2').handoff, true);
  assert.equal(agent.conversation('k2').messages.at(-1).content, 'alô?'); // memória continua
});

test('mensagens em rajada viram uma única resposta', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { llm, agent } = setup([
    async () => { await gate; return { content: 'primeira', tool_calls: [] }; },
    { content: 'resposta para tudo', tool_calls: [] },
  ]);
  const sent = [];
  const send = async (t) => sent.push(t);
  const p = agent.handleIncoming({ key: 'k3', phone: '1', text: 'oi' }, send);
  agent.handleIncoming({ key: 'k3', phone: '1', text: 'tudo bem?' }, send);
  agent.handleIncoming({ key: 'k3', phone: '1', text: 'queria marcar' }, send);
  release();
  await p;
  assert.deepEqual(sent, ['resposta para tudo']);
  assert.equal(llm.calls[1].at(-1).content, 'tudo bem?\nqueria marcar');
});

test('com agente ligado, SAIR continua funcionando e regras de palavra-chave vêm antes da IA', async () => {
  const { store, agent } = setup([{ content: 'resposta da IA', tool_calls: [] }]);
  const wa = new FakeWA(); // setup() já usa audience: 'all'
  const bot = new AutoReply({ store, wa, agent });
  bot.save({ name: 'pix', matchType: 'contains', keywords: 'pix', response: 'Chave PIX: 123' });
  const m = (text) => ({ jid: 'j@s.whatsapp.net', phone: '5521900000009', name: 'Zé', text });

  await bot.handle(m('qual o pix?'));
  await bot.handle(m('bom dia'));
  await bot.handle(m('sair'));
  assert.deepEqual(wa.sent.map((s) => s.text), ['Chave PIX: 123', 'resposta da IA', store.settings.optOutMessage]);
});

test('prompt inclui a base do negócio e o calendário relativo', () => {
  const store = tempStore();
  store.updateSettings(presetSettings('clinica-sorriso'));
  const p = buildSystemPrompt(store.settings, { now: NOW });
  assert.match(p, /Clínica Sorriso/);
  assert.match(p, /Rua das Flores, 120/);
  assert.match(p, /sexta-feira 2026-10-30/);
  assert.match(p, /segunda-feira 2026-10-26 \(hoje\)/);
});

test('perfil padrão é a Migra Paraguai: sem agenda, sem notas internas, com triagem', () => {
  const store = tempStore();
  const p = buildSystemPrompt(store.settings, { now: NOW });
  assert.match(p, /Migra Paraguai/);
  assert.match(p, /assistente virtual/);
  assert.match(p, /Pré-qualificação/);
  assert.match(p, /Pacote Ouro: R\$ 12\.997,00/);
  assert.match(p, /R\$ 1\.000,00 de entrada/);
  assert.match(p, /90 a 120 dias úteis/);
  assert.match(p, /Nunca peça CPF/);
  assert.doesNotMatch(p, /consultar_horarios_disponiveis/); // agenda desligada
  assert.doesNotMatch(p, /NOTAS PARA APROVAÇÃO|preços de referência para seis pacotes|Meta Business Agent/);
  assert.equal(store.settings.agenda.enabled, false);
  assert.equal(store.settings.agent.audience, 'test');
});

test('sem agenda, o agente só recebe a ferramenta de transferência e não consegue agendar', async () => {
  const { store, llm, agent } = setup([
    (messages) => ({ content: '', tool_calls: [call('1', 'agendar_horario', { data: '2026-10-30', hora: '10:00', nome: 'A', servico: 'B' })] }),
    { content: 'Vou encaminhar para a equipe.', tool_calls: [] },
  ]);
  store.updateSettings({ agenda: { enabled: false } });
  const tools = [];
  const origChat = llm.chat.bind(llm);
  llm.chat = async (args) => { tools.push(args.tools.map((t) => t.function.name)); return origChat(args); };
  await agent.simulate({ text: 'quero agendar', dryRun: false });
  assert.deepEqual(tools[0], ['transferir_para_humano']);
  assert.equal(store.data.appointments.length, 0);
  assert.match(JSON.parse(llm.calls[1].at(-1).content).erro, /indisponível/);
});

test('transferência avisa o WhatsApp da equipe com o resumo', async () => {
  const store = tempStore();
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  const avisos = [];
  const llm = new ScriptedLLM([
    { content: '', tool_calls: [call('1', 'transferir_para_humano', { motivo: 'quer saber preço' })] },
    { content: 'Vou encaminhar para um consultor.', tool_calls: [] },
  ]);
  const agent = new Agent({ store, llm, calendar: null, now: () => NOW, notifyTeam: async (t) => avisos.push(t) });
  await agent.handleIncoming({ key: 'k', phone: '5511988887777', name: 'Ana', text: 'quanto custa o pacote ouro?' }, async () => {});
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /Ana \(\+5511988887777\)/);
  assert.match(avisos[0], /quer saber preço/);
  assert.match(avisos[0], /quanto custa o pacote ouro\?/);
});

test('samePhone tolera o 9º dígito brasileiro', () => {
  assert.ok(samePhone('(41) 99999-0000', '5541999990000'));
  assert.ok(samePhone('41 99999-0000', '554199990000'));
  assert.ok(!samePhone('41 99999-0000', '5541999990001'));
  assert.ok(!samePhone('', '5541999990000'));
});

test('modo de teste: só os números de teste falam com o agente', async () => {
  const store = tempStore();
  store.updateSettings({ agent: { enabled: true, audience: 'test', testNumbers: ['(41) 99999-0000'] } });
  const llm = new ScriptedLLM([{ content: 'Olá! Sou a assistente virtual da Migra Paraguai.', tool_calls: [] }]);
  const agent = new Agent({ store, llm, calendar: null, now: () => NOW });
  const wa = new FakeWA();
  const bot = new AutoReply({ store, wa, agent });

  await bot.handle({ jid: 'a@s.whatsapp.net', phone: '5511911112222', name: 'Cliente', text: 'oi' });
  assert.equal(wa.sent.length, 0);
  assert.ok(store.data.logs.some((l) => /Modo de teste/.test(l.message)));

  await bot.handle({ jid: 'b@s.whatsapp.net', phone: '554199990000', name: 'Eu', text: 'oi' }); // sem o 9º dígito
  assert.deepEqual(wa.sent.map((s) => s.text), ['Olá! Sou a assistente virtual da Migra Paraguai.']);

  store.updateSettings({ agent: { audience: 'all' } });
  assert.ok(bot.agentAllowed({ phone: '5511911112222' }));
});

test('instalação com a base antiga da Migra recebe a base nova sozinha, sem perder os ajustes', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { Store } = await import('../src/store.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-upg-'));
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
    settings: {
      business: { name: 'Migra Paraguai', prices: 'Não informe valores.' },
      agent: { geminiKey: 'AQ.minha-chave', testNumbers: ['11 98765-4321'], instructions: 'antiga' },
    },
  }));
  const store = new Store(dir);
  assert.equal(store.upgradedPreset, 'migra-paraguai');
  assert.match(store.settings.business.prices, /R\$ 10\.997,00/);
  assert.equal(store.settings.agent.geminiKey, 'AQ.minha-chave');
  assert.deepEqual(store.settings.agent.testNumbers, ['11 98765-4321']);
  assert.match(store.settings.agent.instructions, /Valor antes do preço/);
  assert.equal(store.settings.agent.roleLabel, 'atendente');
  // Na próxima vez não aplica de novo (respeita edições feitas depois)
  store.updateSettings({ business: { prices: 'editado pelo dono' } });
  store.flush();
  assert.equal(new Store(dir).settings.business.prices, 'editado pelo dono');
});

test('outro negócio não é tocado pela atualização da Migra', async () => {
  const { presetUpgrade } = await import('../src/agent/presets.js');
  assert.equal(presetUpgrade({ business: { name: 'Clínica Sorriso' } }), null);
});

test('peneira: o agente encaminha o cliente quente e só então recebe o link do vendedor', async () => {
  const store = tempStore();
  store.updateSettings(presetSettings('migra-paraguai'));
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  const routed = [];
  const llm = new ScriptedLLM([
    (messages) => {
      assert.match(messages[0].content, /Peneira e encaminhamento/);
      assert.match(messages[0].content, /R\$ 1\.000 \+ R\$ 800 por adulto/);
      return { content: '', tool_calls: [call('r1', 'encaminhar_para_vendedor', { resumo: 'Quer o Ouro', temperatura: 'quente' })] };
    },
    (messages) => {
      const tool = JSON.parse(messages.at(-1).content);
      return { content: `Perfeito! A Ana vai continuar com você: ${tool.link}`, tool_calls: [] };
    },
  ]);
  const agent = new Agent({
    store, llm, now: () => NOW,
    routeLead: async (conv, args) => { routed.push(args); return { ok: true, vendedor: 'Ana', link: 'https://wa.me/5511987654321?text=oi' }; },
  });
  const r = await agent.simulate({ text: 'Quero fechar o pacote ouro, já tenho a entrada' });
  assert.equal(routed[0].temperatura, 'quente');
  assert.match(r.text, /wa\.me\/5511987654321/);
  // Sem roteador, a ferramenta nem é oferecida.
  const plain = new Agent({ store, llm: new ScriptedLLM([{ content: 'oi', tool_calls: [] }]), now: () => NOW });
  await plain.simulate({ text: 'oi' });
  assert.ok(!plain.llm.calls[0][0].content.includes('Peneira'));
});

test('se a IA falhar, o cliente não recebe mensagem de erro e o painel mostra o motivo', async () => {
  const store = tempStore();
  store.updateSettings(presetSettings('migra-paraguai'));
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  const llm = { configured: true, chat: async () => { throw new Error('Google Gemini: limite de uso atingido'); } };
  const errors = [];
  const agent = new Agent({ store, llm, now: () => NOW, notify: (ev, d) => ev === 'agentError' && errors.push(d) });
  const sent = [];
  await agent.handleIncoming({ key: '5511999990000@s.whatsapp.net', phone: '5511999990000', text: 'oi' }, async (t) => sent.push(t));
  assert.equal(sent.length, 0);
  assert.match(agent.lastError.message, /limite de uso/);
  assert.equal(errors.length, 1);
});
