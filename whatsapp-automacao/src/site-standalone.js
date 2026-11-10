// Página inicial do Grupo Migra em UM arquivo só (CSS e JavaScript dentro, endereços completos), para colocar em outro site
// (ex.: o WordPress do migraparai.com na Hostinger) sem mexer no Migra Hub. Gerada a partir de public/site/home-premium.html.
import fs from 'node:fs';
import path from 'node:path';

/** html = home-premium.html; css/js = premium.css/premium.js; hub = endereço do Migra Hub (de onde vêm imagens e o botão "Falar com especialista"); origin = endereço onde a página vai ficar. */
export function buildStandalone({ html, css, js, hub = 'https://migraparaguay.com', origin = 'https://migraparaguai.com' }) {
  const hubUrl = hub.replace(/\/+$/, '');
  let out = html.replaceAll('{{ORIGIN}}', origin.replace(/\/+$/, ''));
  // Endereços do próprio site viram endereços completos (imagens das empresas, atendimento no WhatsApp).
  out = out.replace(/(src|href)="\/(img|atendimento|school|site)\b([^"]*)"/g, (_m, attr, p, rest) => `${attr}="${hubUrl}/${p}${rest}"`);
  out = out.replace(/<link rel="stylesheet" href="[^"]*premium\.css">/, () => `<style>\n${css}\n</style>`);
  out = out.replace(/<script src="[^"]*premium\.js" defer><\/script>/, () => `<script>\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`);
  out = out.replace(/<link rel="icon" href="[^"]*">/, `<link rel="icon" href="${hubUrl}/img/grupo-migra-emblema.png">`);
  return out;
}

export function buildStandaloneFromDisk(root, opts = {}) {
  const dir = path.join(root, 'public', 'site');
  const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
  return buildStandalone({ html: read('home-premium.html'), css: read('premium.css'), js: read('premium.js'), ...opts });
}
