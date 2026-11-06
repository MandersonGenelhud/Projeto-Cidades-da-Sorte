// Resumo AO VIVO do Grupo Migra para a Maria (a secretária da equipe): imóveis e loteamentos, financiamento de lotes, veículos,
// catálogo de serviços e quem cuida de cada setor. Vem direto do sistema (sempre atual), sem dado de cliente e sem inventar nada.
// O texto fixo do grupo (o que opera, o que está em desenvolvimento) fica em src/agent/presets.js (GROUP_KNOWLEDGE).

const SYMBOL = { BRL: 'R$', USD: 'US$', PYG: 'Gs.' };
const money = (v, c = 'BRL') => `${SYMBOL[c] || c} ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: c === 'PYG' ? 0 : 2, maximumFractionDigits: c === 'PYG' ? 0 : 2 })}`;
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const DEAL = { venda: 'venda', aluguel: 'aluguel', alquiler: 'aluguel' };
const TYPES = { terreno: 'terreno', lote: 'lote', casa: 'casa', departamento: 'apartamento', galpao: 'galpão', fazenda: 'fazenda/chácara', local: 'ponto comercial' };

/** O que o sistema diz sobre o financiamento próprio de lotes (planos da Migra Imobiliária). */
export function financeLines(cfg) {
  if (!cfg) return [];
  const out = [`- Financiamento próprio de lotes: entrada mínima de ${cfg.minEntryPct}% do valor do lote (a entrada abate do saldo e pode ser dividida em até ${cfg.maxEntryParts} vezes), parcelamento em até ${cfg.maxInstallments} parcelas${cfg.reserveFee > 0 ? `, taxa de reserva de ${money(cfg.reserveFee)}` : ''}; a proposta vale por ${cfg.validDays} dias até o pagamento da reserva.`];
  const bands = Array.isArray(cfg.bands) ? cfg.bands : [];
  if (bands.length && bands.every((b) => !(Number(b.interestPct) > 0))) {
    out.push('- Juros do financiamento: os percentuais AINDA NÃO foram definidos pelo Marcos (aparecem 0% por padrão). Não diga "sem juros" nem informe valor de parcela de memória: use a simulação do sistema (Imobiliária → Financiamento) ou confirme com o Marcos ou o Gabriel.');
  } else if (bands.length) {
    let prev = 0;
    out.push(`- Juros por faixa (total sobre o saldo financiado): ${bands.map((b) => { const t = `${prev + 1} a ${b.upTo} parcelas: ${b.interestPct}%`; prev = b.upTo; return t; }).join('; ')}. Para valores exatos, use a simulação do sistema.`);
  }
  return out;
}

/**
 * Texto com os dados atuais. Providers: realty (Realty), finance (config do financiamento), motors (Motors), catalog (ServiceCatalog),
 * crm (settings.crm), auth (usuários). Tudo opcional: o que faltar simplesmente não aparece.
 */
