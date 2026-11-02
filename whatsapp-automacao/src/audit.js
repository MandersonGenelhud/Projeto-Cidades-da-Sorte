// Trilha de auditoria: registra QUEM criou, alterou ou excluiu cada coisa
// importante (lotes, preços, juros, veículos, alunos…), com o valor de antes
// e o de depois. Só o administrador consulta. O registro não pode ser apagado
// pelo painel (só o limite de tamanho descarta os mais antigos).
import crypto from 'node:crypto';

const MAX_ENTRIES = 5000;
export const FIELD_LABELS = {
  price: 'Preço', status: 'Situação', area: 'Área', code: 'Código', block: 'Quadra', number: 'Número', note: 'Observação',
  title: 'Título', name: 'Nome', rentPrice: 'Aluguel', currency: 'Moeda', city: 'Cidade', description: 'Descrição',
  year: 'Ano', km: 'Km', brand: 'Marca', model: 'Modelo', stage: 'Etapa', level: 'Nível', active: 'Ativo',
  interestPct: 'Juros (%)', bands: 'Faixas de juros', minEntryPct: 'Entrada mínima (%)', reserveFee: 'Taxa de reserva',
  maxInstallments: 'Máximo de parcelas', validDays: 'Validade (dias)', manager: 'Gerente', sectors: 'Áreas', role: 'Perfil',
};
// Mudanças nestes campos aparecem destacadas para o Marcos (dinheiro e juros).
export const SENSITIVE = new Set(['price', 'rentPrice', 'interestPct', 'bands', 'minEntryPct', 'reserveFee', 'maxInstallments', 'role', 'manager', 'sectors']);
const IGNORED = new Set(['updatedAt', 'createdAt', 'shape', 'images', 'plan', 'planRatio', 'id', 'slug', 'lots', 'summary']);

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const short = (v) => {
  if (v === undefined || v === null || v === '') return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
};

/** Diferenças campo a campo entre dois objetos (só campos conhecidos e que mudaram). */
export function diff(before, after) {
  const out = [];
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const k of keys) {
    if (IGNORED.has(k)) continue;
    if (same(before?.[k], after?.[k])) continue;
    out.push({ field: k, label: FIELD_LABELS[k] || k, from: short(before?.[k]), to: short(after?.[k]), sensitive: SENSITIVE.has(k) });
  }
  return out;
}

export class Audit {
  constructor({ store }) {
    this.store = store;
    store.data.auditLog ||= [];
  }

  get log() {
    return this.store.data.auditLog;
  }

  record({ user, ip = '', action, entity, label = '', changes = [], note = '' }) {
    const e = {
      id: crypto.randomBytes(5).toString('hex'),
      at: new Date().toISOString(),
      userId: user?.id || '',
      user: user?.name || String(user || 'sistema'),
      role: user?.role || '',
      ip,
      action,
      entity,
      label,
      changes,
      sensitive: changes.some((c) => c.sensitive) || action === 'excluiu',
      note,
    };
    this.log.push(e);
    if (this.log.length > MAX_ENTRIES) this.log.splice(0, this.log.length - MAX_ENTRIES);
    this.store.save();
    return e;
  }

  /** Consulta com filtros simples. Mais recente primeiro. */
  list({ user, entity, action, sensitive, q, from, to, limit = 200 } = {}) {
    const needle = String(q || '').trim().toLowerCase();
    return [...this.log]
      .reverse()
      .filter((e) => (!user || e.user === user || e.userId === user)
        && (!entity || e.entity === entity)
        && (!action || e.action === action)
        && (!sensitive || e.sensitive)
        && (!from || e.at >= from)
        && (!to || e.at <= to)
        && (!needle || `${e.label} ${e.user} ${e.note} ${e.changes.map((c) => `${c.label} ${c.from} ${c.to}`).join(' ')}`.toLowerCase().includes(needle)))
      .slice(0, Math.min(Number(limit) || 200, 1000));
  }

  /**
   * Middleware: para cada regra que casa com a rota, tira uma "foto" do objeto
   * antes e depois do pedido e registra o que mudou. Pedidos que falham não registram.
   * regra: { methods, re, entity, label(match, obj, body), get(match, req) → objeto|null }
   */
  middleware(rules) {
    return (req, res, next) => {
      if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return next();
      let rule; let match;
      for (const r of rules) {
        if (!r.methods.includes(req.method)) continue;
        match = r.re.exec(req.path);
        if (match) { rule = r; break; }
      }
      if (!rule) return next();
      let before = null;
      try { before = rule.get?.(match, req) ? JSON.parse(JSON.stringify(rule.get(match, req))) : null; } catch { before = null; }
      let sent;
      const json = res.json.bind(res);
      res.json = (body) => { sent = body; return json(body); };
      res.on('finish', () => {
        if (res.statusCode >= 400) return;
        try {
          let after = null;
          try { after = rule.get?.(match, req) ? JSON.parse(JSON.stringify(rule.get(match, req))) : null; } catch { after = null; }
          if (req.method === 'POST' && !after && sent && typeof sent === 'object' && !Array.isArray(sent)) after = sent;
          const action = req.method === 'DELETE' ? 'excluiu' : (before ? 'alterou' : 'criou');
          const obj = after || before || {};
          const changes = action === 'alterou' ? diff(before, after) : action === 'criou' ? diff({}, after).filter((c) => c.sensitive) : diff(before, {}).filter((c) => c.sensitive);
          if (action === 'alterou' && !changes.length) return;
          this.record({
            user: req.user, ip: String(req.ip || '').replace(/^::ffff:/, ''), action, entity: rule.entity,
            label: rule.label ? rule.label(match, obj, req.body) : '', changes,
            note: Array.isArray(sent) ? `${sent.length} item(ns)` : '',
          });
        } catch { /* auditoria nunca derruba o pedido */ }
      });
      next();
    };
  }
}
