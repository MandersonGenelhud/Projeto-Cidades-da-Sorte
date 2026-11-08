import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildClosings, classifyObjections } from '../src/fechamentos.js';
import { buildPlanPdf, loadPlanPdf, planPdfPrice, planPdfFile } from '../src/plano-pdf.js';
import { SALES_PLAYBOOK } from '../src/agent/vendas-playbook.js';
import { TOOL_DEFINITIONS } from '../src/agent/tools.js';
import { buildClosedIndex } from '../src/outreach-guard.js';
import { tempStore } from './helpers.js';

const NOW = Date.parse('2026-11-08T15:00:00Z');
const at = (h) => new Date(NOW - h * 3_600_000).toISOString();
const mk = (key, msgs, extra = {}) => ({ key, phone: key, name: `Cliente ${key.slice(-2)}`, messages: msgs.map(([role, content, h]) => ({ role, content, at: at(h) })), ...extra });
const quote = (key, n, extra = {}) => ({ id: `q${n}`, number: `ORC-${n}`, convKey: key, createdAt: at(48), plan: { total: 12997 }, client: 'X', ...extra });

test('painel de fechamentos: percentual só sobre quem continuou depois do orçamento; checklist e próximo passo por etapa', () => {
  const store = { data: { conversations: {}, closing: [{ convKey: '5511900000002', status: 'preenchida' }] } };
  const convs = [
    mk('5511900000001', [['assistant', 'orçamento', 48], ['user', 'obrigado', 40]], { qualificacao: { capacidade: 'sim' } }),
    mk('5511900000002', [['assistant', 'orçamento', 48], ['user', 'quero, mas está caro', 40]], { qualificacao: { capacidade: 'parcial', objecoes: 'valor' } }),
    mk('5511900000003', [['assistant', 'orçamento', 48], ['user', 'não tenho o valor agora', 30]], { qualificacao: { capacidade: 'nao', evidencia: 'sem dinheiro' } }),
    mk('5511900000004', [['assistant', 'orçamento', 48]]),                                                   // só recebeu o PDF
    mk('5511900000005', [['assistant', 'orçamento', 48], ['user', 'vou falar com minha esposa', 20], ['assistant', 'ok', 19]]),
  ];
  for (const c of convs) store.data.conversations[c.key] = c;
  const quotes = convs.map((c, i) => quote(c.key, i + 1));
  quotes[0].contract = { status: 'assinado' };
  const payments = [{ status: 'paid', convKey: '5511900000001' }, { status: 'paid', purpose: 'plano_pdf', convKey: '5511900000003' }];
  const r = buildClosings({ store, quotes, payments, now: NOW });
  assert.equal(r.orcamentos, 5);
  assert.equal(r.semResposta, 1);
  assert.equal(r.continuaram, 4);
  assert.equal(r.pagos, 1);
  assert.equal(r.taxaFechamento, 25, '1 de 4 que continuaram (não 1 de 5 orçamentos)');
  assert.equal(r.planoPdf, 1);
  assert.equal(r.semCondicoes, 1);
  assert.equal(r.ficha, 2, 'ficha preenchida ou além');
  const open = r.checklist.filter((x) => x.aberto);
  assert.equal(open.length, 2, 'os que fecharam ou compraram o plano saem do acompanhamento');
  assert.match(open[0].proximo, /assinar/i, 'quem já preencheu a ficha vem primeiro');
  const pre = r.radar.find((o) => o.id === 'preco'); assert.equal(pre.total, 1); assert.equal(pre.fechou, 0);
  assert.equal(r.radar.find((o) => o.id === 'familia').total, 1);
  assert.equal(r.radar.find((o) => o.id === 'dinheiro').total, 1);
});

test('objeções são classificadas pelo que o cliente escreve', () => {
  assert.deepEqual(classifyObjections('Tá muito caro, vou pensar'), ['preco', 'pensar']);
  assert.ok(classifyObjections('preciso falar com a minha esposa').includes('familia'));
  assert.ok(classifyObjections('Não tenho o valor agora').includes('dinheiro'));
  assert.deepEqual(classifyObjections('quero começar'), []);
});

test('plano em PDF: valor padrão R$ 500, PDF-base válido, e o arquivo oficial tem prioridade', () => {
  assert.equal(planPdfPrice({}), 500);
  assert.equal(planPdfPrice({ crm: { planPdf: { price: 350 } } }), 350);
  const b = buildPlanPdf({ company: 'Migra' });
  assert.equal(b.slice(0, 5).toString(), '%PDF-');
  const store = tempStore();
  assert.equal(loadPlanPdf({ dataDir: store.dataDir }).official, false);
  fs.writeFileSync(planPdfFile(store.dataDir), Buffer.from('%PDF-1.4 oficial'));
  const r = loadPlanPdf({ dataDir: store.dataDir });
  assert.equal(r.official, true);
  assert.match(r.buffer.toString(), /oficial/);
});

test('método de vendas e plano em PDF: ferramenta existe, playbook cobre condições, objeções e o degrau sem condições', () => {
  assert.ok(TOOL_DEFINITIONS.some((t) => t.function.name === 'oferecer_plano_pdf'));
  assert.match(SALES_PLAYBOOK, /OUVIR/);
  assert.match(SALES_PLAYBOOK, /TEM CONDIÇÕES/);
  assert.match(SALES_PLAYBOOK, /oferecer_plano_pdf/);
  assert.match(SALES_PLAYBOOK, /Nunca mande o PDF antes do pagamento confirmado/);
  assert.match(SALES_PLAYBOOK, /Nunca invente urgência|Nunca invente/);
});

test('Pix de serviço avulso (plano em PDF, mentoria) NÃO conta como "já fechou conosco"', () => {
  const dir = { people: [{ phones: ['5511900000009'], cpfs: [], items: [{ kind: 'Pix avulso', status: 'pago' }] }, { phones: ['5511900000010'], cpfs: [], items: [{ kind: 'Pix', status: 'pago' }] }] };
  const idx = buildClosedIndex(dir);
  assert.equal(idx.closedFor({ phone: '5511900000009' }), '');
  assert.equal(idx.closedFor({ phone: '5511900000010' }), 'Pix pago');
});
