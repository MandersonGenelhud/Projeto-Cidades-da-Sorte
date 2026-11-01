import test from 'node:test';
import assert from 'node:assert/strict';
import { Learnings } from '../src/learnings.js';
import { Agent } from '../src/agent/agent.js';
import { presetSettings } from '../src/agent/presets.js';
import { tempStore } from './helpers.js';

const TALK = [
  { role: 'user', content: 'Quero o Prata mas só recebo dia 10' },
  { role: 'assistant', content: 'Hoje você só paga a entrada; o resto é nas vindas.' },
  { role: 'user', content: 'Ah, então dá. Prefiro Pix.' },
  { role: 'assistant', content: 'Perfeito, vou te mandar a ficha.' },
];

test('venda confirmada vira sugestão pendente; só o aprovado entra no atendimento', async () => {
  const store = tempStore();
  const llm = { configured: true, chat: async () => ({ content: '{"licoes": ["Quem só recebe no dia 10 decide quando entende que hoje paga só a entrada.", "curta"]}' }) };
  const l = new Learnings({ store, llm });
  const out = await l.fromWon({ id: 'L1' }, TALK);
  assert.equal(out.length, 1, 'frase curta demais é ignorada');
  assert.equal(out[0].status, 'pendente');
  assert.equal(l.approvedText(), '', 'pendente não vai para a atendente');
  assert.deepEqual(await l.fromWon({ id: 'L1' }, TALK), [], 'uma vez por venda');
  l.approve(out[0].id, 'Marcos', 'Quem só recebe no dia 10 fecha quando entende que hoje paga só a entrada.');
  assert.match(l.approvedText(), /^- Quem só recebe no dia 10 fecha/);
  const own = l.add('Mostrar o depoimento do Instagram antes do Pix acalma quem tem receio.', { by: 'Marcos' });
  assert.equal(own.status, 'aprovado');
  l.reject(own.id, 'Marcos');
  assert.doesNotMatch(l.approvedText(), /Instagram/);
  assert.throws(() => l.add('oi'), /pelo menos uma frase/);
  // Conversa curta demais ou IA sem chave: nada é sugerido.
  assert.deepEqual(await l.fromWon({ id: 'L2' }, TALK.slice(0, 2)), []);
  assert.deepEqual(await new Learnings({ store, llm: { configured: false } }).fromWon({ id: 'L3' }, TALK), []);
});

test('atendente: fechamento por escolha (Pix, cartão ou dinheiro), sem aceitar "depois", taxa da visita e aprendizados', async () => {
  const store = tempStore();
  store.updateSettings(presetSettings('migra-paraguai'));
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  let system = '';
  const llm = { configured: true, chat: async ({ messages }) => { system = messages[0].content; return { content: 'Sua reserva fica R$ 2.600,00. Prefere Pix ou cartão?', tool_calls: [] }; } };
  const agent = new Agent({ store, llm, now: () => new Date(2026, 9, 26, 9, 5) });
  agent.requestVisit = async () => ({ ok: true });
  agent.scheduleReturn = async () => ({ ok: true });
  agent.learnings = () => '- Quem só recebe no dia 10 fecha quando entende que hoje paga só a entrada.';
  const conv = agent.conversation('5511999990000@s.whatsapp.net');
  agent.remember(conv, 'user', 'Vou deixar para depois');
  await agent.think(conv);
  assert.match(system, /A sua reserva fica R\$ 1\.000,00 \+ R\$ 800,00 por adulto \(com 2 adultos, R\$ 2\.600,00\)\. Para garantir a sua reserva e já darmos entrada na emissão das suas certidões, você prefere fazer a entrada no Pix ou no cartão\?/);
  assert.match(system, /se fosse para você fechar conosco, você pretende pagar à vista ou parcelado no cartão de crédito\? À vista no Pix ou parcelado no cartão\?/);
  assert.match(system, /levar_para_whatsapp/);
  assert.match(system, /NUNCA pergunte algo que possa ser respondido com "não"/);
  assert.match(system, /Só depois de duas tentativas/);
  assert.match(system, /2 = R\$ 2\.600,00/);
  assert.match(system, /taxa de reserva de R\$ 150,00 paga antes pelo Pix/);
  assert.match(system, /Aprendizados de vendas fechadas[\s\S]*dia 10/);
  assert.doesNotMatch(system, /Quer que eu já te mande a ficha/);
  // Taxa zerada no painel: a atendente não fala de taxa.
  store.updateSettings({ visits: { consultFee: 0 } });
  await agent.think(conv);
  assert.doesNotMatch(system, /consultoria presencial com taxa de R\$ 0/);
});

