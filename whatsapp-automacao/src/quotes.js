// Orçamentos da Migra (ORC-AAAA-NNNNN): PDF com a marca + mensagem de WhatsApp no formato da equipe.
// O número segue a sequência dos orçamentos que a Migra já emite; o próximo número é configurável no painel.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfCanvas, PAGE } from './pdfdoc.js';
import { paymentPlan, DEFAULT_STEPS, todayIso, fmtBr, money } from './payplan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO = path.join(__dirname, '..', 'public', 'img', 'migra-logo-escuro.jpg');

const C = { green: '#0B2A1E', green2: '#14402F', gold: '#D4AF37', ink: '#1d1d1f', gray: '#6e6e73', line: '#e3e6e4', soft: '#F4F7F5' };

const COMMON = [
  'Certidões da Interpol e da Polícia Nacional do Paraguai',
  'Orientação documental e preparação do dossiê',
  'Agendamentos, protocolo e acompanhamento junto aos órgãos',
  'Suporte em português do início ao fim',
];

/** O que cada pacote inclui (para o PDF). */
export function packageInfo(name) {
  const n = String(name || '').toLowerCase();
  const empresa = (tipo) => ({ category: 'EMPRESARIAL', subtitle: `Cédula Paraguaia, RUC, Licença de Condução e Empresa ${tipo}`, includes: ['Cédula de Identidade Paraguaia', 'Cédula Tributária (RUC)', 'Licença de Condução (carro ou moto)', `Abertura de Empresa ${tipo}`] });
  if (n.includes('unipersonal')) return empresa('Unipersonal');
  if (n.includes('eas')) return empresa('por Ações Simplificadas (EAS)');
  if (n.includes('s.a')) return empresa('Sociedade Anônima (S.A.)');
  if (n.includes('estudantil')) return { category: 'MIGRATÓRIO', subtitle: 'Admissão Temporária Mercosul', includes: ['Admissão Temporária Mercosul (estudantes)'] };
  if (n.includes('ouro')) return { category: 'MIGRATÓRIO', subtitle: 'Cédula Paraguaia, Cédula Tributária (RUC) e Licença de Condução', includes: ['Cédula de Identidade Paraguaia', 'Cédula Tributária (RUC)', 'Licença de Condução (carro ou moto)'] };
  if (n.includes('prata')) return { category: 'MIGRATÓRIO', subtitle: 'Cédula Paraguaia e Cédula Tributária (RUC)', includes: ['Cédula de Identidade Paraguaia', 'Cédula Tributária (RUC)'] };
  if (n.includes('inicial')) return { category: 'MIGRATÓRIO', subtitle: 'Residência Precária, Admissão Temporária e Cédula Paraguaia', includes: ['Residência precária e admissão temporária', 'Cédula de Identidade Paraguaia'] };
  return { category: 'SERVIÇO', subtitle: '', includes: [] };
}

const err = (status, message) => Object.assign(new Error(message), { status });
const clean = (s, max = 80) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const addDays = (iso, d) => {
  const [y, m, day] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day + d));
  return dt.toISOString().slice(0, 10);
};

export class Quotes {
  constructor({ store, dataDir, secret, matchPackage }) {
    Object.assign(this, { store, secret, matchPackage });
    this.dir = path.join(dataDir, 'orcamentos');
    store.data.quotes ||= [];
  }

  get config() {
    return this.store.settings.quotes || {};
  }

  get list() {
    return this.store.data.quotes;
  }

  token(id) {
    return crypto.createHmac('sha256', this.secret).update(`orc:${id}`).digest('base64url').slice(0, 16);
  }

