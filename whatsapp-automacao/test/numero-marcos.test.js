import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { Auth } from '../src/auth.js';
import { tempStore } from './helpers.js';

test('cada WhatsApp é de uma pessoa só: não deixa cadastrar o mesmo número em duas pessoas', () => {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  auth.create({ name: 'Silvani', login: 'silvani', password: 'segredo123', role: 'seller', whatsapp: '+595 982 543 275' });
  assert.throws(() => auth.create({ name: 'Marcos Miguel', login: 'marcos', password: 'segredo123', role: 'admin', whatsapp: '595982543275' }), /já está no cadastro de Silvani/);
  const m = auth.create({ name: 'Marcos Miguel', login: 'marcos', password: 'segredo123', role: 'admin' });
  assert.throws(() => auth.update(m.id, { whatsapp: '595982543275' }), /já está no cadastro de Silvani/);
});

test('número novo do Marcos: sai do cadastro de quem estava, vai para o Marcos e vira o número do dono (uma vez só)', () => {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const marcos = auth.create({ name: 'Marcos Miguel', login: 'marcos', password: 'segredo123', role: 'admin', whatsapp: '5545999990001' });
  const silvani = auth.create({ name: 'Silvani Miguel', login: 'silvani', password: 'segredo123', role: 'seller', whatsapp: '595982543275' });
  store.data.marcosNovo2026 = false;
  store.flush();
  const s2 = new Store(store.dataDir);
  const a2 = new Auth({ store: s2, dataDir: s2.dataDir });
  assert.equal(a2.get(marcos.id).whatsapp, '595982543275');
  assert.equal(a2.get(silvani.id).whatsapp, '');
  assert.equal(s2.settings.crm.ownerPhone, '595982543275');
  const raw = s2.data.users.find((u) => u.id === silvani.id);
  assert.equal(raw.whatsappAntigo, '595982543275', 'fica anotado de onde saiu');
});