test('Instagram: a ferramenta de levar para o WhatsApp só aparece no Direct', async () => {
  const store = tempStore();
  store.updateSettings(presetSettings('migra-paraguai'));
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  const seen = [];
  const replies = [
    { content: '', tool_calls: [{ id: '1', type: 'function', function: { name: 'levar_para_whatsapp', arguments: JSON.stringify({ whatsapp: '45 98888-1111', nome: 'Carla' }) } }] },
    { content: 'Acabei de te chamar no WhatsApp, seguimos por lá!', tool_calls: [] },
    { content: 'Oi!', tool_calls: [] },
  ];
  const llm = { configured: true, chat: async ({ tools }) => { seen.push(tools.map((t) => t.function.name)); return replies.shift(); } };
  const agent = new Agent({ store, llm, now: () => new Date(2026, 9, 26, 9, 5) });
  const moved = [];
  agent.moveToWhatsapp = async (conv, args) => { moved.push(args); return { ok: true }; };
  const ig = agent.conversation('ig:123');
  agent.remember(ig, 'user', 'Meu zap é 45 98888-1111');
  const r = await agent.think(ig);
  assert.equal(moved[0].whatsapp, '45 98888-1111');
  assert.match(r.text, /WhatsApp/);
  assert.ok(seen[0].includes('levar_para_whatsapp'));
  const wa = agent.conversation('5545988881111@s.whatsapp.net');
  agent.remember(wa, 'user', 'Oi');
  await agent.think(wa);
  assert.ok(!seen.at(-1).includes('levar_para_whatsapp'), 'no WhatsApp a ferramenta não aparece');
});

test('mentoria com o Marcos (US$ 250/h): a atendente oferece só para quem insiste e registra para ele confirmar', async () => {
  const store = tempStore();
  store.updateSettings(presetSettings('migra-paraguai'));
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  let system = '';
  const llm = { configured: true, chat: async ({ messages }) => { system = messages[0].content; return { content: 'Ok', tool_calls: [] }; } };
  const agent = new Agent({ store, llm, now: () => new Date(2026, 9, 26, 9, 5) });
  agent.notifyOwner = async () => ({ ok: true });
  agent.bookMentoring = async () => ({ ok: true });
  const conv = agent.conversation('5511999990000@s.whatsapp.net');
  agent.remember(conv, 'user', 'Quero falar direto com o Marcos');
  await agent.think(conv);
  assert.match(system, /60 minutos por US\$ 250/);
  assert.match(system, /não converta para reais por conta própria|Não converta para reais por conta própria/);
  assert.match(system, /250 dólares americanos \(US\$ 250\) a hora/);
  assert.match(system, /investimentos no Paraguai/);
  assert.match(system, /online ou presencial/);
  assert.match(system, /JÁ É CLIENTE da Migra não paga/);
  assert.match(system, /pagamento vem ANTES do agendamento, no Pix ou no cartão/);
  assert.match(system, /Você nunca confirma nem sugere data ou horário/);
  assert.match(system, /até que dia a mentoria precisa ser agendada/);
  assert.match(system, /Quem escolhe o dia e o horário é a equipe do Marcos, não o cliente/);
  assert.match(system, /assessoria do Marcos escolhe o dia e o horário na agenda dele, dentro do prazo, e confirma por aqui com o cliente/);
  assert.match(system, /Não prometa lucro/);
  store.updateSettings({ crm: { mentoring: { enabled: false } } });
  await agent.think(conv);
  assert.doesNotMatch(system, /Mentoria com o Marcos Miguel/);
});

