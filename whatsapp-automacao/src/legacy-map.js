// Mapa das telas do sistema antigo (sem nenhum dado de cliente) e comparação com o que o Migra Hub já tem.
// Entrada: o captura.json gerado pela ferramenta. Saída: telas, colunas, campos e endereços internos, só os NOMES.
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const pathOf = (u) => {
  try { return new URL(u, 'http://x').pathname.replace(/\/+$/, '') || '/'; } catch { return String(u || '').split('?')[0] || '/'; }
};
const pattern = (p) => p.split('/').map((seg) => (/^\d+$/.test(seg) || /^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(seg) || /^[0-9a-f]{16,}$/i.test(seg) ? ':id' : seg)).join('/');
const top = (list, n) => { const c = new Map(); for (const x of list) c.set(x, (c.get(x) || 0) + 1); return [...c].sort((a, b) => b[1] - a[1]).slice(0, n).map(([x]) => x); };

/** Resumo das telas: um item por tipo de endereço, com títulos, colunas das tabelas e rótulos dos campos. */
export function buildScreenMap(captura) {
  const groups = new Map();
  const menu = new Map();
  for (const p of captura?.pages || []) {
    const key = pattern(pathOf(p.url));
    if (!groups.has(key)) groups.set(key, { path: key, pages: 0, titles: [], headers: [], rowCounts: [], fields: [], inputs: [], files: 0, pdfs: 0 });
    const g = groups.get(key);
    g.pages += 1;
    if (p.title) g.titles.push(String(p.title).trim());
    for (const t of p.tables || []) { g.headers.push(...(t.headers || []).map((h) => String(h).trim()).filter(Boolean)); g.rowCounts.push((t.rows || []).length); }
    for (const f of p.fields || []) if (f.label) g.fields.push(String(f.label).trim().slice(0, 60));
    for (const f of p.inputs || []) if (f.label || f.name) g.inputs.push(String(f.label || f.name).trim().slice(0, 60));
    g.files += (p.arquivos || []).length;
    g.pdfs += (p.pdfs || []).length;
    for (const l of p.links || []) {
      const text = String(l.text || l.label || '').replace(/\s+/g, ' ').trim();
      const href = typeof l === 'string' ? l : l.href || l.url || '';
      if (text && text.length <= 40 && href) menu.set(`${text}|${pattern(pathOf(href))}`, { text, path: pattern(pathOf(href)) });
    }
  }
  const screens = [...groups.values()].map((g) => ({
    path: g.path, pages: g.pages, title: top(g.titles, 1)[0] || '',
    columns: top(g.headers, 30), fields: top(g.fields, 40), inputs: top(g.inputs, 40),
    maxRows: g.rowCounts.length ? Math.max(...g.rowCounts) : 0, files: g.files, pdfs: g.pdfs,
  })).sort((a, b) => b.pages - a.pages);
  const apis = new Map();
  for (const a of captura?.api || []) {
    const key = pattern(pathOf(a.url));
    const first = (function find(j, d = 0) { if (d > 4 || j === null || typeof j !== 'object') return null; if (Array.isArray(j)) return j.find((x) => x && typeof x === 'object' && !Array.isArray(x)) || null; for (const v of Object.values(j)) { const r = find(v, d + 1); if (r) return r; } return null; })(a.json);
    const cur = apis.get(key) || { path: key, calls: 0, keys: [] };
    cur.calls += 1;
    if (first) cur.keys = [...new Set([...cur.keys, ...Object.keys(first)])].slice(0, 40);
    apis.set(key, cur);
  }
  return { generatedAt: new Date().toISOString(), screens, menu: [...menu.values()].slice(0, 200), apis: [...apis.values()].sort((a, b) => b.calls - a.calls) };
}

