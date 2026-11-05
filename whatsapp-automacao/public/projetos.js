// Aba "Projetos e Sócios": o consultor que chegou ao topo traz um projeto; se der certo, ganha parte do lucro dele.
(() => {
  const host = document.querySelector('#tab-lots')?.parentElement;
  if (!host) return;
  const sec = document.createElement('section');
  sec.id = 'tab-projects';
  sec.className = 'tab';
  host.appendChild(sec);
  const brl = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const dt = (d) => (d ? new Date(d).toLocaleDateString('pt-BR') : '—');
  const LEGAL = 'A participação é um compromisso da Migra registrado aqui, e só vale depois de assinado o contrato próprio de cada projeto (preparado com o contador e o advogado da Migra).';
  let open = null;

  function form(p = {}) {
    return `<label>Nome do projeto<input data-f="title" value="${esc(p.title || '')}" placeholder="Ex.: Migra Seguros para quem chega ao Paraguai" /></label>
      <label>Que problema ele resolve<textarea data-f="problem" rows="2">${esc(p.problem || '')}</textarea></label>
      <label>Para quem (público)<textarea data-f="audience" rows="2">${esc(p.audience || '')}</textarea></label>
      <label>Como funciona e como cresce (plano)<textarea data-f="plan" rows="3">${esc(p.plan || '')}</textarea></label>
      <div class="grid2"><label>Quanto custa para começar (R$)<input data-f="startCost" inputmode="decimal" value="${p.startCost ?? ''}" /></label><label>Quanto pode faturar por mês (R$)<input data-f="revenuePotential" inputmode="decimal" value="${p.revenuePotential ?? ''}" /></label></div>`;
  }
  const read = (box) => Object.fromEntries([...box.querySelectorAll('[data-f]')].map((i) => [i.dataset.f, i.value]));

  function card(p, admin) {
    const st = p.statement;
    return `<div class="card" data-id="${esc(p.id)}"><div class="row"><b>${esc(p.title)}</b> <span class="chip small">${esc(p.stageLabel)}</span> <span class="hint">${esc(p.ownerName)} · desde ${dt(p.createdAt)}</span></div>
      ${p.stage === 'oficial' ? `<p>Participação combinada: <b>${p.sharePct}%</b> do lucro · já adquirida: <b>${p.vestedPct}%</b> (completa em ${p.vestingYears} ano(s))</p>` : p.stage === 'piloto' ? `<p>Piloto até ${dt(p.pilotEnd)} · participação no piloto: <b>${p.pilotSharePct}%</b> do lucro</p>` : ''}
      ${st.rows.length ? `<p class="hint">Receita: ${brl(st.revenue)} · lucro: ${brl(st.profit)} · parte do idealizador: <b>${brl(st.earned)}</b> · paga: ${brl(st.paid)} · a pagar: <b>${brl(st.due)}</b></p>` : ''}
      <button class="btn small" data-a="toggle">${open === p.id ? 'Fechar' : 'Ver detalhes'}</button>
      <div class="pj-detail" ${open === p.id ? '' : 'hidden'}>
        <p><b>Problema:</b> ${esc(p.problem)}</p><p><b>Público:</b> ${esc(p.audience || '—')}</p><p style="white-space:pre-wrap"><b>Plano:</b> ${esc(p.plan)}</p>
        <p class="hint">Custo para começar: ${p.startCost !== undefined ? brl(p.startCost) : '—'} · faturamento esperado por mês: ${p.revenuePotential !== undefined ? brl(p.revenuePotential) : '—'}</p>
        ${p.goals?.length ? `<h3>Metas do piloto</h3><ul>${p.goals.map((g) => `<li>${esc(g.label)}: meta ${esc(g.target)}${g.actual ? ` · alcançado ${esc(g.actual)}` : ''}</li>`).join('')}</ul>` : ''}
        ${st.rows.length ? `<h3>Resultados por mês</h3><div class="table-wrap"><table><thead><tr><th>Mês</th><th>Receita</th><th>Custos</th><th>Lucro</th><th>%</th><th>Parte do idealizador</th></tr></thead><tbody>${st.rows.map((r) => `<tr><td>${esc(r.month)}</td><td>${brl(r.revenue)}</td><td>${brl(r.costs)}</td><td>${brl(r.profit)}</td><td>${r.pct}%</td><td>${brl(r.share)}</td></tr>`).join('')}</tbody></table></div>` : ''}
        <h3>Histórico</h3><ul>${p.history.slice().reverse().map((h) => `<li>${dt(h.at)} · ${esc(h.by)}: ${esc(h.text)}</li>`).join('')}</ul>
        ${!admin && ['ideia', 'ajustes'].includes(p.stage) ? `<div class="pj-edit">${form(p)}<button class="btn small primary" data-a="save">Salvar ${p.stage === 'ajustes' ? 'e reenviar' : ''}</button></div>` : ''}
        ${admin ? `<div class="row" style="flex-wrap:wrap;gap:6px">
          ${['ideia', 'ajustes'].includes(p.stage) ? '<button class="btn small" data-a="analisar">Pôr em análise</button>' : ''}
          ${['ideia', 'analise'].includes(p.stage) ? '<button class="btn small" data-a="ajustes">Pedir ajustes</button>' : ''}
          ${['ideia', 'analise', 'ajustes'].includes(p.stage) ? '<button class="btn small primary" data-a="piloto">Aprovar piloto</button> <button class="btn small danger" data-a="recusar">Recusar</button>' : ''}
          ${p.stage === 'piloto' ? '<button class="btn small primary" data-a="oficial">Tornar projeto oficial</button>' : ''}
          ${['piloto', 'oficial'].includes(p.stage) ? '<button class="btn small" data-a="result">Lançar resultado do mês</button> <button class="btn small" data-a="goals">Metas</button> <button class="btn small danger" data-a="encerrar">Encerrar</button>' : ''}
          ${st.due > 0 ? '<button class="btn small primary" data-a="pay">Registrar pagamento</button>' : ''}</div>` : ''}
      </div></div>`;
  }

  async function load() {
    const admin = window.currentUser?.role === 'admin';
    const r = await api('/api/projects');
    const e = r.eligibility; const c = r.config;
    let html = `<div class="page-head"><h1>Projetos e Sócios</h1></div>
      <div class="panel"><h2>Migra Sócios de Projeto</h2>
        <p>Quem chega ao topo da Jornada pode trazer um projeto novo para a Migra. Se o projeto der certo, o idealizador recebe uma parte do lucro dele e passa a ser sócio daquele projeto. É assim que a Migra quer crescer: com quem cresce junto.</p>
        <p class="hint">Como funciona: ideia → análise da diretoria → piloto com metas → projeto oficial. No piloto o idealizador recebe ${c.pilotSharePct}% do lucro; no projeto oficial, até ${c.maxSharePct}%, conquistados aos poucos em ${c.vestingYears} ano(s). ${esc(LEGAL)}</p>
        ${!e.enabled ? '<p><b>O plano ainda não foi aberto pela diretoria.</b></p>'
    : e.ok ? `<p><b>Você já pode enviar um projeto.</b>${e.invited ? ' (convite da diretoria)' : ''}</p><div class="pj-new">${form()}<button class="btn primary" data-a="submit">Enviar ideia</button></div>`
      : `<p>Para participar: <b>${brl(e.minSales)}</b> em vendas confirmadas (você tem ${brl(e.confirmed)}; faltam <b>${brl(e.missingSales)}</b>), ${e.minMonths} meses de casa (você tem ${e.months}) e ter chegado ao nível <b>${esc(e.minLevel || '—')}</b> (${e.reachedLevel ? 'já chegou' : 'ainda não'}).</p>`}
      </div>`;
    if (admin) {
      html += `<div class="panel"><h2>Regras (só a diretoria)</h2>
        <label class="check"><input type="checkbox" id="pjOn" ${c.enabled ? 'checked' : ''} /> Plano aberto para os consultores</label>
        <div class="grid2"><label>Vendas confirmadas acumuladas para entrar (R$)<input id="pjS" inputmode="decimal" value="${c.minSales}" /></label><label>Meses de casa<input id="pjM" inputmode="numeric" value="${c.minMonths}" /></label>
        <label>Nível da Jornada exigido (id)<input id="pjL" value="${esc(c.minLevel || '')}" placeholder="legado" /></label><label>Participação no piloto (%)<input id="pjP" inputmode="decimal" value="${c.pilotSharePct}" /></label>
        <label>Teto da participação no projeto oficial (%)<input id="pjX" inputmode="decimal" value="${c.maxSharePct}" /></label><label>Anos para adquirir toda a participação<input id="pjV" inputmode="decimal" value="${c.vestingYears}" /></label></div>
        <button class="btn primary" data-a="config">Salvar regras</button>
        <p class="hint">Para liberar alguém antes da meta (exceção), use o convite: informe o login da pessoa.</p><div class="row"><input id="pjInv" placeholder="Login do consultor" /><button class="btn small" data-a="invite">Convidar</button><button class="btn small" data-a="uninvite">Retirar convite</button></div></div>`;
    }
    html += `<div class="panel"><h2>${admin ? 'Projetos enviados' : 'Meus projetos'}</h2>${r.items.map((p) => card(p, admin)).join('') || '<p class="muted">Nenhum projeto ainda.</p>'}</div>`;
    sec.innerHTML = html;
  }

  sec.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-a]'); if (!b) return;
    const g = (i) => sec.querySelector(i);
    const id = b.closest('[data-id]')?.dataset.id;
    const decide = (action, extra = {}) => api(`/api/projects/${id}/decide`, { method: 'POST', body: { action, ...extra } });
    try {
      switch (b.dataset.a) {
        case 'toggle': open = open === id ? null : id; break;
        case 'submit': await api('/api/projects', { method: 'POST', body: read(g('.pj-new')) }); toast('Ideia enviada para a diretoria'); break;
        case 'save': await api(`/api/projects/${id}`, { method: 'PATCH', body: read(b.closest('.pj-edit')) }); toast('Projeto salvo'); break;
        case 'config': await api('/api/projects/config', { method: 'PUT', body: { enabled: g('#pjOn').checked, minSales: g('#pjS').value, minMonths: g('#pjM').value, minLevel: g('#pjL').value, pilotSharePct: g('#pjP').value, maxSharePct: g('#pjX').value, vestingYears: g('#pjV').value } }); toast('Regras salvas'); break;
        case 'invite': case 'uninvite': {
          const users = await api('/api/users');
          const u = (users.items || users).find((x) => x.login === g('#pjInv').value.trim().toLowerCase());
          if (!u) return toast('Login não encontrado', true);
          await api(`/api/projects/invite/${u.id}`, { method: 'POST', body: { invited: b.dataset.a === 'invite' } }); toast('Pronto'); break;
        }
        case 'analisar': await decide('analisar'); break;
        case 'ajustes': case 'recusar': case 'encerrar': { const note = prompt('Explique o motivo (o consultor recebe no WhatsApp):'); if (!note) return; await decide(b.dataset.a, { note }); break; }
        case 'piloto': {
          const pilotMonths = prompt('Duração do piloto (meses):', '3'); if (pilotMonths === null) return;
          const pilotSharePct = prompt('Participação do idealizador no lucro durante o piloto (%):', ''); if (pilotSharePct === null) return;
          const goals = (prompt('Metas do piloto, separadas por ";" (ex.: 20 clientes; R$ 50 mil de receita):', '') || '').split(';').map((x) => x.trim()).filter(Boolean).map((label) => ({ label, target: label }));
          await decide('piloto', { pilotMonths, pilotSharePct, goals }); break;
        }
        case 'oficial': {
          const sharePct = prompt('Participação do idealizador no lucro do projeto oficial (%):'); if (!sharePct) return;
          const vestingYears = prompt('Em quantos anos ele adquire toda a participação?', ''); if (vestingYears === null) return;
          if (!confirm('Lembrete: a participação só vale depois do contrato próprio do projeto, feito com o contador e o advogado. Continuar?')) return;
          await decide('oficial', { sharePct, vestingYears }); break;
        }
        case 'result': {
          const month = prompt('Mês (AAAA-MM):', new Date().toISOString().slice(0, 7)); if (!month) return;
          const revenue = prompt('Receita do mês (R$):'); if (revenue === null) return;
          const costs = prompt('Custos do mês (R$):'); if (costs === null) return;
          await api(`/api/projects/${id}/results`, { method: 'POST', body: { month, revenue, costs } }); break;
        }
        case 'goals': {
          const p = (await api(`/api/projects/${id}`));
          const goals = p.goals.map((x) => ({ ...x, actual: prompt(`Alcançado em "${x.label}":`, x.actual || '') ?? x.actual }));
          await api(`/api/projects/${id}/goals`, { method: 'POST', body: { goals } }); break;
        }
        case 'pay': { const amount = prompt('Valor pago ao idealizador (R$):'); if (!amount) return; await api(`/api/projects/${id}/payments`, { method: 'POST', body: { amount } }); break; }
        default: return;
      }
      await load();
    } catch (err) { toast(err.message, true); }
  });
  loaders.projects = () => load().catch((err) => toast(err.message, true));
})();
