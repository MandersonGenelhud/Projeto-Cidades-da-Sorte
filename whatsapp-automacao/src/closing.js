// Fechamento da reserva, na ordem combinada com a Migra:
// 1) a atendente manda o link da ficha de dados (já vem com o que sabemos do cliente);
// 2) o cliente preenche e envia: o sistema agradece e manda o Pix da reserva;
// 3) em seguida vai o termo da reserva, montado com os dados dele, para assinar no celular.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { documentPdf } from './pdfdoc.js';

const err = (status, message) => Object.assign(new Error(message), { status });
const money = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const digits = (s) => String(s || '').replace(/\D/g, '');
const clean = (s, max = 200) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export const ESTADO_CIVIL = ['Solteiro(a)', 'Casado(a)', 'União estável', 'Divorciado(a)', 'Separado(a)', 'Viúvo(a)'];

/** Campos da ficha. req = obrigatório. */
export const FORM_FIELDS = [
  { k: 'nome', label: 'Nome completo', req: true },
  { k: 'cpf', label: 'CPF', req: true },
  { k: 'rg', label: 'RG', req: true },
  { k: 'rgOrgao', label: 'Órgão emissor' },
  { k: 'nascimento', label: 'Data de nascimento', req: true },
  { k: 'nacionalidade', label: 'Nacionalidade', req: true },
  { k: 'estadoCivil', label: 'Estado civil', req: true },
  { k: 'profissao', label: 'Profissão' },
  { k: 'email', label: 'E-mail' },
  { k: 'whatsapp', label: 'WhatsApp', req: true },
  { k: 'cep', label: 'CEP' },
  { k: 'rua', label: 'Rua / avenida', req: true },
  { k: 'numero', label: 'Número', req: true },
  { k: 'complemento', label: 'Complemento' },
  { k: 'bairro', label: 'Bairro', req: true },
  { k: 'cidade', label: 'Cidade', req: true },
  { k: 'uf', label: 'Estado (UF)', req: true },
  { k: 'adultos', label: 'Adultos no processo', req: true },
  { k: 'acompanhantes', label: 'Quem mais vai no processo' },
  { k: 'objetivo', label: 'Objetivo' },
];

