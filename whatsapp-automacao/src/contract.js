// Contrato de prestação de serviços de assessoria migratória, preenchido sozinho com os dados
// do cliente (ficha de dados ou o que o vendedor lançou) e do orçamento (pacotes, valores e parcelas).
// Sai sem assinatura: a contratada é a empresa, com "Responsável: Migra Assessoria".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfCanvas, PAGE } from './pdfdoc.js';
import { fmtBr, money } from './payplan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO = path.join(__dirname, '..', 'public', 'img', 'migra-logo-escuro.jpg');
const C = { green: '#0B2A1E', gold: '#D4AF37', ink: '#1d1d1f', gray: '#5f6368', line: '#d9dedb', soft: '#F4F7F5' };

export const CONTRACT_DEFAULTS = {
  company: 'MIGRA ASESORIA PARAGUAY E.A.S.',
  ruc: '80171751-5',
  address: 'Calle Las Palmeras, Edifício Domício 2, Santa Rita, Alto Paraná, República do Paraguai',
  signer: 'Migra Assessoria',
  city: 'Santa Rita, Alto Paraná',
  foro: 'Santa Rita, República do Paraguai',
  payee: 'Migra Paraguai Assessoria LTDA, CNPJ 58.521.546/0001-78',
};

// ---------- Valor por extenso (reais e centavos) ----------
const U = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const D = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const H = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
function upTo999(n) {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts = [];
  if (h) parts.push(H[h]);
  if (r) parts.push(r < 20 ? U[r] : D[Math.floor(r / 10)] + (r % 10 ? ` e ${U[r % 10]}` : ''));
  return parts.join(' e ');
}
function intWords(n) {
  if (n === 0) return 'zero';
  const groups = [];
  while (n > 0) {
    groups.push(n % 1000);
    n = Math.floor(n / 1000);
  }
  const names = [['', ''], ['mil', 'mil'], ['milhão', 'milhões'], ['bilhão', 'bilhões']];
  const out = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g) continue;
    const words = i === 1 && g === 1 ? 'mil' : `${upTo999(g)}${names[i][0] ? ` ${g === 1 ? names[i][0] : names[i][1]}` : ''}`;
    out.push({ words, g, i });
  }
  // "e" antes do último grupo quando ele é menor que 100 ou centena redonda (ex.: mil e cem, dois mil e cinquenta).
  return out.map((x, k) => (k > 0 && k === out.length - 1 && (x.g < 100 || x.g % 100 === 0) ? `e ${x.words}` : x.words)).join(' ');
}
/** 10997 → "dez mil, novecentos e noventa e sete reais"; 6418.2 → "... reais e vinte centavos". */
export function moneyWords(value) {
  const cents = Math.round(Number(value || 0) * 100);
  const r = Math.floor(cents / 100);
  const c = cents % 100;
  const parts = [];
  if (r) parts.push(`${intWords(r)}${r % 1_000_000 === 0 && r >= 1_000_000 ? ' de' : ''} ${r === 1 ? 'real' : 'reais'}`);
  if (c) parts.push(`${intWords(c)} ${c === 1 ? 'centavo' : 'centavos'}`);
  return parts.join(' e ') || 'zero reais';
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const longDate = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return `${d} de ${MONTHS[m - 1]} de ${y}`;
};
const blank = (v, w = '______________') => (String(v || '').trim() ? String(v).trim() : w);

/** Endereço completo a partir dos campos da ficha. */
export function fullAddress(d = {}) {
  if (d.endereco) return d.endereco;
  const street = [d.rua, d.numero].filter(Boolean).join(', ');
  return [street && `${street}${d.complemento ? ` - ${d.complemento}` : ''}`, d.bairro, d.cidade && `${d.cidade}${d.uf ? `/${d.uf}` : ''}`, d.cep && `CEP ${d.cep}`].filter(Boolean).join(', ');
}

