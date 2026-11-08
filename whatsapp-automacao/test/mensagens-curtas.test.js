import test from 'node:test';
import assert from 'node:assert/strict';
import { splitIntoBubbles, sendInBubbles } from '../src/humanize.js';
import { NUDGE_TEXT, CLOSING_TEXT } from '../src/silence.js';
import { DEFAULT_OPENING } from '../src/opening.js';
import { apologyText } from '../src/outreach-apology.js';

const fill = (t) => t.replace('{saudacao}', 'Bom dia').replace('{nome}', 'Carlos').replace('{data}', '10/11');

test('textão vira mensagens de até ~4 linhas (200 letras), quebradas no fim de uma frase, sem perder nenhuma palavra', () => {
  for (const base of [NUDGE_TEXT, CLOSING_TEXT, DEFAULT_OPENING, apologyText('Carlos Souza')]) {
    const text = fill(base);
    const parts = splitIntoBubbles(text, 8);
    assert.ok(parts.length >= 2, 'textão foi dividido');
    for (const p of parts) assert.ok(p.length <= 330, `mensagem curta (${p.length}): ${p.slice(0, 40)}`);
    assert.equal(parts.join(' ').replace(/\s+/g, ' ').trim(), text.replace(/\s+/g, ' ').trim(), 'nenhuma palavra some');
    assert.ok(parts.slice(0, -1).every((p) => /[.!?…"”)🙏]$/.test(p)), 'quebra no fim de frase');
  }
});

test('link, Pix e código nunca são cortados; texto curto continua uma mensagem', () => {
  const link = 'Para elaborar o seu orçamento preencha estes dados rapidinho neste link: https://app.migra.com/orcamento-dados/abc?t=xyz. Assim que preencher, eu envio o orçamento aqui em PDF. '.repeat(2);
  assert.equal(splitIntoBubbles(link).length, 1);
  assert.deepEqual(splitIntoBubbles('Oi, tudo bem?'), ['Oi, tudo bem?']);
});

test('envio em partes: manda cada mensagem na ordem, com pausa entre elas e sem pausa depois da última', async () => {
  const sent = []; const waits = [];
  const bubbles = await sendInBubbles(async (b) => sent.push(b), fill(NUDGE_TEXT), { wait: async (ms) => waits.push(ms), pause: () => 1500, max: 8 });
  assert.deepEqual(sent, bubbles);
  assert.equal(waits.length, bubbles.length - 1);
});
