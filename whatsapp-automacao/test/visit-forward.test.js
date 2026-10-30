import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Crm } from '../src/crm.js';
import { Visits } from '../src/visits.js';
import { tempStore } from './helpers.js';

// A rota usa Visits + Crm: aqui conferimos as peças que ela combina (pedido ligado ao prospecto e responsável).
test('pedido de visita ligado ao prospecto: passar para a vendedora deixa ela como responsável', async () => {
  const store = tempStore();
  const auth = new Auth({ store, dataDir: store.dataDir });
  const admin = auth.create({ name: 'Marcos', login: 'marcos', password: 'segredo123', role: 'admin' });
  const silvane = auth.create({ name: 'Silvane Nunes', login: 'silvane', password: 'segredo123', role: 'seller', whatsapp: '5545999990009' });
  const crm = new Crm({ store, auth });
  const visits = new Visits({ store, crm });
  const lead = crm.create(admin, { name: 'Francisco Albuquerque', phone: '5579996318637' });
  const v = await visits.request({ convKey: '5579996318637@s.whatsapp.net', lead, nome: 'Francisco Albuquerque', data_preferida: 'segunda 02/11', assunto: 'Iniciar processo presencialmente' });
  assert.equal(v.leadId, lead.id);
  crm.assign(admin, v.leadId, silvane.id);
  assert.equal(crm.byId(lead.id).ownerId, silvane.id);
});
