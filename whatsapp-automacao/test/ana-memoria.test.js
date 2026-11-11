import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Personal } from '../src/personal.js';
import { Ana } from '../src/ana.js';
import { tempStore } from './helpers.js';

function setup() {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const now = () => new Date(2026, 10, 11, 10, 0, 0);
  const manderson = auth.get(auth.create({ name: 'Manderson Genelhud', login: 'manderson', password: 'segredo123', role: 'admin', whatsapp: '595981111111' }).id);
  const marcos = auth.get(auth.create({ name: 'Marcos Miguel', login: 'marcos', password: 'segredo123', role: 'admin', whatsapp: '595982222222' }).id);
  const personal = new Personal({ store, now });
  const ana = new Ana({ store, auth, personal, now });
  return { ana, personal, manderson, marcos };
}

test('lembrete para daqui a 1 ano e daqui a 10 anos é aceito', async () => {
  const { ana, manderson, personal } = setup();
  const r1 = await ana.process(manderson, 'me lembre de renovar o passaporte daqui a 1 ano', {});
  const r2 = await ana.process(manderson, 'me lembre de revisar o testamento daqui a 10 anos', {});
  assert.match(String(r1.text || r1), /✅|Pronto|Anotado|lembre/i);
  assert.match(String(r2.text || r2), /2036/);
  const items = personal.agenda(manderson.id, '2026-11-12', '2037-01-01');
  assert.ok(items.some((i) => i.date === '2036-11-11'), 'lembrete de 10 anos gravado');
});

test('memória: guarda a nota e acha depois, cada pessoa na sua pasta', async () => {
  const { ana, manderson, marcos } = setup();
  const r = await ana.process(manderson, 'anote que o seguro do carro vence em março e a corretora é a Lúcia', {});
  assert.match(String(r.text || r), /Guardei na sua memória/);
  const f = await ana.process(manderson, 'o que eu anotei sobre seguro?', {});
  assert.match(String(f.text || f), /corretora é a Lúcia/);
  const outro = await ana.process(marcos, 'o que eu anotei sobre seguro?', {});
  assert.doesNotMatch(String(outro.text || outro), /Lúcia/, 'a pasta do Marcos não enxerga a do Manderson');
});

test('memória nunca guarda senha, código nem cartão', async () => {
  const { ana, manderson, personal } = setup();
  const a = await ana.process(manderson, 'anote que a senha do banco é 12345', {});
  const b = await ana.process(manderson, 'anote que o cartão é 4111 1111 1111 1111', {});
  assert.match(String(a.text || a), /não guardo senhas/);
  assert.match(String(b.text || b), /não guardo senhas/);
  assert.equal(personal.noteCount(manderson.id), 0);
});
