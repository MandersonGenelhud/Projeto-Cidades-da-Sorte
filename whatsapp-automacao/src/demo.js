// Dados de exemplo: enche o painel (vendedores, clientes, rodízio, vendas e ranking)
// para mostrar o sistema funcionando antes de usar de verdade. Tudo fica marcado
// com demo: true e sai com um clique.
const SELLERS = [
  ['Ana Souza (exemplo)', 'exemplo.ana', '5511912345678'],
  ['Bruna Melo (exemplo)', 'exemplo.bruna', '5511945678901'],
  ['Carla Dias (exemplo)', 'exemplo.carla', '595981222333'],
  ['João Lima (exemplo)', 'exemplo.joao', '5511923456789'],
  ['Pedro Rocha (exemplo)', 'exemplo.pedro', '5511934567890'],
];
// nome, @, anúncio, temperatura, pacote, pessoas, dinheiro, frase do cliente, quando, resumo, etapa final
const CLIENTS = [
  ['Carlos Andrade', 'carlos.andrade', 'Residência no Paraguai em 90 dias', 'quente', 'Pacote Ouro', 2, 'sim', 'já tenho a entrada guardada', 'dezembro', 'Casal quer morar em Assunção.', 'ganho'],
  ['Fernanda Luz', 'fe.luz', '', 'quente', 'Pacote Prata', 1, 'sim', 'consigo pagar essa semana', 'ainda este ano', 'Trabalha remoto, quer morar em Encarnación.', 'proposta'],
  ['Marcelo Pinto', 'marcelo.pinto', '', 'morno', 'Pacote Empresa Unipersonal', 1, 'parcial', 'tenho metade do valor', 'início do ano', 'Quer abrir empresa; dúvida sobre impostos.', 'em_contato'],
  ['Lúcia Ramos', 'lucia.ramos', 'Residência no Paraguai em 90 dias', 'quente', 'Pacote Inicial', 4, 'sim', 'vendemos o carro para isso', 'janeiro', 'Família de 4 pessoas.', 'ganho'],
  ['Tatiane Costa', 'tati.costa', '', 'quente', 'Pacote Ouro', 1, 'sim', 'tenho o valor', 'agora', 'Aposentada, quer se mudar logo.', 'proposta'],
  ['Diego Matos', 'diego.matos', 'Abra sua empresa no Paraguai', 'quente', 'Pacote Empresa (EAS)', 2, 'sim', 'a empresa paga', 'dezembro', 'Dois sócios abrindo empresa.', 'em_contato'],
];

export function hasDemo(store) {
  return store.data.leads.some((l) => l.demo) || store.data.users.some((u) => u.demo);
}

export async function loadDemo({ store, auth, crm, router, admin }) {
  if (hasDemo(store)) throw Object.assign(new Error('Os dados de exemplo já estão carregados'), { status: 400 });
  const sellers = SELLERS.map(([name, login, whatsapp]) => {
    const u = auth.get(auth.create({ name, login, password: 'exemplo123', whatsapp }).id);
    u.demo = true;
    return u;
  });
  let n = 0;
  for (const [nome, handle, ad, temp, pacote, pessoas, rec, frase, quando, resumo, etapa] of CLIENTS) {
    n++;
    const key = `ig:demo${n}`;
    crm.ensureFromConversation({ key, username: handle, name: `@${handle}`, channel: 'instagram', ...(ad ? { referral: { title: ad } } : {}) });
    await router.route({ key, name: `@${handle}`, username: handle, messages: [{ role: 'user', content: frase }] },
      { resumo, temperatura: temp, nome, pacote, pessoas, tem_recursos: rec, evidencia_recursos: frase, quando_quer_iniciar: quando });
    const lead = crm.findForConversation({ key });
    lead.demo = true;
    const owner = auth.get(lead.ownerId);
    if (etapa === 'proposta' || etapa === 'ganho') crm.update(owner, lead.id, { stage: 'proposta' });
    if (etapa === 'ganho') {
      crm.update(owner, lead.id, { stage: 'ganho', closedValue: lead.value });
      crm.confirmSale(admin, lead.id);
    }
  }
  // Um cliente frio, com retorno agendado para o ano que vem.
  const cold = crm.create(admin, { name: 'Rafael Nunes', instagram: 'rafa.nunes', source: 'instagram', interest: 'Pacote Estudantil' });
  const l = crm.leads.find((x) => x.id === cold.id);
  l.demo = true;
  crm.followUp(admin, cold.id, { date: `${new Date().getFullYear() + 1}-02-01`, reason: 'Estudante: começa em fevereiro, sem o valor agora' });
  store.save();
  return { sellers: sellers.length, leads: CLIENTS.length + 1 };
}

export function clearDemo(store) {
  const ids = new Set(store.data.users.filter((u) => u.demo).map((u) => u.id));
  store.data.leads = store.data.leads.filter((l) => !l.demo);
  for (const l of store.data.leads) if (ids.has(l.ownerId)) l.ownerId = null;
  store.data.users = store.data.users.filter((u) => !u.demo);
  for (const k of Object.keys(store.data.conversations)) if (k.startsWith('ig:demo')) delete store.data.conversations[k];
  store.save();
}
