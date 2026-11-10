import test from 'node:test';
import assert from 'node:assert/strict';
import { centralLink } from '../src/routing.js';
import { tempStore } from './helpers.js';

test('botão do site e da live abre o WhatsApp da Central (não o de um vendedor); sem Central, devolve null e vale o rodízio', () => {
  const site = centralLink({ central: '+595 984 453 784', origin: 'site', code: 'SITE-00012' });
  assert.match(site, /^https:\/\/wa\.me\/595984453784\?text=/);
  const texto = decodeURIComponent(site.split('text=')[1]);
  assert.match(texto, /pelo site da Migra/);
  assert.match(texto, /Código: SITE-00012/);
  assert.ok(!/Olá, [A-Z]/.test(texto), 'não chama ninguém pelo nome: quem atende é a Central');
  assert.match(decodeURIComponent(centralLink({ central: '595984453784', origin: 'live' }).split('text=')[1]), /pela live da Migra/);
  assert.equal(centralLink({ central: '' }), null);
  assert.equal(centralLink({ central: '123' }), null, 'número curto demais não vale');
});

test('instalação nova (sem usuários) não vem com Central: o rodízio entre vendedores continua até alguém configurar', () => {
  const store = tempStore();
  assert.equal(store.settings.crm.centralWhatsapp || '', '');
});
