// IA a serviço do CRM: lê as conversas para preencher os prospectos e
// analisa os números de vendas para dar sugestões ao dono.
import { toDateStr, WEEKDAYS } from './agent/calendar.js';

const EXTRACT_EVERY_MS = 10 * 60_000; // no máximo uma leitura por conversa a cada 10 min

/** Pega o primeiro objeto JSON de um texto (a IA às vezes escreve algo antes). */
export function parseJsonObject(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

export class CrmAi {
  constructor({ store, llm, crm, now = () => new Date() }) {
    this.store = store;
    this.llm = llm;
    this.crm = crm;
    this.now = now;
    this.lastRun = new Map(); // conversa -> horário da última leitura
    this.running = new Set();
  }

  get enabled() {
    return this.store.settings.crm?.aiExtract !== false && this.llm.configured;
  }

  /** Chamado depois de cada resposta: lê a conversa (com intervalo) e atualiza o prospecto. */
  async afterReply(conv, { force = false } = {}) {
    if (!this.enabled || !conv || String(conv.key).startsWith('sim:')) return null;
    const key = conv.key;
    if (this.running.has(key)) return null;
    if (!force && Date.now() - (this.lastRun.get(key) || 0) < EXTRACT_EVERY_MS) return null;
    const lead = this.crm.findForConversation({ key, phone: conv.phone });
    if (!lead) return null;
    this.running.add(key);
    this.lastRun.set(key, Date.now());
    try {
      const info = await this.extract(conv);
      if (info) this.crm.applyAi(lead, info);
      return info;
    } catch (err) {
      this.store.addLog({ type: 'error', message: `IA do CRM: ${err.message}` });
      return null;
    } finally {
      this.running.delete(key);
    }
  }

  async extract(conv) {
    const now = this.now();
    const packages = (this.store.settings.crm?.packages || []).map((p) => p.name);
    const transcript = conv.messages
      .slice(-30)
      .map((m) => `${m.role === 'user' ? 'Cliente' : 'Atendimento'}: ${m.content}`)
      .join('\n');
    const system = `Você lê conversas de atendimento de "${this.store.settings.business.name}" e preenche o CRM de vendas.
Hoje é ${WEEKDAYS[now.getDay()]}, ${toDateStr(now)}.
Responda SOMENTE com um objeto JSON, sem texto antes ou depois, com estas chaves (use null quando não souber, nunca invente):
{"nome": string|null, "cidade": string|null, "objetivo": string|null,
 "pacote": uma destas opções exatamente ou null: ${JSON.stringify(packages)},
 "pessoas": número|null,
 "etapa": "em_contato" | "proposta" | null,
 "retorno_data": "AAAA-MM-DD"|null, "motivo_espera": string|null,
 "resumo": string curta (até 2 frases) com o que o cliente quer e o próximo passo}
Regras: "proposta" só se o cliente já recebeu valores. "retorno_data" só se o cliente disse que quer decidir/voltar a falar numa data ou período ("dia 15 de novembro", "mês que vem", "ano que vem", "daqui 2 anos"); para períodos vagos, use o primeiro dia útil do período.`;
    const reply = await this.llm.chat({ messages: [{ role: 'system', content: system }, { role: 'user', content: transcript }] });
    return parseJsonObject(reply.content);
  }

  /** Consultor de vendas: lê os números e devolve sugestões práticas para o dono. */
  async advise(stats, extra = {}) {
    if (!this.llm.configured) throw Object.assign(new Error('Configure a chave da IA na aba "Agente IA"'), { status: 400 });
    const system = `Você é um consultor de vendas experiente ajudando ${extra.ownerName || 'o dono'} da empresa "${this.store.settings.business.name}" (${this.store.settings.business.segment}).
Analise os números do CRM e escreva em português do Brasil, direto ao ponto, para um empresário sem tempo:
1. Um resumo de 2 frases sobre como estão as vendas.
2. Os 3 pontos de atenção mais importantes (com números).
3. De 3 a 5 ações práticas para esta semana (quem faz o quê), incluindo os retornos atrasados e os prospectos parados.
4. Uma ideia para aumentar a conversão, baseada nos motivos de perda e de espera.
Use frases curtas, listas com hífen e nada de tabelas. Não invente números que não estejam nos dados.`;
    const reply = await this.llm.chat({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Dados do CRM (JSON):\n${JSON.stringify({ ...stats, ...extra.context }, null, 1)}` },
      ],
    });
    const text = String(reply.content || '').trim();
    this.store.data.crmInsights = { at: new Date().toISOString(), text };
    this.store.save();
    return this.store.data.crmInsights;
  }
}
