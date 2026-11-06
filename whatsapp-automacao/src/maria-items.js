// Vários pacotes no mesmo pedido ("5 Ouro, 1 Estudantil e 1 Inicial, com 10% de desconto"): lê a lista e o desconto do texto, sem IA.
// O texto é só dado: aqui só saem pacotes que existem na tabela, quantidades de 1 a 50 e um desconto numérico.

export const MAX_DISCOUNT = 15; // limite do orçamento do sistema (acima disso, só o Marcos)
const fold = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const WORDS = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12 };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NUM = '(\\d{1,2}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)';
const num = (s) => (/^\d+$/.test(s) ? Number(s) : WORDS[s] || 0);

/** "Pacote Ouro" → "ouro"; "Pacote Empresa (EAS)" → "empresa eas". */
const keyOf = (name) => fold(name).replace(/\bpacote\b/g, '').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();

/** Desconto pedido, em %: { pct, erro }. pct null = não pediu. */
export function parseDiscount(text) {
  const n = fold(text).replace(/,/g, '.');
  const m = n.match(/desconto(?:\s+de)?\s+(?:de\s+)?(\d{1,3}(?:\.\d+)?)\s*(?:%|por ?cento)?/) || n.match(/(\d{1,3}(?:\.\d+)?)\s*(?:%|por ?cento)\s*(?:de\s+)?(?:desconto|off)\b/) || n.match(/\bcom\s+(\d{1,3}(?:\.\d+)?)\s*(?:%|por ?cento)/);
  if (!m) return { pct: null };
  const v = Number(m[1]);
  if (!Number.isFinite(v)) return { pct: null };
  if (v > MAX_DISCOUNT) return { pct: null, erro: `o desconto máximo que consigo aplicar no orçamento é ${MAX_DISCOUNT}%. Acima disso só o Marcos autoriza: peça a ele e me diga o valor liberado.` };
  if (!Number.isInteger(v)) return { pct: null, erro: 'o desconto do orçamento é em número inteiro (por exemplo 5%, 10% ou 15%). Qual percentual aplico?' };
  return { pct: v };
}

/**
 * Pacotes e quantidades citados. names: nomes da tabela. Retorna [{ pacote, qtd }] (mesmo pacote citado duas vezes soma).
 * "infantil" vira o Pacote Estudantil (o que a tabela tem para criança/estudante).
 */
export function parseItems(text, names) {
  const list = (names || []).filter(Boolean);
  let n = fold(text).replace(/\binfantil(?:\s+estudantil)?\b/g, 'estudantil').replace(/\bestudantil\s+infantil\b/g, 'estudantil');
  const keys = list.map((name) => ({ name, key: keyOf(name) })).filter((k) => k.key).sort((a, b) => b.key.length - a.key.length);
  const hits = [];
  const taken = [];
  for (const k of keys) {
    const re = new RegExp(`(?<![a-z0-9])${esc(k.key)}(?![a-z0-9])`, 'g');
    for (const m of n.matchAll(re)) {
      const s = m.index; const e = s + m[0].length;
      if (taken.some(([a, b]) => s < b && e > a)) continue;
      taken.push([s, e]);
      hits.push({ name: k.name, s, e });
    }
  }
  hits.sort((a, b) => a.s - b.s);
  const out = [];
  for (const h of hits) {
    const before = n.slice(Math.max(0, h.s - 40), h.s);
    const after = n.slice(h.e, h.e + 12);
    const mb = before.match(new RegExp(`${NUM}\\s*(?:x\\s*)?(?:pacotes?\\s*)?(?:de\\s*)?(?:pacotes?\\s*)?(?:do\\s*)?$`));
    const ma = after.match(/^\s*(?:x|×)\s*(\d{1,2})\b/);
    const qtd = Math.min(50, Math.max(1, (mb && num(mb[1])) || (ma && Number(ma[1])) || 1));
    const explicit = Boolean(mb || ma);
    const prev = out.find((o) => o.pacote === h.name);
    if (prev) { prev.qtd = Math.min(50, prev.qtd + qtd); prev.explicit ||= explicit; } else out.push({ pacote: h.name, qtd, explicit });
  }
  return out;
}

export const peopleOf = (itens) => (itens || []).reduce((s, i) => s + (Number(i.qtd) || 0), 0);
export const describeItems = (itens) => (itens || []).map((i) => `${i.qtd > 1 ? `${i.qtd} × ` : ''}${i.pacote}`).join(', ');
