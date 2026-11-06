import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWhenPt, titleFrom, addMonths, dayLabel, fold1 } from '../src/ana-dates.js';

const NOW = new Date(2026, 10, 6, 10, 0); // sexta-feira, 06/11/2026
const w = (t) => { const r = parseWhenPt(t, NOW); return { date: r.date, time: r.time }; };

test('dias relativos e dias da semana', () => {
  assert.deepEqual(w('reunião hoje'), { date: '2026-11-06', time: '' });
  assert.deepEqual(w('dentista amanhã às 14h'), { date: '2026-11-07', time: '14:00' });
  assert.deepEqual(w('depois de amanhã 9:30'), { date: '2026-11-08', time: '09:30' });
  assert.deepEqual(w('almoço na segunda às 12'.replace('às 12', 'às 12h')), { date: '2026-11-09', time: '12:00' });
  assert.deepEqual(w('culto domingo 19h'), { date: '2026-11-08', time: '19:00' });
  assert.equal(w('na sexta').date, '2026-11-13', 'dito numa sexta, "sexta" é a próxima');
  assert.equal(w('quarta-feira que vem').date, '2026-11-11');
});

test('horas em vários formatos, com manhã, tarde e noite', () => {
  assert.equal(w('amanhã 14h30').time, '14:30');
  assert.equal(w('amanhã às 9 da manhã').time, '09:00');
  assert.equal(w('amanhã às 7 da noite').time, '19:00');
  assert.equal(w('amanhã às 3 da tarde').time, '15:00');
  assert.equal(w('amanhã meio-dia').time, '12:00');
  assert.equal(w('amanhã às 18').time, '18:00');
  assert.equal(w('gastei 50 reais hoje').time, '', 'valor em reais não é hora');
});

test('datas completas e dia do mês', () => {
  assert.equal(w('dia 15').date, '2026-11-15');
  assert.equal(w('dia 3').date, '2026-12-03', 'dia que já passou neste mês vai para o próximo');
  assert.equal(w('15/12').date, '2026-12-15');
  assert.equal(w('02/03').date, '2027-03-02', 'dd/mm que já passou este ano vai para o ano que vem');
  assert.equal(w('10/05/2028').date, '2028-05-10');
  assert.equal(w('10/05/28').date, '2028-05-10');
  assert.equal(w('15 de dezembro').date, '2026-12-15');
  assert.equal(w('dia 20 de março de 2027').date, '2027-03-20');
  assert.equal(w('31/02').date, '', 'data impossível não vira data');
});

test('daqui a N dias, semanas, meses e anos (compromissos de 1 ou 2 anos)', () => {
  assert.equal(w('daqui a 10 dias').date, '2026-11-16');
  assert.equal(w('em 2 semanas').date, '2026-11-20');
  assert.equal(w('daqui a 3 meses').date, '2027-02-06');
  assert.equal(w('daqui a 1 ano').date, '2027-11-06');
  assert.equal(w('daqui a 2 anos').date, '2028-11-06');
  assert.equal(w('ano que vem').date, '2027-11-06');
  assert.equal(w('mês que vem').date, '2026-12-06');
  assert.equal(w('semana que vem').date, '2026-11-13');
  assert.equal(w('daqui a 9 anos').date, '', 'mais de 5 anos à frente é recusado');
});

test('soma de meses respeita o fim do mês', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2027-12-31', 2), '2028-02-29');
  assert.equal(addMonths('2026-11-10', 12), '2027-11-10');
});

test('título: sobra só o assunto, com acento e maiúsculas originais', () => {
  const t = 'Me lembre de ligar para o Contador amanhã às 14h';
  const r = parseWhenPt(t, NOW);
  assert.equal(titleFrom(t, r.spans, { drop: [/\bme lembr[ae]\b/i] }), 'de ligar para o Contador'.replace(/^de /, ''));
  assert.equal(fold1('Ação').length, 'Ação'.length, 'a limpeza não desalinha o texto');
});

test('rótulo do dia', () => {
  assert.equal(dayLabel('2026-11-07', NOW), 'sábado, 07/11');
  assert.equal(dayLabel('2028-11-06', NOW), 'segunda-feira, 06/11/2028');
});
