import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineDiagnosis, diagnosisText, registerDiagnosticoNumeroRoutes } from '../src/routes/diagnostico-numero.js';
import { parseCommand } from '../src/seller-commands.js';

const NOW = Date.parse('2026-11-13T16:00:00Z');
function ctx({ line = {}, settings = {}, connected = true, active = true, inHours = true, convs = {}, logs = [], why = () => [] } = {}) {
  return {
    store: { settings: { autoReplyEnabled: true, agent: { enabled: true, audience: 'all' }, ...settings }, data: { conversations: convs, logs } },
    agent: { active, accountLocks: new Map() },
    wa: { isConnected: () => connected, humanWaitMs: () => 0 },
    lines: { list: () => [{ id: 'mand', label: 'Manderson', agent: true, ...line }], byOwner: (id) => (id === 'u1' ? { id: 'mand' } : null) },
    pending: { status: () => ({ bySender: [{ key: 'linha:mand', waiting: 2, queued: 1 }] }) },
    isWithinWorkHours: () => inHours,
    convWhyNot: why,
    now: () => NOW,
  };
}

test('tudo certo: sem problemas e mostra a fila do número', () => {
  const d = lineDiagnosis(ctx(), 'mand');
  assert.equal(d.problemas, 0);
  assert.ok(d.linhas.some((l) => /IA deste número: LIGADA/.test(l)));
  assert.ok(d.linhas.some((l) => /2 esperando/.test(l)));
  assert.match(diagnosisText('Manderson', d), /Tudo certo/);
});

test('aponta cada trava: desconectado, IA do número desligada, modo de teste, fora do horário, agente sem chave', () => {
  const d = lineDiagnosis(ctx({ connected: false, line: { agent: false }, settings: { agent: { enabled: true, audience: 'test' } }, inHours: false, active: false }), 'mand');
  const t = d.linhas.join('\n');
  for (const re of [/DESCONECTADO/, /IA deste número: DESLIGADA/, /MODO DE TESTE/, /Fora do horário/, /Agente de IA geral DESLIGADO/]) assert.match(t, re);
  assert.equal(d.problemas, 5);
});

test('lista os clientes sem resposta do número com o motivo e os erros recentes', () => {
  const convs = {
    'l:mand:5527999568520@s.whatsapp.net': { key: 'l:mand:5527999568520@s.whatsapp.net', phone: '5527999568520', name: '', updatedAt: '2026-11-13T15:16:00Z', messages: [{ role: 'user', content: 'Olá Manderson, vim pela Central', at: '2026-11-13T15:16:00Z' }] },
    'l:mand:5569900000000@s.whatsapp.net': { key: 'l:mand:5569900000000@s.whatsapp.net', phone: '5569900000000', updatedAt: '2026-11-13T15:00:00Z', messages: [{ role: 'user', content: 'oi', at: '2026-11-13T14:00:00Z' }, { role: 'assistant', content: 'olá', at: '2026-11-13T14:01:00Z' }] },
    'l:outro:5511911111111@s.whatsapp.net': { key: 'l:outro:5511911111111@s.whatsapp.net', phone: '5511911111111', messages: [{ role: 'user', content: 'x', at: '2026-11-13T15:00:00Z' }] },
  };
  const logs = [{ at: '2026-11-13T15:30:00Z', type: 'error', phone: '5527999568520', message: 'Agente IA: limite da chave' }];
  const d = lineDiagnosis(ctx({ convs, logs, why: () => ['Pausada: Você respondeu pelo celular.'] }), 'mand');
  const t = d.linhas.join('\n');
  assert.match(t, /\+5527999568520 \(há 44 min\): Pausada/);
  assert.ok(!/5569900000000/.test(t), 'quem já foi respondido não aparece');
  assert.ok(!/5511911111111/.test(t), 'outro número não aparece');
  assert.match(t, /limite da chave/);
});

test('rota: cada um só vê o próprio número; /diagnostico é reconhecido como atalho', () => {
  const routes = {};
  registerDiagnosticoNumeroRoutes({ get: (p, h) => { routes[p] = h; } }, ctx());
  let out; routes['/api/diagnostico-numero']({ user: { id: 'u1' } }, { json: (x) => { out = x; } });
  assert.ok(out.linhas.length > 3);
  routes['/api/diagnostico-numero']({ user: { id: 'x' } }, { json: (x) => { out = x; } });
  assert.match(out.linhas[0], /não tem um WhatsApp/);
  assert.equal(parseCommand('/diagnostico').cmd, 'diagnostico');
  assert.equal(parseCommand('/diag').cmd, 'diagnostico');
});