// O que o Migra Hub já tem, por tema. `ours` é o nome da aba; `status`: tem (igual ou melhor), parcial ou falta.
export const OUR_FEATURES = [
  { re: /dashboard|painel|home|resumo/, theme: 'Painel', ours: 'Painel / Painel executivo', status: 'tem', note: 'Falta gráfico de projeção por escritório' },
  { re: /lead|quiz|distribuic/, theme: 'Leads e distribuição', ours: 'Contatos, Retomar contatos e Equipe (rodízio)', status: 'parcial', note: 'Falta fila com meta por vendedor' },
  { re: /cliente|customer/, theme: 'Clientes', ours: 'Prospectos (CRM) e ficha 360', status: 'tem', note: '' },
  { re: /contrato|gerador|modelo/, theme: 'Contratos', ours: 'Contratos e Vendas, Contratos antigos e assinatura no celular', status: 'parcial', note: 'Faltam modelos Migra Med, Migra Brasil e RUC (precisa do texto)' },
  { re: /processo/, theme: 'Processos', ours: 'Vendas (parcelas) e Documentos', status: 'parcial', note: 'Falta etapa do processo com prazo (funil pós-venda)' },
  { re: /documento/, theme: 'Documentos', ours: 'Documentos (avisos de renovação)', status: 'tem', note: '' },
  { re: /orcamento|proposta/, theme: 'Orçamentos', ours: 'Orçamentos (7 dias, reativar)', status: 'tem', note: 'Lembrete automático no dia 5 ainda não' },
  { re: /servico|catalogo/, theme: 'Serviços', ours: 'Pacotes fixos da base', status: 'falta', note: 'Falta catálogo de serviços editável (preço, prazo, comissão)' },
  { re: /financeiro|receber|debito|pagamento/, theme: 'Financeiro', ours: 'Vendas, Cobrança e Previsão de recebimento', status: 'parcial', note: 'Falta débito (acréscimo/multa) e histórico por contrato em uma tela' },
  { re: /cobranca|vencimento|inadimpl|atras/, theme: 'Cobrança', ours: 'Cobrança de vencidos com aprovação', status: 'tem', note: '' },
  { re: /caixa|despesa|contabil/, theme: 'Caixa e contabilidade', ours: 'Caixa (só administradores)', status: 'parcial', note: 'Falta caixa da contabilidade separado e categorias fixas' },
  { re: /comiss|saque/, theme: 'Comissões e saques', ours: 'Comissões por venda', status: 'parcial', note: 'Falta saque (vendedor pede, administrador aprova) e níveis por meta' },
  { re: /relatorio|projecao/, theme: 'Relatórios', ours: 'Painel executivo e Previsão', status: 'parcial', note: 'Falta exportar CSV por período e relatório de desativados' },
  { re: /auditoria|log/, theme: 'Auditoria', ours: 'Auditoria', status: 'parcial', note: 'Falta filtro por tipo e exportar CSV' },
  { re: /marketing|campanha|direcao/, theme: 'Marketing', ours: 'Marketing (Meta)', status: 'parcial', note: 'Falta ligar a conta real e o funil até o contrato' },
  { re: /reuniao|live|meet|video/, theme: 'Reuniões', ours: 'Live, Videochamadas e Reuniões gravadas', status: 'tem', note: '' },
  { re: /cidade|guia/, theme: 'Guia de Cidades', ours: 'Guia de Cidades (45 cidades)', status: 'parcial', note: 'Faltam os contatos reais de cada cidade' },
  { re: /tutorial|curso|aula/, theme: 'Tutoriais e curso', ours: 'Tutoriais e treinamento semanal', status: 'parcial', note: 'Faltam trazer as 13 aulas' },
  { re: /imobili|lote|terreno|imovel/, theme: 'Imobiliária', ours: 'Imóveis e loteamentos com mapa de lotes', status: 'tem', note: 'Painel separado por domínio ainda não' },
  { re: /prospec|apify/, theme: 'Prospecção (Apify)', ours: 'Não fazemos', status: 'falta', note: 'Deixado de fora de propósito (risco de bloqueio e spam)' },
  { re: /despachante/, theme: 'Despachante', ours: 'Não fazemos', status: 'falta', note: 'Sem dados no sistema antigo' },
  { re: /usuario|equipe|vendedor|permiss/, theme: 'Equipe e permissões', ours: 'Equipe (administrador geral, do escritório, gerente)', status: 'tem', note: '' },
];

/** Para cada tela do mapa, o que já temos (ou "falta"). Telas sem correspondência ficam como "conferir". */
export function compareMap(map) {
  const rows = (map.screens || []).filter((s) => s.pages).map((s) => {
    const text = fold(`${s.path} ${s.title} ${(s.columns || []).join(' ')}`);
    const hit = OUR_FEATURES.find((f) => f.re.test(text));
    return { path: s.path, title: s.title, pages: s.pages, columns: s.columns.slice(0, 12), fields: s.fields.slice(0, 12), theme: hit?.theme || 'Sem correspondência', ours: hit?.ours || '—', status: hit?.status || 'conferir', note: hit?.note || 'Tela que não reconheci: confirme se precisamos dela' };
  });
  const byStatus = rows.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {});
  return { rows, byStatus };
}