/**
 * client: { nome, nacionalidade, estadoCivil, profissao, rg, rgOrgao, cpf, endereco | rua…, whatsapp, email, acompanhantes }
 * quote: orçamento (itens, plano, número). cfg: dados da contratada (CONTRACT_DEFAULTS).
 */
/**
 * sign (opcional): assinatura eletrônica do(a) contratante
 * { image: JPEG, signedAt, ip, ua, hash, imageConsent: 'sim' | 'nao' }.
 */
export function contractPdf({ client = {}, quote, cfg = {}, issued, sign = null }) {
  const K = { ...CONTRACT_DEFAULTS, ...Object.fromEntries(Object.entries(cfg).filter(([, v]) => v)) };
  const p = quote.plan;
  const date = issued || new Date().toISOString().slice(0, 10);
  const number = `CT-${quote.number.replace(/^ORC-/, '')}`;
  const c = new PdfCanvas();
  const W = PAGE.W;
  const M = 50;
  const maxW = W - 2 * M;
  const bottom = PAGE.H - 70;
  let y = 0;
  let logo = null;
  try {
    logo = fs.readFileSync(LOGO);
  } catch { /* sem logo, só o nome */ }

  const header = (first) => {
    c.rect(0, 0, W, first ? 92 : 50, { fill: C.green });
    c.rect(0, first ? 92 : 50, W, 2, { fill: C.gold });
    if (logo) c.image(logo, M - 6, first ? 14 : 6, first ? 150 : 90);
    else c.text('MIGRA PARAGUAI', M, first ? 34 : 16, { size: first ? 18 : 12, bold: true, color: '#fff' });
    c.text(number, W - M, first ? 22 : 14, { size: first ? 12 : 9, bold: true, color: C.gold, align: 'right' });
    c.text(`Ref. orçamento ${quote.number}`, W - M, first ? 40 : 28, { size: first ? 8.5 : 7.5, color: '#cfe0d7', align: 'right' });
    if (first) c.text('Válido somente após a confirmação do pagamento da entrada', W - M, 56, { size: 7.5, bold: true, color: '#ffe8a3', align: 'right' });
    if (first && sign) c.text(`Assinado eletronicamente pelo(a) contratante em ${new Date(sign.signedAt).toLocaleString('pt-BR', { timeZone: 'America/Asuncion' })}`, W - M, 70, { size: 7.5, color: '#bff0d6', align: 'right' });
    y = first ? 118 : 74;
  };
  const newPage = () => {
    c.addPage();
    header(false);
  };
  const need = (h) => {
    if (y + h > bottom) newPage();
  };
  const para = (text, { size = 9.6, bold = false, color = C.ink, gap = 7, indent = 0, lead = 1.5 } = {}) => {
    const lines = c.lines(text, maxW - indent, { size, bold });
    for (const line of lines) {
      need(size * lead);
      c.text(line, M + indent, y, { size, bold, color });
      y += size * lead;
    }
    y += gap;
  };
  const clause = (title, paragraphs) => {
    need(46);
    c.text(title, M, y, { size: 10, bold: true, color: C.green, spacing: 0.3 });
    y += 17;
    for (const t of paragraphs) if (t) para(t);
    y += 4;
  };

  header(true);
  c.text('CONTRATO PARTICULAR DE PRESTAÇÃO DE SERVIÇOS', W / 2, y, { size: 13, bold: true, color: C.ink, align: 'center' });
  y += 17;
  c.text('DE ASSESSORIA MIGRATÓRIA', W / 2, y, { size: 13, bold: true, color: C.ink, align: 'center' });
  y += 26;

  // Partes
  const d = client;
  const qual = [
    blank(d.nacionalidade, 'nacionalidade ______'),
    d.estadoCivil ? d.estadoCivil.toLowerCase() : 'estado civil ______',
    d.profissao ? d.profissao.toLowerCase() : null,
  ].filter(Boolean).join(', ');
  c.rect(M, y, maxW, 0.5, { fill: C.line });
  y += 10;
  para(`CONTRATANTE: ${blank(d.nome, '________________________________').toUpperCase()}, ${qual}, portador(a) da Cédula de Identidade RG nº ${blank(d.rg)}${d.rgOrgao ? ` (${d.rgOrgao})` : ''}, inscrito(a) no CPF sob o nº ${blank(d.cpf)}, residente e domiciliado(a) em ${blank(fullAddress(d), '________________________________________')}${d.whatsapp ? `, WhatsApp ${d.whatsapp}` : ''}${d.email ? `, e-mail ${d.email}` : ''}.`);
  para(`CONTRATADA: ${K.company}, pessoa jurídica de direito privado, inscrita no RUC sob o nº ${K.ruc}, com sede na ${K.address}, neste ato representada por seu responsável (${K.signer}).`);
  para('As partes acima identificadas têm entre si, justo e contratado, o presente contrato, que se regerá pelas cláusulas e condições a seguir.', { color: C.gray });
  c.rect(M, y - 2, maxW, 0.5, { fill: C.line });
  y += 12;

  // Cláusula 1 – objeto, com a tabela dos serviços
  need(60);
  c.text('CLÁUSULA PRIMEIRA – DO OBJETO', M, y, { size: 10, bold: true, color: C.green, spacing: 0.3 });
  y += 17;
  para('Constitui objeto deste contrato a prestação de serviços técnicos especializados de assessoria migratória e documental, compreendendo orientação documental, análise de requisitos, preparação do dossiê, emissão das certidões no Paraguai (Interpol e Informática da Polícia Nacional), agendamentos, protocolo, acompanhamento processual junto às autoridades competentes e suporte em português, relativos aos serviços abaixo discriminados.');
  para('Parágrafo primeiro. Serviços contratados e respectivos valores:', { bold: true, gap: 4 });
  const col = { qty: W - M - 190, unit: W - M - 90, total: W - M - 8 };
  need(22 + quote.items.length * 18 + 26);
  c.rect(M, y, maxW, 20, { fill: C.green, radius: 4 });
  c.text('SERVIÇO', M + 8, y + 6.5, { size: 7.5, bold: true, color: C.gold });
  c.text('PESSOAS', col.qty, y + 6.5, { size: 7.5, bold: true, color: C.gold, align: 'center' });
  c.text('POR PESSOA', col.unit, y + 6.5, { size: 7.5, bold: true, color: C.gold, align: 'right' });
  c.text('TOTAL', col.total, y + 6.5, { size: 7.5, bold: true, color: C.gold, align: 'right' });
  y += 26;
  for (const r of quote.items) {
    const nameLines = c.lines(`${r.name}${r.subtitle ? ` – ${r.subtitle}` : ''}`, col.qty - 30 - (M + 8), { size: 8.8 }).slice(0, 3);
    need(nameLines.length * 12 + 8);
    nameLines.forEach((line, k) => c.text(line, M + 8, y + k * 12, { size: 8.8, bold: k === 0, color: C.ink }));
    c.text(String(r.qty), col.qty, y, { size: 8.8, color: C.ink, align: 'center' });
    c.text(money(r.price), col.unit, y, { size: 8.8, color: C.ink, align: 'right' });
    c.text(money(r.total), col.total, y, { size: 8.8, bold: true, color: C.ink, align: 'right' });
    y += nameLines.length * 12 + 1;
    c.line(M, y + 1, W - M, y + 1, { color: C.line });
    y += 6;
  }
  c.text('Valor total contratado', M + 8, y + 2, { size: 9.5, bold: true, color: C.ink });
  c.text(money(p.total), col.total, y + 2, { size: 10.5, bold: true, color: C.green, align: 'right' });
  y += 24;
  const extra = String(d.acompanhantes || '').trim();
  para(`Parágrafo segundo. Beneficiários: o(a) CONTRATANTE${extra ? ` e ${extra}` : ''}, totalizando ${p.people} pessoa(s), das quais ${p.adults} adulta(s).`);
  para('Parágrafo terceiro. Não estão incluídos no valor deste contrato as despesas pessoais do(a) CONTRATANTE com passagens, hospedagem, alimentação e deslocamentos nas viagens ao Paraguai, nem custos de documentos de responsabilidade do(a) CONTRATANTE no Brasil, salvo se expressamente previstos no Parágrafo primeiro.');
  y += 4;

  clause('CLÁUSULA SEGUNDA – DAS OBRIGAÇÕES DA CONTRATADA', [
    'A CONTRATADA compromete-se a executar os serviços com observância da legislação vigente da República do Paraguai, com diligência, ética profissional e boa-fé, prestando ao(à) CONTRATANTE as informações necessárias ao regular andamento do procedimento migratório e informando-o(a) sobre cada etapa, as datas de comparecimento e os documentos exigidos.',
  ]);
  clause('CLÁUSULA TERCEIRA – DAS OBRIGAÇÕES DO(A) CONTRATANTE', [
    'Compete ao(à) CONTRATANTE fornecer documentos autênticos, verdadeiros e atualizados, cumprir as exigências legais, comparecer aos órgãos públicos quando convocado(a) e efetuar os pagamentos ajustados nos prazos estipulados neste instrumento.',
    'Parágrafo único. Caso o(a) CONTRATANTE não compareça aos órgãos competentes dentro dos prazos informados pela CONTRATADA, a responsabilidade pelo vencimento, expiração ou perda de validade de documentos, protocolos ou agendamentos será exclusivamente do(a) CONTRATANTE, eximindo a CONTRATADA de qualquer ônus, retrabalho ou ressarcimento decorrente.',
  ]);

  // Cláusula 4 – preço e pagamento
  const entryParts = `${money(p.base)} de sinal de contratação dos serviços e ${money(p.perAdult * p.adults)} (${money(p.perAdult)} por adulto) referentes às certidões da Interpol e da Informática da Polícia Nacional do Paraguai`;
  const trips = p.custom ? [] : ['na primeira vinda ao Paraguai', 'na segunda vinda ao Paraguai', 'na retirada dos documentos'];
  clause('CLÁUSULA QUARTA – DO PREÇO E DAS CONDIÇÕES DE PAGAMENTO', [
    `O valor total deste contrato é de ${money(p.total)} (${moneyWords(p.total)}), a ser pago via Pix na conta indicada pela CONTRATADA (${K.payee}), da seguinte forma:`,
    `a) Entrada de ${money(p.entry)} (${moneyWords(p.entry)}), na assinatura, composta de ${entryParts};`,
    ...p.parcels.map((x, k) => `${String.fromCharCode(98 + k)}) ${x.label} de ${money(x.value)} (${moneyWords(x.value)}), com vencimento previsto em ${fmtBr(x.date)}${trips[k] ? `, ${trips[k]}` : ''};`),
    'Parágrafo primeiro. A entrada é descontada do valor total. As datas das parcelas são estimadas a partir da assinatura e acompanham as etapas do processo; quando a etapa ocorrer em outra data, a parcela correspondente vence na data da etapa, conforme informado pela CONTRATADA.',
    'Parágrafo segundo. O valor ajustado em reais é fixo e não sofre alteração por oscilações cambiais. Aumentos de taxas públicas, novos impostos ou gastos extraordinários causados pelo(a) CONTRATANTE (como novas fotos ou segundas vias de documentos perdidos) serão repassados ao(à) CONTRATANTE mediante comprovante, sob pena de suspensão dos serviços.',
    'Parágrafo terceiro. Este contrato somente produz efeitos após a confirmação do pagamento da entrada.',
  ]);
  clause('CLÁUSULA QUINTA – DA NATUREZA DA OBRIGAÇÃO', [
    'Os serviços contratados constituem obrigação de meio. A concessão de residência, cédula e demais documentos é ato exclusivo das autoridades competentes, e os prazos informados são estimativas que dependem desses órgãos, não havendo garantia de resultado ou de prazo por parte da CONTRATADA.',
  ]);
  clause('CLÁUSULA SEXTA – DA CONFIDENCIALIDADE', [
    'As partes comprometem-se a manter absoluto sigilo sobre as informações e os documentos compartilhados em razão deste contrato.',
  ]);
  clause('CLÁUSULA SÉTIMA – DOS DADOS PESSOAIS', [
    'O(A) CONTRATANTE autoriza a CONTRATADA a coletar, armazenar e tratar seus dados pessoais e documentos, e os dos beneficiários que indicar, exclusivamente para a execução deste contrato, podendo compartilhá-los apenas com os órgãos públicos, cartórios, tradutores e parceiros necessários aos procedimentos contratados, observada a Lei Geral de Proteção de Dados (Lei nº 13.709/2018) e a legislação paraguaia aplicável. O(A) CONTRATANTE pode solicitar a qualquer tempo informações sobre o uso de seus dados.',
  ]);
  clause('CLÁUSULA OITAVA – DA RESCISÃO', [
    'Este contrato poderá ser rescindido por qualquer das partes, mediante aviso prévio por escrito com antecedência mínima de 30 (trinta) dias.',
    'Parágrafo primeiro. Considera-se iniciada a execução dos serviços, para todos os fins, com o início da análise documental, a triagem de requisitos, a solicitação das certidões ou a abertura de canal de atendimento exclusivo ao(à) CONTRATANTE, independentemente do protocolo formal perante os órgãos paraguaios.',
    'Parágrafo segundo. Em caso de desistência por iniciativa do(a) CONTRATANTE após o início da execução, não haverá devolução dos valores já pagos, que se destinam à cobertura dos custos operacionais e administrativos e das certidões já solicitadas.',
    'Parágrafo terceiro. Sem prejuízo do parágrafo anterior, a rescisão imotivada por iniciativa do(a) CONTRATANTE, ou a resolução por sua culpa exclusiva, implica multa compensatória de 20% (vinte por cento) sobre o valor total do contrato.',
    'Parágrafo quarto. O atraso de qualquer parcela por mais de 15 (quinze) dias corridos constitui o(a) CONTRATANTE em mora, autorizando a CONTRATADA a: I – suspender os serviços e os trâmites até a regularização, sem responsabilidade por prazos ou validade de documentos nesse período; ou II – declarar o contrato resolvido por inadimplemento, sendo devida a multa do parágrafo terceiro, com juros de 1% (um por cento) ao mês e correção monetária sobre o saldo devedor.',
  ]);
  clause('CLÁUSULA NONA – DO USO DE IMAGEM E VOZ (OPCIONAL)', [
    'O(A) CONTRATANTE, marcando abaixo, decide se autoriza, de forma gratuita, a CONTRATADA a utilizar sua imagem, voz e depoimentos relacionados aos serviços em redes sociais, site e materiais de divulgação, de forma ética e respeitosa. A autorização pode ser revogada a qualquer tempo, por escrito, para usos futuros.',
    sign ? `( ${sign.imageConsent === 'sim' ? 'X' : '  '} ) Autorizo          ( ${sign.imageConsent === 'sim' ? '  ' : 'X'} ) Não autorizo` : '(   ) Autorizo          (   ) Não autorizo',
  ]);
  clause('CLÁUSULA DÉCIMA – DO FORO', [
    `As partes elegem o foro de ${K.foro} para dirimir quaisquer controvérsias oriundas deste contrato, com renúncia a qualquer outro, por mais privilegiado que seja.`,
  ]);
  para('E, por estarem assim justas e contratadas, as partes firmam o presente instrumento em duas vias de igual teor e forma, na presença de duas testemunhas.', { gap: 10 });
  para(`${K.city}, ${longDate(date)}.`, { bold: true, gap: 14 });

  // Assinaturas (sem nomes de pessoas pela contratada)
  need(sign ? 220 : 170);
  y += 26;
  const sw = (maxW - 40) / 2;
  const sx = M + sw + 40;
  if (sign?.image) y += 48; // espaço para a assinatura, sem cobrir a data
  if (sign?.image) {
    // A assinatura feita com o dedo, em cima da linha do contratante.
    const h = c.image(sign.image, M + 6, y - 58, Math.min(170, sw));
    if (h > 58) y += h - 58;
  }
  c.line(M, y, M + sw, y, { color: '#8a948f', width: 0.8 });
  c.line(sx, y, sx + sw, y, { color: '#8a948f', width: 0.8 });
  c.text(blank(d.nome, 'CONTRATANTE').toUpperCase().slice(0, 44), M, y + 6, { size: 8.5, bold: true, color: C.ink });
  c.text(`CPF: ${blank(d.cpf)}`, M, y + 18, { size: 8, color: C.gray });
  c.text('CONTRATANTE', M, y + 30, { size: 7.5, bold: true, color: C.green });
  c.text(K.company, sx, y + 6, { size: 8.5, bold: true, color: C.ink });
  c.text(`RUC: ${K.ruc}`, sx, y + 18, { size: 8, color: C.gray });
  c.text(`Responsável: ${K.signer}`, sx, y + 30, { size: 8, color: C.gray });
  c.text('CONTRATADA', sx, y + 42, { size: 7.5, bold: true, color: C.green });
  y += 92;
  c.line(M, y, M + sw, y, { color: '#8a948f', width: 0.8 });
  c.line(sx, y, sx + sw, y, { color: '#8a948f', width: 0.8 });
  c.text('Testemunha 1 – Nome / CPF', M, y + 6, { size: 8, color: C.gray });
  c.text('Testemunha 2 – Nome / CPF', sx, y + 6, { size: 8, color: C.gray });
  y += 30;
  if (sign) {
    // Comprovante da assinatura eletrônica.
    need(96);
    c.rect(M, y, maxW, 86, { fill: C.soft, stroke: C.line, radius: 8, lineWidth: 0.6 });
    c.text('REGISTRO DA ASSINATURA ELETRÔNICA', M + 12, y + 10, { size: 8, bold: true, color: C.green, spacing: 0.4 });
    const rows = [
      `Assinado pelo(a) contratante ${blank(d.nome).toUpperCase()} (CPF ${blank(d.cpf)}) em ${new Date(sign.signedAt).toLocaleString('pt-BR', { timeZone: 'America/Asuncion' })} (horário do Paraguai).`,
      `IP: ${sign.ip || '-'} · Aparelho: ${String(sign.ua || '-').slice(0, 90)}`,
      `Uso de imagem: ${sign.imageConsent === 'sim' ? 'autorizado' : 'não autorizado'} · Código de verificação: ${String(sign.hash || '').slice(0, 32).toUpperCase()}`,
    ];
    let ry = y + 26;
    for (const r of rows) {
      for (const line of c.lines(r, maxW - 24, { size: 7.5 })) {
        c.text(line, M + 12, ry, { size: 7.5, color: C.ink });
        ry += 11;
      }
    }
    y += 96;
  }

  // Rodapé em todas as páginas
  const pages = c.pages;
  pages.forEach((ops, i) => {
    c.pages = [ops];
    c.line(M, PAGE.H - 44, W - M, PAGE.H - 44, { color: C.line });
    c.text(`${K.company} · RUC ${K.ruc} · ${number}`, M, PAGE.H - 36, { size: 7, color: C.gray });
    c.text(`Página ${i + 1} de ${pages.length}`, W - M, PAGE.H - 36, { size: 7, color: C.gray, align: 'right' });
  });
  c.pages = pages;
  return c.toBuffer();
}