test('Instagram: a atendente não usa menu de planos, trata botões como interesse e nunca diz que é o Marcos', async () => {
  const store = tempStore();
  store.updateSettings(presetSettings('migra-paraguai'));
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  const seen = [];
  const llm = { configured: true, chat: async ({ messages }) => { seen.push(messages[0].content); return { content: 'Oi!', tool_calls: [] }; } };
  const agent = new Agent({ store, llm, now: () => new Date(2026, 9, 26, 9, 5) });
  const ig = agent.conversation('ig:123');
  agent.remember(ig, 'user', 'Quero saber o valor');
  await agent.think(ig);
  assert.match(seen[0], /NUNCA liste os planos como menu/);
  assert.match(seen[0], /botões automáticos de comentário/);
  assert.match(seen[0], /Nunca diga que você é o Marcos Miguel/);
  const wa = agent.conversation('5511999990000@s.whatsapp.net');
  agent.remember(wa, 'user', 'Oi');
  await agent.think(wa);
  assert.doesNotMatch(seen.at(-1), /Instagram: conversa humana/);
});

test('Instagram → WhatsApp: o link leva o código da pessoa e a atendente ganha o histórico do Instagram', async () => {
  const { Auth } = await import('../src/auth.js');
  const { Crm } = await import('../src/crm.js');
  const store = tempStore();
  store.updateSettings(presetSettings('migra-paraguai'));
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  const auth = new Auth({ store, dataDir: store.dataDir });
  const crm = new Crm({ store, auth });
  const llm = { configured: true, chat: async () => ({ content: 'Oi!', tool_calls: [] }) };
  const agent = new Agent({ store, llm, now: () => new Date(2026, 9, 26, 9, 5) });
  // Conversa no Instagram: vira prospecto com código.
  const ig = agent.conversation('ig:555');
  agent.remember(ig, 'user', 'Quero abrir um restaurante em Ciudad del Este');
  const lead = crm.ensureFromConversation({ key: ig.key, name: 'Magda', username: 'magda.ataide', channel: 'instagram' });
  agent.whatsappLink = (conv) => `https://wa.me/595981000000?text=${encodeURIComponent(`Oi! Vim do Instagram da Migra (${crm.findForConversation({ key: conv.key }).code}).`)}`;
  await agent.think(ig);
  const seen = [];
  agent.llm.chat = async ({ messages }) => { seen.push(messages[0].content); return { content: 'Oi!', tool_calls: [] }; };
  await agent.think(ig);
  assert.match(seen[0], new RegExp(`wa\\.me/595981000000\\?text=.*${lead.code}`), 'o link do WhatsApp leva o código');
  assert.match(seen[0], /tocar neste link/);
  // A pessoa toca no link: a primeira mensagem no WhatsApp principal traz o código e liga as conversas.
  const waKey = '5545988887777@s.whatsapp.net';
  const linked = crm.linkByCode({ text: `Oi! Vim do Instagram da Migra (${lead.code}).`, key: waKey, phone: '5545988887777' });
  assert.equal(linked.id, lead.id);
  assert.equal(crm.findForConversation({ key: waKey, phone: '5545988887777' }).id, lead.id, 'o WhatsApp passa a ser o mesmo prospecto');
  assert.equal(lead.conversationKey, 'ig:555', 'o histórico do Instagram continua guardado');
  assert.equal(lead.phone, '5545988887777');
});

test('quem pede para falar direto com o Marcos não vira visita: a instrução das visitas manda para a mentoria', async () => {
  const store = tempStore();
  store.updateSettings(presetSettings('migra-paraguai'));
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  let system = '';
  let tools = [];
  const llm = { configured: true, chat: async (req) => { system = req.messages[0].content; tools = req.tools.map((t) => t.function.name); return { content: 'Ok', tool_calls: [] }; } };
  const agent = new Agent({ store, llm, now: () => new Date(2026, 9, 26, 9, 5) });
  agent.requestVisit = async () => ({ ok: true });
  agent.notifyOwner = async () => ({ ok: true });
  agent.bookMentoring = async () => ({ ok: true });
  const conv = agent.conversation('5511999990000@s.whatsapp.net');
  agent.remember(conv, 'user', 'Quero falar direto com o Marcos');
  await agent.think(conv);
  assert.match(system, /quem quer falar direto com o Marcos Miguel NÃO é visita ao escritório/);
  assert.match(system, /nunca registre visita para ele/);
  assert.doesNotMatch(system, /ou pede para falar com o Marcos/);
  assert.ok(tools.includes('reservar_mentoria') && tools.includes('agendar_visita_escritorio'));
});