export function groupLiveBrief({ realty = null, finance = null, motors = null, catalog = null, crm = null, auth = null, now = () => new Date() } = {}) {
  const out = ['# DADOS ATUAIS DO GRUPO MIGRA (direto do sistema, sem dado de cliente)'];

  if (realty) {
    out.push('', '## Migra Imobiliária');
    const props = realty.listProperties({ publicOnly: true });
    if (props.length) {
      const by = {};
      for (const p of props) by[p.status] = (by[p.status] || 0) + 1;
      out.push(`Imóveis avulsos publicados: ${props.length} (${Object.entries(by).map(([k, v]) => `${v} ${k}`).join(', ')}).`);
      for (const p of props.slice(0, 20)) {
        out.push(`- ${clip(p.title, 90)} — ${TYPES[p.type] || p.type || 'imóvel'}, ${DEAL[p.deal] || p.deal || ''}, ${[p.neighborhood, p.city].filter(Boolean).join(', ')}${p.areaText ? `, ${p.areaText}` : ''}${p.price ? `, ${money(p.price, p.currency)}${p.perMonth ? '/mês' : ''}` : ', preço a consultar'}, ${p.status}`);
      }
      if (props.length > 20) out.push(`…e mais ${props.length - 20} imóveis no catálogo do sistema.`);
    } else out.push('Nenhum imóvel avulso publicado no momento.');
    const devs = realty.listDevelopments();
    for (const d of devs) {
      const s = d.summary || realty.summary(d);
      const avail = d.lots.filter((l) => l.status === 'disponivel' && l.price);
      const prices = avail.map((l) => l.price).sort((a, b) => a - b);
      const areas = avail.map((l) => Number(l.area)).filter((a) => a > 0).sort((a, b) => a - b);
      out.push(`- Loteamento ${clip(d.name, 80)} (${[d.city, clip(d.address, 80)].filter(Boolean).join(' — ')}): ${s.total} lotes, ${s.disponivel} disponíveis, ${s.reservado} reservados, ${s.vendido} vendidos${prices.length ? `; lotes disponíveis de ${money(prices[0], d.currency)} a ${money(prices.at(-1), d.currency)}${areas.length ? `, de ${areas[0]} a ${areas.at(-1)} m²` : ''}` : ''}${d.agentName ? `; responsável: ${d.agentName}` : ''}.${d.description ? ` ${clip(d.description, 280)}` : ''}`);
    }
    if (!devs.length) out.push('Nenhum loteamento cadastrado no momento.');
    out.push(...financeLines(finance));
  }

  if (motors) {
    const vs = motors.vehicles({ publicOnly: true });
    out.push('', '## Migra Motors (veículos)');
    if (vs.length) {
      out.push(`Veículos publicados: ${vs.length}.`);
      for (const v of vs.slice(0, 15)) out.push(`- ${clip(v.title, 90)}${v.km ? `, ${Number(v.km).toLocaleString('pt-BR')} km` : ''}${v.price ? `, ${money(v.price, v.currency)}` : ', preço a consultar'}${v.city ? `, ${v.city}` : ''}, ${v.status}`);
    } else out.push('Nenhum veículo publicado no momento (a frente de veículos ainda está em desenvolvimento).');
    const lenders = motors.lenders?.() || [];
    if (lenders.length) out.push(`Financiadoras cadastradas para simulação: ${lenders.map((l) => l.name).join(', ')}.`);
  }

  if (catalog) {
    const list = catalog.list({ active: true }).filter((x) => x.price > 0);
    if (list.length) {
      out.push('', '## Catálogo de serviços e preços-base (sistema)');
      const by = {};
      for (const s of list) (by[s.category] ||= []).push(s);
      let lines = 0;
      for (const [cat, items] of Object.entries(by)) {
        out.push(`${cat}:`);
        for (const s of items) { if (lines++ >= 80) break; out.push(`- ${clip(s.name, 90)} — ${money(s.price, s.currency)}${s.durationDays ? ` (prazo ${s.durationDays} dias)` : ''}`); }
      }
      out.push('Preço de tabela por serviço; condições, descontos e prazos finais são confirmados pela equipe.');
    }
  }

  // Oferta do aplicativo de idiomas que a atendente de IA pode usar como última carta (configurada pelo Marcos no painel).
  const ao = crm?.appOffer;
  const d = now();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (ao && ao.enabled !== false && ao.validUntil && ao.validUntil >= today && Number(ao.regularPrice) > 0) {
    const pct = Math.min(90, Math.max(1, Number(ao.discountPct) || 50));
    const promo = Math.floor(Number(ao.regularPrice) * (100 - pct)) / 100;
    out.push('', '## Oferta do aplicativo de idiomas (a atendente de IA usa como última carta)', `Vigente até ${ao.validUntil.split('-').reverse().join('/')}: ${Math.max(1, Number(ao.months) || 6)} meses com ${pct}% de desconto (de ${money(ao.regularPrice)} ${ao.period || 'por mês'} por ${money(promo)}), para quem fechar a reserva. É diferente da cortesia de 1 ano, que é decisão exclusiva do Marcos.`);
  }

  const sectors = crm?.sectors ? Object.values(crm.sectors) : [];
  const spec = Array.isArray(crm?.specialists) ? crm.specialists.filter((x) => x?.name) : [];
  if (sectors.length || spec.length) {
    out.push('', '## Quem cuida de quê (setores)');
    for (const sct of sectors) {
      const names = (sct.people || []).map((id) => auth?.get?.(id)?.name).filter(Boolean);
      const who = names.length ? names.join(' e ') : sct.only || '';
      if (sct.label && who) out.push(`- ${sct.label}: ${who}`);
    }
    for (const x of spec) out.push(`- ${x.topic || 'Especialista'}: ${x.name}`);
  }
  return out.join('\n');
}

/** Visão geral do sistema interno (Migra Hub) e das assistentes, para a equipe tirar dúvidas com a Maria. */
export const HUB_OVERVIEW = `# MIGRA HUB (o sistema interno da equipe): o que existe
- Painel e Prospectos (CRM): funil de vendas, retornos agendados, setores e rodízio de atendentes, transferência entre vendedores.
- Conversas: atendente de IA no número principal e nos números da equipe; Instagram; fila de clientes esperando resposta.
- Orçamentos e Contratos: orçamento em PDF, ficha de dados do cliente, contrato com assinatura pelo celular, vendas com parcelas e comissões.
- Cobrança de vencidos (com aprovação do administrador), Financeiro e Caixa (só administradores liberados), previsão de recebimento.
- Indicadores e afiliados (comissões, saques), ranking e metas de vendedores.
- Imobiliária (imóveis, loteamentos com mapa de lotes, financiamento próprio de lotes, propostas), Motors (veículos e simulação de financiamento), School (alunos), Contábil (empresas clientes, obrigações, honorários), Migratech (clientes, contratos, serviços), Migra Devocional (cadastros do aplicativo).
- Documentos, tarefas e lembretes da equipe, suporte interno, marketing (leitura), auditoria e segurança (2FA obrigatória, registro de acessos, backup cifrado).
- Assistentes no WhatsApp: Maria (secretária da empresa: consulta contratos, clientes e relatórios; cria cadastro novo, orçamento e contrato; envia ficha e contrato ao cliente com confirmação), Ana (assistente pessoal de cada administrador: agenda, lembretes, financeiro pessoal e lista de compras, separado da empresa) e Nina (caixa da empresa por texto e áudio). A Maria e a Ana só criam e enviam: nunca excluem nem alteram nada; se alguém pedir, o Marcos é avisado.`;

/** Decisões da direção que só a equipe deve saber (a Maria NÃO as repassa ao cliente como promessa). */
export const STAFF_RULES = `# REGRAS INTERNAS DA DIREÇÃO (só para a equipe: nunca prometa isto a um cliente por conta própria)
- Cortesia da Migra School: quando o cliente ainda hesita em fechar, o Marcos costuma dar 1 ano de Migra School como cortesia, para ajudar na decisão, mostrando que o curso o acompanha no dia a dia no Paraguai (mercado, escola dos filhos, trabalho, trânsito, compra e venda, câmbio). A decisão é SÓ do Marcos: o vendedor deve pedir autorização a ele antes de oferecer; não ofereça nem confirme a cortesia por conta própria.`;
