// Indicadores (administração): saques em até 24h, trocas de indicação, grupos rastreáveis e materiais de campanha.
(() => {
  const tab = document.querySelector('#tab-affiliates');
  if (!tab) return;
  const box = document.createElement('div');
  box.id = 'affExtras';
  tab.appendChild(box);
  const money = (v, c = 'BRL') => `${{ USD: 'US$', PYG: 'Gs.', BRL: 'R$' }[c] || c} ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const when = (d) => (d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const CH = { instagram: 'Post do Instagram', status: 'Status / Stories', whatsapp: 'Mensagem de WhatsApp', grupo: 'Grupo de WhatsApp' };
  async function load() {
    if (window.currentUser?.role !== 'admin') return;
    const [pays, trs, groups, mats, flow] = await Promise.all([api('/api/affiliates-payouts'), api('/api/affiliates-transfers'), api('/api/affiliates-groups'), api('/api/affiliates-materials'), api('/api/affiliates-flow')]);
    const open = pays.filter((p) => p.status === 'pedido');
    const T = flow.totais; const E = flow.etapas;
    box.innerHTML = `
      <div class="panel"><h2>Fluxo das indicações</h2>
        <p class="hint">Todas as pessoas indicadas por parceiros e em que ponto estão. "Parada" = aberta e sem movimento há ${flow.diasParada}+ dias (o vendedor recebe o aviso todo dia).</p>
        <div class="grid2">
          <div><b>${T.indicacoes}</b> indicações no total · <b>${T.novas}</b> nos últimos ${flow.dias} dias</div>
          <div><b>${T.emAtendimento}</b> em atendimento · <b>${T.paradas}</b> paradas · <b>${T.fechadas}</b> fechadas · <b>${T.perdidas}</b> perdidas · conversão <b>${T.conversao}%</b></div>
        </div>
        <div class="hint">Por etapa: Novo ${E.novo} · Em contato ${E.em_contato} · Proposta enviada ${E.proposta} · Retomar depois ${E.aguardando} · Fechado ${E.ganho} · Perdido ${E.perdido}</div>
        <div class="table-wrap"><table><thead><tr><th>Indicador</th><th>Indicações</th><th>Novas</th><th>Em atendimento</th><th>Paradas</th><th>Fechadas</th><th>Perdidas</th><th>Conversão</th></tr></thead><tbody>
        ${flow.porIndicador.map((x) => `<tr><td>${esc(x.name)}</td><td>${x.total}</td><td>${x.novas}</td><td>${x.emAtendimento}</td><td>${x.paradas ? `<span class="badge paused">${x.paradas}</span>` : 0}</td><td>${x.fechadas}</td><td>${x.perdidas}</td><td>${x.conversao}%</td></tr>`).join('') || '<tr><td colspan="8" class="muted">Ainda não há indicações.</td></tr>'}
        </tbody></table></div>
        <h3>Últimas indicações</h3>
        <div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Indicado por</th><th>Etapa</th><th>Vendedor</th><th>Desde</th></tr></thead><tbody>
        ${flow.recentes.map((x) => `<tr><td>${esc(x.name)} <span class="hint">${esc(x.code)}</span></td><td>${esc(x.indicador)}</td><td>${esc(x.etapa)}${x.parada ? ' <span class="badge paused">parada</span>' : ''}</td><td>${esc(x.vendedor || '—')}</td><td>${when(x.desde)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">—</td></tr>'}
        </tbody></table></div></div>
      <div class="panel"><h2>Saques dos indicadores ${open.length ? `<span class="badge pending">${open.length} para pagar</span>` : ''}</h2>
        <p class="hint">Prazo combinado: até 24 horas depois do pedido. Faça o Pix e marque como pago (o indicador é avisado no WhatsApp).</p>
        <div class="table-wrap"><table><thead><tr><th>Pedido</th><th>Indicador</th><th>Valor</th><th>Para</th><th>Prazo</th><th></th></tr></thead><tbody>
        ${pays.map((p) => `<tr data-id="${esc(p.id)}"><td>${when(p.createdAt)}</td><td>${esc(p.affName)}</td><td><b>${money(p.amount, p.currency)}</b></td><td>${esc(p.payout)}</td>
          <td>${p.status === 'pedido' ? `${when(p.dueAt)}${p.late ? ' <span class="badge paused">atrasado</span>' : ''}` : esc({ pago: `Pago ${when(p.paidAt)}`, recusado: `Recusado: ${p.reason || ''}` }[p.status] || p.status)}</td>
          <td>${p.status === 'pedido' ? '<button class="btn small primary" data-a="pay">Marcar pago</button> <button class="btn small danger" data-a="reject">Recusar</button>' : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nenhum pedido.</td></tr>'}
        </tbody></table></div></div>
      <div class="panel"><h2>Trocas de indicação</h2>
        <p class="hint">Quando o cliente pede que a comissão fique com outro indicador: o primeiro indicador é avisado e cede ou mantém no escritório virtual. Sem resposta no prazo, a diretoria decide aqui.</p>
        <div class="grid2"><label>Código do cliente (ex.: MIG-0123)<input id="trLead" /></label><label>Código do novo indicador<input id="trTo" /></label></div>
        <label>O que o cliente pediu<input id="trWhy" /></label><button class="btn" data-a="trnew">Registrar pedido e avisar o indicador</button>
        <div class="table-wrap"><table><thead><tr><th>Cliente</th><th>De</th><th>Para</th><th>Situação</th><th></th></tr></thead><tbody>
        ${trs.map((t) => `<tr data-id="${esc(t.id)}"><td>${esc(t.leadName)}<br><span class="hint">${esc(t.reason || '')}</span></td><td>${esc(t.fromName)}</td><td>${esc(t.toName)}</td>
          <td>${t.status === 'aguardando' ? `Aguardando até ${when(t.deadline)}${t.overdue ? ' <span class="badge paused">prazo vencido</span>' : ''}` : esc(t.status)}</td>
          <td>${t.status === 'aguardando' ? '<button class="btn small" data-a="trYes">Passar</button> <button class="btn small" data-a="trNo">Manter</button>' : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nenhum pedido.</td></tr>'}
        </tbody></table></div></div>
      <div class="panel"><h2>Grupos do WhatsApp rastreáveis</h2>
        <p class="hint">Cada indicador recebe um link próprio para cada grupo. A pessoa faz o pré-cadastro (nome e WhatsApp) e só depois entra no grupo: assim sabemos quem entrou e por quem.</p>
        <textarea id="grList" rows="3" placeholder="Nome do grupo | https://chat.whatsapp.com/XXXX (um por linha)">${esc(groups.map((g) => `${g.label} | ${g.url}`).join('\n'))}</textarea>
        <button class="btn" data-a="groups">Salvar grupos</button></div>
      <div class="panel"><h2>Materiais de campanha</h2>
        <p class="hint">Imagem + texto. Use {link} e {nome}: cada indicador recebe com o link dele. No WhatsApp o link aparece com a imagem em miniatura.</p>
        <div class="grid2"><label>Título<input id="mtT" placeholder="Ex.: Residência no Paraguai em 90 dias" /></label>
          <label>Onde publicar<select id="mtC">${Object.entries(CH).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
          <label>Leva para (opcional)<input id="mtTo" placeholder="/imoveis ou deixe vazio para o pré-cadastro" /></label>
          <label>Grupo (opcional)<select id="mtG"><option value="">—</option>${groups.map((g) => `<option value="${esc(g.key)}">${esc(g.label)}</option>`).join('')}</select></label></div>
        <label>Texto<textarea id="mtX" rows="4" placeholder="Quer morar no Paraguai com segurança? Faça seu pré-cadastro: {link}"></textarea></label>
        <label>Imagem (PNG, JPG ou WEBP; quadrada fica melhor)<input type="file" id="mtI" accept="image/png,image/jpeg,image/webp" /></label>
        <button class="btn primary" data-a="mtnew">Publicar material</button>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-top:10px">
        ${mats.items.map((m) => `<div class="card" data-id="${esc(m.id)}" ${m.active === false ? 'style="opacity:.5"' : ''}>${m.image ? `<img src="/m/img/${esc(m.image)}" alt="" style="width:100%;border-radius:8px" />` : ''}<b>${esc(m.title)}</b><div class="hint">${esc(CH[m.channel] || m.channel)}</div><p class="hint" style="white-space:pre-wrap">${esc(m.text || '')}</p><button class="btn small" data-a="mtToggle">${m.active === false ? 'Reativar' : 'Tirar do ar'}</button></div>`).join('')}
        </div></div>`;
  }
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const g = (i) => box.querySelector(i); const id = b.closest('[data-id]')?.dataset.id;
    try {
      switch (b.dataset.a) {
        case 'pay': { const note = prompt('Confirma que o Pix foi feito? Observação (opcional):', ''); if (note === null) return; await api(`/api/affiliates-payouts/${id}/pay`, { method: 'POST', body: { note } }); break; }
        case 'reject': { const reason = prompt('Motivo (o indicador recebe):'); if (!reason) return; await api(`/api/affiliates-payouts/${id}/reject`, { method: 'POST', body: { reason } }); break; }
        case 'trnew': await api('/api/affiliates-transfers', { method: 'POST', body: { lead: g('#trLead').value.trim(), toCode: g('#trTo').value.trim(), reason: g('#trWhy').value } }); toast('Pedido registrado. O indicador foi avisado.'); break;
        case 'trYes': case 'trNo': { const note = prompt('Observação (o indicador recebe, opcional):', ''); if (note === null) return; await api(`/api/affiliates-transfers/${id}/decide`, { method: 'POST', body: { accept: b.dataset.a === 'trYes', note } }); break; }
        case 'groups': {
          const groups = g('#grList').value.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter(([l, u]) => l && u).map(([label, url], i) => ({ key: label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || `g${i + 1}`, label, url }));
          const saved = await api('/api/affiliates-groups', { method: 'PUT', body: { groups } });
          toast(saved.length === groups.length ? 'Grupos salvos' : `Salvos ${saved.length} de ${groups.length}: confira os links (https://chat.whatsapp.com/...)`, saved.length !== groups.length); break;
        }
        case 'mtnew': { const f = new FormData(); f.append('title', g('#mtT').value); f.append('channel', g('#mtC').value); f.append('text', g('#mtX').value); f.append('to', g('#mtTo').value); f.append('group', g('#mtG').value); if (g('#mtI').files[0]) f.append('image', g('#mtI').files[0]); await api('/api/affiliates-materials', { method: 'POST', form: f }); toast('Material publicado'); break; }
        case 'mtToggle': { const on = b.textContent.trim() === 'Reativar'; const f = new FormData(); f.append('active', on ? 'true' : 'false'); await api(`/api/affiliates-materials/${id}`, { method: 'PATCH', form: f }); break; }
        default: return;
      }
      await load();
    } catch (err) { toast(err.message, true); }
  });
  const prev = loaders.affiliates;
  loaders.affiliates = async (...a) => { if (prev) await prev(...a); await load().catch((err) => toast(err.message, true)); };
})();