test('visita ao escritório e mentoria com o Marcos são separadas, e quem já é cliente não paga nenhuma', async () => {
  const store = tempStore();
  store.updateSettings(presetSettings('migra-paraguai'));
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  let system = '';
  const llm = { configured: true, chat: async (req) => { system = req.messages[0].content; return { content: 'Ok', tool_calls: [] }; } };
  const agent = new Agent({ store, llm, now: () => new Date(2026, 9, 26, 9, 5) });
  agent.requestVisit = async () => ({ ok: true });
  agent.notifyOwner = async () => ({ ok: true });
  agent.bookMentoring = async () => ({ ok: true });
  agent.isClient = () => false;
  const conv = agent.conversation('5511999990000@s.whatsapp.net');
  agent.remember(conv, 'user', 'Quero ir aí falar com o Marcos');
  await agent.think(conv);
  assert.match(system, /são DUAS coisas diferentes/);
  assert.match(system, /atendido por um dos CONSULTORES da equipe, não pelo Marcos/);
  assert.match(system, /DIRETAMENTE com o Marcos Miguel \(online ou presencial\), 250 dólares americanos/);
  assert.match(system, /Nunca deixe o cliente achar que a taxa da visita é para falar com o Marcos/);
  assert.match(system, /Deixe claro que a visita é com um dos CONSULTORES/);
  assert.match(system, /taxa de reserva de R\$ 150,00 paga antes pelo Pix/);
  assert.doesNotMatch(system, /ESTE CLIENTE JÁ É CLIENTE/);
  // Cliente com reserva paga: nenhum dos dois agendamentos tem custo.
  agent.isClient = () => true;
  await agent.think(conv);
  assert.match(system, /ESTE CLIENTE JÁ É CLIENTE: não fale de taxa nem de valor, é sem custo/);
  assert.match(system, /este cliente já é cliente da Migra: NÃO fale de taxa/);
});

test('mentoria com o Marcos nunca é estornada; só a taxa da visita volta se o cliente fechar', async () => {
  const { Agent } = await import('../src/agent/agent.js');
  const store = tempStore();
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  let system = '';
  const llm = { configured: true, chat: async ({ messages }) => { system = messages[0].content; return { content: 'Oi!', tool_calls: [] }; } };
  const agent = new Agent({ store, llm });
  agent.notifyOwner = async () => ({ ok: true });
  agent.requestVisit = async () => ({ ok: true });
  const conv = agent.conversation('5511999990000@s.whatsapp.net');
  agent.remember(conv, 'user', 'Oi');
  await agent.think(conv);
  assert.match(system, /NÃO é devolvido nem estornado em nenhum caso/);
  assert.match(system, /nunca diga que o valor da mentoria é devolvido/);
});

test('atendente: gatilhos para quem compara preço menor ou quer fazer sozinho, sem prometer resultado nem atacar ninguém', async () => {
  const { Agent } = await import('../src/agent/agent.js');
  const store = tempStore();
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  let system = '';
  const llm = { configured: true, chat: async ({ messages }) => { system = messages[0].content; return { content: 'Oi!', tool_calls: [] }; } };
  const agent = new Agent({ store, llm });
  const conv = agent.conversation('5511999990000@s.whatsapp.net');
  agent.remember(conv, 'user', 'Vi outro profissional cobrando mais barato');
  await agent.think(conv);
  assert.match(system, /Cliente que compara com preço menor/);
  assert.match(system, /Custo total, não preço inicial/);
  assert.match(system, /Aversão à perda/);
  assert.match(system, /NUNCA prometa aprovação, prazo ou resultado/);
  assert.match(system, /nada de falar mal de concorrente pelo nome/);
  assert.match(system, /Confie pelos erros, não pelas promessas/);
  assert.match(system, /NUNCA transforme isso em "100% de aprovação"/);
  assert.match(system, /milhares, sem inventar número|milhares de pessoas \(diga "milhares", sem inventar número\)/);
});

