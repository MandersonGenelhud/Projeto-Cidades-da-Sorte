// Telefones de clientes já gravados sem o +55 (só DDD + número): acrescenta o 55 do Brasil, só quando o número é claramente brasileiro
// (DDD que existe, 10 ou 11 dígitos). Sem o 55 o WhatsApp não acha a pessoa e contrato, Pix e resposta não chegam.
// Cada mudança fica registrada (antes e depois) em store.data.phoneFixLog, para conferir ou desfazer. Nunca mexe em número de outro país.
import { withBrazil55, isBrazilLocal } from './utils.js';

const digits = (s) => String(s ?? '').replace(/\D/g, '');
const keepsPlus = (v) => String(v ?? '').trim().startsWith('+');

/**
 * Corrige um valor; devolve o novo texto ou null se não precisa mudar.
 * plus = true mantém o formato "+55..." (campos que o cliente vê e preenche, como o WhatsApp da ficha).
 */
export function fixValue(v, { plus = false } = {}) {
  if (v === undefined || v === null || v === '' || keepsPlus(v)) return null;
  const d = digits(v);
  if (!isBrazilLocal(d.replace(/^0+/, ''))) return null;
  const fixed = withBrazil55(v);
  return plus ? `+${fixed}` : fixed;
}

export function fixPhones(store, { dryRun = false } = {}) {
  const changes = [];
  const apply = (obj, key, where, opts) => {
    const next = fixValue(obj?.[key], opts);
    if (next === null) return;
    changes.push({ where, from: String(obj[key]), to: next });
    if (!dryRun) obj[key] = next;
  };
  const d = store.data;
  for (const l of d.leads || []) apply(l, 'phone', `prospecto ${l.name || l.code || l.id}`);
  for (const q of d.quotes || []) {
    apply(q, 'phone', `orçamento ${q.number}`);
    apply(q.contract?.client, 'whatsapp', `contrato ${q.number}`, { plus: true });
  }
  for (const s of d.sales || []) apply(s.client, 'phone', `venda ${s.legacyNumber || s.number}`);
  for (const f of Array.isArray(d.closing) ? d.closing : []) apply(f.data, 'whatsapp', 'ficha de cadastro', { plus: true });
  for (const c of Object.values(d.conversations || {})) apply(c, 'phone', `conversa ${c.name || c.key}`);
  for (const r of d.legacyContracts || []) apply(r, 'phone', `contrato antigo ${r.number}`);
  for (const r of d.legacyClients || []) apply(r, 'phone', `cliente antigo ${r.name}`);
  if (!dryRun && changes.length) {
    const log = (d.phoneFixLog ||= []);
    log.push({ at: new Date().toISOString(), count: changes.length, changes: changes.slice(0, 500) });
    if (log.length > 20) log.splice(0, log.length - 20);
    store.flush();
  }
  return { count: changes.length, sample: changes.slice(0, 15), dryRun };
}
