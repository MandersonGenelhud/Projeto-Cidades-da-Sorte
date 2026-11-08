// "Plano para dar entrada sozinho": para quem não tem condições de contratar a assessoria. O cliente paga um valor simples (padrão R$ 500)
// e só DEPOIS do pagamento recebe o PDF. Se existir data/plano-autonomo.pdf (arquivo oficial da Migra), ele é usado; se não, o sistema gera
// um PDF-base só com o que está na base oficial do atendimento (nada inventado), que a equipe pode trocar pelo arquivo oficial.
import fs from 'node:fs';
import path from 'node:path';
import { PdfCanvas, PAGE } from './pdfdoc.js';

export const PLAN_PDF_DEFAULT_PRICE = 500;
export const planPdfPrice = (settings) => { const v = Number(settings?.crm?.planPdf?.price); return v > 0 ? v : PLAN_PDF_DEFAULT_PRICE; };
export const planPdfFile = (dataDir) => path.join(dataDir, 'plano-autonomo.pdf');
export const hasOfficialPlanPdf = (dataDir) => fs.existsSync(planPdfFile(dataDir));

const STEPS = [
  ['1. Documentos de partida', 'Foto de meio corpo e foto do RG (de 10 anos para cá; o passaporte não serve neste momento). Mantenha tudo legível e em um só lugar.'],
  ['2. Certidões do Paraguai', 'São duas: a Certidão de Antecedentes da Interpol (Nada Consta) e a Certidão de Antecedentes da Informática da Polícia Nacional. Levam normalmente de 7 a 15 dias.'],
  ['3. Documentação do Brasil', 'Enquanto as certidões saem, organize os documentos exigidos no Brasil. Confira cada exigência com atenção: documento errado ou faltando faz perder viagem.'],
  ['4. Primeira vinda ao Paraguai', 'Protocolo oficial do pedido da cédula e assinatura dos documentos.'],
  ['5. Segunda vinda', 'Cerca de 60 a 70 dias úteis depois: coleta das digitais e últimas etapas.'],
  ['6. Emissão da cédula', 'Em média 20 a 30 dias depois. O total estimado é de 90 a 120 dias úteis.'],
  ['7. Fase fiscal', 'Com a cédula, o caminho segue para o RUC (cédula tributária), abertura de empresa e licença de condução.'],
];

/** PDF-base (orientativo). Os prazos são estimativas: os órgãos do Paraguai decidem. */
export function buildPlanPdf({ company = 'Migra Paraguai' } = {}) {
  const c = new PdfCanvas();
  const W = PAGE.W; const M = 48; let y = 0;
  const head = () => { c.rect(0, 0, W, 80, { fill: '#0F4D3A' }); c.rect(0, 80, W, 2, { fill: '#D4AF37' }); c.text(company.toUpperCase(), M, 28, { size: 16, bold: true, color: '#ffffff' }); c.text('Plano para dar entrada no processo por conta própria', M, 50, { size: 10, color: '#cfe0d7' }); y = 112; };
  head();
  c.para('Este guia reúne, em ordem, as etapas do processo da cédula de residência no Paraguai. É um material de orientação para quem prefere conduzir o processo sozinho, sem o acompanhamento da equipe.', M, y, W - 2 * M, { size: 10 }); y += 52;
  for (const [t, d] of STEPS) {
    const h = c.measure(d, W - 2 * M - 12, { size: 10 }) + 26;
    if (y + h > 780) { c.addPage(); head(); }
    c.text(t, M, y, { size: 11, bold: true, color: '#0F4D3A' }); y += 16;
    c.para(d, M + 12, y, W - 2 * M - 12, { size: 10 }); y += h - 16;
  }
  if (y > 700) { c.addPage(); head(); }
  c.line(M, y, W - M, y); y += 14;
  c.para('Importante: os prazos são estimativas e dependem dos órgãos do Paraguai. Este guia não substitui a análise da sua situação nem garante aprovação. Quando quiser contar com o acompanhamento da equipe, é só nos chamar.', M, y, W - 2 * M, { size: 9, color: '#555555' });
  return c.toBuffer();
}

/** Devolve { buffer, official }: o arquivo oficial, se existir, ou o PDF-base. */
export function loadPlanPdf({ dataDir, company }) {
  const f = planPdfFile(dataDir);
  if (fs.existsSync(f)) return { buffer: fs.readFileSync(f), official: true };
  return { buffer: buildPlanPdf({ company }), official: false };
}
