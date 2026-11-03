import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Agent } from '../src/agent/agent.js';
import { LocalCalendar } from '../src/agent/calendar.js';
import { presetSettings } from '../src/agent/presets.js';
import { TOOL_DEFINITIONS, runTool } from '../src/agent/tools.js';
import { Resumes, THANKS } from '../src/resumes.js';
import { tempStore } from './helpers.js';

const PDF = Buffer.from('%PDF-1.4 curriculo de teste do candidato');

test('currículos: guarda o contato, recebe o arquivo certo, recusa o falso e agradece sem avisar ninguém', async () => {
  const store = tempStore();
  const sent = []; const memory = [];
  let next = PDF;
  const r = new Resumes({ store, dataDir: store.dataDir, download: async () => next, send: async (jid, p) => sent.push({ jid, ...p }), remember: (c, role, text) => memory.push([role, text]) });
  const conv = { key: '5511999@s.whatsapp.net', phone: '5511999', name: 'João' };
  const rec = r.register(conv, { nome: 'João Silva', interesse: 'vendedor', resumo: 'Tem 3 anos de experiência.' });
  assert.equal(rec.status, 'novo');
  assert.equal(r.register(conv, { interesse: 'corretor' }).id, rec.id, 'uma pessoa, um registro');
  assert.ok(conv.candidate);
  const msg = (extra) => ({ jid: conv.key, hasImage: false, documentMime: 'application/pdf', ...extra });
  assert.equal(r.wants(msg(), { key: 'x' }), false, 'conversa que não é de candidato não entra');
  assert.equal(r.wants(msg({ isGroup: true }), conv), false);
  assert.equal(r.wants(msg({ channel: 'instagram' }), conv), false);
  assert.equal(r.wants(msg(), conv), true);
  await r.handle(msg(), conv);
  assert.equal(sent[0].text, THANKS);
  assert.match(sent[0].text, /banco de dados/);
  const saved = r.list[0];
  assert.equal(saved.files.length, 1);
  assert.equal(saved.status, 'recebido');
  assert.ok(fs.readFileSync(r.filePath(saved.id, saved.files[0].id).path).equals(PDF));
  // arquivo disfarçado de PDF
  next = Buffer.from('<script>alert(1)</script>');
  await r.handle(msg(), conv);
  assert.match(sent[1].text, /não consigo guardar/);
  assert.equal(r.list[0].files.length, 1);
  // vencido (30 dias): volta a ser conversa normal
  conv.candidate.at = new Date(Date.now() - 31 * 86400000).toISOString();
  assert.equal(r.wants(msg(), conv), false);
  // situação, planilha segura e exclusão (apaga o arquivo)
  assert.equal(r.update(rec.id, { status: 'chamar' }).status, 'chamar');
  assert.throws(() => r.update(rec.id, { status: 'x' }), /inválida/);
  r.register({ key: 'k2', phone: '1', name: '=cmd|calc' }, { interesse: '+HYPERLINK' });
  assert.match(r.csv(), /"'=cmd\|calc"/);
  const path = r.filePath(rec.id, saved.files[0].id).path;
  r.remove(rec.id);
  assert.equal(fs.existsSync(path), false);
  assert.equal(r.list.length, 1);
});

test('vagas: a atendente não manda candidato para o Marcos nem para parceiros; só registra e responde que as vagas foram preenchidas', async () => {
  // ferramenta nova e a de avisar sem a opção "contratação"
  const avisar = TOOL_DEFINITIONS.find((t) => t.function.name === 'avisar_marcos').function;
  assert.ok(!avisar.parameters.properties.assunto.enum.includes('contratação'));
  assert.ok(!/trabalhar na Migra/.test(avisar.description));
  assert.ok(TOOL_DEFINITIONS.some((t) => t.function.name === 'registrar_candidato'));
  let got = null;
  const out = await runTool('registrar_candidato', { interesse: 'vendedor' }, { onCandidate: async (a) => { got = a; return { ok: true }; } });
  assert.deepEqual([out.ok, got.interesse], [true, 'vendedor']);
  // o texto do sistema carrega a regra da direção
  const store = tempStore();
  store.updateSettings(presetSettings('clinica-sorriso'));
  store.updateSettings({ agent: { enabled: true, audience: 'all' } });
  const NOW = new Date(2026, 9, 26, 9, 5);
  let system = '';
  const llm = { configured: true, async chat({ messages, tools }) { system = messages[0].content; this.tools = tools.map((t) => t.function.name); return { content: 'ok', tool_calls: [] }; } };
  const agent = new Agent({ store, llm, calendar: new LocalCalendar({ store, getConfig: () => store.settings.agenda, now: () => NOW }), now: () => NOW });
  agent.registerCandidate = async () => ({ ok: true });
  agent.notifyOwner = async () => ({ ok: true });
  agent.routeSector = async () => ({ ok: true });
  await agent.handleIncoming({ key: 'k9', phone: '5511999990000', name: 'Pedro', text: 'Vocês têm vaga de vendedor?' }, async () => {});
  assert.match(system, /Vagas e currículos/);
  assert.match(system, /todas as vagas de vendedor já foram preenchidas \(eram apenas 3 vagas/);
  assert.match(system, /NÃO encaminhe para o Marcos/);
  assert.ok(llm.tools.includes('registrar_candidato'));
  assert.doesNotMatch(system, /use avisar_marcos com assunto "contratação"/);
});
