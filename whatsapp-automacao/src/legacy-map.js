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
  // A ordem importa: o primeiro que combina vale. Endereços do sistema antigo estão em inglês (contracts, processes…).
  { re: /suporte|support|ticket/, theme: 'Suporte', ours: 'Suporte (chamados com prazo de resposta e solução)', status: 'tem', note: '' },
  { re: /withdraw|saque/, theme: 'Saques de comissão', ours: 'Comissões e saques (vendedores) e saque dos indicadores em 24h', status: 'tem', note: '' },
  { re: /commission|comiss|goals|meta|seller.level|nivel/, theme: 'Comissões e metas', ours: 'Comissões e saques (Jornada Raiz, Ponte, Horizonte, Legado)', status: 'tem', note: '' },
  { re: /dashboard|painel|home|resumo/, theme: 'Painel', ours: 'Painel / Painel executivo', status: 'tem', note: 'Falta gráfico de projeção por escritório' },
  { re: /leads?.?quiz|quiz/, theme: 'Leads do quiz', ours: 'Retomar contatos (origem Quiz)', status: 'parcial', note: 'O quiz passa a entrar pelo site novo' },
  { re: /lead|distribuic/, theme: 'Leads e distribuição', ours: 'Retomar contatos (leads importados) e Equipe (rodízio)', status: 'parcial', note: 'Falta fila com limite de leads abertos por vendedor' },
  { re: /customer|cliente/, theme: 'Clientes', ours: 'Prospectos (CRM) e Ficha do cliente (360)', status: 'tem', note: '' },
  { re: /contracts?.?generator|gerador|public.?link|\/form\b/, theme: 'Gerador de contratos (links públicos)', ours: 'Ficha de dados e assinatura pelo celular; atalho /contrato', status: 'tem', note: '' },
  { re: /template|modelo/, theme: 'Modelos de contrato', ours: 'Serviços → Modelos de contrato (Migra Paraguai, Med, Brasil, RUC)', status: 'parcial', note: 'Med, Brasil e RUC geram o texto; assinatura pelo celular só no modelo atual' },
  { re: /contract|contrato/, theme: 'Contratos', ours: 'Contratos (quadros), Contratos e vendas e Contratos antigos', status: 'tem', note: '' },
  { re: /process/, theme: 'Processos', ours: 'Vendas (parcelas), Documentos e Contratos (quadros)', status: 'parcial', note: 'Falta etapa do processo com prazo (funil pós-venda)' },
  { re: /document/, theme: 'Documentos', ours: 'Documentos (avisos de renovação)', status: 'tem', note: '' },
  { re: /proposal|orcamento|proposta/, theme: 'Orçamentos', ours: 'Orçamentos (7 dias, reativar) e atalho /orcamento', status: 'tem', note: '' },
  { re: /service|servico|catalogo/, theme: 'Serviços', ours: 'Serviços (catálogo com preço, prazo e comissão)', status: 'tem', note: '' },
  { re: /cobranca|collection|vencimento|inadimpl|atras/, theme: 'Cobrança', ours: 'Cobrança e previsão (com aprovação)', status: 'tem', note: '' },
  { re: /financ|receber|debito|pagamento/, theme: 'Financeiro', ours: 'Vendas, Cobrança e previsão', status: 'parcial', note: 'Falta débito (acréscimo/multa) e histórico por contrato em uma tela' },
  { re: /contabil|accounting/, theme: 'Contabilidade', ours: 'Caixa (só administradores)', status: 'parcial', note: 'Falta caixa da contabilidade separado (Migra Contabilidade)' },
  { re: /caixa|expense|despesa/, theme: 'Caixa e despesas', ours: 'Caixa (só administradores)', status: 'tem', note: '' },
  { re: /report|relatorio|projecao/, theme: 'Relatórios', ours: 'Painel executivo e Previsão', status: 'parcial', note: 'Falta exportar CSV por período e relatório de desativados' },
  { re: /sales.?audit|audit|auditoria|log/, theme: 'Auditoria', ours: 'Auditoria (quem mexeu)', status: 'parcial', note: 'Falta filtro por tipo e exportar CSV' },
  { re: /contact.?link|link/, theme: 'Links de contato (campanhas)', ours: 'Links dos indicadores e materiais de campanha (com miniatura)', status: 'parcial', note: 'Falta link de campanha da empresa com contagem de cliques' },
  { re: /marketing|campanha|direcao/, theme: 'Marketing', ours: 'Marketing (anúncios da Meta)', status: 'parcial', note: 'Falta ligar a conta real e o funil até o contrato' },
  { re: /live|meeting|reuniao|video|agenda/, theme: 'Reuniões e agenda', ours: 'Live, Videochamadas, Reuniões gravadas e Agenda', status: 'tem', note: '' },
  { re: /cities|cidade|guia/, theme: 'Guia de Cidades', ours: 'Guia de Cidades (45 cidades)', status: 'parcial', note: 'Faltam os contatos reais de cada cidade' },
  { re: /tutorial|curso|aula/, theme: 'Tutoriais e curso', ours: 'Tutoriais e treinamento (com as 14 aulas importadas)', status: 'tem', note: '' },
  { re: /imobili|lote|terreno|imovel/, theme: 'Imobiliária', ours: 'Imóveis e loteamentos com mapa de lotes', status: 'tem', note: 'Painel separado por domínio ainda não' },
  { re: /instagram|prospec|apify/, theme: 'Prospecção no Instagram (Apify)', ours: 'Não fazemos', status: 'falta', note: 'Deixado de fora de propósito (risco de bloqueio e spam)' },
  { re: /whatsapp/, theme: 'WhatsApp e automações', ours: 'Conexões WhatsApp, Agente IA, Respostas automáticas e atalhos', status: 'tem', note: '' },
  { re: /dispatcher|despachante/, theme: 'Despachante', ours: 'Não fazemos', status: 'falta', note: 'Sem dados no sistema antigo' },
  { re: /team.?contact|seller|usuario|users|team|equipe|vendedor|permiss/, theme: 'Equipe e permissões', ours: 'Equipe (administrador geral, do escritório, gerente) e contatos da equipe', status: 'tem', note: '' },
  { re: /settings|configura|cambio/, theme: 'Configurações', ours: 'Configurações', status: 'tem', note: '' },
];

/** Para cada tela do mapa, o que já temos (ou "falta"). Telas sem correspondência ficam como "conferir". */
export function compareMap(map) {
  const rows = (map.screens || []).filter((s) => s.pages).map((s) => {
    // Primeiro pelo endereço da tela; só se não achar, pelas colunas (ex.: a tela de serviços tem a coluna "Comissão %").
    const hit = OUR_FEATURES.find((f) => f.re.test(fold(s.path))) || OUR_FEATURES.find((f) => f.re.test(fold((s.columns || []).join(' '))));
    return { path: s.path, title: s.title, pages: s.pages, columns: s.columns.slice(0, 12), fields: s.fields.slice(0, 12), theme: hit?.theme || 'Sem correspondência', ours: hit?.ours || '—', status: hit?.status || 'conferir', note: hit?.note || 'Tela que não reconheci: confirme se precisamos dela' };
  });
  const byStatus = rows.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {});
  return { rows, byStatus };
}
