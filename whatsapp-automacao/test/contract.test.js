import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { contractPdf, moneyWords, fullAddress } from '../src/contract.js';
import { paymentPlan } from '../src/payplan.js';

test('valor por extenso (reais e centavos)', () => {
  assert.equal(moneyWords(10997), 'dez mil novecentos e noventa e sete reais');
  assert.equal(moneyWords(1800), 'mil e oitocentos reais');
  assert.equal(moneyWords(6418.2), 'seis mil quatrocentos e dezoito reais e vinte centavos');
  assert.equal(moneyWords(1.01), 'um real e um centavo');
  assert.equal(moneyWords(2050), 'dois mil e cinquenta reais');
});

test('contrato preenchido: cliente, serviços, parcelas por extenso e a Migra Assessoria como responsável', () => {
  const plan = paymentPlan({ total: 23994, people: 2, adults: 2, start: '2026-10-30' });
  const quote = { number: 'ORC-2026-09767', items: [{ name: 'Pacote Ouro', subtitle: 'Cédula, RUC e licença', qty: 1, price: 12997, total: 12997 }, { name: 'Pacote Inicial', qty: 1, price: 10997, total: 10997 }], plan };
  const client = { nome: 'Luiza Fernandes da Silva', nacionalidade: 'Brasileira', estadoCivil: 'Casado(a)', cpf: '529.982.247-25', rg: '123', rua: 'Rua A', numero: '10', cidade: 'Cascavel', uf: 'PR', acompanhantes: 'Carlos (esposo)' };
  assert.equal(fullAddress(client), 'Rua A, 10, Cascavel/PR');
  const pdf = contractPdf({ client, quote, issued: '2026-10-30' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-'));
  const file = path.join(dir, 'c.pdf');
  fs.writeFileSync(file, pdf);
  let text;
  try {
    text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
  } catch {
    return; // sem pdftotext nesta máquina: só confere que gerou o PDF
  }
  const flat = text.replace(/\s+/g, ' ');
  assert.match(flat, /CT-2026-09767/);
  assert.match(flat, /LUIZA FERNANDES DA SILVA/);
  assert.match(flat, /MIGRA ASESORIA PARAGUAY E\.A\.S\./);
  assert.match(flat, /Responsável: Migra Assessoria/);
  assert.doesNotMatch(flat, /Eliezer/);
  assert.match(flat, /vinte e três mil novecentos e noventa e quatro reais/);
  assert.match(flat, /Entrada de R\$ 2\.600,00/);
  assert.match(flat, /Carlos \(esposo\)/);
  assert.match(flat, /Válido somente após a confirmação do pagamento da entrada/);
  // Sem dados: linhas para completar à mão.
  const empty = contractPdf({ client: {}, quote, issued: '2026-10-30' });
  assert.ok(empty.length > 1000);
});

test('contrato assinado pelo celular: assinatura, escolha do uso de imagem e comprovante no PDF', async () => {
  const plan = paymentPlan({ total: 12997, people: 1, adults: 1, start: '2026-10-30' });
  const quote = { number: 'ORC-2026-09800', items: [{ name: 'Pacote Ouro', qty: 1, price: 12997, total: 12997 }], plan };
  // JPEG mínimo válido (1×1) para a assinatura.
  const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
  const pdf = contractPdf({ client: { nome: 'João Pereira', cpf: '529.982.247-25' }, quote, issued: '2026-10-30', sign: { image: jpeg, signedAt: '2026-10-30T21:00:00Z', ip: '200.1.2.3', ua: 'iPhone', hash: 'abc123def456', imageConsent: 'nao' } });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cts-'));
  const file = path.join(dir, 's.pdf');
  fs.writeFileSync(file, pdf);
  assert.ok(pdf.includes(Buffer.from('/Subtype /Image')), 'a assinatura vai como imagem no PDF');
  let text;
  try { text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' }); } catch { return; }
  const flat = text.replace(/\s+/g, ' ');
  assert.match(flat, /REGISTRO DA ASSINATURA ELETRÔNICA/);
  assert.match(flat, /IP: 200\.1\.2\.3/);
  assert.match(flat, /\( X \) Não autorizo/);
  assert.match(flat, /Assinado eletronicamente pelo\(a\) contratante/);
  assert.match(flat, /ABC123DEF456/);
});

function contractText(plan) {
  const quote = { number: 'ORC-2026-09999', items: [{ name: 'Pacote Ouro', qty: 1, price: 12997, total: 12997 }], plan };
  const client = { nome: 'Maria Teste', nacionalidade: 'Brasileira', estadoCivil: 'Solteiro(a)', cpf: '529.982.247-25', rg: '123', rua: 'Rua A', numero: '10', cidade: 'Cascavel', uf: 'PR' };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-')), 'c.pdf');
  fs.writeFileSync(file, contractPdf({ client, quote, issued: '2026-10-30' }));
  try { return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' }).replace(/\s+/g, ' '); } catch { return null; }
}

test('contrato, pagamento padrão: parcelas ligadas à primeira vinda ao Paraguai e ao pagamento da parcela anterior', () => {
  const flat = contractText(paymentPlan({ total: 12997, people: 1, adults: 1, start: '2026-10-30' }));
  if (!flat) return;
  assert.match(flat, /com vencimento ou com data de pagamento na primeira vinda ao Paraguai/);
  assert.match(flat, /com vencimento previsto entre 60 \(sessenta\) e 90 \(noventa\) dias após a primeira vinda ao Paraguai/);
  assert.match(flat, /com vencimento 30 \(trinta\) dias após o pagamento da segunda parcela/);
  assert.doesNotMatch(flat, /na segunda vinda ao Paraguai|na retirada dos documentos/);
});

test('contrato, parcelas combinadas pelo vendedor: continuam com data fixa', () => {
  const plan = paymentPlan({ total: 12997, people: 1, adults: 1, start: '2026-10-30', steps: [{ pct: 50, days: 30, note: 'x' }, { pct: 50, days: 60, note: 'y' }] });
  const flat = contractText({ ...plan, custom: true });
  if (!flat) return;
  assert.match(flat, /com vencimento previsto em \d{2}\/\d{2}\/\d{4}/);
  assert.doesNotMatch(flat, /primeira vinda ao Paraguai/);
});
