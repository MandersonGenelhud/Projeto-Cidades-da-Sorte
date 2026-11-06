// Lista de compras da Ana: cada item vai sozinho para o tipo de loja onde se compra
// ("lâmpada" → material de construção; "martelo" → ferramentas; "leite" → mercado; "remédio" → farmácia).
// A pessoa pode corrigir ("o martelo é da casa de ferramentas") e a Ana aprende (guarda a preferência dela).
import { fold1 as fold } from './ana-dates.js';

export const STORES = ['Mercado', 'Farmácia', 'Material de construção', 'Ferramentas e ferragens', 'Pet shop', 'Papelaria e escritório', 'Eletrônicos', 'Roupas e calçados', 'Casa e decoração', 'Automotivo', 'Outros'];

// Palavras (sem acento, no singular) de cada loja. Vence a palavra MAIS ESPECÍFICA (a mais longa): "lâmpada do carro" é automotivo.
const KEYWORDS = {
  'Mercado': ['leite', 'arroz', 'feijao', 'carne', 'frango', 'peixe', 'ovo', 'pao', 'cafe', 'acucar', 'sal', 'oleo', 'azeite', 'macarrao', 'massa', 'molho', 'queijo', 'presunto', 'manteiga', 'margarina', 'iogurte', 'fruta', 'banana', 'maca', 'laranja', 'limao', 'verdura', 'legume', 'alface', 'tomate', 'cebola', 'alho', 'batata', 'cenoura', 'refrigerante', 'suco', 'cerveja', 'vinho', 'agua', 'papel higienico', 'papel toalha', 'sabao', 'detergente', 'amaciante', 'desinfetante', 'agua sanitaria', 'esponja', 'sabonete', 'shampoo', 'condicionador', 'creme dental', 'pasta de dente', 'escova de dente', 'desodorante', 'bolacha', 'biscoito', 'cereal', 'aveia', 'farinha', 'chocolate', 'sorvete', 'congelado', 'tempero', 'saco de lixo', 'guardanapo', 'cafe em po', 'bolo', 'requeijao', 'tapioca', 'granola'],
  'Farmácia': ['remedio', 'dipirona', 'paracetamol', 'ibuprofeno', 'vitamina', 'curativo', 'band-aid', 'protetor solar', 'repelente', 'antialergico', 'xarope', 'pomada', 'termometro', 'fralda', 'absorvente', 'preservativo', 'colirio', 'soro', 'anticoncepcional', 'medicamento', 'remedio para'],
  'Material de construção': ['lampada', 'tomada', 'interruptor', 'fio', 'cabo eletrico', 'extensao', 'disjuntor', 'fita isolante', 'cimento', 'areia', 'tijolo', 'tinta', 'pincel', 'rolo de pintura', 'massa corrida', 'silicone', 'torneira', 'cano', 'registro', 'mangueira', 'piso', 'azulejo', 'argamassa', 'rejunte', 'verniz', 'lixa', 'cola pvc', 'luminaria', 'chuveiro', 'resistencia', 'sifao', 'cola de madeira'],
  'Ferramentas e ferragens': ['martelo', 'chave de fenda', 'chave philips', 'alicate', 'furadeira', 'parafusadeira', 'serra', 'serrote', 'parafuso', 'prego', 'bucha', 'trena', 'nivel', 'broca', 'chave inglesa', 'chave de boca', 'cadeado', 'dobradica', 'fechadura', 'ferramenta', 'marreta', 'esquadro', 'formao', 'espatula', 'grampo', 'maleta de ferramentas'],
  'Pet shop': ['racao', 'areia de gato', 'coleira', 'petisco', 'brinquedo de cachorro', 'antipulgas', 'shampoo de cachorro', 'caixa de transporte', 'comedouro', 'sache'],
  'Papelaria e escritório': ['caneta', 'caderno', 'papel sulfite', 'grampeador', 'pasta', 'lapis', 'borracha', 'cola', 'tesoura', 'toner', 'cartucho', 'envelope', 'post-it', 'agenda', 'marcador', 'clips', 'fita adesiva', 'papel a4'],
  'Eletrônicos': ['carregador', 'cabo usb', 'fone', 'pilha', 'mouse', 'teclado', 'pen drive', 'hd', 'ssd', 'capinha', 'pelicula', 'tv', 'notebook', 'celular', 'adaptador', 'powerbank', 'bateria externa', 'hdmi', 'roteador', 'camera'],
  'Roupas e calçados': ['camisa', 'camiseta', 'calca', 'bermuda', 'sapato', 'tenis', 'meia', 'cueca', 'gravata', 'terno', 'cinto', 'jaqueta', 'blusa', 'vestido', 'chinelo', 'sandalia', 'bone', 'sapatenis', 'paleto'],
  'Casa e decoração': ['toalha', 'lencol', 'travesseiro', 'cobertor', 'panela', 'prato', 'copo', 'talher', 'faca de cozinha', 'vassoura', 'rodo', 'balde', 'cortina', 'tapete', 'almofada', 'quadro', 'vaso', 'cabide', 'organizador', 'edredom', 'espelho', 'utensilio', 'jarra'],
  'Automotivo': ['oleo do motor', 'pneu', 'pastilha de freio', 'filtro de oleo', 'filtro de ar', 'palheta', 'bateria do carro', 'aditivo', 'fluido de freio', 'lampada do carro', 'tapete do carro', 'oleo do carro', 'lampada da moto', 'pastilha', 'filtro do carro'],
};

