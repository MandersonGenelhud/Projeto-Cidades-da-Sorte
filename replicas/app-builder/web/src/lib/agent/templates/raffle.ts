import type { Files } from "../../types";

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The demo agent's output: a one-page raffle site for a city. */
export function raffleSite(city: string, drawAt = new Date(Date.now() + 14 * 86_400_000)): Files {
  const name = escapeHtml(city);
  const date = drawAt.toLocaleDateString("pt-BR", { day: "numeric", month: "long", timeZone: "America/Sao_Paulo" });

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sorteio ${name}</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="top">
    <strong>Sorteio ${name}</strong>
    <a href="#regras">Regras</a>
  </header>

  <main>
    <section class="hero">
      <h1>Concorra a uma moto 0 km em ${name}</h1>
      <p>Cadastro gratuito para moradores da cidade. Sorteio ao vivo em ${date}.</p>
      <div class="countdown" id="countdown" data-draw="${drawAt.toISOString()}" aria-live="polite">
        <div><b data-unit="d">--</b><small>dias</small></div>
        <div><b data-unit="h">--</b><small>horas</small></div>
        <div><b data-unit="m">--</b><small>min</small></div>
        <div><b data-unit="s">--</b><small>seg</small></div>
      </div>
      <a class="button" href="#cadastro">Quero participar</a>
    </section>

    <section class="prizes">
      <h2>Prêmios</h2>
      <ul>
        <li><strong>1º lugar</strong> Moto 0 km</li>
        <li><strong>2º lugar</strong> Smart TV 50 polegadas</li>
        <li><strong>3º lugar</strong> Vale-compras de R$ 500 no comércio local</li>
      </ul>
    </section>

    <section class="signup" id="cadastro">
      <h2>Cadastro</h2>
      <form id="form" novalidate>
        <label>Nome completo<input name="nome" autocomplete="name" required></label>
        <label>WhatsApp<input name="whatsapp" inputmode="tel" autocomplete="tel" placeholder="(19) 99999-9999" required></label>
        <label>Bairro<input name="bairro" required></label>
        <p class="error" id="error" role="alert" hidden></p>
        <button class="button" type="submit">Confirmar cadastro</button>
      </form>
      <p class="done" id="done" role="status" hidden></p>
      <p class="count" id="count"></p>
    </section>
  </main>

  <footer id="regras">
    <p>Um cadastro por pessoa. O resultado é divulgado nesta página e pelo WhatsApp informado.</p>
  </footer>
  <script src="app.js"></script>
</body>
</html>
`;

  const css = `:root {
  --primary: #6d28d9;
  --ink: #1d1a2b;
  --soft: #f6f3fd;
  --line: #e4ddf3;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--ink);
}
* { box-sizing: border-box; }
body { margin: 0; background: #fff; }
.top { display: flex; justify-content: space-between; align-items: center; padding: 14px 24px; border-bottom: 1px solid var(--line); }
.top a { color: var(--primary); text-decoration: none; font-weight: 600; }
main { max-width: 760px; margin: 0 auto; padding: 0 20px 48px; }
.hero { padding: 48px 0 32px; }
.hero h1 { font-family: Georgia, "Times New Roman", serif; font-size: clamp(30px, 6vw, 44px); line-height: 1.1; margin: 0 0 12px; }
.hero p { margin: 0; color: #4a4460; }
.countdown { display: flex; gap: 10px; margin: 28px 0; }
.countdown div { background: var(--soft); border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; min-width: 66px; text-align: center; }
.countdown b { display: block; font-size: 26px; font-variant-numeric: tabular-nums; }
.countdown small { color: #6b6480; font-size: 12px; }
.button { display: inline-block; background: var(--primary); color: #fff; border: 0; border-radius: 10px; padding: 13px 20px; font: 600 15px/1 inherit; text-decoration: none; cursor: pointer; }
.button:hover { filter: brightness(1.1); }
.prizes ul { list-style: none; padding: 0; display: grid; gap: 8px; }
.prizes strong { display: inline-block; min-width: 84px; }
form { display: grid; gap: 14px; max-width: 420px; }
label { display: grid; gap: 6px; font-weight: 600; font-size: 14px; }
input { font: inherit; font-weight: 400; padding: 11px 12px; border: 1px solid #8a83a0; border-radius: 8px; }
input:focus { outline: 2px solid var(--primary); outline-offset: 1px; }
.error { color: #b42318; margin: 0; }
.done { background: var(--soft); border: 1px solid var(--line); border-radius: 10px; padding: 14px; }
.count { color: #6b6480; font-size: 14px; }
footer { border-top: 1px solid var(--line); padding: 20px 24px; color: #6b6480; font-size: 14px; }
`;

  const js = `(function () {
  var box = document.getElementById("countdown");
  var draw = new Date(box.dataset.draw).getTime();
  function pad(n) { return String(n).padStart(2, "0"); }
  function tick() {
    var left = Math.max(0, draw - Date.now());
    var s = Math.floor(left / 1000);
    var parts = { d: Math.floor(s / 86400), h: Math.floor(s / 3600) % 24, m: Math.floor(s / 60) % 60, s: s % 60 };
    Object.keys(parts).forEach(function (k) {
      box.querySelector('[data-unit="' + k + '"]').textContent = pad(parts[k]);
    });
  }
  tick();
  setInterval(tick, 1000);

  var memory = [];
  function load() {
    try { return JSON.parse(localStorage.getItem("participantes") || "[]"); } catch (e) { return memory; }
  }
  function save(list) {
    try { localStorage.setItem("participantes", JSON.stringify(list)); } catch (e) { memory = list; }
  }
  function showCount() {
    var n = load().length;
    document.getElementById("count").textContent = n ? n + (n === 1 ? " pessoa cadastrada" : " pessoas cadastradas") : "";
  }
  showCount();

  var form = document.getElementById("form");
  var error = document.getElementById("error");
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var data = Object.fromEntries(new FormData(form));
    var phone = String(data.whatsapp || "").replace(/\\D/g, "");
    if (!String(data.nome || "").trim() || !String(data.bairro || "").trim()) {
      error.textContent = "Preencha nome e bairro.";
      error.hidden = false;
      return;
    }
    if (phone.length < 10 || phone.length > 11) {
      error.textContent = "Digite o WhatsApp com DDD, por exemplo (19) 99999-9999.";
      error.hidden = false;
      return;
    }
    var list = load();
    if (list.some(function (p) { return p.whatsapp === phone; })) {
      error.textContent = "Este WhatsApp já está cadastrado.";
      error.hidden = false;
      return;
    }
    var ticket = String(1000 + list.length + 1);
    list.push({ nome: String(data.nome).trim(), whatsapp: phone, bairro: String(data.bairro).trim(), numero: ticket });
    save(list);
    error.hidden = true;
    form.hidden = true;
    var done = document.getElementById("done");
    done.textContent = "Cadastro confirmado! Seu número da sorte é " + ticket + ".";
    done.hidden = false;
    showCount();
  });
})();
`;

  return { "index.html": html, "styles.css": css, "app.js": js };
}
