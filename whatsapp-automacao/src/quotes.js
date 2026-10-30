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

  /**
   * Calcula sem gravar (prévia ao vivo no painel). items: [{ pacote, quantidade }]; adults: adultos (taxa das certidões);
   * parcels (opcional): parcelas combinadas com o cliente [{ pct, date }], somando 100% do saldo.
   */
  compute({ items, adults, start = todayIso(), parcels = null }) {
    const rows = [];
    for (const it of items || []) {
      if (!it || !(it.pacote || it.name)) continue;
      const pkg = this.matchPackage(it.pacote || it.name);
      if (!pkg) throw err(400, `Pacote não encontrado: ${it.pacote || it.name}. Pacotes: ${(this.store.settings.crm?.packages || []).map((p) => p.name).join(', ')}`);
      const qty = Math.max(1, Math.min(50, Math.round(Number(it.quantidade ?? it.qty) || 1)));
      const same = rows.find((r) => r.name === pkg.name);
      if (same) {
        same.qty += qty;
        same.total = same.qty * same.price;
      } else rows.push({ name: pkg.name, price: Number(pkg.price), qty, total: Number(pkg.price) * qty, ...packageInfo(pkg.name) });
    }
    if (!rows.length) throw err(400, 'Informe ao menos um pacote');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(start))) start = todayIso();
    const people = rows.reduce((s, r) => s + r.qty, 0);
    const total = rows.reduce((s, r) => s + r.total, 0);
    const pay = this.store.settings.payments || {};
    let steps = pay.plan?.steps?.length ? pay.plan.steps : DEFAULT_STEPS;
    let custom = false;
    if (Array.isArray(parcels) && parcels.length) {
      // Parcelas combinadas pelo vendedor: de 1 a 8, percentuais somando 100% do saldo, datas a partir da reserva.
      if (parcels.length > 8) throw err(400, 'No máximo 8 parcelas');
      const sum = parcels.reduce((x, p) => x + Number(p.pct || 0), 0);
      if (Math.abs(sum - 100) > 0.01) throw err(400, `As parcelas precisam somar 100% do saldo (agora somam ${Math.round(sum * 100) / 100}%)`);
      steps = parcels.map((p, i) => {
        const pct = Number(p.pct);
        if (!(pct > 0)) throw err(400, `A ${i + 1}ª parcela precisa de um percentual maior que zero`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.date || '')) || p.date < start) throw err(400, `Data da ${i + 1}ª parcela inválida (a partir da data da reserva)`);
        const days = Math.round((Date.parse(`${p.date}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000);
        return { pct, days, when: `Com ${days} dias`, note: String(p.note || 'Conforme combinado').slice(0, 60) };
      });
      custom = true;
    }
    const plan = paymentPlan({
      total, people, adults: Number(adults) || people, start,
      base: pay.reservation?.base ?? 1000,
      perAdult: pay.reservation?.perAdult ?? 800,
      steps,
    });
    return { items: rows, plan: { ...plan, custom } };
  }

  create({ items, adults, client = '', phone = '', consultant = '', leadId = null, convKey = null, start = todayIso(), parcels = null, createdBy = null }) {
    const { items: rows, plan } = this.compute({ items, adults, start, parcels });
    start = plan.start;
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
      createdBy,
      createdAt: new Date().toISOString(),
    };
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.file(rec), this.pdf(rec));
    this.list.push(rec);
    if (this.list.length > 5000) this.list.splice(0, this.list.length - 5000);
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
    const trip = p.custom ? [] : ['1ª vinda ao Paraguai', '2ª vinda ao Paraguai', 'retirada dos documentos'];
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

    c.para(`Proposta válida até ${fmtBr(rec.validUntil)}. Veja na próxima página como funciona o processo, os documentos para começar e os dados para pagamento.`, M, y, W - 2 * M, { size: 7.5, color: C.gray, lead: 1.4 });

    // ---------- Página 2: processo, documentos, pagamento, condições e responsáveis ----------
    c.addPage();
    c.rect(0, 0, W, 64, { fill: C.green });
    c.rect(0, 64, W, 2, { fill: C.gold });
    try {
      c.image(fs.readFileSync(LOGO), M - 4, 10, 104);
    } catch {
      c.text('MIGRA PARAGUAI', M, 24, { size: 14, bold: true, color: '#ffffff' });
    }
    c.text(`ORÇAMENTO ${rec.number}`, R, 20, { size: 11, bold: true, color: C.gold, align: 'right', spacing: 0.5 });
    c.text(`${rec.client.toUpperCase()} · válido até ${fmtBr(rec.validUntil)}`, R, 36, { size: 8, color: '#cfe0d7', align: 'right' });
    let y2 = 86;
    c.text('COMO FUNCIONA O SEU PROCESSO', M, y2, { size: 9, bold: true, color: C.green, spacing: 1.2 });
    y2 += 20;
    const par = (k) => (p.parcels[k] ? `${p.parcels[k].label}: ${money(p.parcels[k].value)} · ${fmtBr(p.parcels[k].date)}` : '');
    const timeline = [
      ['Reserva', 'Ficha de dados pelo celular, Pix da entrada e termo da reserva assinado no celular.', `Entrada: ${money(p.entry)} · ${fmtBr(rec.issued)}`],
      ['Certidões no Paraguai', 'Emitimos as certidões da Interpol e da Informática da Polícia Nacional (de 7 a 15 dias). Enquanto isso, você organiza os documentos no Brasil com a nossa orientação.', ''],
      ['1ª vinda ao Paraguai', 'Protocolo oficial do pedido e assinatura dos documentos, com a nossa equipe ao seu lado.', p.custom ? '' : par(0)],
      ['2ª vinda ao Paraguai', 'Coleta das digitais e últimas etapas, cerca de 60 a 70 dias úteis depois do protocolo.', p.custom ? '' : par(1)],
      ['Retirada dos documentos', 'A cédula sai em média 20 a 30 dias depois. Com ela, você segue para RUC, empresa e licença, conforme o pacote.', p.custom ? '' : par(2)],
    ];
    const tx = M + 40;
    timeline.forEach(([title, text, money_], k) => {
      const h = 14 + c.measure(text, W - tx - M - 10, { size: 8.3, lead: 1.35 }) + (money_ ? 13 : 0) + 12;
      if (k < timeline.length - 1) c.line(M + 13, y2 + 22, M + 13, y2 + h + 2, { color: C.gold, width: 1.2 });
      c.rect(M + 2, y2, 22, 22, { fill: C.green, radius: 11 });
      c.text(String(k + 1), M + 13, y2 + 6, { size: 9, bold: true, color: C.gold, align: 'center' });
      c.text(title, tx, y2 + 1, { size: 10.5, bold: true, color: C.ink });
      let ty = y2 + 15 + c.para(text, tx, y2 + 15, W - tx - M - 10, { size: 8.3, color: '#3a3a3c', lead: 1.35 });
      if (money_) c.text(money_, tx, ty + 1, { size: 8, bold: true, color: '#1f7a46' });
      y2 += h;
    });
    if (p.custom) {
      y2 += c.para(`Parcelas combinadas com você: ${p.parcels.map((x) => `${x.label} ${money(x.value)} em ${fmtBr(x.date)}`).join(' · ')}.`, tx, y2, W - tx - M - 10, { size: 8, bold: true, color: '#1f7a46', lead: 1.35 }) + 6;
    }
    c.text('Prazos estimados: dependem dos órgãos paraguaios. As datas das viagens são confirmadas pela nossa equipe.', tx, y2, { size: 7.3, color: C.gray });
    y2 += 22;

    // Documentos (esquerda) e pagamento (direita).
    const cw = (W - 2 * M - 14) / 2;
    const boxY = y2;
    c.rect(M, boxY, cw, 128, { fill: C.soft, radius: 12 });
    c.text('DOCUMENTOS PARA COMEÇAR', M + 16, boxY + 16, { size: 7.5, bold: true, color: C.green, spacing: 0.9 });
    const docs = cfg.docs?.length ? cfg.docs : [
      'Foto do RG (frente e verso) ou do passaporte',
      'Foto de meio corpo, bem nítida, fundo claro',
      'Seus dados na ficha (o link chega no WhatsApp)',
      'O restante, a equipe orienta passo a passo',
    ];
    docs.slice(0, 5).forEach((d, k) => {
      const yy = boxY + 38 + k * 19;
      c.rect(M + 16, yy - 1, 10, 10, { stroke: C.green, radius: 2, lineWidth: 1 });
      c.line(M + 18, yy + 4, M + 20.5, yy + 6.5, { color: '#1f7a46', width: 1.4 });
      c.line(M + 20.5, yy + 6.5, M + 24.5, yy + 1.5, { color: '#1f7a46', width: 1.4 });
      c.text(d, M + 33, yy, { size: 8.3, color: C.ink });
    });
    const px = M + cw + 14;
    c.rect(px, boxY, cw, 128, { fill: C.green, radius: 12 });
    c.text('DADOS PARA PAGAMENTO', px + 16, boxY + 16, { size: 7.5, bold: true, color: C.gold, spacing: 0.9 });
    const payRows = [
      ['Forma', 'Pix'],
      ['Chave Pix (CNPJ)', pay.pixKey || company.document || '—'],
      ['Favorecido', company.name || 'Migra Paraguai Assessoria LTDA'],
      ['CNPJ', company.document || '—'],
    ];
    payRows.forEach(([k, v], i) => {
      const yy = boxY + 36 + i * 18;
      c.text(k, px + 16, yy, { size: 7.5, color: '#9fb8ad' });
      c.text(v, px + cw - 16, yy, { size: 8.5, bold: true, color: '#ffffff', align: 'right' });
    });
    c.para('Pague somente no Pix oficial da empresa, nunca para pessoa física. O recibo chega no seu WhatsApp.', px + 16, boxY + 108, cw - 32, { size: 7, color: '#cfe0d7', lead: 1.3 });
    y2 = boxY + 128 + 14;

    // Aviso de validade da reserva.
    c.rect(M, y2, W - 2 * M, 34, { fill: '#FFF8E1', stroke: C.gold, radius: 8, lineWidth: 1 });
    c.text('IMPORTANTE', M + 14, y2 + 8, { size: 7.5, bold: true, color: '#8a6d00', spacing: 0.8 });
    c.text('Este orçamento não garante vaga nem reserva. A reserva só é confirmada após o pagamento da entrada e a assinatura do termo de reserva.', M + 14, y2 + 19, { size: 7.8, color: '#5c4a00' });
    y2 += 48;

    // Condições.
    c.text('CONDIÇÕES', M, y2, { size: 7.5, bold: true, color: C.green, spacing: 0.9 });
    y2 += 13;
    const cond = `Valores por pessoa, conforme a tabela vigente, válidos até ${fmtBr(rec.validUntil)}. A entrada (R$ ${money(p.base).replace('R$ ', '')} de sinal de contratação dos serviços e ${money(p.perAdult)} por adulto das certidões) é descontada do total. Os prazos são estimativas e dependem dos órgãos públicos do Paraguai; a Migra não garante aprovação, que é decisão dos órgãos competentes. Os dados pessoais informados são usados somente para o processo e guardados com segurança. Esta proposta é um documento comercial; as condições finais constam do termo de reserva.`;
    y2 += c.para(cond, M, y2, W - 2 * M, { size: 7.3, color: C.gray, lead: 1.45 }) + 18;

    // Responsáveis (nomes impressos, sem assinatura desenhada).
    const sw = (W - 2 * M - 40) / 2;
    c.line(M, y2 + 22, M + sw, y2 + 22, { color: '#9aa39e', width: 0.8 });
    c.text(company.name || 'Migra Paraguai Assessoria LTDA', M, y2 + 28, { size: 8.5, bold: true, color: C.ink });
    c.text(cfg.director || 'Marcos Miguel · Diretor', M, y2 + 40, { size: 7.8, color: C.gray });
    const sx = M + sw + 40;
    c.line(sx, y2 + 22, sx + sw, y2 + 22, { color: '#9aa39e', width: 0.8 });
    c.text(rec.consultant, sx, y2 + 28, { size: 8.5, bold: true, color: C.ink });
    c.text('Consultor(a) responsável', sx, y2 + 40, { size: 7.8, color: C.gray });

    // Rodapé em todas as páginas.
    const pages = c.pages;
    pages.forEach((pageOps, i) => {
      c.pages = [pageOps];
      const fy0 = PAGE.H - 44;
      c.rect(0, fy0, W, 44, { fill: C.green });
      c.text('MIGRA PARAGUAI', M, fy0 + 11, { size: 9, bold: true, color: C.gold, spacing: 1 });
      c.text(`${company.name || 'Migra Paraguai Assessoria LTDA'}${company.document ? ` · CNPJ ${company.document}` : ''} · Seu projeto no Paraguai começa aqui!`, M, fy0 + 24, { size: 7, color: '#cfe0d7' });
      const phone = cfg.phone || company.phone;
      const contact = [phone ? `WhatsApp ${phone}` : '', cfg.email || company.email || '', cfg.instagram || '@migraparaguayassessoria'].filter(Boolean).join(' · ');
      c.text(contact, R, fy0 + 11, { size: 7.5, color: '#ffffff', align: 'right' });
      c.text(`${cfg.address || company.address || 'Santa Rita - Alto Paraná, Paraguai'} · Página ${i + 1} de ${pages.length}`, R, fy0 + 24, { size: 7, color: '#cfe0d7', align: 'right' });
    });
    c.pages = pages;
    return c.toBuffer();
  }
}