// Como a pessoa nomeia a loja ("lista do mercado", "casa de ferramentas", "na farmácia").
const NAMES = [
  ['Automotivo', /\b(automotiv\w*|auto ?pecas?|autopecas?|oficina|mecanic\w*)\b/],
  ['Ferramentas e ferragens', /\b(ferramentas?|ferragens?|ferragista)\b/],
  ['Material de construção', /\b(material de construcao|materiais de construcao|construcao|deposito de construcao|eletrica)\b/],
  ['Farmácia', /\b(farmacia|drogaria|remedios)\b/],
  ['Pet shop', /\b(pet ?shop|petshop|pet|veterinari\w*)\b/],
  ['Papelaria e escritório', /\b(papelaria|escritorio)\b/],
  ['Eletrônicos', /\b(eletronicos?|informatica)\b/],
  ['Roupas e calçados', /\b(roupas?|calcados?|loja de roupa|sapataria)\b/],
  ['Casa e decoração', /\b(casa e decoracao|decoracao|utilidades|utilidades domesticas)\b/],
  ['Mercado', /\b(mercado|supermercado|mercadinho|hortifruti|padaria|feira|acougue)\b/],
];

/** A loja que a pessoa NOMEOU na frase, ou '' ("na farmácia" → Farmácia). */
export function storeFromName(text) {
  const n = fold(text);
  for (const [store, re] of NAMES) if (re.test(n)) return store;
  return '';
}

const has = (n, kw) => new RegExp(`(^|[^a-z0-9])${kw.replace(/ /g, '[ -]?')}(s|es)?([^a-z0-9]|$)`).test(n);

/** A loja de um item. `learned` é o que a pessoa já ensinou ({ "martelo": "Ferramentas e ferragens" }); depois vêm as palavras conhecidas. */
export function storeOf(item, learned = {}) {
  const n = fold(item).replace(/[^a-z0-9 -]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!n) return 'Outros';
  for (const [k, v] of Object.entries(learned)) if (n.includes(k) && STORES.includes(v)) return v;
  let best = ''; let bestLen = 0;
  for (const [store, list] of Object.entries(KEYWORDS)) {
    for (const kw of list) if (kw.length > bestLen && has(n, kw)) { best = store; bestLen = kw.length; }
  }
  return best || 'Outros';
}

const NUMBERS = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, meia: 0.5, duzia: 12 };

/**
 * "leite, 2 litros de suco e pão" → [{ nome: 'Leite', qtd: '' }, { nome: 'Suco', qtd: '2 litros' }, { nome: 'Pão', qtd: '' }].
 * Tira os restos da frase ("preciso comprar", "na lista do mercado", "quando eu for ao mercado").
 */
export function parseShoppingItems(text) {
  let t = String(text ?? '')
    .replace(/\b(ana|oi|ola|ol[aá]),?\s*/gi, ' ')
    .replace(/\b(preciso|precisamos|tenho que|temos que|quero|estou precisando|to precisando|precisando)\s+(de\s+)?(comprar\s+)?/gi, ' ')
    .replace(/\b(me lembre?|lembre[- ]?me|me lembra|lembra(?:r)?[- ]?me)\s+de\s+(comprar\s+)?/gi, ' ')
    .replace(/\b(acabou|acabaram|faltou|faltam|falta|esta faltando|ta faltando|est[aá] faltando)\s+(o|a|os|as)?\s*/gi, ' ')
    .replace(/\b(adicione|adiciona|anote|anota|coloque|coloca|inclua|inclui|compre|comprar)\s+/gi, ' ')
    .replace(/\b(na|no|à|a)\s+lista(\s+(de|do|da)\s+[\p{L} ]+?)?(?=$|[,.;!?])/giu, ' ')
    .replace(/\b(quando|se)\s+eu\s+(for|ir)\s+(ao|no|na|à|a|para o|para a|pro|pra)\s+[\p{L} ]+/giu, ' ')
    .replace(/\b(na|no|da|do)\s+(lista\s+(de\s+|do\s+|da\s+)?)?(compras|mercado|supermercado|farm[aá]cia|ferramentas|constru[cç][aã]o)\b/giu, ' ')
    .replace(/\s+/g, ' ').trim();
  t = t.replace(/^[\s,.:;!-]+|[\s,.:;!-]+$/g, '');
  if (!t) return [];
  const parts = t.split(/\s*(?:,|;|\be\b|\bmais\b)\s*/i).map((x) => x.trim()).filter(Boolean);
  const out = [];
  for (let p of parts) {
    p = p.replace(/^(o|a|os|as|um|uma|uns|umas)\s+/i, (m) => (/^(um|uma)\s/i.test(m) ? '' : '')).trim();
    let qtd = '';
    const m = p.match(/^(\d+(?:[.,]\d+)?|um|uma|dois|duas|tres|três|quatro|cinco|seis|sete|oito|nove|dez|meia|d[uú]zia)\s*(?:(?:d[uú]zias?|litros?|l|kg|quilos?|g|gramas?|pacotes?|caixas?|unidades?|un|latas?|garrafas?|metros?|m|pe[cç]as?|sacos?|fardos?|potes?)\s+(?:de\s+)?)?(.+)$/i);
    if (m && m[2] && (/^\d/.test(m[1]) || NUMBERS[fold(m[1])] !== undefined) && !/^\d+$/.test(m[2])) {
      const unit = p.slice(m[1].length, p.length - m[2].length).trim().replace(/\s+de$/i, '');
      qtd = `${m[1]}${unit ? ` ${unit}` : ''}`.trim();
      p = m[2].trim();
    }
    p = p.replace(/^(de|do|da)\s+/i, '').replace(/\s+/g, ' ').trim();
    if (p && p.length <= 60) out.push({ nome: p.charAt(0).toUpperCase() + p.slice(1), qtd });
  }
  return out.slice(0, 30);
}
