import test from 'node:test';
import assert from 'node:assert/strict';
import { makeContractFlow, contractReady } from '../src/autocontract.js';

const DATA = { nome: 'Luiza Fernandes da Silva', cpf: '529.982.247-25', nacionalidade: 'Brasileira', estadoCivil: 'Casado(a)', rua: 'Rua A', numero: '10', cidade: 'Cascavel', uf: 'PR', rg: '123', adultos: '2' };

function setup({ quote = true, form = null, base = 'https://migra.exemplo.com' } = {}) {
  const sent = [];
  const notes = [];
  const audits = [];
  const lead = { id: 'L1', name: 'Luiza', phone: '5545988887777' };
  const quotes = quote ? [{ id: 'q1', number: 'ORC-2026-09767', convKey: '5545988887777', leadId: 'L1', phone: '5545988887777', items: [{ name: 'Ouro', qty: 2 }], plan: { adults: 2 } }] : [];
  const forms = form ? [form] : [];
  const deps = {
    store: { save() {} },
    crm: {
      findForConversation: () => lead,
      ensureFromConversation: () => lead,
      addNote: (_u, id, text) => notes.push(text),
    },
    closing: {
      get list() { return forms; },
      forLead: () => forms.at(-1) || null,
      forConversation: () => forms.at(-1) || null,
      createForm: ({ convKey }) => { const f = { id: `f${forms.length + 1}`, convKey, status: 'enviada' }; forms.push(f); return f; },
      formUrl: (f) => `https://migra.exemplo.com/ficha/${f.id}`,
    },
    auth: { get: () => null },
    lines: { get: () => null },
    parseLineKey: () => null,
    samePhone: (a, b) => a === b,
    pickClient: (d) => ({ ...d }),
    publicBase: () => base,
    quotes: () => quotes,
    prepare: (q, client) => {
      q.contract = { client, status: 'enviado' };
      return { url: `https://migra.exemplo.com/contrato/${q.id}`, text: `${client.nome.split(' ')[0]}, preparei o seu contrato: https://migra.exemplo.com/contrato/${q.id}` };
    },
    makeQuote: async ({ items, convKey }) => { const q = { id: 'q2', number: 'ORC-2026-09768', convKey, leadId: 'L1', items: items.map((i) => ({ name: i.pacote, qty: i.quantidade })), plan: { adults: 1 } }; quotes.push(q); return q; },
    say: async (key, text) => sent.push({ key, text }),
    audit: (t) => audits.push(t),
  };
  const conv = { key: '5545988887777', phone: '5545988887777', name: 'Luiza' };
  return { flow: makeContractFlow(deps), conv, sent, notes, audits, lead, forms, quotes };
}

test('dados completos na ficha: contrato gerado e link enviado na hora pela IA', async () => {
  const { flow, conv, sent, notes, audits, quotes } = setup({ form: { id: 'f0', convKey: '5545988887777', status: 'preenchida', data: DATA } });
  const r = await flow.sendContract(conv, {});
  assert.equal(r.enviado, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Luiza, preparei o seu contrato: https:\/\/migra\.exemplo\.com\/contrato\/q1/);
  assert.equal(quotes[0].contract.client.cpf, '529.982.247-25');
  assert.match(notes[0], /CT-2026-09767 gerado e enviado pela IA/);
  assert.match(audits[0], /CT-2026-09767 · Luiza Fernandes da Silva/);
});

test('sem os dados: manda a ficha, marca o pedido e o contrato sai depois que ela é preenchida', async () => {
  const { flow, conv, sent, lead, forms, quotes } = setup();
  const r = await flow.sendContract(conv, {});
  assert.equal(r.precisaDados, true);
  assert.equal(r.link, 'https://migra.exemplo.com/ficha/f1');
  assert.equal(sent.length, 0, 'nenhum contrato vazio é enviado');
  assert.equal(forms[0].contractRequested, true);
  assert.equal(lead.contractRequested, true);
  // Pedir de novo reaproveita a mesma ficha (não cria outra).
  await flow.sendContract(conv, {});
  assert.equal(forms.length, 1);
  // Ficha preenchida (o servidor chama isto logo depois de refazer o orçamento com o nome completo).
  Object.assign(forms[0], { status: 'preenchida', data: DATA });
  await flow.sendContractTo({ convKey: conv.key, lead, quote: quotes[0], client: DATA });
  assert.equal(sent.length, 1);
  assert.equal(lead.contractRequested, false);
  assert.equal(forms[0].contractRequested, false);
});

test('sem orçamento: pede o pacote; com o pacote, faz o orçamento e segue para o contrato', async () => {
  const { flow, conv, quotes } = setup({ quote: false, form: { id: 'f0', convKey: '5545988887777', status: 'preenchida', data: DATA } });
  const r1 = await flow.sendContract(conv, {});
  assert.match(r1.erro, /Pergunte o pacote/);
  const r2 = await flow.sendContract(conv, { itens: [{ pacote: 'Prata', quantidade: 1 }] });
  assert.equal(r2.enviado, true);
  assert.equal(quotes[0].number, 'ORC-2026-09768');
  assert.equal(quotes[0].contract.client.nome, DATA.nome);
});

test('contrato já assinado, sem endereço na internet e simulação não mandam nada', async () => {
  const signed = setup({ form: { id: 'f0', convKey: '5545988887777', status: 'preenchida', data: DATA } });
  signed.quotes[0].contract = { status: 'assinado', client: DATA };
  const r = await signed.flow.sendContract(signed.conv, {});
  assert.equal(r.jaAssinado, true);
  assert.equal(signed.sent.length, 0);
  const offline = setup({ base: '' });
  assert.match((await offline.flow.sendContract(offline.conv, {})).erro, /endereço na internet/);
  const sim = setup();
  assert.equal((await sim.flow.sendContract({ key: 'sim:1' }, {})).simulacao, true);
  assert.equal(sim.sent.length, 0);
});

test('contrato só com dados completos (nome, CPF, nacionalidade, estado civil e endereço)', () => {
  assert.equal(contractReady(DATA), true);
  assert.equal(contractReady({ ...DATA, cpf: '' }), false);
  assert.equal(contractReady({ nome: 'Luiza' }), false);
  assert.equal(contractReady(null), false);
});