test('atendente: amarra a decisão (depende de outra pessoa → chamada de vídeo com o casal) e a oferta do aplicativo só vale até a data escolhida', async () => {
  const { Agent } = await import('../src/agent/agent.js');
  const make = (validUntil, extra = {}) => {
    const store = tempStore();
    store.updateSettings({ agent: { enabled: true, audience: 'all' }, crm: { appOffer: { enabled: true, regularPrice: 59.99, discountPct: 50, months: 6, period: 'por mês', validUntil, ...extra } } });
    const box = { system: '' };
    const llm = { configured: true, chat: async ({ messages }) => { box.system = messages[0].content; return { content: 'Oi!', tool_calls: [] }; } };
    const agent = new Agent({ store, llm, now: () => new Date(2026, 10, 3, 10, 0) }); // 03/11/2026
    agent.routeSector = async () => ({ ok: true });
    const conv = agent.conversation('5511999990000@s.whatsapp.net');
    agent.remember(conv, 'user', 'Preciso falar com minha esposa');
    return { agent, conv, box };
  };
  const on = make('2026-11-04');
  await on.agent.think(on.conv);
  assert.match(on.box.system, /Depende só de você ou de mais alguém/);
  assert.match(on.box.system, /chamada de vídeo \(ou ligação\) com um dos nossos consultores/);
  assert.match(on.box.system, /CHAMADA DE VÍDEO\/VOZ com \[quem decide\]/);
  assert.match(on.box.system, /vender um carro, receber um dinheiro/);
  assert.match(on.box.system, /grande família/);
  assert.match(on.box.system, /Oferta especial do aplicativo/);
  assert.match(on.box.system, /até 04\/11\/2026/);
  assert.match(on.box.system, /de R\$ 59,99 por mês por R\$ 29,99 por mês \(economia de R\$ 180,00 em 6 meses\)/);
  assert.match(on.box.system, /AINDA ESTÁ EM DESENVOLVIMENTO/);
  assert.match(on.box.system, /forma conversacional/);
  assert.match(on.box.system, /EFETUAR O PAGAMENTO DA RESERVA dentro do prazo/);
  assert.match(on.box.system, /ÚLTIMA carta, só no final/);
  assert.match(on.box.system, /SÓ DEPOIS de tudo isso/);
  assert.match(on.box.system, /Nunca na primeira conversa/);
  assert.match(on.box.system, /esse valor é acessível\? Você tem ele disponível ou precisa se preparar\? Tem em caixa/);
  assert.match(on.box.system, /INICIAR A DOCUMENTAÇÃO do titular e dos filhos/);
  assert.doesNotMatch(on.box.system, /BRINDE/, 'sem brinde cadastrado, a atendente não fala de brinde');
  const gift = make('2026-11-04', { gift: 'um guia de bolso do Paraguai' });
  await gift.agent.think(gift.conv);
  assert.match(gift.box.system, /BRINDE: junto com a oferta, quem fechar HOJE ganha ainda um brinde escolhido pelo Marcos: um guia de bolso do Paraguai/);
  const today = make('2026-11-03');
  await today.agent.think(today.conv);
  assert.match(today.box.system, /Oferta especial do aplicativo/, 'vale até o fim do dia da data escolhida');
  const expired = make('2026-11-02');
  await expired.agent.think(expired.conv);
  assert.doesNotMatch(expired.box.system, /Oferta especial do aplicativo/, 'data vencida: a oferta some sozinha, sem prazo falso');
  const noDate = make('');
  await noDate.agent.think(noDate.conv);
  assert.doesNotMatch(noDate.box.system, /Oferta especial do aplicativo/, 'sem data, sem oferta');
  const off = make('2026-11-04', { enabled: false });
  await off.agent.think(off.conv);
  assert.doesNotMatch(off.box.system, /Oferta especial do aplicativo/);
});

test('oferta de Natal já vem configurada até 25/12/2026 e some sozinha depois', async () => {
  const { Agent } = await import('../src/agent/agent.js');
  const store = tempStore();
  assert.equal(store.settings.crm.appOffer.validUntil, '2026-12-25');
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  const run = async (date) => {
    let system = '';
    const llm = { configured: true, chat: async ({ messages }) => { system = messages[0].content; return { content: 'Oi!', tool_calls: [] }; } };
    const agent = new Agent({ store, llm, now: () => date });
    const conv = agent.conversation(`55119${date.getDate()}@s.whatsapp.net`);
    agent.remember(conv, 'user', 'Oi');
    await agent.think(conv);
    return system;
  };
  assert.match(await run(new Date(2026, 11, 25, 20, 0)), /até 25\/12\/2026/, 'no dia 25 ainda vale');
  assert.doesNotMatch(await run(new Date(2026, 11, 26, 9, 0)), /Oferta especial do aplicativo/, 'dia 26: acabou');
});
