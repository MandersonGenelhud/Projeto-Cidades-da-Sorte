// Aba "Fechamentos" (só administrador): quem continuou depois do orçamento, quanto fecha, o que travou e o plano em PDF.
(() => {
  const host = document.querySelector('#tab-lots')?.parentElement;
  if (!host) return;
  const sec = document.createElement('section');
  sec.id = 'tab-closings';
  sec.className = 'tab';
  host.appendChild(sec);
  let days = 60;
  async function render() {
    sec.innerHTML = '<div class="page-head"><h1>Fechamentos</h1></div><p class="muted">Carregando…</p>';
    let r;
    try { r = await api(`/api/fechamentos?days=${days}`); } catch (e) { sec.innerHTML = `<div class="page-head"><h1>Fechamentos</h1></div><p class="muted">${esc(e.message)}</p>`; return; }
    let fo = null; try { fo = await api('/api/flash-offer'); } catch { /* sem oferta */ }
    const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const when = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
    const open = r.checklist.filter((x) => x.aberto);
    sec.innerHTML = `<div class="page-head"><h1>Fechamentos</h1></div>
      <p class="hint">Todo cliente recebe o orçamento em PDF, então o orçamento sozinho não mede nada. Aqui contam só os que <b>continuaram a conversa depois do orçamento</b>. O percentual de fechamento é sobre eles.</p>
      <div class="row"><label>Período <select id="fcDays">${[30, 60, 90, 180].map((d) => `<option value="${d}" ${d === days ? 'selected' : ''}>últimos ${d} dias</option>`).join('')}</select></label></div>
      <div class="grid2">
        <div class="card"><div class="hint">Orçamentos enviados</div><b style="font-size:28px">${r.orcamentos}</b><div class="hint">${r.semResposta} sem nenhuma resposta depois do PDF</div></div>
        <div class="card"><div class="hint">Continuaram depois do orçamento</div><b style="font-size:28px">${r.continuaram}</b></div>
        <div class="card"><div class="hint">Fecharam (pagaram a entrada)</div><b style="font-size:28px">${r.pagos}</b> <span class="hint">${r.taxaFechamento}% de quem continuou</span></div>
        <div class="card"><div class="hint">Sem condições agora</div><b style="font-size:28px">${r.semCondicoes}</b><div class="hint">${r.planoPdf} compraram o plano em PDF</div></div>
      </div>
      <div class="panel"><h2>Funil (sobre quem continuou)</h2>
        ${r.funil.map((f) => `<div style="margin:8px 0"><div class="row"><span>${esc(f.label)}</span><b>${f.n} (${f.pct}%)</b></div><div class="progress"><div style="width:${Math.min(100, f.pct)}%"></div></div></div>`).join('')}</div>
      <div class="panel"><h2>Checklist de acompanhamento <span class="badge pending">${open.length} em aberto</span></h2>
        <p class="hint">Quem continuou depois do orçamento e ainda não fechou. O mais perto de fechar vem primeiro.</p>
        <div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Orçamento</th><th>Onde está</th><th>Objeções</th><th>Próximo passo</th><th>Última msg</th></tr></thead><tbody>
        ${r.checklist.map((x) => `<tr><td><b>${esc(x.nome || x.phone || 'Contato')}</b><div class="hint">${esc(x.phone ? `+${x.phone}` : '')}</div></td><td>${esc(x.orcamento || '')}<div class="hint">${brl(x.valor)}</div></td><td>${esc(x.etapa)}</td><td>${esc(x.objecoes.join(', ') || '—')}</td><td>${esc(x.proximo || '—')}${x.oferta === 'vai_a_vista' ? '<div class="hint">Oferta relâmpago: vai pagar à vista</div>' : ''}</td><td>${esc(when(x.ultimaAt))}${x.aguardando ? ' <span class="badge pending">espera resposta</span>' : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Ninguém continuou a conversa depois do orçamento neste período.</td></tr>'}
        </tbody></table></div></div>
      <div class="panel"><h2>Radar de objeções</h2>
        <p class="hint">O que os clientes dizem depois do orçamento e quanto de cada objeção acaba fechando. Objeção com taxa baixa é onde a IA precisa melhorar.</p>
        <div class="table-wrap"><table><thead><tr><th>Objeção</th><th>Apareceu</th><th>Fecharam</th><th>Taxa</th></tr></thead><tbody>
        ${r.radar.map((o) => `<tr><td>${esc(o.label)}</td><td>${o.total}</td><td>${o.fechou}</td><td>${o.taxa}%</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Ainda sem dados.</td></tr>'}
        </tbody></table></div></div>
      ${fo ? `<div class="panel"><h2>Oferta relâmpago: vagas</h2>
        <p class="hint">${esc(fo.config.title || '')}</p>
        <p>${fo.open ? '<span class="badge ok">no ar</span>' : '<span class="badge paused">encerrada</span>'} Brindes de ${fo.config.months || 12} meses: <b>${fo.taken + (fo.semestre || 0)}</b> reservados (${fo.unlimited ? 'sem limite de pessoas' : `${fo.left} livres de ${fo.total}`}) · ${fo.confirmed} com pagamento da entrada confirmado · vale até ${esc(String(fo.config.validUntil || '').split('-').reverse().join('/'))}.
          ${fo.config.groupPeople ? `Pessoas nos grupos: <b>${Number(fo.config.groupPeople).toLocaleString('pt-BR')}</b> (na arte e na legenda: <b>mais de ${Number(fo.config.groupPeopleRounded).toLocaleString('pt-BR')}</b>).` : ''}</p>
        <p class="hint">A reserva vale 48 h. Confirme quando a entrada for paga; sem pagamento, a reserva volta sozinha (ou libere agora). A oferta vale para todos que pagarem a entrada até a data.</p>
        <div class="row"><label>Limite de pessoas com o brinde (0 = sem limite) <input id="foSpots" type="number" min="0" value="${Number(fo.config.spots) || 0}" style="width:80px" /></label> <button class="btn small" id="foSpotsSave" type="button">Salvar limite</button></div><p class="hint">Se a arte e a legenda dizem "20 vagas", coloque 20 aqui: assim o limite é real e a IA só fala de vagas com o número do sistema. Se a oferta vale para todos, deixe 0.</p><div class="row"><button class="btn" id="foGroups" type="button">Contar pessoas nos grupos</button> <button class="btn primary" id="foCaption" type="button">Legenda para postar nos grupos</button></div><div id="foCaptionBox"></div>
        <div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Pacote</th><th>Brinde</th><th>Situação</th><th>Quando</th><th></th></tr></thead><tbody>
        ${fo.claims.map((c) => `<tr data-id="${esc(c.id)}"><td><b>${esc(c.name || c.phone || 'Cliente')}</b><div class="hint">${esc(c.phone ? `+${c.phone}` : '')}</div></td><td>${esc(c.pacote || '—')}</td><td>${fo.config.months || 12} meses</td><td>${esc({ reservada: 'reservada (aguardando pagamento à vista)', confirmada: 'confirmada (pagou)', expirada: 'expirada', liberada: 'liberada' }[c.status] || c.status)}</td><td>${esc(when(c.at))}</td><td class="row">${c.status === 'reservada' ? '<button class="btn small primary" data-fo="confirm">Pagou à vista</button><button class="btn small" data-fo="release">Liberar</button>' : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nenhum brinde reservado ainda.</td></tr>'}
        </tbody></table></div></div>` : ''}
      <div class="panel"><h2>Plano em PDF (para quem não tem condições)</h2>
        <p class="hint">Quem realmente não tem condições de contratar a assessoria recebe, uma única vez, a oferta do plano em PDF por <b>${brl(r.planoPdf.preco)}</b>. O PDF só é enviado depois do pagamento e você é avisado. Vendidos: <b>${r.planoPdf.vendidos}</b> · aguardando pagamento: <b>${r.planoPdf.aguardando}</b>.</p>
        <p>Arquivo usado hoje: ${r.planoPdf.oficial ? '<span class="badge ok">arquivo oficial enviado por você</span>' : '<span class="badge pending">PDF-base gerado pelo sistema (só com o que está na base oficial)</span>'}</p>
        <div class="row"><a class="btn" href="/api/plano-pdf" target="_blank" rel="noopener">Ver o PDF atual</a>
          <label class="btn">Enviar o PDF oficial <input type="file" id="fcFile" accept="application/pdf" hidden /></label>
          ${r.planoPdf.oficial ? '<button class="btn danger" id="fcBase" type="button">Voltar ao PDF-base</button>' : ''}</div></div>`;
    sec.querySelector('#foSpotsSave')?.addEventListener('click', async () => { try { await api('/api/settings', { method: 'PUT', body: { crm: { flashOffer: { spots: Math.max(0, Math.round(Number(sec.querySelector('#foSpots').value) || 0)) } } } }); toast('Limite salvo'); render(); } catch (err) { toast(err.message, true); } });
    sec.querySelector('#foCaption')?.addEventListener('click', async () => {
      try {
        const r = await api('/api/flash-offer/legenda');
        sec.querySelector('#foCaptionBox').innerHTML = `${r.contadoGrupos ? '' : '<p class="hint"><b>Atenção:</b> ainda não contei as pessoas dos grupos; a legenda sai sem o número. Clique em "Contar pessoas nos grupos" primeiro.</p>'}<textarea id="foCaptionText" rows="12" style="width:100%">${esc(r.text)}</textarea><div class="row"><button class="btn primary" id="foCopy" type="button">Copiar legenda</button> <a class="btn" href="${esc(r.link)}" target="_blank" rel="noopener">Testar o link</a></div>`;
        sec.querySelector('#foCopy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(sec.querySelector('#foCaptionText').value); toast('Legenda copiada'); } catch { sec.querySelector('#foCaptionText').select(); toast('Selecione e copie (Ctrl+C)'); } });
      } catch (err) { toast(err.message, true); }
    });
    sec.querySelector('#foGroups')?.addEventListener('click', async (e) => { e.target.disabled = true; e.target.textContent = 'Contando…'; try { const r = await api('/api/flash-offer/count-groups', { method: 'POST', body: {} }); toast(`${r.people.toLocaleString('pt-BR')} pessoas em ${r.groups} grupos`); render(); } catch (err) { toast(err.message, true); e.target.disabled = false; e.target.textContent = 'Contar pessoas nos grupos'; } });
    sec.querySelectorAll('[data-fo]').forEach((b) => b.addEventListener('click', async () => { const id = b.closest('tr').dataset.id; try { await api(`/api/flash-offer/claims/${id}/${b.dataset.fo}`, { method: 'POST', body: {} }); render(); } catch (err) { toast(err.message, true); } }));
    sec.querySelector('#fcDays').addEventListener('change', (e) => { days = Number(e.target.value); render(); });
    sec.querySelector('#fcFile')?.addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const b64 = await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.onerror = no; fr.readAsDataURL(f); }); await api('/api/plano-pdf', { method: 'POST', body: { base64: b64 } }); toast('PDF oficial salvo'); render(); } catch (err) { toast(err.message, true); }
    });
    sec.querySelector('#fcBase')?.addEventListener('click', async () => { if (!confirm('Voltar ao PDF-base gerado pelo sistema?')) return; try { await api('/api/plano-pdf', { method: 'POST', body: { remove: true } }); render(); } catch (err) { toast(err.message, true); } });
  }
  loaders.closings = () => render().catch((e) => toast(e.message, true));
})();
