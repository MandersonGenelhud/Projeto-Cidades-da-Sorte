// Menu enxuto: as telas parecidas ficam juntas em uma seção só.
// O menu lateral mostra só as seções; as telas de cada seção aparecem como
// abas no topo da página. Nenhuma tela foi apagada e as permissões continuam
// as mesmas: cada botão de tela segue com os mesmos atributos (data-admin,
// data-officeadmin, hidden, standby), só mudou de lugar.
(() => {
  const HUBS = [
    { id: 'painel', label: 'Painel', icon: 'executive', tabs: ['executive'] },
    { id: 'clientes', label: 'Clientes', icon: 'customer360', tabs: ['leads', 'customer360', 'contacts', 'reengage', 'groupscov'] },
    { id: 'agenda', label: 'Agenda e retornos', icon: 'followups', tabs: ['followups', 'tasks', 'visits', 'agenda'] },
    { id: 'conversas', label: 'Conversas', icon: 'conversations', tabs: ['conversations', 'lines'] },
    { id: 'vendas', label: 'Vendas e contratos', icon: 'contracts', tabs: ['sales', 'quotes', 'contracts', 'legacy', 'documents'] },
    { id: 'financeiro', label: 'Financeiro', icon: 'cash', tabs: ['collections', 'payments', 'cash', 'commissions'] },
    { id: 'servicos', label: 'Serviços e preços', icon: 'pricing', tabs: ['services', 'pricing'] },
    { id: 'parceiros', label: 'Indicadores e sócios', icon: 'affiliates', tabs: ['affiliates', 'share', 'projects'] },
    { id: 'marketing', label: 'Marketing', icon: 'marketing', tabs: ['marketing', 'campaigns', 'schedules', 'send', 'livepage'] },
    { id: 'ia', label: 'Atendimento automático', icon: 'agent', tabs: ['agent', 'test', 'connection', 'rules'] },
    { id: 'imoveis', label: 'Imóveis e site', icon: 'realty', tabs: ['realty', 'lots', 'finance', 'site'] },
    { id: 'empresas', label: 'Outras empresas', icon: 'motors', tabs: ['motors', 'school'] },
    { id: 'equipe', label: 'Equipe', icon: 'team', tabs: ['team', 'attendants', 'ranking', 'resumes', 'video', 'recordings'] },
    { id: 'ajuda', label: 'Ajuda e treinamento', icon: 'tutorials', tabs: ['tutorials', 'support', 'cities'] },
    { id: 'sistema', label: 'Sistema', icon: 'settings', tabs: ['settings', 'offices', 'modules', 'audit', 'logs'] },
  ];

  const side = document.querySelector('aside.sidebar nav');
  const top = document.querySelector('header.topbar');
  if (!side || !top) return;
  const all = [...side.querySelectorAll('button[data-tab]')];
  const byTab = new Map(all.map((b) => [b.dataset.tab, b]));

  // Tela nova que ainda não foi colocada numa seção vai para "Outros" (não some).
  const listed = new Set(HUBS.flatMap((h) => h.tabs));
  const extra = all.map((b) => b.dataset.tab).filter((t) => !listed.has(t));
  if (extra.length) HUBS.push({ id: 'outros', label: 'Outros', icon: 'modules', tabs: extra });

  const sub = document.createElement('nav');
  sub.className = 'subnav';
  sub.setAttribute('aria-label', 'Telas desta seção');
  top.after(sub);

  // Busca rápida de telas no menu lateral.
  const find = document.createElement('input');
  find.className = 'nav-find';
  find.type = 'search';
  find.placeholder = 'Ir para a tela…';
  find.setAttribute('aria-label', 'Procurar tela');
  const results = document.createElement('div');
  results.className = 'nav-results';
  results.hidden = true;
  side.before(find, results);

  side.querySelectorAll('.nav-group').forEach((g) => g.remove());
  const hubOf = new Map();
  const hubBtn = new Map();
  const labelOf = (b) => b.querySelector('.nav-label')?.textContent.trim() || b.textContent.trim();
  for (const hub of HUBS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hub';
    btn.dataset.hub = hub.id;
    btn.innerHTML = `${typeof icon === 'function' ? icon(hub.icon) : ''}<span class="nav-label"></span><span class="nav-badge" hidden>0</span>`;
    btn.querySelector('.nav-label').textContent = hub.label;
    btn.hidden = true;
    btn.addEventListener('click', () => openHub(hub));
    side.append(btn);
    hubBtn.set(hub.id, btn);
    for (const t of hub.tabs) {
      const b = byTab.get(t);
      if (!b) continue;
      b.dataset.hubId = hub.id;
      sub.append(b);
      hubOf.set(t, hub);
    }
  }

  // Mesma regra do showTab: quem pode ver esta tela.
  function allowed(b) {
    const u = window.currentUser;
    if (!b || b.hidden || !u) return false;
    if (b.hasAttribute('data-admin') && u.role !== 'admin' && !(b.hasAttribute('data-officeadmin') && u.officeAdmin)) return false;
    return true;
  }
  const visibleTabs = (hub) => hub.tabs.map((t) => byTab.get(t)).filter(allowed);

  const memo = (() => { try { return JSON.parse(sessionStorage.getItem('migraHubLast') || '{}'); } catch { return {}; } })();
  function openHub(hub) {
    const tabs = visibleTabs(hub);
    if (!tabs.length) return;
    const last = tabs.find((b) => b.dataset.tab === memo[hub.id]);
    showTab((last || tabs[0]).dataset.tab);
  }

  let current = '';
  function refresh() {
    for (const hub of HUBS) {
      const tabs = visibleTabs(hub);
      const btn = hubBtn.get(hub.id);
      btn.hidden = !tabs.length;
      // Os avisos (números vermelhos) das telas somam no botão da seção.
      const n = tabs.reduce((s, b) => {
        const badge = b.querySelector('.nav-badge');
        return s + (badge && !badge.hidden ? Number(badge.textContent) || 0 : 0);
      }, 0);
      const hb = btn.querySelector('.nav-badge');
      hb.hidden = !n;
      hb.textContent = String(n);
    }
    mark(current);
  }

  function mark(name) {
    current = name;
    const hub = hubOf.get(name);
    hubBtn.forEach((btn, id) => btn.classList.toggle('active', Boolean(hub) && id === hub.id));
    let shown = 0;
    for (const b of byTab.values()) {
      const inHub = Boolean(hub) && b.dataset.hubId === hub.id && allowed(b);
      b.classList.toggle('in-hub', inHub);
      if (inHub) shown++;
    }
    sub.hidden = shown < 2;
    if (!hub) return;
    memo[hub.id] = name;
    try { sessionStorage.setItem('migraHubLast', JSON.stringify(memo)); } catch { /* ok */ }
    const b = byTab.get(name);
    const g = document.getElementById('crumbGroup');
    const p = document.getElementById('crumbPage');
    if (g) g.textContent = hub.label;
    if (p && b) p.textContent = labelOf(b);
  }

  const before = window.onTabShown;
  window.onTabShown = (name) => {
    before?.(name);
    refresh();
    mark(name);
  };

  // Permissões e avisos mudam depois do login (standby, caixa, visitas): refaz o menu.
  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; refresh(); });
  }).observe(sub, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'data-admin'] });

  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  find.addEventListener('input', () => {
    const q = norm(find.value.trim());
    side.hidden = Boolean(q);
    results.hidden = !q;
    if (!q) return;
    const hits = [];
    for (const hub of HUBS) for (const b of visibleTabs(hub)) {
      if (norm(labelOf(b)).includes(q) || norm(hub.label).includes(q)) hits.push([hub, b]);
    }
    results.replaceChildren(...hits.map(([hub, b]) => {
      const r = document.createElement('button');
      r.type = 'button';
      r.innerHTML = '<span class="nav-label"></span><small></small>';
      r.querySelector('.nav-label').textContent = labelOf(b);
      r.querySelector('small').textContent = hub.label;
      r.addEventListener('click', () => { find.value = ''; side.hidden = false; results.hidden = true; showTab(b.dataset.tab); });
      return r;
    }));
    if (!hits.length) results.innerHTML = '<p class="nav-empty">Nenhuma tela com esse nome.</p>';
  });
  find.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') results.querySelector('button')?.click();
    if (e.key === 'Escape') { find.value = ''; find.dispatchEvent(new Event('input')); }
  });

  window.migraHubs = { HUBS, refresh };
  refresh();
})();