/** Confere os dígitos verificadores do CPF. */
export function validCpf(value) {
  const c = digits(value);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (len) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(c[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}
export const fmtCpf = (v) => digits(v).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');

export const DEFAULT_TERM = `TERMO DE RESERVA E INÍCIO DE PROCESSO

Pelo presente termo, de um lado {empresa}, {empresa_documento}, com endereço em {empresa_endereco}, doravante CONTRATADA, e de outro lado {nome}, {nacionalidade}, {estado_civil}, {profissao}, portador(a) do RG nº {rg} e inscrito(a) no CPF sob o nº {cpf}, nascido(a) em {nascimento}, residente em {endereco}, doravante CLIENTE, ajustam o que segue.

1. OBJETO. O CLIENTE reserva o início do seu processo de {servico} junto aos órgãos competentes do Paraguai, com a assessoria da CONTRATADA, para {adultos} adulto(s){acompanhantes_txt}, conforme as condições apresentadas no atendimento.

2. RESERVA. O valor da reserva é de {valor_reserva}, pago por Pix, e garante a abertura e a organização do processo do CLIENTE. O valor da reserva é abatido do valor total do serviço contratado.

3. DADOS E DOCUMENTOS. O CLIENTE declara que os dados informados são verdadeiros e autoriza a CONTRATADA a usá-los exclusivamente para a preparação e o andamento do seu processo, guardando-os com sigilo, nos termos da Lei Geral de Proteção de Dados (Lei nº 13.709/2018). A lista de documentos e as etapas do processo são informadas pela CONTRATADA no atendimento.

4. PRAZOS. Os prazos informados são estimativas e dependem dos órgãos públicos do Paraguai. A CONTRATADA não garante prazo exato nem a aprovação, que cabem às autoridades competentes, e se compromete a acompanhar o processo com zelo e a manter o CLIENTE informado.

5. DESISTÊNCIA. Em caso de desistência do CLIENTE, aplicam-se as condições de cancelamento informadas pela CONTRATADA no atendimento.

6. ASSINATURA ELETRÔNICA. As partes reconhecem como válida a assinatura deste termo por meio eletrônico, com registro de data, hora, endereço IP e dispositivo, nos termos do art. 10, § 2º, da Medida Provisória nº 2.200-2/2001.

{cidade_data}`;

export class Closing {
  /**
   * sendTo(convKey, payload) envia ao cliente; remember(convKey, text) guarda na memória da atendente;
   * notifyAdmins(text) avisa o dono; baseUrl() devolve o endereço público do painel.
   */
  constructor({ store, crm, payments, secret, dataDir, sendTo, remember = () => {}, notifyAdmins = async () => {}, notify = () => {}, baseUrl = () => '' }) {
    Object.assign(this, { store, crm, payments, secret, sendTo, remember, notifyAdmins, notify, baseUrl });
    this.dir = path.join(dataDir, 'fechamento');
    fs.mkdirSync(this.dir, { recursive: true });
    store.data.closing ||= [];
  }

  get list() {
    return this.store.data.closing;
  }

  get config() {
    return this.store.settings.closing || {};
  }

  get enabled() {
    return this.config.enabled !== false;
  }

  get(id) {
    return this.list.find((f) => f.id === id) || null;
  }

  token(id, kind = 'ficha') {
    return crypto.createHmac('sha256', this.secret).update(`${kind}:${id}`).digest('base64url').slice(0, 20);
  }

  #auth(id, t, kind) {
    const f = this.get(id);
    if (!f || t !== this.token(id, kind)) throw err(404, 'Link inválido ou expirado. Peça um novo link no WhatsApp.');
    return f;
  }

  #base() {
    return String(this.baseUrl() || '').replace(/\/+$/, '');
  }

  formUrl(f) {
    return `${this.#base()}/ficha/${f.id}?t=${this.token(f.id)}`;
  }

  termUrl(f) {
    return `${this.#base()}/termo/${f.id}?t=${this.token(f.id, 'termo')}`;
  }

  forLead(leadId) {
    return [...this.list].reverse().find((f) => f.leadId === leadId) || null;
  }

  forConversation(convKey) {
    return [...this.list].reverse().find((f) => f.convKey === convKey) || null;
  }

  /** Cria (ou reaproveita) a ficha do cliente, já preenchida com o que sabemos. */
  createForm({ convKey = null, lead = null, servico = '', adultos = null }) {
    let f = (lead && this.forLead(lead.id)) || (convKey && this.forConversation(convKey));
    if (f && f.term?.status === 'assinado') f = null; // processo novo
    if (!f) {
      f = { id: crypto.randomBytes(6).toString('hex'), convKey, leadId: lead?.id || null, status: 'enviada', data: {}, createdAt: new Date().toISOString() };
      this.list.push(f);
    }
    f.convKey = convKey || f.convKey;
    const placeholder = !lead?.name || /^@|^\+?\d+$/.test(lead.name);
    const prefill = {
      nome: placeholder ? '' : lead.name,
      whatsapp: lead?.phone ? `+${lead.phone}` : '',
      email: lead?.email || '',
      objetivo: clean(servico) || lead?.interest || '',
      adultos: String(adultos || lead?.people || ''),
      nacionalidade: 'Brasileira',
    };
    for (const [k, v] of Object.entries(prefill)) if (v && !f.data[k]) f.data[k] = v;
    f.sentAt = new Date().toISOString();
    this.store.save();
    if (lead) this.crm.addNote({ name: 'IA', role: 'admin' }, lead.id, '📝 Ficha de dados enviada ao cliente');
    return f;
  }

  publicForm(id, t) {
    const f = this.#auth(id, t, 'ficha');
    const c = this.store.settings.payments?.company || {};
    return {
      status: f.status,
      data: f.data,
      company: c.name || this.store.settings.business?.name || 'Migra',
      brand: this.store.settings.brand?.name || '',
      estadoCivil: ESTADO_CIVIL,
      required: FORM_FIELDS.filter((x) => x.req).map((x) => x.k),
    };
  }

  /** O cliente enviou a ficha. Valida, guarda no CRM e segue para o Pix e o termo. */
  async submitForm(id, t, input, meta = {}) {
    const f = this.#auth(id, t, 'ficha');
    if (f.term?.status === 'assinado') throw err(400, 'Esta ficha já foi usada num termo assinado. Fale com a gente no WhatsApp.');
    const data = {};
    for (const { k } of FORM_FIELDS) data[k] = clean(input[k], k === 'acompanhantes' ? 600 : 200);
    data.uf = data.uf.toUpperCase().slice(0, 2);
    const missing = FORM_FIELDS.filter((x) => x.req && !data[x.k]).map((x) => x.label);
    if (missing.length) throw err(400, `Falta preencher: ${missing.join(', ')}`);
    if (!validCpf(data.cpf)) throw err(400, 'O CPF não parece correto. Confira os números, por favor.');
    data.cpf = fmtCpf(data.cpf);
    if (data.email && !/^\S+@\S+\.\S+$/.test(data.email)) throw err(400, 'Confira o e-mail, por favor.');
    data.adultos = String(Math.max(1, Math.min(20, Number(digits(data.adultos)) || 1)));
    const first = f.status !== 'preenchida';
    Object.assign(f, { data, status: 'preenchida', filledAt: new Date().toISOString(), ip: meta.ip || '', ua: clean(meta.ua, 300) });
    this.store.save();

    const lead = f.leadId ? this.crm.leads.find((l) => l.id === f.leadId) : null;
    if (lead) {
      lead.name = data.nome;
      if (data.email) lead.email = data.email;
      lead.people = Number(data.adultos);
      lead.contractData = this.summary(f);
      lead.closingId = f.id;
      this.crm.addNote({ name: 'Cliente', role: 'admin' }, lead.id, `📝 Ficha preenchida pelo cliente:\n${lead.contractData}`);
    }
    this.notify('closing', { id: f.id, status: f.status });
    if (first) this.afterForm(f).catch((e) => this.store.addLog({ type: 'error', message: `Fechamento depois da ficha: ${e.message}` }));
    return { ok: true, nome: data.nome.split(' ')[0] };
  }

  summary(f) {
    const d = f.data;
    return [
      `Nome: ${d.nome}`, `CPF: ${d.cpf}`, `RG: ${d.rg}${d.rgOrgao ? ` (${d.rgOrgao})` : ''}`, `Nascimento: ${d.nascimento}`,
      `Nacionalidade: ${d.nacionalidade}`, `Estado civil: ${d.estadoCivil}`, d.profissao && `Profissão: ${d.profissao}`,
      d.email && `E-mail: ${d.email}`, `WhatsApp: ${d.whatsapp}`, `Endereço: ${this.address(d)}`,
      `Adultos no processo: ${d.adultos}`, d.acompanhantes && `Acompanhantes: ${d.acompanhantes}`, d.objetivo && `Objetivo: ${d.objetivo}`,
    ].filter(Boolean).join('\n');
  }

  address(d) {
    return [`${d.rua}, ${d.numero}${d.complemento ? ` - ${d.complemento}` : ''}`, d.bairro, `${d.cidade}/${d.uf}`, d.cep && `CEP ${d.cep}`].filter(Boolean).join(', ');
  }

  /** Manda ao cliente e guarda na memória da atendente. Uma falha não interrompe os próximos passos. */
  async #say(f, text, extra = {}) {
    if (!f.convKey) return false;
    try {
      await this.sendTo(f.convKey, { text, ...extra });
      this.remember(f.convKey, text);
      return true;
    } catch (e) {
      this.store.addLog({ type: 'error', message: `Fechamento: mensagem não enviada ao cliente (${e.message})` });
      return false;
    }
  }

  /** Depois da ficha: agradece, manda o Pix da reserva e o termo (se for depois do Pix). */
  async afterForm(f) {
    const first = f.data.nome.split(' ')[0];
    await this.#say(f, `Recebi seus dados, ${first}! ✅ Já ficam guardados aqui para darmos entrada no seu processo.`);
    const pay = this.store.settings.payments || {};
    const canPix = this.payments && pay.enabled !== false && Boolean(pay.pixKey || pay.mercadopago?.accessToken) && this.payments.reservationAmount(1) > 0;
    if (canPix) {
      const amount = this.payments.reservationAmount(Number(f.data.adultos) || 1);
      await this.#say(f, `Agora, para garantir a sua reserva, segue o Pix de ${money(amount)} 👇`);
      const p = await this.payments.create({
        convKey: f.convKey,
        leadId: f.leadId,
        amount,
        description: `${pay.reservation?.description || 'reserva'} - ${f.data.adultos} adulto(s)`,
        payerName: f.data.nome,
        payerDoc: f.data.cpf,
        by: 'IA',
      });
      f.paymentId = p.id;
      this.store.save();
      await this.payments.sendCharge(p);
      this.remember(f.convKey, `[Pix de ${money(amount)} enviado: QR Code e código copia e cola]`);
      const bank = String(pay.bankInfo || '').trim();
      await this.#say(f, `É só copiar o código acima e colar no app do seu banco, na opção Pix copia e cola.${bank ? `\n\nSe preferir, os dados da conta:\n${bank}` : ''}\n\nAssim que pagar, me manda o comprovante por aqui.`);
    } else {
      await this.#say(f, 'Em instantes eu te envio os dados para o pagamento da reserva.');
      await this.notifyAdmins(`📝 *Ficha preenchida*\n👤 ${f.data.nome} · ${f.data.whatsapp}\nO Pix automático não está configurado: envie os dados de pagamento da reserva para o cliente.`).catch(() => {});
    }
    if (this.config.termAfter !== 'payment') await this.sendTerm(f);
    await this.notifyAdmins(`📝 *Ficha de dados preenchida*\n👤 ${f.data.nome} · CPF ${f.data.cpf}\n📍 ${f.data.cidade}/${f.data.uf} · ${f.data.adultos} adulto(s)\n${canPix ? '💳 Pix da reserva enviado' : '⚠️ Enviar o pagamento manualmente'}${this.config.termAfter !== 'payment' ? ' · termo enviado para assinatura' : ''}`).catch(() => {});
  }

  /** Pagamento confirmado: se o termo vai depois do pagamento, envia agora. */
  async onPaid(p) {
    const f = this.list.find((x) => x.paymentId === p.id) || (p.leadId && this.forLead(p.leadId));
    if (!f || f.status !== 'preenchida' || f.term) return;
    if (this.config.termAfter === 'payment') await this.sendTerm(f);
  }

  async sendTerm(f) {
    if (!f.convKey) return;
    f.term = { ...(f.term || {}), status: f.term?.status === 'assinado' ? 'assinado' : 'enviado', sentAt: new Date().toISOString() };
    this.store.save();
    await this.#say(f, `E para darmos entrada no seu processo, preparei o termo da sua reserva com os seus dados. É só abrir, conferir e assinar pelo celular mesmo:\n${this.termUrl(f)}`);
  }

  /** Texto do termo com os dados do cliente. */
  termText(f) {
    const d = f.data;
    const c = this.store.settings.payments?.company || {};
    const pay = f.paymentId ? this.payments?.get(f.paymentId) : null;
    const amount = pay?.amount || this.payments?.reservationAmount(Number(d.adultos) || 1) || 0;
    const when = new Date(f.term?.signedAt || Date.now());
    const city = this.store.settings.payments?.receiverCity || d.cidade;
    const vars = {
      nome: d.nome, cpf: d.cpf, rg: `${d.rg}${d.rgOrgao ? ` ${d.rgOrgao}` : ''}`, nascimento: d.nascimento, nacionalidade: (d.nacionalidade || '').toLowerCase(),
      estado_civil: (d.estadoCivil || '').toLowerCase(), profissao: (d.profissao || 'profissão não informada').toLowerCase(), endereco: this.address(d),
      email: d.email || '', whatsapp: d.whatsapp, servico: d.objetivo || this.store.settings.payments?.reservation?.description || 'residência', adultos: d.adultos,
      acompanhantes_txt: d.acompanhantes ? ` (${d.acompanhantes})` : '', valor_reserva: amount ? money(amount) : 'informado no atendimento',
      empresa: c.name || this.store.settings.business?.name || 'Migra', empresa_documento: c.document ? `inscrita sob o nº ${c.document}` : 'qualificada no atendimento',
      empresa_endereco: c.address || 'informado no atendimento', data: when.toLocaleDateString('pt-BR'),
      cidade_data: `${city ? `${city}, ` : ''}${when.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}.`,
    };
    return String(this.config.termTemplate?.trim() || DEFAULT_TERM).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  }

  publicTerm(id, t) {
    const f = this.#auth(id, t, 'termo');
    if (f.status !== 'preenchida') throw err(400, 'Preencha a ficha de dados antes do termo.');
    return {
      status: f.term?.status || 'enviado',
      text: f.term?.text || this.termText(f),
      nome: f.data.nome,
      cpf: f.data.cpf,
      signedAt: f.term?.signedAt || null,
      pdf: f.term?.status === 'assinado' ? `/termo/${f.id}/pdf?t=${t}` : '',
      company: this.store.settings.payments?.company?.name || this.store.settings.business?.name || 'Migra',
    };
  }

  /** Assinatura no celular: nome, CPF, aceite e o desenho da assinatura (JPEG). */
  async signTerm(id, t, input, meta = {}) {
    const f = this.#auth(id, t, 'termo');
    if (f.status !== 'preenchida') throw err(400, 'Preencha a ficha de dados antes do termo.');
    if (f.term?.status === 'assinado') return { ok: true, already: true };
    if (!input.aceite) throw err(400, 'Marque que leu e concorda com o termo.');
    if (digits(input.cpf) !== digits(f.data.cpf)) throw err(400, 'O CPF não confere com o da ficha.');
    const norm = (s) => clean(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (norm(input.nome) !== norm(f.data.nome)) throw err(400, 'Digite o seu nome completo igual ao da ficha.');
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(input.assinatura || ''));
    const sig = m ? Buffer.from(m[1], 'base64') : null;
    if (!sig || sig.length < 1500 || sig.length > 800_000) throw err(400, 'Faça a sua assinatura no quadro, por favor.');
    const text = this.termText({ ...f, term: { signedAt: new Date().toISOString() } });
    const signedAt = new Date().toISOString();
    const hash = crypto.createHash('sha256').update(text).update(sig).digest('hex');
    fs.writeFileSync(path.join(this.dir, `assinatura-${f.id}.jpg`), sig);
    f.term = { ...(f.term || {}), status: 'assinado', text, signedAt, ip: meta.ip || '', ua: clean(meta.ua, 300), hash };
    fs.writeFileSync(this.termPath(f), this.termPdf(f));
    this.store.save();

    const lead = f.leadId ? this.crm.leads.find((l) => l.id === f.leadId) : null;
    if (lead) this.crm.addNote({ name: 'Cliente', role: 'admin' }, lead.id, `✍️ Termo da reserva assinado pelo cliente (código ${hash.slice(0, 10).toUpperCase()})`);
    this.notify('closing', { id: f.id, status: 'assinado' });
    await this.#say(f, `Termo assinado, ${f.data.nome.split(' ')[0]}! ✍️ Segue a sua via. Agora é com a gente: seu processo já está em andamento.`, { media: { path: this.termPath(f), mimetype: 'application/pdf', fileName: 'Termo-de-reserva.pdf' } });
    await this.notifyAdmins(`✍️ *Termo da reserva assinado*\n👤 ${f.data.nome} · CPF ${f.data.cpf}\n🕒 ${new Date(signedAt).toLocaleString('pt-BR')}\nO PDF assinado está na ficha do cliente no painel.`).catch(() => {});
    return { ok: true };
  }

  termPath(f) {
    return path.join(this.dir, `termo-${f.id}.pdf`);
  }

  termPdf(f) {
    const sigPath = path.join(this.dir, `assinatura-${f.id}.jpg`);
    const [title, ...body] = String(f.term.text).split('\n');
    const at = new Date(f.term.signedAt);
    return documentPdf([
      { text: title, size: 14, bold: true, align: 'center', gap: 0 },
      ...body.map((p) => ({ text: p, size: 10.5, gap: p ? 4 : 2 })),
      { text: 'Assinatura do CLIENTE:', size: 10.5, bold: true, gap: 22, keep: 190 },
      ...(fs.existsSync(sigPath) ? [{ image: fs.readFileSync(sigPath), width: 210, gap: 4 }] : []),
      { rule: true, gap: 2 },
      { text: `${f.data.nome} · CPF ${f.data.cpf}`, size: 10, gap: 2 },
      { text: 'Registro da assinatura eletrônica', size: 10, bold: true, gap: 22 },
      {
        text: `Assinado em ${at.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (horário de Brasília) · IP ${f.term.ip || '-'}\nDispositivo: ${f.term.ua || '-'}\nCódigo de verificação: ${f.term.hash.slice(0, 32).toUpperCase()}`,
        size: 8.5,
        gap: 4,
      },
    ], { footer: `Termo de reserva · ${f.data.nome}` });
  }

  /** Visão para o painel. */
  view(f) {
    return {
      id: f.id, status: f.status, leadId: f.leadId, data: f.data, createdAt: f.createdAt, filledAt: f.filledAt || null,
      term: f.term ? { status: f.term.status, sentAt: f.term.sentAt || null, signedAt: f.term.signedAt || null } : null,
      formUrl: this.formUrl(f), termUrl: f.status === 'preenchida' ? this.termUrl(f) : '',
      termPdf: f.term?.status === 'assinado' ? `/termo/${f.id}/pdf?t=${this.token(f.id, 'termo')}` : '',
    };
  }
}
