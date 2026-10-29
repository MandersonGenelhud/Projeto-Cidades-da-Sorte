// Funções do site público (topo, rodapé, formatação e janela de interesse).
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(url, { method = 'GET', body } = {}) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

/** US$ 28.000 · Gs. 3.500.000 · /mês quando for aluguel. */
function price(value, currency = 'USD', perMonth = false) {
  if (!value) return 'Consulte';
  const n = Number(value).toLocaleString('pt-BR', { maximumFractionDigits: currency === 'PYG' ? 0 : 2 });
  const prefix = { USD: 'US$', PYG: 'Gs.', BRL: 'R$' }[currency] || currency;
  return `${prefix} ${n}${perMonth ? '/mês' : ''}`;
}

const TYPES = { terreno: 'Terreno', lote: 'Lote', casa: 'Casa', departamento: 'Apartamento', galpao: 'Galpão', fazenda: 'Fazenda / chácara', local: 'Ponto comercial' };
const STATUS = { disponivel: 'Disponível', reservado: 'Reservado', vendido: 'Vendido', alugado: 'Alugado', loteadora: 'Reservado pela loteadora' };

function siteChrome(active) {
  document.body.insertAdjacentHTML('afterbegin', `
    <header class="site-head"><div class="wrap">
      <a class="logo" href="/imoveis"><img src="/brand/logo" alt="Migra Paraguai" /></a>
      <nav class="site-nav">
        <a href="/imoveis" class="${active === 'imoveis' ? 'on' : ''}">Imóveis</a>
        <a href="/imoveis#loteamentos" class="${active === 'lotes' ? 'on' : ''}">Loteamentos</a>
        <a href="/parceiros" class="${active === 'parceiros' ? 'on' : ''}">Indique e ganhe</a>
        <a href="#" class="cta" id="headWa" hidden>Falar no WhatsApp</a>
      </nav>
    </div></header>`);
  document.body.insertAdjacentHTML('beforeend', `
    <footer class="site-foot"><div class="wrap">
      <div><b style="color:#fff">Migra Paraguai</b><br />Seu projeto no Paraguai começa aqui: residência, empresa, terrenos e imóveis.</div>
      <div><a href="/parceiros">Programa de indicação</a> · <a href="/privacidade.html">Privacidade</a></div>
    </div></footer>`);
}

function setHeaderWhatsapp(number) {
  const a = $('#headWa');
  if (!a || !number) return;
  a.href = `https://wa.me/${number}?text=${encodeURIComponent('Olá! Vim pelo site da Migra Paraguai.')}`;
  a.target = '_blank';
  a.rel = 'noopener';
  a.hidden = false;
}

/** Janela "Tenho interesse": registra no CRM e abre o WhatsApp do corretor. */
function openInterest({ title, kind, slug, lotId }) {
  let dlg = $('#interestDlg');
  if (!dlg) {
    document.body.insertAdjacentHTML('beforeend', `
      <dialog id="interestDlg">
        <form class="form" id="interestForm" method="dialog">
          <div><h3 style="margin:0">Tenho interesse</h3><p class="muted small" id="interestTitle" style="margin:4px 0 0"></p></div>
          <label>Seu nome <input name="name" required autocomplete="name" /></label>
          <label>Seu WhatsApp (com DDD) <input name="whatsapp" required inputmode="tel" autocomplete="tel" placeholder="+55 11 98765-4321" /></label>
          <label>E-mail (opcional) <input name="email" type="email" autocomplete="email" /></label>
          <label>Mensagem (opcional) <textarea name="message" rows="2" placeholder="Ex.: quero visitar no sábado"></textarea></label>
          <p class="err" id="interestErr"></p>
          <button class="btn primary" type="submit">Enviar e falar no WhatsApp</button>
          <button class="btn" type="button" id="interestClose">Fechar</button>
          <p class="muted small">Seus dados são usados só para o atendimento da Migra.</p>
        </form>
        <div id="interestOk" hidden class="form">
          <h3 style="margin:0">Recebemos seu interesse ✅</h3>
          <p>Seu código de atendimento é <b id="interestCode"></b>. Toque no botão para falar agora com o corretor.</p>
          <a class="btn wa" id="interestWa" target="_blank" rel="noopener">Abrir o WhatsApp</a>
          <button class="btn" type="button" onclick="this.closest('dialog').close()">Fechar</button>
        </div>
      </dialog>`);
    dlg = $('#interestDlg');
    $('#interestClose').onclick = () => dlg.close();
    $('#interestForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      $('#interestErr').textContent = '';
      try {
        const r = await api('/api/public/interest', { method: 'POST', body: { ...dlg.dataset, ...Object.fromEntries(new FormData(f)) } });
        $('#interestCode').textContent = r.code;
        $('#interestWa').href = r.whatsappUrl || '#';
        $('#interestWa').hidden = !r.whatsappUrl;
        f.hidden = true;
        $('#interestOk').hidden = false;
      } catch (err) {
        $('#interestErr').textContent = err.message;
      }
    });
  }
  dlg.dataset.kind = kind;
  dlg.dataset.slug = slug;
  dlg.dataset.lotId = lotId || '';
  $('#interestTitle').textContent = title;
  $('#interestForm').hidden = false;
  $('#interestOk').hidden = true;
  dlg.showModal();
}