  /** Próximo número: o "próximo número" do painel, que avança a cada orçamento emitido. */
  #nextNumber(year) {
    const n = Math.max(1, Math.round(Number(this.config.nextNumber) || 1));
    this.store.settings.quotes = { ...this.config, nextNumber: n + 1 };
    return `ORC-${year}-${String(n).padStart(5, '0')}`;
  }

  /** items: [{ pacote, quantidade }]; adults: adultos (taxa das certidões). */
  create({ items, adults, client = '', phone = '', consultant = '', leadId = null, convKey = null, start = todayIso() }) {
    const rows = [];
    for (const it of items || []) {
      const pkg = this.matchPackage(it.pacote || it.name);
      if (!pkg) throw err(400, `Pacote não encontrado: ${it.pacote || it.name}. Pacotes: ${(this.store.settings.crm?.packages || []).map((p) => p.name).join(', ')}`);
      const qty = Math.max(1, Math.round(Number(it.quantidade ?? it.qty) || 1));
      const same = rows.find((r) => r.name === pkg.name);
      if (same) {
        same.qty += qty;
        same.total = same.qty * same.price;
      } else rows.push({ name: pkg.name, price: Number(pkg.price), qty, total: Number(pkg.price) * qty, ...packageInfo(pkg.name) });
    }
    if (!rows.length) throw err(400, 'Informe ao menos um pacote');
    const people = rows.reduce((s, r) => s + r.qty, 0);
    const total = rows.reduce((s, r) => s + r.total, 0);
    const pay = this.store.settings.payments || {};
    const plan = paymentPlan({
      total, people, adults: Number(adults) || people, start,
      base: pay.reservation?.base ?? 1000,
      perAdult: pay.reservation?.perAdult ?? 800,
      steps: pay.plan?.steps?.length ? pay.plan.steps : DEFAULT_STEPS,
    });
    const year = Number(start.slice(0, 4));
    const rec = {
      id: crypto.randomBytes(6).toString('hex'),
      number: this.#nextNumber(year),
      client: clean(client) || 'Cliente',
      phone: String(phone || '').replace(/\D/g, ''),
      consultant: clean(consultant) || this.config.consultant || 'Equipe Migra',
      items: rows,
      plan,
      issued: start,
      validUntil: addDays(start, Number(this.config.validityDays) || 7),
      leadId,
      convKey,
      createdAt: new Date().toISOString(),
    };
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.file(rec), this.pdf(rec));
    this.list.push(rec);
    if (this.list.length > 3000) this.list.splice(0, this.list.length - 3000);
    this.store.save();
    return rec;
  }

  file(rec) {
    return path.join(this.dir, `${rec.number}.pdf`);
  }

  get(id, t) {
    const rec = this.list.find((q) => q.id === id);
    if (!rec || t !== this.token(id)) return null;
    return rec;
  }

  /** Mensagem do WhatsApp no formato que a equipe já usa. */
  message(rec, link = '') {
    const p = rec.plan;
    return [
      `*Orçamento ${rec.number}* 🇵🇾`,
      '',
      '*Serviços*',
      ...rec.items.map((r) => `• ${r.name.toUpperCase()}${r.qty > 1 ? ` × ${r.qty}` : ''}`),
      '',
      `*Total: ${money(p.total)}*`,
      '',
      '*Pagamento no PIX*',
      `• Entrada: ${money(p.entry)}`,
      `   ${money(p.base)} de sinal de contratação dos serviços + ${money(p.perAdult * p.adults)} (${money(p.perAdult)} × ${p.adults} adulto${p.adults > 1 ? 's' : ''}) das certidões da Interpol e da Polícia Nacional do Paraguai`,
      ...p.parcels.map((x) => `• ${x.label} (${x.pct}%) · ${fmtBr(x.date)}: ${money(x.value)}`),
      '',
      `Válido até ${fmtBr(rec.validUntil)}`,
      link ? `\n*PDF do orçamento:* ${link}` : '',
    ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n').trim();
  }

  /** PDF de uma página (mais páginas só se houver muitos pacotes). */
  pdf(rec) {
    const W = PAGE.W;
    const M = 36;
    const c = new PdfCanvas();
    const cfg = this.config;
    const pay = this.store.settings.payments || {};
    const company = typeof pay.company === 'object' && pay.company ? pay.company : { name: pay.company };
    const p = rec.plan;

    // Cabeçalho verde com a logo e os dados do orçamento.
    c.rect(0, 0, W, 132, { fill: C.green });
    c.rect(0, 132, W, 3, { fill: C.gold });
    try {
      c.image(fs.readFileSync(LOGO), M - 6, 22, 210);
    } catch {
      c.text('MIGRA PARAGUAI', M, 50, { size: 26, bold: true, color: '#ffffff' });
    }
    const R = W - M;
    c.text('ASSESSORIA MIGRATÓRIA E EMPRESARIAL', R, 26, { size: 7.5, bold: true, color: C.gold, align: 'right', spacing: 0.8 });
    c.text('ORÇAMENTO', R, 40, { size: 20, bold: true, color: '#ffffff', align: 'right', spacing: 1 });
    const numW = c.width(rec.number, { size: 12, bold: true }) + 24;
    c.rect(R - numW, 66, numW, 22, { stroke: C.gold, radius: 11, lineWidth: 1 });
    c.text(rec.number, R - numW / 2, 71.5, { size: 12, bold: true, color: C.gold, align: 'center' });
    c.text('EMISSÃO', R - 118, 98, { size: 6.5, bold: true, color: '#9fb8ad', spacing: 0.6 });
    c.text(fmtBr(rec.issued), R - 118, 107, { size: 10, color: '#ffffff' });
    c.text('VALIDADE', R, 98, { size: 6.5, bold: true, color: '#9fb8ad', align: 'right', spacing: 0.6 });
    c.text(fmtBr(rec.validUntil), R, 107, { size: 10, bold: true, color: '#ffffff', align: 'right' });

    // Cliente e consultor.
    c.rect(0, 135, W, 48, { fill: C.soft });
    c.text('CLIENTE', M, 147, { size: 7, bold: true, color: C.gray, spacing: 0.6 });
    c.text(rec.client.toUpperCase(), M, 158, { size: 12, bold: true, color: C.ink });
    if (rec.phone) c.text(`+${rec.phone}`, M + 170, 160, { size: 9, color: C.gray });
    c.text('CONSULTOR', W / 2 + 40, 147, { size: 7, bold: true, color: C.gray, spacing: 0.6 });
    c.text(rec.consultant, W / 2 + 40, 158, { size: 12, bold: true, color: C.ink });
    c.text('PESSOAS', R, 147, { size: 7, bold: true, color: C.gray, align: 'right', spacing: 0.6 });
    c.text(`${p.people}${p.adults !== p.people ? ` (${p.adults} adulto${p.adults > 1 ? 's' : ''})` : ''}`, R, 158, { size: 12, bold: true, color: C.ink, align: 'right' });

    // Tabela de serviços.
    let y = 200;
    c.text(`SERVIÇOS INCLUSOS (${rec.items.length})`, M, y, { size: 8.5, bold: true, color: C.green, spacing: 1.2 });
    y += 16;
    const col = { n: M + 10, name: M + 30, qty: 372, unit: 470, total: R - 10 };
    const head = () => {
      c.rect(M, y, W - 2 * M, 22, { fill: C.green, radius: 6 });
      c.text('#', col.n, y + 7.5, { size: 7.5, bold: true, color: C.gold });
      c.text('SERVIÇO', col.name, y + 7.5, { size: 7.5, bold: true, color: C.gold, spacing: 0.5 });
      c.text('QTD', col.qty, y + 7.5, { size: 7.5, bold: true, color: C.gold, align: 'center' });
      c.text('VALOR UNIT.', col.unit, y + 7.5, { size: 7.5, bold: true, color: C.gold, align: 'right' });
      c.text('TOTAL', col.total, y + 7.5, { size: 7.5, bold: true, color: C.gold, align: 'right' });
      y += 30;
    };
    head();
    const nameW = col.qty - col.name - 30;
    rec.items.forEach((r, i) => {
      const bullets = [...r.includes, ...COMMON];
      const h = c.measure(r.name.toUpperCase(), nameW, { size: 10.5, bold: true }) + (r.subtitle ? 13 : 0) + 18 + Math.ceil(bullets.length / 2) * 12 + 10;
      if (y + h > PAGE.H - 60) {
        c.addPage();
        y = 40;
        head();
      }
      if (i % 2) c.rect(M, y - 6, W - 2 * M, h, { fill: '#FAFBFA', radius: 6 });
      c.text(String(i + 1), col.n, y, { size: 9.5, color: C.gray });
      let yy = y + c.para(r.name.toUpperCase(), col.name, y, nameW, { size: 10.5, bold: true, color: C.ink });
      if (r.subtitle) {
        c.text(r.subtitle, col.name, yy, { size: 8.5, color: C.gray });
        yy += 13;
      }
      const chipW = c.width(r.category, { size: 6.5, bold: true }) + 14;
      c.rect(col.name, yy + 1, chipW, 12, { fill: '#E5F2EA', radius: 6 });
      c.text(r.category, col.name + 7, yy + 4, { size: 6.5, bold: true, color: '#1f7a46' });
      yy += 18;
      const half = Math.ceil(bullets.length / 2);
      const bw = (R - col.name) * 0.54;
      bullets.forEach((b, k) => {
        const bx = col.name + (k < half ? 0 : bw);
        const by = yy + (k % half) * 12;
        c.rect(bx, by + 2.5, 3.5, 3.5, { fill: C.gold, radius: 1.75 });
        c.text(b, bx + 8, by, { size: 7.5, color: '#3a3a3c' });
      });
      c.text(String(r.qty), col.qty, y, { size: 10, color: C.ink, align: 'center' });
      c.text(money(r.price), col.unit, y, { size: 10, color: C.ink, align: 'right' });
      c.text(money(r.total), col.total, y, { size: 10, bold: true, color: C.ink, align: 'right' });
      y += h;
      c.line(M, y - 6, R, y - 6, { color: C.line });
    });

    // Resumo financeiro (direita) e confiança + como reservar (esquerda).
    const boxH = 250;
    if (y + boxH + 70 > PAGE.H) {
      c.addPage();
      y = 40;
    }
    y += 8;
    const fx = W / 2 + 14;
    const fw = R - fx;
    c.rect(fx, y, fw, boxH, { fill: C.green, radius: 12 });
    let fy = y + 16;
    c.text('RESUMO FINANCEIRO', fx + 16, fy, { size: 7.5, bold: true, color: C.gold, spacing: 1 });
    fy += 18;
    c.text('Investimento total', fx + 16, fy, { size: 9, color: '#cfe0d7' });
    c.text(money(p.total), fx + fw - 16, fy + 12, { size: 20, bold: true, color: C.gold, align: 'right' });
    fy += 42;
    c.rect(fx + 10, fy, fw - 20, boxH - (fy - y) - 10, { fill: C.green2, radius: 8 });
    fy += 11;
    c.text('PAGAMENTO NO PIX', fx + 20, fy, { size: 7, bold: true, color: C.gold, spacing: 0.8 });
    fy += 16;
    const row = (label, date, value, { bold = false } = {}) => {
      c.text(label, fx + 20, fy, { size: 8.5, bold, color: '#ffffff' });
      if (date) c.text(date, fx + 20, fy + 10.5, { size: 7, color: '#9fb8ad' });
      c.text(money(value), fx + fw - 20, fy, { size: 9, bold: true, color: '#ffffff', align: 'right' });
      fy += date ? 24 : 15;
    };
    row('Entrada (na reserva)', fmtBr(rec.issued), p.entry, { bold: true });
    c.text(`${money(p.base)} sinal de contratação dos serviços`, fx + 26, fy - 4, { size: 6.8, color: '#cfe0d7' });
    c.text(`${money(p.perAdult * p.adults)} certidões Interpol e Polícia Nacional`, fx + 26, fy + 5, { size: 6.8, color: '#cfe0d7' });
    c.text(`(${money(p.perAdult)} por adulto)`, fx + 26, fy + 14, { size: 6.8, color: '#cfe0d7' });
    fy += 28;
    const trip = ['1ª vinda ao Paraguai', '2ª vinda ao Paraguai', 'retirada dos documentos'];
    p.parcels.forEach((x, k) => row(`${x.label} (${x.pct}%)`, `${x.weekday.replace('-feira', '')}, ${fmtBr(x.date)} · ${trip[k] || x.note}`, x.value));

    const lw = fx - M - 14;
    c.rect(M, y, lw, 104, { stroke: C.line, radius: 12, lineWidth: 0.8 });
    c.text('POR QUE ESCOLHER A MIGRA PARAGUAI', M + 16, y + 16, { size: 7.5, bold: true, color: C.green, spacing: 0.9 });
    const why = cfg.why?.length ? cfg.why : [
      'Centenas de brasileiros já atendidos e morando aqui',
      'Escritório próprio em Santa Rita, Alto Paraná',
      'Processo 100% legal e transparente',
      'Atendimento em português do início ao fim',
    ];
    why.slice(0, 4).forEach((w, k) => {
      c.rect(M + 16, y + 37 + k * 15, 4, 4, { fill: C.gold, radius: 2 });
      c.text(w, M + 26, y + 34.5 + k * 15, { size: 8.5, color: C.ink });
    });
    const sy = y + 118;
    c.rect(M, sy, lw, boxH - 118, { fill: C.soft, radius: 12 });
    c.text('COMO RESERVAR', M + 16, sy + 16, { size: 7.5, bold: true, color: C.green, spacing: 0.9 });
    const steps = [
      'Preencha a ficha de dados pelo celular',
      `Pague a entrada no Pix${company.document ? ` (CNPJ ${company.document})` : pay.pixKey ? ` (chave ${pay.pixKey})` : ''}`,
      'Assine o termo da reserva no celular',
      'Já começamos as certidões (7 a 15 dias)',
    ];
    steps.forEach((s, k) => {
      const yy = sy + 34 + k * 19;
      c.rect(M + 16, yy - 2, 13, 13, { fill: C.green, radius: 6.5 });
      c.text(String(k + 1), M + 22.5, yy + 1, { size: 7.5, bold: true, color: C.gold, align: 'center' });
      c.text(s, M + 36, yy + 0.5, { size: 8.3, color: C.ink });
    });
    y += boxH + 14;

    // Termos.
    const terms = `Orçamento válido até ${fmtBr(rec.validUntil)}. Valores por pessoa, conforme a tabela vigente. As datas das parcelas são estimadas a partir da reserva e acompanham as viagens ao Paraguai, confirmadas pela equipe; prazos dependem dos órgãos paraguaios. Esta é uma proposta comercial: a reserva é formalizada com a ficha de dados, o Pix da entrada e o termo da reserva.`;
    y += c.para(terms, M, y, W - 2 * M, { size: 7.3, color: C.gray, lead: 1.4 });

    // Rodapé.
    const fy0 = PAGE.H - 44;
    c.rect(0, fy0, W, 44, { fill: C.green });
    c.text('MIGRA PARAGUAI', M, fy0 + 11, { size: 9, bold: true, color: C.gold, spacing: 1 });
    c.text(`${company.name || 'Migra Paraguai Assessoria LTDA'}${company.document ? ` · CNPJ ${company.document}` : ''} · Seu projeto no Paraguai começa aqui!`, M, fy0 + 24, { size: 7, color: '#cfe0d7' });
    const phone = cfg.phone || company.phone;
    const contact = [phone ? `WhatsApp ${phone}` : '', cfg.email || company.email || '', cfg.instagram || '@migraparaguayassessoria'].filter(Boolean).join(' · ');
    c.text(contact, R, fy0 + 11, { size: 7.5, color: '#ffffff', align: 'right' });
    c.text(cfg.address || company.address || 'Santa Rita - Alto Paraná, Paraguai', R, fy0 + 24, { size: 7, color: '#cfe0d7', align: 'right' });
    return c.toBuffer();
  }
}
